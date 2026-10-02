import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScheduleCells, parseTabsWithAI, parseHeaderWithGemini, cleanTabNameFallback, ParsedClass, extractDeterministicSemester } from './aiParser';
import { getCanonicalRoomKey, normalizeDisplayName, formatSapienzaAddress, SAPIENZA_BUILDINGS, resolveClassroom } from './classroomLocations';

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
 * Estrae un'impronta digitale (fingerprint) deterministica del foglio.
 * Rimuove i nonce e gli script dinamici generati a ogni richiesta da Google Sheets
 * ed estrae il testo effettivo di tutte le celle (intestazione, avvisi, aule, lezioni),
 * escludendo i testi invisibili di padding.
 */
export function extractSheetContentFingerprint(html: string): string {
  if (!html) return '';
  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/nonce="[^"]*"/gi, '');

  const classBgColors = extractClassBgColors(clean);
  const rows: string[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(clean)) !== null) {
    const tdRegex = /(<td[^>]*>)([\s\S]*?)<\/td>/gi;
    let tdMatch;
    const row: string[] = [];
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      row.push(cleanTdCellHtml(tdMatch[1], tdMatch[2], classBgColors));
    }
    if (row.some(Boolean)) {
      rows.push(row.join('|'));
    }
  }
  return hashCode(rows.join('\n'));
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

export async function fetchDegrees(): Promise<Degree[]> {
  try {
    const url = 'https://ici.web.uniroma1.it/node/388';
    const res = await axios.get(url);
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
    return degrees;
  } catch (error) {
    console.error('Error fetching degrees:', error);
    return [];
  }
}



