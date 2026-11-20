import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScheduleCells, parseTabsWithAI, parseHeaderWithGemini, cleanTabNameFallback, extractDeterministicSemester, hasDateInfo, fallbackParse } from './aiParser';
import { getCanonicalRoomKey, normalizeDisplayName, formatSapienzaAddress, SAPIENZA_BUILDINGS, resolveClassroom } from './classroomLocations';

export interface WarmCourseStartupSnapshot {
  degreeUrl: string;
  defaultTabUrl: string | null;
  tabs: Tab[];
  schedules: Record<string, ScheduleData>;
  selectedTab: Tab;
  selectedSchedule: ScheduleData | null;
}

// Cache in RAM per il testo della Mappa Edifici e per gli orari completi del corso (0ms latency)
const memoryMapTextCache = new Map<string, string>();
const memoryAllSchedulesCache = new Map<
  string,
  { tabs: Tab[]; schedules: Record<string, ScheduleData>; fingerprint?: string }
>();
let warmCourseStartupSnapshot: WarmCourseStartupSnapshot | null = null;

export function clearScraperMemoryCache(): void {
  memoryAllSchedulesCache.clear();
  memoryMapTextCache.clear();
  warmCourseStartupSnapshot = null;
}

/**
 * Restituisce in modo sincrono (0ms) lo snapshot del corso già pre-caricato in RAM durante
 * StartupCheckScreen / onboarding, evitando spinner di caricamento al primo frame di Orario/Aule.
 */
export function getWarmCourseStartupSnapshot(
  degreeUrl?: string | null
): WarmCourseStartupSnapshot | null {
  if (!warmCourseStartupSnapshot) return null;
  if (degreeUrl && warmCourseStartupSnapshot.degreeUrl !== degreeUrl) {
    return null;
  }
  return warmCourseStartupSnapshot;
}

/**
 * Pre-carica in RAM (solo AsyncStorage / cache locale, 0 byte di rete) tabs, orari e canale
 * predefinito del corso così le schermate Orario e Aule si aprono già complete sul frame 0.
 */
export async function warmCourseStartupData(
  degreeUrl: string
): Promise<WarmCourseStartupSnapshot | null> {
  if (!degreeUrl) return null;
  try {
    const cacheKey = `allSchedules_v8_${degreeUrl}`;
    const perCourseTabKey = `defaultTabUrl_${degreeUrl}`;
    let courseData = memoryAllSchedulesCache.get(degreeUrl) || null;

    const keysToRead = courseData
      ? [perCourseTabKey, 'defaultTabUrl']
      : [perCourseTabKey, 'defaultTabUrl', cacheKey];
    const pairs = await AsyncStorage.multiGet(keysToRead);

    const defaultTabUrl = pairs[0]?.[1] || pairs[1]?.[1] || null;
    if (!courseData) {
      const raw = pairs[2]?.[1];
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0 && parsed.schedules) {
        courseData = {
          tabs: parsed.tabs,
          schedules: parsed.schedules,
          fingerprint: parsed.fingerprint,
        };
        memoryAllSchedulesCache.set(degreeUrl, courseData);
      }
    }

    if (!courseData || courseData.tabs.length === 0) return null;

    const selectedTab =
      (defaultTabUrl
        ? courseData.tabs.find((t) => t.url === defaultTabUrl)
        : undefined) || courseData.tabs[0];
    const selectedSchedule =
      courseData.schedules[selectedTab.url] ||
      courseData.schedules[selectedTab.name] ||
      null;

    warmCourseStartupSnapshot = {
      degreeUrl,
      defaultTabUrl,
      tabs: courseData.tabs,
      schedules: courseData.schedules,
      selectedTab,
      selectedSchedule,
    };
    return warmCourseStartupSnapshot;
  } catch {
    return null;
  }
}

type DegreeChangeListener = (url: string | null, name?: string) => void;
const degreeChangeListeners = new Set<DegreeChangeListener>();

export function subscribeToDegreeChanges(listener: DegreeChangeListener): () => void {
  degreeChangeListeners.add(listener);
  return () => {
    degreeChangeListeners.delete(listener);
  };
}

export function notifyDegreeChanged(url: string | null, name?: string): void {
  degreeChangeListeners.forEach((cb) => {
    try {
      cb(url, name);
    } catch {}
  });
}

// Funzione di hashing (djb2) per rilevare cambiamenti nel foglio
function hashCode(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Estrae una mappa delle classi CSS con i rispettivi colori di sfondo.
 * Necessario per individuare e rimuovere il testo "trucco" invisibile
 * (es. "geo e geo e geo", "mat e") che i docenti colorano dello stesso colore di sfondo.
 */
export function extractClassBgColors(html: string): Record<string, string> {
  const classBgColors: Record<string, string> = {};
  const cssRegex = /\.([a-zA-Z0-9_-]+)\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)/gi;
  let cssMatch;
  while ((cssMatch = cssRegex.exec(html)) !== null) {
    classBgColors[cssMatch[1]] = cssMatch[2].toLowerCase().trim();
  }
  return classBgColors;
}

/**
 * Pulisce il contenuto di una cella <td> rimuovendo:
 * 1. Testo invisibile (span il cui colore combacia con il background della cella o è transparent)
 * 2. Tag HTML e codici speciali
 */
export function cleanTdCellHtml(tdTag: string, innerHtml: string, classBgColors: Record<string, string> = {}): string {
  const classMatch = tdTag.match(/class="([^"]+)"/i);
  const cls = classMatch ? classMatch[1] : '';
  const inlineBg = tdTag.match(/background-color:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|[a-zA-Z]+)/i);
  const bg = (inlineBg ? inlineBg[1] : classBgColors[cls] || '#ffffff').toLowerCase().trim();

  // Rimuovi qualsiasi span il cui colore del testo combaci con il colore di sfondo della cella
  const cleaned = innerHtml.replace(/<span[^>]*style="[^"]*color:\s*([^;"]+)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, (_match, color, content) => {
    const c = color.toLowerCase().trim();
    if (c === bg || c === 'transparent') {
      return ''; // Testo invisibile scartato
    }
    return content;
  });

  return cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * Estrae le righe testuali pulite (rimuovendo script, nonce e span invisibili) in un'unica passata HTML.
 */
