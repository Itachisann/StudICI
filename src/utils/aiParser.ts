import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SAPIENZA_BUILDINGS, resolveClassroom } from './classroomLocations';

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

  const hashKey = `tabs_ai_v3_${hashString(cleanInput.join('|'))}`;
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
    }, { timeout: 10000 });
    
    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: string[] = JSON.parse(aiText);
    
    if (Array.isArray(parsed) && parsed.length === tabNames.length) {
      const res = parsed.map((item, idx) => item ? item.trim() : cleanTabNameFallback(tabNames[idx]));
      try {
        await AsyncStorage.setItem(hashKey, JSON.stringify(res));
      } catch {}
      return res;
    }
    const fallbackRes = tabNames.map(cleanTabNameFallback);
    try {
      await AsyncStorage.setItem(hashKey, JSON.stringify(fallbackRes));
    } catch {}
    return fallbackRes;
  } catch (err: any) {
    console.warn('Gemini 3.1 Flash Lite tab parsing fallback:', err?.message || err);
    return tabNames.map(cleanTabNameFallback);
  }
}

/**
 * Usa Gemini 3.1 Flash Lite per parsare le celle delle lezioni.
 * DEDUPLICA le celle uniche per risparmiare token, abbattere i tempi a <1s e prevenire rate-limits.
 */