export async function fetchTabs(url: string, forceRefresh = false): Promise<Tab[]> {
  try {
    const res = await axios.get(url);
    const data = res.data;
    
    // Check Cache
    const contentHash = hashCode(data);
    const cacheKey = `tabsCache_${url}`;
    if (!forceRefresh) {
      try {
        const cachedStr = await AsyncStorage.getItem(cacheKey);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr);
          if (cached.hash === contentHash && cached.tabs) return cached.tabs;
        }
      } catch {}
    }

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

    if (mapTabUrl) {
      try {
        const mapRes = await axios.get(mapTabUrl, { timeout: 3500 });
        const cleanText = mapRes.data
          .replace(/<\/tr>|<\/p>|<br\s*\/?>/gi, '\n')
          .replace(/<\/td>/gi, ' - ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        await AsyncStorage.setItem(`courseMapText_${url}`, cleanText);
        const baseSheetUrl = url.split('/sheet')[0];
        await AsyncStorage.setItem(`courseMapText_${baseSheetUrl}`, cleanText);
      } catch {}
    }
    
    if (rawTabs.length === 0) return [];

    const rawNames = rawTabs.map(t => t.rawName);
    const parsedNames = await parseTabsWithAI(rawNames);
    
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

export async function fetchScheduleData(tabUrl: string, forceRefresh = false): Promise<ScheduleData> {
  const defaultData: ScheduleData = {
    info: { faculty: '', course: '', year: '', academicYear: '', channel: '', semester: '' },
    alerts: [],
    classrooms: [],
    days: [[], [], [], [], []],
  };

  try {
    const res = await axios.get(tabUrl);
    const html = res.data;

    // Check Cache con fingerprint deterministico (ignora i nonce variabili di Google)
    const contentFingerprint = extractSheetContentFingerprint(html);
    const cacheKey = `scheduleCache_v6_${tabUrl}`;
    const fpKey = `tabFingerprint_v6_${tabUrl}`;
    if (!forceRefresh) {
      try {
        const cachedStr = await AsyncStorage.getItem(cacheKey);
        const storedFp = await AsyncStorage.getItem(fpKey);
        if (cachedStr && storedFp === contentFingerprint) {
          const cached = JSON.parse(cachedStr);
          if (cached.data) {
            return cached.data;
          }
        }
      } catch {}
    }
    
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    const rows: string[][] = [];
    
    const classBgColors = extractClassBgColors(html);
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trContent = trMatch[1];
      const row: string[] = [];
      const tdRegex = /(<td[^>]*>)([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        const text = cleanTdCellHtml(tdMatch[1], tdMatch[2], classBgColors);
        row.push(text);
      }
      if (row.length > 0) rows.push(row);
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
      if (joined.includes('semestre')) {
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

    // Parsa con AI le celle delle lezioni
    const parsed: ParsedClass[] = await parseScheduleCells(allCells);

    // Mappa Mappa Edifici
    const uniqueRooms = Array.from(new Set(parsed.map(p => p.room).filter(Boolean)));
    let mapText = '';
    try {
      const baseSheetUrl = tabUrl.split('/sheet')[0];
      mapText = (await AsyncStorage.getItem(`courseMapText_${baseSheetUrl}`)) || '';
      if (!mapText) {
        const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
        if (storedUrl) {
          mapText = (await AsyncStorage.getItem(`courseMapText_${storedUrl}`)) || '';
        }
      }
    } catch {}

    if (!mapText) {
      mapText = headerRows.map(r => r.join(' ')).join('\n');
    }

    // UNIFICATO: Gemini analizza l'intera intestazione estraendo SIA il semestre SIA gli avvisi formattati SIA le aule reali
    const headerResult = await parseHeaderWithGemini(headerRows, mapText, uniqueRooms);
    data.info.semester = headerResult.semester || extractDeterministicSemester(headerRows) || data.info.semester;
    data.alerts = headerResult.alerts;
    const mappedRooms = headerResult.mappedRooms;

    const uniqueClassroomsMap = new Map<string, ClassroomInfo>();
    Object.values(mappedRooms).forEach(m => {
      const canon = getCanonicalRoomKey(m.displayName || m.key);
      if (!uniqueClassroomsMap.has(canon)) {
        const bCode = (m.building || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
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
          const bCode = (p.buildingCode || rawCellText.match(/RM\d{3}/i)?.[1] || '').toUpperCase();
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

          // 3. Se non ancora risolto, cerca in mappedRooms dall'intestazione
          if (!finalBuilding || !finalAddress) {
            const roomClean = roomLabel.replace(/^aula\s+/i, '').toLowerCase().trim();
            const dayNames = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi'];
            const currentDayStr = dayNames[day];
            
            const specificDayKey = Object.keys(mappedRooms).find(k => {
               const canonK = getCanonicalRoomKey(k);
               const hasRoom = new RegExp(`\\b${roomClean}\\b`, 'i').test(canonK);
               const hasDay = canonK.includes(currentDayStr);
               return hasRoom && hasDay;
            });

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
            finalAddress = formatSapienzaAddress(finalAddress, (finalBuilding.match(/RM\d{3}/i)?.[1]));
          }

          // Registra l'aula nella mappa aule del corso
          if (roomLabel) {
            const canon = getCanonicalRoomKey(roomLabel);
            if (!uniqueClassroomsMap.has(canon)) {
              uniqueClassroomsMap.set(canon, {
                aulaName: roomLabel,
                building: finalBuilding,
                address: finalAddress,
              });
            }
          }

          const cleanSubject = (p.subject || '').toUpperCase().trim();
          if (
            currentEvent &&
            currentEvent.subject === cleanSubject &&
            currentEvent.teacher === p.teacher
          ) {
            // Estendi la durata
            currentEvent.endTime = slot.time.split('-')[1] || slot.time;
            currentEvent.duration += 1;
          } else {
            if (currentEvent) events.push(currentEvent);
            const times = slot.time.split('-');
            currentEvent = {
              subject: cleanSubject,
              teacher: p.teacher,
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
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hash: contentFingerprint, data }));
      await AsyncStorage.setItem(`tabFingerprint_v6_${tabUrl}`, contentFingerprint);
    } catch {}

    return data;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return defaultData;
  }
}

/**
 * Scarica TUTTI i canali, orari e aule di un corso di laurea in una sola operazione ("in un'unica botta").
 * Memorizza tutto in un'unica cache locale in modo che Orario e Aule non debbano mai più fare richieste di rete.
 */
export async function fetchAllCourseData(
  degreeUrl: string,
  forceRefresh = false,
  onProgress?: (step: string, current: number, total: number) => void
): Promise<{ tabs: Tab[]; schedules: Record<string, ScheduleData> }> {
  const cacheKey = `allSchedules_v6_${degreeUrl}`;

  // Se non è richiesto un refresh forzato, prova a leggere dalla cache locale istantanea
  if (!forceRefresh) {
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.tabs && parsed.schedules && parsed.tabs.length > 0) {
          return parsed;
        }
      }
    } catch {}
  }

  onProgress?.('Caricamento canali disponibili...', 0, 1);
  const tabs = await fetchTabs(degreeUrl, forceRefresh);
  if (tabs.length === 0) {
    return { tabs: [], schedules: {} };
  }

  const schedules: Record<string, ScheduleData> = {};
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    onProgress?.(`Download ${i + 1}/${tabs.length}: ${tab.name}`, i + 1, tabs.length);
    try {
      const data = await fetchScheduleData(tab.url, forceRefresh);
      schedules[tab.url] = data;
    } catch (e) {
      console.warn(`Errore caricamento ${tab.name}:`, e);
    }
    // Breve pausa di 50ms per consentire il re-render fluido della progress bar
    if (i < tabs.length - 1) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // Calcola e memorizza il fingerprint complessivo dei canali
  // IMPORTANTE: leggiamo i tabFingerprint_* DOPO che fetchScheduleData li ha già salvati
  const tabFpList = await Promise.all(tabs.map(t => AsyncStorage.getItem(`tabFingerprint_v6_${t.url}`)));
  const combinedFingerprint = tabs.map((t, idx) => `${t.url}:${tabFpList[idx] || 'missing'}`).join('|');

  const result = { tabs, schedules, fingerprint: combinedFingerprint };
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify(result));
    await AsyncStorage.setItem(`courseFingerprint_v6_${degreeUrl}`, combinedFingerprint);
    await AsyncStorage.setItem(`lastCheckTime_${degreeUrl}`, Date.now().toString());
  } catch {}

  return result;
}