function extractRowsFromHtml(html: string): string[][] {
  if (!html) return [];
  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/nonce="[^"]*"/gi, '');

  const classBgColors = extractClassBgColors(clean);
  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(clean)) !== null) {
    const tdRegex = /(<td[^>]*>)([\s\S]*?)<\/td>/gi;
    let tdMatch;
    const row: string[] = [];
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      row.push(cleanTdCellHtml(tdMatch[1], tdMatch[2], classBgColors));
    }
    if (row.length > 0) {
      rows.push(row);
    }
  }
  return rows;
}

function computeRowsFingerprint(rows: string[][]): string {
  const nonEmpty: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.some(Boolean)) {
      nonEmpty.push(row.join('|'));
    }
  }
  return hashCode(nonEmpty.join('\n'));
}

/**
 * Estrae un'impronta digitale (fingerprint) deterministica del foglio.
 * Rimuove i nonce e gli script dinamici generati a ogni richiesta da Google Sheets
 * ed estrae il testo effettivo di tutte le celle (intestazione, avvisi, aule, lezioni),
 * escludendo i testi invisibili di padding.
 */
export function extractSheetContentFingerprint(html: string): string {
  if (!html) return '';
  return computeRowsFingerprint(extractRowsFromHtml(html));
}

export interface Degree {
  name: string;
  url: string;
  className: string;
}

export interface Tab {
  name: string;
  url: string;
}

export interface ClassroomInfo {
  aulaName: string;
  building: string;
  address: string;
}

export interface ClassEvent {
  subject: string;
  teacher: string;
  room: string;
  building?: string;
  address?: string;
  startTime: string;
  endTime: string;
  duration: number;
  isManual?: boolean;
  manualId?: string;
  repetitionType?: 'semester' | 'custom_date' | 'single';
  repeatUntilDate?: string;
}

export interface ScheduleData {
  info: {
    faculty: string;
    course: string;
    year: string;
    academicYear: string;
    channel: string;
    semester: string; // we'll keep this as fallback
  };
  alerts: string[]; // <--- New alerts array
  classrooms: ClassroomInfo[];
  days: ClassEvent[][]; // 5 arrays, one per day (LUN-VEN)
}

export const FALLBACK_DEGREES: Degree[] = [
  {
    name: "Ingegneria Aeronautica / Aeronautical Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBa6Z6l2Oy70Zx4X_jqCmd9NtPwuFhmVzGSGu6nyJzVhKagY7ejFc-1n1MCWvVc5-0JwVktIsG2plI/pubhtml",
    className: "LM-20",
  },
  {
    name: "Ingegneria Aerospaziale - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQ4bH_T0V78WiwWP_D3QRNauz8izwY7Asu_RSP1OHHqujJfY4U-hHkoLDvIjxm3w/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria Biomedica - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDqlnYMu5OCu2mKeJDc-Uu8iWRdQekthZDiIckJGIgT4b-j4Ex2Mayk0wdXpgH1QSiJADqPbsfTK4d/pubhtml",
    className: "LM-21",
  },
  {
    name: "Ingegneria Chimica - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0dENfMgvomzmeLh8GXb-JavkpkKOmOKBR_iy257cl7nHRAc1yui4ceFsYotIfcQ/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria Chimica / Chemical Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTezz8ZDG_AOq7T_jJEamR58AoWgX_tms7_q_WF_HqZHyIOe1ZcNqLMzkqoL58uexXXaJbu0QdD6z7C/pubhtml",
    className: "LM-22",
  },
  {
    name: "Ingegneria Civile - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS8ODbnYZNffQtQaU3Kb4We7_8tvJ0ME2Xmz6c8XtILL_1MG3AjeFQIT2df2ivi8tGovd8eiMyoVRRt/pubhtml",
    className: "LM-23",
  },
  {
    name: "Ingegneria Civile - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSFlsygQDWUjWfjnZxBQpjgB1F5awv8zh71EDbJ3Opxrneg9smWesgaqiRQ37t8ow/pubhtml",
    className: "L-7R",
  },
  {
    name: "Ingegneria Clinica - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vToVbzBu8Xnv6CT3WkjhfG0egQZRw0EN-P3TyCiEBmSj-vRTstO2stWzvC9NTXSsQ/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria dell'Energia Elettrica - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0e5dikoNMdEnvd1fBN2aw-VmoeHDbfhlinWuvsNoKbLuU9ZlF3o8Mld67ByXS2A/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria dell'energia Elettrica / Electrical Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqRYZ1kd0UsmT5UoYxDeh3tk8PxjtqK1SL9tA-njsttxW1FFbBATKn-H6q1-gs4JSLt9Q1yUSXCb5d/pubhtml",
    className: "LM-28",
  },
  {
    name: "Ingegneria della Sicurezza E Protezione Civile / Safety And Civil Protection Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQgOvLrG1T2CW33BIMCOvZMXaOiC_dDReMH0UD180iZtoB99vGiB6qWg0WTpcaULuZ6j54H9Nr54is4/pubhtml",
    className: "LM-26",
  },
  {
    name: "Ingegneria delle Nanotecnologie / Nanotechnology Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQEkUNQPLk4jZrN1Hs6oN1TFOM-2ZukjF2I13EPtkfWceRtDJDabpbunK0GPzxcjCLFsvxn1WnC60MC/pubhtml",
    className: "LM-53",
  },
  {
    name: "Ingegneria Edile-Architettura - Quinquennale Ciclo Unico",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRqRfNrzHB_px_g6rrrob_damXys4UJ0Xlxo7RrjJ_tz6B2fx8FXM2Gbgr9SzhwlEhMk0gv7ASyhBN0/pubhtml",
    className: "LM-4c.u.R",
  },
  {
    name: "Ingegneria Energetica - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0Rvu4363QL2c7HqgSUZhOmZaZnvJFol-DFVcZMd4kZZYffSJx4qC3o1HL1xVrZw/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria Energetica / Energy Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQmiVd2Yd35lEMygEzCYK2qu_O-Peb2zVc3-6Il1d6Xzdh1LpiKKFoqnYRFzSyrs5mfYzj0qgi_8nyp/pubhtml",
    className: "LM-30",
  },
  {
    name: "Ingegneria Meccanica - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR43VlYl2ywap93xcKt5adzAtTQkmLQjp5xCvsjVLxGQY4aqc45mZeFqC9F2NIHew/pubhtml",
    className: "L-9R",
  },
  {
    name: "Ingegneria Meccanica / Mechanical Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFjKLnk6t2QT9dItq7FNRdAFk0tMtELSjLU7Nm82IB5RlkkONozkx7JB2LGro4lNHtLGHBpNSFIE8z/pubhtml",
    className: "LM-33",
  },
  {
    name: "Ingegneria per l'Ambiente e il Territorio - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQU6H6YmSSbz6iYSQaImLrCN9wU98ZYTP3JWjaHqNhXZekU3DeFvduOZzCKFwb-cg/pubhtml",
    className: "L-7",
  },
  {
    name: "Ingegneria per l'Ambiente e il Territorio / Environmental Engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTORKKhFeUXNJMiWopruNLmdn9yX5s7S3ycsqLI-d4qO8USdMrA2i05AEOILib49qm2Vs9N0SyRJKAI/pubhtml",
    className: "LM-35",
  },
  {
    name: "Ingegneria spaziale e astronautica / Space and astonautical engineering - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPWv0vlwQbU9gbni2m3PMJ4gB0-TofZc8XhRwnJH9XRTUNh9ojtmjd4Mu-Zk88YTC3ryD-Jhqo7PmO/pubhtml",
    className: "LM-20",
  },
  {
    name: "Professioni tecniche per l'edilizia e il territorio - Triennale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTR4x7EpZlOc_oBiJMAMZodPpyEtEYA6Zz2DT6o3GZ2P7uN5D8DSQ-r88z4MX18AQ/pubhtml",
    className: "L-P01",
  },
  {
    name: "Transport Systems Engineering / Ingegneria Dei Sistemi Di Trasporto - Magistrale",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8OO7O6xIRV3feoFLyIK2zlqHIZiecdVXuvcqpbSgn78j_j8IM83n6Zt9fVjDmSnKRI5PC_G2yToFi/pubhtml",
    className: "LM-23",
  },
];

