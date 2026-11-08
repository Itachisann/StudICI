import AsyncStorage from '@react-native-async-storage/async-storage';
import { DisruptionEvent, DisruptionCategory, DisruptionImpact } from '@/types/disruptions';
import { callGeminiJson } from './aiParser';

const DISRUPTIONS_CACHE_KEY = '@studici_disruptions_cache';
const DISRUPTIONS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti

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
 * Cerca di estrarre una data italiana dal titolo della notizia di Luceverde
 * Es: "lunedì 2 novembre", "domenica 1°novembre", "dal 3 al 14 novembre",
 * "da mercoledì 4 a venerdì 6 novembre", "dal 28 ottobre al 15 novembre"
 */
function extractDateFromTitle(title: string, fallbackIso: string): { startIso: string; endIso: string } {
  const clean = title.toLowerCase().replace(/°/g, ' ');
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

  // Pattern "da [giorno] X [mese1] a [giorno] Y mese2" (es: "da mercoledì 4 a venerdì 6 novembre", "dal 28 ottobre al 15 novembre", "dal 3 al 14 novembre")
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

  const defaultIso = fallbackIso ? fallbackIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return { startIso: defaultIso, endIso: defaultIso };
}

/**
 * Recupera gli scioperi ufficiali dal feed RSS del Ministero dei Trasporti (MIT)
 */