export interface UpdateCheckResult {
  hasChanges: boolean;
  reason?: string;
}

/**
 * Controlla all'avvio se il Google Sheet ufficiale ha subito modifiche
 * (es. variazione orario, spostamento aula, o nuovo avviso in bacheca).
 * Scarica in parallelo i tab noti e ne confronta l'impronta deterministica (~400ms).
 */
export async function checkCourseUpdates(degreeUrl: string): Promise<UpdateCheckResult> {
  try {
    const cacheKey = `allSchedules_v6_${degreeUrl}`;
    const stored = await AsyncStorage.getItem(cacheKey);
    if (!stored) {
      return { hasChanges: true, reason: 'Nessun dato locale trovato' };
    }

    const parsed = JSON.parse(stored);
    if (!parsed.tabs || parsed.tabs.length === 0 || !parsed.schedules) {
      return { hasChanges: true, reason: 'Dati locali incompleti' };
    }

    // 1. Scarica in parallelo i soli tab del corso con timeout ridotto (3.0s) per ingresso fulmineo
    const tabFetches = await Promise.all(
      parsed.tabs.map((t: Tab) =>
        axios.get(t.url, { timeout: 3000 }).then(r => ({ url: t.url, html: r.data })).catch(() => null)
      )
    );

    const validFetches = tabFetches.filter(Boolean);
    if (validFetches.length === 0) {
      return { hasChanges: false }; // Offline o timeout: entra subito con i dati locali
    }

    const currentFps: Record<string, string> = {};
    for (const item of validFetches) {
      if (!item) continue;
      currentFps[item.url] = extractSheetContentFingerprint(item.html);
    }

    // 2. Controllo canale per canale:
    // C'è una modifica reale SOLO SE un tab scaricato con successo ha un'impronta diversa
    // da quella memorizzata. Se un tab è andato in timeout, non generiamo falsi allarmi.
    let hasRealChanges = false;
    let changeReason = '';

    for (const tab of parsed.tabs) {
      const liveFp = currentFps[tab.url];
      if (!liveFp) continue; // Tab non risposto in tempo: consideralo invariato per evitare falsi allarmi

      const storedTabFp = await AsyncStorage.getItem(`tabFingerprint_v6_${tab.url}`);

      // Se non avevamo ancora memorizzato il fingerprint per questo canale, allinealo senza riscaricare
      if (!storedTabFp) {
        await AsyncStorage.setItem(`tabFingerprint_v6_${tab.url}`, liveFp);
        continue;
      }

      if (liveFp !== storedTabFp) {
        hasRealChanges = true;
        changeReason = `Rilevate modifiche per ${tab.name}`;
        break;
      }
    }

    if (hasRealChanges) {
      return { hasChanges: true, reason: changeReason || 'Rilevate modifiche all\'orario o agli avvisi' };
    }

    // Nessuna modifica rilevata: orari identici
    return { hasChanges: false };
  } catch (e) {
    console.warn('Verifica aggiornamenti saltata:', e);
    return { hasChanges: false };
  }
}