export async function fetchDegrees(forceRefresh = false): Promise<Degree[]> {
  const cacheKey = 'cached_degrees_list_v2';
  if (!forceRefresh) {
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }
  try {
    const url = 'https://ici.web.uniroma1.it/node/388';
    const res = await axios.get(url, { timeout: 4000 });
    const html = res.data;
    const degrees: Degree[] = [];
    
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trContent = trMatch[1];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      
      let tdMatch = tdRegex.exec(trContent);
      if (!tdMatch) continue;
      const td1 = tdMatch[1];
      
      tdMatch = tdRegex.exec(trContent);
      if (!tdMatch) continue;
      const td2 = tdMatch[1];
      
      const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
      const aMatch = aRegex.exec(td1);
      if (aMatch) {
        const link = aMatch[1].trim();
        const name = aMatch[2].replace(/<[^>]+>/g, '').trim();
        const className = td2.replace(/<[^>]+>/g, '').trim();
        degrees.push({ name, url: link, className });
      }
    }
    if (degrees.length > 0) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(degrees)).catch(() => {});
      return degrees;
    }
    return FALLBACK_DEGREES;
  } catch (error) {
    console.warn('Sapienza website unreachable or timed out, returning fallback degree catalog:', error);
    return FALLBACK_DEGREES;
  }
}



/**
 * Recupera i canali/tab salvati in locale istantaneamente (0ms latency, nessun accesso di rete).
 */
export async function getCachedTabs(url: string): Promise<Tab[] | null> {
  const mem = memoryAllSchedulesCache.get(url);
  if (mem && Array.isArray(mem.tabs) && mem.tabs.length > 0) {
    return mem.tabs;
  }
  try {
    const schedKey = `allSchedules_v8_${url}`;
    const schedStr = await AsyncStorage.getItem(schedKey);
    if (schedStr) {
      const parsed = JSON.parse(schedStr);
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        if (parsed.schedules) {
          memoryAllSchedulesCache.set(url, parsed);
        }
        return parsed.tabs;
      }
    }
    const cacheKey = `tabsCache_${url}`;
    const cachedStr = await AsyncStorage.getItem(cacheKey);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (Array.isArray(cached.tabs) && cached.tabs.length > 0) return cached.tabs;
    }
  } catch {}
  return null;
}

