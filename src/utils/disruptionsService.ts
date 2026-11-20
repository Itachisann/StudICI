import AsyncStorage from '@react-native-async-storage/async-storage';
import { DisruptionEvent, DisruptionCategory, DisruptionImpact } from '@/types/disruptions';
import { callGeminiJson } from './aiParser';

const DISRUPTIONS_CACHE_KEY = '@studici_disruptions_cache_v5';
const DISRUPTIONS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti
const LUCEVERDE_ARTICLES_CACHE_KEY = '@studici_luceverde_articles_cache_v3';
const LUCEVERDE_ARTICLES_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const ROMAMOBILITA_ARTICLES_CACHE_KEY = '@studici_romamobilita_articles_cache_v1';
const ROMAMOBILITA_ARTICLES_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const MIT_AI_ANALYSIS_CACHE_KEY = '@studici_mit_ai_analysis_cache_v3';
const MIT_AI_ANALYSIS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const DISRUPTIONS_HTTP_META_KEY = '@studici_disruptions_http_etags_v1';

function hashDisruptionSig(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        results[idx] = await worker(items[idx], idx);
      }
    })
  );
  return results;
}

interface HttpConditionalEntry {
  etag?: string;
  lastModified?: string;
  savedAt: number;
  cachedEvents?: DisruptionEvent[];
  cachedPosts?: any[];
}

const httpConditionalMetaCache = new Map<string, HttpConditionalEntry>();
let httpConditionalMetaLoaded = false;

async function ensureHttpConditionalMetaLoaded(): Promise<void> {
  if (httpConditionalMetaLoaded) return;
  httpConditionalMetaLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(DISRUPTIONS_HTTP_META_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries<HttpConditionalEntry>(parsed)) {
        if (v && typeof v.savedAt === 'number' && now - v.savedAt < 7 * 24 * 60 * 60 * 1000) {
          httpConditionalMetaCache.set(k, v);
        }
      }
    }
  } catch {}
}

let httpMetaPersistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistHttpConditionalMeta(): void {
  if (httpMetaPersistTimer) clearTimeout(httpMetaPersistTimer);
  httpMetaPersistTimer = setTimeout(() => {
    httpMetaPersistTimer = null;
    try {
      const payload: Record<string, HttpConditionalEntry> = {};
      for (const [k, v] of httpConditionalMetaCache.entries()) {
        payload[k] = v;
      }
      AsyncStorage.setItem(DISRUPTIONS_HTTP_META_KEY, JSON.stringify(payload)).catch(() => {});
    } catch {}
  }, 400);
}

function buildConditionalHeaders(
  baseHeaders: Record<string, string>,
  metaKey: string
): Record<string, string> {
  const entry = httpConditionalMetaCache.get(metaKey);
  if (!entry) return baseHeaders;
  const headers = { ...baseHeaders };
  if (entry.etag) headers['If-None-Match'] = entry.etag;
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  return headers;
}

function saveConditionalResponseMeta(
  metaKey: string,
  res: Response,
  payload: { cachedEvents?: DisruptionEvent[]; cachedPosts?: any[] }
): void {
  const etag = res.headers.get('etag') || res.headers.get('ETag') || undefined;
  const lastModified =
    res.headers.get('last-modified') || res.headers.get('Last-Modified') || undefined;
  if (!etag && !lastModified) return;
  httpConditionalMetaCache.set(metaKey, {
    etag,
    lastModified,
    savedAt: Date.now(),
    ...payload,
  });
  schedulePersistHttpConditionalMeta();
}

interface CachedMitAiAnalysis {
  timestamp: number;
  signature: string;
  aiImpactsPassengerService?: boolean;
  aiNonImpactReason?: string;
}

const romaMobilitaArticlesMemoryCache = new Map<string, CachedLuceverdeArticle>();
let romaMobilitaArticlesStorageLoaded = false;

async function ensureRomaMobilitaArticlesCacheLoaded(): Promise<void> {
  if (romaMobilitaArticlesStorageLoaded) return;
  romaMobilitaArticlesStorageLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(ROMAMOBILITA_ARTICLES_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries<CachedLuceverdeArticle>(parsed)) {
        if (v && v.event && typeof v.timestamp === 'number' && now - v.timestamp < ROMAMOBILITA_ARTICLES_TTL_MS) {
          romaMobilitaArticlesMemoryCache.set(k, v);
        }
      }
    }
  } catch {}
}

async function persistRomaMobilitaArticlesCache(): Promise<void> {
  try {
    const now = Date.now();
    const entries = Array.from(romaMobilitaArticlesMemoryCache.entries())
      .filter(([, val]) => now - val.timestamp < ROMAMOBILITA_ARTICLES_TTL_MS)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 60);
    const payload: Record<string, CachedLuceverdeArticle> = {};
    for (const [k, v] of entries) {
      payload[k] = v;
    }
    await AsyncStorage.setItem(ROMAMOBILITA_ARTICLES_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

const mitAiAnalysisMemoryCache = new Map<string, CachedMitAiAnalysis>();
let mitAiAnalysisStorageLoaded = false;

async function ensureMitAiAnalysisCacheLoaded(): Promise<void> {
  if (mitAiAnalysisStorageLoaded) return;
  mitAiAnalysisStorageLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(MIT_AI_ANALYSIS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries<CachedMitAiAnalysis>(parsed)) {
        if (v && typeof v.timestamp === 'number' && now - v.timestamp < MIT_AI_ANALYSIS_TTL_MS) {
          mitAiAnalysisMemoryCache.set(k, v);
        }
      }
    }
  } catch {}
}

async function persistMitAiAnalysisCache(): Promise<void> {
  try {
    const now = Date.now();
    const entries = Array.from(mitAiAnalysisMemoryCache.entries())
      .filter(([, val]) => now - val.timestamp < MIT_AI_ANALYSIS_TTL_MS)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 80);
    const payload: Record<string, CachedMitAiAnalysis> = {};
    for (const [k, v] of entries) {
      payload[k] = v;
    }
    await AsyncStorage.setItem(MIT_AI_ANALYSIS_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

interface CachedLuceverdeArticle {
  timestamp: number;
  title: string;
  event: DisruptionEvent;
}

const luceverdeArticlesMemoryCache = new Map<string, CachedLuceverdeArticle>();
let luceverdeArticlesStorageLoaded = false;

async function ensureLuceverdeArticlesCacheLoaded(): Promise<void> {
  if (luceverdeArticlesStorageLoaded) return;
  luceverdeArticlesStorageLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(LUCEVERDE_ARTICLES_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries<CachedLuceverdeArticle>(parsed)) {
        if (v && v.event && typeof v.timestamp === 'number' && now - v.timestamp < LUCEVERDE_ARTICLES_TTL_MS) {
          luceverdeArticlesMemoryCache.set(k, v);
        }
      }
    }
  } catch {}
}