async function fetchOfficialStrikes(): Promise<DisruptionEvent[]> {
  try {
    const res = await fetch('https://scioperi.mit.gov.it/mit2/public/scioperi/rss', {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const items = xml.split('<item>').slice(1);
    const strikes: DisruptionEvent[] = [];

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

      const isRail = sector.toLowerCase().includes('ferrovi');
      const isTpl =
        sector.toLowerCase().includes('pubblico locale') || sector.toLowerCase().includes('tpl');
      const isRelevantGeo =
        region.toLowerCase().includes('lazio') ||
        region.toLowerCase().includes('italia') ||
        scope.toLowerCase().includes('nazion') ||
        region.trim().length === 0;

      if ((isRail || isTpl) && isRelevantGeo) {
        const startIso = parseDateItToIso(startDateRaw);
        const endIso = parseDateItToIso(endDateRaw) || startIso;
        if (!startIso) continue;

        const category: DisruptionCategory = isRail ? 'sciopero_treni' : 'sciopero_tpl';
        const modalitaStr = modeMatch ? modeMatch[1].trim() : '';
        const affectedCompanies = categoryMatch ? categoryMatch[1].trim() : '';
        const unionsStr = unionsMatch ? unionsMatch[1].trim() : '';

        // Estrai orario sintetico es. "dalle 09:01 alle 16:59"
        let timeWindow = '';
        const hoursMatch = modalitaStr.match(/dalle\s*([0-9]{1,2}[:.][0-9]{2})\s*alle\s*([0-9]{1,2}[:.][0-9]{2})/i);
        if (hoursMatch) {
          timeWindow = `${hoursMatch[1].replace('.', ':')} - ${hoursMatch[2].replace('.', ':')}`;
        } else if (modalitaStr) {
          timeWindow = modalitaStr.split(';')[0].slice(0, 40);
        }

        const affectedModes: ('train' | 'transit' | 'walk')[] = isRail
          ? ['train']
          : ['transit'];

        strikes.push({
          id: `mit-${startIso}-${i}`,
          title: `Sciopero ${sector} (${scope})`,
          category,
          impact: isRail ? 'high' : 'medium',
          startDate: startIso,
          endDate: endIso,
          formattedDateSpan: startDateRaw === endDateRaw ? startDateRaw : `${startDateRaw} - ${endDateRaw}`,
          timeWindow,
          scope,
          affectedModes,
          affectedCompanies,
          unions: unionsStr,
          notes: modalitaStr,
          sourceName: 'Ministero dei Trasporti (MIT)',
          sourceUrl: 'https://scioperi.mit.gov.it/mit2/public/scioperi',
        });
      }
    }

    return strikes;
  } catch (err) {
    console.warn('[Disruptions] Errore fetch MIT RSS:', err);
    return [];
  }
}

/**
 * Recupera l'articolo completo di dettaglio da Luceverde per estrarre orari, percorso e testo reale
 */
async function fetchLuceverdeArticleDetail(id: string): Promise<{
  text?: string;
  timeWindow?: string;
} | null> {
  try {
    const res = await fetch(`https://roma.luceverde.it/articles/${id}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const components = data?.props?.pageProps?.components || [];
    const paragraphs: string[] = [];

    for (const comp of components) {
      if (comp.content?.raw?.children) {
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
  } catch {
    return null;
  }
}

/**
 * Recupera le notizie di infomobilità e manifestazioni a Roma da Luceverde (Next.js data)
 */
async function fetchRomeMobilityEvents(): Promise<DisruptionEvent[]> {
  try {
    const res = await fetch('https://roma.luceverde.it/news', {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextMatch) return [];

    const nextData = JSON.parse(nextMatch[1]);
    const newsList: any[] = nextData?.props?.pageProps?.additionalData?.newsList || [];
    const events: DisruptionEvent[] = [];

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

      // Identifica manifestazioni, cortei, presidi o eventi con impatto viario/pedonale
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

      // Se non è né una manifestazione né un blocco/evento in zona rilevante, saltiamo
      if (!isManifestazione && !isBlocco && !isRelevantZone) continue;

      const { startIso, endIso } = extractDateFromTitle(title, item.newsTimeUTC || '');

      let category: DisruptionCategory = 'cantiere_viabilita';
      let impact: DisruptionImpact = 'medium';
      const affectedModes: ('train' | 'transit' | 'walk')[] = ['walk'];

      if (isManifestazione) {
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

    // Arricchimento asincrono dei dettagli dal corpo degli articoli
    const detailedEvents = await Promise.all(
      events.map(async (ev) => {
        if (!ev.id || !ev.id.startsWith('piattaforma-')) {
          return ev;
        }
        try {
          const detail = await fetchLuceverdeArticleDetail(ev.id);
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
      })
    );

    // Raffinamento intelligente date (da DATA a DATA) e orari con Gemini Flash Lite
    const aiEnrichedEvents = await enrichEventsWithGemini(detailedEvents);

    return aiEnrichedEvents;
  } catch (err) {
    console.warn('[Disruptions] Errore fetch Luceverde Roma:', err);
    return [];
  }
}

/**
 * Usa Gemini Flash Lite per verificare e raffinare date (da DATA a DATA), orari precisi
 * e fasce notturne delle segnalazioni di mobilità, gestendo qualsiasi pattern naturale italiano.
 */
async function enrichEventsWithGemini(events: DisruptionEvent[]): Promise<DisruptionEvent[]> {
  if (!events || events.length === 0) return events;

  try {
    const payload = events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      text: ev.notes ? ev.notes.slice(0, 380) : '',
    }));

    const currentYear = new Date().getFullYear();
    const todayIso = new Date().toISOString().slice(0, 10);

    const prompt = `Sei l'assistente per la mobilità a Roma. Analizza le seguenti segnalazioni di mobilità di Luceverde Roma ed estrai per ciascuna le date e gli orari reali in cui si svolgono le modifiche, cortei o lavori.
Anno di riferimento: ${currentYear}, oggi è ${todayIso}.

Regole tassative di estrazione:
- "startDate" e "endDate": date in formato ISO "YYYY-MM-DD".
  - Se è un intervallo (es. "dal 3 al 14 novembre", "da mercoledì 4 a venerdì 6 novembre", "dal 28 ottobre al 15 novembre"), estrai la data iniziale in startDate e la data finale in endDate.
  - Se riguarda un solo giorno (es. "lunedì 2 novembre"), startDate ed endDate devono coincidere.
  - Se è indicato "fino a [data]", startDate è "${todayIso}" (o la data di inizio citata nel testo) e endDate è quella data finale.
- "timeWindow": orario sintetico es. "dalle 16:00", "10:00 - 18:00", "22:00 - 06:00", "dalle 22:00", oppure "" se dura tutto il giorno.
- "isNocturnal": true SOLO se l'evento/chiusura si svolge esclusivamente in orario notturno (es. "chiusura notturna", "lavori notturni", "fascia compresa tra le 22:00 e le 06:00", dalle 22 in poi), false altrimenti.
- "affectedAreas": quartieri o zone citate (es. ["Verano", "Tiburtina", "San Lorenzo", "Centro"]).

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
    "affectedAreas": ["string"]
  }
]`;

    const aiRes = await callGeminiJson(prompt, 6000);
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
      const timeWindow =
        typeof ai.timeWindow === 'string' && ai.timeWindow.trim()
          ? ai.timeWindow.trim()
          : ev.timeWindow;
      const isNocturnal =
        typeof ai.isNocturnal === 'boolean' ? ai.isNocturnal : ev.isNocturnal;

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
        affectedAreas: mergedAreas,
        formattedDateSpan: formattedSpan,
      };
    });
  } catch (err) {
    console.warn('[Disruptions] Fallback parsing mobilità con Gemini:', err);
    return events;
  }
}

/**
 * Ottiene la lista completa degli scioperi e delle manifestazioni (con cache locale di 30m)
 */
export async function getDisruptions(forceRefresh = false): Promise<DisruptionEvent[]> {
  try {
    if (!forceRefresh) {
      const cachedRaw = await AsyncStorage.getItem(DISRUPTIONS_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.timestamp && Date.now() - cached.timestamp < DISRUPTIONS_CACHE_TTL_MS) {
          if (Array.isArray(cached.data)) {
            return cached.data;
          }
        }
      }
    }

    const [strikes, mobilityEvents] = await Promise.all([
      fetchOfficialStrikes(),
      fetchRomeMobilityEvents(),
    ]);

    const combined = [...strikes, ...mobilityEvents].map((ev) => {
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
    const activeOrUpcoming = combined.filter((ev) => {
      if (ev.endDate && ev.endDate < todayIso) {
        return false;
      }
      return true;
    });

    // Ordina: prima gli eventi con data crescente, privilegiando quelli che impattano la tratta
    activeOrUpcoming.sort((a, b) => {
      if (a.startDate !== b.startDate) {
        return a.startDate.localeCompare(b.startDate);
      }
      if (a.isCommuterRelevant && !b.isCommuterRelevant) return -1;
      if (!a.isCommuterRelevant && b.isCommuterRelevant) return 1;
      return 0;
    });

    // Salva in cache
    await AsyncStorage.setItem(
      DISRUPTIONS_CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        data: activeOrUpcoming,
      })
    );

    return activeOrUpcoming;
  } catch (err) {
    console.warn('[Disruptions] Errore getDisruptions:', err);
    return [];
  }
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

  return allEvents.filter((ev) => targetIso >= ev.startDate && targetIso <= ev.endDate);
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
 * Gli scioperi che riguardano esclusivamente Italo-NTV o altre ferrovie regionali estranee (es. Trenord, EAV)
 * NON creano alcun disservizio sulla tratta del pendolare.
 */
export function isTrainStrikeImpactingCommuter(strike: DisruptionEvent): boolean {
  if (strike.category !== 'sciopero_treni') return false;

  const textToScan = `${strike.title} ${strike.affectedCompanies || ''} ${strike.notes || ''}`.toLowerCase();

  // Se riguarda unicamente Italo / NTV / Nuovo Trasporto Viaggiatori
  const mentionsItalo =
    textToScan.includes('italo') ||
    textToScan.includes('ntv') ||
    textToScan.includes('nuovo trasporto viaggiatori');
  const mentionsFS =
    textToScan.includes('trenitalia') ||
    textToScan.includes('gruppo fs') ||
    textToScan.includes('rfi') ||
    textToScan.includes('ferrovie dello stato');

  if (mentionsItalo && !mentionsFS) {
    return false;
  }

  // Se riguarda ferrovie regionali di altre regioni estranee (es. Trenord, EAV, FSE, Ferrotramviaria)
  const isOtherRegional =
    (textToScan.includes('trenord') ||
      textToScan.includes('eav') ||
      textToScan.includes('ferrovie del sud est') ||
      textToScan.includes('ferrovie appulo lucane') ||
      textToScan.includes('ferrotramviaria')) &&
    !mentionsFS;

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
  const text = `${event.timeWindow || ''} ${event.title || ''} ${event.notes || ''}`.toLowerCase();

  // Riconoscimento esplicito di chiusure o eventi notturni
  const isExplicitNight =
    event.isNocturnal === true ||
    text.includes('chiusura notturna') ||
    text.includes('lavori notturni') ||
    text.includes('fascia oraria compresa tra le ore 22') ||
    text.includes('fascia oraria compresa tra le 22') ||
    text.includes('notturno') ||
    text.includes('notturna') ||
    text.includes('ore 22') ||
    text.includes('ore 23') ||
    text.includes('dalle 22') ||
    text.includes('dalle 23');

  // Pattern intervallo: "22:00 - 06:00", "dalle 09:00 alle 16:00", "tra le ore 22:00 e le ore 06:00"
  const rangeMatch = text.match(
    /(?:dalle\s*ore\s*|in\s*orario\s*|tra\s*le\s*ore\s*|ore\s*)?([0-9]{1,2})[:.]([0-9]{2})\s*(?:alle\s*(?:ore\s*)?|\/|-|e\s*(?:le\s*ore\s*)?)\s*([0-9]{1,2})[:.]([0-9]{2})/i
  );

  if (rangeMatch) {
    const sH = parseInt(rangeMatch[1], 10);
    const sM = parseInt(rangeMatch[2], 10);
    const eH = parseInt(rangeMatch[3], 10);
    const eM = parseInt(rangeMatch[4], 10);
    const nocturnal = isExplicitNight || sH >= 21 || (sH >= 20 && eH <= 7);
    return {
      startHour: sH,
      startMinute: sM,
      endHour: eH,
      endMinute: eM,
      isNocturnal: nocturnal,
      hasTimeWindow: true,
    };
  }

  // Pattern orario singolo: "dalle 16:00", "dalle ore 16:00", "alle ore 16:00"
  const singleMatch = text.match(/(?:dalle\s*ore\s*|dalle\s*|alle\s*ore\s*|ore\s*)([0-9]{1,2})[:.]([0-9]{2})/i);
  if (singleMatch) {
    const sH = parseInt(singleMatch[1], 10);
    const sM = parseInt(singleMatch[2], 10);
    const nocturnal = isExplicitNight || sH >= 21;
    return {
      startHour: sH,
      startMinute: sM,
      isNocturnal: nocturnal,
      hasTimeWindow: true,
    };
  }

  return {
    startHour: 9,
    startMinute: 0,
    isNocturnal: isExplicitNight,
    hasTimeWindow: false,
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
 * Verifica se una manifestazione o blocco stradale / deviazione impatta il tragitto
 * urbano del pendolare (a piedi o con mezzi pubblici/bus/tram)
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
      textToScan.includes('gra') ||
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

  return corridorKeywords.some((kw) => textToScan.includes(kw));
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

  // 1. Cerca annunci attivi in quella specifica data (compresi annunci da DATA a DATA)
  const activeEventsOnDate = allDisruptions.filter((ev) => {
    return ev.startDate <= lectureDateIso && lectureDateIso <= ev.endDate;
  });

  if (activeEventsOnDate.length === 0) return null;

  // 2. Priorità 1: Sciopero treni impattante sulla tratta pendolare
  const trainStrike = activeEventsOnDate.find(
    (ev) => ev.category === 'sciopero_treni' && isTrainStrikeImpactingCommuter(ev)
  );

  if (trainStrike) {
    return {
      id: trainStrike.id,
      badgeLabel: 'Impatta la tua tratta (Trenitalia / RFI / IC)',
      title: trainStrike.title,
      category: trainStrike.category,
      type: 'train',
      timeWindow: trainStrike.timeWindow,
      shortDesc: trainStrike.timeWindow
        ? `Sciopero treni (${trainStrike.timeWindow})`
        : 'Sciopero treni in programma',
    };
  }

  // 3. Priorità 2: Manifestazione, blocco o deviazione viabilità/mezzi lungo il tragitto urbano
  const urbanEvents = activeEventsOnDate.filter((ev) =>
    isUrbanDisruptionImpactingCommuter(ev, commuterStationName)
  );

  if (urbanEvents.length === 0) return null;

  // Parsing orari lezione (in minuti da mezzanotte)
  const [lStartH, lStartM] = (lectureStartTime || '09:00').split(':').map(Number);
  const [lEndH, lEndM] = (lectureEndTime || '11:00').split(':').map(Number);
  const lectureStartMins = (lStartH || 9) * 60 + (lStartM || 0);
  const lectureEndMins = (lEndH || 11) * 60 + (lEndM || 0);

  for (const ev of urbanEvents) {
    const timeInfo = parseDisruptionTime(ev);
    if (timeInfo.isNocturnal) continue;

    const startP = ev.startDate.split('-');
    const endP = ev.endDate.split('-');
    const dateSpanLabel =
      ev.startDate !== ev.endDate && startP.length === 3 && endP.length === 3
        ? ` · dal ${startP[2]}/${startP[1]} al ${endP[2]}/${endP[1]}`
        : '';

    // Se l'annuncio non ha un orario orario esatto (es. cantiere/chiusura per l'intera giornata)
    if (!timeInfo.hasTimeWindow) {
      const cleanTitle = ev.title
        .split(',')[0]
        .replace(/^luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica/i, '')
        .trim();
      return {
        id: ev.id,
        badgeLabel: 'Impatta il tuo tragitto',
        title: ev.title,
        category: ev.category,
        type: 'urban',
        timeWindow: ev.timeWindow,
        shortDesc: `${cleanTitle}${ev.timeWindow ? ` (${ev.timeWindow})` : ''}${dateSpanLabel}`,
      };
    }

    const eventStartMins = timeInfo.startHour * 60 + timeInfo.startMinute;
    const eventEndMins =
      timeInfo.endHour !== undefined
        ? timeInfo.endHour * 60 + timeInfo.endMinute!
        : eventStartMins + 180; // stima 3h se non indicato il termine

    // Finestra di mobilità associata alla lezione:
    // - Andata verso l'aula: 60 minuti prima dell'inizio
    // - Rientro dall'aula: fino a 75 minuti dopo la fine lezione
    const commuteWindowStart = Math.max(0, lectureStartMins - 60);
    const commuteWindowEnd = lectureEndMins + 75;

    // C'è intersezione temporale tra la mobilità della lezione e l'evento?
    const overlaps =
      eventStartMins <= commuteWindowEnd && eventEndMins >= commuteWindowStart;

    if (overlaps) {
      const cleanTitle = ev.title
        .split(',')[0]
        .replace(/^luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica/i, '')
        .trim();
      return {
        id: ev.id,
        badgeLabel: 'Impatta il tuo tragitto',
        title: ev.title,
        category: ev.category,
        type: 'urban',
        timeWindow: ev.timeWindow,
        shortDesc: `${cleanTitle}${ev.timeWindow ? ` (${ev.timeWindow})` : ''}${dateSpanLabel}`,
      };
    }
  }

  return null;
}

/**
 * Filtra gli scioperi treni pertinenti alla tratta del pendolare per la schermata Viaggio
 */
export function getCommuterRelevantTrainStrikes(events: DisruptionEvent[]): DisruptionEvent[] {
  return events.filter((ev) => ev.category === 'sciopero_treni' && isTrainStrikeImpactingCommuter(ev));
}

/**
 * Filtra le manifestazioni / blocchi pertinenti al percorso urbano del pendolare (a piedi o con mezzi)
 */
export function getCommuterRelevantWalkDisruptions(
  events: DisruptionEvent[],
  stationName?: string
): DisruptionEvent[] {
  return events.filter(
    (ev) =>
      (ev.affectedModes.includes('walk') || ev.affectedModes.includes('transit')) &&
      isUrbanDisruptionImpactingCommuter(ev, stationName)
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