export async function fetchTabs(url: string, forceRefresh = false): Promise<Tab[]> {
  try {
    const res = await axios.get(url, { timeout: 6000 });
    const data = res.data;

    const itemsRegex = /items\.push\(\{(.*?)\}\);/g;
    let match;
    const rawTabs: { rawName: string; url: string }[] = [];
    
    let mapTabUrl: string | null = null;
    while ((match = itemsRegex.exec(data)) !== null) {
      const content = match[1];
      const nameMatch = content.match(/name:\s*"([^"]+)"/);
      const urlMatch = content.match(/pageUrl:\s*"([^"]+)"/);
      if (nameMatch && urlMatch) {
        const rawName = nameMatch[1];
        const pageUrl = urlMatch[1].replace(/\\/g, '');

        // Se è la mappa edifici, memorizza l'URL per scaricarlo
        if (/mappa|edifici/i.test(rawName)) {
          mapTabUrl = pageUrl;
          continue;
        }

        if (/aule/i.test(rawName)) continue;
        rawTabs.push({
          rawName: rawName,
          url: pageUrl,
        });
      }
    }

    // Hash deterministico sui soli tab e URL mappa (ignora i nonce random dell'HTML di Google)
    const contentHash = hashCode(JSON.stringify({ rawTabs, mapTabUrl }));
    const cacheKey = `tabsCache_${url}`;
    const baseSheetUrl = url.split('/sheet')[0];

    const ensureMapLoaded = async () => {
      if (!mapTabUrl) return;
      if (!forceRefresh) {
        if (memoryMapTextCache.has(url) || memoryMapTextCache.has(baseSheetUrl)) {
          return;
        }
        try {
          const existingMap = await AsyncStorage.getItem(`courseMapText_${baseSheetUrl}`);
          if (existingMap) {
            memoryMapTextCache.set(url, existingMap);
            memoryMapTextCache.set(baseSheetUrl, existingMap);
            return;
          }
        } catch {}
      }
      try {
        const mapRes = await axios.get(mapTabUrl, { timeout: 3500 });
        const cleanText = mapRes.data
          .replace(/<\/tr>|<\/p>|<br\s*\/?>/gi, '\n')
          .replace(/<\/td>/gi, ' - ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        memoryMapTextCache.set(url, cleanText);
        memoryMapTextCache.set(baseSheetUrl, cleanText);
        await AsyncStorage.multiSet([
          [`courseMapText_${url}`, cleanText],
          [`courseMapText_${baseSheetUrl}`, cleanText],
        ]);
      } catch {}
    };

    if (!forceRefresh) {
      try {
        const cachedStr = await AsyncStorage.getItem(cacheKey);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr);
          if (cached.hash === contentHash && Array.isArray(cached.tabs) && cached.tabs.length > 0) {
            await ensureMapLoaded();
            return cached.tabs;
          }
        }
      } catch {}
    }

    const rawNames = rawTabs.map(t => t.rawName);
    const mapTask = ensureMapLoaded();

    if (rawTabs.length === 0) {
      await mapTask;
      return [];
    }

    // Esegui in parallelo lo scaricamento della Mappa Edifici e il parsing AI dei nomi dei tab
    const [, parsedNames] = await Promise.all([
      mapTask,
      parseTabsWithAI(rawNames),
    ]);
    
    const tabs: Tab[] = [];
    for (let i = 0; i < rawTabs.length; i++) {
      const aiName = parsedNames[i];
      const newName = (aiName && aiName.trim() !== '') ? aiName.trim() : cleanTabNameFallback(rawTabs[i].rawName);
      if (newName.trim() !== '') {
        tabs.push({ name: newName, url: rawTabs[i].url });
      }
    }
    
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hash: contentHash, tabs }));
    } catch {}

    return tabs;
  } catch (error) {
    console.error('Error fetching tabs:', error);
    return [];
  }
}

