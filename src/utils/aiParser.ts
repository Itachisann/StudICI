import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = 'AIzaSyBhRN6JiyY42aBoimkoe8jBpHlmluN2kWdS6';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface ParsedClass {
  subject: string;
  teacher: string;
  room: string;
}

/**
 * Usa Gemini Flash per parsare un batch di celle orario in modo uniforme.
 * Ogni cella può avere formati diversi a seconda della facoltà.
 */
export async function parseScheduleCells(cells: string[]): Promise<ParsedClass[]> {
  // Filtra celle vuote
  const nonEmpty = cells.map((c, i) => ({ text: c.trim(), idx: i })).filter(c => c.text !== '');
  
  if (nonEmpty.length === 0) {
    return cells.map(() => ({ subject: '', teacher: '', room: '' }));
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Sei un parser di orari universitari. Ti invio celle di una tabella orario della Sapienza (Roma).
Ogni cella contiene informazioni su una lezione in formati che possono variare:
- "MATERIA (NUMERO_AULA) COGNOME Nome"
- "MATERIA - Prof. Cognome - Aula X"
- "MATERIA COGNOME Nome Aula X"
- altri formati simili

Per OGNI cella, estrai:
- subject: nome della materia (senza numeri aula o nomi docenti)
- teacher: nome completo del docente (COGNOME Nome)
- room: numero o nome dell'aula (solo il numero/nome, es: "14", "B2")

Rispondi SOLO con un array JSON valido, un oggetto per ogni cella nell'ordine dato.
Se una cella è ambigua, fai del tuo meglio. Se non riesci, lascia i campi vuoti.

Celle:
${nonEmpty.map((c, i) => `${i + 1}. "${c.text}"`).join('\n')}

Rispondi SOLO con il JSON array, niente altro.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Estrai il JSON dalla risposta
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('AI response did not contain valid JSON, falling back to regex');
      return cells.map(c => fallbackParse(c));
    }

    const parsed: ParsedClass[] = JSON.parse(jsonMatch[0]);
    
    // Rimappa sull'array originale (includendo le celle vuote)
    const result2: ParsedClass[] = cells.map(() => ({ subject: '', teacher: '', room: '' }));
    nonEmpty.forEach((item, i) => {
      if (parsed[i]) {
        result2[item.idx] = parsed[i];
      }
    });
    
    return result2;
  } catch (error) {
    console.warn('AI parsing failed, falling back to regex:', error);
    return cells.map(c => fallbackParse(c));
  }
}

/**
 * Fallback regex parser per quando l'AI non è disponibile
 */
function fallbackParse(cell: string): ParsedClass {
  if (!cell || cell.trim() === '') {
    return { subject: '', teacher: '', room: '' };
  }
  
  const decoded = cell.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  
  // Formato: "MATERIA (NUM) COGNOME Nome"
  const match = decoded.match(/^(.+?)\s*\((\d+)\)\s*(.+)$/);
  if (match) {
    return {
      subject: match[1].trim(),
      teacher: match[3].trim(),
      room: match[2].trim(),
    };
  }
  
  return { subject: decoded.trim(), teacher: '', room: '' };
}
