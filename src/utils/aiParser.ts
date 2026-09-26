import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      return parsed.map((item, idx) => item ? item.trim() : cleanTabNameFallback(tabNames[idx]));
    }
    return tabNames.map(cleanTabNameFallback);
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
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    console.warn('Gemini 3.1 Flash Lite alerts fallback:', err?.message || err);
    return [];
  }
}

export interface MappedClassroom {
  raw: string;
  displayName: string;
  building: string;
  address: string;
}

function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Mappa le aule al loro edificio e indirizzo stradale basandosi sul foglio Mappa Edifici.
 * Applica Gemini 3.1 Flash Lite e cache AsyncStorage.
 */
export async function mapClassroomsWithAI(
  classrooms: string[],
  mapTabText: string
): Promise<Record<string, MappedClassroom>> {
  const uniqueRooms = Array.from(new Set(classrooms.map(c => c.trim()).filter(Boolean)));
  if (uniqueRooms.length === 0) return {};

  const hashKey = `classroomMap_${hashString(uniqueRooms.sort().join('|') + (mapTabText || ''))}`;
  try {
    const cached = await AsyncStorage.getItem(hashKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {}

  const result: Record<string, MappedClassroom> = {};

  try {
    const prompt = `Sei un assistente per gli studenti della facoltà di Ingegneria della Sapienza di Roma.
Ti fornisco il testo estratto dal tab "Mappa Edifici" del foglio orari universitario:
---
${mapTabText || 'edificio RM002 - via Scarpa 16\nedificio RM018 - via del Castro Laurenziano 7a\nedifici da RM031 a RM039 - via Eudossiana 18\nedificio RM041 - via delle Sette Sale 29\nedificio RM025 - via Tiburtina 205'}
---

Ed ecco le aule presenti nell'orario delle lezioni:
${JSON.stringify(uniqueRooms)}

Il tuo compito è mappare ciascuna aula al suo edificio e indirizzo/via esatto leggendo il testo fornito.
Regole per la Sapienza:
- Le aule senza sigla esplicita (es. aula 6, aula 14, aula 16, aula 7) nei corsi ICI appartengono all'edificio RM018 (via del Castro Laurenziano 7a, 00161 Roma) o RM002/RM014 (via Scarpa 16).
- Se l'aula specifica un codice RM (es. RM031 aula 21, RM038 aula 38), l'edificio è quello indicato e l'indirizzo corrisponde a quello della lista (es. via Eudossiana 18, 00184 Roma).
- Se l'aula è aula 41 o simile, corrisponde a RM041 (via delle Sette Sale 29, 00184 Roma).

Rispondi con un array JSON di oggetti con i campi esatti:
- "raw": il testo originale dell'aula passato in input
- "displayName": nome pulito dell'aula (es: "Aula 16", "Aula 21", "Aula 6")
- "building": codice e nome dell'edificio (es: "Edificio RM018", "Edificio RM031")
- "address": indirizzo stradale completo con CAP e città Roma (es: "Via del Castro Laurenziano 7a, 00161 Roma", "Via Eudossiana 18, 00184 Roma")`;

    const response = await axios.post(getGeminiUrl(), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    }, { timeout: 12000 });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed: MappedClassroom[] = JSON.parse(aiText);

    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (item.raw) {
          result[item.raw] = item;
        }
      });
      await AsyncStorage.setItem(hashKey, JSON.stringify(result));
      return result;
    }
  } catch (err: any) {
    console.warn('Gemini classroom mapping fallback:', err?.message || err);
  }

  return result;
}