export async function fetchScheduleData(
  tabUrl: string,
  forceRefresh = false,
  preloadedHtml?: string
): Promise<ScheduleData> {
  const defaultData: ScheduleData = {
    info: { faculty: '', course: '', year: '', academicYear: '', channel: '', semester: '' },
    alerts: [],
    classrooms: [],
    days: [[], [], [], [], []],
  };

  try {
    const html = preloadedHtml || (await axios.get(tabUrl, { timeout: 6000 })).data;

    // Singola passata di parsing righe HTML: riutilizzata sia per fingerprint che per l'estrazione orario
    const rows = extractRowsFromHtml(html);
    const contentFingerprint = computeRowsFingerprint(rows);
    const cacheKey = `scheduleCache_v8_${tabUrl}`;
    const fpKey = `tabFingerprint_v8_${tabUrl}`;
    if (!forceRefresh) {
      try {
        const pairs = await AsyncStorage.multiGet([cacheKey, fpKey]);
        const cachedStr = pairs[0]?.[1];
        const storedFp = pairs[1]?.[1];
        if (cachedStr && storedFp === contentFingerprint) {
          const cached = JSON.parse(cachedStr);
          if (cached.data) {
            return cached.data;
          }
        }
      } catch {}
    }

    const data = { ...defaultData };

    // 1. Rileva se il layout è STANDARD (giorni sulle colonne)
    let dayRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const joined = rows[i].join(' ').toLowerCase();
      const hasLun = joined.includes('lunedì') || joined.includes('lunedi');
      const hasMar = joined.includes('martedì') || joined.includes('martedi');
      const hasMer = joined.includes('mercoledì') || joined.includes('mercoledi');
      if (hasLun && (hasMar || hasMer)) {
        dayRowIndex = i;
        break;
      }
    }

    let headerRows: string[][] = [];
    const timeSlots: { time: string; cells: string[] }[] = [];

    if (dayRowIndex !== -1) {
      // Layout STANDARD: righe successive contengono l'orario in colonna 0 e le celle dei giorni nelle colonne 1..5
      headerRows = dayRowIndex > 0 ? rows.slice(0, dayRowIndex) : rows.slice(0, 15);
      for (let i = dayRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const time = row[0] || '';
        if (!time.match(/\d{1,2}:\d{2}/)) continue;
        timeSlots.push({
          time,
          cells: [row[1] || '', row[2] || '', row[3] || '', row[4] || '', row[5] || ''],
        });
      }
    } else {
      // 2. Rileva se il layout è TRASPOSTO (giorni sulle righe, es. 3° Anno Clinica)
      const daysOfWeek = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì'];
      const dayRowMap: Record<number, number> = {};
      for (let i = 0; i < rows.length; i++) {
        const firstCol = (rows[i][0] || '').toLowerCase();
        for (let d = 0; d < daysOfWeek.length; d++) {
          const dayName = daysOfWeek[d];
          if (firstCol.includes(dayName) || firstCol.startsWith(dayName.slice(0, 3))) {
            dayRowMap[d] = i;
          }
        }
      }

      const detectedDays = Object.keys(dayRowMap).length;
      if (detectedDays >= 3) {
        const firstDayRow = Math.min(...Object.values(dayRowMap));
        let timeRowIdx = -1;
        for (let i = 0; i < firstDayRow; i++) {
          const times = rows[i].filter(c => /\d{1,2}:\d{2}/.test(c));
          if (times.length >= 3) {
            timeRowIdx = i;
            break;
          }
        }

        if (timeRowIdx !== -1) {
          const timeRow = rows[timeRowIdx];
          headerRows = rows.slice(0, timeRowIdx);

          const normalizeSlotTime = (raw: string) => {
            const isPM = /PM/i.test(raw);
            const isAM = /AM/i.test(raw);
            const clean = raw.replace(/\s*[AP]M\b/gi, '').replace(/\s+/g, '');
            const parts = clean.split('-');
            if (parts.length !== 2) return raw;
            let startH = Number(parts[0].split(':')[0]);
            let endH = Number(parts[1].split(':')[0]);
            const startM = parts[0].split(':')[1] || '00';
            const endM = parts[1].split(':')[1] || '00';
            if (isPM) {
              if (startH < 12) startH += 12;
              if (endH < 12) endH += 12;
            } else if (isAM) {
              if (startH === 12) startH = 0;
            }
            return String(startH).padStart(2, '0') + ':' + startM + '-' + String(endH).padStart(2, '0') + ':' + endM;
          };

          for (let col = 1; col < timeRow.length; col++) {
            const rawTime = timeRow[col];
            if (/\d{1,2}:\d{2}/.test(rawTime)) {
              const cleanTime = normalizeSlotTime(rawTime);
              const dayCells = [0, 1, 2, 3, 4].map(d => {
                const rIdx = dayRowMap[d];
                if (rIdx === undefined) return '';
                return rows[rIdx]?.[col] || '';
              });
              timeSlots.push({
                time: cleanTime,
                cells: dayCells,
              });
            }
          }
        }
      }
    }

    if (timeSlots.length === 0) return data;

    // Parsa le info di base dall'intestazione
    for (const row of headerRows) {
      const joined = row.join(' ').toLowerCase();
      if (joined.includes('a.a.')) {
        const aaMatch = row.join(' ').match(/\d{4}-\d{2,4}/);
        if (aaMatch) data.info.academicYear = aaMatch[0];
      }
      if (joined.includes('semestre') && hasDateInfo(joined)) {
        data.info.semester = row.filter(Boolean).join(' · ').trim();
      }
    }

    // Raccogli tutte le celle non vuote per inviarle all'AI in batch
    const allCells: string[] = [];
    const cellMap: { day: number; slotIndex: number }[] = [];
    
    for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
      for (let day = 0; day < 5; day++) {
        const cellText = timeSlots[slotIdx].cells[day];
        allCells.push(cellText);
        cellMap.push({ day, slotIndex: slotIdx });
      }
    }

    // Recupera Mappa Edifici prima dalla RAM (0ms), altrimenti da AsyncStorage
    let mapText = '';
    const baseSheetUrl = tabUrl.split('/sheet')[0];
    mapText = memoryMapTextCache.get(baseSheetUrl) || '';
    if (!mapText) {
      try {
        const pairs = await AsyncStorage.multiGet([
          `courseMapText_${baseSheetUrl}`,
          'selectedDegreeUrl',
        ]);
        mapText = pairs[0]?.[1] || '';
        if (!mapText) {
          const storedUrl = pairs[1]?.[1];
          if (storedUrl) {
            mapText = memoryMapTextCache.get(storedUrl) || (await AsyncStorage.getItem(`courseMapText_${storedUrl}`)) || '';
          }
        }
        if (mapText) {
          memoryMapTextCache.set(baseSheetUrl, mapText);
        }
      } catch {}
    }

    if (!mapText) {
      mapText = headerRows.map(r => r.join(' ')).join('\n');
    }

    // Estrai preliminarmente in modo sincrono (0ms) le aule dalle celle per avviare in PARALLELO
    // sia il parsing Gemini delle celle sia l'analisi Gemini dell'intestazione!
    const prelimRooms = Array.from(
      new Set(allCells.filter(Boolean).map(c => fallbackParse(c).room).filter(Boolean))
    );

    const [parsed, headerResult] = await Promise.all([
      parseScheduleCells(allCells),
      parseHeaderWithGemini(headerRows, mapText, prelimRooms),
    ]);

    // Arricchisci mappedRooms con eventuali ulteriori aule restituite da Gemini in parsed
    const uniqueRooms = Array.from(new Set(parsed.map(p => p.room).filter(Boolean)));
    const mappedRooms = { ...headerResult.mappedRooms };
    const headerLines = headerRows.map(r => r.filter(Boolean).join(' | ')).join('\n').trim();
    uniqueRooms.forEach(room => {
      const canon = getCanonicalRoomKey(room);
      const dispName = normalizeDisplayName(room);
      if (!canon || canon === 'aula') return;
      if (!mappedRooms[canon] && !mappedRooms[`aula ${canon}`]) {
        const resolved = resolveClassroom(room, headerLines + '\n' + mapText);
        const bCode = (resolved.buildingName || '').match(/RM\d{3}/i)?.[0]?.toUpperCase();
        const addr = formatSapienzaAddress(resolved.address, bCode);
        const item = {
          key: canon,
          displayName: dispName,
          building: resolved.buildingName,
          address: addr,
        };
        mappedRooms[canon] = item;
        mappedRooms[`aula ${canon}`] = item;
      }
    });

    const validSemester = (headerResult.semester && hasDateInfo(headerResult.semester))
      ? headerResult.semester
      : (extractDeterministicSemester(headerRows) || '');
    data.info.semester = validSemester;
    data.alerts = headerResult.alerts || [];

    const uniqueClassroomsMap = new Map<string, ClassroomInfo>();
    Object.values(mappedRooms).forEach(m => {
      const canon = getCanonicalRoomKey(m.displayName || m.key);
      if (!uniqueClassroomsMap.has(canon)) {
        const bCode = (m.building || '').match(/RM\d{3}/i)?.[0]?.toUpperCase();
        uniqueClassroomsMap.set(canon, {
          aulaName: normalizeDisplayName(m.displayName || m.key),
          building: m.building,
          address: formatSapienzaAddress(m.address, bCode),
        });
      }
    });
    data.classrooms = Array.from(uniqueClassroomsMap.values());

    // Ricostruisci gli eventi per giorno, accorpando slot adiacenti
    for (let day = 0; day < 5; day++) {
      const events: ClassEvent[] = [];
      let currentEvent: ClassEvent | null = null;

      for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
        const flatIdx = slotIdx * 5 + day;
        const p = parsed[flatIdx];
        const slot = timeSlots[slotIdx];

        if (p && p.subject) {
          const roomLabel = p.room ? normalizeDisplayName(p.room) : '';
          const rawCellText = timeSlots[slotIdx]?.cells[day] || '';

          let finalBuilding = '';
          let finalAddress = '';

          // 1. Risolvi da codice edificio estratto da Gemini o dalla cella (es. RM032, RM031, RM018)
          const bCode = (p.buildingCode || rawCellText.match(/RM\d{3}/i)?.[0] || '').toUpperCase();
          if (bCode && SAPIENZA_BUILDINGS[bCode]) {
            finalBuilding = SAPIENZA_BUILDINGS[bCode].name;
            finalAddress = SAPIENZA_BUILDINGS[bCode].address;
          }

          // 2. Risolvi da indirizzo esplicito nella cella o da Gemini
          const explicitAddress = p.address || (rawCellText.match(/tiburtina\s*205/i) ? 'Via Tiburtina 205, 00185 Roma' : (rawCellText.match(/scarpa\s*14/i) ? 'Via Antonio Scarpa 14, 00161 Roma' : ''));
          if (explicitAddress) {
            finalAddress = formatSapienzaAddress(explicitAddress, bCode);
            if (!finalBuilding) {
              if (/tiburtina/i.test(finalAddress)) finalBuilding = 'Edificio RM025 (Tiburtina)';
              else if (/scarpa/i.test(finalAddress)) finalBuilding = 'Edificio RM006';
            }
          }

          const roomClean = roomLabel.replace(/^aula\s+/i, '').toLowerCase().trim();
          const dayNames = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi'];
          const currentDayStr = dayNames[day];
          const escapedRoom = roomClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const specificDayKey = roomClean
            ? Object.keys(mappedRooms).find(k => {
                const canonK = getCanonicalRoomKey(k);
                const hasRoom = new RegExp(`^${escapedRoom}\\s*\\(`, 'i').test(canonK);
                const hasDay = canonK.includes(currentDayStr);
                return hasRoom && hasDay;
              })
            : undefined;

          // 3. Se non ancora risolto, cerca in mappedRooms dall'intestazione
          if (!finalBuilding || !finalAddress) {
            const mInfo = specificDayKey
              ? mappedRooms[specificDayKey]
              : (mappedRooms[getCanonicalRoomKey(roomLabel)] || mappedRooms[roomClean] || mappedRooms[p.room]);

            if (mInfo) {
              finalBuilding = finalBuilding || mInfo.building;
              finalAddress = finalAddress || mInfo.address;
            }
          }

          // 4. Fallback: risoluzione deterministica Sapienza
          if (!finalBuilding || !finalAddress) {
            const resolved = resolveClassroom(roomLabel || p.room, mapText);
            finalBuilding = finalBuilding || resolved.buildingName;
            finalAddress = finalAddress || resolved.address;
          }

          if (finalAddress) {
            finalAddress = formatSapienzaAddress(finalAddress, (finalBuilding.match(/RM\d{3}/i)?.[0]));
          }

          // Registra l'aula nella mappa aule del corso rispettando eventuali varianti giornaliere
          if (roomLabel) {
            const targetCanon = specificDayKey ? getCanonicalRoomKey(specificDayKey) : getCanonicalRoomKey(roomLabel);
            const targetAulaName = specificDayKey && mappedRooms[specificDayKey]?.displayName
              ? normalizeDisplayName(mappedRooms[specificDayKey].displayName)
              : roomLabel;
            if (!uniqueClassroomsMap.has(targetCanon)) {
              uniqueClassroomsMap.set(targetCanon, {
                aulaName: targetAulaName,
                building: finalBuilding,
                address: finalAddress,
              });
            }
          }

          const cleanSubject = (p.subject || '').toUpperCase().trim();
          const cleanTeacher = (p.teacher || '').replace(/non\s*specificato/i, '').trim();
          const curTeacher = (currentEvent?.teacher || '').replace(/non\s*specificato/i, '').trim();
          const teacherMatches = !curTeacher || !cleanTeacher || curTeacher.toLowerCase() === cleanTeacher.toLowerCase();

          if (
            currentEvent &&
            currentEvent.subject === cleanSubject &&
            teacherMatches
          ) {
            // Estendi la durata
            currentEvent.endTime = slot.time.split('-')[1] || slot.time;
            currentEvent.duration += 1;
            if (!currentEvent.teacher && cleanTeacher) currentEvent.teacher = cleanTeacher;
            if (!currentEvent.room && roomLabel) currentEvent.room = roomLabel;
          } else {
            if (currentEvent) events.push(currentEvent);
            const times = slot.time.split('-');
            currentEvent = {
              subject: cleanSubject,
              teacher: cleanTeacher,
              room: roomLabel,
              building: finalBuilding,
              address: finalAddress,
              startTime: times[0] || slot.time,
              endTime: times[1] || '',
              duration: 1,
            };
          }
        } else {
          if (currentEvent) {
            events.push(currentEvent);
            currentEvent = null;
          }
        }
      }
      if (currentEvent) events.push(currentEvent);
      data.days[day] = events;
    }

    data.classrooms = Array.from(uniqueClassroomsMap.values());
    
    try {
      await AsyncStorage.multiSet([
        [cacheKey, JSON.stringify({ hash: contentFingerprint, data })],
        [`tabFingerprint_v8_${tabUrl}`, contentFingerprint],
      ]);
    } catch {}

    return data;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return defaultData;
  }
}

