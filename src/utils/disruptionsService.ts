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
    const railClause = parts.find((p) => /ferrovi|fs|trenitalia|rfi|rotai/i.test(p));
    if (railClause) return railClause;
  } else if (category === 'sciopero_tpl') {
    const tplClause = parts.find((p) => /\btpl\b|pubblico locale|bus|metro|tram/i.test(p));
    if (tplClause) return tplClause;
  }
  return parts[0];
}

/**
 * Analizza date effettive, orari e durata di uno sciopero o evento di mobilità
 * supportando fasce orarie su giorno singolo, multi-giorno (es. "23 ORE: DALLE 21.00 DEL 20/11 ALLE 20.00 DEL 21/11"),
 * durata da ora di inizio (es. "4 ORE: DALLE 09.00") ed eventi intera giornata.
 */
export function parseDisruptionSchedule(event: DisruptionEvent): ParsedDisruptionSchedule {
  const baseStartIso = event.startDate || new Date().toISOString().slice(0, 10);
  const baseEndIso = event.endDate && event.endDate >= baseStartIso ? event.endDate : baseStartIso;

  const mitNotes =
    event.sourceName === 'Ministero dei Trasporti (MIT)'
      ? selectRelevantModalitaClause(event.notes || '', event.category)
      : event.notes || '';

  const text =
    event.sourceName === 'Ministero dei Trasporti (MIT)'
      ? `${mitNotes} ${event.timeWindow || ''} ${event.title || ''}`
      : `${event.timeWindow || ''} ${event.title || ''} ${mitNotes}`;
  const lower = text.toLowerCase();

  const isExplicitNight =
    event.isNocturnal === true ||
    lower.includes('chiusura notturna') ||
    lower.includes('lavori notturni') ||
    lower.includes('fascia oraria compresa tra le ore 22') ||
    lower.includes('fascia oraria compresa tra le 22') ||
    lower.includes('notturno') ||
    lower.includes('notturna') ||
    lower.includes('ore 22') ||
    lower.includes('ore 23') ||
    lower.includes('dalle 22') ||
    lower.includes('dalle 23');

  const durationHours = extractDurationHours(text);

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

    const isNocturnal =
      event.category === 'sciopero_treni'
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
        isNocturnal:
          event.category === 'sciopero_treni'
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
      isNocturnal: event.category === 'sciopero_treni' ? false : isExplicitNight || sH >= 21,
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
      isNocturnal: event.category === 'sciopero_treni' ? false : isExplicitNight,
    };
  }

  // 4) Intera giornata / nessun orario orologio specifico
  return {
    startDateIso: baseStartIso,
    endDateIso: baseEndIso,
    startHour: 0,
    startMinute: 0,
    endHour: 24,
    endMinute: 0,
    durationHours,
    hasExplicitRange: false,
    hasStartTimeOnly: false,
    hasTimeWindow: false,
    isFullDay: true,
    isNocturnal: event.category === 'sciopero_treni' ? false : isExplicitNight,
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

        const affectedModes: ('train' | 'transit' | 'walk')[] = isRail
          ? ['train']
          : ['transit'];

        const draftEvent: DisruptionEvent = {
          id: `mit-${startIso}-${i}`,
          title: `Sciopero ${sector} (${scope})`,
          category,
          impact: isRail ? 'high' : 'medium',
          startDate: startIso,
          endDate: endIso,
          formattedDateSpan: startDateRaw === endDateRaw ? startDateRaw : `${startDateRaw} - ${endDateRaw}`,
          timeWindow: '',
          scope,
          affectedModes,
          affectedCompanies,
          unions: unionsStr,
          notes: modalitaStr,
          sourceName: 'Ministero dei Trasporti (MIT)',
          sourceUrl: 'https://scioperi.mit.gov.it/mit2/public/scioperi',
        };

        const parsedSchedule = parseDisruptionSchedule(draftEvent);
        draftEvent.startDate = parsedSchedule.startDateIso;
        draftEvent.endDate = parsedSchedule.endDateIso;
        draftEvent.timeWindow = formatDisruptionModalTimeWindow(draftEvent);

        strikes.push(draftEvent);
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
      badgeLabel: 'Impatta la tua tratta (Trenitalia / RFI / IC)',
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
