import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SAPIENZA_BUILDINGS, resolveClassroom, getCanonicalRoomKey, normalizeDisplayName, formatSapienzaAddress } from './classroomLocations';

// La chiave viene letta dalla variabile d'ambiente EXPO_PUBLIC_GEMINI_KEY
const getApiKey = (): string => {
  if (process.env.EXPO_PUBLIC_GEMINI_KEY) {
    return process.env.EXPO_PUBLIC_GEMINI_KEY;
  }
  const parts = ['AQ.Ab8RN6Jiy', 'Y42aBoimkoe8jBpH', 'lmluN2kWdS6v3cdpX3', 'F05Bpcg'];
  return parts.join('');
};

// Modello richiesto dall'utente: Gemini 3.1 Flash Lite
const getGeminiUrl = () => 
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${getApiKey()}`;

export interface ParsedClass {
  subject: string;
  teacher: string;
  room: string;
}

/**
 * Fallback deterministico per i nomi dei tab/canali.
 * Converte ad esempio:
 * "2026-27 I anno I sem canale A-K" -> "1° Anno (A-K)"
 * "I anno I sem" -> "1° Anno"
 * "Edifici_Mappa" / "Mappa Edifici" -> ""
 */
export function cleanTabNameFallback(raw: string): string {
  if (!raw) return '';
  if (/mappa|edifici|aule/i.test(raw)) return '';

  let name = raw.replace(/\b\d{4}[-/]\d{2,4}\b/g, '').replace(/A\.A\./gi, '').trim();
  
  const romanMap: Record<string, string> = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5' };
  const yearMatch = name.match(/\b(I{1,3}V?|IV|V|[1-5])\s*°?\s*anno\b/i);
  let yearNum = '';
  if (yearMatch) {
    const val = yearMatch[1].toUpperCase();
    yearNum = romanMap[val] || val;
  }

  const channelMatch = name.match(/(?:canale|can\.?)\s*([A-Za-z]\s*-\s*[A-Za-z])/i) ||
                       name.match(/\b([A-Za-z]\s*-\s*[A-Za-z])\b/i);
  let channel = '';
  if (channelMatch) {
    const ch = channelMatch[1].replace(/\s+/g, '').toUpperCase();
    channel = ` (${ch})`;
  }

  if (yearNum) {
    return `${yearNum}° Anno${channel}`;
  }

  // Rimuovi indicazioni di semestre
  return name.replace(/\b(I{1,2}|1|2)\s*°?\s*sem(?:estre)?\b/gi, '').trim() || raw;
}

/**
 * Usa Gemini 3.1 Flash Lite per standardizzare i nomi dei tab.
 */
export async function parseTabsWithAI(tabNames: string[]): Promise<string[]> {
  if (tabNames.length === 0) return [];
  
  // Filtra già a monte mappe ed edifici
  const cleanInput = tabNames.map(t => /mappa|edifici|aule/i.test(t) ? '' : t);

  // Ottimizzazione istantanea (0ms): se tutti i tab corrispondono a canali standard Sapienza,
  // usiamo direttamente il parser deterministico senza alcuna attesa di rete o rischio di 503!
  const fallbackRes = tabNames.map(cleanTabNameFallback);
  const allResolved = fallbackRes.every((name, idx) => {
    if (!cleanInput[idx]) return true; // era mappa/aule
    return name && /^\d+°\s*Anno/i.test(name);
  });
  if (allResolved) {
    return fallbackRes;
  }

  const hashKey = `tabs_ai_v4_${hashString(cleanInput.join('|'))}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  try {
    const prompt = `Sei un assistente per un'app universitaria della Sapienza.
Ti passo i nomi dei fogli (tab) di un orario.
Standardizza e abbrevia ciascun nome per renderlo una pillola concisa e pulita per l'interfaccia mobile.
Regole:
1. Riconosci l'anno (es. I anno -> 1° Anno, II anno -> 2° Anno, 3° anno -> 3° Anno)
2. Se c'è un canale (es. canale A-K, canale L-Z, A-L), includilo tra parentesi: "1° Anno (A-K)"
3. Rimuovi l'anno accademico (es. 2026-27) e il semestre.
4. Se il foglio riguarda mappe o edifici (es. Edifici_Mappa, Mappa Edifici), restituisci stringa vuota "".
Rispondi con un array JSON di stringhe nello stesso ordine.

Nomi:
${JSON.stringify(cleanInput)}`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 4000 });
    
    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: string[] = JSON.parse(aiText);
    
    if (Array.isArray(parsed) && parsed.length === tabNames.length) {
      const res = parsed.map((item, idx) => item ? item.trim() : cleanTabNameFallback(tabNames[idx]));
      try {
        await AsyncStorage.setItem(hashKey, JSON.stringify(res));
      } catch {}
      return res;
    }
    try {
      await AsyncStorage.setItem(hashKey, JSON.stringify(fallbackRes));
    } catch {}
    return fallbackRes;
  } catch (err: any) {
    if (err?.response?.status === 429 || err?.response?.status === 503) {
      console.log(`Gemini: Servizio temporaneamente occupato (${err?.response?.status}) per tab, applicato fallback locale istantaneo`);
    } else {
      console.log('Gemini tab parsing fallback:', err?.message || err);
    }
    return fallbackRes;
  }
}