/**
 * Legge l'orario più recente già presente nella cache locale (RAM prima, poi AsyncStorage) senza eseguire richieste di rete.
 * Utile per sincronizzazioni calendario e preferenze in tempo reale.
 */
export async function getCachedScheduleData(
  tabUrl?: string | null,
  degreeUrl?: string | null
): Promise<ScheduleData | null> {
  try {
    if (degreeUrl) {
      const memAll = memoryAllSchedulesCache.get(degreeUrl);
      if (memAll?.schedules && typeof memAll.schedules === 'object') {
        if (tabUrl && memAll.schedules[tabUrl]?.days?.length) {
          return memAll.schedules[tabUrl];
        }
        const firstValid = Object.values(memAll.schedules).find(
          (s) => s && Array.isArray(s.days) && s.days.length > 0
        );
        if (firstValid) return firstValid;
      }

      const allRaw = await AsyncStorage.getItem(`allSchedules_v8_${degreeUrl}`);
      if (allRaw) {
        const parsedAll = JSON.parse(allRaw);
        const schedulesMap = parsedAll?.schedules;
        if (schedulesMap && typeof schedulesMap === 'object') {
          if (Array.isArray(parsedAll?.tabs) && parsedAll.tabs.length > 0) {
            memoryAllSchedulesCache.set(degreeUrl, parsedAll);
          }
          if (tabUrl && schedulesMap[tabUrl]?.days?.length) {
            return schedulesMap[tabUrl] as ScheduleData;
          }
          const firstValid = Object.values(schedulesMap).find(
            (s: any) => s && Array.isArray(s.days) && s.days.length > 0
          ) as ScheduleData | undefined;
          if (firstValid) return firstValid;
        }
      }
    }

    if (tabUrl) {
      const cachedRaw = await AsyncStorage.getItem(`scheduleCache_v8_${tabUrl}`);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed?.data?.days?.length) {
          return parsed.data as ScheduleData;
        }
      }
    }
  } catch {}
  return null;
}