async function persistLuceverdeArticlesCache(): Promise<void> {
  try {
    const now = Date.now();
    const entries = Array.from(luceverdeArticlesMemoryCache.entries())
      .filter(([, val]) => now - val.timestamp < LUCEVERDE_ARTICLES_TTL_MS)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 60);
    const payload: Record<string, CachedLuceverdeArticle> = {};
    for (const [k, v] of entries) {
      payload[k] = v;
    }
    await AsyncStorage.setItem(LUCEVERDE_ARTICLES_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

let memoryDisruptionsCache: { timestamp: number; data: DisruptionEvent[] } | null = null;
let inFlightDisruptionsPromise: Promise<DisruptionEvent[]> | null = null;
let inFlightForceDisruptionsPromise: Promise<DisruptionEvent[]> | null = null;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 7500
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const ITALIAN_MONTHS: Record<string, string> = {
  gennaio: '01',
  febbraio: '02',
  marzo: '03',
  aprile: '04',
  maggio: '05',
  giugno: '06',
  luglio: '07',
  agosto: '08',
  settembre: '09',
  ottobre: '10',
  novembre: '11',
  dicembre: '12',
};

/**
 * Converte una data "DD/MM/YYYY" in stringa ISO "YYYY-MM-DD"
 */
function parseDateItToIso(dStr: string): string {
  const parts = dStr.trim().split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return '';
}

/**
 * Estrae una data esplicita italiana ("2 novembre", "dal 3 al 14 novembre", "fino al 30 novembre")
 * senza ricorrere al fallback, ritornando null se non trovata.
 */
function extractExplicitDateFromText(
  text: string,
  fallbackIso?: string
): { startIso: string; endIso: string } | null {
  const clean = text.toLowerCase().replace(/°/g, ' ');
  const year = new Date().getFullYear();

  // Pattern "fino a [giorno] X mese" (es: "fino a mercoledì 11 novembre", "fino al 30 novembre")
  const finoMatch = clean.match(/fino\s+a(?:l|\s+[a-z]+)?\s+(\d{1,2})\s+([a-z]+)/);
  if (finoMatch) {
    const dEnd = finoMatch[1].padStart(2, '0');
    const mName = finoMatch[2];
    const mNum = ITALIAN_MONTHS[mName];
    if (mNum) {
      const defaultIso = fallbackIso ? fallbackIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
      return {
        startIso: defaultIso,
        endIso: `${year}-${mNum}-${dEnd}`,
      };
    }
  }

  // Pattern "da/tra [giorno] X [mese1] a/e [giorno] Y mese2"
  const multiMonthRangeMatch = clean.match(
    /(?:da|dal|dalla|tra)\s+(?:[a-z]+\s+)?(\d{1,2})(?:\s+([a-z]+))?\s+(?:a|al|alla|e)\s+(?:[a-z]+\s+)?(\d{1,2})\s+([a-z]+)/
  );
  if (multiMonthRangeMatch) {
    const dStart = multiMonthRangeMatch[1].padStart(2, '0');
    const mName1 = multiMonthRangeMatch[2];
    const dEnd = multiMonthRangeMatch[3].padStart(2, '0');
    const mName2 = multiMonthRangeMatch[4];
    const mNum2 = ITALIAN_MONTHS[mName2];
    const mNum1 = mName1 && ITALIAN_MONTHS[mName1] ? ITALIAN_MONTHS[mName1] : mNum2;
    if (mNum1 && mNum2) {
      return {
        startIso: `${year}-${mNum1}-${dStart}`,
        endIso: `${year}-${mNum2}-${dEnd}`,
      };
    }
  }

  // Pattern "X mese" (es: "2 novembre", "30 ottobre")
  const singleMatch = clean.match(/(\d{1,2})\s+([a-z]+)/);
  if (singleMatch) {
    const d = singleMatch[1].padStart(2, '0');
    const mName = singleMatch[2];
    const mNum = ITALIAN_MONTHS[mName];
    if (mNum) {
      const iso = `${year}-${mNum}-${d}`;
      return { startIso: iso, endIso: iso };
    }
  }

  return null;
}

/**
 * Cerca di estrarre una data italiana dal titolo della notizia di Luceverde
 * Es: "lunedì 2 novembre", "domenica 1°novembre", "dal 3 al 14 novembre",
 * "da mercoledì 4 a venerdì 6 novembre", "dal 28 ottobre al 15 novembre"
 */
function extractDateFromTitle(title: string, fallbackIso: string): { startIso: string; endIso: string } {
  const explicit = extractExplicitDateFromText(title, fallbackIso);
  if (explicit) return explicit;

  const defaultIso = fallbackIso ? fallbackIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return { startIso: defaultIso, endIso: defaultIso };
}

const ITALIAN_WEEKDAYS: Record<string, number> = {
  domenica: 0,
  lunedi: 1,
  lunedì: 1,
  martedi: 2,
  martedì: 2,
  mercoledi: 3,
  mercoledì: 3,
  giovedi: 4,
  giovedì: 4,
  venerdi: 5,
  venerdì: 5,
  sabato: 6,
};

/**
 * Risolve date esplicite o riferimenti relativi ("oggi", "domani", "domenica")
 * rispetto alla data di pubblicazione/aggiornamento dell'articolo Roma Mobilità.
 */
function extractDateFromRomaMobilitaText(
  title: string,
  plainText: string,
  slug: string,
  refIsoRaw: string
): { startIso: string; endIso: string } {
  const refIso = refIsoRaw ? refIsoRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // 1) Prima cerca una data esplicita con mese nel titolo, nel lead dell'articolo o nello slug
  const explicit = extractExplicitDateFromText(
    `${title} ${plainText.slice(0, 420)} ${slug.replace(/-/g, ' ')}`,
    refIso
  );
  if (explicit) return explicit;

  // 2) Riferimenti relativi ("oggi", "stamattina", "domani") nel titolo o attacco articolo
  const headLow = `${title} ${plainText.slice(0, 180)}`.toLowerCase();
  if (/\b(?:oggi|stamattina|stasera|stanotte)\b/.test(headLow)) {
    return { startIso: refIso, endIso: refIso };
  }
  if (/\bdomani\b/.test(headLow)) {
    const tomorrowIso = addDaysToIso(refIso, 1);
    return { startIso: tomorrowIso, endIso: tomorrowIso };
  }

  // 3) Giorno della settimana ("domenica mattina", "venerdì") proiettato a partire da refIso
  const weekdayMatch = headLow.match(
    /\b(domenica|luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato)\b/
  );
  if (weekdayMatch) {
    const targetDay = ITALIAN_WEEKDAYS[weekdayMatch[1]];
    const parts = refIso.split('-').map(Number);
    if (targetDay !== undefined && parts.length === 3) {
      const refDate = new Date(parts[0], parts[1] - 1, parts[2]);
      let diff = targetDay - refDate.getDay();
      if (diff < 0) diff += 7;
      const resolved = addDaysToIso(refIso, diff);
      return { startIso: resolved, endIso: resolved };
    }
  }

  return { startIso: refIso, endIso: refIso };
}

/**
 * Converte HTML WordPress (entità numeriche/nominative e tag) in testo pulito leggibile.
 */
function decodeHtmlEntitiesAndStripTags(html: string): string {
  if (!html) return '';
  const withNewlines = html
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const decoded = withNewlines
    .replace(/&#(\d+);/g, (_, num) => {
      const code = parseInt(num, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&agrave;/g, 'à')
    .replace(/&egrave;/g, 'è')
    .replace(/&eacute;/g, 'é')
    .replace(/&igrave;/g, 'ì')
    .replace(/&ograve;/g, 'ò')
    .replace(/&ugrave;/g, 'ù')
    .replace(/&Agrave;/g, 'À')
    .replace(/&Egrave;/g, 'È');

  return decoded
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface ParsedDisruptionSchedule {
  startDateIso: string;
  endDateIso: string;
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
  durationHours?: number;
  hasExplicitRange: boolean;
  hasStartTimeOnly: boolean;
  hasTimeWindow: boolean;
  isFullDay: boolean;
  isNocturnal: boolean;
}

export interface DailyDisruptionWindow {
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  hasExplicitClockBounds: boolean;
  schedule: ParsedDisruptionSchedule;
}

export interface TimeWindowMins {
  startMins: number;
  endMins: number;
}

function addDaysToIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatShortItDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

function resolveInlineDayMonthIso(
  dayRaw: string,
  monthRaw: string,
  yearRaw: string | undefined,
  refStartIso: string
): string {
  const d = dayRaw.padStart(2, '0');
  const m = monthRaw.padStart(2, '0');
  let yearNum = Number((refStartIso || '').slice(0, 4)) || new Date().getFullYear();

  if (yearRaw) {
    yearNum = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  } else if (refStartIso) {
    const refMonth = Number(refStartIso.slice(5, 7));
    const parsedMonth = Number(m);
    if (refMonth >= 11 && parsedMonth <= 2) {
      yearNum += 1;
    }
  }

  return `${yearNum}-${m}-${d}`;
}

function extractDurationHours(text: string): number | undefined {
  const regex = /(\d{1,3})\s*(?:ore|ora|h\b)(?![:.]\d{2})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const idx = match.index;
    const prefix = text.slice(Math.max(0, idx - 12), idx).toLowerCase();
    // Ignora riferimenti ad orari come "ore 21", "alle 16", "del 20"
    if (/(?:ore|alle|dalle|fino\s+a(?:lle)?)\s*$/.test(prefix)) {
      continue;
    }
    const hours = parseInt(match[1], 10);
    if (!isNaN(hours) && hours > 0 && hours <= 168) {
      return hours;
    }
  }
  return undefined;
}

function selectRelevantModalitaClause(
  text: string,
  category?: DisruptionCategory
): string {
  if (!text.includes(';')) return text;
  const parts = text
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  if (category === 'sciopero_treni') {
    const railClause = parts.find((p) => /ferrovi|fs\b|trenitalia|rfi|rotai/i.test(p));
    if (railClause) return railClause;
  } else if (category === 'sciopero_tpl') {
    const tplClause = parts.find((p) => /\btpl\b|pubblico locale|bus|metro|tram|atac|cotral/i.test(p));
    if (tplClause) return tplClause;
  }
  return parts[0];
}

/**
 * Estrae un'eventuale data esplicita singola ("DEL 21/11", "IL 21/11/2026") presente nella clausola specifica
 * di uno sciopero plurisettoriale/generale quando non c'è un range orario con date inline.
 */
function extractSingleClauseDateIso(clauseText: string, refStartIso: string): string | null {
  const m = clauseText.match(/(?:del|il|giorno)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (!m) return null;
  return resolveInlineDayMonthIso(m[1], m[2], m[3], refStartIso);
}

function stripGuaranteedBands(raw: string): string {
  return raw
    .replace(
      /(?:servizio\s+(?:sar[àa]\s+|è\s+)?(?:garantit[oa]|assicurat[oa])|fasce\s+(?:orarie\s+)?di\s+garanzia|fasce\s+garantite|corse\s+garantite|regolare\s+fino\s+alle)[^.;\n]*/gi,
      ' '
    )
    .replace(/\b(?:garantit[oeai]|tutela)\s+(?:fino\s+alle|dalle|tra\s+le)[^.;\n]*/gi, ' ');
}

/**
 * Analizza date effettive, orari e durata di uno sciopero o evento di mobilità
 * supportando fasce orarie su giorno singolo, multi-giorno (es. "23 ORE: DALLE 21.00 DEL 20/11 ALLE 20.00 DEL 21/11"),
 * durata da ora di inizio (es. "4 ORE: DALLE 09.00") ed eventi intera giornata.
 */
export function parseDisruptionSchedule(event: DisruptionEvent): ParsedDisruptionSchedule {
  const baseStartIso = event.startDate || new Date().toISOString().slice(0, 10);
  const baseEndIso = event.endDate && event.endDate >= baseStartIso ? event.endDate : baseStartIso;

  const isPureMit = event.sourceName === 'Ministero dei Trasporti (MIT)';
  const mitNotes = isPureMit
    ? selectRelevantModalitaClause(event.notes || '', event.category)
    : event.notes || '';

  const rawText = isPureMit
    ? `${mitNotes} ${event.timeWindow || ''} ${event.title || ''}`
    : `${event.timeWindow || ''} ${event.title || ''} ${mitNotes}`;
  const text =
    event.category === 'sciopero_treni' || event.category === 'sciopero_tpl'
      ? stripGuaranteedBands(rawText)
      : rawText;
  const lower = text.toLowerCase();

  const isStrikeCategory =
    event.category === 'sciopero_treni' || event.category === 'sciopero_tpl';

  const isExplicitNight =
    !isStrikeCategory &&
    (event.isNocturnal === true ||
      lower.includes('chiusura notturna') ||
      lower.includes('lavori notturni') ||
      lower.includes('manutenzione notturna') ||
      lower.includes('fascia oraria compresa tra le ore 22') ||
      lower.includes('fascia oraria compresa tra le 22') ||
      lower.includes('notturno') ||
      lower.includes('notturna') ||
      lower.includes('ore 22') ||
      lower.includes('ore 23') ||
      lower.includes('dalle 22') ||
      lower.includes('dalle 23'));

  const durationHours = extractDurationHours(text);

  // Uno sciopero TPL di 24 ore sul singolo giorno copre l'intera giornata di servizio (fatte salve le fasce di garanzia)
  if (
    event.category === 'sciopero_tpl' &&
    baseStartIso === baseEndIso &&
    (durationHours === 24 || /\b24\s*ore\b|intera\s+giornata/i.test(text))
  ) {
    const singleClauseIso = isPureMit
      ? extractSingleClauseDateIso(mitNotes, baseStartIso)
      : null;
    const resolvedIso = singleClauseIso || baseStartIso;
    return {
      startDateIso: resolvedIso,
      endDateIso: resolvedIso,
      startHour: 0,
      startMinute: 0,
      endHour: 24,
      endMinute: 0,
      durationHours: durationHours || 24,
      hasExplicitRange: false,
      hasStartTimeOnly: false,
      hasTimeWindow: false,
      isFullDay: true,
      isNocturnal: false,
    };
  }

  // 1) Intervallo completo con eventuali date inline ("DALLE 21.00 DEL 20/11 ALLE 20.00 DEL 21/11" o "09:01 - 17:00")
  const rangeRegex =
    /(?:dalle\s*(?:ore\s*)?|tra\s*le\s*(?:ore\s*)?|in\s*orario\s*|ore\s*)?([01]?\d|2[0-4])[:.]([0-5]\d)(?:\s*(?:del|di|il)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?|\s*\((\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\))?\s*(?:alle\s*(?:ore\s*)?|fino\s*a(?:lle)?\s*(?:ore\s*)?|\/|-|–|—|e\s*(?:le\s*ore\s*)?)\s*([01]?\d|2[0-4])[:.]([0-5]\d)(?:\s*(?:del|di|il)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?|\s*\((\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\))?/i;

  const rangeMatch = text.match(rangeRegex);
  if (rangeMatch) {
    const sH = parseInt(rangeMatch[1], 10);
    const sM = parseInt(rangeMatch[2], 10);
    const sDay = rangeMatch[3] || rangeMatch[6];
    const sMonth = rangeMatch[4] || rangeMatch[7];
    const sYear = rangeMatch[5] || rangeMatch[8];

    const eH = parseInt(rangeMatch[9], 10);
    const eM = parseInt(rangeMatch[10], 10);
    const eDay = rangeMatch[11] || rangeMatch[14];
    const eMonth = rangeMatch[12] || rangeMatch[15];
    const eYear = rangeMatch[13] || rangeMatch[16];

    const startDateIso =
      sDay && sMonth ? resolveInlineDayMonthIso(sDay, sMonth, sYear, baseStartIso) : baseStartIso;
    let endDateIso =
      eDay && eMonth ? resolveInlineDayMonthIso(eDay, eMonth, eYear, startDateIso) : baseEndIso;

    if (endDateIso < startDateIso) {
      endDateIso = startDateIso;
    }

    const startTotalMins = sH * 60 + sM;
    const endTotalMins = eH === 24 ? 1440 : eH * 60 + eM;

    if (startDateIso === endDateIso && endTotalMins < startTotalMins) {
      endDateIso = addDaysToIso(startDateIso, 1);
    }

    const isFullDayBounds =
      (startTotalMins <= 1 && endTotalMins >= 1439 && startDateIso === endDateIso) ||
      (durationHours === 24 && startTotalMins === 0 && endTotalMins >= 1439);

    const spansMultiDayDaytime =
      startDateIso !== endDateIso && (endTotalMins > 8 * 60 || addDaysToIso(startDateIso, 1) < endDateIso);

    const isNocturnal = isStrikeCategory
      ? false
      : isExplicitNight ||
        (!spansMultiDayDaytime &&
          ((startDateIso === endDateIso && sH >= 21) || (sH >= 20 && eH <= 7)));

    return {
      startDateIso,
      endDateIso,
      startHour: sH,
      startMinute: sM,
      endHour: eH === 24 ? 24 : eH,
      endMinute: eH === 24 ? 0 : eM,
      durationHours,
      hasExplicitRange: true,
      hasStartTimeOnly: false,
      hasTimeWindow: true,
      isFullDay: isFullDayBounds,
      isNocturnal,
    };
  }

  // 2) Solo orario di inizio ("dalle 21:00", "4 ORE: DALLE 09.00", "alle ore 16:00")
  const singleStartMatch = text.match(
    /(?:dalle\s*(?:ore\s*)?|a\s*partire\s*dalle\s*(?:ore\s*)?|alle\s*(?:ore\s*)?|inizio\s*(?:ore\s*)?|ore\s*)([01]?\d|2[0-4])[:.]([0-5]\d)(?:\s*(?:del|di|il)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/i
  );

  if (singleStartMatch) {
    const sH = parseInt(singleStartMatch[1], 10);
    const sM = parseInt(singleStartMatch[2], 10);
    const sDay = singleStartMatch[3];
    const sMonth = singleStartMatch[4];
    const sYear = singleStartMatch[5];

    const startDateIso =
      sDay && sMonth ? resolveInlineDayMonthIso(sDay, sMonth, sYear, baseStartIso) : baseStartIso;

    // Se è presente sia ora d'inizio che durata in ore (es. "4 ORE: DALLE 09.00" o "23 ORE: DALLE 21.00")
    if (durationHours !== undefined) {
      const totalEnd = sH * 60 + sM + durationHours * 60;
      const modDay = totalEnd % 1440;
      const dayOffset = modDay === 0 && totalEnd > 0 ? totalEnd / 1440 - 1 : Math.floor(totalEnd / 1440);
      const eH = modDay === 0 && totalEnd > 0 ? 24 : Math.floor(modDay / 60);
      const eM = modDay === 0 && totalEnd > 0 ? 0 : modDay % 60;
      const endDateIso = addDaysToIso(startDateIso, dayOffset);
      const isFullDayBounds = startDateIso === endDateIso && sH === 0 && sM <= 1 && eH === 24;
      const spansMultiDayDaytime = startDateIso !== endDateIso && eH > 8;

      return {
        startDateIso,
        endDateIso,
        startHour: sH,
        startMinute: sM,
        endHour: eH,
        endMinute: eM,
        durationHours,
        hasExplicitRange: true,
        hasStartTimeOnly: false,
        hasTimeWindow: true,
        isFullDay: isFullDayBounds,
        isNocturnal: isStrikeCategory
          ? false
          : isExplicitNight || (!spansMultiDayDaytime && sH >= 21),
      };
    }

    const endDateIso = baseEndIso >= startDateIso ? baseEndIso : startDateIso;
    return {
      startDateIso,
      endDateIso,
      startHour: sH,
      startMinute: sM,
      durationHours,
      hasExplicitRange: false,
      hasStartTimeOnly: true,
      hasTimeWindow: true,
      isFullDay: false,
      isNocturnal: isStrikeCategory ? false : isExplicitNight || sH >= 21,
    };
  }

  // 3) Solo orario di fine ("fino alle 20:00")
  const finoMatch = text.match(
    /fino\s*a(?:lle)?\s*(?:ore\s*)?([01]?\d|2[0-4])[:.]([0-5]\d)(?:\s*(?:del|di|il)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/i
  );
  if (finoMatch) {
    const eH = parseInt(finoMatch[1], 10);
    const eM = parseInt(finoMatch[2], 10);
    const eDay = finoMatch[3];
    const eMonth = finoMatch[4];
    const eYear = finoMatch[5];
    const endDateIso =
      eDay && eMonth ? resolveInlineDayMonthIso(eDay, eMonth, eYear, baseStartIso) : baseEndIso;

    return {
      startDateIso: baseStartIso,
      endDateIso: endDateIso >= baseStartIso ? endDateIso : baseStartIso,
      startHour: 0,
      startMinute: 0,
      endHour: eH === 24 ? 24 : eH,
      endMinute: eH === 24 ? 0 : eM,
      durationHours,
      hasExplicitRange: true,
      hasStartTimeOnly: false,
      hasTimeWindow: true,
      isFullDay: false,
      isNocturnal: isStrikeCategory ? false : isExplicitNight,
    };
  }

  // 4) Intera giornata / nessun orario orologio specifico
  const singleClauseIso =
    event.sourceName === 'Ministero dei Trasporti (MIT)'
      ? extractSingleClauseDateIso(mitNotes, baseStartIso)
      : null;
  const finalFullStartIso = singleClauseIso || baseStartIso;
  const finalFullEndIso = singleClauseIso || baseEndIso;

  return {
    startDateIso: finalFullStartIso,
    endDateIso: finalFullEndIso,
    startHour: 0,
    startMinute: 0,
    endHour: 24,
    endMinute: 0,
    durationHours,
    hasExplicitRange: false,
    hasStartTimeOnly: false,
    hasTimeWindow: false,
    isFullDay: true,
    isNocturnal: isStrikeCategory ? false : isExplicitNight,
  };
}

/**
 * Calcola la finestra oraria effettiva (in minuti 0..1440) in cui l'evento è attivo
 * nella specifica data `targetDateIso`. Ritorna `null` se l'evento non è attivo in quella data.
 */
export function getDisruptionActiveWindowForDate(
  event: DisruptionEvent,
  targetDateIso: string,
  fallbackSingleStartDurationMins?: number
): DailyDisruptionWindow | null {
  if (!targetDateIso) return null;
  const schedule = parseDisruptionSchedule(event);

  if (targetDateIso < schedule.startDateIso || targetDateIso > schedule.endDateIso) {
    return null;
  }

  if (schedule.isFullDay || (!schedule.hasExplicitRange && !schedule.hasStartTimeOnly)) {
    return {
      startMinuteOfDay: 0,
      endMinuteOfDay: 1440,
      hasExplicitClockBounds: false,
      schedule,
    };
  }

  const startMins = Math.min(1440, schedule.startHour * 60 + schedule.startMinute);
  const rawEndMins =
    schedule.endHour !== undefined
      ? Math.min(1440, schedule.endHour * 60 + (schedule.endMinute || 0))
      : undefined;

  if (schedule.startDateIso === schedule.endDateIso) {
    let endMinuteOfDay = 1440;
    if (rawEndMins !== undefined) {
      endMinuteOfDay = rawEndMins;
    } else if (fallbackSingleStartDurationMins !== undefined) {
      endMinuteOfDay = Math.min(1440, startMins + fallbackSingleStartDurationMins);
    }

    if (endMinuteOfDay <= startMins) {
      return null;
    }

    return {
      startMinuteOfDay: startMins,
      endMinuteOfDay,
      hasExplicitClockBounds: true,
      schedule,
    };
  }

  // Multi-giorno: inizio -> fine attraverso una o più mezzenotti
  if (targetDateIso === schedule.startDateIso) {
    if (startMins >= 1440) return null;
    return {
      startMinuteOfDay: startMins,
      endMinuteOfDay: 1440,
      hasExplicitClockBounds: true,
      schedule,
    };
  }

  if (targetDateIso < schedule.endDateIso) {
    return {
      startMinuteOfDay: 0,
      endMinuteOfDay: 1440,
      hasExplicitClockBounds: true,
      schedule,
    };
  }

  // Ultimo giorno: attivo da 00:00 fino all'orario di termine (se 00:00 -> già terminato allo scoccare della mezzanotte)
  const endMinuteOfDay = rawEndMins !== undefined ? rawEndMins : 1440;
  if (endMinuteOfDay <= 0) {
    return null;
  }

  return {
    startMinuteOfDay: 0,
    endMinuteOfDay,
    hasExplicitClockBounds: rawEndMins !== undefined,
    schedule,
  };
}

/**
 * Verifica se l'evento impatta una specifica finestra oraria (in minuti da mezzanotte) nella data indicata.
 */
export function doesDisruptionOverlapMinutesForDate(
  event: DisruptionEvent,
  targetDateIso: string,
  windowStartMins: number,
  windowEndMins: number,
  fallbackSingleStartDurationMins?: number
): boolean {
  const activeWin = getDisruptionActiveWindowForDate(
    event,
    targetDateIso,
    fallbackSingleStartDurationMins
  );
  if (!activeWin) return false;

  return (
    activeWin.startMinuteOfDay <= windowEndMins &&
    activeWin.endMinuteOfDay >= windowStartMins
  );
}

/**
 * Restituisce la stringa leggibile completa di orari e durata per la scheda nel modale
 * (senza troncamenti sulla dicitura MIT e compatibile anche con record già in cache).
 */
export function formatDisruptionModalTimeWindow(event: DisruptionEvent): string {
  const schedule = parseDisruptionSchedule(event);
  const startClock = formatClock(schedule.startHour, schedule.startMinute);
  const endClock =
    schedule.endHour !== undefined
      ? formatClock(schedule.endHour, schedule.endMinute || 0)
      : undefined;

  if (schedule.isFullDay) {
    const durStr = schedule.durationHours ? ` (${schedule.durationHours} ore)` : '';
    return schedule.startDateIso !== schedule.endDateIso
      ? `Intera prestazione (${formatShortItDate(schedule.startDateIso)} - ${formatShortItDate(schedule.endDateIso)})${durStr}`
      : `Intera giornata (00:00 - 24:00)${durStr}`;
  }

  if (schedule.hasExplicitRange && endClock) {
    const durStr = schedule.durationHours ? ` (${schedule.durationHours} ore)` : '';
    if (schedule.startDateIso !== schedule.endDateIso) {
      return `${startClock} (${formatShortItDate(schedule.startDateIso)}) - ${endClock} (${formatShortItDate(schedule.endDateIso)})${durStr}`;
    }
    return `${startClock} - ${endClock}${durStr}`;
  }

  if (schedule.hasStartTimeOnly) {
    const durStr = schedule.durationHours ? ` (${schedule.durationHours} ore)` : '';
    return `dalle ${startClock}${durStr}`;
  }

  return (event.timeWindow || '').trim();
}

/**
 * Restituisce un riepilogo compatto su riga singola per il banner dello sciopero ferroviario
 * nella schermata Viaggio/Orario, contestualizzato alla data selezionata.
 */
export function formatTrainStrikeBannerSummary(
  event: DisruptionEvent,
  targetDateIso?: string
): string {
  const scopeLabel =
    (event.scope || '').trim() ||
    event.title.replace(/^Sciopero\s*(Ferroviario)?\s*/i, '').replace(/[()]/g, '').trim() ||
    'Treni';

  const schedule = parseDisruptionSchedule(event);
  const dailyWin = targetDateIso ? getDisruptionActiveWindowForDate(event, targetDateIso) : null;
  let timeLabel = '';

  if (schedule.isFullDay) {
    timeLabel = schedule.durationHours === 24 ? 'Intera giornata (24h)' : 'Intera giornata';
  } else if (dailyWin && targetDateIso) {
    if (dailyWin.startMinuteOfDay === 0 && dailyWin.endMinuteOfDay === 1440) {
      timeLabel = schedule.durationHours ? `Tutto il giorno (${schedule.durationHours}h)` : 'Tutto il giorno';
    } else if (dailyWin.startMinuteOfDay > 0 && dailyWin.endMinuteOfDay === 1440 && schedule.startDateIso < schedule.endDateIso) {
      const sH = Math.floor(dailyWin.startMinuteOfDay / 60);
      const sM = dailyWin.startMinuteOfDay % 60;
      timeLabel = schedule.durationHours
        ? `dalle ${formatClock(sH, sM)} (${schedule.durationHours}h)`
        : `dalle ${formatClock(sH, sM)}`;
    } else if (dailyWin.startMinuteOfDay === 0 && dailyWin.endMinuteOfDay < 1440 && schedule.startDateIso < schedule.endDateIso) {
      const eH = Math.floor(dailyWin.endMinuteOfDay / 60);
      const eM = dailyWin.endMinuteOfDay % 60;
      timeLabel = `fino alle ${formatClock(eH, eM)}`;
    } else {
      const sH = Math.floor(dailyWin.startMinuteOfDay / 60);
      const sM = dailyWin.startMinuteOfDay % 60;
      const eH = Math.floor(dailyWin.endMinuteOfDay / 60);
      const eM = dailyWin.endMinuteOfDay % 60;
      if (schedule.hasStartTimeOnly && dailyWin.endMinuteOfDay === 1440) {
        timeLabel = `dalle ${formatClock(sH, sM)}`;
      } else {
        timeLabel = `${formatClock(sH, sM)} - ${formatClock(eH, eM)}`;
      }
    }
  } else if (schedule.hasExplicitRange && schedule.endHour !== undefined) {
    const base = `${formatClock(schedule.startHour, schedule.startMinute)} - ${formatClock(schedule.endHour, schedule.endMinute || 0)}`;
    timeLabel = schedule.durationHours ? `${base} (${schedule.durationHours}h)` : base;
  } else if (schedule.hasStartTimeOnly) {
    timeLabel = `dalle ${formatClock(schedule.startHour, schedule.startMinute)}`;
  }

  return timeLabel ? `${scopeLabel} · ${timeLabel}` : scopeLabel;
}

/**
 * Recupera gli scioperi ufficiali dal feed RSS del Ministero dei Trasporti (MIT)
 */
async function fetchOfficialStrikes(): Promise<{ events: DisruptionEvent[]; ok: boolean }> {
  try {
    await ensureHttpConditionalMetaLoaded();
    const metaKey = 'mit-rss';
    const baseHeaders = {
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    };
    const prevMeta = httpConditionalMetaCache.get(metaKey);
    const res = await fetchWithTimeout(
      'https://scioperi.mit.gov.it/mit2/public/scioperi/rss',
      {
        headers: prevMeta?.cachedEvents
          ? buildConditionalHeaders(baseHeaders, metaKey)
          : baseHeaders,
      },
      7500
    );
    if (res.status === 304 && prevMeta?.cachedEvents) {
      return { events: prevMeta.cachedEvents, ok: true };
    }
    if (!res.ok) return { events: [], ok: false };

    const xml = await res.text();
    const items = xml.split('<item>').slice(1);
    const strikes: DisruptionEvent[] = [];
    const todayD = new Date();
    const todayIso = `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, '0')}-${String(todayD.getDate()).padStart(2, '0')}`;

    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/);
      const descMatch = raw.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const desc = descMatch ? descMatch[1].trim() : '';

      const startMatch =
        title.match(/Data inizio:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) ||
        desc.match(/Data inizio:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
      const endMatch = desc.match(/Data fine:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
      const sectorMatch = title.match(/Settore:\s*([^-]+)/i) || desc.match(/Settore:\s*([^<]+)/i);
      const scopeMatch = title.match(/Rilevanza:\s*([^-]+)/i) || desc.match(/Rilevanza:\s*([^<]+)/i);
      const regionMatch = title.match(/Regione:\s*([^-]+)/i) || desc.match(/Regione:\s*([^<]+)/i);
      const modeMatch = desc.match(/modalit[àa]:\s*([^<]+)/i);
      const unionsMatch = desc.match(/Sindacati:\s*([^<]+)/i);
      const categoryMatch = desc.match(/Categoria interessata:\s*([^<]+)/i);

      const sector = sectorMatch ? sectorMatch[1].trim() : '';
      const scope = scopeMatch ? scopeMatch[1].trim() : 'Nazionale';
      const region = regionMatch ? regionMatch[1].trim() : '';
      const startDateRaw = startMatch ? startMatch[1] : '';
      const endDateRaw = endMatch ? endMatch[1] : startDateRaw;
      const modalitaStr = modeMatch ? modeMatch[1].trim() : '';
      const affectedCompanies = categoryMatch ? categoryMatch[1].trim() : '';
      const unionsStr = unionsMatch ? unionsMatch[1].trim() : '';

      const sectorLow = sector.toLowerCase();
      const combinedLow = `${sector} ${modalitaStr} ${affectedCompanies}`.toLowerCase();

      // Escludi scioperi generali che escludono esplicitamente il settore trasporti / trasporto passeggeri
      const excludesTransport =
        combinedLow.includes('escluso servizio trasporto passeggeri') ||
        combinedLow.includes('con esclusione settore trasporti') ||
        combinedLow.includes('con esclusione del settore trasporti') ||
        (combinedLow.includes('con esclusione trasporto ferroviario') &&
          combinedLow.includes('aziende tpl'));

      if (excludesTransport) continue;

      const isMultiOrGeneral =
        sectorLow.includes('plurisettoriale') || sectorLow.includes('generale');

      // Non considerare il settore "Trasporto merci" come sciopero ferroviario passeggeri
      const isRailSector =
        sectorLow.includes('ferrovi') && !sectorLow.includes('merci');
      const isTplSector =
        sectorLow.includes('pubblico locale') || sectorLow.includes('tpl');

      const clauseWithoutCargo = `${modalitaStr} ${affectedCompanies}`.replace(
        /trasporto\s+merci\s+su\s+rotaia|autotrasporto\s+merci|\bmerci\b\s+e\s+logistica|appalti\s+ferroviari/gi,
        ''
      );

      const mentionsRailInClause =
        isMultiOrGeneral &&
        /ferrovi|trenitalia|\brfi\b|gruppo fs|trasporto ferroviario/i.test(
          clauseWithoutCargo
        ) &&
        !/esclusione\s+trasporto\s+ferroviario/i.test(affectedCompanies);

      const mentionsTplInClause =
        isMultiOrGeneral &&
        /\btpl\b|trasporto pubblico locale|atac|cotral|bus|metro/i.test(
          `${modalitaStr} ${affectedCompanies}`
        ) &&
        !/esclusione[^<]*tpl/i.test(affectedCompanies);

      const hasRail = isRailSector || mentionsRailInClause;
      const hasTpl = isTplSector || mentionsTplInClause;

      const isRelevantGeo =
        region.toLowerCase().includes('lazio') ||
        region.toLowerCase().includes('roma') ||
        region.toLowerCase().includes('italia') ||
        scope.toLowerCase().includes('nazion') ||
        region.trim().length === 0;

      if ((hasRail || hasTpl) && isRelevantGeo) {
        const startIso = parseDateItToIso(startDateRaw);
        const endIso = parseDateItToIso(endDateRaw) || startIso;
        if (!startIso) continue;

        const categoriesToCreate: DisruptionCategory[] = [];
        if (hasRail) categoriesToCreate.push('sciopero_treni');
        if (hasTpl) categoriesToCreate.push('sciopero_tpl');

        for (const category of categoriesToCreate) {
          const isRailCat = category === 'sciopero_treni';
          const affectedModes: ('train' | 'transit' | 'walk')[] = isRailCat
            ? ['train']
            : ['transit', 'walk'];

          const displaySector = isMultiOrGeneral
            ? isRailCat
              ? `Ferroviario / ${sector}`
              : `Trasporto pubblico locale / ${sector}`
            : sector;

          const relevantClause = selectRelevantModalitaClause(modalitaStr, category);
          const stableContentKey = `${category}|${startIso}|${endIso}|${scope}|${affectedCompanies}|${relevantClause || modalitaStr}`;
          const stableHash = hashDisruptionSig(stableContentKey);

          const draftEvent: DisruptionEvent = {
            id: `mit-${category}-${startIso}-${stableHash}`,
            title: `Sciopero ${displaySector} (${scope})`,
            category,
            impact: 'high',
            startDate: startIso,
            endDate: endIso,
            formattedDateSpan:
              startDateRaw === endDateRaw ? startDateRaw : `${startDateRaw} - ${endDateRaw}`,
            timeWindow: '',
            scope,
            affectedModes,
            affectedCompanies,
            unions: unionsStr,
            notes: relevantClause || modalitaStr,
            sourceName: 'Ministero dei Trasporti (MIT)',
            sourceUrl: 'https://scioperi.mit.gov.it/mit2/public/scioperi',
          };

          const parsedSchedule = parseDisruptionSchedule(draftEvent);
          draftEvent.startDate = parsedSchedule.startDateIso;
          draftEvent.endDate = parsedSchedule.endDateIso;
          if (draftEvent.startDate === draftEvent.endDate) {
            const p = draftEvent.startDate.split('-');
            if (p.length === 3) {
              draftEvent.formattedDateSpan = `${p[2]}/${p[1]}/${p[0]}`;
            }
          }
          draftEvent.timeWindow = formatDisruptionModalTimeWindow(draftEvent);

          // Pre-filtra scioperi già scaduti prima di accodarli alla valutazione Gemini
          if (draftEvent.endDate && draftEvent.endDate < todayIso) {
            continue;
          }

          strikes.push(draftEvent);
        }
      }
    }

    await ensureMitAiAnalysisCacheLoaded();
    const uncachedStrikes: DisruptionEvent[] = [];
    const enrichedStrikes: DisruptionEvent[] = [];

    for (const st of strikes) {
      const sig = `${st.category}|${st.startDate}|${st.endDate}|${st.scope || ''}|${st.affectedCompanies || ''}|${st.notes || ''}`;
      const cacheKey = hashDisruptionSig(sig);
      const cached = mitAiAnalysisMemoryCache.get(cacheKey);
      if (
        cached &&
        cached.signature === sig &&
        Date.now() - cached.timestamp < MIT_AI_ANALYSIS_TTL_MS
      ) {
        enrichedStrikes.push({
          ...st,
          aiImpactsPassengerService: cached.aiImpactsPassengerService,
          aiNonImpactReason: cached.aiNonImpactReason,
        });
      } else {
        // Salta Gemini se le regole deterministiche escludono già con certezza lo sciopero (es. merci/Italo/altre regioni)
        const alreadyExcluded =
          (st.category === 'sciopero_treni' && !isTrainStrikeImpactingCommuter(st)) ||
          (st.category === 'sciopero_tpl' && !isTplStrikeImpactingRome(st));
        if (!alreadyExcluded) {
          uncachedStrikes.push(st);
        }
        enrichedStrikes.push(st);
      }
    }

    if (uncachedStrikes.length > 0) {
      const aiEvaluated = await evaluateMitStrikesImpactWithGemini(uncachedStrikes);
      const evalMap = new Map<string, DisruptionEvent>();
      const nowTs = Date.now();
      for (const ev of aiEvaluated) {
        evalMap.set(ev.id, ev);
        const sig = `${ev.category}|${ev.startDate}|${ev.endDate}|${ev.scope || ''}|${ev.affectedCompanies || ''}|${ev.notes || ''}`;
        const cacheKey = hashDisruptionSig(sig);
        mitAiAnalysisMemoryCache.set(cacheKey, {
          timestamp: nowTs,
          signature: sig,
          aiImpactsPassengerService: ev.aiImpactsPassengerService,
          aiNonImpactReason: ev.aiNonImpactReason,
        });
      }
      void persistMitAiAnalysisCache();

      for (let idx = 0; idx < enrichedStrikes.length; idx++) {
        const updated = evalMap.get(enrichedStrikes[idx].id);
        if (updated) {
          enrichedStrikes[idx] = updated;
        }
      }
    }

    saveConditionalResponseMeta(metaKey, res, { cachedEvents: enrichedStrikes });
    return { events: enrichedStrikes, ok: true };
  } catch (err) {
    console.warn('[Disruptions] Errore fetch MIT RSS:', err);
    return { events: [], ok: false };
  }
}

/**
 * Usa Gemini Flash Lite per valutare semanticamente se gli scioperi MIT estratti impattano davvero
 * la circolazione dei treni passeggeri del pendolare (Trenitalia/RFI/FS) o dei mezzi pubblici TPL di Roma (ATAC/Roma TPL/Cotral),
 * escludendo scioperi riservati al solo trasporto merci/cargo, appalti pulizie/ristorazione/uffici, taxi/NCC/marittimo/aereo o aziende di altre città.
 */
async function evaluateMitStrikesImpactWithGemini(
  strikes: DisruptionEvent[]
): Promise<DisruptionEvent[]> {
  if (!strikes || strikes.length === 0) return strikes;

  try {
    const payload = strikes.map((s) => ({
      id: s.id,
      category: s.category,
      title: s.title,
      scope: s.scope,
      affectedCompanies: s.affectedCompanies || '',
      unions: s.unions || '',
      notes: s.notes || '',
    }));

    const prompt = `Sei un analista esperto di trasporti per uno studente pendolare che viaggia in treno (Trenitalia Regionali/RV/IC su rete RFI verso Roma Tiburtina/Termini/Ostiense) e usa i mezzi pubblici urbani di Roma (ATAC, Roma TPL, Cotral: metro, bus, tram).
Valuta per ciascuno dei seguenti scioperi del Ministero dei Trasporti (MIT) se impatta REALMENTE la circolazione dei treni passeggeri o dei mezzi pubblici urbani del pendolare a Roma.

Regole tassative per "impactsCommuterService":
- Imposta "impactsCommuterService": FALSE nei seguenti casi che NON bloccano i viaggi del pendolare:
  1. Sciopero che riguarda ESCLUSIVAMENTE il trasporto merci / cargo su rotaia o gomma (es. Mercitalia Rail, Captrain, GTS Rail, Medway, DB Cargo, SBB Cargo, Sangritana Cargo, EVM Rail, TX Logistik, autotrasporto merci, logistica).
  2. Sciopero che riguarda ESCLUSIVAMENTE appalti accessori che non fermano la circolazione dei treni o dei bus: pulizie, sanificazione, ristorazione a bordo, facchinaggio, vigilanza privata, assistenza clienti/biglietterie/call center, personale amministrativo o d'ufficio, manutenzione impianti in ambiti territoriali lontani dal Lazio (es. DOIT Verona, Bari, Torino, Milano).
  3. Sciopero ferroviario che riguarda ESCLUSIVAMENTE Italo-NTV o ferrovie regionali di altre regioni (es. Trenord, EAV, Ferrovie del Sud Est, Ferrotramviaria, FNM, TPER, SAD).
  4. Sciopero TPL che riguarda ESCLUSIVAMENTE aziende di altre città/province fuori da Roma/Lazio o settori diversi dal TPL di linea (es. solo Taxi, solo NCC, solo scuolabus, solo trasporto marittimo/aereo/autostrade).
- Imposta "impactsCommuterService": TRUE se lo sciopero coinvolge il personale di macchina/bordo/circolazione Trenitalia, Gruppo FS, RFI (nazionale o Lazio) oppure il trasporto pubblico locale (TPL nazionale, Lazio o Roma ATAC/Cotral/Roma TPL) o uno sciopero generale/plurisettoriale che include la circolazione ferroviaria passeggeri o TPL.
- In "reason": se impactsCommuterService è false, scrivi una spiegazione brevissima in italiano del motivo (es. "Riguarda solo il trasporto merci", "Solo addetti appalti pulizie", "Solo personale Italo-NTV", "Riguarda altra regione"); altrimenti "".

Scioperi da valutare:
${JSON.stringify(payload)}

Rispondi rigorosamente SOLO con il JSON array valido nel formato:
[
  {
    "id": "string",
    "impactsCommuterService": boolean,
    "reason": "string"
  }
]`;

    const aiRes = await callGeminiJson(prompt, 6500);
    const parsed: any[] = JSON.parse(aiRes);
    if (!Array.isArray(parsed)) return strikes;

    const map = new Map<string, { impacts: boolean; reason: string }>();
    for (const item of parsed) {
      if (item && typeof item.id === 'string' && typeof item.impactsCommuterService === 'boolean') {
        map.set(item.id, {
          impacts: item.impactsCommuterService,
          reason: typeof item.reason === 'string' ? item.reason.trim() : '',
        });
      }
    }

    return strikes.map((s) => {
      const res = map.get(s.id);
      if (!res) return s;
      return {
        ...s,
        aiImpactsPassengerService: res.impacts,
        aiNonImpactReason: res.reason || undefined,
      };
    });
  } catch (err) {
    console.warn('[Disruptions] Fallback valutazione AI scioperi MIT:', err);
    return strikes;
  }
}

function parseLuceverdeComponentsToDetail(components: any[]): {
  text?: string;
  timeWindow?: string;
} | null {
  const paragraphs: string[] = [];

  for (const comp of components) {
    if (comp?.content?.raw?.children) {
      for (const ch of comp.content.raw.children) {
        const t = ch.children?.map((c: any) => c.text).join('') || '';
        const cleaned = t.replace(/Fonte_[^\n]+/g, '').trim();
        if (
          cleaned &&
          !cleaned.toLowerCase().includes('iscriviti') &&
          !cleaned.toLowerCase().includes('whatsapp')
        ) {
          paragraphs.push(cleaned);
        }
      }
    }
  }

  const fullText = paragraphs.join('\n\n').trim();
  if (!fullText) return null;

  let timeWindow = '';
  const hoursRangeMatch = fullText.match(
    /(?:dalle\s*ore\s*|in\s*orario\s*|tra\s*le\s*ore\s*)([0-9]{1,2}[:.][0-9]{2})\s*(?:alle\s*(?:ore\s*)?|\/|-)\s*([0-9]{1,2}[:.][0-9]{2})/i
  );
  if (hoursRangeMatch) {
    timeWindow = `${hoursRangeMatch[1].replace('.', ':')} - ${hoursRangeMatch[2].replace('.', ':')}`;
  } else {
    const singleHourMatch = fullText.match(
      /(?:dalle\s*ore\s*|alle\s*ore\s*|ore\s*)([0-9]{1,2}[:.][0-9]{2})/i
    );
    if (singleHourMatch) {
      timeWindow = `dalle ${singleHourMatch[1].replace('.', ':')}`;
    }
  }

  return {
    text: fullText,
    timeWindow,
  };
}

/**
 * Recupera l'articolo completo di dettaglio da Luceverde preferendo l'endpoint leggero
 * Next.js JSON (`/_next/data/<buildId>/articles/<id>.json`, ~10 KB) con fallback trasparente HTML.
 */
async function fetchLuceverdeArticleDetail(
  id: string,
  buildId?: string
): Promise<{
  text?: string;
  timeWindow?: string;
} | null> {
  if (buildId) {
    try {
      const jsonRes = await fetchWithTimeout(
        `https://roma.luceverde.it/_next/data/${encodeURIComponent(buildId)}/articles/${encodeURIComponent(id)}.json`,
        {
          headers: {
            Accept: 'application/json, */*',
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          },
        },
        4500
      );
      if (jsonRes.ok) {
        const jsonData = await jsonRes.json();
        const components = jsonData?.pageProps?.components || [];
        const parsed = parseLuceverdeComponentsToDetail(components);
        if (parsed) return parsed;
      }
    } catch {
      // Fallback trasparente ad HTML
    }
  }

  try {
    const res = await fetchWithTimeout(
      `https://roma.luceverde.it/articles/${id}`,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        },
      },
      5000
    );
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const components = data?.props?.pageProps?.components || [];
    return parseLuceverdeComponentsToDetail(components);
  } catch {
    return null;
  }
}

/**
 * Recupera le notizie di infomobilità e manifestazioni a Roma da Luceverde (Next.js data)
 */
async function fetchRomeMobilityEvents(): Promise<{ events: DisruptionEvent[]; ok: boolean }> {
  try {
    await ensureHttpConditionalMetaLoaded();
    const metaKey = 'luceverde-news';
    const baseHeaders = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    };
    const prevMeta = httpConditionalMetaCache.get(metaKey);
    const res = await fetchWithTimeout(
      'https://roma.luceverde.it/news',
      {
        headers: prevMeta?.cachedEvents
          ? buildConditionalHeaders(baseHeaders, metaKey)
          : baseHeaders,
      },
      7500
    );
    if (res.status === 304 && prevMeta?.cachedEvents) {
      return { events: prevMeta.cachedEvents, ok: true };
    }
    if (!res.ok) return { events: [], ok: false };

    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextMatch) return { events: [], ok: false };

    const nextData = JSON.parse(nextMatch[1]);
    const nextBuildId = typeof nextData?.buildId === 'string' ? nextData.buildId.trim() : '';
    const newsList: any[] = nextData?.props?.pageProps?.additionalData?.newsList || [];
    const events: DisruptionEvent[] = [];
    const todayD = new Date();
    const todayIso = `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, '0')}-${String(todayD.getDate()).padStart(2, '0')}`;

    const keywords = [
      'Verano',
      'Sapienza',
      'Termini',
      'Tiburtina',
      'Ostiense',
      'San Lorenzo',
      'Policlinico',
      'Castro Pretorio',
      'Barberini',
      'Piazza del Popolo',
      'Via Veneto',
      'Tangenziale Est',
      'Via Sistina',
      'Trinità dei Monti',
    ];

    for (let i = 0; i < newsList.length; i++) {
      const item = newsList[i];
      const title = (item.title || '').trim();
      const titleLower = title.toLowerCase();

      // Escludi rubriche editoriali generiche / rassegne prive di singole segnalazioni actionable
      const isGenericDigest =
        titleLower.includes('eventi della settimana') ||
        titleLower.includes('appuntamenti della settimana') ||
        titleLower.includes('cosa succede in citt') ||
        titleLower.includes('falsi siti') ||
        titleLower.includes('attenzione ai falsi') ||
        titleLower.includes('iscriviti') ||
        titleLower.includes('whatsapp') ||
        titleLower.includes('notiziario') ||
        titleLower.includes('bollettino');

      if (isGenericDigest) continue;

      // Identifica scioperi TPL, manifestazioni, cortei, presidi o eventi con impatto viario/pedonale
      const isScioperoTpl =
        titleLower.includes('sciopero') &&
        !titleLower.includes('aereo') &&
        !titleLower.includes('aeroport');
      const isManifestazione =
        titleLower.includes('manifestazi') ||
        titleLower.includes('corteo') ||
        titleLower.includes('presidio');
      const isBlocco =
        titleLower.includes('chiusura') ||
        titleLower.includes('blocco') ||
        titleLower.includes('deviaz') ||
        titleLower.includes('lavori') ||
        titleLower.includes('complanare') ||
        titleLower.includes('comizio');
      const isRelevantZone =
        titleLower.includes('verano') ||
        titleLower.includes('sapienza') ||
        titleLower.includes('termini') ||
        titleLower.includes('tiburtina') ||
        titleLower.includes('ostiense') ||
        titleLower.includes('san lorenzo') ||
        titleLower.includes('policlinico') ||
        titleLower.includes('castro pretorio') ||
        titleLower.includes('centro') ||
        titleLower.includes('barberini') ||
        titleLower.includes('popolo') ||
        titleLower.includes('veneto') ||
        titleLower.includes('esquilino') ||
        titleLower.includes('tangenziale');

      // Se non è né uno sciopero né una manifestazione né un blocco/evento in zona rilevante, saltiamo
      if (!isScioperoTpl && !isManifestazione && !isBlocco && !isRelevantZone) continue;

      const { startIso, endIso } = extractDateFromTitle(title, item.newsTimeUTC || '');

      // Pre-filtra notizie già scadute prima di scaricare il corpo dell'articolo o invocare Gemini
      if (endIso && endIso < todayIso) continue;

      // Pre-filtra chiusure puramente notturne o esclusivamente su GRA/autostrade prive di riferimenti urbani Sapienza
      const isClearlyNocturnalOrGra =
        !isScioperoTpl &&
        (titleLower.includes('chiusura notturna') ||
          titleLower.includes('lavori notturni') ||
          titleLower.includes('manutenzione notturna') ||
          ((/\bg\.?r\.?a\.?\b/.test(titleLower) ||
            titleLower.includes('grande raccordo') ||
            titleLower.includes('autostrada')) &&
            !titleLower.includes('verano') &&
            !titleLower.includes('sapienza') &&
            !titleLower.includes('san lorenzo')));
      if (isClearlyNocturnalOrGra) continue;

      let category: DisruptionCategory = 'cantiere_viabilita';
      let impact: DisruptionImpact = 'medium';
      const affectedModes: ('train' | 'transit' | 'walk')[] = ['walk'];

      if (isScioperoTpl) {
        category = 'sciopero_tpl';
        impact = 'high';
        affectedModes.push('transit');
      } else if (isManifestazione) {
        category = 'manifestazione';
        impact = 'high';
        affectedModes.push('transit');
      } else if (
        titleLower.includes('chiusura') ||
        titleLower.includes('blocco') ||
        titleLower.includes('deviaz')
      ) {
        category = 'blocco_stradale';
        affectedModes.push('transit');
      } else {
        category = 'cantiere_viabilita';
        impact = 'info';
      }

      // Estrai aree menzionate nel titolo
      const areas: string[] = [];
      for (const kw of keywords) {
        if (titleLower.includes(kw.toLowerCase())) {
          areas.push(kw);
        }
      }

      // Format date span
      const startParts = startIso.split('-');
      const endParts = endIso.split('-');
      let formattedSpan = '';
      if (startIso !== endIso && endParts.length === 3 && startParts.length === 3) {
        formattedSpan = `Dal ${startParts[2]}/${startParts[1]} al ${endParts[2]}/${endParts[1]}/${endParts[0]}`;
      } else if (startParts.length === 3) {
        formattedSpan = `${startParts[2]}/${startParts[1]}/${startParts[0]}`;
      } else {
        formattedSpan = startIso;
      }

      events.push({
        id: item.id || `lv-${startIso}-${i}`,
        title,
        category,
        impact,
        startDate: startIso,
        endDate: endIso,
        formattedDateSpan: formattedSpan,
        scope: 'Roma',
        affectedModes,
        affectedAreas: areas,
        sourceName: 'Luceverde Roma',
        sourceUrl: 'https://roma.luceverde.it/news',
      });
    }

    await ensureLuceverdeArticlesCacheLoaded();
    const cachedEventsMap = new Map<string, DisruptionEvent>();
    const uncachedDrafts: DisruptionEvent[] = [];

    for (const ev of events) {
      const cacheEntry = ev.id ? luceverdeArticlesMemoryCache.get(ev.id) : undefined;
      if (
        cacheEntry &&
        cacheEntry.title === ev.title &&
        Date.now() - cacheEntry.timestamp < LUCEVERDE_ARTICLES_TTL_MS
      ) {
        cachedEventsMap.set(ev.id, cacheEntry.event);
      } else {
        uncachedDrafts.push(ev);
      }
    }

    if (uncachedDrafts.length > 0) {
      // Arricchimento asincrono dei dettagli dal corpo dei soli nuovi articoli con concorrenza limitata (max 5)
      const detailedNewEvents = await runWithConcurrency(
        uncachedDrafts,
        5,
        async (ev) => {
          if (!ev.id || !ev.id.startsWith('piattaforma-')) {
            return ev;
          }
          try {
            const detail = await fetchLuceverdeArticleDetail(ev.id, nextBuildId);
            if (!detail) return ev;

            const updatedNotes = detail.text || ev.notes;
            const updatedTime = detail.timeWindow || ev.timeWindow;

            const extraAreas = [...(ev.affectedAreas || [])];
            for (const kw of keywords) {
              if (!extraAreas.includes(kw) && detail.text?.toLowerCase().includes(kw.toLowerCase())) {
                extraAreas.push(kw);
              }
            }

            return {
              ...ev,
              notes: updatedNotes,
              timeWindow: updatedTime,
              affectedAreas: extraAreas,
            };
          } catch {
            return ev;
          }
        }
      );

      // Raffinamento intelligente date (da DATA a DATA) e orari con Gemini Flash Lite solo sui nuovi articoli
      const aiEnrichedNew = await enrichEventsWithGemini(detailedNewEvents);
      const nowTs = Date.now();
      for (const enriched of aiEnrichedNew) {
        cachedEventsMap.set(enriched.id, enriched);
        if (enriched.id) {
          luceverdeArticlesMemoryCache.set(enriched.id, {
            timestamp: nowTs,
            title: enriched.title,
            event: enriched,
          });
        }
      }
      void persistLuceverdeArticlesCache();
    }

    const finalEvents = events.map((ev) => cachedEventsMap.get(ev.id) || ev);
    saveConditionalResponseMeta(metaKey, res, { cachedEvents: finalEvents });

    return { events: finalEvents, ok: true };
  } catch (err) {
    console.warn('[Disruptions] Errore fetch Luceverde Roma:', err);
    return { events: [], ok: false };
  }
}

/**
 * Tronca un testo informativo lungo in modo leggibile rispettando i confini di frase/parola.
 */
function summarizeArticleBody(plainText: string, maxLen = 920): string {
  const cleaned = plainText.trim();
  if (cleaned.length <= maxLen) return cleaned;
  const slice = cleaned.slice(0, maxLen);
  const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
  if (lastPeriod > maxLen * 0.55) {
    return slice.slice(0, lastPeriod + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/**
 * Recupera avvisi ufficiali di mobilità, scioperi TPL ATAC/Cotral, manifestazioni e deviazioni bus
 * dalle API WordPress pubbliche di Roma Servizi per la Mobilità (romamobilita.it).
 */
async function fetchRomaMobilitaEvents(): Promise<{ events: DisruptionEvent[]; ok: boolean }> {
  try {
    await ensureHttpConditionalMetaLoaded();
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const fourteenDaysAgoIso = `${addDaysToIso(todayIso, -14)}T00:00:00`;

    const endpoints: { key: string; url: string }[] = [
      {
        key: 'rm-primo-piano',
        url: `https://romamobilita.it/wp-json/wp/v2/primo-piano?per_page=10&modified_after=${fourteenDaysAgoIso}&_fields=id,date,modified,slug,link,title,content`,
      },
      {
        key: 'rm-comunicato',
        url: `https://romamobilita.it/wp-json/wp/v2/comunicato?per_page=8&modified_after=${fourteenDaysAgoIso}&_fields=id,date,modified,slug,link,title,content`,
      },
      {
        key: 'rm-infomobilita',
        url: `https://romamobilita.it/wp-json/wp/v2/infomobilita?per_page=15&modified_after=${fourteenDaysAgoIso}&_fields=id,date,modified,slug,link,title,content`,
      },
    ];

    const baseHeaders = {
      Accept: 'application/json, */*',
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    };

    const responses = await Promise.allSettled(
      endpoints.map(async (ep) => {
        const prevMeta = httpConditionalMetaCache.get(ep.key);
        const res = await fetchWithTimeout(
          ep.url,
          {
            headers: prevMeta?.cachedPosts
              ? buildConditionalHeaders(baseHeaders, ep.key)
              : baseHeaders,
          },
          7500
        );
        return { key: ep.key, res, prevMeta };
      })
    );

    const rawPosts: any[] = [];
    let anyEndpointOk = false;
    const seenPostIds = new Set<number>();

    for (const r of responses) {
      if (r.status === 'fulfilled') {
        const { key, res, prevMeta } = r.value;
        if (res.status === 304 && Array.isArray(prevMeta?.cachedPosts)) {
          anyEndpointOk = true;
          for (const post of prevMeta.cachedPosts) {
            if (post && typeof post.id === 'number' && !seenPostIds.has(post.id)) {
              seenPostIds.add(post.id);
              rawPosts.push(post);
            }
          }
          continue;
        }
        if (res.ok) {
          anyEndpointOk = true;
          try {
            const json = await res.json();
            if (Array.isArray(json)) {
              saveConditionalResponseMeta(key, res, { cachedPosts: json });
              for (const post of json) {
                if (post && typeof post.id === 'number' && !seenPostIds.has(post.id)) {
                  seenPostIds.add(post.id);
                  rawPosts.push(post);
                }
              }
            }
          } catch {}
        }
      }
    }

    if (!anyEndpointOk) return { events: [], ok: false };

    const yesterdayIso = addDaysToIso(todayIso, -1);

    const areaKeywords = [
      'Verano',
      'Sapienza',
      'Termini',
      'Tiburtina',
      'Ostiense',
      'San Lorenzo',
      'Policlinico',
      'Castro Pretorio',
      'Centro',
      'Esquilino',
      'Piazza Vittorio',
      'Fori Imperiali',
      'Tridente',
      'Piazza del Popolo',
      'Tangenziale Est',
      'Garbatella',
    ];

    const draftEvents: { event: DisruptionEvent; cacheSig: string }[] = [];

    for (const item of rawPosts) {
      const title = decodeHtmlEntitiesAndStripTags(item.title?.rendered || '');
      if (!title) continue;
      const plainText = decodeHtmlEntitiesAndStripTags(item.content?.rendered || '');
      const slug = String(item.slug || '');
      const titleLow = title.toLowerCase();

      // Salta avvisi di ripristino / revoca / rinvio (nessun disservizio attivo)
      const isResolvedOrRevoked =
        titleLow.includes('riaperta') ||
        titleLow.includes('riaperto') ||
        titleLow.includes('percorso regolare') ||
        titleLow.includes('percorso di nuovo regolare') ||
        titleLow.includes('normali percorsi') ||
        titleLow.includes('ripristinat') ||
        titleLow.includes('differito ad altra data') ||
        titleLow.includes('servizio regolare nei trasporti') ||
        titleLow.includes('revocato') ||
        titleLow.includes('revocata') ||
        titleLow.includes('revocati') ||
        titleLow.includes('annullato lo sciopero') ||
        titleLow.includes('sospeso lo sciopero');

      // Salta notizie istituzionali / infrastrutturali non actionable come disservizi giornalieri
      const isEditorialNews =
        titleLow.includes('premiata') ||
        titleLow.includes('premiato') ||
        titleLow.includes('attraversamenti pedonali') ||
        titleLow.includes('piste ciclabili') ||
        titleLow.includes('nuovi impianti') ||
        titleLow.includes('aperto il nuovo accesso') ||
        titleLow.includes('terminerà entro l') ||
        titleLow.includes('cronoprogramma degli interventi') ||
        titleLow.includes('webinar') ||
        titleLow.includes('bando') ||
        titleLow.includes('selezione') ||
        titleLow.includes('concorso') ||
        titleLow.includes('nuove strade scolastiche');

      if (isResolvedOrRevoked || isEditorialNews) continue;

      const isScioperoTpl =
        titleLow.includes('sciopero') &&
        !titleLow.includes('aereo') &&
        !titleLow.includes('aeroport') &&
        !titleLow.includes('taxi');
      const isManifestazione =
        titleLow.includes('manifestazi') ||
        titleLow.includes('corteo') ||
        titleLow.includes('presidio') ||
        titleLow.includes('parade') ||
        titleLow.includes('cerimonia') ||
        titleLow.includes('evento sportivo') ||
        titleLow.includes('gara podistica') ||
        titleLow.includes('corsa') ||
        titleLow.includes('corri');
      const isBlocco =
        titleLow.includes('chiusur') ||
        titleLow.includes('blocco') ||
        titleLow.includes('deviaz') ||
        titleLow.includes('modifiche di viabilit') ||
        titleLow.includes('modifiche alla viabilit') ||
        titleLow.includes('limitazioni al traffico') ||
        titleLow.includes('divieti di sosta') ||
        titleLow.includes('lavori') ||
        titleLow.includes('manutenzione');

      if (!isScioperoTpl && !isManifestazione && !isBlocco) continue;

      const refDateIso = (item.modified || item.date || todayIso).slice(0, 10);
      const { startIso, endIso } = extractDateFromRomaMobilitaText(
        title,
        plainText,
        slug,
        refDateIso
      );

      // Salta subito notizie già concluse nel passato prima di invocare Gemini
      if (endIso < yesterdayIso) continue;

      let category: DisruptionCategory = 'cantiere_viabilita';
      let impact: DisruptionImpact = 'medium';
      const affectedModes: ('train' | 'transit' | 'walk')[] = ['walk'];

      if (isScioperoTpl) {
        category = 'sciopero_tpl';
        impact = 'high';
        affectedModes.push('transit');
      } else if (isManifestazione) {
        category = 'manifestazione';
        impact = 'high';
        affectedModes.push('transit');
      } else if (
        titleLow.includes('chiusur') ||
        titleLow.includes('blocco') ||
        titleLow.includes('deviaz') ||
        titleLow.includes('modifiche di viabilit') ||
        titleLow.includes('divieti di sosta')
      ) {
        category = 'blocco_stradale';
        affectedModes.push('transit');
      } else {
        category = 'cantiere_viabilita';
        impact = 'info';
      }

      const scanAreasText = `${title} ${plainText.slice(0, 800)}`.toLowerCase();
      const areas: string[] = [];
      for (const kw of areaKeywords) {
        if (scanAreasText.includes(kw.toLowerCase())) {
          areas.push(kw);
        }
      }

      const startParts = startIso.split('-');
      const endParts = endIso.split('-');
      let formattedSpan = startIso;
      if (startIso !== endIso && startParts.length === 3 && endParts.length === 3) {
        formattedSpan = `Dal ${startParts[2]}/${startParts[1]} al ${endParts[2]}/${endParts[1]}/${endParts[0]}`;
      } else if (startParts.length === 3) {
        formattedSpan = `${startParts[2]}/${startParts[1]}/${startParts[0]}`;
      }

      let initialTimeWindow = '';
      if (!isScioperoTpl) {
        const normT = (t: string) => {
          const clean = t.replace(/[.,]/g, ':');
          if (clean.includes(':')) {
            const [h, m] = clean.split(':');
            return `${h.padStart(2, '0')}:${m}`;
          }
          return `${clean.padStart(2, '0')}:00`;
        };
        const rangeM = plainText.match(
          /(?:dalle\s*(?:ore\s*)?|tra\s*le\s*(?:ore\s*)?)([0-9]{1,2}(?:[:.,][0-9]{2})?)\s*(?:alle|e\s*le)\s*(?:ore\s*)?([0-9]{1,2}(?:[:.,][0-9]{2})?)/i
        );
        if (rangeM) {
          initialTimeWindow = `${normT(rangeM[1])} - ${normT(rangeM[2])}`;
        } else {
          const singleStartM = plainText.match(
            /(?:partir[àa]\s+alle|dalle\s*(?:ore\s*)?|a\s+partire\s+dalle\s*(?:ore\s*)?)\s*([0-9]{1,2}(?:[:.,][0-9]{2})?)\b/i
          );
          if (singleStartM) {
            initialTimeWindow = `dalle ${normT(singleStartM[1])}`;
          }
        }
      }

      const notesSummary = summarizeArticleBody(plainText, 1250);
      const companies = isScioperoTpl
        ? 'Rete ATAC, operatori privati TPL, Metromare, Roma-Nord e Cotral'
        : undefined;

      const draft: DisruptionEvent = {
        id: `rm-${item.id}`,
        title,
        category,
        impact,
        startDate: startIso,
        endDate: endIso,
        formattedDateSpan: formattedSpan,
        timeWindow: initialTimeWindow,
        scope: 'Roma',
        affectedModes,
        affectedCompanies: companies,
        affectedAreas: areas,
        notes: notesSummary,
        sourceName: 'Roma Mobilità',
        sourceUrl: typeof item.link === 'string' && item.link ? item.link : 'https://romamobilita.it',
      };

      if (isScioperoTpl) {
        draft.timeWindow = formatDisruptionModalTimeWindow(draft);
      }

      draftEvents.push({
        event: draft,
        cacheSig: `${title}|${item.modified || item.date || ''}`,
      });
    }

    await ensureRomaMobilitaArticlesCacheLoaded();
    const cachedEventsMap = new Map<string, DisruptionEvent>();
    const uncachedDrafts: DisruptionEvent[] = [];
    const sigById = new Map<string, string>();

    for (const { event: ev, cacheSig } of draftEvents) {
      sigById.set(ev.id, cacheSig);
      const cacheEntry = romaMobilitaArticlesMemoryCache.get(ev.id);
      if (
        cacheEntry &&
        cacheEntry.title === cacheSig &&
        Date.now() - cacheEntry.timestamp < ROMAMOBILITA_ARTICLES_TTL_MS
      ) {
        cachedEventsMap.set(ev.id, cacheEntry.event);
      } else {
        uncachedDrafts.push(ev);
      }
    }

    if (uncachedDrafts.length > 0) {
      const aiEnrichedNew = await enrichEventsWithGemini(uncachedDrafts);
      const nowTs = Date.now();
      for (const enriched of aiEnrichedNew) {
        cachedEventsMap.set(enriched.id, enriched);
        romaMobilitaArticlesMemoryCache.set(enriched.id, {
          timestamp: nowTs,
          title: sigById.get(enriched.id) || enriched.title,
          event: enriched,
        });
      }
      void persistRomaMobilitaArticlesCache();
    }

    const finalEvents = draftEvents.map(({ event: ev }) => cachedEventsMap.get(ev.id) || ev);
    return { events: finalEvents, ok: true };
  } catch (err) {
    console.warn('[Disruptions] Errore fetch Roma Mobilità:', err);
    return { events: [], ok: false };
  }
}

/**
 * Usa Gemini Flash Lite per verificare e raffinare date (da DATA a DATA), orari precisi
 * e fasce notturne delle segnalazioni di mobilità (Luceverde Roma e Roma Mobilità), gestendo qualsiasi pattern naturale italiano.
 */
async function enrichEventsWithGemini(events: DisruptionEvent[]): Promise<DisruptionEvent[]> {
  if (!events || events.length === 0) return events;

  try {
    const payload = events.map((ev) => ({
      id: ev.id,
      source: ev.sourceName,
      category: ev.category,
      refDate: ev.startDate,
      title: ev.title,
      text: ev.notes ? ev.notes.slice(0, 1100) : '',
    }));

    const currentYear = new Date().getFullYear();
    const todayIso = new Date().toISOString().slice(0, 10);

    const prompt = `Sei l'assistente per la mobilità a Roma di uno studente pendolare che si sposta tra le stazioni ferroviarie di Roma (Roma Tiburtina, Roma Termini, Roma Ostiense) e le sedi dell'Università La Sapienza / Policlinico / San Lorenzo / Piazzale del Verano / Via Tiburtina / Viale Regina Elena / Via del Castro Laurenziano / Castro Pretorio (a piedi o con mezzi pubblici ATAC: bus, tram, metro B — in particolare linee 71, 163, 310, 492, 495, 545, 649, 19, 3, Metro B).
Analizza le seguenti segnalazioni di mobilità provenienti da Luceverde Roma e Roma Mobilità ed estrai per ciascuna le date, gli orari reali e se l'evento impatta concretamente i viaggi verso le sedi universitarie Sapienza.
Anno di riferimento: ${currentYear}, oggi è ${todayIso}.

Regole tassative di estrazione:
- "startDate" e "endDate": date in formato ISO "YYYY-MM-DD".
  - Se è un intervallo (es. "dal 3 al 14 novembre", "tra il 23 e il 28 novembre", "da mercoledì 4 a venerdì 6 novembre"), estrai la data iniziale in startDate e la data finale in endDate.
  - Se riguarda un solo giorno (es. "venerdì 20 novembre", "domenica 22 novembre"), startDate ed endDate devono coincidere.
  - Se il testo usa riferimenti relativi come "oggi", "domani" o "domenica" senza data esplicita, usa "refDate" come ancora affidabile.
  - Se è indicato "fino a [data]", startDate è "${todayIso}" (o la data di inizio citata nel testo) e endDate è quella data finale.
- "timeWindow": orario sintetico es. "dalle 16:00", "08:30 - 13:00", "22:00 - 06:00", oppure "" se dura tutto il giorno.
  - ATTENZIONE per gli scioperi TPL di 24 ore (category="sciopero_tpl"): lascia "timeWindow": "" (NON mettere mai le fasce di garanzia come orario dello sciopero!).
- "isNocturnal": true SOLO se l'evento/chiusura si svolge esclusivamente in orario notturno (es. "chiusura notturna", "lavori notturni", "manutenzione notturna", "fascia compresa tra le 22:00 e le 06:00", dalle 22 in poi), false altrimenti.
- "affectedAreas": quartieri o zone citate (es. ["Verano", "Tiburtina", "San Lorenzo", "Centro"]).
- "impactsCommuterCorridor": true SOLO se:
  1. È uno sciopero cittadino dei mezzi TPL/ATAC/Cotral a Roma (category="sciopero_tpl"), OPPURE
  2. La manifestazione/corteo/chiusura impatta le strade tra le stazioni (Tiburtina, Termini, Ostiense) e le sedi Sapienza / Verano / San Lorenzo / Policlinico / Castro Laurenziano / Regina Elena / Castro Pretorio, OPPURE devia linee ATAC usate dal pendolare Sapienza (es. 71, 163, 310, 492, 495, 545, 649, 19, 3, Metro B).
  Imposta FALSE se riguarda cantieri stradali periferici (es. Ostia, Prima Porta, Colli Aniene/IV Municipio come "Corri al Tiburtino", GRA/Raccordo Anulare), lavori puramente notturni (es. Tangenziale Est / Ponte Spizzichino di notte) o quartieri lontani che non interferiscono col tragitto universitario né con quelle linee bus.
- "reason": se impactsCommuterCorridor è false, spiega in poche parole il motivo (es. "Zona fuori dal tragitto universitario", "Cantiere periferico verso il GRA", "Lavori in orario notturno"); altrimenti "".

Segnalazioni:
${JSON.stringify(payload)}

Rispondi rigorosamente SOLO con il JSON array valido nel formato:
[
  {
    "id": "string",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "timeWindow": "string",
    "isNocturnal": boolean,
    "affectedAreas": ["string"],
    "impactsCommuterCorridor": boolean,
    "reason": "string"
  }
]`;

    const aiRes = await callGeminiJson(prompt, 6500);
    const parsed: any[] = JSON.parse(aiRes);
    if (!Array.isArray(parsed)) return events;

    const parsedMap = new Map<string, any>();
    for (const p of parsed) {
      if (p && p.id) parsedMap.set(p.id, p);
    }

    return events.map((ev) => {
      const ai = parsedMap.get(ev.id);
      if (!ai) return ev;

      const startIso =
        typeof ai.startDate === 'string' && ai.startDate.length === 10
          ? ai.startDate
          : ev.startDate;
      const endIso =
        typeof ai.endDate === 'string' && ai.endDate.length === 10
          ? ai.endDate
          : ev.endDate;
      const aiTimeRaw = typeof ai.timeWindow === 'string' ? ai.timeWindow.trim() : '';
      const isFullDayTpl =
        ev.category === 'sciopero_tpl' && parseDisruptionSchedule(ev).isFullDay;
      const timeWindow =
        !isFullDayTpl && aiTimeRaw && !/garantit|garanzia/i.test(aiTimeRaw)
          ? aiTimeRaw
          : ev.timeWindow;
      const isNocturnal =
        typeof ai.isNocturnal === 'boolean' ? ai.isNocturnal : ev.isNocturnal;
      const aiImpacts =
        typeof ai.impactsCommuterCorridor === 'boolean'
          ? ai.impactsCommuterCorridor
          : ev.aiImpactsPassengerService;
      const aiReason =
        typeof ai.reason === 'string' && ai.reason.trim()
          ? ai.reason.trim()
          : ev.aiNonImpactReason;

      const mergedAreas = [...(ev.affectedAreas || [])];
      if (Array.isArray(ai.affectedAreas)) {
        for (const a of ai.affectedAreas) {
          if (typeof a === 'string' && a && !mergedAreas.includes(a)) {
            mergedAreas.push(a);
          }
        }
      }

      const startParts = startIso.split('-');
      const endParts = endIso.split('-');
      let formattedSpan = ev.formattedDateSpan;
      if (startIso !== endIso && startParts.length === 3 && endParts.length === 3) {
        formattedSpan = `Dal ${startParts[2]}/${startParts[1]} al ${endParts[2]}/${endParts[1]}/${endParts[0]}`;
      } else if (startParts.length === 3) {
        formattedSpan = `${startParts[2]}/${startParts[1]}/${startParts[0]}`;
      }

      return {
        ...ev,
        startDate: startIso,
        endDate: endIso,
        timeWindow,
        isNocturnal,
        aiImpactsPassengerService: aiImpacts,
        aiNonImpactReason: aiReason,
        affectedAreas: mergedAreas,
        formattedDateSpan: formattedSpan,
      };
    });
  } catch (err) {
    console.warn('[Disruptions] Fallback parsing mobilità con Gemini:', err);
    return events;
  }
}

const URBAN_DEDUP_STOPWORDS = new Set([
  'roma',
  'oggi',
  'domani',
  'ieri',
  'stamattina',
  'stasera',
  'mattina',
  'pomeriggio',
  'sera',
  'notte',
  'luned',
  'marte',
  'merco',
  'giove',
  'vener',
  'sabat',
  'domen',
  'genna',
  'febbr',
  'marzo',
  'april',
  'maggi',
  'giugn',
  'lugli',
  'agost',
  'sette',
  'ottob',
  'novem',
  'dicem',
  'torna',
  'progr',
  'chius',
  'traff',
  'devia',
  'manif',
  'sport',
  'event',
  'strad',
  'linee',
  'linea',
  'modif',
  'viabi',
  'divie',
  'sosta',
  'trans',
  'centr',
  'piazz',
  'viale',
  'largo',
  'corso',
  'dalle',
  'delle',
  'degli',
  'della',
  'nella',
  'sulla',
  'tutti',
  'tutte',
  'nuovo',
  'nuova',
]);

function extractUrbanTitleStems(title: string): Set<string> {
  const normalized = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
  const stems = new Set<string>();
  for (const word of normalized.split(/\s+/)) {
    if (word.length < 4 || /^\d+$/.test(word)) continue;
    const stem = word.slice(0, 5);
    if (!URBAN_DEDUP_STOPWORDS.has(stem)) {
      stems.add(stem);
    }
  }
  return stems;
}

function areUrbanTitlesDuplicate(titleA: string, titleB: string): boolean {
  const normA = titleA.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normB = titleB.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (normA && normA === normB) return true;

  const stemsA = extractUrbanTitleStems(titleA);
  const stemsB = extractUrbanTitleStems(titleB);
  const minSize = Math.min(stemsA.size, stemsB.size);
  if (minSize < 2) return false;

  let overlapCount = 0;
  for (const s of stemsA) {
    if (stemsB.has(s)) overlapCount++;
  }
  return overlapCount >= 2 && overlapCount / minSize >= 0.65;
}

function normalizeClockForDedupKey(hour: number, minute: number): string {
  if (minute >= 58) {
    return `${Math.min(24, hour + 1)}:00`;
  }
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function mergeCommaSeparatedUnique(values: (string | undefined)[]): string | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const val of values) {
    if (!val) continue;
    for (const part of val.split(/[,;]+/)) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) {
        seen.add(key);
        out.push(cleaned);
      }
    }
  }
  return out.length > 0 ? out.join(', ') : undefined;
}

function mergeAreasUnique(lists: (string[] | undefined)[]): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const area of list) {
      const cleaned = area.trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(cleaned);
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

function cleanMitStrikeTitle(title: string): string {
  return title
    .replace(/\s*\/\s*(?:Plurisettoriale|Generale)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pickBestAffectedCompanies(
  group: DisruptionEvent[],
  isTpl: boolean,
  hasRomaMobilita: boolean
): string | undefined {
  const genericPattern = /^tutte le categorie|pubbliche e private|vari settori|tutti i settori/i;
  const specificList: string[] = [];
  const fallbackList: string[] = [];

  for (const ev of group) {
    const comp = (ev.affectedCompanies || '').trim();
    if (!comp) continue;
    if (genericPattern.test(comp)) {
      fallbackList.push(comp);
    } else {
      specificList.push(comp);
    }
  }

  if (isTpl && hasRomaMobilita) {
    const rmSpecific = group.find(
      (ev) => ev.sourceName === 'Roma Mobilità' && ev.affectedCompanies
    )?.affectedCompanies;
    if (rmSpecific) return rmSpecific;
  }

  if (specificList.length > 0) {
    // Ordina preferendo la voce più informativa e deduplicando
    const sorted = [...specificList].sort((a, b) => b.length - a.length);
    const unique: string[] = [];
    for (const item of sorted) {
      const low = item.toLowerCase();
      if (!unique.some((u) => u.toLowerCase().includes(low) || low.includes(u.toLowerCase()))) {
        unique.push(item);
      }
    }
    return unique.slice(0, 2).join(' · ');
  }

  return fallbackList[0];
}

function mergeRailStrikeGroup(group: DisruptionEvent[], keySuffix: string): DisruptionEvent {
  if (group.length === 1) {
    const single = group[0];
    return {
      ...single,
      title: cleanMitStrikeTitle(single.title),
    };
  }

  // Preferisci una voce con titolo ferroviario pulito e dettagli completi Trenitalia/FS
  const sorted = [...group].sort((a, b) => {
    const aPure = !/plurisettoriale|generale/i.test(a.title) ? 1 : 0;
    const bPure = !/plurisettoriale|generale/i.test(b.title) ? 1 : 0;
    if (aPure !== bPure) return bPure - aPure;
    const aFs = /trenitalia|gruppo fs|ferrovie dello stato|rfi/i.test(
      `${a.affectedCompanies || ''} ${a.notes || ''}`
    )
      ? 1
      : 0;
    const bFs = /trenitalia|gruppo fs|ferrovie dello stato|rfi/i.test(
      `${b.affectedCompanies || ''} ${b.notes || ''}`
    )
      ? 1
      : 0;
    if (aFs !== bFs) return bFs - aFs;
    return (b.notes || '').length - (a.notes || '').length;
  });

  const primary = sorted[0];
  const mergedUnions = mergeCommaSeparatedUnique(group.map((g) => g.unions));
  const mergedCompanies = pickBestAffectedCompanies(group, false, false);
  const anyAiImpacts = group.some((g) => g.aiImpactsPassengerService === true);
  const allAiNonImpacting = group.every((g) => g.aiImpactsPassengerService === false);
  const firstReason = group.find((g) => g.aiNonImpactReason)?.aiNonImpactReason;

  const merged: DisruptionEvent = {
    ...primary,
    id: `mit-rail-${keySuffix}`,
    title: cleanMitStrikeTitle(primary.title),
    affectedCompanies: mergedCompanies || primary.affectedCompanies,
    unions: mergedUnions,
    aiImpactsPassengerService: anyAiImpacts ? true : allAiNonImpacting ? false : undefined,
    aiNonImpactReason: allAiNonImpacting ? firstReason : undefined,
    isCommuterRelevant: group.some((g) => g.isCommuterRelevant),
  };
  merged.timeWindow = formatDisruptionModalTimeWindow(merged);
  return merged;
}

function mergeTplStrikeGroup(group: DisruptionEvent[], keySuffix: string): DisruptionEvent {
  const hasMit = group.some((g) => g.sourceName === 'Ministero dei Trasporti (MIT)');
  const hasRm = group.some((g) => g.sourceName === 'Roma Mobilità');

  if (group.length === 1) {
    const single = group[0];
    return hasMit ? { ...single, title: cleanMitStrikeTitle(single.title) } : single;
  }

  const mitEntries = group.filter((g) => g.sourceName === 'Ministero dei Trasporti (MIT)');
  const rmEntries = group.filter((g) => g.sourceName === 'Roma Mobilità');
  const lvEntries = group.filter((g) => g.sourceName === 'Luceverde Roma');

  const bestMit = mitEntries[0];
  // Tra gli articoli Roma Mobilità preferisci quello col corpo più dettagliato (contiene le fasce di garanzia ATAC/Cotral)
  const bestRmByNotes = [...rmEntries].sort(
    (a, b) => (b.notes || '').length - (a.notes || '').length
  )[0];
  const bestRmNonRelativeTitle = rmEntries.find(
    (e) => !/\b(?:oggi|domani|stamattina|stasera|ieri)\b/i.test(e.title)
  );

  // Scegli una base temporale precisa (se MIT ha una fascia esplicita ridotta es. 4 ore, mantienila)
  const explicitShortEntry =
    mitEntries.find((e) => !parseDisruptionSchedule(e).isFullDay) ||
    group.find((e) => !parseDisruptionSchedule(e).isFullDay);
  const primary = explicitShortEntry || bestMit || bestRmByNotes || lvEntries[0] || group[0];

  const sourceName: DisruptionEvent['sourceName'] =
    hasRm && hasMit
      ? 'Roma Mobilità · MIT'
      : hasRm
        ? 'Roma Mobilità'
        : hasMit
          ? 'Ministero dei Trasporti (MIT)'
          : 'Luceverde Roma';

  const title = bestMit
    ? cleanMitStrikeTitle(bestMit.title)
    : bestRmNonRelativeTitle
      ? bestRmNonRelativeTitle.title
      : (bestRmByNotes?.title || primary.title);

  const notes =
    bestRmByNotes?.notes ||
    lvEntries.find((e) => e.notes)?.notes ||
    mitEntries.sort((a, b) => (b.notes || '').length - (a.notes || '').length)[0]?.notes ||
    primary.notes;

  const mergedUnions = mergeCommaSeparatedUnique(group.map((g) => g.unions));
  const mergedCompanies = pickBestAffectedCompanies(group, true, hasRm);
  const mergedAreas = mergeAreasUnique(group.map((g) => g.affectedAreas));
  const anyAiImpacts = group.some((g) => g.aiImpactsPassengerService === true);
  const allAiNonImpacting = group.every((g) => g.aiImpactsPassengerService === false);
  const firstReason = group.find((g) => g.aiNonImpactReason)?.aiNonImpactReason;

  const merged: DisruptionEvent = {
    ...primary,
    id: `tpl-strike-${keySuffix}`,
    title,
    affectedCompanies: mergedCompanies || primary.affectedCompanies,
    affectedAreas: mergedAreas,
    unions: mergedUnions,
    notes,
    sourceName,
    sourceUrl: bestRmByNotes?.sourceUrl || primary.sourceUrl,
    aiImpactsPassengerService: anyAiImpacts ? true : allAiNonImpacting ? false : undefined,
    aiNonImpactReason: allAiNonImpacting ? firstReason : undefined,
    isCommuterRelevant: group.some((g) => g.isCommuterRelevant),
    isWalkRelevant: group.some((g) => g.isWalkRelevant),
  };

  // Se avevamo una finestra oraria ridotta esplicita (es. 4 ore), preservala; altrimenti ricalcola
  merged.timeWindow = explicitShortEntry
    ? formatDisruptionModalTimeWindow(explicitShortEntry)
    : formatDisruptionModalTimeWindow(merged);
  return merged;
}

/**
 * Deduplica e consolida gli eventi provenienti da più sindacati (MIT RSS) e più fonti
 * (MIT + Roma Mobilità + Luceverde Roma) in un'unica scheda autorevole per sciopero/evento.
 */
function deduplicateDisruptions(events: DisruptionEvent[]): DisruptionEvent[] {
  const railGroups = new Map<string, DisruptionEvent[]>();
  const tplDateGroups = new Map<string, DisruptionEvent[]>();
  const urbanEvents: DisruptionEvent[] = [];

  for (const ev of events) {
    if (ev.category === 'sciopero_treni') {
      const sched = parseDisruptionSchedule(ev);
      const isImp = isTrainStrikeImpactingCommuter(ev);
      const clockSig = sched.isFullDay
        ? 'full'
        : `${normalizeClockForDedupKey(sched.startHour, sched.startMinute)}-${
            sched.endHour !== undefined
              ? normalizeClockForDedupKey(sched.endHour, sched.endMinute || 0)
              : 'open'
          }`;
      const key = `${sched.startDateIso}_${sched.endDateIso}_${clockSig}_${isImp ? '1' : '0'}`;
      const list = railGroups.get(key) || [];
      list.push(ev);
      railGroups.set(key, list);
    } else if (ev.category === 'sciopero_tpl') {
      const sched = parseDisruptionSchedule(ev);
      const isImp = isTplStrikeImpactingRome(ev);
      const key = `${sched.startDateIso}_${sched.endDateIso}_${isImp ? '1' : '0'}`;
      const list = tplDateGroups.get(key) || [];
      list.push(ev);
      tplDateGroups.set(key, list);
    } else {
      urbanEvents.push(ev);
    }
  }

  const deduped: DisruptionEvent[] = [];

  // 1) Consolida scioperi ferroviari con stessa finestra temporale e impatto
  for (const [key, group] of railGroups.entries()) {
    deduped.push(mergeRailStrikeGroup(group, key));
  }

  // 2) Consolida scioperi TPL sulla stessa data tra MIT, Roma Mobilità e Luceverde
  for (const [key, group] of tplDateGroups.entries()) {
    // Separa solo se nello stesso giorno coesistono due fasce orarie ridotte esplicite completamente disgiunte
    const buckets: DisruptionEvent[][] = [];
    for (const ev of group) {
      const sched = parseDisruptionSchedule(ev);
      let placed = false;
      for (const bucket of buckets) {
        const refSched = parseDisruptionSchedule(bucket[0]);
        if (sched.isFullDay || refSched.isFullDay || !sched.hasExplicitRange || !refSched.hasExplicitRange) {
          bucket.push(ev);
          placed = true;
          break;
        }
        const aStart = sched.startHour * 60 + sched.startMinute;
        const aEnd = (sched.endHour ?? 24) * 60 + (sched.endMinute || 0);
        const bStart = refSched.startHour * 60 + refSched.startMinute;
        const bEnd = (refSched.endHour ?? 24) * 60 + (refSched.endMinute || 0);
        if (aStart <= bEnd && bStart <= aEnd) {
          bucket.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) {
        buckets.push([ev]);
      }
    }

    buckets.forEach((bucket, idx) => {
      const suffix = buckets.length > 1 ? `${key}_${idx}` : key;
      deduped.push(mergeTplStrikeGroup(bucket, suffix));
    });
  }

  // 3) Deduplica eventi urbani equivalenti sulla stessa data tra Roma Mobilità e Luceverde Roma
  const mergedUrban: DisruptionEvent[] = [];
  for (const ev of urbanEvents) {
    const matchIdx = mergedUrban.findIndex(
      (existing) =>
        existing.startDate === ev.startDate &&
        existing.endDate === ev.endDate &&
        areUrbanTitlesDuplicate(existing.title, ev.title)
    );

    if (matchIdx === -1) {
      mergedUrban.push(ev);
    } else {
      const existing = mergedUrban[matchIdx];
      const existingNotesLen = (existing.notes || '').length;
      const incomingNotesLen = (ev.notes || '').length;
      const preferred = incomingNotesLen > existingNotesLen ? ev : existing;
      const secondary = preferred === ev ? existing : ev;

      mergedUrban[matchIdx] = {
        ...preferred,
        timeWindow: preferred.timeWindow || secondary.timeWindow,
        affectedAreas: mergeAreasUnique([preferred.affectedAreas, secondary.affectedAreas]),
        isCommuterRelevant: Boolean(preferred.isCommuterRelevant || secondary.isCommuterRelevant),
        isWalkRelevant: Boolean(preferred.isWalkRelevant || secondary.isWalkRelevant),
      };
    }
  }

  deduped.push(...mergedUrban);
  return deduped;
}

/**
 * Ottiene la lista completa degli scioperi e delle manifestazioni (con cache RAM + locale di 30m e deduplicazione in-flight)
 */
export async function getDisruptions(forceRefresh = false): Promise<DisruptionEvent[]> {
  if (!forceRefresh) {
    if (memoryDisruptionsCache && Date.now() - memoryDisruptionsCache.timestamp < DISRUPTIONS_CACHE_TTL_MS) {
      return memoryDisruptionsCache.data;
    }
    if (inFlightDisruptionsPromise) {
      return inFlightDisruptionsPromise;
    }
  } else if (inFlightForceDisruptionsPromise) {
    return inFlightForceDisruptionsPromise;
  }

  const runFetch = async (): Promise<DisruptionEvent[]> => {
    let staleCacheData: DisruptionEvent[] | null = memoryDisruptionsCache?.data ?? null;

    try {
      const cachedRaw = await AsyncStorage.getItem(DISRUPTIONS_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Array.isArray(cached.data)) {
          staleCacheData = cached.data;
          if (!forceRefresh && cached.timestamp && Date.now() - cached.timestamp < DISRUPTIONS_CACHE_TTL_MS) {
            memoryDisruptionsCache = { timestamp: cached.timestamp, data: cached.data };
            return cached.data;
          }
        }
      }

      const [strikesRes, luceverdeRes, romaMobilitaRes] = await Promise.allSettled([
        fetchOfficialStrikes(),
        fetchRomeMobilityEvents(),
        fetchRomaMobilitaEvents(),
      ]);

      const strikesOutcome =
        strikesRes.status === 'fulfilled' ? strikesRes.value : { events: [], ok: false };
      const luceverdeOutcome =
        luceverdeRes.status === 'fulfilled' ? luceverdeRes.value : { events: [], ok: false };
      const romaMobilitaOutcome =
        romaMobilitaRes.status === 'fulfilled' ? romaMobilitaRes.value : { events: [], ok: false };

      // Se tutte le sorgenti sono fallite, preserva la cache precedente invece di sovrascriverla con []
      if (!strikesOutcome.ok && !luceverdeOutcome.ok && !romaMobilitaOutcome.ok) {
        return staleCacheData ?? [];
      }

      const combined = [
        ...strikesOutcome.events,
        ...luceverdeOutcome.events,
        ...romaMobilitaOutcome.events,
      ].map((ev) => {
        const isTrainRelevant = ev.category === 'sciopero_treni' ? isTrainStrikeImpactingCommuter(ev) : false;
        const isWalkRel = isWalkDisruptionImpactingCommuter(ev);
        const isRelevant = isTrainRelevant || isWalkRel;
        return {
          ...ev,
          isCommuterRelevant: isRelevant,
          isWalkRelevant: isWalkRel,
        };
      });

      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // Escludi eventi già interamente conclusi nel passato (endDate < todayIso)
      const activeRaw = combined.filter((ev) => {
        if (ev.endDate && ev.endDate < todayIso) {
          return false;
        }
        return true;
      });

      // Consolida duplicati multi-sindacato (MIT) e cross-fonte (MIT + Roma Mobilità + Luceverde)
      const activeOrUpcoming = deduplicateDisruptions(activeRaw);

      // Ordina: prima gli eventi con data crescente, privilegiando quelli che impattano la tratta
      activeOrUpcoming.sort((a, b) => {
        if (a.startDate !== b.startDate) {
          return a.startDate.localeCompare(b.startDate);
        }
        if (a.isCommuterRelevant && !b.isCommuterRelevant) return -1;
        if (!a.isCommuterRelevant && b.isCommuterRelevant) return 1;
        return 0;
      });

      const now = Date.now();
      memoryDisruptionsCache = { timestamp: now, data: activeOrUpcoming };

      // Salva in cache solo se almeno una fonte ha risposto correttamente
      await AsyncStorage.setItem(
        DISRUPTIONS_CACHE_KEY,
        JSON.stringify({
          timestamp: now,
          data: activeOrUpcoming,
        })
      );

      return activeOrUpcoming;
    } catch (err) {
      console.warn('[Disruptions] Errore getDisruptions:', err);
      return staleCacheData ?? [];
    }
  };

  if (forceRefresh) {
    inFlightForceDisruptionsPromise = runFetch().finally(() => {
      inFlightForceDisruptionsPromise = null;
    });
    return inFlightForceDisruptionsPromise;
  }

  inFlightDisruptionsPromise = runFetch().finally(() => {
    inFlightDisruptionsPromise = null;
  });
  return inFlightDisruptionsPromise;
}

/**
 * Calcola la data effettiva corrispondente a un indice del giorno della settimana
 * all'interno dell'orizzonte ciclico settimanale dell'app
 */
export function getWeekdayDate(targetWeekday: number, refDate = new Date()): Date {
  const currentWeekday = refDate.getDay(); // 0 = Domenica, 1 = Lunedì...
  let diffDays = targetWeekday - currentWeekday;
  // Se il giorno selezionato è già passato nella settimana corrente,
  // proietta all'occorrenza successiva nei 7 giorni
  if (diffDays < 0) {
    diffDays += 7;
  }
  const result = new Date(refDate);
  result.setDate(refDate.getDate() + diffDays);
  return result;
}

/**
 * Verifica se ci sono eventi o scioperi per una specifica data ISO (YYYY-MM-DD)
 */
export function getDisruptionsForDate(targetDate: Date, allEvents: DisruptionEvent[]): DisruptionEvent[] {
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  const targetIso = `${y}-${m}-${d}`;

  return allEvents.filter((ev) => getDisruptionActiveWindowForDate(ev, targetIso) !== null);
}

/**
 * Verifica se ci sono eventi o scioperi per il giorno della settimana selezionato
 */
export function getDisruptionsForWeekday(
  targetWeekday: number,
  allEvents: DisruptionEvent[],
  refDate = new Date()
): DisruptionEvent[] {
  const actualDate = getWeekdayDate(targetWeekday, refDate);
  return getDisruptionsForDate(actualDate, allEvents);
}

/**
 * Verifica se uno sciopero ferroviario impatta realmente la linea del pendolare (Trenitalia / Gruppo FS / RFI / Regionali / IC).
 * Gli scioperi che riguardano esclusivamente Italo-NTV, trasporto merci/cargo, appalti pulizie/ristorazione/uffici
 * o altre ferrovie regionali estranee (es. Trenord, EAV) NON creano alcun disservizio sulla tratta del pendolare.
 */
export function isTrainStrikeImpactingCommuter(strike: DisruptionEvent): boolean {
  if (strike.category !== 'sciopero_treni') return false;
  if (strike.aiImpactsPassengerService === false) return false;

  const textToScan = `${strike.title} ${strike.affectedCompanies || ''} ${strike.notes || ''}`.toLowerCase();

  // 1. Se riguarda unicamente Italo / NTV / Nuovo Trasporto Viaggiatori
  const mentionsItalo =
    textToScan.includes('italo') ||
    textToScan.includes('ntv') ||
    textToScan.includes('nuovo trasporto viaggiatori');
  const mentionsFS =
    textToScan.includes('trenitalia') ||
    textToScan.includes('gruppo fs') ||
    textToScan.includes('ferrovie dello stato') ||
    textToScan.includes('fsi');

  if (mentionsItalo && !mentionsFS) {
    return false;
  }

  // 2. Se riguarda esclusivamente il trasporto merci / cargo su rotaia
  const mentionsCargo =
    textToScan.includes('mercitalia') ||
    textToScan.includes('captrain') ||
    textToScan.includes('gts rail') ||
    textToScan.includes('medway') ||
    textToScan.includes('sbb cargo') ||
    textToScan.includes('db cargo') ||
    textToScan.includes('sangritana') ||
    textToScan.includes('evm rail') ||
    textToScan.includes('ermes rail') ||
    textToScan.includes('tx logistik') ||
    textToScan.includes('bls cargo') ||
    textToScan.includes('inrail') ||
    textToScan.includes('rail traction') ||
    textToScan.includes('autotrasporto merci');

  const isCargoOnlyClause =
    (mentionsCargo ||
      (textToScan.includes('trasporto merci') &&
        !textToScan.includes('settore ferroviario, trasporto merci'))) &&
    !mentionsFS;

  if (isCargoOnlyClause) {
    return false;
  }

  // 3. Se riguarda esclusivamente appalti di pulizia, ristorazione, facchinaggio, vigilanza o uffici
  const isAncillaryContractOnly =
    (textToScan.includes('appalto pulizie') ||
      textToScan.includes('appalti pulizie') ||
      textToScan.includes('servizi di pulizia') ||
      textToScan.includes('pulizia e sanificazione') ||
      textToScan.includes('ristorazione a bordo') ||
      textToScan.includes('accoglienza e accompagnamento') ||
      textToScan.includes('facchinaggio') ||
      textToScan.includes('vigilanza privata')) &&
    !textToScan.includes('personale di macchina') &&
    !textToScan.includes('personale di bordo') &&
    !textToScan.includes('circolazione');

  if (isAncillaryContractOnly) {
    return false;
  }

  // 4. Se riguarda ferrovie regionali o unità territoriali RFI di altre regioni estranee al Lazio
  const isOtherRegional =
    (textToScan.includes('trenord') ||
      textToScan.includes('eav') ||
      textToScan.includes('ferrovie del sud est') ||
      textToScan.includes('fs sud est') ||
      textToScan.includes('ferrovie appulo lucane') ||
      textToScan.includes('ferrotramviaria') ||
      textToScan.includes('ferrovie del gargano') ||
      textToScan.includes('tper') ||
      textToScan.includes('fnm') ||
      textToScan.includes('doit verona') ||
      textToScan.includes('doit torino') ||
      textToScan.includes('doit milano') ||
      textToScan.includes('doit venezia') ||
      textToScan.includes('doit bologna') ||
      textToScan.includes('doit genova') ||
      textToScan.includes('doit bari') ||
      textToScan.includes('doit palermo') ||
      textToScan.includes('doit reggio calabria')) &&
    !textToScan.includes('roma') &&
    !textToScan.includes('lazio');

  if (isOtherRegional) {
    return false;
  }

  return true;
}

export interface DisruptionTimeInfo {
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
  isNocturnal: boolean;
  hasTimeWindow: boolean;
}

/**
 * Estrae gli orari precisi di inizio e fine dell'evento/manifestazione e rileva se è notturno
 */
export function parseDisruptionTime(event: DisruptionEvent): DisruptionTimeInfo {
  const schedule = parseDisruptionSchedule(event);
  return {
    startHour: schedule.hasTimeWindow ? schedule.startHour : 9,
    startMinute: schedule.hasTimeWindow ? schedule.startMinute : 0,
    endHour: schedule.hasTimeWindow ? schedule.endHour : undefined,
    endMinute: schedule.hasTimeWindow ? schedule.endMinute : undefined,
    isNocturnal: schedule.isNocturnal,
    hasTimeWindow: schedule.hasTimeWindow,
  };
}

export interface DisruptionTimingContext {
  status: 'upcoming_future_hours' | 'approaching' | 'active_now' | 'past' | 'nocturnal' | 'other_day';
  badgeLabel: string;
  badgeType: 'warning' | 'info' | 'success' | 'neutral';
  message: string;
  isImpactingNow: boolean;
  timeLabel: string;
}

/**
 * Valuta con intelligenza se una manifestazione impatta gli orari del pendolare:
 * - Le manifestazioni notturne (es. ore 22) non intaccano gli orari universitari.
 * - Le manifestazioni pomeridiane (es. ore 16) non impattano l'andata al mattino,
 *   ma solo man mano che ci si avvicina all'orario dell'evento o al rientro.
 */
export function getDisruptionTimingContext(
  event: DisruptionEvent,
  refDate: Date = new Date()
): DisruptionTimingContext {
  const timeInfo = parseDisruptionTime(event);

  if (timeInfo.isNocturnal) {
    return {
      status: 'nocturnal',
      badgeLabel: 'Fuori orario lezioni',
      badgeType: 'neutral',
      message: 'Orario notturno (nessun impatto sulle lezioni)',
      isImpactingNow: false,
      timeLabel: event.timeWindow || 'Notturno',
    };
  }

  const todayIso = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(refDate.getDate()).padStart(2, '0')}`;
  const isToday = event.startDate <= todayIso && event.endDate >= todayIso;

  if (!isToday) {
    const formattedStartTime = `${timeInfo.startHour.toString().padStart(2, '0')}:${timeInfo.startMinute.toString().padStart(2, '0')}`;
    return {
      status: 'other_day',
      badgeLabel: 'Sul tuo tragitto',
      badgeType: 'warning',
      message: timeInfo.hasTimeWindow
        ? `Previsto dalle ${formattedStartTime}`
        : 'In programma per questa data',
      isImpactingNow: true,
      timeLabel: event.timeWindow || '',
    };
  }

  // Giorno corrente: confrontiamo l'orario reale del pendolare
  const currentMins = refDate.getHours() * 60 + refDate.getMinutes();
  const eventStartMins = timeInfo.startHour * 60 + timeInfo.startMinute;
  const eventEndMins =
    timeInfo.endHour !== undefined
      ? timeInfo.endHour * 60 + timeInfo.endMinute!
      : eventStartMins + 180; // stima standard durata evento 3 ore se non specificato

  const formattedStartTime = `${timeInfo.startHour.toString().padStart(2, '0')}:${timeInfo.startMinute.toString().padStart(2, '0')}`;

  // 1) Se l'evento è già concluso
  if (currentMins > eventEndMins) {
    return {
      status: 'past',
      badgeLabel: 'Evento concluso',
      badgeType: 'success',
      message: 'Evento concluso · Viabilità e percorsi regolari',
      isImpactingNow: false,
      timeLabel: event.timeWindow || '',
    };
  }

  // 2) Se l'evento è attualmente in corso
  if (currentMins >= eventStartMins && currentMins <= eventEndMins) {
    return {
      status: 'active_now',
      badgeLabel: 'Sul tuo tragitto',
      badgeType: 'warning',
      message: 'In corso sul tuo tragitto · Possibili rallentamenti',
      isImpactingNow: true,
      timeLabel: event.timeWindow || '',
    };
  }

  // 3) Se ci stiamo avvicinando all'evento (meno di 60 minuti prima dell'inizio)
  if (currentMins >= eventStartMins - 60 && currentMins < eventStartMins) {
    return {
      status: 'approaching',
      badgeLabel: 'Sul tuo tragitto',
      badgeType: 'warning',
      message: `Inizio imminente (dalle ${formattedStartTime}) · Traffico in aumento`,
      isImpactingNow: true,
      timeLabel: event.timeWindow || '',
    };
  }

  // 4) Se l'evento è più avanti nella giornata (es. alle 16:00 e adesso siamo al mattino):
  // All'andata il tragitto è regolare fino a quando non ci si avvicina all'orario
  const bufferStartMins = eventStartMins - 45;
  const bufferH = Math.floor(bufferStartMins / 60);
  const bufferM = bufferStartMins % 60;
  const formattedBufferTime = `${bufferH.toString().padStart(2, '0')}:${bufferM.toString().padStart(2, '0')}`;

  return {
    status: 'upcoming_future_hours',
    badgeLabel: 'Sul tuo tragitto',
    badgeType: 'warning',
    message: `Andata regolare · Possibili rallentamenti dalle ${formattedBufferTime} (inizio ore ${formattedStartTime})`,
    isImpactingNow: false,
    timeLabel: event.timeWindow || '',
  };
}

/**
 * Verifica se uno sciopero del trasporto pubblico locale (TPL) impatta Roma (ATAC / Roma TPL / Cotral / nazionale).
 */
export function isTplStrikeImpactingRome(event: DisruptionEvent): boolean {
  if (event.category !== 'sciopero_tpl') return false;
  if (event.isNocturnal) return false;
  if (event.aiImpactsPassengerService === false) return false;

  const timeInfo = parseDisruptionTime(event);
  if (timeInfo.isNocturnal) return false;

  const scan = `${event.title} ${event.scope || ''} ${event.affectedCompanies || ''} ${event.notes || ''}`.toLowerCase();

  // Escludi scioperi che riguardano esclusivamente appalti pulizie/ausiliari/biglietterie o settori non TPL di linea
  const isNonCirculationTpl =
    (scan.includes('appalto pulizie') ||
      scan.includes('servizi di pulizia') ||
      scan.includes('ausiliari del traffico') ||
      scan.includes('addetti al servizio taxi') ||
      scan.includes('noleggio con conducente')) &&
    !scan.includes('atac') &&
    !scan.includes('cotral') &&
    !scan.includes('esercizio');

  if (isNonCirculationTpl) return false;

  // Escludi scioperi aziendali circoscritti ad altre città/province italiane estranee a Roma/Lazio
  const isOtherCityTpl =
    (scan.includes('atm milano') ||
      scan.includes('gtt torino') ||
      scan.includes('anm napoli') ||
      scan.includes('eav') ||
      scan.includes('tper bologna') ||
      scan.includes('amt genova') ||
      scan.includes('actv venezia') ||
      scan.includes('amtab bari') ||
      scan.includes('amat palermo') ||
      scan.includes('autolinee toscane') ||
      scan.includes('fs sud est') ||
      scan.includes('autolinee romano') ||
      scan.includes('casale monferrato')) &&
    !scan.includes('atac') &&
    !scan.includes('cotral') &&
    !scan.includes('roma');

  if (isOtherCityTpl) return false;

  return true;
}

/**
 * Verifica se uno sciopero TPL, manifestazione o blocco stradale / deviazione impatta il tragitto
 * urbano del pendolare (a piedi o con mezzi pubblici/bus/tram/metro)
 * tra la stazione ferroviaria (Tiburtina/Termini/Ostiense) e le sedi universitarie Sapienza.
 * Eventi puramente notturni (es. ore 22-06, chiusura notturna Tangenziale) o che riguardano
 * autostrade/tangenziali prive di interferenza con il corridoio aule sono tassativamente esclusi.
 */
export function isUrbanDisruptionImpactingCommuter(
  event: DisruptionEvent,
  stationName?: string
): boolean {
  if (event.category === 'sciopero_treni') return false;
  if (event.isNocturnal) return false;
  if (event.aiImpactsPassengerService === false) return false;

  if (event.category === 'sciopero_tpl') {
    return isTplStrikeImpactingRome(event);
  }

  // 1. Esclusione tassativa eventi notturni (fuori dagli orari delle lezioni del pendolare)
  const timeInfo = parseDisruptionTime(event);
  if (timeInfo.isNocturnal) {
    return false;
  }

  const textToScan = `${event.title} ${(event.affectedAreas || []).join(' ')} ${event.notes || ''}`.toLowerCase();

  // 2. Controllo esplicito su diciture notturne nel testo
  if (
    textToScan.includes('chiusura notturna') ||
    textToScan.includes('lavori notturni') ||
    textToScan.includes('manutenzione notturna') ||
    textToScan.includes('manutenzione straordinaria notturna') ||
    textToScan.includes('dalle 22') ||
    textToScan.includes('dalle ore 22') ||
    textToScan.includes('ore 22:00') ||
    textToScan.includes('ore 23:00') ||
    textToScan.includes('22:00 - 06:00') ||
    textToScan.includes('tra le ore 22')
  ) {
    return false;
  }

  // 3. Esclusione infrastrutture autostradali / tangenziali che non impattano il transito urbano
  const isHighwayOnly =
    (textToScan.includes('tangenziale') ||
      textToScan.includes('tangenziale est') ||
      /\bg\.?r\.?a\.?\b/i.test(textToScan) ||
      textToScan.includes('grande raccordo') ||
      textToScan.includes('autostrada') ||
      textToScan.includes('galleria nuova circonvallazione')) &&
    !textToScan.includes('piazzale verano') &&
    !textToScan.includes('viale regina elena') &&
    !textToScan.includes('de lollis') &&
    !textToScan.includes('marrucini') &&
    !textToScan.includes('san lorenzo') &&
    !textToScan.includes('piazza dei cinquecento');

  if (isHighwayOnly) {
    return false;
  }

  // 4. Modalità: deve interessare il percorso a piedi o i mezzi pubblici urbani (transit)
  const impactsModes =
    event.affectedModes.includes('walk') ||
    event.affectedModes.includes('transit');

  if (!impactsModes) {
    return false;
  }

  // 5. Corridoio universitario Sapienza, Policlinico e quartiere San Lorenzo
  const corridorKeywords = [
    'verano',
    'san lorenzo',
    'sapienza',
    'aldo moro',
    'policlinico',
    'castro laurenziano',
    'regina elena',
    'castro pretorio',
    'de lollis',
    'marrucini',
    'scalo san lorenzo',
    'eudossiana',
    'ariosto',
  ];

  // Aggiungi la stazione attiva
  const normStation = (stationName || '').toLowerCase();
  if (normStation.includes('tiburtina')) {
    corridorKeywords.push('tiburtina', 'piazzale tiburtino', 'stazione tiburtina');
  }
  if (normStation.includes('termini')) {
    corridorKeywords.push('termini', 'piazza dei cinquecento', 'marsala', 'giolitti', 'stazione termini');
  }
  if (normStation.includes('ostiense')) {
    corridorKeywords.push('ostiense', 'piramide', 'stazione ostiense');
  }

  const mentionsCorridorBusLine =
    /\bline[ae]\b[^.\n]{0,160}\b(?:71|163|310|492|495|545|649)\b/i.test(textToScan);

  return corridorKeywords.some((kw) => textToScan.includes(kw)) || mentionsCorridorBusLine;
}

// Alias retrocompatibile
export const isWalkDisruptionImpactingCommuter = isUrbanDisruptionImpactingCommuter;

export interface LectureDisruptionAlert {
  id: string;
  badgeLabel: string;
  title: string;
  category: DisruptionCategory;
  type: 'train' | 'urban';
  timeWindow?: string;
  shortDesc: string;
}

/**
 * Analizza intelligentemente gli annunci e segnalazioni per una lezione specifica in una determinata data (da DATA a DATA):
 * - Riconosce la finestra temporale dell'annuncio (startDate <= lectureDate <= endDate).
 * - Per i treni: verifica se lo sciopero riguarda la linea pendolare (Trenitalia / RFI / IC).
 * - Per manifestazioni/viabilità: verifica sia pedonale che mezzi lungo il corridoio e correla
 *   gli orari (es. evento delle 16 non impatta una lezione del mattino 08:30-11:30, ma impatta le lezioni pomeridiane).
 */
export function getDisruptionsImpactingLecture(
  lectureDateIso: string,
  lectureStartTime: string,
  lectureEndTime: string,
  allDisruptions: DisruptionEvent[],
  commuterStationName?: string
): LectureDisruptionAlert | null {
  if (!allDisruptions || allDisruptions.length === 0 || !lectureDateIso) {
    return null;
  }

  // 1. Cerca annunci effettivamente attivi nella data della lezione (incluse fasce orarie multi-giorno)
  const activeEventsOnDate = allDisruptions.filter(
    (ev) => getDisruptionActiveWindowForDate(ev, lectureDateIso) !== null
  );

  if (activeEventsOnDate.length === 0) return null;

  // Parsing orari lezione (in minuti da mezzanotte)
  const [lStartH, lStartM] = (lectureStartTime || '09:00').split(':').map(Number);
  const [lEndH, lEndM] = (lectureEndTime || '11:00').split(':').map(Number);
  const lectureStartMins = (lStartH || 9) * 60 + (lStartM || 0);
  const lectureEndMins = (lEndH || 11) * 60 + (lEndM || 0);

  // Finestra di percorrenza ferroviaria associata alla lezione (andata ~2h prima, rientro ~1h45m dopo)
  const railCommuteStart = Math.max(0, lectureStartMins - 120);
  const railCommuteEnd = Math.min(1440, lectureEndMins + 105);

  // 2. Priorità 1: Sciopero treni impattante sulla tratta E compatibile con orari/durata nella data
  const trainStrike = activeEventsOnDate.find(
    (ev) =>
      ev.category === 'sciopero_treni' &&
      isTrainStrikeImpactingCommuter(ev) &&
      doesDisruptionOverlapMinutesForDate(ev, lectureDateIso, railCommuteStart, railCommuteEnd)
  );

  if (trainStrike) {
    const compactWindow = formatTrainStrikeBannerSummary(trainStrike, lectureDateIso);
    return {
      id: trainStrike.id,
      badgeLabel: 'Impatta la tua tratta',
      title: trainStrike.title,
      category: trainStrike.category,
      type: 'train',
      timeWindow: formatDisruptionModalTimeWindow(trainStrike),
      shortDesc: compactWindow ? `Sciopero treni · ${compactWindow}` : 'Sciopero treni in programma',
    };
  }

  // 3. Priorità 2: Manifestazione, blocco o deviazione viabilità/mezzi lungo il tragitto urbano
  const urbanEvents = activeEventsOnDate.filter((ev) =>
    isUrbanDisruptionImpactingCommuter(ev, commuterStationName)
  );

  if (urbanEvents.length === 0) return null;

  // Finestra di mobilità urbana associata alla lezione:
  // - Andata verso l'aula: 60 minuti prima dell'inizio
  // - Rientro dall'aula: fino a 75 minuti dopo la fine lezione
  const commuteWindowStart = Math.max(0, lectureStartMins - 60);
  const commuteWindowEnd = Math.min(1440, lectureEndMins + 75);

  for (const ev of urbanEvents) {
    const activeWin = getDisruptionActiveWindowForDate(ev, lectureDateIso, 180);
    if (!activeWin || activeWin.schedule.isNocturnal) continue;

    const startP = ev.startDate.split('-');
    const endP = ev.endDate.split('-');
    const dateSpanLabel =
      ev.startDate !== ev.endDate && startP.length === 3 && endP.length === 3
        ? ` · dal ${startP[2]}/${startP[1]} al ${endP[2]}/${endP[1]}`
        : '';

    const overlaps =
      !activeWin.hasExplicitClockBounds ||
      (activeWin.startMinuteOfDay <= commuteWindowEnd &&
        activeWin.endMinuteOfDay >= commuteWindowStart);

    if (overlaps) {
      const cleanTitle = ev.title
        .split(',')[0]
        .replace(/^luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica/i, '')
        .trim();
      const modalWin = formatDisruptionModalTimeWindow(ev);
      return {
        id: ev.id,
        badgeLabel: 'Impatta il tuo tragitto',
        title: ev.title,
        category: ev.category,
        type: 'urban',
        timeWindow: ev.timeWindow,
        shortDesc: `${cleanTitle}${modalWin ? ` (${modalWin})` : ''}${dateSpanLabel}`,
      };
    }
  }

  return null;
}

function normalizeTimeWindowsArg(
  windows?: TimeWindowMins | TimeWindowMins[]
): TimeWindowMins[] {
  if (!windows) return [];
  return Array.isArray(windows) ? windows : [windows];
}

/**
 * Filtra gli scioperi treni pertinenti alla tratta del pendolare per la schermata Viaggio,
 * verificando anche l'effettiva sovrapposizione con orari, date e durata rispetto al viaggio selezionato.
 */
export function getCommuterRelevantTrainStrikes(
  events: DisruptionEvent[],
  targetDateIso?: string,
  tripWindows?: TimeWindowMins | TimeWindowMins[]
): DisruptionEvent[] {
  const relevant = events.filter(
    (ev) => ev.category === 'sciopero_treni' && isTrainStrikeImpactingCommuter(ev)
  );
  const windows = normalizeTimeWindowsArg(tripWindows);
  if (!targetDateIso || windows.length === 0) {
    return relevant;
  }

  return relevant.filter((ev) =>
    windows.some((w) =>
      doesDisruptionOverlapMinutesForDate(ev, targetDateIso, w.startMins, w.endMins)
    )
  );
}

/**
 * Filtra le manifestazioni / blocchi pertinenti al percorso urbano del pendolare (a piedi o con mezzi),
 * considerando opzionalmente la fascia oraria effettiva dello spostamento urbano.
 */
export function getCommuterRelevantWalkDisruptions(
  events: DisruptionEvent[],
  stationName?: string,
  targetDateIso?: string,
  urbanWindows?: TimeWindowMins | TimeWindowMins[]
): DisruptionEvent[] {
  const relevant = events.filter(
    (ev) =>
      (ev.affectedModes.includes('walk') || ev.affectedModes.includes('transit')) &&
      isUrbanDisruptionImpactingCommuter(ev, stationName)
  );
  const windows = normalizeTimeWindowsArg(urbanWindows);
  if (!targetDateIso || windows.length === 0) {
    return relevant;
  }

  return relevant.filter((ev) =>
    windows.some((w) =>
      doesDisruptionOverlapMinutesForDate(ev, targetDateIso, w.startMins, w.endMins, 180)
    )
  );
}

/**
 * Filtra gli eventi che impattano una modalità specifica ('walk', 'train', 'transit')
 */
export function filterEventsByMode(
  events: DisruptionEvent[],
  mode: 'train' | 'walk' | 'transit'
): DisruptionEvent[] {
  return events.filter((ev) => ev.affectedModes.includes(mode));
}