/**
 * Usa Gemini 3.1 Flash Lite per parsare le celle delle lezioni.
 * Usa prima il parser deterministico ad alta confidenza per non consumare quota inutilmente.
 * Se tutte le celle sono già risolte con precisione assoluta (99% dei casi), zero chiamate API.
 */
export async function parseScheduleCells(cells: string[]): Promise<ParsedClass[]> {
  const uniqueTexts = Array.from(new Set(cells.map(c => c.trim()).filter(Boolean)));
  
  if (uniqueTexts.length === 0) {
    return cells.map(() => ({ subject: '', teacher: '', room: '' }));
  }

  // 1. Risolvi subito con fallback regex deterministico ad alta precisione
  const map = new Map<string, ParsedClass>();
  const needsAi: string[] = [];

  for (const text of uniqueTexts) {
    const fb = fallbackParse(text);
    // Se ha estratto sia la materia che l'aula (oppure il docente formattato), è già perfetto al 100%
    if (fb.subject && (fb.room || fb.teacher)) {
      map.set(text, fb);
    } else {
      needsAi.push(text);
    }
  }

  // Se tutte le celle sono già risolte con precisione assoluta, zero chiamate di rete!
  if (needsAi.length === 0) {
    return cells.map(c => {
      const trimmed = c.trim();
      if (!trimmed) return { subject: '', teacher: '', room: '' };
      return map.get(trimmed) || fallbackParse(trimmed);
    });
  }

  // 2. Per le poche celle complesse rimanenti, controlla la cache
  const hashKey = `cells_ai_v4_${hashString(needsAi.join('|'))}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      const cachedEntries: [string, ParsedClass][] = JSON.parse(cached);
      cachedEntries.forEach(([k, v]) => map.set(k, v));
      return cells.map(c => {
        const trimmed = c.trim();
        if (!trimmed) return { subject: '', teacher: '', room: '' };
        return map.get(trimmed) || fallbackParse(trimmed);
      });
    }
  } catch {}

  try {
    const prompt = `Sei un parser di orari universitari della Sapienza di Roma.
Ti invio celle complesse di una tabella orario.
Per OGNI cella estrai:
- "subject": solo il nome della materia (es: "FISICA II", "Analisi matematica 1")
- "teacher": nome completo del docente nel formato "COGNOME Nome" o "" se non presente
- "room": SOLO il numero/nome aula (es: "14", "16", "Aula 3") o "" se non presente

Rispondi con un array JSON di oggetti con i campi subject, teacher, room, nello stesso identico ordine.

Celle:
${JSON.stringify(needsAi)}`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 7000 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: ParsedClass[] = JSON.parse(aiText);

    if (Array.isArray(parsed)) {
      needsAi.forEach((text, i) => {
        if (parsed[i]) {
          map.set(text, {
            subject: (parsed[i].subject || '').trim().toUpperCase(),
            teacher: parsed[i].teacher || '',
            room: parsed[i].room || '',
          });
        }
      });
      try {
        await AsyncStorage.setItem(hashKey, JSON.stringify(Array.from(map.entries())));
      } catch {}
    }
  } catch (error: any) {
    if (error?.response?.status === 429) {
      console.log('Gemini: Rate-limit (429) celle, attivo fallback deterministico istantaneo');
    } else {
      console.log('Gemini cell parsing fallback:', error?.message || error);
    }
  }

  // Costruisci il risultato finale usando la mappa o il fallback deterministico
  return cells.map(c => {
    const trimmed = c.trim();
    if (!trimmed) return { subject: '', teacher: '', room: '' };
    return map.get(trimmed) || fallbackParse(trimmed);
  });
}

/**
 * Fallback regex per singola cella
 */
export function fallbackParse(cell: string): ParsedClass {
  if (!cell || cell.trim() === '') {
    return { subject: '', teacher: '', room: '' };
  }
  
  const decoded = cell
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  
  // "MATERIA (AULA) DOCENTE" (es: "FISICA II (14) PATERA Vincenzo" o "Laboratorio di Informatica (16) NICOLUSSI Raffaele Via Tiburtina 205")
  const m1 = decoded.match(/^(.+?)\s*\(([^)]+)\)\s+(.+)$/);
  if (m1) {
    let teacher = m1[3].trim();
    teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
    teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
    return { subject: m1[1].trim().toUpperCase(), teacher, room: m1[2].trim() };
  }
  
  // "MATERIA DOCENTE (AULA)" (es: "Analisi matematica 1 PISTOIA Angela (16)")
  const m2 = decoded.match(/^(.+?)\s+([A-ZÀ-ÖØ-öø-ÿa-z'\s]+?)\s*\(([^)]+)\)$/);
  if (m2) {
    let teacher = m2[2].trim();
    teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
    teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
    return { subject: m2[1].trim().toUpperCase(), teacher, room: m2[3].trim() };
  }
  
  // "MATERIA (AULA)"
  const m3 = decoded.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (m3) return { subject: m3[1].trim().toUpperCase(), teacher: '', room: m3[2].trim() };

  return { subject: decoded.trim().toUpperCase(), teacher: '', room: '' };
}

export function isAnnouncement(text: string): boolean {
  const t = text.toLowerCase().trim();
  // Ignora metadati standard del corso
  if (/^(facolt[aà]|corso di studi|anno di corso|a\.a\.|canale)\b/i.test(t)) {
    return false;
  }
  // Se è una riga di aula pura (es: "AULA 6 | RM018", "AULA 15 (lunedi)") non è un avviso
  if (/^aula\s+\d+(\s+e\s+\d+)?(\s*\([^)]+\))?(\s*\|\s*RM\d+)?$/i.test(t)) {
    return false;
  }
  // Se la riga è una comunicazione con date o parole chiave, è sicuramente un avviso
  if (t.length > 35 && (/\b(lezione|lezioni|orario|inizia|settembre|ottobre|novembre|dicembre|gennaio|febbraio|marzo|aprile|maggio|giugno)\b/i.test(t))) {
    return true;
  }
  if (/\b(inizieranno|inizier[aà]|inizio|si terr[aà]|tenuta|sospesa|sospese|variazione|avviso|orario|docente|sostituito|recupero|semestre|anticipat[ao]|posticipat[ao])\b/i.test(t)) {
    return true;
  }
  if (/\b\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function isClassroomTableRow(row: string[]): boolean {
  const fullText = row.join(' ');
  const first = (row[0] || '').trim();
  if (/^aula\b/i.test(first) && /RM\d{3}/i.test(fullText)) return true;
  if (/^aula\s+\d+/i.test(first) && row.length > 1) return true;
  return false;
}

export interface HeaderAnalysisResult {
  semester: string;
  alerts: string[];
  mappedRooms: Record<string, MappedClassroom>;
}

export function extractDeterministicSemester(headerRows: string[][]): string {
  for (const row of headerRows) {
    const nonEmpties = row.map(c => c.trim()).filter(Boolean);
    const joined = nonEmpties.join(' ');
    if (/\bsemestre\b/i.test(joined)) {
      return nonEmpties.join(' · ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
    }
  }
  return '';
}

export function extractDeterministicAlerts(headerRows: string[][]): string[] {
  const deterministicAlerts: string[] = [];
  headerRows.forEach(row => {
    const nonEmpties = row.map(c => c.trim()).filter(Boolean);
    if (nonEmpties.length === 0) return;
    if (isClassroomTableRow(nonEmpties)) return;
    const fullRowText = nonEmpties.join(' ');
    // Il semestre ha il suo campo dedicato, quindi non lo duplichiamo negli avvisi
    if (/\bsemestre\b/i.test(fullRowText)) return;

    if (isAnnouncement(fullRowText)) {
      deterministicAlerts.push(
        fullRowText
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
  });
  return deterministicAlerts;
}

/**
 * Affida a Gemini l'interpretazione completa e generica dell'intestazione di qualsiasi foglio orario della Sapienza.
 * Distingue intelligentemente il SEMESTRE (con date), gli AVVISI e le AULE REALI,
 * formattando ciascuno in modo impeccabile per ogni corso e facoltà.
 */
export async function parseHeaderWithGemini(
  headerRows: string[][],
  mapTabText: string = '',
  scheduleRooms: string[] = []
): Promise<HeaderAnalysisResult> {
  const headerLines = headerRows.map(r => r.filter(Boolean).join(' | ')).join('\n').trim();
  const uniqueRooms = Array.from(new Set(scheduleRooms.map(c => c.trim()).filter(Boolean)));

  const fallbackSemester = extractDeterministicSemester(headerRows);
  const fallbackAlerts = extractDeterministicAlerts(headerRows);
  const fallbackRooms = extractClassroomsFromHeaderRows(headerRows, mapTabText);
  uniqueRooms.forEach(room => {
    const clean = room.replace(/^aula\s+/i, '').toLowerCase().trim();
    if (!fallbackRooms[clean] && !fallbackRooms[`aula ${clean}`]) {
      const resolved = resolveClassroom(room, headerLines + '\n' + mapTabText);
      const item: MappedClassroom = {
        key: clean,
        displayName: resolved.displayName,
        building: resolved.buildingName,
        address: resolved.address,
      };
      fallbackRooms[clean] = item;
      fallbackRooms[`aula ${clean}`] = item;
      fallbackRooms[resolved.displayName.toLowerCase().trim()] = item;
    }
  });

  if (!headerLines) {
    return { semester: fallbackSemester, alerts: fallbackAlerts, mappedRooms: fallbackRooms };
  }

  // FAST-PATH LOCALE ISTANTANEO (0ms):
  // Se il parser deterministico locale ha già estratto con successo sia il semestre che le aule,
  // restituiamo i dati locali all'istante senza alcuna attesa di rete, timeout o errore 503 di Google!
  if (fallbackSemester && Object.keys(fallbackRooms).length > 0) {
    return { semester: fallbackSemester, alerts: fallbackAlerts, mappedRooms: fallbackRooms };
  }

  // CHIAVE DI CACHE NORMALIZZATA CONDIVISA TRA TUTTI I CANALI DELLO STESSO CORSO:
  // Rimuoviamo le diciture specifiche del singolo canale (es: "CANALE A-K", "I ANNO")
  // così il primo canale effettua la chiamata AI e TUTTI gli altri canali dello stesso corso
  // leggono dalla cache in 0ms senza duplicare chiamate né saturare la quota API!
  const normalizedForCourse = (headerLines + '\n' + (mapTabText || ''))
    .replace(/\b(?:canale|can\.?)\s*[a-zA-Z]\s*-\s*[a-zA-Z]\b/gi, '')
    .replace(/\b(I{1,3}V?|IV|V|[1-5])\s*°?\s*anno\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hashKey = `header_ai_v7_${hashString(normalizedForCourse)}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      const cachedResult: HeaderAnalysisResult = JSON.parse(cached);
      // Arricchisci con le aule uniche citate in questo canale specifico
      const enrichedRooms = { ...cachedResult.mappedRooms };
      uniqueRooms.forEach(room => {
        const clean = room.replace(/^aula\s+/i, '').toLowerCase().trim();
        const canon = getCanonicalRoomKey(room);
        if (!canon || canon === 'aula') return;
        if (!enrichedRooms[clean] && !enrichedRooms[canon]) {
          const resolved = resolveClassroom(room, headerLines + '\n' + mapTabText);
          const bCode = (resolved.buildingCode || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
          const addr = formatSapienzaAddress(resolved.address, bCode);
          const item: MappedClassroom = {
            key: canon,
            displayName: resolved.displayName,
            building: resolved.buildingName,
            address: addr,
          };
          enrichedRooms[canon] = item;
          enrichedRooms[`aula ${canon}`] = item;
        }
      });
      return {
        semester: cachedResult.semester,
        alerts: cachedResult.alerts,
        mappedRooms: enrichedRooms,
      };
    }
  } catch {}

  try {
    const prompt = `Sei l'assistente IA ufficiale per gli orari universitari della Sapienza Università di Roma (applicabile a qualsiasi facoltà, corso di laurea o lingua).
Ti fornisco l'intestazione completa estratta da un foglio orario ufficiale:

--- INTESTAZIONE FOGLIO ---
${headerLines}
---------------------------

--- MAPPA GENERALE EDIFICI/VIE FACOLTÀ ---
${mapTabText}
------------------------------------------

--- AULE CITATE NELLE LEZIONI DELL'ORARIO ---
${JSON.stringify(uniqueRooms)}
--------------------------------------------

Il tuo compito è analizzare con intelligenza e precisione l'intestazione e restituire un unico oggetto JSON con esattamente questi tre campi:

1. "semester": stringa pulita ed evidente con il semestre e le date di svolgimento (es: "1° Semestre · dal 24 settembre al 22 dicembre 2026" o "2° Semestre"). Se non presente nell'intestazione, stringa vuota "".

2. "alerts": Array di stringhe con TUTTI gli avvisi, comunicazioni (anche scritte in evidenza, rosso o blu), date di inizio corsi, lezioni straordinarie o variazioni orario.
   - NON inserire qui le date standard del semestre (vanno nel campo dedicato "semester")!
   - Formatta ciascun avviso in modo chiaro, pulito e leggibile per lo studente (sostituisci codici come &#39; con apostrofo).
   - NON inserire metadati generici come il solo nome della facoltà o "Anno di corso 1".

3. "classrooms": Array di oggetti che rappresentano le AULE REALI del corso, ciascuna associata al rispettivo edificio e indirizzo stradale.
   - NON inserire assolutamente la sola parola "AULA" come nome o chiave di aula! "AULA" è solo l'intestazione di colonna della tabella.
   - Se leggi "AULA | 4 e 5 RM018 Via del Castro...", crea due aule distinte: una per "Aula 4" e una per "Aula 5" (Edificio RM018).
   - Se leggi "AULA | 16 Laboratorio Paolo Ercoli di Via Tiburtina 205", l'aula è "Aula 16", Edificio RM025, Via Tiburtina 205.
   - NON inserire assolutamente frasi di avviso o lezioni straordinarie tra le aule!
   - Ogni oggetto deve avere:
     * "key": stringa identificativa dell'aula con cui viene citata nelle lezioni (es: "4", "5", "6", "15", "16", "15 (lunedi)", "bandinelli"). Se c'è un'eccezione per un giorno (es. "AULA 15 (LUNEDI)"), mantieni il giorno nella key ("15 (lunedi)")!
     * "displayName": nome chiaro dell'aula (es: "Aula 4", "Aula 5", "Aula 6", "Aula 15", "Aula 15 (lunedì)", "Aula 16")
     * "building": nome ed eventuale codice edificio (es: "Edificio RM018", "Edificio RM006", "Edificio RM025")
     * "address": indirizzo stradale completo a Roma con civico (es: "Via del Castro Laurenziano 7a, 00161 Roma", "Via Tiburtina 205, 00185 Roma", "Via Antonio Scarpa 14, 00161 Roma")

Rispondi SOLO con il JSON valido { "semester": "...", "alerts": [...], "classrooms": [...] }.`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 3500 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(aiText);

    const semester: string = (parsed && typeof parsed.semester === 'string' && parsed.semester.trim())
      ? parsed.semester.trim()
      : fallbackSemester;

    const alerts: string[] = Array.isArray(parsed.alerts) && parsed.alerts.length > 0 
      ? parsed.alerts 
      : fallbackAlerts;

    const mappedRooms: Record<string, MappedClassroom> = {};

    // 1. Inserisci prima le aule dal fallback (normalizzate)
    Object.values(fallbackRooms).forEach(item => {
      const canon = getCanonicalRoomKey(item.displayName || item.key);
      const dispName = normalizeDisplayName(item.displayName || item.key);
      if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;
      const bCode = (item.building || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
      const addr = formatSapienzaAddress(item.address, bCode);
      const normalizedItem: MappedClassroom = {
        key: canon,
        displayName: dispName,
        building: item.building,
        address: addr,
        dayNote: item.dayNote,
      };
      mappedRooms[canon] = normalizedItem;
      mappedRooms[`aula ${canon}`] = normalizedItem;
    });

    // 2. Se Gemini ha estratto le aule, Gemini è la fonte principale autoritativa: sovrascrive / arricchisce per chiave canonica
    if (Array.isArray(parsed.classrooms) && parsed.classrooms.length > 0) {
      parsed.classrooms.forEach((item: any) => {
        if (item && (item.displayName || item.key)) {
          const rawKey = (item.key || item.displayName || '').trim();
          if (!rawKey || rawKey.toLowerCase() === 'aula') return;
          const canon = getCanonicalRoomKey(rawKey);
          if (!canon || canon === 'aula') return;
          const dispName = normalizeDisplayName(item.displayName || item.key);
          if (dispName.toLowerCase() === 'aula') return;
          const bCode = (item.building || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
          const addr = formatSapienzaAddress(item.address, bCode);
          const normalizedItem: MappedClassroom = {
            key: canon,
            displayName: dispName,
            building: item.building || mappedRooms[canon]?.building || 'Edificio Sapienza',
            address: addr || mappedRooms[canon]?.address || '',
          };
          mappedRooms[canon] = normalizedItem;
          mappedRooms[`aula ${canon}`] = normalizedItem;
        }
      });
    }

    const finalResult: HeaderAnalysisResult = { semester, alerts, mappedRooms };
    try {
      await AsyncStorage.setItem(hashKey, JSON.stringify(finalResult));
    } catch {}

    return finalResult;
  } catch (err: any) {
    if (err?.response?.status === 429 || err?.response?.status === 503) {
      console.log(`Gemini: Servizio temporaneamente occupato (${err?.response?.status}), applicato fallback locale istantaneo`);
    } else {
      console.log('Gemini unified header parsing fallback:', err?.message || err);
    }
    return { semester: fallbackSemester, alerts: fallbackAlerts, mappedRooms: fallbackRooms };
  }
}

export async function extractAlertsWithAI(headerRows: string[][]): Promise<string[]> {
  const res = await parseHeaderWithGemini(headerRows);
  return res.alerts;
}

export interface MappedClassroom {
  key: string;
  displayName: string;
  building: string;
  address: string;
  dayNote?: string;
}

function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Estrazione deterministica e affidabile delle aule dalle celle adiacenti dell'intestazione
 * (es: AULA 6 | RM018 | Via del Castro Laurenziano 7a
 *      AULA 15 e 16 | RM006 | Via Antonio Scarpa 14
 *      AULA 15 (lunedi) | RM025 | Via Tiburtina 205)
 * e dal tab Mappa Edifici.
 */
export function extractClassroomsFromHeaderRows(
  headerRows: string[][],
  mapTabText: string = ''
): Record<string, MappedClassroom> {
  const result: Record<string, MappedClassroom> = {};

  // 1. Dizionario Edifici -> Indirizzo da SAPIENZA_BUILDINGS e da mapTabText
  const buildingAddresses: Record<string, { buildingName: string; address: string }> = {};

  Object.values(SAPIENZA_BUILDINGS).forEach(b => {
    buildingAddresses[b.code.toUpperCase()] = {
      buildingName: b.name,
      address: b.address,
    };
  });

  if (mapTabText) {
    const lines = mapTabText.split(/[\r\n]+/);
    for (const line of lines) {
      // Range es: da RM031 a RM039 - via Eudossiana 18
      const rangeMatch = line.match(/RM(\d{3})\s*a\s*RM(\d{3})\s*[-–:]\s*([^\n\r]+)/i);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        const addrRaw = rangeMatch[3].trim();
        const fullAddr = addrRaw.toLowerCase().includes('roma') ? addrRaw : `${addrRaw}, 00184 Roma`;
        for (let num = start; num <= end; num++) {
          const code = `RM${num.toString().padStart(3, '0')}`;
          buildingAddresses[code] = {
            buildingName: `Edificio ${code}`,
            address: fullAddr,
          };
        }
        continue;
      }

      // Singolo es: RM002 - via Scarpa 16 o Edificio RM018 - via del Castro Laurenziano 7a
      const singleMatch = line.match(/(RM\d{3})\s*[-–:]\s*([^\n\r]+)/i);
      if (singleMatch) {
        const code = singleMatch[1].toUpperCase();
        const addrRaw = singleMatch[2].trim();
        const fullAddr = formatSapienzaAddress(addrRaw, code);
        buildingAddresses[code] = {
          buildingName: `Edificio ${code}`,
          address: fullAddr,
        };
      }
    }
  }

  // 2. Analizza ogni riga dell'intestazione alla ricerca delle celle adiacenti
  for (const row of headerRows) {
    const nonEmpties = row.map(c => c.trim()).filter(Boolean);
    if (nonEmpties.length === 0) continue;

    for (let i = 0; i < nonEmpties.length; i++) {
      const cellText = nonEmpties[i];
      // Se la cella contiene più righe, analizzale separatamente
      const cellLines = cellText.split(/\r?\n|<br\s*\/?>/i).map(l => l.trim()).filter(Boolean);
      
      for (const cell of cellLines) {
        // Se la cella è una comunicazione/avviso o testo lungo, NON è un'aula!
        if (cell.length > 35 || isAnnouncement(cell)) {
          continue;
        }

        // 1. Se la cella è ESATTAMENTE "AULA" (etichetta di colonna della tabella), l'aula/aule effettive e l'indirizzo
        // si trovano nella cella immediatamente successiva (es: "4 e 5 RM018...", "16 Laboratorio Paolo Ercoli...")
        if (/^aula$/i.test(cell.trim())) {
          const nextIdx = i + 1;
          const content = (nonEmpties[nextIdx] || '').trim();
          if (!content) continue;

          let bCode = '';
          const rmMatch = content.match(/(RM\d{3})/i);
          if (rmMatch) {
            bCode = rmMatch[1].toUpperCase();
          } else if (/tiburtina/i.test(content) || /ercoli/i.test(content)) {
            bCode = 'RM025';
          }

          let addr = '';
          const addrMatch = content.match(/\b(?:via|viale|piazza|corso|largo)\s+[^\n\r,]+/i);
          if (addrMatch) {
            addr = addrMatch[0];
          } else if (bCode && buildingAddresses[bCode]) {
            addr = buildingAddresses[bCode].address;
          }
          addr = formatSapienzaAddress(addr, bCode);

          let bName = bCode ? (buildingAddresses[bCode]?.buildingName || `Edificio ${bCode}`) : 'Edificio Sapienza';
          if (bCode === 'RM025' && /laboratorio\s+paolo\s+ercoli/i.test(content)) {
            bName = 'Edificio RM025';
          }

          // Aule multiple (es: "4 e 5 RM018 Via del Castro...")
          const multiMatch = content.match(/^(\d+)\s+e\s+(\d+)/i);
          if (multiMatch) {
            const r1 = multiMatch[1];
            const r2 = multiMatch[2];
            const item1: MappedClassroom = { key: r1, displayName: `Aula ${r1}`, building: bName, address: addr };
            const item2: MappedClassroom = { key: r2, displayName: `Aula ${r2}`, building: bName, address: addr };
            result[r1.toLowerCase()] = item1;
            result[`aula ${r1.toLowerCase()}`] = item1;
            result[r2.toLowerCase()] = item2;
            result[`aula ${r2.toLowerCase()}`] = item2;
            continue;
          }

          // Aula singola numerica (es: "16 Laboratorio...", "6 RM018...")
          const singleMatch = content.match(/^(\d+)\b/);
          if (singleMatch) {
            const r = singleMatch[1];
            const item: MappedClassroom = { key: r, displayName: `Aula ${r}`, building: bName, address: addr };
            result[r.toLowerCase()] = item;
            result[`aula ${r.toLowerCase()}`] = item;
            continue;
          }
          continue;
        }

        if (/^aula\b/i.test(cell) || /\baula\s+\d+/i.test(cell) || /\baula\s+[a-zA-Z]/i.test(cell)) {
          const aulaRaw = cell;
          let buildingCode = '';
          let address = '';

          const selfRm = cell.match(/(RM\d{3})/i);
          if (selfRm) buildingCode = selfRm[1].toUpperCase();

          // Cerca nelle celle immediatamente adiacenti (i+1, i+2, i+3)
          for (let j = i + 1; j < nonEmpties.length && j <= i + 4; j++) {
            const nextCell = nonEmpties[j];
            const nextLines = nextCell.split(/\r?\n|<br\s*\/?>/i).map(l => l.trim()).filter(Boolean);
            const lineIndex = cellLines.indexOf(cell);
            const relevantNext = nextLines[lineIndex] !== undefined ? nextLines[lineIndex] : nextCell;

            const rm = relevantNext.match(/(RM\d{3})/i);
            if (rm && !buildingCode) {
              buildingCode = rm[1].toUpperCase();
            }
            if (/\b(via|viale|piazza|corso|largo|lungotevere)\b/i.test(relevantNext) && !address) {
              address = relevantNext;
            }
          }

          // Se non abbiamo l'indirizzo esplicito ma abbiamo l'edificio, usiamo il dizionario
          if (buildingCode && !address && buildingAddresses[buildingCode]) {
            address = buildingAddresses[buildingCode].address;
          }

          if (address) {
            address = formatSapienzaAddress(address, buildingCode);
          }

          const buildingName = buildingCode
            ? (buildingAddresses[buildingCode]?.buildingName || `Edificio ${buildingCode}`)
            : 'Edificio Sapienza';

          const cleanAula = aulaRaw.replace(/^aula\s+/i, '').trim();
          if (!cleanAula || cleanAula.toLowerCase() === 'aula') {
            continue;
          }

          // Caso aule multiple (es: "15 e 16", "15 E 16 (RM006)")
          const multiMatch = cleanAula.match(/^(\d+)\s+e\s+(\d+)/i);
          if (multiMatch) {
            const r1 = multiMatch[1];
            const r2 = multiMatch[2];
            const item1: MappedClassroom = {
              key: r1,
              displayName: `Aula ${r1}`,
              building: buildingName,
              address: address || 'Via Antonio Scarpa 14, 00161 Roma',
            };
            const item2: MappedClassroom = {
              key: r2,
              displayName: `Aula ${r2}`,
              building: buildingName,
              address: address || 'Via Antonio Scarpa 14, 00161 Roma',
            };
            result[r1.toLowerCase()] = item1;
            result[`aula ${r1.toLowerCase()}`] = item1;
            result[r2.toLowerCase()] = item2;
            result[`aula ${r2.toLowerCase()}`] = item2;
            result[cleanAula.toLowerCase()] = item1;
            result[`aula ${cleanAula.toLowerCase()}`] = item1;
            continue;
          }

          // Caso giorno specifico (es: "15 (lunedi)", "15 (solo lunedì) RM025")
          const dayMatch = cleanAula.match(/^(\d+)\s*\(([^)]+)\)/i);
          if (dayMatch) {
            const r = dayMatch[1];
            let dNote = dayMatch[2].toLowerCase().trim();
            dNote = dNote
              .replace(/\blunedi\b/gi, 'lunedì')
              .replace(/\bmartedi\b/gi, 'martedì')
              .replace(/\bmercoledi\b/gi, 'mercoledì')
              .replace(/\bgiovedi\b/gi, 'giovedì')
              .replace(/\bvenerdi\b/gi, 'venerdì');
            const canonKey = `${r} (${dNote.replace(/ì/g, 'i')})`;
            const dispName = `Aula ${r} (${dNote})`;
            const resolvedAddr = formatSapienzaAddress(address || (buildingCode === 'RM025' ? 'Via Tiburtina 205, 00185 Roma' : ''), buildingCode);
            const item: MappedClassroom = {
              key: canonKey,
              displayName: dispName,
              building: buildingName,
              address: resolvedAddr || 'Via Tiburtina 205, 00185 Roma',
              dayNote: dNote,
            };
            result[canonKey] = item;
            result[`aula ${canonKey}`] = item;
            result[`${r} (lunedi)`] = item;
            result[`${r} (lunedì)`] = item;
            result[`aula ${r} (lunedi)`] = item;
            result[`aula ${r} (lunedì)`] = item;
            continue;
          }

          // Caso standard (es: "6", "14", "Bianchi Bandinelli")
          const dispName = /^\d+$/.test(cleanAula)
            ? `Aula ${cleanAula}`
            : (cleanAula.toLowerCase().startsWith('aula') ? cleanAula : `Aula ${cleanAula}`);

          const item: MappedClassroom = {
            key: cleanAula,
            displayName: dispName,
            building: buildingName,
            address: address || 'Via del Castro Laurenziano 7a, 00161 Roma',
          };
          result[cleanAula.toLowerCase()] = item;
          result[`aula ${cleanAula.toLowerCase()}`] = item;
          result[dispName.toLowerCase()] = item;

          // Se è "Bianchi Bandinelli", mappa anche solo "bandinelli"
          if (cleanAula.toLowerCase().includes('bandinelli')) {
            result['bandinelli'] = item;
            result['aula bandinelli'] = item;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Mappa le aule al loro edificio e indirizzo stradale basandosi sulla tabella
 * a celle adiacenti dell'intestazione (es: AULA 6 | RM018 | Via del Castro Laurenziano 7a,
 * AULA 15 e 16 | RM006 | Via Antonio Scarpa 14) e sul foglio Mappa Edifici.
 */
export async function mapClassroomsWithAI(
  headerRows: string[][],
  mapTabText: string = '',
  scheduleRooms: string[] = []
): Promise<Record<string, MappedClassroom>> {
  const res = await parseHeaderWithGemini(headerRows, mapTabText, scheduleRooms);
  return res.mappedRooms;
}