export interface IncrementalFetchOptions {
  changedTabUrls?: string[];
  preloadedHtmlByUrl?: Record<string, string>;
}

/**
 * Scarica TUTTI i canali, orari e aule di un corso di laurea in una sola operazione ("in un'unica botta").
 * Supporta l'aggiornamento incrementale dei soli canali realmente modificati riutilizzando l'HTML già scaricato.
 */
export async function fetchAllCourseData(
  degreeUrl: string,
  forceRefresh = false,
  onProgress?: (step: string, current: number, total: number) => void,
  incrementalOpts?: IncrementalFetchOptions
): Promise<{ tabs: Tab[]; schedules: Record<string, ScheduleData> }> {
  const cacheKey = `allSchedules_v8_${degreeUrl}`;

  // Se non è richiesto un refresh forzato, prova a leggere prima dalla RAM (0ms), poi da AsyncStorage
  if (!forceRefresh) {
    const mem = memoryAllSchedulesCache.get(degreeUrl);
    if (mem && mem.tabs.length > 0 && mem.schedules) {
      return mem;
    }
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.tabs && parsed.schedules && parsed.tabs.length > 0) {
          memoryAllSchedulesCache.set(degreeUrl, parsed);
          return parsed;
        }
      }
    } catch {}
  }

  // Modalità incrementale: se checkCourseUpdates ha già individuato i soli canali cambiati,
  // evita di riscaricare la lista tab e i canali invariati e riutilizza l'HTML già in memoria
  const changedSet =
    incrementalOpts?.changedTabUrls && incrementalOpts.changedTabUrls.length > 0
      ? new Set(incrementalOpts.changedTabUrls)
      : null;

  let existingCached: { tabs: Tab[]; schedules: Record<string, ScheduleData> } | null = null;
  if (changedSet) {
    existingCached = memoryAllSchedulesCache.get(degreeUrl) || null;
    if (!existingCached) {
      try {
        const stored = await AsyncStorage.getItem(cacheKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed?.tabs) && parsed.tabs.length > 0 && parsed.schedules) {
            existingCached = parsed;
          }
        }
      } catch {}
    }
  }

  let tabs: Tab[];
  const schedules: Record<string, ScheduleData> = {};

  if (changedSet && existingCached && existingCached.tabs.length > 0) {
    tabs = existingCached.tabs;
    const tabsToUpdate = tabs.filter(
      (t) => changedSet.has(t.url) || !existingCached!.schedules[t.url]
    );
    for (const t of tabs) {
      if (!changedSet.has(t.url) && existingCached.schedules[t.url]) {
        schedules[t.url] = existingCached.schedules[t.url];
      }
    }

    onProgress?.(`Aggiornamento di ${tabsToUpdate.length} canal${tabsToUpdate.length === 1 ? 'e' : 'i'}...`, 0, tabsToUpdate.length);

    let completedCount = 0;
    await Promise.all(
      tabsToUpdate.map(async (tab) => {
        try {
          const preHtml = incrementalOpts?.preloadedHtmlByUrl?.[tab.url];
          const data = await fetchScheduleData(tab.url, true, preHtml);
          schedules[tab.url] = data;
        } catch (e) {
          console.warn(`Errore caricamento incrementale ${tab.name}:`, e);
          if (existingCached!.schedules[tab.url]) {
            schedules[tab.url] = existingCached!.schedules[tab.url];
          }
        } finally {
          completedCount++;
          onProgress?.(`Aggiornato ${completedCount}/${tabsToUpdate.length}: ${tab.name}`, completedCount, tabsToUpdate.length);
        }
      })
    );
  } else {
    onProgress?.('Caricamento canali disponibili...', 0, 1);
    tabs = await fetchTabs(degreeUrl, forceRefresh);
    if (tabs.length === 0) {
      return { tabs: [], schedules: {} };
    }

    onProgress?.('Scaricamento canali del corso...', 0, tabs.length);

    // 1. Scarica in parallelo tutti gli HTML dei canali (riutilizzando eventuali HTML precaricati)
    const htmlResults = await Promise.all(
      tabs.map((t) => {
        const pre = incrementalOpts?.preloadedHtmlByUrl?.[t.url];
        if (pre) return Promise.resolve(pre);
        return axios
          .get(t.url, { timeout: 6000 })
          .then((r) => r.data)
          .catch((err) => {
            console.warn(`Impossibile scaricare ${t.name}:`, err?.message);
            return '';
          });
      })
    );

    // 2. Elabora TUTTI i canali in parallelo
    let completedCount = 0;
    onProgress?.(`Analisi orari in corso (0/${tabs.length})...`, 0, tabs.length);

    await Promise.all(
      tabs.map(async (tab, i) => {
        try {
          const data = await fetchScheduleData(tab.url, forceRefresh, htmlResults[i]);
          schedules[tab.url] = data;
        } catch (e) {
          console.warn(`Errore caricamento ${tab.name}:`, e);
        } finally {
          completedCount++;
          onProgress?.(`Download ${completedCount}/${tabs.length}: ${tab.name}`, completedCount, tabs.length);
        }
      })
    );
  }

  // Calcola e memorizza il fingerprint complessivo dei canali
  // IMPORTANTE: leggiamo i tabFingerprint_* DOPO che fetchScheduleData li ha già salvati
  const fpPairs = await AsyncStorage.multiGet(tabs.map(t => `tabFingerprint_v8_${t.url}`));
  const combinedFingerprint = tabs.map((t, idx) => `${t.url}:${fpPairs[idx]?.[1] || 'missing'}`).join('|');

  const result = { tabs, schedules, fingerprint: combinedFingerprint };
  memoryAllSchedulesCache.set(degreeUrl, result);
  try {
    await AsyncStorage.multiSet([
      [cacheKey, JSON.stringify(result)],
      [`courseFingerprint_v8_${degreeUrl}`, combinedFingerprint],
      [`lastCheckTime_${degreeUrl}`, Date.now().toString()],
    ]);
  } catch {}

  return result;
}

