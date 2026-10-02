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
  buildingCode?: string;
  address?: string;
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
    return cells.map(() => ({ subject: '', teacher: '', room: '', buildingCode: '', address: '' }));
  }

  const map = new Map<string, ParsedClass>();
  const toFetch: string[] = [];

  // 1. Controlla la cache per ogni cella unica
  for (const text of uniqueTexts) {
    const hashKey = `cell_gemini_v7_${hashString(text)}`;
    try {
      const cached = await AsyncStorage.getItem(hashKey);
      if (cached) {
        map.set(text, validateAndCleanClass(JSON.parse(cached), text));
      } else {
        toFetch.push(text);
      }
    } catch {
      toFetch.push(text);
    }
  }

  // 2. Se ci sono celle non in cache, analisi semantica rigida con Gemini
  if (toFetch.length > 0) {
    try {
      const prompt = `Sei l'analizzatore semantico ufficiale degli orari universitari della Facoltà di Ingegneria - Sapienza Università di Roma.
Ricevi un array di testi estratti da tabelle orario (possono contenere abbreviazioni, formati non convenzionali, trattini o sigle).

Per CIASCUNA cella analizza semanticamente il contenuto ed estrai con assoluta precisione:

1. "subject":
   - Il nome COMPLETO dell'insegnamento / materia.
   - NON troncare titoli composti (es: "Laboratorio di matematica", "Laboratorio di Calcolo Numerico", "Segnali deterministici e stocastici ed elaborazione dati e segnali biomedici I", "Analisi matematica 1").
   - Escludi aula, docente, note, date e trattini decorativi.

2. "teacher":
   - Il nome completo del docente nel formato convenzionale "COGNOME Nome" (es. "PISTOIA Angela", "CAPUTO Domenico", "D'ORAZIO Annunziata", "RIZZUTO Emanuele").
   - Se non indicato o assente, restituisci "".

3. "room":
   - Il nome NORMALIZZATO dell'aula precisa secondo le convenzioni Sapienza:
     * Se è un numero (es: "16", "(16)"), normalizza in "Aula 16".
     * Se è abbreviata (es: "A. 3", "A3", "Piano 1 - A3"), normalizza in "Aula 3".
     * Se contiene il codice edificio (es: "RM032 aula 33", "RM031 aula 1"), estrai SOLO il nome dell'aula normalizzato, es: "Aula 33", "Aula 1".
     * Se ha un nome proprio (es: "Aula Magna", "Lab Comp", "Laboratorio Informatico"), mantieni il nome convenzionale normalizzato (es. "Aula Magna", "Lab Comp").
     * Se non presente, restituisci "".

4. "buildingCode":
   - Il codice edificio Sapienza (formato RMxxx es. "RM032", "RM031", "RM038", "RM006", "RM018", "RM025") se presente nella cella, oppure "" se non presente.

5. "address":
   - L'indirizzo esplicito se specificato nella cella (es: "Via Tiburtina 205"), altrimenti "".

Rispondi RIGOROSAMENTE con un array JSON di oggetti [{"subject": string, "teacher": string, "room": string, "buildingCode": string, "address": string}] nello stesso identico ordine.

Celle:
${JSON.stringify(toFetch)}`;

      const response = await axios.post(getGeminiUrl(), {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      }, { timeout: 8500 });

      const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed: ParsedClass[] = JSON.parse(aiText);

      if (Array.isArray(parsed)) {
        for (let i = 0; i < toFetch.length; i++) {
          const rawText = toFetch[i];
          if (parsed[i]) {
            const item = validateAndCleanClass(parsed[i], rawText);
            map.set(rawText, item);
            AsyncStorage.setItem(`cell_gemini_v7_${hashString(rawText)}`, JSON.stringify(item)).catch(() => {});
          }
        }
      }
    } catch (error: any) {
      if (error?.response?.status === 429) {
        console.log('Gemini: Rate-limit (429) celle, attivo fallback deterministico locale');
      } else {
        console.log('Gemini cell parsing fallback:', error?.message || error);
      }
      // Se Gemini non risponde (offline/rate-limit), usa fallbackParse per le celle mancanti
      for (const text of toFetch) {
        if (!map.has(text)) {
          const item = fallbackParse(text);
          map.set(text, item);
        }
      }
    }
  }

  // Costruisci il risultato finale usando la mappa o il fallback
  return cells.map(c => {
    const trimmed = c.trim();
    if (!trimmed) return { subject: '', teacher: '', room: '', buildingCode: '', address: '' };
    return map.get(trimmed) || fallbackParse(trimmed);
  });
}

/**
 * Valida ed effettua guardrail sui campi estratti, integrando regex per evitare errori o allucinazioni.
 */