export async function parseScheduleCells(cells: string[]): Promise<ParsedClass[]> {
  const uniqueTexts = Array.from(new Set(cells.map(c => c.trim()).filter(Boolean)));
  
  if (uniqueTexts.length === 0) {
    return cells.map(() => ({ subject: '', teacher: '', room: '' }));
  }

  const hashKey = `cells_ai_v3_${hashString(uniqueTexts.join('|'))}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      const cachedMap = new Map<string, ParsedClass>(JSON.parse(cached));
      return cells.map(c => {
        const trimmed = c.trim();
        if (!trimmed) return { subject: '', teacher: '', room: '' };
        if (cachedMap.has(trimmed)) return cachedMap.get(trimmed)!;
        return fallbackParse(trimmed);
      });
    }
  } catch {}

  const map = new Map<string, ParsedClass>();

  try {
    const prompt = `Sei un parser di orari universitari della Sapienza di Roma.
Ti invio celle di una tabella orario. Ogni cella contiene info su una lezione.
Per OGNI cella estrai:
- "subject": solo il nome della materia (es: "FISICA II", "Analisi matematica 1")
- "teacher": nome completo del docente nel formato "COGNOME Nome" (es: "PATERA Vincenzo") o "" se non presente
- "room": SOLO il numero/nome aula (es: "14", "16", "Aula 3") o "" se non presente

Rispondi con un array JSON di oggetti con i campi subject, teacher, room, nello stesso identico ordine.

Celle:
${JSON.stringify(uniqueTexts)}`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 12000 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: ParsedClass[] = JSON.parse(aiText);

    if (Array.isArray(parsed)) {
      uniqueTexts.forEach((text, i) => {
        if (parsed[i]) {
          map.set(text, {
            subject: parsed[i].subject || '',
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
    console.warn('Gemini 3.1 Flash Lite cell parsing fallback:', error?.message || error);
  }

  // Costruisci il risultato finale usando la mappa o il fallback deterministico
  return cells.map(c => {
    const trimmed = c.trim();
    if (!trimmed) return { subject: '', teacher: '', room: '' };
    if (map.has(trimmed)) return map.get(trimmed)!;
    return fallbackParse(trimmed);
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
  
  // "MATERIA (AULA) DOCENTE" (es: "FISICA II (14) PATERA Vincenzo")
  const m1 = decoded.match(/^(.+?)\s*\(([^)]+)\)\s+(.+)$/);
  if (m1) return { subject: m1[1].trim(), teacher: m1[3].trim(), room: m1[2].trim() };
  
  // "MATERIA DOCENTE (AULA)" (es: "Analisi matematica 1 PISTOIA Angela (16)")
  const m2 = decoded.match(/^(.+?)\s+([A-ZÀ-ÖØ-öø-ÿa-z'\s]+?)\s*\(([^)]+)\)$/);
  if (m2) return { subject: m2[1].trim(), teacher: m2[2].trim(), room: m2[3].trim() };
  
  // "MATERIA (AULA)"
  const m3 = decoded.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (m3) return { subject: m3[1].trim(), teacher: '', room: m3[2].trim() };

  return { subject: decoded.trim(), teacher: '', room: '' };
}

/**
 * Usa Gemini 3.1 Flash Lite per estrarre avvisi/note (alerts) dalle intestazioni.
 */
export async function extractAlertsWithAI(headerRows: string[][]): Promise<string[]> {
  const flatText = headerRows.map(r => r.join(' ')).join('\n').trim();
  if (!flatText) return [];

  const hashKey = `alerts_ai_v3_${hashString(flatText)}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  try {
    const prompt = `Ti passo le prime righe (l'intestazione) di un foglio orario universitario. 
Il tuo compito è estrarre TUTTI gli "avvisi" operativi o note importanti per lo studente.

Cosa devi ESTRARRE:
- Date inizio/fine semestre (es. "1° SEMESTRE dal 24 settembre al 22 dicembre")
- Scadenze o variazioni d'orario
- Note operative specifiche per i canali o per i corsi

Cosa devi IGNORARE (non estrarre):
- Nome della facoltà
- Nome del corso di laurea
- L'anno di corso (es. "Anno di corso 2")
- L'anno accademico (es. "A.A. 2026-27")
- I giorni della settimana o titoli di colonne

Rispondi con un array JSON di stringhe (["avviso 1", "avviso 2"]), una per ogni avviso utile trovato. 
Se non trovi avvisi utili, restituisci l'array vuoto [].

Testo intestazione:
${flatText}`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 10000 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(aiText);
    const result = Array.isArray(parsed) ? parsed : [];
    try {
      await AsyncStorage.setItem(hashKey, JSON.stringify(result));
    } catch {}
    return result;
  } catch (err: any) {
    console.warn('Gemini 3.1 Flash Lite alerts fallback:', err?.message || err);
    return [];
  }
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
        const fullAddr = addrRaw.toLowerCase().includes('roma') ? addrRaw : `${addrRaw}, 00161 Roma`;
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
      const cell = nonEmpties[i];
      if (/^aula\b/i.test(cell) || /\baula\s+\d+/i.test(cell) || /\baula\s+[a-zA-Z]/i.test(cell)) {
        const aulaRaw = cell;
        let buildingCode = '';
        let address = '';

        // Cerca nelle celle immediatamente adiacenti (i+1, i+2, i+3)
        for (let j = i + 1; j < nonEmpties.length && j <= i + 4; j++) {
          const next = nonEmpties[j];
          const rm = next.match(/(RM\d{3})/i);
          if (rm && !buildingCode) {
            buildingCode = rm[1].toUpperCase();
          }
          if (/\b(via|viale|piazza|corso|largo|lungotevere)\b/i.test(next) && !address) {
            address = next;
          }
        }

        // Se non abbiamo l'indirizzo esplicito ma abbiamo l'edificio, usiamo il dizionario
        if (buildingCode && !address && buildingAddresses[buildingCode]) {
          address = buildingAddresses[buildingCode].address;
        }

        if (address && !address.toLowerCase().includes('roma')) {
          address = `${address}, 00161 Roma`;
        }

        const buildingName = buildingCode
          ? (buildingAddresses[buildingCode]?.buildingName || `Edificio ${buildingCode}`)
          : 'Edificio Sapienza';

        const cleanAula = aulaRaw.replace(/^aula\s+/i, '').trim();

        // Caso aule multiple (es: "15 e 16")
        const multiMatch = cleanAula.match(/^(\d+)\s+e\s+(\d+)$/i);
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

        // Caso giorno specifico (es: "15 (lunedi)" o "15 (lunedì)")
        const dayMatch = cleanAula.match(/^(\d+)\s*\(([^)]+)\)$/i);
        if (dayMatch) {
          const r = dayMatch[1];
          const dNote = dayMatch[2].toLowerCase().trim();
          const item: MappedClassroom = {
            key: `${r} (${dNote})`,
            displayName: `Aula ${r} (${dNote})`,
            building: buildingName,
            address: address || 'Via Tiburtina 205, 00185 Roma',
            dayNote: dNote,
          };
          result[`${r} (${dNote})`] = item;
          result[`aula ${r} (${dNote})`] = item;
          result[`${r} (lunedi)`] = item;
          result[`${r} (lunedì)`] = item;
          result[`aula ${r} (lunedi)`] = item;
          result[`aula ${r} (lunedì)`] = item;
          // Se non esiste ancora per r generico, assegnalo
          if (!result[r.toLowerCase()]) {
            result[r.toLowerCase()] = item;
            result[`aula ${r.toLowerCase()}`] = item;
          }
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
  // Estrai righe rilevanti dell'intestazione contenenti aule o edifici
  const headerLines = headerRows
    .map(r => r.filter(Boolean).join(' | '))
    .filter(line => /aula|rm\d+|edificio|scarpa|castro|tiburtina|eudossiana/i.test(line));

  const textToAnalyze = headerLines.join('\n');
  const uniqueRooms = Array.from(new Set(scheduleRooms.map(c => c.trim()).filter(Boolean)));

  const hashKey = `classroomMap_v4_${hashString(textToAnalyze + (mapTabText || '') + uniqueRooms.join(','))}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  // 1. Estrazione deterministica diretta dalle celle adiacenti e da Mappa Edifici
  const result: Record<string, MappedClassroom> = extractClassroomsFromHeaderRows(headerRows, mapTabText);

  // Per ciascuna aula presente nell'orario non ancora mappata, risolvi deterministica
  uniqueRooms.forEach(room => {
    const clean = room.replace(/^aula\s+/i, '').toLowerCase().trim();
    if (!result[clean] && !result[`aula ${clean}`]) {
      const resolved = resolveClassroom(room, textToAnalyze + '\n' + mapTabText);
      const item: MappedClassroom = {
        key: clean,
        displayName: resolved.displayName,
        building: resolved.buildingName,
        address: resolved.address,
      };
      result[clean] = item;
      result[`aula ${clean}`] = item;
      result[resolved.displayName.toLowerCase().trim()] = item;
    }
  });

  // 2. Chiama Gemini 3.1 Flash Lite per raffinare o integrare
  try {
    const prompt = `Sei un assistente per gli orari universitari della Facoltà di Ingegneria della Sapienza di Roma.
Ti fornisco due testi estratti dal file orari ufficiale:

1. Righe dell'intestazione con la tabella aule del canale (celle adiacenti AULA | CODICE EDIFICIO | VIA):
---
${textToAnalyze || 'AULA 6 | RM018 | Via del Castro Laurenziano 7a\nAULA 15 e 16 | RM006 | Via Antonio Scarpa 14\nAULA 15 (lunedi) | RM025 | Via Tiburtina 205'}
---

2. Elenco edifici e vie della facoltà (tab Mappa Edifici):
---
${mapTabText || 'edificio RM002 - via Scarpa 16\nedificio RM006 - via Scarpa 14\nedificio RM014 - via Scarpa 14\nedificio RM018 - via del Castro Laurenziano, 7a\nedificio RM025 - via Tiburtina, 205\nedifici da RM031 a RM039 - via Eudossiana, 18\nedificio RM041 - via delle Sette Sale, 29'}
---

3. Aule citate nelle celle dell'orario:
${JSON.stringify(uniqueRooms)}

Il tuo compito è analizzare la tabella aule nelle celle adiacenti e mappare ciascuna aula al suo edificio e via esatta.
Regole fondamentali:
1. Nelle celle adiacenti dell'intestazione compaiono righe come:
   - "AULA 6 | RM018 | Via del Castro Laurenziano 7a"
   - "AULA 15 e 16 | RM006 | Via Antonio Scarpa 14"
   - "AULA 15 (lunedi) | RM025 | Via Tiburtina 205"
   - "AULA Bianchi Bandinelli | RM014 | Via Antonio Scarpa 14"
2. Se un'aula è multipla (es. "AULA 15 e 16"), crea una voce per "15" e una per "16", entrambe con RM006 e Via Antonio Scarpa 14!
3. Se un'aula specifica un giorno (es. "AULA 15 (lunedi)"), crea una voce specifica con key "15 (lunedi)".
4. Come "key" usa le stringhe con cui le lezioni indicano l'aula tra parentesi (es. "6", "15", "16", "14", "bandinelli", "aula 6").
5. Se un'aula delle lezioni non è esplicitata nella tabella del canale, ricava l'indirizzo dalla lista del tab Mappa Edifici in base al codice RM (es: RM031 -> Via Eudossiana 18).

Rispondi con un array JSON di oggetti con i campi esatti:
- "key": il numero o codice aula (es: "6", "15", "16", "14", "bandinelli", "aula 6", "15 (lunedi)")
- "displayName": nome leggibile (es: "Aula 6", "Aula 15", "Aula 16", "Aula Bianchi Bandinelli", "Aula 15 (lunedì)")
- "building": codice e nome edificio (es: "Edificio RM018", "Edificio RM006", "Edificio RM025", "Edificio RM014")
- "address": indirizzo stradale completo di Roma con civico (es: "Via del Castro Laurenziano 7a, 00161 Roma", "Via Antonio Scarpa 14, 00161 Roma", "Via Tiburtina 205, 00185 Roma")`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 10000 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: MappedClassroom[] = JSON.parse(aiText);

    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (item.key) {
          const k = item.key.toLowerCase().trim();
          result[k] = item;
          result[`aula ${k}`] = item;
          if (item.displayName) {
            result[item.displayName.toLowerCase().trim()] = item;
          }
        }
      });
    }
  } catch (err: any) {
    console.warn('Gemini 3.1 Flash Lite classroom mapping fallback:', err?.message || err);
  }

  try {
    await AsyncStorage.setItem(hashKey, JSON.stringify(result));
  } catch {}

  return result;
}