export interface UpdateCheckResult {
  hasChanges: boolean;
  reason?: string;
  changedTabUrls?: string[];
  preloadedHtmlByUrl?: Record<string, string>;
}

const COURSE_UPDATE_CHECK_COOLDOWN_MS = 60 * 1000;

/**
 * Controlla all'avvio se il Google Sheet ufficiale ha subito modifiche
 * (es. variazione orario, spostamento aula, o nuovo avviso in bacheca).
 * Applica un cooldown di 1 minuto per evitare download ridondanti su riaperture ravvicinate
 * e restituisce i soli tab modificati con gli HTML già scaricati per l'aggiornamento incrementale.
 */
export async function checkCourseUpdates(
  degreeUrl: string,
  forceCheck = false
): Promise<UpdateCheckResult> {
  try {
    const cacheKey = `allSchedules_v8_${degreeUrl}`;
    const lastCheckKey = `lastCheckTime_${degreeUrl}`;

    let parsed: { tabs?: Tab[]; schedules?: Record<string, ScheduleData> } | null =
      memoryAllSchedulesCache.get(degreeUrl) || null;
    let lastCheckRaw: string | null = null;

    if (!parsed) {
      const pairs = await AsyncStorage.multiGet([cacheKey, lastCheckKey]);
      const stored = pairs[0]?.[1];
      lastCheckRaw = pairs[1]?.[1] || null;
      if (!stored) {
        return { hasChanges: true, reason: 'Nessun dato locale trovato' };
      }
      parsed = JSON.parse(stored);
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0 && parsed.schedules) {
        memoryAllSchedulesCache.set(degreeUrl, {
          tabs: parsed.tabs,
          schedules: parsed.schedules,
        });
      }
    } else if (!forceCheck) {
      lastCheckRaw = await AsyncStorage.getItem(lastCheckKey);
    }

    if (!parsed || !parsed.tabs || parsed.tabs.length === 0 || !parsed.schedules) {
      return { hasChanges: true, reason: 'Dati locali incompleti' };
    }

    // Cooldown di 1 minuto: se i fogli sono già stati verificati di recente, entra subito con 0 byte di rete
    if (!forceCheck && lastCheckRaw) {
      const lastTs = parseInt(lastCheckRaw, 10);
      if (!Number.isNaN(lastTs) && Date.now() - lastTs < COURSE_UPDATE_CHECK_COOLDOWN_MS) {
        return { hasChanges: false };
      }
    }

    // 1. Scarica in parallelo i soli tab del corso con timeout ridotto (3.0s) per ingresso fulmineo
    const tabFetches = await Promise.all(
      parsed.tabs.map((t: Tab) =>
        axios.get(t.url, { timeout: 3000 }).then(r => ({ url: t.url, html: r.data })).catch(() => null)
      )
    );

    const validFetches = tabFetches.filter(Boolean) as { url: string; html: string }[];
    if (validFetches.length === 0) {
      return { hasChanges: false }; // Offline o timeout: entra subito con i dati locali
    }

    const currentFps: Record<string, string> = {};
    const preloadedHtmlByUrl: Record<string, string> = {};
    for (const item of validFetches) {
      currentFps[item.url] = extractSheetContentFingerprint(item.html);
      preloadedHtmlByUrl[item.url] = item.html;
    }

    // 2. Controllo canale per canale:
    // Raccoglie TUTTI i tab effettivamente cambiati per aggiornare solo quelli
    const changedTabUrls: string[] = [];
    let changeReason = '';

    const fpKeys = parsed.tabs
      .filter((tab: Tab) => Boolean(currentFps[tab.url]))
      .map((tab: Tab) => `tabFingerprint_v8_${tab.url}`);
    const storedFpEntries = fpKeys.length > 0 ? await AsyncStorage.multiGet(fpKeys) : [];
    const storedFpMap = new Map(storedFpEntries);
    const missingFpWrites: [string, string][] = [];

    for (const tab of parsed.tabs) {
      const liveFp = currentFps[tab.url];
      if (!liveFp) continue; // Tab non risposto in tempo: consideralo invariato per evitare falsi allarmi

      const fpKey = `tabFingerprint_v8_${tab.url}`;
      const storedTabFp = storedFpMap.get(fpKey);

      // Se non avevamo ancora memorizzato il fingerprint per questo canale, allinealo senza riscaricare
      if (!storedTabFp) {
        missingFpWrites.push([fpKey, liveFp]);
        continue;
      }

      if (liveFp !== storedTabFp) {
        changedTabUrls.push(tab.url);
        if (!changeReason) {
          changeReason = `Rilevate modifiche per ${tab.name}`;
        }
      }
    }

    if (missingFpWrites.length > 0) {
      AsyncStorage.multiSet(missingFpWrites).catch(() => {});
    }

    if (changedTabUrls.length > 0) {
      return {
        hasChanges: true,
        reason: changeReason || 'Rilevate modifiche all\'orario o agli avvisi',
        changedTabUrls,
        preloadedHtmlByUrl,
      };
    }

    // Nessuna modifica rilevata: aggiorna timestamp di verifica per il cooldown di 1 min
    AsyncStorage.setItem(lastCheckKey, Date.now().toString()).catch(() => {});
    return { hasChanges: false };
  } catch (e) {
    console.warn('Verifica aggiornamenti saltata:', e);
    return { hasChanges: false };
  }
}