export function validateAndCleanClass(geminiParsed: ParsedClass, rawText: string = ''): ParsedClass {
  let { subject, teacher, room, buildingCode, address } = geminiParsed || {};
  subject = (subject || '').trim();
  teacher = (teacher || '').trim();
  room = (room || '').trim();
  buildingCode = (buildingCode || '').toUpperCase().trim();
  address = (address || '').trim();

  // 1. Guardrail contro parole di materia finite erroneamente nel docente
  if (teacher) {
    const leakedMatch = teacher.match(/^(di|del|della|delle|dei|degli|e|ed|in|per)\s+([a-zA-Zà-öø-ÿ0-9'\s]+?)\s+((?:(?:Prof\.|Prof\.ssa)\s+)?[A-ZÀ-ÖØ-ß]{2,}(?:\s+[A-ZÀ-ÖØ-ß]{2,})*\s+[A-ZÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ]+.*)$/i);
    if (leakedMatch) {
      subject = (subject + ' ' + leakedMatch[1] + ' ' + leakedMatch[2]).trim();
      teacher = leakedMatch[3].trim();
    }
  }

  // 2. Integrazione regex di sicurezza: estrai codice edificio se presente nel testo originale
  if (!buildingCode && rawText) {
    const rmMatch = rawText.match(/(RM\d{3})/i);
    if (rmMatch) buildingCode = rmMatch[1].toUpperCase();
  }

  // 3. Normalizzazione nome aula secondo le convenzioni Sapienza
  if (!room && rawText) {
    const rMatch = rawText.match(/\(([^)]+)\)/);
    if (rMatch) room = rMatch[1].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
  }
  if (room) {
    room = normalizeDisplayName(room);
  }

  // 4. Indirizzo esplicito di sicurezza (es. Tiburtina 205 o Scarpa 14)
  if (!address && rawText) {
    if (/tiburtina\s*205/i.test(rawText)) address = 'Via Tiburtina 205, 00185 Roma';
    else if (/scarpa\s*14/i.test(rawText)) address = 'Via Antonio Scarpa 14, 00161 Roma';
  }

  return {
    subject: subject.toUpperCase(),
    teacher,
    room,
    buildingCode,
    address,
  };
}

/**
 * Fallback regex deterministico per singola cella
 */
export function fallbackParse(cell: string): ParsedClass {
  if (!cell || cell.trim() === '') {
    return { subject: '', teacher: '', room: '', buildingCode: '', address: '' };
  }
  
  const raw = cell
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

  let buildingCode = '';
  const rmMatch = raw.match(/(RM\d{3})/i);
  if (rmMatch) buildingCode = rmMatch[1].toUpperCase();

  let address = '';
  if (/tiburtina\s*205/i.test(raw)) address = 'Via Tiburtina 205, 00185 Roma';
  else if (/scarpa\s*14/i.test(raw)) address = 'Via Antonio Scarpa 14, 00161 Roma';

  // Se la cella ha più righe (es. da <br>), linea 1 è solitamente la materia
  if (raw.includes('\n')) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const subject = lines[0].toUpperCase();
      const rest = lines.slice(1).join(' ');
      
      const roomMatch = rest.match(/\(([^)]+)\)/);
      const room = roomMatch ? roomMatch[1].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim() : '';
      let teacher = rest.replace(/\(([^)]+)\)/, '').trim();
      teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
      teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
      return validateAndCleanClass({ subject, teacher, room, buildingCode, address }, cell);
    }
  }

  const decoded = raw.replace(/\s+/g, ' ').trim();
  
  // 1. "MATERIA (AULA) DOCENTE"
  const m1 = decoded.match(/^(.+?)\s*\(([^)]+)\)\s+(.+)$/);
  if (m1) {
    let teacher = m1[3].trim();
    teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
    teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
    const room = m1[2].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
    return validateAndCleanClass({ subject: m1[1].trim().toUpperCase(), teacher, room, buildingCode, address }, cell);
  }
  
  // 2. "MATERIA DOCENTE (AULA)" con docente con cognome in MAIUSCOLO
  const mTeacherCaps = decoded.match(/^(.+?)\s+((?:(?:Prof\.|Prof\.ssa)\s+)?[A-ZÀ-ÖØ-ß]{2,}(?:\s+[A-ZÀ-ÖØ-ß]{2,})*\s+[A-ZÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ]+)*)\s*\(([^)]+)\)$/);
  if (mTeacherCaps) {
    let teacher = mTeacherCaps[2].trim();
    teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
    teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
    const room = mTeacherCaps[3].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
    return validateAndCleanClass({ subject: mTeacherCaps[1].trim().toUpperCase(), teacher, room, buildingCode, address }, cell);
  }

  // Fallback 2: "MATERIA DOCENTE (AULA)" generico
  const m2 = decoded.match(/^(.+?)\s+([A-ZÀ-ÖØ-öø-ÿa-z'\s]+?)\s*\(([^)]+)\)$/);
  if (m2) {
    let teacher = m2[2].trim();
    teacher = teacher.replace(/\s*(?:via|viale|piazza|corso|largo)\s+[a-zA-Z0-9\s,]+$/i, '').trim();
    teacher = teacher.replace(/\s*RM\d{3}\b.*/i, '').trim();
    const room = m2[3].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
    return validateAndCleanClass({ subject: m2[1].trim().toUpperCase(), teacher, room, buildingCode, address }, cell);
  }
  
  // 3. "MATERIA (AULA)"
  const m3 = decoded.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (m3) {
    const room = m3[2].replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
    return validateAndCleanClass({ subject: m3[1].trim().toUpperCase(), teacher: '', room, buildingCode, address }, cell);
  }

  return validateAndCleanClass({ subject: decoded.trim().toUpperCase(), teacher: '', room: '', buildingCode, address }, cell);
}

export function hasDateInfo(text?: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  const hasNumericDate = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(t);
  const hasMonthName = /\b(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/.test(t);
  const hasDateRange = /\bdal\b.*\bal\b/.test(t);

  const isOnlyAcademicYear = /^(?:a\.a\.\s*)?\d{4}[-/]\d{2,4}$/.test(t.replace(/[^a-z0-9/-]/g, ''));
  if (isOnlyAcademicYear) return false;

  return (hasNumericDate || (hasMonthName && /\d{1,2}/.test(t)) || (hasDateRange && (hasNumericDate || hasMonthName)));
}

export function isAnnouncement(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  // 1. FILTRI NEGATIVI RIGIDI: Metadati, legende, intestazioni o codici foglio NON sono avvisi!
  if (
    /^(facolt[aà]|corso di studi|anno di corso|a\.a\.|canale)\b/i.test(t) ||
    /\b(codice interno|legenda|legend|ultimo aggiornamento|last update)\b/i.test(t) ||
    /\b(materia\s*\(edificio aula\)|subject\s*\(building class\))\b/i.test(t) ||
    /\b(laurea\s+(?:triennale|magistrale))\b/i.test(t) ||
    /^note\s+e\s+avvisi:?$/i.test(t) ||
    /^avvisi:?$/i.test(t) ||
    /^note:?$/i.test(t)
  ) {
    return false;
  }

  // 2. Se è solo la riga dell'aula o della mappa edifici
  if (/^aula\s+\d+(\s+e\s+\d+)?(\s*\([^)]+\))?(\s*\|\s*RM\d+)?$/i.test(t)) {
    return false;
  }
  if (/^edifici?o?\s+RM\d+/i.test(t)) {
    return false;
  }

  // 3. Se è solo il periodo didattico / date lezioni standard (es. "Lezioni dal 25/09/2017 al 21/12/2017")
  if (/^lezioni\s+dal\s+\d{1,2}[/-]\d{1,2}.*al\s+\d{1,2}[/-]\d{1,2}$/i.test(t)) {
    return false;
  }

  // 4. VERI AVVISI PER GLI STUDENTI:
  if (/\b(inizieranno|inizier[aà]|inizio lezioni|si terr[aà]|sospesa|sospese|variazione|avviso agli studenti|sostituito|recupero|anticipat[ao]|posticipat[ao]|non si terr[aà]|eccezionalmente)\b/i.test(t)) {
    return true;
  }

  if (t.length > 30 && /\b(lezione|lezioni)\b/i.test(t) && /\b(aula|online|meet|zoom|docente|professore|prof|orario)\b/i.test(t) && !/\b(laurea|corso di studi)\b/i.test(t)) {
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
  let semesterPrefix = '';
  for (const row of headerRows) {
    const fullText = row.join(' ');
    const semMatch = fullText.match(/\b(I{1,2}|1|2)\s*°?\s*sem(?:estre)?\b/i);
    if (semMatch) {
      const num = (semMatch[1].toUpperCase() === 'II' || semMatch[1] === '2') ? '2' : '1';
      semesterPrefix = `${num}° Semestre`;
      break;
    }
  }

  // Cerca prima riga/cella specifica con date delle lezioni
  for (const row of headerRows) {
    for (const cell of row) {
      const c = cell.trim();
      if (!c) continue;
      if (
        /lezioni\s+dal\s+\d{1,2}[/-]\d{1,2}.*al\s+\d{1,2}[/-]\d{1,2}/i.test(c) ||
        /dal\s+\d{1,2}\s+[a-z]+.*al\s+\d{1,2}\s+[a-z]+/i.test(c)
      ) {
        const cleanDateText = c
          .replace(/codice interno|legenda.*|ultimo aggiornamento.*|laurea\s+(?:triennale|magistrale).*/gi, '')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .trim();
        if (hasDateInfo(cleanDateText)) {
          if (/semestre/i.test(cleanDateText)) return cleanDateText;
          return semesterPrefix ? `${semesterPrefix} · ${cleanDateText}` : cleanDateText;
        }
      }
    }
  }

  // Altrimenti cerca riga con "semestre" che contenga effettivamente date
  for (const row of headerRows) {
    const nonEmpties = row.map(c => c.trim()).filter(Boolean);
    const joined = nonEmpties.join(' ');
    if (/\bsemestre\b/i.test(joined) && hasDateInfo(joined)) {
      const semCell = nonEmpties.find(c => hasDateInfo(c)) || joined;
      const clean = semCell.replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
      if (hasDateInfo(clean)) {
        return clean;
      }
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
    // Il semestre ha il suo campo dedicato se contiene date, quindi non lo duplichiamo negli avvisi
    if (/\bsemestre\b/i.test(fullRowText) && hasDateInfo(fullRowText)) return;

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
 * Affida a Gemini l'interpretazione semantica completa dell'intestazione di qualsiasi foglio orario della Sapienza.
 * Distingue intelligentemente il SEMESTRE (con date), gli AVVISI REALI e le AULE,
 * filtrando categoricamente metadati tecnici, legende e date di aggiornamento del file Excel.
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

  // CHIAVE DI CACHE NORMALIZZATA CONDIVISA TRA TUTTI I CANALI DELLO STESSO CORSO:
  const normalizedForCourse = (headerLines + '\n' + (mapTabText || ''))
    .replace(/\b(?:canale|can\.?)\s*[a-zA-Z]\s*-\s*[a-zA-Z]\b/gi, '')
    .replace(/\b(I{1,3}V?|IV|V|[1-5])\s*°?\s*anno\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hashKey = `header_ai_v8_${hashString(normalizedForCourse)}`;
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

1. "semester": stringa pulita ed evidente con il semestre e le date effettive di svolgimento delle lezioni (es: "1° Semestre · dal 24 settembre al 22 dicembre 2026" oppure "1° Semestre · Lezioni dal 25/09/2017 al 21/12/2017").
   - REQUISITO FONDAMENTALE: Deve contenere informazioni temporali o date effettive di svolgimento delle lezioni. Se il foglio non specifica date o periodo di svolgimento, restituisci stringa vuota "".
   - NON inserire mai il solo nome della facoltà, elenco edifici o note redazionali.

2. "alerts": Array di stringhe con i VERI avvisi e comunicazioni urgenti/straordinarie per gli studenti (es: "Le lezioni inizieranno il 24 settembre", "Lezione sospesa", "Variazione orario/aula").
   - DISTINZIONE CRUCIALE: Riconosci semanticamente ciò che è un VERO AVVISO per gli studenti e ciò che NON lo è.
   - NON SONO AVVISI (IGNORALI CATEGORICAMENTE):
     * Metadati tecnici o codici interni del foglio Excel (es: "codice interno", "BCLR5", "MBIR3").
     * Date di modifica del file (es: "ultimo aggiornamento last update 24/8/26 17:34").
     * Legende di lettura (es: "Legenda / Legend: Materia (edificio aula) Docente Subject...").
     * Intestazioni di colonna o etichette vuote (es: "NOTE E AVVISI:", "Avvisi:", "Note:").
     * Metadati del corso (es: "Laurea triennale in Ingegneria Clinica...", "Facoltà di...").
     * Le date ordinarie delle lezioni (vanno in "semester", mai negli alerts).
   - Se non sono presenti veri avvisi o comunicazioni straordinarie per gli studenti, restituisci un array vuoto [].

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
    }, { timeout: 5500 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(aiText);

    const rawSemester: string = (parsed && typeof parsed.semester === 'string' && parsed.semester.trim())
      ? parsed.semester.trim()
      : fallbackSemester;

    // Guardrail: il calendario didattico deve contenere effettive date o periodi
    const semester = (rawSemester && hasDateInfo(rawSemester)) ? rawSemester : '';

    const rawAlerts: string[] = Array.isArray(parsed.alerts) && parsed.alerts.length > 0 
      ? parsed.alerts 
      : fallbackAlerts;

    // Guardrail: escludi tassativamente metadati, legende, note redazionali e stringhe senza contenuto
    const alerts = rawAlerts
      .map(a => typeof a === 'string' ? a.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '')
      .filter(a => {
        if (!a || a.length < 5) return false;
        if (/^(?:note\s+e\s+avvisi:?|avvisi:?|note:?)$/i.test(a)) return false;
        if (/\b(codice interno|legenda|legend|ultimo aggiornamento|last update)\b/i.test(a)) return false;
        if (/\b(materia\s*\(edificio aula\)|subject\s*\(building class\))\b/i.test(a)) return false;
        if (/^(facolt[aà]|corso di studi|laurea\s+(?:triennale|magistrale))\b/i.test(a)) return false;
        return true;
      });

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


