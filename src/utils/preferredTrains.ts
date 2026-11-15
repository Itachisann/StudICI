import {
  CommuterConfig,
  LiveTrainInfo,
  PreferredTrain,
  TrainPreferences,
} from '../types/commuter';

export type PreferredDirection = 'outbound' | 'return';

export interface NormalizedPreferredTrain extends PreferredTrain {
  id: string;
  direction: PreferredDirection;
  dayIndex: number;
  departureTime: string;
}

/**
 * Normalizza un orario in formato "HH:MM". Ritorna '' se non valido.
 */
export function normalizePreferredTimeHHMM(raw?: string): string {
  if (!raw) return '';
  const match = /(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!match) return '';
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return '';
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function timeHHMMToMinutes(raw?: string): number {
  const norm = normalizePreferredTimeHHMM(raw);
  if (!norm) return -1;
  const [h, m] = norm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Estrae il numero treno pulito (preferendo le cifre, es. "RV 4110" -> "4110").
 */
export function extractCleanTrainNumber(rawNum?: string, rawLabel?: string): string {
  const src = (rawNum || '').trim() || (rawLabel || '').trim();
  if (!src) return '';
  const digits = src.replace(/\D/g, '');
  if (digits) return digits;
  return src.replace(/\s+/g, '').toUpperCase();
}

export function extractTrainCategory(
  rawCategory?: string,
  rawLabel?: string,
  rawTrainNumber?: string
): string | undefined {
  const direct = (rawCategory || '').trim().toUpperCase();
  if (direct) return direct;
  const fromText = (rawLabel || rawTrainNumber || '').trim();
  const m = /^([A-Za-z]+)/.exec(fromText);
  return m ? m[1].toUpperCase() : undefined;
}

export function resolveWeekdayIndex(dateOrDay: Date | number): number {
  const raw = typeof dateOrDay === 'number' ? dateOrDay : dateOrDay.getDay();
  return ((Math.trunc(raw) % 7) + 7) % 7;
}

/**
 * Converte l'indice giorno JS (0=DOM, 1=LUN..5=VEN, 6=SAB)
 * nell'indice settimanale del calendario (0=LUN..4=VEN, 5=SAB, 6=DOM).
 */
export function jsDayToCalendarDayIndex(jsDay: number): number {
  const norm = resolveWeekdayIndex(jsDay);
  return norm === 0 ? 6 : norm - 1;
}

/**
 * Converte l'indice settimanale del calendario (0=LUN..4=VEN, 5=SAB, 6=DOM)
 * nell'indice giorno JS (0=DOM, 1=LUN..6=SAB).
 */
export function calendarDayIndexToJsDay(calDayIdx: number): number {
  return (calDayIdx + 1) % 7;
}

/**
 * Costruisce la chiave canonica giornaliera della preferenza:
 * <direction>_<dayIndex>_<HHMM>_<trainNumber> (indipendente dalla singola lezione).
 */
export function buildDailyTrainPreferenceKey(
  direction: PreferredDirection,
  dateOrDay: Date | number,
  train: { trainNumber?: string; departureTime?: string; label?: string }
): string {
  const dayIdx = resolveWeekdayIndex(dateOrDay);
  const dep = normalizePreferredTimeHHMM(train.departureTime);
  const num = extractCleanTrainNumber(train.trainNumber, train.label);
  const compactDep = dep ? dep.replace(':', '') : '';

  if (compactDep && num) {
    return `${direction}_${dayIdx}_${compactDep}_${num}`;
  }
  if (compactDep) {
    return `${direction}_${dayIdx}_${compactDep}`;
  }
  if (num) {
    return `${direction}_${dayIdx}_t_${num}`;
  }
  return `${direction}_${dayIdx}`;
}

/**
 * Parsing e normalizzazione di una singola entry (supporta sia il nuovo formato giornaliero
 * sia le chiavi legacy legate alla singola lezione `<dir>_<day>_<start>-<end>`).
 */
export function parsePreferredTrainRecord(
  rawKey: string,
  rawVal: any
): NormalizedPreferredTrain | null {
  if (!rawVal || typeof rawVal !== 'object') return null;

  const keyParts = String(rawKey || '').split('_');
  const keyDir =
    keyParts[0] === 'outbound' || keyParts[0] === 'return'
      ? (keyParts[0] as PreferredDirection)
      : undefined;
  const valDir =
    rawVal.direction === 'outbound' || rawVal.direction === 'return'
      ? (rawVal.direction as PreferredDirection)
      : undefined;
  const direction = valDir || keyDir;
  if (!direction) return null;

  const parsedKeyDay = parseInt(keyParts[1] || '', 10);
  const rawDay =
    typeof rawVal.dayIndex === 'number' && !isNaN(rawVal.dayIndex)
      ? rawVal.dayIndex
      : !isNaN(parsedKeyDay)
      ? parsedKeyDay
      : NaN;
  if (isNaN(rawDay) || rawDay < 0 || rawDay > 6) return null;
  const dayIndex = resolveWeekdayIndex(rawDay);

  const keyTimeCandidate =
    keyParts.length >= 3 && /^\d{4}$/.test(keyParts[2])
      ? `${keyParts[2].slice(0, 2)}:${keyParts[2].slice(2)}`
      : undefined;
  const departureTime =
    normalizePreferredTimeHHMM(rawVal.departureTime) ||
    normalizePreferredTimeHHMM(keyTimeCandidate);
  const arrivalTime = normalizePreferredTimeHHMM(rawVal.arrivalTime) || undefined;

  const keyTrainCandidate =
    keyParts.length >= 4 && keyParts[2] !== 't'
      ? keyParts.slice(3).join('')
      : keyParts[2] === 't' && keyParts[3]
      ? keyParts.slice(3).join('')
      : undefined;
  const trainNumber =
    extractCleanTrainNumber(rawVal.trainNumber, rawVal.label) ||
    extractCleanTrainNumber(keyTrainCandidate) ||
    undefined;
  const category = extractTrainCategory(
    rawVal.category,
    rawVal.label,
    rawVal.trainNumber
  );

  if (!departureTime && !trainNumber) return null;

  const label =
    (typeof rawVal.label === 'string' && rawVal.label.trim()) ||
    (trainNumber
      ? `${category ? `${category} ` : ''}${trainNumber}`
      : departureTime || undefined);

  const id = buildDailyTrainPreferenceKey(direction, dayIndex, {
    trainNumber,
    departureTime,
    label,
  });

  return {
    id,
    direction,
    dayIndex,
    trainNumber,
    category,
    departureTime: departureTime || '',
    arrivalTime,
    label,
  };
}

/**
 * Determina se due preferenze nella stessa giornata e direzione rappresentano lo stesso treno
 * (deduplicazione per numero treno e orario di partenza, con tolleranza sul formato legacy).
 */
export function arePreferredTrainsSameTrain(
  a: NormalizedPreferredTrain,
  b: NormalizedPreferredTrain
): boolean {
  if (a.direction !== b.direction || a.dayIndex !== b.dayIndex) {
    return false;
  }

  const numA = extractCleanTrainNumber(a.trainNumber, a.label);
  const numB = extractCleanTrainNumber(b.trainNumber, b.label);
  const minsA = timeHHMMToMinutes(a.departureTime);
  const minsB = timeHHMMToMinutes(b.departureTime);

  if (numA && numB) {
    if (numA !== numB) return false;
    return minsA < 0 || minsB < 0 || Math.abs(minsA - minsB) <= 5;
  }

  return minsA >= 0 && minsA === minsB;
}

function mergeNormalizedPreferences(
  base: NormalizedPreferredTrain,
  incoming: NormalizedPreferredTrain
): NormalizedPreferredTrain {
  const trainNumber = incoming.trainNumber || base.trainNumber;
  const category = incoming.category || base.category;
  const departureTime = incoming.departureTime || base.departureTime;
  const arrivalTime = incoming.arrivalTime || base.arrivalTime;
  const label = incoming.label || base.label;
  const id = buildDailyTrainPreferenceKey(base.direction, base.dayIndex, {
    trainNumber,
    departureTime,
    label,
  });

  return {
    id,
    direction: base.direction,
    dayIndex: base.dayIndex,
    trainNumber,
    category,
    departureTime,
    arrivalTime,
    label,
  };
}

/**
 * Normalizza e deduplica una mappa `preferredTrains` garantendo che per ciascun
 * `(direction, dayIndex, train)` esista al massimo un'unica istanza canonica.
 */
export function deduplicatePreferredTrainsMap(
  rawMap?: Record<string, PreferredTrain> | null
): Record<string, NormalizedPreferredTrain> {
  const list: NormalizedPreferredTrain[] = [];
  if (!rawMap || typeof rawMap !== 'object') {
    return {};
  }

  for (const [rawKey, rawVal] of Object.entries(rawMap)) {
    const parsed = parsePreferredTrainRecord(rawKey, rawVal);
    if (!parsed) continue;
    const dupIdx = list.findIndex((existing) =>
      arePreferredTrainsSameTrain(existing, parsed)
    );
    if (dupIdx >= 0) {
      list[dupIdx] = mergeNormalizedPreferences(list[dupIdx], parsed);
    } else {
      list.push(parsed);
    }
  }

  const nextMap: Record<string, NormalizedPreferredTrain> = {};
  for (const item of list) {
    nextMap[item.id] = item;
  }
  return nextMap;
}

function extractRawPreferredMap(
  source?: TrainPreferences | CommuterConfig | null
): Record<string, PreferredTrain> | undefined {
  if (!source || typeof source !== 'object') return undefined;
  if ('trainPreferences' in source) {
    return (source as CommuterConfig).trainPreferences?.preferredTrains;
  }
  return (source as TrainPreferences).preferredTrains;
}

function comparePreferredTrains(
  a: NormalizedPreferredTrain,
  b: NormalizedPreferredTrain
): number {
  const normDayA = a.dayIndex === 0 ? 7 : a.dayIndex;
  const normDayB = b.dayIndex === 0 ? 7 : b.dayIndex;
  if (normDayA !== normDayB) return normDayA - normDayB;
  if (a.direction !== b.direction) {
    return a.direction === 'outbound' ? -1 : 1;
  }
  const mA = timeHHMMToMinutes(a.departureTime);
  const mB = timeHHMMToMinutes(b.departureTime);
  if (mA !== mB) return mA - mB;
  return a.id.localeCompare(b.id);
}

/**
 * Restituisce tutte le preferenze normalizzate e deduplicate ordinate per giorno, direzione e orario.
 */
export function getAllPreferredTrains(
  source?: TrainPreferences | CommuterConfig | null
): NormalizedPreferredTrain[] {
  const map = deduplicatePreferredTrainsMap(extractRawPreferredMap(source));
  return Object.values(map).sort(comparePreferredTrains);
}

/**
 * Restituisce tutte le preferenze salvate per una data giornata e direzione, ordinate per orario di partenza.
 */
export function getPreferredTrainsForDayDirection(
  source: TrainPreferences | CommuterConfig | null | undefined,
  direction: PreferredDirection,
  dateOrDay: Date | number
): NormalizedPreferredTrain[] {
  const targetDay = resolveWeekdayIndex(dateOrDay);
  return getAllPreferredTrains(source).filter(
    (p) => p.direction === direction && p.dayIndex === targetDay
  );
}

/**
 * Verifica se un `LiveTrainInfo` corrisponde a una specifica preferenza salvata.
 */
export function doesPreferredTrainMatchLiveTrain(
  pref: PreferredTrain,
  train?: Pick<
    LiveTrainInfo,
    'trainNumber' | 'departureTimePlanned' | 'departureTimeActual' | 'category'
  > | null
): boolean {
  if (!pref || !train) return false;

  const prefNum = extractCleanTrainNumber(pref.trainNumber, pref.label);
  const liveNum = extractCleanTrainNumber(train.trainNumber);
  const prefMins = timeHHMMToMinutes(pref.departureTime);
  const liveMins = timeHHMMToMinutes(
    train.departureTimePlanned || train.departureTimeActual
  );

  if (prefNum && liveNum) {
    if (prefNum !== liveNum) return false;
    return prefMins < 0 || liveMins < 0 || Math.abs(prefMins - liveMins) <= 5;
  }

  return prefMins >= 0 && liveMins >= 0 && prefMins === liveMins;
}

/**
 * Trova l'eventuale preferenza salvata che corrisponde a `train` nella giornata e direzione indicate.
 */
export function findMatchingPreferredTrain(
  source: TrainPreferences | CommuterConfig | null | undefined,
  direction: PreferredDirection,
  dateOrDay: Date | number,
  train?: Pick<
    LiveTrainInfo,
    'trainNumber' | 'departureTimePlanned' | 'departureTimeActual' | 'category'
  > | null
): NormalizedPreferredTrain | undefined {
  if (!train) return undefined;
  const list = getPreferredTrainsForDayDirection(source, direction, dateOrDay);
  return list.find((pref) => doesPreferredTrainMatchLiveTrain(pref, train));
}

/**
 * Aggiunge o rimuove la preferenza di un treno a livello giornaliero (senza legarla a una lezione),
 * mantenendo unicità per `(direction, dayIndex, train)` e consentendo più preferenze per direzione.
 */
export function togglePreferredTrainInMap(
  rawMap: Record<string, PreferredTrain> | undefined,
  direction: PreferredDirection,
  dateOrDay: Date | number,
  train: Pick<
    LiveTrainInfo,
    | 'trainNumber'
    | 'category'
    | 'departureTimePlanned'
    | 'departureTimeActual'
    | 'arrivalTimePlanned'
    | 'arrivalTimeActual'
  >
): {
  nextMap: Record<string, NormalizedPreferredTrain>;
  added: boolean;
  entry?: NormalizedPreferredTrain;
} {
  const dayIndex = resolveWeekdayIndex(dateOrDay);
  const depTime = normalizePreferredTimeHHMM(
    train.departureTimePlanned || train.departureTimeActual
  );
  const arrTime =
    normalizePreferredTimeHHMM(train.arrivalTimePlanned || train.arrivalTimeActual) ||
    undefined;
  const cleanNum = extractCleanTrainNumber(train.trainNumber);
  const category = extractTrainCategory(train.category, undefined, train.trainNumber);

  const normalized = deduplicatePreferredTrainsMap(rawMap);
  const candidate: NormalizedPreferredTrain = {
    id: buildDailyTrainPreferenceKey(direction, dayIndex, {
      trainNumber: cleanNum,
      departureTime: depTime,
    }),
    direction,
    dayIndex,
    trainNumber: cleanNum || undefined,
    category,
    departureTime: depTime,
    arrivalTime: arrTime,
    label: cleanNum
      ? `${category ? `${category} ` : ''}${cleanNum}`
      : depTime || train.trainNumber,
  };

  const matchingKeys = Object.entries(normalized)
    .filter(
      ([, existing]) =>
        existing.direction === direction &&
        existing.dayIndex === dayIndex &&
        (doesPreferredTrainMatchLiveTrain(existing, train) ||
          arePreferredTrainsSameTrain(existing, candidate))
    )
    .map(([k]) => k);

  if (matchingKeys.length > 0) {
    const nextMap = { ...normalized };
    for (const k of matchingKeys) {
      delete nextMap[k];
    }
    return { nextMap, added: false };
  }

  const nextMap = deduplicatePreferredTrainsMap({
    ...normalized,
    [candidate.id]: candidate,
  });
  return {
    nextMap,
    added: true,
    entry: nextMap[candidate.id] || candidate,
  };
}

/**
 * Calcola gli slot calendario (`${calDayIdx}_${direction}`) interessati da una variazione
 * tra due mappe `preferredTrains`. Copre tutti i 7 giorni della settimana (`0..6`).
 */
export function getPreferredTrainDiffSlotKeys(
  prevMap?: Record<string, PreferredTrain> | null,
  nextMap?: Record<string, PreferredTrain> | null
): string[] {
  const prevNorm = deduplicatePreferredTrainsMap(prevMap);
  const nextNorm = deduplicatePreferredTrainsMap(nextMap);
  const dirtySlots = new Set<string>();

  const toSignature = (p: NormalizedPreferredTrain) =>
    `${p.direction}|${p.dayIndex}|${p.trainNumber || ''}|${p.departureTime}|${p.arrivalTime || ''}`;

  for (const [id, item] of Object.entries(prevNorm)) {
    const nextItem = nextNorm[id];
    if (!nextItem || toSignature(item) !== toSignature(nextItem)) {
      dirtySlots.add(`${jsDayToCalendarDayIndex(item.dayIndex)}_${item.direction}`);
    }
  }
  for (const [id, item] of Object.entries(nextNorm)) {
    const prevItem = prevNorm[id];
    if (!prevItem || toSignature(item) !== toSignature(prevItem)) {
      dirtySlots.add(`${jsDayToCalendarDayIndex(item.dayIndex)}_${item.direction}`);
    }
  }

  return Array.from(dirtySlots);
}
