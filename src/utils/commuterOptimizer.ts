import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CommuterConfig,
  CommuterItinerary,
  TripLeg,
  LiveTrainInfo,
  PreferredTrain,
  SmartOutboundRecommendation,
  SmartReturnRecommendation,
} from '../types/commuter';
import { DisruptionEvent } from '../types/disruptions';
import { ScheduleData, ClassEvent, fetchAllCourseData, fetchScheduleData } from './scraper';
import { getCommuterConfig } from './commuterStorage';
import { getDisruptions } from './disruptionsService';
import {
  ManualClassEvent,
  getManualEvents,
  manualEventToClassEvent,
  isManualEventActiveOnDate,
} from './manualEvents';
import {
  ExcludedLessonRecord,
  buildExcludedIdSet,
  getExcludedLessons,
  isLessonExcluded,
  jsDayToScheduleDayIndex,
} from './excludedLessons';
import { getDateForDayIndex } from './attendance';
import { resolveClassroom, formatSapienzaAddress, SAPIENZA_BUILDINGS } from './classroomLocations';
import { getOptimalRomeTransit } from './transitRouter';
import { getStationTransitBoard, TransitBoardResult } from './transitBoardService';
import { calculateDrivingEstimate, getStationNavigationQuery } from './drivingRouter';
import {
  doesPreferredTrainMatchLiveTrain,
  getPreferredTrainsForDayDirection,
} from './preferredTrains';
import {
  findOptimalCommuterTrain,
  parseTimeToMinutes,
  minutesToTime,
  formatStationName,
} from './trenitaliaApi';

/**
 * Distanza positiva in minuti tra startM e endM (gestisce l'eventuale attraversamento della mezzanotte).
 */
export function elapsedMinutes(startM: number, endM: number): number {
  if (startM < 0 || endM < 0) return 0;
  if (endM >= startM) return endM - startM;
  if (startM - endM > 720) return endM + 1440 - startM;
  return 0;
}

/**
 * Normalizza un orario su asse continuo rispetto a refM in caso di attraversamento della mezzanotte.
 */
export function normalizeRelativeMinutes(mins: number, refM: number): number {
  if (mins < 0) return mins;
  if (refM >= 0 && mins < refM && refM - mins > 720) return mins + 1440;
  return mins;
}

/**
 * Chiave legacy della preferenza treno (mantenuta solo per compatibilità temporanea).
 */
export function getTrainPreferenceKey(
  direction: 'outbound' | 'return',
  date: Date | number,
  lecture?: { startTime?: string; endTime?: string } | null
): string {
  const lectureKey =
    lecture && lecture.startTime && lecture.endTime
      ? `${lecture.startTime}-${lecture.endTime}`
      : 'none';
  const dayIdx = typeof date === 'number' ? date : date.getDay();
  return `${direction}_${dayIdx}_${lectureKey}`;
}

/**
 * Risolve dinamicamente il nome effettivo dello scalo ferroviario di Roma
 * utilizzato dal treno selezionato (es. "Roma Tiburtina", "Roma Termini", "Roma Ostiense"),
 * superando il default statico di configurazione quando il convoglio specifico fa capo a una stazione differente.
 */
export function getRomeStationName(
  config: CommuterConfig,
  train?: LiveTrainInfo | null,
  direction: 'outbound' | 'return' = 'outbound'
): string {
  const userRomeStation = formatStationName(
    config.arrivalStation.shortName || config.arrivalStation.name || 'Roma Tiburtina'
  );
  const userRomeUpper = userRomeStation.toUpperCase();
  const isUserTiburtina = userRomeUpper.includes('TIBURTINA');
  const isUserTermini = userRomeUpper.includes('TERMINI');
  const isUserOstiense = userRomeUpper.includes('OSTIENSE');

  if (train) {
    const stops = train.stops || [];

    // 1. Se abbiamo l'elenco fermate del convoglio:
    if (stops.length > 0) {
      // Se la stazione preferita configurata dal pendolare è tra le fermate del treno,
      // la stazione di salita/discesa a Roma è RIGOROSAMENTE quella dell'utente
      // (es. treno che origina a Termini ma ferma a Tiburtina: per chi scende/sale a Tiburtina la stazione è Tiburtina).
      const userStopExists = stops.some((s) => {
        const sName = s.stationName.toUpperCase();
        if (isUserTiburtina && sName.includes('TIBURTINA')) return true;
        if (isUserTermini && sName.includes('TERMINI')) return true;
        if (isUserOstiense && sName.includes('OSTIENSE')) return true;
        return sName.includes(userRomeUpper);
      });

      if (userStopExists) {
        return userRomeStation;
      }

      // Se il treno NON ferma nella stazione configurata dall'utente,
      // individua l'effettiva fermata di Roma servita dal convoglio
      const alternativeRomeStop = stops.find((s) => {
        const u = s.stationName.toUpperCase();
        return u.includes('TIBURTINA') || u.includes('TERMINI') || u.includes('OSTIENSE') || u.includes('TUSCOLANA');
      });
      if (alternativeRomeStop) {
        return formatStationName(alternativeRomeStop.stationName);
      }
    }

    // 2. Se non abbiamo ancora le fermate dettagliate caricate:
    // La quasi totalità dei convogli regionali/RV della direttrice Orte-Roma (linea FL1 e direttissima)
    // effettua fermata a Roma Tiburtina. Non bisogna MAI forzare Roma Termini solo perché il treno
    // ha capolinea di origine o destinazione a Termini se l'utente ha configurato Roma Tiburtina.
    if (isUserTiburtina) {
      return 'Roma Tiburtina';
    }

    if (isUserTermini) {
      if (direction === 'outbound') {
        const dest = (train.destination || '').toUpperCase();
        if (dest.includes('TERMINI')) return 'Roma Termini';
        if (dest.includes('TIBURTINA') || dest.includes('FIUMICINO')) return 'Roma Tiburtina';
      } else {
        const orig = (train.originStationName || '').toUpperCase();
        if (orig.includes('TERMINI')) return 'Roma Termini';
        if (orig.includes('TIBURTINA') || orig.includes('FIUMICINO')) return 'Roma Tiburtina';
      }
    }
  }

  return userRomeStation;
}

export function formatMinutesToHours(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export interface OptimizeOptions {
  config: CommuterConfig;
  scheduleData?: ScheduleData | null;
  manualEvents?: ManualClassEvent[];
  direction: 'outbound' | 'return';
  targetDate?: Date;
  manualHour?: string; // override manuale orario es. "08:30"
  selectedClass?: ClassEvent | null; // lezione esplicitamente selezionata dall'utente
  isExplicitClass?: boolean;
  selectedTrainOffset?: number; // -1 = treno prima, 0 = consigliato, +1 = treno dopo
  selectedTrainNumber?: string; // override selezione treno specifico
  forcedPreferredTrain?: PreferredTrain; // override esplicito su singola preferenza giornaliera (es. sync calendario)
  forceRefresh?: boolean;
  ignoreCurrentTime?: boolean; // calcola l'orario programmato canonico senza filtrare rispetto all'ora attuale
  fastCalendarMode?: boolean; // salta chiamate ausiliarie (OSRM/ATAC) per sincronizzazione calendario veloce
  excludedLessonIds?: Set<string> | string[]; // lezioni "barrate" escluse dal target standard
}

export interface DayLectureTarget {
  subject: string;
  room: string;
  buildingName?: string;
  buildingCode?: string;
  address: string;
  startTime: string;
  endTime: string;
  latitude?: number;
  longitude?: number;
}

function classEventToLectureTarget(chosenClass: ClassEvent): DayLectureTarget {
  const context = `${chosenClass.building || ''} ${chosenClass.address || ''}`.trim();
  const resolved = resolveClassroom(chosenClass.room || 'Aula', context);
  const bCode = (
    chosenClass.building?.match(/RM\d{3}/i)?.[0] ||
    chosenClass.address?.match(/RM\d{3}/i)?.[0] ||
    resolved.buildingCode ||
    ''
  ).toUpperCase();

  const startTime = chosenClass.startTime || '08:30';
  const endTime = chosenClass.endTime || minutesToTime(parseTimeToMinutes(startTime) + 120);

  return {
    subject: chosenClass.subject || 'Lezione',
    room: chosenClass.room || resolved.displayName,
    buildingName: chosenClass.building || resolved.buildingName,
    buildingCode: bCode,
    address: formatSapienzaAddress(chosenClass.address || resolved.address, bCode),
    startTime,
    endTime,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
  };
}

function getDayClassesForDate(
  scheduleData?: ScheduleData | null,
  targetDate: Date = new Date(),
  manualEvents?: ManualClassEvent[]
): ClassEvent[] {
  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 6 = sab
  if (dayIndex === 0 || dayIndex === 6) {
    return [];
  }
  const dayScheduleIndex = dayIndex >= 1 && dayIndex <= 5 ? dayIndex - 1 : 0;

  const scrapedClasses: ClassEvent[] =
    scheduleData?.days && scheduleData.days[dayScheduleIndex]
      ? [...scheduleData.days[dayScheduleIndex]]
      : [];

  const { dateStr } = getDateForDayIndex(dayScheduleIndex);
  const manualClasses: ClassEvent[] = (manualEvents || [])
    .filter(
      (e) =>
        e.dayIndex === dayScheduleIndex &&
        Boolean(e.room && e.room.trim().length > 0) &&
        isManualEventActiveOnDate(e, dateStr)
    )
    .map(manualEventToClassEvent);

  return [...scrapedClasses, ...manualClasses].sort(
    (a, b) =>
      parseTimeToMinutes(a.startTime || '08:30') -
      parseTimeToMinutes(b.startTime || '08:30')
  );
}

/**
 * Calcola l'itinerario ottimizzato per lo studente pendolare
 */
export async function computeCommuterItinerary(
  options: OptimizeOptions
): Promise<CommuterItinerary> {
  const {
    config,
    scheduleData,
    manualEvents,
    direction,
    targetDate = new Date(),
    manualHour,
    selectedClass,
    selectedTrainOffset = 0,
    selectedTrainNumber,
    forcedPreferredTrain,
    forceRefresh = false,
    ignoreCurrentTime = false,
    fastCalendarMode = false,
    excludedLessonIds,
  } = options;
  const isOutbound = direction === 'outbound';
  const dayClasses = getDayClassesForDate(scheduleData, targetDate, manualEvents);

  let resolvedExcludedSet: Set<string>;
  if (excludedLessonIds instanceof Set) {
    resolvedExcludedSet = excludedLessonIds;
  } else if (Array.isArray(excludedLessonIds)) {
    resolvedExcludedSet = new Set(excludedLessonIds);
  } else if (!selectedClass) {
    const excludedRecords = await getExcludedLessons().catch(
      () => [] as ExcludedLessonRecord[]
    );
    resolvedExcludedSet = buildExcludedIdSet(excludedRecords);
  } else {
    resolvedExcludedSet = new Set<string>();
  }

  const schedDayIdx = jsDayToScheduleDayIndex(targetDate.getDay());
  const activeDayClasses =
    resolvedExcludedSet.size > 0
      ? dayClasses.filter((c) => !isLessonExcluded(schedDayIdx, c, resolvedExcludedSet))
      : dayClasses;

  // 1. Individua la lezione target del giorno
  const targetLecture = findDayLecture(
    scheduleData,
    targetDate,
    direction,
    manualHour,
    selectedClass,
    ignoreCurrentTime,
    manualEvents,
    resolvedExcludedSet
  );

  const isExplicitClass = Boolean(options.isExplicitClass);

  // 2. Calcola i tempi in base alla direzione
  if (isOutbound) {
    return computeOutboundItinerary(
      config,
      targetLecture,
      targetDate,
      selectedTrainOffset,
      selectedTrainNumber,
      forceRefresh,
      ignoreCurrentTime,
      activeDayClasses,
      isExplicitClass,
      fastCalendarMode,
      forcedPreferredTrain
    );
  } else {
    return computeReturnItinerary(
      config,
      targetLecture,
      targetDate,
      selectedTrainOffset,
      selectedTrainNumber,
      forceRefresh,
      ignoreCurrentTime,
      fastCalendarMode,
      forcedPreferredTrain,
      isExplicitClass
    );
  }
}

function findDayLecture(
  scheduleData?: ScheduleData | null,
  targetDate: Date = new Date(),
  direction: 'outbound' | 'return' = 'outbound',
  manualHour?: string,
  explicitClass?: ClassEvent | null,
  ignoreCurrentTime = false,
  manualEvents?: ManualClassEvent[],
  excludedSet?: Set<string>
): DayLectureTarget | null {
  if (manualHour) {
    const resolved = resolveClassroom('Aula 1');
    return {
      subject: 'Lezione Programmata',
      room: 'Aula 1',
      buildingName: resolved.buildingName,
      buildingCode: resolved.buildingCode,
      address: formatSapienzaAddress(resolved.address),
      startTime: manualHour,
      endTime: minutesToTime(parseTimeToMinutes(manualHour) + 120),
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
  }

  // Se l'utente ha selezionato direttamente una lezione dall'interfaccia (anche se barrata)
  if (explicitClass) {
    return classEventToLectureTarget(explicitClass);
  }

  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 6 = sab
  const isWeekend = dayIndex === 0 || dayIndex === 6;

  // Nel fine settimana (sabato e domenica) non ci sono lezioni universitarie
  if (isWeekend) {
    return null;
  }

  const allDayClasses = getDayClassesForDate(scheduleData, targetDate, manualEvents);
  const schedDayIdx = jsDayToScheduleDayIndex(dayIndex);
  const dayClasses =
    excludedSet && excludedSet.size > 0
      ? allDayClasses.filter((c) => !isLessonExcluded(schedDayIdx, c, excludedSet))
      : allDayClasses;

  if (dayClasses.length > 0) {
    let chosenClass: ClassEvent;
    const now = new Date();
    const isToday =
      !ignoreCurrentTime &&
      targetDate.getDate() === now.getDate() &&
      targetDate.getMonth() === now.getMonth();

    if (isToday) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      if (direction === 'outbound') {
        // Selezione intelligente: se la lezione della mattina è già passata
        // seleziona la prossima lezione o quella in corso che sia raggiungibile prima della fine
        const reachable = dayClasses.find(
          (c) => parseTimeToMinutes(c.endTime || '18:00') > nowMins + 45
        );
        const activeOrUpcoming = dayClasses.find(
          (c) => parseTimeToMinutes(c.endTime || '18:00') > nowMins
        );
        chosenClass = reachable || activeOrUpcoming || dayClasses[dayClasses.length - 1];
      } else {
        // Ritorno: se c'è una lezione in corso o appena finita, prendi quella, altrimenti l'ultima del giorno
        const activeClass = dayClasses.find(
          (c) =>
            parseTimeToMinutes(c.startTime || '08:30') <= nowMins &&
            parseTimeToMinutes(c.endTime || '18:00') > nowMins
        );
        const pastOrActive = [...dayClasses].reverse().find(
          (c) => parseTimeToMinutes(c.endTime || '18:00') <= nowMins + 30
        );
        chosenClass = activeClass || pastOrActive || dayClasses[dayClasses.length - 1];
      }
    } else {
      chosenClass = direction === 'outbound' ? dayClasses[0] : dayClasses[dayClasses.length - 1];
    }

    return classEventToLectureTarget(chosenClass);
  }

  // Se la giornata ha lezioni ma tutte sono state barrate dall'utente, calcola solo i treni senza lezione fittizia
  if (allDayClasses.length > 0) {
    return null;
  }

  // Fallback se giornata libera o fine settimana
  const defaultBuilding = SAPIENZA_BUILDINGS.RM102; // Ariosto
  const defaultStart = direction === 'outbound' ? '08:30' : '15:30';
  const defaultEnd = direction === 'outbound' ? '10:30' : '17:30';

  return {
    subject: 'Prima Lezione del Giorno',
    room: 'Aula 1 (Sede Ariosto)',
    buildingName: defaultBuilding.name,
    buildingCode: 'RM102',
    address: defaultBuilding.address,
    startTime: defaultStart,
    endTime: defaultEnd,
    latitude: defaultBuilding.latitude,
    longitude: defaultBuilding.longitude,
  };
}

function getInitialCollapsedDirectLines(
  boardData: TransitBoardResult,
  direction: 'to_campus' | 'to_station',
  hasMinDepartureConstraint: boolean
): string[] {
  const departures = boardData.departures || [];
  if (departures.length === 0) return boardData.directLines || [];

  let collapsed = departures;
  if (departures.length > 3) {
    if (direction === 'to_campus' || hasMinDepartureConstraint) {
      const top3 = departures.slice(0, 3);
      if (
        boardData.optimalDeparture &&
        !top3.some((d) => d.id === boardData.optimalDeparture?.id)
      ) {
        const opt = departures.find((d) => d.id === boardData.optimalDeparture?.id);
        collapsed = opt ? [...top3, opt] : top3;
      } else {
        collapsed = top3;
      }
    } else {
      const optIdx = boardData.optimalIndex ?? 0;
      const startIdx = Math.max(0, Math.min(optIdx - 1, departures.length - 3));
      collapsed = departures.slice(startIdx, startIdx + 3);
    }
  }

  const seen = new Set<string>();
  const directFirst: string[] = [];
  for (const dep of collapsed) {
    const lineKey = dep.line.trim();
    if (!lineKey) continue;
    const norm = lineKey.toLowerCase();
    if (dep.isDirect && !seen.has(norm)) {
      seen.add(norm);
      directFirst.push(lineKey);
    }
  }
  if (directFirst.length > 0) return directFirst;

  const fallback: string[] = [];
  for (const dep of collapsed) {
    const lineKey = dep.line.trim();
    if (!lineKey) continue;
    const norm = lineKey.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      fallback.push(lineKey);
    }
  }
  return fallback.length > 0 ? fallback : boardData.directLines || [];
}

function formatTransitLinesTitle(lines: string[], fallback: string): string {
  if (lines.length === 1) {
    return /^metro\b/i.test(lines[0]) ? lines[0] : `Linea ${lines[0]}`;
  }
  if (lines.length > 1) {
    return `Linee ${lines.join(' / ')}`;
  }
  return fallback;
}

/**
 * Calcolo Andata: Da Casa ➔ Università
 */
async function computeOutboundItinerary(
  config: CommuterConfig,
  targetLecture: DayLectureTarget | null,
  targetDate: Date,
  selectedTrainOffset = 0,
  selectedTrainNumber?: string,
  forceRefresh = false,
  ignoreCurrentTime = false,
  dayClasses: ClassEvent[] = [],
  isExplicitClass = false,
  fastCalendarMode = false,
  forcedPreferredTrain?: PreferredTrain
): Promise<CommuterItinerary> {
  const bufferMins = config.bufferMinutes ?? 10;

  // Calcolo percorso mezzi urbani o a piedi ottimizzato (se presente una lezione universitaria target)
  const transitSolution = targetLecture
    ? getOptimalRomeTransit({
        fromStationCode: config.arrivalStation.code,
        fromStationName: config.arrivalStation.name,
        classroom: {
          displayName: targetLecture.room,
          buildingName: targetLecture.buildingName || '',
          buildingCode: targetLecture.buildingCode || '',
          address: targetLecture.address,
          latitude: targetLecture.latitude,
          longitude: targetLecture.longitude,
        },
        direction: 'to_campus',
        preferredMode: config.transitLeg?.preferredMode || 'auto',
      })
    : null;

  const transitMins = transitSolution?.durationMinutes || (targetLecture ? (config.transitLeg.durationMinutes || 20) : 0);

  const now = new Date();
  const isToday =
    !ignoreCurrentTime &&
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const carEnabled = config.carLeg.enabled;
  // Durata preliminare stimata per raggiungere la stazione (auto + parcheggio oppure a piedi)
  const estimatedTimeToStation = carEnabled
    ? Math.ceil(
        (config.carLeg.durationMinutes || config.carLeg.baseDurationMinutes || 24) +
          (config.carLeg.parkingBufferMinutes ?? 7)
      )
    : 10;

  // Stima orario minimo di partenza treno affinché sia raggiungibile partendo da adesso
  const minTrainDepartureMins = isToday ? nowMins + estimatedTimeToStation : 0;

  let stationTargetArrivalMins: number;
  if (targetLecture) {
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const classroomArrivalMins = lectureStartMins - bufferMins;
    stationTargetArrivalMins = classroomArrivalMins - transitMins;
    // Se è oggi e l'orario utile per la lezione è già passato o richiederebbe di partire prima di adesso:
    // calcola treni a partire da adesso
    if (isToday && (nowMins > lectureStartMins || stationTargetArrivalMins < minTrainDepartureMins + 45)) {
      stationTargetArrivalMins = minTrainDepartureMins + 50;
    }
  } else {
    // Weekend o viaggio stazione-stazione senza lezioni: calcola rispetto all'orario targetDate (o preferenza forzata)
    const forcedArrMins =
      forcedPreferredTrain?.arrivalTime
        ? parseTimeToMinutes(forcedPreferredTrain.arrivalTime)
        : forcedPreferredTrain?.departureTime
          ? parseTimeToMinutes(forcedPreferredTrain.departureTime) + 45
          : 0;
    const targetHourMins = targetDate.getHours() * 60 + targetDate.getMinutes();
    if (forcedArrMins > 0) {
      stationTargetArrivalMins = forcedArrMins;
    } else if (isToday) {
      stationTargetArrivalMins = minTrainDepartureMins + 50;
    } else {
      stationTargetArrivalMins = targetHourMins > 0 ? targetHourMins + 50 : 9 * 60;
    }
  }
  const stationTargetArrivalStr = minutesToTime(stationTargetArrivalMins);

  // Stima preliminare orario partenza in auto
  const approxCarDepartureTimeStr = minutesToTime(
    Math.max(0, stationTargetArrivalMins - 50 - estimatedTimeToStation)
  );

  const dayOutboundPrefs = forcedPreferredTrain
    ? [forcedPreferredTrain]
    : getPreferredTrainsForDayDirection(config, 'outbound', targetDate);

  // Esecuzione in PARALLELO: ricerca treni Trenitalia e stima stradale OSRM per azzerare i tempi morti
  const [optimalTrainResult, drivingEst] = await Promise.all([
    findOptimalCommuterTrain({
      direction: 'outbound',
      departureStation: config.departureStation,
      arrivalStation: config.arrivalStation,
      targetTimeStr: stationTargetArrivalStr,
      targetDate,
      trainOffset: selectedTrainOffset,
      selectedTrainNumber,
      forceRefresh,
      minDepartureMins: isToday ? minTrainDepartureMins : undefined,
      ignoreCurrentTime,
      includeIntercity: config.includeIntercity ?? false,
      preferredTrain: forcedPreferredTrain,
      preferredTrainsForDay: forcedPreferredTrain ? undefined : dayOutboundPrefs,
      filterPreferredByTargetWindow: Boolean(targetLecture && isExplicitClass),
      scheduledOnly: fastCalendarMode && ignoreCurrentTime,
    }),
    carEnabled && !fastCalendarMode
      ? calculateDrivingEstimate(
          config.originAddress,
          config.departureStation.shortName || config.departureStation.name,
          approxCarDepartureTimeStr,
          config.originCoords,
          targetDate
        )
      : Promise.resolve(null),
  ]);

  let { train, availableTrains, selectedIndex } = optimalTrainResult;
  let prefetchedOutboundBoard: TransitBoardResult | undefined;
  let resolvedOutboundLiveContext: boolean | undefined;
  let resolvedOutboundConstraintTime: string | undefined;
  let resolvedOutboundMinDepTime: string | undefined;
  let actualRomeStation = getRomeStationName(config, train, 'outbound');

  let activeTransitSolution = transitSolution;
  let activeTransitMins = transitMins;
  if (
    targetLecture &&
    actualRomeStation &&
    actualRomeStation !== (config.arrivalStation.shortName || config.arrivalStation.name)
  ) {
    const updatedTransit = getOptimalRomeTransit({
      fromStationCode: config.arrivalStation.code,
      fromStationName: actualRomeStation,
      classroom: {
        displayName: targetLecture.room,
        buildingName: targetLecture.buildingName || '',
        buildingCode: targetLecture.buildingCode || '',
        address: targetLecture.address,
        latitude: targetLecture.latitude,
        longitude: targetLecture.longitude,
      },
      direction: 'to_campus',
      preferredMode: config.transitLeg?.preferredMode || 'auto',
    });
    if (updatedTransit) {
      activeTransitSolution = updatedTransit;
      activeTransitMins = updatedTransit.durationMinutes;
    }
  }

  // Tragitto auto con calcolo automatico percorso e profilo traffico Google Maps
  let carDuration = 0;
  // La distanza chilometrica tra residenza e stazione di riferimento è fissa e costante;
  // con il traffico varia solo il minutaggio di percorrenza (~X min), non i km.
  const baseSavedKm = config.carLeg.distanceKm && config.carLeg.distanceKm > 0 ? config.carLeg.distanceKm : 0;
  let carDistanceKm = baseSavedKm || (drivingEst?.distanceKm ?? 17.2);
  let carTrafficNote: string | undefined = undefined;
  let carTrafficFluency: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' | undefined = undefined;
  let carTrafficPeak = false;
  let carTrafficBaseline = 0;
  let carTrafficDelay = 0;

  if (drivingEst) {
    if (!baseSavedKm && drivingEst.distanceKm) {
      carDistanceKm = drivingEst.distanceKm;
    }
    carTrafficNote = drivingEst.trafficCondition || config.carLeg.trafficCondition;
    carTrafficFluency = drivingEst.fluencyStatus || config.carLeg.trafficFluency;
    carTrafficPeak = Boolean(drivingEst.isPeakHour);
    carTrafficBaseline = Math.ceil(drivingEst.baseDurationMinutes || config.carLeg.baseDurationMinutes || config.carLeg.durationMinutes || 24);
    carTrafficDelay = Math.max(drivingEst.trafficDelayMinutes ?? 0, config.carLeg.trafficDelayMinutes ?? 0);
    carDuration = Math.ceil(carTrafficBaseline + carTrafficDelay);
  } else if (carEnabled) {
    carTrafficBaseline = Math.ceil(config.carLeg.baseDurationMinutes || config.carLeg.durationMinutes || 24);
    carTrafficDelay = Math.max(0, config.carLeg.trafficDelayMinutes ?? 0);
    carTrafficNote = config.carLeg.trafficCondition;
    carTrafficFluency = config.carLeg.trafficFluency;
    carDuration = Math.ceil(carTrafficBaseline + carTrafficDelay);
  }

  const parkDuration = carEnabled ? (config.carLeg.parkingBufferMinutes ?? 7) : 0;
  const actualTimeToStation = carEnabled ? carDuration + parkDuration : 10;

  const isTrainCatchable = (t: LiveTrainInfo) => {
    if (!isToday) return true;
    if (t.isDepartedFromStation) return false;
    const dep = parseTimeToMinutes(t.departureTimeActual || t.departureTimePlanned || '');
    return dep - actualTimeToStation >= nowMins;
  };

  const hasPreferredOutbound = Boolean(
    forcedPreferredTrain ||
      optimalTrainResult.matchedPreferred ||
      dayOutboundPrefs.some((p) => doesPreferredTrainMatchLiveTrain(p, train))
  );

  // Selezione dinamica lezione target e treno ottimale:
  // Se la lezione è già cominciata ma ci sono treni/combinazioni per arrivare prima che finisca completamente,
  // targhetta quella lezione e seleziona il treno utile per arrivare al più presto.
  // Se invece la lezione è in corso ma NESSUNA combinazione permette di arrivare prima del termine,
  // targhetta la lezione successiva e calcola il treno ottimale per quella.
  if (
    isToday &&
    !isExplicitClass &&
    dayClasses.length > 0 &&
    !(hasPreferredOutbound && isTrainCatchable(train))
  ) {
    const candidateClasses = dayClasses.filter((c) => {
      const cEnd = parseTimeToMinutes(c.endTime || '18:00');
      return cEnd > nowMins;
    });

    let resolvedCandidate: ClassEvent | null = null;
    let resolvedTrain: LiveTrainInfo | null = null;
    let resolvedTransitSolution: ReturnType<typeof getOptimalRomeTransit> | null = null;

    for (const candidate of candidateClasses) {
      const cStart = parseTimeToMinutes(candidate.startTime || '08:30');
      const cEnd = parseTimeToMinutes(candidate.endTime || '18:00');

      const cContext = `${candidate.building || ''} ${candidate.address || ''}`.trim();
      const cResolved = resolveClassroom(candidate.room || 'Aula', cContext);
      const cBuildingCode =
        candidate.building?.match(/RM\d{3}/i)?.[0] ||
        candidate.address?.match(/RM\d{3}/i)?.[0] ||
        cResolved.buildingCode ||
        '';
      const cTargetAddress = formatSapienzaAddress(candidate.address || cResolved.address, cBuildingCode);

      const cTransit = getOptimalRomeTransit({
        fromStationCode: config.arrivalStation.code,
        fromStationName: actualRomeStation || config.arrivalStation.name,
        classroom: {
          displayName: candidate.room || cResolved.displayName,
          buildingName: candidate.building || cResolved.buildingName,
          buildingCode: cBuildingCode,
          address: cTargetAddress,
          latitude: cResolved.latitude,
          longitude: cResolved.longitude,
        },
        direction: 'to_campus',
        preferredMode: config.transitLeg?.preferredMode || 'auto',
      });
      const cTransitMins = cTransit?.durationMinutes || activeTransitMins || 20;

      // Cerchiamo i treni prendibili che permettono di arrivare in aula prima della fine della lezione
      const viableTrains = availableTrains.filter((t) => {
        if (!isTrainCatchable(t)) return false;
        const arr = parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '');
        if (arr <= 0) return false;
        const classroomArrival = arr + cTransitMins;
        return classroomArrival <= cEnd - 3;
      });

      if (viableTrains.length > 0) {
        // La lezione è raggiungibile prima che termini completamente
        let bestTrain: LiveTrainInfo;

        if (nowMins >= cStart) {
          // 1. La lezione è GIÀ IN CORSO:
          // Lo studente vuole arrivare al più presto per seguire il massimo tempo residuo della lezione.
          const sortedByArrival = [...viableTrains].sort(
            (a, b) =>
              parseTimeToMinutes(a.arrivalTimeActual || a.arrivalTimePlanned || '') -
              parseTimeToMinutes(b.arrivalTimeActual || b.arrivalTimePlanned || '')
          );
          const earliestArr = parseTimeToMinutes(
            sortedByArrival[0].arrivalTimeActual || sortedByArrival[0].arrivalTimePlanned || ''
          );
          // Se un Regionale Veloce / IC arriva entro 6 min dal primissimo arrivo, privilegialo per velocità/comfort
          const fastOption = sortedByArrival.find(
            (t) =>
              (t.isFast || t.category === 'IC') &&
              parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '') <= earliestArr + 6
          );
          bestTrain = fastOption || sortedByArrival[0];
        } else {
          // 2. La lezione NON è ancora iniziata:
          // Cerchiamo treni che arrivano in tempo per l'inizio (arr + cTransitMins <= cStart - bufferMins)
          const onTimeForStart = viableTrains.filter((t) => {
            const arr = parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '');
            return arr + cTransitMins <= cStart - bufferMins;
          });

          if (onTimeForStart.length > 0) {
            // Prendi l'ultimo RV/IC nella finestra prima dell'inizio o l'ultimo treno in tempo
            const targetStationArrival = cStart - bufferMins - cTransitMins;
            const windowTrains = onTimeForStart.filter((t) => {
              const arr = parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '');
              return arr >= targetStationArrival - 65;
            });
            const fastOption = [...(windowTrains.length > 0 ? windowTrains : onTimeForStart)]
              .reverse()
              .find((t) => t.isFast || t.category === 'IC');
            bestTrain = fastOption || onTimeForStart[onTimeForStart.length - 1];
          } else {
            // Nessun treno arriva prima dell'inizio, ma arrivano prima della fine (arrivo a lezione iniziata):
            // prendiamo il primo che arriva al più presto
            const sortedByArrival = [...viableTrains].sort(
              (a, b) =>
                parseTimeToMinutes(a.arrivalTimeActual || a.arrivalTimePlanned || '') -
                parseTimeToMinutes(b.arrivalTimeActual || b.arrivalTimePlanned || '')
            );
            bestTrain = sortedByArrival[0];
          }
        }

        resolvedCandidate = candidate;
        resolvedTrain = bestTrain;
        resolvedTransitSolution = cTransit;
        break; // Trovata la lezione target raggiungibile e il suo treno ottimale!
      }
      // Se nessun treno arriva prima di cEnd, prosegui alla lezione successiva
    }

    if (resolvedCandidate && resolvedTrain) {
      targetLecture = classEventToLectureTarget(resolvedCandidate);
      if (selectedTrainOffset === 0 && !selectedTrainNumber) {
        train = resolvedTrain;
        selectedIndex = availableTrains.findIndex(
          (t) => t.trainNumber === resolvedTrain!.trainNumber
        );
        if (selectedIndex === -1) selectedIndex = 0;
      }
      if (resolvedTransitSolution) {
        activeTransitSolution = resolvedTransitSolution;
        activeTransitMins = resolvedTransitSolution.durationMinutes;
      }
    } else if (candidateClasses.length === 0) {
      // Tutte le lezioni del giorno sono terminate
      const lastC = dayClasses[dayClasses.length - 1];
      targetLecture = classEventToLectureTarget(lastC);
      if (selectedTrainOffset === 0 && !selectedTrainNumber) {
        const nextCatchable = availableTrains.find(isTrainCatchable);
        if (nextCatchable) {
          train = nextCatchable;
          selectedIndex = availableTrains.findIndex(
            (t) => t.trainNumber === nextCatchable.trainNumber
          );
        }
      }
    }
  } else if (isToday && selectedTrainOffset === 0 && !selectedTrainNumber) {
    // Garanzia Assoluta: se è oggi e siamo nella selezione consigliata (offset 0 e nessun treno esplicito),
    // l'orario di partenza da casa non può MAI essere nel passato (homeDepartureMins < nowMins).
    const currentTrainDep = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
    if (currentTrainDep - actualTimeToStation < nowMins) {
      const nextCatchableIdx = availableTrains.findIndex((t) => isTrainCatchable(t));
      if (nextCatchableIdx !== -1) {
        train = availableTrains[nextCatchableIdx];
        selectedIndex = nextCatchableIdx;
      }
    }
  }

  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // Verifica con il tabellone reale dei bus che il treno standard selezionato automaticamente non faccia
  // perdere minuti di lezione (es. attesa coincidenza bus più lunga della stima statica).
  // Se fa arrivare dopo l'inizio della lezione e non c'è una scelta manuale/preferita, scala al treno precedente utile.
  if (
    targetLecture &&
    activeTransitSolution &&
    activeTransitSolution.mode !== 'walk' &&
    !fastCalendarMode &&
    selectedTrainOffset === 0 &&
    !selectedTrainNumber &&
    !hasPreferredOutbound &&
    selectedIndex > 0
  ) {
    const lectureStartM = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndM = parseTimeToMinutes(targetLecture.endTime);
    const lectureNotStartedYet = !isToday || nowMins < lectureStartM;

    if (lectureNotStartedYet && lectureEndM > lectureStartM) {
      const targetLabel = targetLecture.buildingName
        ? `${targetLecture.buildingName} (${targetLecture.room})`
        : targetLecture.room;
      const targetCoords =
        targetLecture.latitude && targetLecture.longitude
          ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
          : undefined;

      const estimateRealArrivalForTrain = async (
        candTrain: LiveTrainInfo,
        candRomeStation: string,
        candStaticTransitMins: number,
        isWalk: boolean
      ): Promise<number | null> => {
        const cDepM = parseTimeToMinutes(
          candTrain.departureTimePlanned || candTrain.departureTimeActual || ''
        );
        const cArrStr =
          (isToday
            ? candTrain.arrivalTimeActual || candTrain.arrivalTimePlanned
            : candTrain.arrivalTimePlanned || candTrain.arrivalTimeActual) || '';
        const cArrM = parseTimeToMinutes(cArrStr);
        if (cDepM <= 0 || cArrM <= 0) return null;

        const cArrRel = normalizeRelativeMinutes(cArrM, cDepM);
        if (isWalk) return cArrRel + candStaticTransitMins;

        try {
          const isTransitLive = Boolean(
            isToday && Math.abs(normalizeRelativeMinutes(cArrM, nowMins) - nowMins) <= 90
          );
          const board = await getStationTransitBoard({
            stationName: candRomeStation,
            targetName: targetLabel,
            targetCoords,
            targetDate: isTransitLive ? undefined : targetDateStr,
            targetTime: isTransitLive ? 'now' : targetLecture!.startTime,
            direction: 'to_campus',
            isLiveContext: isTransitLive,
            constraintTime: targetLecture!.startTime,
            minDepartureTime: cArrStr,
            arrivalBufferMinutes: bufferMins,
            forceRefresh,
          });
          const opt = board.optimalDeparture || board.departures[0];
          const optArrM = opt ? parseTimeToMinutes(opt.arrivalTime) : -1;
          if (optArrM >= 0) {
            return normalizeRelativeMinutes(optArrM, cArrRel);
          }
        } catch {
          // fallback alla stima statica
        }
        return cArrRel + candStaticTransitMins;
      };

      const currentRealArrM = await estimateRealArrivalForTrain(
        train,
        actualRomeStation,
        activeTransitMins,
        false
      );

      if (currentRealArrM !== null && currentRealArrM > lectureStartM) {
        for (let prevIdx = selectedIndex - 1; prevIdx >= Math.max(0, selectedIndex - 3); prevIdx--) {
          const cand = availableTrains[prevIdx];
          if (!cand || !isTrainCatchable(cand)) continue;

          const candStation = getRomeStationName(config, cand, 'outbound');
          let candTransit = activeTransitSolution;
          let candTransitMins = activeTransitMins;
          if (candStation !== actualRomeStation) {
            const recalc = getOptimalRomeTransit({
              fromStationCode: config.arrivalStation.code,
              fromStationName: candStation,
              classroom: {
                displayName: targetLecture.room,
                buildingName: targetLecture.buildingName || '',
                buildingCode: targetLecture.buildingCode || '',
                address: targetLecture.address,
                latitude: targetLecture.latitude,
                longitude: targetLecture.longitude,
              },
              direction: 'to_campus',
              preferredMode: config.transitLeg?.preferredMode || 'auto',
            });
            if (recalc) {
              candTransit = recalc;
              candTransitMins = recalc.durationMinutes;
            }
          }

          const candRealArrM = await estimateRealArrivalForTrain(
            cand,
            candStation,
            candTransitMins,
            candTransit.mode === 'walk'
          );

          if (candRealArrM !== null && candRealArrM <= lectureStartM) {
            train = cand;
            selectedIndex = prevIdx;
            optimalTrainResult.recommendedIndex = prevIdx;
            actualRomeStation = candStation;
            activeTransitSolution = candTransit;
            activeTransitMins = candTransitMins;
            break;
          }
        }
      }
    }
  }

  // NOTA COMMUTER: La partenza del treno a cui ancorare il viaggio per non perdere la coincidenza
  // deve essere SEMPRE l'orario programmato ufficiale (il ritardo non posticipa la partenza programmata da casa).
  // Se la data è oggi, l'arrivo effettivo a destinazione incorpora il ritardo reale (arrivalTimeActual);
  // altrimenti per giorni futuri o passati si fa riferimento esclusivo all'orario ufficiale programmato.
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = isToday
    ? parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '')
    : parseTimeToMinutes(train.arrivalTimePlanned || train.arrivalTimeActual || '');

  // Orario in cui essere in stazione per il treno
  const stationReachMins = trainDepMins - parkDuration;
  // Orario di partenza da casa (anticipato dell'intera durata auto comprensiva di ritardo traffico)
  const homeDepartureMins = stationReachMins - carDuration;

  // Calcola orari intermedi
  const legs: TripLeg[] = [];

  // Leg 1: Auto (se abilitata)
  if (carEnabled) {
    legs.push({
      id: 'car-leg',
      type: 'car',
      title: `Partenza da ${config.originAddress}`,
      subtitle: `Tragitto verso ${config.departureStation.shortName || config.departureStation.name} (~${carDuration} min • ${carDistanceKm} km)`,
      startTime: minutesToTime(homeDepartureMins),
      endTime: minutesToTime(homeDepartureMins + carDuration),
      durationMinutes: carDuration,
      details: {
        mapQuery: getStationNavigationQuery(config.departureStation.shortName || config.departureStation.name),
        mapOriginQuery: config.originAddress,
        travelMode: 'driving',
        targetDate: targetDateStr,
        targetTime: minutesToTime(homeDepartureMins),
        timeType: 'depart_at',
        trafficCondition: carTrafficNote,
        trafficFluency: carTrafficFluency,
        isTrafficPeak: carTrafficPeak,
        trafficBaselineMinutes: carTrafficBaseline,
        trafficDelayMinutes: carTrafficDelay,
      },
    });

    if (parkDuration > 0) {
      // Leg Parcheggio
      legs.push({
        id: 'park-leg',
        type: 'wait',
        title: 'Parcheggio & accesso',
        subtitle: `Parcheggia e raggiungi il binario (${parkDuration} min)`,
        startTime: minutesToTime(homeDepartureMins + carDuration),
        endTime: minutesToTime(trainDepMins),
        durationMinutes: parkDuration,
        details: {
          platform: train.platformActual || train.platformPlanned,
          notes: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In attesa'}`,
        },
      });
    }
  } else {
    // A piedi / arrivo in stazione
    legs.push({
      id: 'station-arrival-leg',
      type: 'walk',
      title: `Arrivo a ${config.departureStation.shortName || config.departureStation.name}`,
      subtitle: `Raggiungi il binario del treno`,
      startTime: minutesToTime(trainDepMins - 10),
      endTime: minutesToTime(trainDepMins),
      durationMinutes: 10,
    });
  }

  // Leg 2: Treno Regionale
  const trainDuration = Math.max(10, elapsedMinutes(trainDepMins, trainArrMins));
  const platformText = train.platformActual || train.platformPlanned
    ? `Binario ${train.platformActual || train.platformPlanned}`
    : 'Binario in definizione';

  const outboundDepTime = (isToday && train.departureTimeActual)
    ? train.departureTimeActual
    : (train.departureTimePlanned || minutesToTime(trainDepMins));
  const outboundArrTime = (isToday && train.arrivalTimeActual)
    ? train.arrivalTimeActual
    : ((isToday && train.delayMinutes > 0 && train.arrivalTimePlanned)
        ? minutesToTime(parseTimeToMinutes(train.arrivalTimePlanned) + train.delayMinutes)
        : (train.arrivalTimePlanned || minutesToTime(trainArrMins)));

  legs.push({
    id: 'train-leg',
    type: 'train',
    title: `Treno ${train.trainNumber} (${train.isFast ? 'Regionale Veloce' : 'Regionale'})`,
    subtitle: `${config.departureStation.shortName || config.departureStation.name} ➔ ${actualRomeStation}`,
    startTime: outboundDepTime,
    endTime: outboundArrTime,
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: isToday ? (train.platformActual || train.platformPlanned) : train.platformPlanned,
      delayMinutes: isToday ? train.delayMinutes : 0,
      isLiveTrain: isToday ? train.isLive : false,
      notes: `${train.category} verso ${train.destination} • ${platformText} • ${isToday ? train.statusDescription : 'Programmato'}`,
    },
  });

  let lectureTimeStatus: CommuterItinerary['lectureTimeStatus'] | undefined = undefined;
  const trainArrRelFromDep = normalizeRelativeMinutes(trainArrMins, trainDepMins);
  let resolvedClassroomArrivalMins = trainArrRelFromDep + activeTransitMins;
  let outboundHasActiveDeadline = true;

  if (targetLecture && activeTransitSolution) {
    // Se il treno effettivamente raggiungibile/selezionato fa arrivare in aula dopo la fine della lezione target iniziale
    // (es. alle 08:07 la prima lezione 08:00-10:00 è ancora in corso ma il primo treno utile 09:32->10:35 arriva alle 10:53),
    // riallinea la lezione target alla prima lezione del giorno ancora attiva/futura al momento dell'arrivo in aula.
    const approxClassroomArrival = trainArrRelFromDep + activeTransitMins;
    if (
      !isExplicitClass &&
      dayClasses.length > 0 &&
      approxClassroomArrival >= parseTimeToMinutes(targetLecture.endTime)
    ) {
      const nextReachableClass = dayClasses.find((c) => {
        const cEnd = parseTimeToMinutes(c.endTime || '18:00');
        return cEnd > approxClassroomArrival && (!isToday || nowMins < cEnd);
      });
      if (nextReachableClass) {
        const updatedTarget = classEventToLectureTarget(nextReachableClass);
        const roomChanged =
          updatedTarget.buildingCode !== targetLecture.buildingCode ||
          updatedTarget.room !== targetLecture.room;
        targetLecture = updatedTarget;
        if (roomChanged) {
          const recalculatedTransit = getOptimalRomeTransit({
            fromStationCode: config.arrivalStation.code,
            fromStationName: actualRomeStation || config.arrivalStation.name,
            classroom: {
              displayName: targetLecture.room,
              buildingName: targetLecture.buildingName || '',
              buildingCode: targetLecture.buildingCode || '',
              address: targetLecture.address,
              latitude: targetLecture.latitude,
              longitude: targetLecture.longitude,
            },
            direction: 'to_campus',
            preferredMode: config.transitLeg?.preferredMode || 'auto',
          });
          if (recalculatedTransit) {
            activeTransitSolution = recalculatedTransit;
            activeTransitMins = recalculatedTransit.durationMinutes;
          }
        }
      }
    }

    // Leg 3: Mezzi Pubblici Urbani (mezzo più efficiente considerando tempi di percorrenza e camminata a piedi)
    let isWalkLeg = activeTransitSolution.mode === 'walk';
    let transitStartStr = minutesToTime(trainArrRelFromDep);
    let transitDurMins = activeTransitMins;
    let actualClassroomArrivalMins = (trainArrRelFromDep % 1440) + activeTransitMins;
    let resolvedOutboundDirectLines: string[] = [];
    let resolvedOutboundSegDetails: {
      walkBeforeMinutes: number;
      inVehicleMinutes: number;
      walkAfterMinutes: number;
      busDepartureTime: string;
      busAlightingTime: string;
      coincidenceAvailableFromTime: string;
      firstAvailableDepartureTime: string;
    } | null = null;

    const resolveOutboundBoard = async (lecture: DayLectureTarget) => {
      try {
        const isTransitLive = Boolean(
          isToday &&
            Math.abs(normalizeRelativeMinutes(trainArrMins, nowMins) - nowMins) <= 90
        );
        const lectureEndM = parseTimeToMinutes(lecture.endTime);
        const hasActiveDeadline = !(isToday && lectureEndM > 0 && nowMins >= lectureEndM);
        outboundHasActiveDeadline = hasActiveDeadline;

        const targetLabel = lecture.buildingName
          ? `${lecture.buildingName} (${lecture.room})`
          : lecture.room;
        const boardData = await getStationTransitBoard({
          stationName: actualRomeStation,
          targetName: targetLabel,
          targetCoords:
            lecture.latitude && lecture.longitude
              ? { lat: lecture.latitude, lng: lecture.longitude }
              : undefined,
          targetDate: isTransitLive ? undefined : targetDateStr,
          targetTime: isTransitLive
            ? 'now'
            : hasActiveDeadline
              ? lecture.startTime
              : outboundArrTime,
          direction: 'to_campus',
          isLiveContext: isTransitLive,
          constraintTime: hasActiveDeadline ? lecture.startTime : undefined,
          minDepartureTime: outboundArrTime,
          arrivalBufferMinutes: bufferMins,
          forceRefresh,
        });
        prefetchedOutboundBoard = boardData;
        resolvedOutboundLiveContext = isTransitLive;
        resolvedOutboundConstraintTime = hasActiveDeadline ? lecture.startTime : undefined;
        resolvedOutboundMinDepTime = outboundArrTime;
        resolvedOutboundDirectLines = getInitialCollapsedDirectLines(
          boardData,
          'to_campus',
          Boolean(outboundArrTime)
        );
        const opt = boardData.optimalDeparture || boardData.departures[0];
        if (opt) {
          const optDepStr = opt.estimatedTime || opt.scheduledTime;
          const optDepM = parseTimeToMinutes(optDepStr);
          const optArrM = parseTimeToMinutes(opt.arrivalTime);
          const walkBefore = Math.max(0, opt.walkBeforeMinutes ?? 0);
          const walkAfter = Math.max(0, opt.walkAfterMinutes ?? 0);
          const inVehicle =
            typeof opt.inVehicleMinutes === 'number' && opt.inVehicleMinutes > 0
              ? opt.inVehicleMinutes
              : Math.max(1, opt.durationMinutes - walkAfter);
          const userStartM = optDepM >= 0 ? optDepM - walkBefore : -1;
          const busAlightStr =
            optDepM >= 0
              ? minutesToTime(optDepM + inVehicle)
              : opt.alightingTime || opt.arrivalTime;
          const doorDur =
            typeof opt.totalDoorToDoorMinutes === 'number' &&
            opt.totalDoorToDoorMinutes > 0
              ? opt.totalDoorToDoorMinutes
              : walkBefore + inVehicle + walkAfter;
          if (optDepStr && optArrM >= 0) {
            let earliestBusM = optDepM >= 0 ? optDepM : Infinity;
            let firstAvailDepStr = optDepStr;
            for (const dep of boardData.departures.slice(0, 4)) {
              const dStr = dep.estimatedTime || dep.scheduledTime;
              const dM = parseTimeToMinutes(dStr);
              if (dM >= 0 && dM < earliestBusM) {
                earliestBusM = dM;
                firstAvailDepStr = dStr;
              }
            }
            transitStartStr =
              userStartM >= 0 && walkBefore > 0
                ? minutesToTime(userStartM)
                : optDepStr;
            transitDurMins = doorDur;
            actualClassroomArrivalMins = optArrM;
            resolvedOutboundSegDetails = {
              walkBeforeMinutes: walkBefore,
              inVehicleMinutes: inVehicle,
              walkAfterMinutes: walkAfter,
              busDepartureTime: optDepStr,
              busAlightingTime: busAlightStr,
              coincidenceAvailableFromTime: outboundArrTime || transitStartStr,
              firstAvailableDepartureTime: firstAvailDepStr,
            };
          }
        }
      } catch {
        // Fallback silenzioso alla stima statica
      }
    };

    if (!isWalkLeg && !fastCalendarMode) {
      await resolveOutboundBoard(targetLecture);
    }

    // Secondo controllo post-risoluzione del mezzo urbano reale: se l'orario esatto di arrivo in aula
    // supera la fine di targetLecture ma c'è una lezione successiva in corso/futura, aggiorna targetLecture.
    const checkArrRel = normalizeRelativeMinutes(actualClassroomArrivalMins, trainArrRelFromDep);
    if (
      !isExplicitClass &&
      dayClasses.length > 0 &&
      checkArrRel >= parseTimeToMinutes(targetLecture.endTime) &&
      (!isToday || nowMins < parseTimeToMinutes(dayClasses[dayClasses.length - 1].endTime || '18:00'))
    ) {
      const nextReachableClass = dayClasses.find((c) => {
        const cEnd = parseTimeToMinutes(c.endTime || '18:00');
        return cEnd > checkArrRel && (!isToday || nowMins < cEnd);
      });
      if (nextReachableClass) {
        const updatedTarget = classEventToLectureTarget(nextReachableClass);
        const roomChanged =
          updatedTarget.buildingCode !== targetLecture.buildingCode ||
          updatedTarget.room !== targetLecture.room;
        targetLecture = updatedTarget;
        prefetchedOutboundBoard = undefined;
        resolvedOutboundConstraintTime = undefined;
        resolvedOutboundMinDepTime = undefined;
        resolvedOutboundLiveContext = undefined;
        resolvedOutboundDirectLines = [];
        resolvedOutboundSegDetails = null;
        if (roomChanged) {
          const recalculatedTransit = getOptimalRomeTransit({
            fromStationCode: config.arrivalStation.code,
            fromStationName: actualRomeStation || config.arrivalStation.name,
            classroom: {
              displayName: targetLecture.room,
              buildingName: targetLecture.buildingName || '',
              buildingCode: targetLecture.buildingCode || '',
              address: targetLecture.address,
              latitude: targetLecture.latitude,
              longitude: targetLecture.longitude,
            },
            direction: 'to_campus',
            preferredMode: config.transitLeg?.preferredMode || 'auto',
          });
          if (recalculatedTransit) {
            activeTransitSolution = recalculatedTransit;
            activeTransitMins = recalculatedTransit.durationMinutes;
            isWalkLeg = activeTransitSolution.mode === 'walk';
            transitDurMins = activeTransitMins;
            actualClassroomArrivalMins = (trainArrRelFromDep % 1440) + activeTransitMins;
          }
        }
        if (!isWalkLeg && !fastCalendarMode) {
          await resolveOutboundBoard(targetLecture);
        }
      }
    }

    resolvedClassroomArrivalMins = normalizeRelativeMinutes(
      actualClassroomArrivalMins,
      trainArrRelFromDep
    );
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
    outboundHasActiveDeadline = !(isToday && lectureEndMins > 0 && nowMins >= lectureEndMins);

    const isLectureFinished =
      !outboundHasActiveDeadline ||
      (lectureEndMins > 0 && resolvedClassroomArrivalMins >= lectureEndMins);

    const isLateArrival =
      !isLectureFinished &&
      resolvedClassroomArrivalMins > lectureStartMins &&
      resolvedClassroomArrivalMins < lectureEndMins;

    legs.push({
      id: 'transit-leg',
      type: isWalkLeg ? 'walk' : 'transit',
      title: isWalkLeg
        ? 'A piedi'
        : formatTransitLinesTitle(
            resolvedOutboundDirectLines,
            activeTransitSolution.lineName
          ),
      subtitle: `${actualRomeStation} → ${targetLecture.room}${targetLecture.buildingName ? ` (${targetLecture.buildingName})` : ''}`,
      startTime: transitStartStr,
      endTime: minutesToTime(resolvedClassroomArrivalMins),
      durationMinutes: transitDurMins,
      details: {
        transitLine: activeTransitSolution.lineName,
        transitMode: activeTransitSolution.mode,
        mapOriginQuery: `Stazione ${actualRomeStation}`,
        mapQuery: targetLecture.address,
        mapCoords: targetLecture.latitude && targetLecture.longitude ? { lat: targetLecture.latitude, lng: targetLecture.longitude } : undefined,
        travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
        targetDate: targetDateStr,
        targetTime: outboundHasActiveDeadline ? targetLecture.startTime : outboundArrTime,
        timeType: outboundHasActiveDeadline ? 'arrive_by' : 'depart_at',
        notes: activeTransitSolution.routeDescription,
        ...(resolvedOutboundSegDetails || {}),
      },
    });

    if (isLectureFinished) {
      // Se la lezione è già finita al momento in cui l'utente arriva in aula o al momento attuale,
      // all'andata la card dell'aula NON deve uscire tra le tappe del viaggio
    } else if (isLateArrival) {
      // Arrivo a lezione già in corso: la tappa diventa "Arrivo a lezione" con badge dei minuti rimanenti
      const remainingMins = Math.max(1, lectureEndMins - resolvedClassroomArrivalMins);
      const remainingBadge = `${formatMinutesToHours(remainingMins)} rimanenti`;
      lectureTimeStatus = {
        type: 'late_arrival',
        minutes: remainingMins,
        badgeText: remainingBadge,
      };

      legs.push({
        id: 'lecture-leg',
        type: 'destination',
        title: `Arrivo a lezione: ${targetLecture.subject}`,
        subtitle: `${targetLecture.room} • ${targetLecture.buildingName || ''}`,
        startTime: minutesToTime(resolvedClassroomArrivalMins),
        endTime: targetLecture.endTime,
        durationMinutes: remainingMins,
        details: {
          notes: `Arrivo a lezione già iniziata • ${remainingBadge}`,
          badgeText: remainingBadge,
          badgeColor: '#f59e0b',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
          remainingLectureMinutes: remainingMins,
        },
      });
    } else {
      // Arrivo puntuale / in anticipo: inizio lezione canonico
      const spareTime = lectureStartMins - resolvedClassroomArrivalMins;
      legs.push({
        id: 'lecture-leg',
        type: 'destination',
        title: `Inizio Lezione: ${targetLecture.subject}`,
        subtitle: `${targetLecture.room} • ${targetLecture.buildingName || ''}`,
        startTime: targetLecture.startTime,
        endTime: targetLecture.endTime,
        durationMinutes: Math.max(60, lectureEndMins - lectureStartMins),
        details: {
          notes: spareTime > 0 ? `Anticipo in aula: +${spareTime} min` : 'Arrivo puntuale a inizio lezione',
        },
      });
    }
  } else {
    // Weekend / Nessuna lezione: Destinazione finale stazione di arrivo
    legs.push({
      id: 'destination-station-leg',
      type: 'destination',
      title: `Arrivo a Stazione ${actualRomeStation}`,
      subtitle: 'Destinazione del tragitto ferroviario raggiunta',
      startTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
      endTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
      durationMinutes: 0,
      details: {
        notes: `Arrivo al binario ${train.platformActual || train.platformPlanned || 'FS'}`,
      },
    });
  }

  const finalArrivalMins = targetLecture ? resolvedClassroomArrivalMins : trainArrRelFromDep;
  let totalTripDuration = elapsedMinutes(
    parseTimeToMinutes(minutesToTime(homeDepartureMins)),
    parseTimeToMinutes(minutesToTime(finalArrivalMins))
  );
  if (totalTripDuration <= 0) {
    const legsSum = legs.reduce((acc, l) => acc + Math.max(0, l.durationMinutes || 0), 0);
    totalTripDuration = legsSum > 0 ? legsSum : trainDuration;
  }

  // Status badge dell'itinerario globale
  let badgeText = 'In orario';
  let badgeColor = '#10b981'; // emerald green
  let isWarning = false;

  if (!isToday) {
    badgeText = 'Programmato';
    badgeColor = '#38bdf8'; // sky blue
    isWarning = false;
  } else {
    const outboundStatusDesc = (train?.statusDescription || '').toLowerCase();
    const delayMins = train?.delayMinutes || 0;
    const isTrainDeparted = Boolean(
      train?.isDeparted &&
      train?.statusDescription !== 'Non partito' &&
      !outboundStatusDesc.includes('non partito')
    );

    if (outboundStatusDesc.includes('soppresso') || outboundStatusDesc.includes('cancellato')) {
      badgeText = 'Treno Soppresso';
      badgeColor = '#ef4444'; // red
      isWarning = true;
    } else if (!isTrainDeparted || train?.isDeparted === false || outboundStatusDesc.includes('non partito')) {
      if (delayMins > 0) {
        badgeText = `Non partito (+${delayMins}m)`;
        badgeColor = delayMins > 15 ? '#ef4444' : '#f59e0b';
        isWarning = delayMins > 10;
      } else {
        badgeText = 'Non partito';
        badgeColor = '#94a3b8';
        isWarning = false;
      }
    } else if (delayMins > 0) {
      badgeText = `+${delayMins}m ritardo`;
      badgeColor = delayMins > 15 ? '#ef4444' : '#f59e0b';
      isWarning = delayMins > 10;
    } else {
      badgeText = 'In orario';
      badgeColor = '#10b981';
      isWarning = false;
    }
  }

  const summary = targetLecture
    ? `Parti alle ${minutesToTime(homeDepartureMins)} da ${config.originAddress} con ${train.trainNumber} (${train.departureTimePlanned || train.departureTimeActual}) per essere in ${targetLecture.room} alle ${minutesToTime(finalArrivalMins)} (inizio lezione ${targetLecture.startTime})`
    : `Parti alle ${minutesToTime(homeDepartureMins)} da ${config.originAddress} con ${train.trainNumber} (${train.departureTimePlanned || train.departureTimeActual}) per arrivare a ${config.arrivalStation.name} alle ${train.arrivalTimeActual || train.arrivalTimePlanned || minutesToTime(trainArrMins)}`;

  // Analisi Andata Smart:
  // Valuta combinazioni alternative di treno + mezzo urbano che partono più tardi da casa
  // rientrando nella tolleranza massima di ritardo configurata dall'utente (maxEarlyLeaveMinutes),
  // utilizzando l'orario effettivo stimato di arrivo in aula e dando priorità alla combinazione più veloce
  // che fa risparmiare il maggior tempo totale di viaggio.
  const outTrainPrefs = config.trainPreferences;
  const smartOutboundEnabled = outTrainPrefs?.smartReturnEnabled ?? true;
  const maxLateArrivalMinutes = smartOutboundEnabled
    ? Math.max(0, outTrainPrefs?.maxEarlyLeaveMinutes ?? 15)
    : 0;

  const recommendedStdIdx =
    typeof optimalTrainResult.recommendedIndex === 'number'
      ? optimalTrainResult.recommendedIndex
      : selectedIndex;
  const standardOutboundTrain = availableTrains[recommendedStdIdx] || train;

  let smartOutboundRecommendation: SmartOutboundRecommendation | undefined = undefined;
  if (
    targetLecture &&
    activeTransitSolution &&
    smartOutboundEnabled &&
    maxLateArrivalMinutes > 0 &&
    availableTrains.length > 1
  ) {
    const lectureStartM = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndM = parseTimeToMinutes(targetLecture.endTime);
    const lectureAlreadyStarted = isToday && nowMins >= lectureStartM;

    if (!lectureAlreadyStarted && lectureEndM > lectureStartM) {
      const selectedTrainCleanNum = train.trainNumber.replace(/\D/g, '');
      const stdNum = standardOutboundTrain.trainNumber.replace(/\D/g, '');
      const isSelectedStdTrain = Boolean(stdNum && selectedTrainCleanNum === stdNum);

      const stdDepM = parseTimeToMinutes(
        standardOutboundTrain.departureTimePlanned ||
          standardOutboundTrain.departureTimeActual ||
          ''
      );
      const stdArrM = isToday
        ? parseTimeToMinutes(
            standardOutboundTrain.arrivalTimeActual ||
              standardOutboundTrain.arrivalTimePlanned ||
              ''
          )
        : parseTimeToMinutes(
            standardOutboundTrain.arrivalTimePlanned ||
              standardOutboundTrain.arrivalTimeActual ||
              ''
          );

      if (stdDepM > 0 && stdArrM > 0) {
        const stdHomeDepM = stdDepM - parkDuration - carDuration;
        const stdStation = getRomeStationName(config, standardOutboundTrain, 'outbound');
        const targetLabel = targetLecture.buildingName
          ? `${targetLecture.buildingName} (${targetLecture.room})`
          : targetLecture.room;
        const targetCoords =
          targetLecture.latitude && targetLecture.longitude
            ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
            : undefined;

        const resolveEstimatedArrivalForTrain = async (
          t: LiveTrainInfo,
          tArrM: number,
          tStation: string,
          staticTransitMins: number
        ): Promise<{ arrivalMins: number; transitLineLabel?: string }> => {
          const tNum = t.trainNumber.replace(/\D/g, '');
          if (tNum && tNum === selectedTrainCleanNum) {
            const selectedOpt =
              prefetchedOutboundBoard?.optimalDeparture ||
              prefetchedOutboundBoard?.departures?.[0];
            return {
              arrivalMins: resolvedClassroomArrivalMins,
              transitLineLabel: selectedOpt?.line,
            };
          }

          const staticFallback = { arrivalMins: tArrM + staticTransitMins };
          if (activeTransitSolution?.mode === 'walk' || fastCalendarMode) {
            return staticFallback;
          }

          try {
            const arrStr = minutesToTime(tArrM);
            const isTransitLive = Boolean(
              isToday &&
                Math.abs(normalizeRelativeMinutes(tArrM, nowMins) - nowMins) <= 90
            );
            const board = await getStationTransitBoard({
              stationName: tStation || config.arrivalStation.name,
              targetName: targetLabel,
              targetCoords,
              targetDate: isTransitLive ? undefined : targetDateStr,
              targetTime: isTransitLive ? 'now' : targetLecture.startTime,
              direction: 'to_campus',
              isLiveContext: isTransitLive,
              constraintTime: targetLecture.startTime,
              minDepartureTime: arrStr,
              arrivalBufferMinutes: bufferMins,
              forceRefresh: false,
            });

            // Usa esattamente lo stesso criterio di resolveOutboundBoard (optimalDeparture || departures[0])
            // così i minuti di ritardo mostrati nel consiglio coincidono al minuto con quelli effettivi scegliendo il treno
            const opt = board.optimalDeparture || board.departures?.[0];
            if (opt?.arrivalTime) {
              const depArrM = parseTimeToMinutes(opt.arrivalTime);
              if (depArrM > 0) {
                return {
                  arrivalMins: normalizeRelativeMinutes(depArrM, tArrM),
                  transitLineLabel: opt.line,
                };
              }
            }
          } catch {
            // Fallback silenzioso alla stima statica
          }
          return staticFallback;
        };

        // Pre-filtra i treni candidati successivi allo standard con una finestra statica ampia
        // prima di risolvere l'orario effettivo del mezzo urbano
        const plausibleCandidates: {
          train: LiveTrainInfo;
          candDepM: number;
          candArrM: number;
          candStation: string;
          candStaticTransitM: number;
        }[] = [];

        for (let idx = 0; idx < availableTrains.length; idx++) {
          const cand = availableTrains[idx];
          const candNum = cand.trainNumber.replace(/\D/g, '');
          if (candNum && candNum === stdNum) continue;

          const statusLow = (cand.statusDescription || '').toLowerCase();
          if (statusLow.includes('soppresso') || statusLow.includes('cancellato')) continue;

          const candDepM = parseTimeToMinutes(
            cand.departureTimePlanned || cand.departureTimeActual || ''
          );
          const candArrM = isToday
            ? parseTimeToMinutes(cand.arrivalTimeActual || cand.arrivalTimePlanned || '')
            : parseTimeToMinutes(cand.arrivalTimePlanned || cand.arrivalTimeActual || '');

          if (candDepM <= stdDepM || candArrM <= 0) continue;
          if (isToday && !isTrainCatchable(cand)) continue;

          const candStation = getRomeStationName(config, cand, 'outbound');
          let candStaticTransitM = activeTransitMins;
          if (
            candStation &&
            candStation !== (config.arrivalStation.shortName || config.arrivalStation.name)
          ) {
            const altTransit = getOptimalRomeTransit({
              fromStationCode: config.arrivalStation.code,
              fromStationName: candStation,
              classroom: {
                displayName: targetLecture.room,
                buildingName: targetLecture.buildingName || '',
                buildingCode: targetLecture.buildingCode || '',
                address: targetLecture.address,
                latitude: targetLecture.latitude,
                longitude: targetLecture.longitude,
              },
              direction: 'to_campus',
              preferredMode: config.transitLeg?.preferredMode || 'auto',
            });
            if (altTransit) candStaticTransitM = altTransit.durationMinutes;
          }

          const staticClassArrM = candArrM + candStaticTransitM;
          if (staticClassArrM >= lectureEndM) continue;
          if (staticClassArrM > lectureStartM + maxLateArrivalMinutes + 20) continue;

          plausibleCandidates.push({
            train: cand,
            candDepM,
            candArrM,
            candStation,
            candStaticTransitM,
          });
        }

        const topCandidates = plausibleCandidates.slice(0, 4);

        if (topCandidates.length > 0) {
          const [stdResolved, ...candResolvedList] = await Promise.all([
            isSelectedStdTrain
              ? Promise.resolve({
                  arrivalMins: resolvedClassroomArrivalMins,
                  transitLineLabel: (
                    prefetchedOutboundBoard?.optimalDeparture ||
                    prefetchedOutboundBoard?.departures?.[0]
                  )?.line,
                })
              : resolveEstimatedArrivalForTrain(
                  standardOutboundTrain,
                  stdArrM,
                  stdStation,
                  activeTransitMins
                ),
            ...topCandidates.map((c) =>
              resolveEstimatedArrivalForTrain(
                c.train,
                c.candArrM,
                c.candStation,
                c.candStaticTransitM
              )
            ),
          ]);

          const stdActualClassArrM = stdResolved.arrivalMins;
          const stdTotalTripMins = elapsedMinutes(
            parseTimeToMinutes(minutesToTime(stdHomeDepM)),
            parseTimeToMinutes(minutesToTime(stdActualClassArrM))
          );

          // Abilita il suggerimento smart quando lo standard è entro la tolleranza (tipicamente puntuale)
          if (stdActualClassArrM <= lectureStartM + maxLateArrivalMinutes) {
            let bestOutMatch: {
              train: LiveTrainInfo;
              lostLectureMinutes: number;
              savedDepartureMinutes: number;
              savedTotalTripMinutes: number;
              candTotalTripMinutes: number;
              stdTotalTripMinutes: number;
              candClassArrM: number;
              transitLineLabel?: string;
              candHomeDepM: number;
              stdHomeDepM: number;
            } | null = null;

            for (let i = 0; i < topCandidates.length; i++) {
              const item = topCandidates[i];
              const resolved = candResolvedList[i];
              const candClassArrM = resolved.arrivalMins;

              if (candClassArrM >= lectureEndM) continue;

              const lostMins = Math.max(0, candClassArrM - lectureStartM);
              if (lostMins > maxLateArrivalMinutes) continue;

              const candHomeDepM = item.candDepM - parkDuration - carDuration;
              const savedDepMins = item.candDepM - stdDepM;
              const candTotalTripMins = elapsedMinutes(
                parseTimeToMinutes(minutesToTime(candHomeDepM)),
                parseTimeToMinutes(minutesToTime(candClassArrM))
              );
              const savedTotalTripMins = stdTotalTripMins - candTotalTripMins;
              const netGainMins = savedDepMins - lostMins;

              // Deve far guadagnare realmente tempo (partenza più tarda che compensa ampiamente l'eventuale ritardo,
              // oppure risparmio significativo sul tempo totale di viaggio)
              if (savedDepMins < 5) continue;
              if (netGainMins < 5 && savedTotalTripMins < 5) continue;

              const isBetter =
                !bestOutMatch ||
                // 1. Priorità alla combinazione più veloce che risparmia il maggior tempo totale di viaggio
                savedTotalTripMins > bestOutMatch.savedTotalTripMinutes ||
                (savedTotalTripMins === bestOutMatch.savedTotalTripMinutes &&
                  (netGainMins >
                    bestOutMatch.savedDepartureMinutes - bestOutMatch.lostLectureMinutes ||
                    (netGainMins ===
                      bestOutMatch.savedDepartureMinutes - bestOutMatch.lostLectureMinutes &&
                      (savedDepMins > bestOutMatch.savedDepartureMinutes ||
                        (savedDepMins === bestOutMatch.savedDepartureMinutes &&
                          lostMins < bestOutMatch.lostLectureMinutes)))));

              if (isBetter) {
                bestOutMatch = {
                  train: item.train,
                  lostLectureMinutes: lostMins,
                  savedDepartureMinutes: savedDepMins,
                  savedTotalTripMinutes: savedTotalTripMins,
                  candTotalTripMinutes: candTotalTripMins,
                  stdTotalTripMinutes: stdTotalTripMins,
                  candClassArrM,
                  transitLineLabel: resolved.transitLineLabel,
                  candHomeDepM,
                  stdHomeDepM,
                };
              }
            }

            if (bestOutMatch) {
              smartOutboundRecommendation = {
                trainNumber: bestOutMatch.train.trainNumber,
                category: bestOutMatch.train.category,
                departureTime:
                  bestOutMatch.train.departureTimePlanned ||
                  bestOutMatch.train.departureTimeActual ||
                  '',
                arrivalTime: isToday
                  ? bestOutMatch.train.arrivalTimeActual ||
                    bestOutMatch.train.arrivalTimePlanned ||
                    ''
                  : bestOutMatch.train.arrivalTimePlanned ||
                    bestOutMatch.train.arrivalTimeActual ||
                    '',
                lostLectureMinutes: bestOutMatch.lostLectureMinutes,
                savedDepartureMinutes: bestOutMatch.savedDepartureMinutes,
                savedTotalTripMinutes: bestOutMatch.savedTotalTripMinutes,
                smartTotalTripMinutes: bestOutMatch.candTotalTripMinutes,
                standardTotalTripMinutes: bestOutMatch.stdTotalTripMinutes,
                smartArrivalTime: minutesToTime(bestOutMatch.candClassArrM),
                transitLineLabel: bestOutMatch.transitLineLabel,
                durationMinutes: bestOutMatch.train.durationMinutes,
                standardTrainNumber: standardOutboundTrain.trainNumber,
                standardDepartureTime:
                  standardOutboundTrain.departureTimePlanned ||
                  standardOutboundTrain.departureTimeActual ||
                  '',
                standardArrivalTime: isToday
                  ? standardOutboundTrain.arrivalTimeActual ||
                    standardOutboundTrain.arrivalTimePlanned ||
                    ''
                  : standardOutboundTrain.arrivalTimePlanned ||
                    standardOutboundTrain.arrivalTimeActual ||
                    '',
                smartHomeDepartureTime: minutesToTime(bestOutMatch.candHomeDepM),
                standardHomeDepartureTime: minutesToTime(bestOutMatch.stdHomeDepM),
                isCurrentlySelected:
                  selectedTrainCleanNum ===
                  bestOutMatch.train.trainNumber.replace(/\D/g, ''),
              };
            }
          }
        }
      }
    }
  }

  return {
    direction: 'outbound',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture: targetLecture || undefined,
    departureTime: minutesToTime(homeDepartureMins),
    arrivalTime: minutesToTime(finalArrivalMins),
    totalDurationMinutes: totalTripDuration,
    legs,
    liveTrain: train,
    availableTrains,
    selectedTrainIndex: selectedIndex,
    statusBadge: {
      text: badgeText,
      color: badgeColor,
      isWarning,
    },
    summaryMessage: summary,
    lectureTimeStatus,
    smartOutboundRecommendation,
    prefetchedTransitBoard: prefetchedOutboundBoard,
    lastUsefulTransitDeparture: outboundHasActiveDeadline
      ? prefetchedOutboundBoard?.lastUsefulDeparture
      : undefined,
    transitLiveContext: resolvedOutboundLiveContext,
    transitConstraintTime: resolvedOutboundConstraintTime,
    transitMinDepartureTime: resolvedOutboundMinDepTime,
    transitArrivalBufferMinutes: outboundHasActiveDeadline ? bufferMins : undefined,
  };
}

/**
 * Calcolo Ritorno: Da Università ➔ Casa
 */
async function computeReturnItinerary(
  config: CommuterConfig,
  targetLecture: DayLectureTarget | null,
  targetDate: Date,
  selectedTrainOffset = 0,
  selectedTrainNumber?: string,
  forceRefresh = false,
  ignoreCurrentTime = false,
  fastCalendarMode = false,
  forcedPreferredTrain?: PreferredTrain,
  isExplicitClass = false
): Promise<CommuterItinerary> {
  const exitClassroomBuffer = 7; // minuti per uscire e raggiungere fermata

  // Percorso ritorno mezzi urbani o a piedi (verso stazione FS, se presente una lezione)
  const transitSolution = targetLecture
    ? getOptimalRomeTransit({
        fromStationCode: config.arrivalStation.code,
        fromStationName: config.arrivalStation.name,
        classroom: {
          displayName: targetLecture.room,
          buildingName: targetLecture.buildingName || '',
          buildingCode: targetLecture.buildingCode || '',
          address: targetLecture.address,
          latitude: targetLecture.latitude,
          longitude: targetLecture.longitude,
        },
        direction: 'to_station',
        preferredMode: config.transitLeg?.preferredMode || 'auto',
      })
    : null;

  const transitMins = transitSolution?.durationMinutes || (targetLecture ? (config.transitLeg.durationMinutes || 20) : 0);

  const now = new Date();
  const isToday =
    !ignoreCurrentTime &&
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Orario di arrivo in stazione a Roma
  let stationArrivalMins: number;
  if (targetLecture) {
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
    if (isToday && nowMins >= lectureEndMins) {
      stationArrivalMins = nowMins + transitMins;
    } else {
      stationArrivalMins = lectureEndMins + exitClassroomBuffer + transitMins;
    }
  } else {
    // Weekend o viaggio stazione-stazione: calcola rispetto all'orario targetDate (o preferenza forzata)
    const forcedDepMins = forcedPreferredTrain?.departureTime
      ? parseTimeToMinutes(forcedPreferredTrain.departureTime)
      : 0;
    const targetHourMins = targetDate.getHours() * 60 + targetDate.getMinutes();
    stationArrivalMins =
      forcedDepMins > 0
        ? forcedDepMins
        : isToday
          ? nowMins
          : targetHourMins > 0
            ? targetHourMins
            : 16 * 60;
  }
  const stationArrivalStr = minutesToTime(stationArrivalMins);

  const carEnabled = config.carLeg.enabled;
  const carWalkBuffer = carEnabled ? 3 : 0; // recupero auto dal parcheggio (3 min dall'arrivo del treno alla partenza in auto)
  // Stima preliminare orario arrivo in stazione di rientro (~45m di treno)
  const approxReturnDrivingTimeStr = minutesToTime(stationArrivalMins + 45 + carWalkBuffer);

  const dayReturnPrefs = forcedPreferredTrain
    ? [forcedPreferredTrain]
    : getPreferredTrainsForDayDirection(config, 'return', targetDate);

  // Avvia la stima auto in parallelo senza bloccare l'avvio del tabellone mezzi urbani al termine del treno
  const drivingEstPromise =
    carEnabled && !fastCalendarMode
      ? calculateDrivingEstimate(
          config.originAddress,
          config.departureStation.shortName || config.departureStation.name,
          approxReturnDrivingTimeStr,
          config.originCoords,
          targetDate
        )
      : Promise.resolve(null);

  const optimalTrainResult = await findOptimalCommuterTrain({
    direction: 'return',
    departureStation: config.arrivalStation, // da Roma Tiburtina
    arrivalStation: config.departureStation, // verso Orte
    targetTimeStr: stationArrivalStr,
    targetDate,
    trainOffset: selectedTrainOffset,
    selectedTrainNumber,
    forceRefresh,
    minDepartureMins: isToday ? stationArrivalMins : undefined,
    ignoreCurrentTime,
    includeIntercity: config.includeIntercity ?? false,
    preferredTrain: forcedPreferredTrain,
    preferredTrainsForDay: forcedPreferredTrain ? undefined : dayReturnPrefs,
    filterPreferredByTargetWindow: Boolean(targetLecture && isExplicitClass),
    scheduledOnly: fastCalendarMode && ignoreCurrentTime,
  });

  let { train, availableTrains, selectedIndex } = optimalTrainResult;
  let prefetchedReturnBoard: TransitBoardResult | undefined;
  let resolvedReturnLiveContext: boolean | undefined;
  let resolvedReturnConstraintTime: string | undefined;
  let resolvedReturnMinDepTime: string | undefined;
  let resolvedReturnPreferLatest = false;
  const standardTrainIdxBase =
    typeof optimalTrainResult.recommendedIndex === 'number'
      ? optimalTrainResult.recommendedIndex
      : selectedIndex;

  const hasMatchedPreferredReturn = Boolean(
    forcedPreferredTrain ||
      optimalTrainResult.matchedPreferred ||
      dayReturnPrefs.some((p) => doesPreferredTrainMatchLiveTrain(p, train))
  );

  // Garanzia Assoluta: se è oggi e siamo nella selezione consigliata (offset 0, nessun treno esplicito e nessuna preferenza esplicita),
  // il treno non può MAI partire prima dell'orario in cui il viaggiatore giunge in stazione (stationArrivalMins).
  let resolvedStandardIdx = standardTrainIdxBase;
  if (isToday || hasMatchedPreferredReturn) {
    const stdTrain = availableTrains[resolvedStandardIdx] || train;
    const stdDep = parseTimeToMinutes(stdTrain.departureTimePlanned || stdTrain.departureTimeActual || '');
    if (stdDep < stationArrivalMins) {
      const nextCatchableIdx = availableTrains.findIndex((t) => {
        const dep = parseTimeToMinutes(t.departureTimePlanned || t.departureTimeActual || '');
        return dep >= stationArrivalMins;
      });
      if (nextCatchableIdx !== -1) {
        resolvedStandardIdx = nextCatchableIdx;
      }
    }
  }

  if (isToday && selectedTrainOffset === 0 && !selectedTrainNumber && !hasMatchedPreferredReturn) {
    const currentTrainDep = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
    if (currentTrainDep < stationArrivalMins && availableTrains[resolvedStandardIdx]) {
      train = availableTrains[resolvedStandardIdx];
      selectedIndex = resolvedStandardIdx;
    }
  }

  const actualRomeStation = getRomeStationName(config, train, 'return');

  let activeTransitSolution = transitSolution;
  let activeTransitMins = transitMins;
  if (
    targetLecture &&
    actualRomeStation &&
    actualRomeStation !== (config.arrivalStation.shortName || config.arrivalStation.name)
  ) {
    const updatedTransit = getOptimalRomeTransit({
      fromStationCode: config.arrivalStation.code,
      fromStationName: actualRomeStation,
      classroom: {
        displayName: targetLecture.room,
        buildingName: targetLecture.buildingName || '',
        buildingCode: targetLecture.buildingCode || '',
        address: targetLecture.address,
        latitude: targetLecture.latitude,
        longitude: targetLecture.longitude,
      },
      direction: 'to_station',
      preferredMode: config.transitLeg?.preferredMode || 'auto',
    });
    if (updatedTransit) {
      activeTransitSolution = updatedTransit;
      activeTransitMins = updatedTransit.durationMinutes;
    }
  }

  // NOTA COMMUTER: La partenza del treno a cui ancorare il rientro da Roma
  // deve essere l'orario programmato ufficiale. L'arrivo effettivo incorpora il ritardo reale solo se la data è oggi.
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = isToday
    ? parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '')
    : parseTimeToMinutes(train.arrivalTimePlanned || train.arrivalTimeActual || '');

  const targetDateStr = targetDate.toISOString().slice(0, 10);
  const legs: TripLeg[] = [];
  let lectureTimeStatus: CommuterItinerary['lectureTimeStatus'] | undefined = undefined;
  let initialStartMins = stationArrivalMins;

  const effectiveDepMins = Math.max(
    trainDepMins,
    parseTimeToMinutes(train.departureTimeActual || '')
  );

  const isTrainAlreadyPassed = Boolean(
    isToday &&
    !train.isStoppedInStation && (
      train.isDepartedFromStation ||
      (train.statusDescription || '').toLowerCase().includes('passato') ||
      (train.statusDescription || '').toLowerCase().includes('arrivato') ||
      (train.isLive
        ? (train.isDepartedFromStation || (effectiveDepMins > 0 && nowMins > effectiveDepMins + 5))
        : (trainDepMins > 0 && nowMins > trainDepMins))
    )
  );

  if (targetLecture && activeTransitSolution) {
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);

    // Orario massimo stimato entro cui uscire dall'aula per raggiungere la stazione e prendere il treno
    const requiredDepartureFromCampusMins = trainDepMins - activeTransitMins - exitClassroomBuffer;

    const isLectureFinished = isToday && nowMins >= lectureEndMins;
    const isLectureInProgress = isToday && nowMins >= lectureStartMins && nowMins < lectureEndMins;
    const isEarlyDeparture = !isLectureFinished && (requiredDepartureFromCampusMins < lectureEndMins);
    const isExplicitEarlyTrainSelection = Boolean(
      selectedTrainNumber || selectedTrainOffset !== 0 || hasMatchedPreferredReturn
    );
    // In modalità standard (senza consiglio smart o selezione esplicita di un treno anticipato)
    // non si perdono mai minuti di lezione: il tabellone mezzi parte rigorosamente dalla fine della lezione.
    const allowEarlyTransitBeforeLectureEnd = isEarlyDeparture && isExplicitEarlyTrainSelection;

    const isWalkLeg = activeTransitSolution.mode === 'walk';
    let resolvedReturnDirectLines: string[] = [];
    let resolvedReturnOpt: {
      startMins: number;
      busStartMins: number;
      endMins: number;
      durationMinutes: number;
      walkBeforeMinutes: number;
      inVehicleMinutes: number;
      walkAfterMinutes: number;
      busDepartureTime: string;
      busAlightingTime: string;
      coincidenceAvailableFromTime: string;
      firstAvailableDepartureTime: string;
    } | null = null;

    if (!isWalkLeg && trainDepMins > 0 && !fastCalendarMode) {
      try {
        const approxTransitStart = isLectureFinished
          ? nowMins
          : allowEarlyTransitBeforeLectureEnd
            ? requiredDepartureFromCampusMins
            : lectureEndMins + exitClassroomBuffer;
        const trainDepRel = normalizeRelativeMinutes(trainDepMins, nowMins);
        const isTransitLive = Boolean(
          isToday &&
            !isTrainAlreadyPassed &&
            (isLectureFinished ||
              (approxTransitStart >= nowMins - 5 && approxTransitStart <= nowMins + 75) ||
              Math.abs(trainDepRel - nowMins) <= 75)
        );
        const targetLabel = targetLecture.buildingName
          ? `${targetLecture.buildingName} (${targetLecture.room})`
          : targetLecture.room;
        const computedMinDepTime =
          !isLectureFinished && !allowEarlyTransitBeforeLectureEnd
            ? targetLecture.endTime
            : undefined;
        const computedConstraintTime = minutesToTime(trainDepMins);
        const computedPreferLatest = Boolean(
          allowEarlyTransitBeforeLectureEnd ||
            (isTrainAlreadyPassed && isEarlyDeparture)
        );
        const boardData = await getStationTransitBoard({
          stationName: actualRomeStation,
          targetName: targetLabel,
          targetCoords:
            targetLecture.latitude && targetLecture.longitude
              ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
              : undefined,
          targetDate: isTransitLive && !computedMinDepTime ? undefined : targetDateStr,
          targetTime: isTransitLive
            ? 'now'
            : computedMinDepTime || minutesToTime(Math.max(0, trainDepMins - activeTransitMins)),
          direction: 'to_station',
          isLiveContext: isTransitLive,
          constraintTime: computedConstraintTime,
          minDepartureTime: computedMinDepTime,
          arrivalBufferMinutes: 5,
          preferLatestBeforeDeadline: computedPreferLatest,
          forceRefresh,
        });
        prefetchedReturnBoard = boardData;
        resolvedReturnLiveContext = isTransitLive;
        resolvedReturnConstraintTime = computedConstraintTime;
        resolvedReturnMinDepTime = computedMinDepTime;
        resolvedReturnPreferLatest = computedPreferLatest;
        resolvedReturnDirectLines = getInitialCollapsedDirectLines(
          boardData,
          'to_station',
          Boolean(computedMinDepTime)
        );
        const opt = boardData.optimalDeparture || boardData.departures[0];
        if (opt) {
          const depStr = opt.estimatedTime || opt.scheduledTime;
          const sM = parseTimeToMinutes(depStr);
          const eM = parseTimeToMinutes(opt.arrivalTime);
          const walkBefore = Math.max(0, opt.walkBeforeMinutes ?? 0);
          const walkAfter = Math.max(0, opt.walkAfterMinutes ?? 0);
          const inVehicle =
            typeof opt.inVehicleMinutes === 'number' && opt.inVehicleMinutes > 0
              ? opt.inVehicleMinutes
              : Math.max(1, opt.durationMinutes - walkAfter);
          const userStartM = sM >= 0 ? Math.max(0, sM - walkBefore) : sM;
          const busAlightStr =
            sM >= 0
              ? minutesToTime(sM + inVehicle)
              : opt.alightingTime || opt.arrivalTime;
          const doorDur =
            typeof opt.totalDoorToDoorMinutes === 'number' &&
            opt.totalDoorToDoorMinutes > 0
              ? opt.totalDoorToDoorMinutes
              : walkBefore + inVehicle + walkAfter;
          if (sM >= 0 && eM >= 0) {
            let earliestBusM = sM;
            let earliestLeaveM = userStartM;
            let firstAvailDepStr = depStr;
            for (const dep of boardData.departures.slice(0, 4)) {
              const dStr = dep.estimatedTime || dep.scheduledTime;
              const dM = parseTimeToMinutes(dStr);
              if (dM < 0) continue;
              const dWalkBefore = Math.max(0, dep.walkBeforeMinutes ?? 0);
              const dLeaveM = Math.max(0, dM - dWalkBefore);
              if (dM < earliestBusM) {
                earliestBusM = dM;
                firstAvailDepStr = dStr;
              }
              if (dLeaveM < earliestLeaveM) {
                earliestLeaveM = dLeaveM;
              }
            }
            const anchorFromStr =
              computedMinDepTime ||
              minutesToTime(Math.max(0, Math.min(userStartM, earliestLeaveM)));
            resolvedReturnOpt = {
              startMins: userStartM,
              busStartMins: sM,
              endMins: eM,
              durationMinutes: doorDur,
              walkBeforeMinutes: walkBefore,
              inVehicleMinutes: inVehicle,
              walkAfterMinutes: walkAfter,
              busDepartureTime: depStr,
              busAlightingTime: busAlightStr,
              coincidenceAvailableFromTime: anchorFromStr,
              firstAvailableDepartureTime: firstAvailDepStr,
            };
          }
        }
      } catch {
        // Fallback silenzioso alla stima statica
      }
    }

    const resolvedLeaveOriginMins = resolvedReturnOpt
      ? resolvedReturnOpt.startMins
      : requiredDepartureFromCampusMins;
    const effectiveIsEarlyDeparture =
      !isLectureFinished &&
      (resolvedReturnOpt
        ? resolvedLeaveOriginMins < lectureEndMins
        : isEarlyDeparture);

    const returnSegDetails = resolvedReturnOpt
      ? {
          walkBeforeMinutes: resolvedReturnOpt.walkBeforeMinutes,
          inVehicleMinutes: resolvedReturnOpt.inVehicleMinutes,
          walkAfterMinutes: resolvedReturnOpt.walkAfterMinutes,
          busDepartureTime: resolvedReturnOpt.busDepartureTime,
          busAlightingTime: resolvedReturnOpt.busAlightingTime,
          coincidenceAvailableFromTime:
            resolvedReturnOpt.coincidenceAvailableFromTime,
          firstAvailableDepartureTime:
            resolvedReturnOpt.firstAvailableDepartureTime,
        }
      : {};

    if (isTrainAlreadyPassed) {
      // SCENARIO DEDICATO: Treno già passato dalla stazione di partenza del pendolare (es. Roma Tiburtina)
      // Blocca la tappa del viaggio relativa al pullman all'ultimo orario utile prima del passaggio del treno,
      // preservando la coerenza di tutta l'architettura delle lezioni (in corso, terminata, orario naturale).
      const lockedTransitEndMins = resolvedReturnOpt ? resolvedReturnOpt.endMins : trainDepMins;
      const lockedTransitStartMins = resolvedReturnOpt
        ? resolvedReturnOpt.startMins
        : Math.max(0, lockedTransitEndMins - activeTransitMins);
      const lockedDurMins = resolvedReturnOpt ? resolvedReturnOpt.durationMinutes : activeTransitMins;
      initialStartMins = lockedTransitStartMins;

      const isEarlyForLecture =
        requiredDepartureFromCampusMins < lectureEndMins &&
        trainDepMins > lectureStartMins;

      const transitNotes = activeTransitSolution.routeDescription || 'Ultimo mezzo utile prima del passaggio del treno';

      if (isEarlyForLecture) {
        const effectiveLeaveFromLecture = Math.max(
          lectureStartMins,
          lockedTransitStartMins
        );
        const lostMins = Math.max(1, lectureEndMins - effectiveLeaveFromLecture);
        const formattedLost = formatMinutesToHours(lostMins);
        const lostBadge = `Perdi ${formattedLost} di lezione`;

        lectureTimeStatus = {
          type: 'early_departure',
          minutes: lostMins,
          badgeText: lostBadge,
        };
      }

      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : formatTransitLinesTitle(
            resolvedReturnDirectLines,
            activeTransitSolution.lineName
          ),
        subtitle: isWalkLeg
          ? `${targetLecture.room} → Stazione ${actualRomeStation}`
          : `${targetLecture.room} ➔ Stazione ${actualRomeStation}`,
        startTime: minutesToTime(lockedTransitStartMins),
        endTime: minutesToTime(lockedTransitEndMins),
        durationMinutes: lockedDurMins,
        details: {
          transitLine: activeTransitSolution.lineName,
          transitMode: activeTransitSolution.mode,
          travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
          mapOriginQuery: targetLecture.address,
          mapQuery: `Stazione ${actualRomeStation}`,
          targetDate: targetDateStr,
          targetTime: minutesToTime(lockedTransitStartMins),
          timeType: 'depart_at',
          notes: transitNotes,
          ...returnSegDetails,
        },
      });
      // Nessuna attesa fittizia o negativa: il pullman è ancorato all'orario esatto di passaggio del treno.
    } else if (isLectureFinished) {
      // SCENARIO 1: Lezione già terminata (treno non ancora passato)
      // Parte dal mezzo più efficiente disponibile da adesso (o stima immediata da nowMins se offline)
      const stationBuffer = 5; // buffer per raggiungere il binario
      const targetArrivalAtStationMins = Math.max(0, trainDepMins - stationBuffer);
      const idealLatestDepartureMins = Math.max(0, targetArrivalAtStationMins - activeTransitMins);

      const startTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.startMins
        : isToday
          ? nowMins
          : idealLatestDepartureMins;
      const endTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.endMins
        : startTransitMins + activeTransitMins;
      const durTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.durationMinutes
        : activeTransitMins;
      initialStartMins = startTransitMins;

      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : formatTransitLinesTitle(
            resolvedReturnDirectLines,
            activeTransitSolution.lineName
          ),
        subtitle: isWalkLeg
          ? `${targetLecture.room} → Stazione ${actualRomeStation}`
          : `${targetLecture.room} ➔ Stazione ${actualRomeStation}`,
        startTime: minutesToTime(startTransitMins),
        endTime: minutesToTime(endTransitMins),
        durationMinutes: durTransitMins,
        details: {
          transitLine: activeTransitSolution.lineName,
          transitMode: activeTransitSolution.mode,
          travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
          mapOriginQuery: targetLecture.address,
          mapQuery: `Stazione ${actualRomeStation}`,
          targetDate: targetDateStr,
          targetTime: minutesToTime(startTransitMins),
          timeType: 'depart_at',
          notes: activeTransitSolution.routeDescription,
          ...returnSegDetails,
        },
      });

      const waitAtStation = elapsedMinutes(endTransitMins, trainDepMins);
      if (waitAtStation > 3) {
        legs.push({
          id: 'station-wait-leg',
          type: 'wait',
          title: `Attesa in Stazione a ${actualRomeStation}`,
          subtitle: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In definizione'}`,
          startTime: minutesToTime(endTransitMins),
          endTime: minutesToTime(trainDepMins),
          durationMinutes: waitAtStation,
          details: {
            platform: train.platformActual || train.platformPlanned,
          },
        });
      }
    } else if (effectiveIsEarlyDeparture) {
      // SCENARIO 2: Treno che richiede di partire prima del termine della lezione (live o non-live)
      let leaveLectureAtMins: number;
      let startTransitMins: number;
      let lostMins: number;

      if (resolvedReturnOpt) {
        startTransitMins = resolvedReturnOpt.startMins;
        leaveLectureAtMins = Math.max(lectureStartMins, startTransitMins);
        lostMins = Math.max(1, lectureEndMins - leaveLectureAtMins);
      } else if (isLectureInProgress) {
        leaveLectureAtMins = Math.max(nowMins, requiredDepartureFromCampusMins);
        startTransitMins = leaveLectureAtMins + exitClassroomBuffer;
        lostMins = Math.max(1, lectureEndMins - leaveLectureAtMins);
      } else {
        // Pianificazione non live o lezione non ancora iniziata
        leaveLectureAtMins = Math.max(lectureStartMins, requiredDepartureFromCampusMins);
        startTransitMins = leaveLectureAtMins + exitClassroomBuffer;
        lostMins = Math.max(1, lectureEndMins - leaveLectureAtMins);
      }

      const endTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.endMins
        : startTransitMins + activeTransitMins;
      const durTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.durationMinutes
        : activeTransitMins;
      const formattedLost = formatMinutesToHours(lostMins);
      const lostBadge = `Perdi ${formattedLost} di lezione`;

      lectureTimeStatus = {
        type: 'early_departure',
        minutes: lostMins,
        badgeText: lostBadge,
      };
      initialStartMins = leaveLectureAtMins;

      const lectureRoomSubtitle = targetLecture.buildingName
        ? `${targetLecture.room} • ${targetLecture.buildingName}`
        : targetLecture.room;

      legs.push({
        id: 'leave-lecture-leg',
        type: 'destination',
        title: `Termine lezione: ${targetLecture.subject}`,
        subtitle: lectureRoomSubtitle,
        startTime: minutesToTime(leaveLectureAtMins),
        endTime: minutesToTime(leaveLectureAtMins),
        durationMinutes: 0,
        details: {
          notes: `Partenza anticipata durante la lezione • ${lostBadge}`,
          badgeText: lostBadge,
          badgeColor: '#f59e0b',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
          lostLectureMinutes: lostMins,
        },
      });

      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : formatTransitLinesTitle(
            resolvedReturnDirectLines,
            activeTransitSolution.lineName
          ),
        subtitle: isWalkLeg
          ? `${targetLecture.room} → Stazione ${actualRomeStation}`
          : `${targetLecture.room} ➔ Stazione ${actualRomeStation}`,
        startTime: minutesToTime(startTransitMins),
        endTime: minutesToTime(endTransitMins),
        durationMinutes: durTransitMins,
        details: {
          transitLine: activeTransitSolution.lineName,
          transitMode: activeTransitSolution.mode,
          travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
          mapOriginQuery: targetLecture.address,
          mapQuery: `Stazione ${actualRomeStation}`,
          targetDate: targetDateStr,
          targetTime: minutesToTime(startTransitMins),
          timeType: 'depart_at',
          notes: activeTransitSolution.routeDescription,
          ...returnSegDetails,
        },
      });

      const waitAtStation = elapsedMinutes(endTransitMins, trainDepMins);
      if (waitAtStation > 3) {
        legs.push({
          id: 'station-wait-leg',
          type: 'wait',
          title: `Attesa in Stazione a ${actualRomeStation}`,
          subtitle: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In definizione'}`,
          startTime: minutesToTime(endTransitMins),
          endTime: minutesToTime(trainDepMins),
          durationMinutes: waitAtStation,
          details: {
            platform: train.platformActual || train.platformPlanned,
          },
        });
      }
    } else {
      // SCENARIO 3: Rientro al termine naturale della lezione
      // Calcola l'ultimo mezzo utile per arrivare in stazione in tempo per il treno selezionato
      const stationBuffer = 4;
      const earliestCampusLeaveMins = lectureEndMins + exitClassroomBuffer;
      const targetArrivalAtStationMins = Math.max(
        earliestCampusLeaveMins + activeTransitMins,
        trainDepMins - stationBuffer
      );
      const startTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.startMins
        : Math.max(
            earliestCampusLeaveMins,
            targetArrivalAtStationMins - activeTransitMins
          );
      const transitEndMins = resolvedReturnOpt
        ? resolvedReturnOpt.endMins
        : startTransitMins + activeTransitMins;
      const durTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.durationMinutes
        : activeTransitMins;

      const lectureRoomSubtitle = targetLecture.buildingName
        ? `${targetLecture.room} • ${targetLecture.buildingName}`
        : targetLecture.room;
      initialStartMins = lectureEndMins;
      legs.push({
        id: 'leave-lecture-leg',
        type: 'destination',
        title: `Termine lezione: ${targetLecture.subject}`,
        subtitle: lectureRoomSubtitle,
        startTime: targetLecture.endTime,
        endTime: targetLecture.endTime,
        durationMinutes: 0,
      });

      // Leg 2: Mezzi Urbani verso Stazione (ancorato all'ultimo mezzo utile)
      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : formatTransitLinesTitle(
            resolvedReturnDirectLines,
            activeTransitSolution.lineName
          ),
        subtitle: isWalkLeg
          ? `${targetLecture.room} → Stazione ${actualRomeStation}`
          : `${targetLecture.room} ➔ Stazione ${actualRomeStation}`,
        startTime: minutesToTime(startTransitMins),
        endTime: minutesToTime(transitEndMins),
        durationMinutes: durTransitMins,
        details: {
          transitLine: activeTransitSolution.lineName,
          transitMode: activeTransitSolution.mode,
          travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
          mapOriginQuery: targetLecture.address,
          mapQuery: `Stazione ${actualRomeStation}`,
          targetDate: targetDateStr,
          targetTime: minutesToTime(startTransitMins),
          timeType: 'depart_at',
          notes: activeTransitSolution.routeDescription,
          ...returnSegDetails,
        },
      });

      const waitAtStation = elapsedMinutes(transitEndMins, trainDepMins);
      if (waitAtStation > 3) {
        legs.push({
          id: 'station-wait-leg',
          type: 'wait',
          title: `Attesa in Stazione a ${actualRomeStation}`,
          subtitle: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In definizione'}`,
          startTime: minutesToTime(transitEndMins),
          endTime: minutesToTime(trainDepMins),
          durationMinutes: waitAtStation,
          details: {
            platform: train.platformActual || train.platformPlanned,
          },
        });
      }
    }
  } else {
    // Weekend o viaggio senza lezione
    if (isTrainAlreadyPassed) {
      // Se il treno è già passato nel fine settimana o senza lezione, la partenza è agganciata al treno stesso
      initialStartMins = trainDepMins;
    } else {
      const waitAtStation = elapsedMinutes(stationArrivalMins, trainDepMins);
      if (waitAtStation > 3) {
        legs.push({
          id: 'station-wait-leg',
          type: 'wait',
          title: `Attesa in Stazione a ${actualRomeStation}`,
          subtitle: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In definizione'}`,
          startTime: minutesToTime(stationArrivalMins),
          endTime: minutesToTime(trainDepMins),
          durationMinutes: waitAtStation,
          details: {
            platform: train.platformActual || train.platformPlanned,
          },
        });
      }
    }
  }

  // Leg 3: Treno di Ritorno
  const trainDuration = Math.max(10, elapsedMinutes(trainDepMins, trainArrMins));
  const returnDepTime = (isToday && train.departureTimeActual)
    ? train.departureTimeActual
    : (train.departureTimePlanned || minutesToTime(trainDepMins));
  const returnArrTime = (isToday && train.arrivalTimeActual)
    ? train.arrivalTimeActual
    : ((isToday && train.delayMinutes > 0 && train.arrivalTimePlanned)
        ? minutesToTime(parseTimeToMinutes(train.arrivalTimePlanned) + train.delayMinutes)
        : (train.arrivalTimePlanned || minutesToTime(trainArrMins)));

  legs.push({
    id: 'return-train-leg',
    type: 'train',
    title: `Treno ${train.trainNumber} (${train.isFast ? 'Regionale Veloce' : 'Regionale'})`,
    subtitle: `${actualRomeStation} ➔ ${config.departureStation.shortName || config.departureStation.name}`,
    startTime: returnDepTime,
    endTime: returnArrTime,
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: isToday ? (train.platformActual || train.platformPlanned) : train.platformPlanned,
      delayMinutes: isToday ? train.delayMinutes : 0,
      isLiveTrain: isToday ? train.isLive : false,
      notes: `${train.category} verso ${train.destination} • Binario ${isToday ? (train.platformActual || train.platformPlanned || 'in definizione') : (train.platformPlanned || 'in definizione')} • ${isToday ? train.statusDescription : 'Programmato'}`,
    },
  });

  // Attende la stima auto (già avviata in parallelo con treno e mezzi urbani) solo prima di comporre la tappa finale
  const drivingEst = await drivingEstPromise;
  let carDuration = 0;
  const baseSavedReturnKm = config.carLeg.distanceKm && config.carLeg.distanceKm > 0 ? config.carLeg.distanceKm : 0;
  let carDistanceKm = baseSavedReturnKm || (drivingEst?.distanceKm ?? 17.2);
  let carTrafficNote: string | undefined = undefined;
  let carTrafficFluency: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' | undefined = undefined;
  let carTrafficPeak = false;
  let carTrafficBaseline = 0;
  let carTrafficDelay = 0;

  if (drivingEst) {
    if (!baseSavedReturnKm && drivingEst.distanceKm) {
      carDistanceKm = drivingEst.distanceKm;
    }
    carTrafficNote = drivingEst.trafficCondition || config.carLeg.trafficCondition;
    carTrafficFluency = drivingEst.fluencyStatus || config.carLeg.trafficFluency;
    carTrafficPeak = Boolean(drivingEst.isPeakHour);
    carTrafficBaseline = Math.ceil(drivingEst.baseDurationMinutes || config.carLeg.baseDurationMinutes || config.carLeg.durationMinutes || 24);
    carTrafficDelay = Math.max(drivingEst.trafficDelayMinutes ?? 0, config.carLeg.trafficDelayMinutes ?? 0);
    carDuration = Math.ceil(carTrafficBaseline + carTrafficDelay);
  } else if (carEnabled) {
    carTrafficBaseline = Math.ceil(config.carLeg.baseDurationMinutes || config.carLeg.durationMinutes || 24);
    carTrafficDelay = Math.max(0, config.carLeg.trafficDelayMinutes ?? 0);
    carTrafficNote = config.carLeg.trafficCondition;
    carTrafficFluency = config.carLeg.trafficFluency;
    carDuration = Math.ceil(carTrafficBaseline + carTrafficDelay);
  }

  const homeArrivalMins =
    normalizeRelativeMinutes(trainArrMins, trainDepMins) + carWalkBuffer + carDuration;

  // Leg 4: Auto verso Casa
  if (carEnabled) {
    legs.push({
      id: 'return-car-leg',
      type: 'car',
      title: `Rientro in Auto verso ${config.originAddress}`,
      subtitle: `Dalla Stazione di ${config.departureStation.shortName || config.departureStation.name} a casa (~${carDuration} min • ${carDistanceKm} km)`,
      startTime: minutesToTime(trainArrMins + carWalkBuffer),
      endTime: minutesToTime(homeArrivalMins),
      durationMinutes: carDuration,
      details: {
        travelMode: 'driving',
        mapOriginQuery: getStationNavigationQuery(config.departureStation.shortName || config.departureStation.name),
        mapQuery: config.originAddress,
        targetDate: targetDateStr,
        targetTime: minutesToTime(trainArrMins + carWalkBuffer),
        timeType: 'depart_at',
        trafficCondition: carTrafficNote,
        trafficFluency: carTrafficFluency,
        isTrafficPeak: carTrafficPeak,
        trafficBaselineMinutes: carTrafficBaseline,
        trafficDelayMinutes: carTrafficDelay,
      },
    });
  }

  let totalTripDuration = elapsedMinutes(
    parseTimeToMinutes(minutesToTime(initialStartMins)),
    parseTimeToMinutes(minutesToTime(homeArrivalMins))
  );
  if (totalTripDuration <= 0) {
    const legsSum = legs.reduce((acc, l) => acc + Math.max(0, l.durationMinutes || 0), 0);
    totalTripDuration = legsSum > 0 ? legsSum : trainDuration;
  }

  let returnBadgeText = 'Rientro in orario';
  let returnBadgeColor = '#10b981';
  let isReturnWarning = false;

  if (!isToday) {
    returnBadgeText = 'Programmato';
    returnBadgeColor = '#38bdf8';
    isReturnWarning = false;
  } else {
    const returnStatusDesc = (train?.statusDescription || '').toLowerCase();
    const delayMins = train?.delayMinutes || 0;
    const isTrainDeparted = Boolean(
      train?.isDeparted &&
      train?.statusDescription !== 'Non partito' &&
      !returnStatusDesc.includes('non partito')
    );

    if (returnStatusDesc.includes('soppresso') || returnStatusDesc.includes('cancellato')) {
      returnBadgeText = 'Treno Soppresso';
      returnBadgeColor = '#ef4444';
      isReturnWarning = true;
    } else if (!isTrainDeparted || train?.isDeparted === false || returnStatusDesc.includes('non partito')) {
      if (delayMins > 0) {
        returnBadgeText = `Non partito (+${delayMins}m)`;
        returnBadgeColor = delayMins > 15 ? '#ef4444' : '#f59e0b';
        isReturnWarning = delayMins > 10;
      } else {
        returnBadgeText = 'Non partito';
        returnBadgeColor = '#94a3b8';
        isReturnWarning = false;
      }
    } else if (delayMins > 0) {
      returnBadgeText = `+${delayMins}m ritardo`;
      returnBadgeColor = delayMins > 15 ? '#ef4444' : '#f59e0b';
      isReturnWarning = delayMins > 10;
    } else {
      returnBadgeText = 'Rientro in orario';
      returnBadgeColor = '#10b981';
      isReturnWarning = false;
    }
  }

  // Analisi Rientro Smart (speculare all'Andata Smart):
  // Valuta combinazioni alternative di mezzo urbano + treno antecedente allo standard
  // utilizzando l'orario effettivo di partenza dall'aula (tramite getStationTransitBoard),
  // rispettando la tolleranza configurata (maxEarlyLeaveMinutes) e dando priorità
  // alla combinazione più veloce che risparmia il maggior tempo totale di viaggio.
  const trainPrefs = config.trainPreferences;
  const smartReturnEnabled = trainPrefs?.smartReturnEnabled ?? true;
  const maxEarlyLeaveMinutes = smartReturnEnabled
    ? Math.max(0, trainPrefs?.maxEarlyLeaveMinutes ?? 15)
    : 0;
  const standardTrain = availableTrains[resolvedStandardIdx] || train;

  let smartReturnRecommendation: SmartReturnRecommendation | undefined = undefined;

  if (
    targetLecture &&
    activeTransitSolution &&
    smartReturnEnabled &&
    maxEarlyLeaveMinutes > 0 &&
    availableTrains.length > 1
  ) {
    const lectureStartM = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndM = parseTimeToMinutes(targetLecture.endTime);
    const lectureAlreadyEnded = isToday && nowMins >= lectureEndM;

    if (!lectureAlreadyEnded && lectureEndM > lectureStartM) {
      const selectedTrainCleanNum = train.trainNumber.replace(/\D/g, '');
      const stdNum = standardTrain.trainNumber.replace(/\D/g, '');
      const isSelectedStdTrain = Boolean(stdNum && selectedTrainCleanNum === stdNum);

      const stdDepM = parseTimeToMinutes(
        standardTrain.departureTimePlanned || standardTrain.departureTimeActual || ''
      );
      const stdArrM = isToday
        ? parseTimeToMinutes(standardTrain.arrivalTimeActual || standardTrain.arrivalTimePlanned || '')
        : parseTimeToMinutes(standardTrain.arrivalTimePlanned || standardTrain.arrivalTimeActual || '');

      if (stdDepM > 0 && stdArrM > 0) {
        const stdStation = getRomeStationName(config, standardTrain, 'return');
        const targetLabel = targetLecture.buildingName
          ? `${targetLecture.buildingName} (${targetLecture.room})`
          : targetLecture.room;
        const targetCoords =
          targetLecture.latitude && targetLecture.longitude
            ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
            : undefined;

        const resolveEstimatedLeaveForTrain = async (
          t: LiveTrainInfo,
          tDepM: number,
          tStation: string,
          staticTransitMins: number,
          isStandard: boolean
        ): Promise<number> => {
          const tNum = t.trainNumber.replace(/\D/g, '');
          if (tNum && tNum === selectedTrainCleanNum) {
            return initialStartMins;
          }

          const staticFallback = isStandard
            ? lectureEndM
            : tDepM - staticTransitMins - exitClassroomBuffer;
          if (activeTransitSolution?.mode === 'walk' || fastCalendarMode) {
            return staticFallback;
          }

          try {
            const approxStart = isStandard
              ? lectureEndM + exitClassroomBuffer
              : tDepM - staticTransitMins - exitClassroomBuffer;
            const tDepRel = normalizeRelativeMinutes(tDepM, nowMins);
            const isTransitLive = Boolean(
              isToday &&
                ((approxStart >= nowMins - 5 && approxStart <= nowMins + 75) ||
                  Math.abs(tDepRel - nowMins) <= 75)
            );
            const computedMinDep = isStandard ? targetLecture.endTime : undefined;
            const board = await getStationTransitBoard({
              stationName: tStation || config.arrivalStation.name,
              targetName: targetLabel,
              targetCoords,
              targetDate: isTransitLive && !computedMinDep ? undefined : targetDateStr,
              targetTime: isTransitLive
                ? 'now'
                : computedMinDep || minutesToTime(Math.max(0, tDepM - staticTransitMins)),
              direction: 'to_station',
              isLiveContext: isTransitLive,
              constraintTime: minutesToTime(tDepM),
              minDepartureTime: computedMinDep,
              arrivalBufferMinutes: 5,
              preferLatestBeforeDeadline: !isStandard,
              forceRefresh: false,
            });
            const opt = board.optimalDeparture || board.departures?.[0];
            if (opt) {
              const depStr = opt.estimatedTime || opt.scheduledTime;
              const sM = parseTimeToMinutes(depStr);
              const walkBefore = Math.max(0, opt.walkBeforeMinutes ?? 0);
              if (sM > 0) {
                return Math.max(0, sM - walkBefore);
              }
            }
          } catch {
            // Fallback silenzioso alla stima statica
          }
          return staticFallback;
        };

        const plausibleReturnCandidates: {
          train: LiveTrainInfo;
          candDepM: number;
          candArrM: number;
          candStation: string;
          candStaticTransitM: number;
        }[] = [];

        for (let idx = 0; idx < availableTrains.length; idx++) {
          const cand = availableTrains[idx];
          const candNum = cand.trainNumber.replace(/\D/g, '');
          if (candNum && candNum === stdNum) continue;

          const statusLow = (cand.statusDescription || '').toLowerCase();
          if (statusLow.includes('soppresso') || statusLow.includes('cancellato')) continue;

          const candDepM = parseTimeToMinutes(cand.departureTimePlanned || cand.departureTimeActual || '');
          const candArrM = isToday
            ? parseTimeToMinutes(cand.arrivalTimeActual || cand.arrivalTimePlanned || '')
            : parseTimeToMinutes(cand.arrivalTimePlanned || cand.arrivalTimeActual || '');

          if (candDepM <= 0 || candArrM <= 0 || candDepM >= stdDepM) continue;

          const candStation = getRomeStationName(config, cand, 'return');
          let candStaticTransitM = transitMins;
          if (candStation && candStation !== (config.arrivalStation.shortName || config.arrivalStation.name)) {
            const altTransit = getOptimalRomeTransit({
              fromStationCode: config.arrivalStation.code,
              fromStationName: candStation,
              classroom: {
                displayName: targetLecture.room,
                buildingName: targetLecture.buildingName || '',
                buildingCode: targetLecture.buildingCode || '',
                address: targetLecture.address,
                latitude: targetLecture.latitude,
                longitude: targetLecture.longitude,
              },
              direction: 'to_station',
              preferredMode: config.transitLeg?.preferredMode || 'auto',
            });
            if (altTransit) candStaticTransitM = altTransit.durationMinutes;
          }

          if (isToday) {
            if (cand.isDepartedFromStation) continue;
            const liveDepM = parseTimeToMinutes(cand.departureTimeActual || cand.departureTimePlanned || '');
            if (liveDepM < nowMins + candStaticTransitM + 2) continue;
          }

          const staticLeaveM = candDepM - candStaticTransitM - exitClassroomBuffer;
          if (staticLeaveM < lectureStartM) continue;
          const staticLostM = Math.max(0, lectureEndM - staticLeaveM);
          if (staticLostM > maxEarlyLeaveMinutes + 20) continue;

          plausibleReturnCandidates.push({
            train: cand,
            candDepM,
            candArrM,
            candStation,
            candStaticTransitM,
          });
        }

        // Prendi fino ai 4 treni antecedenti più vicini allo standard
        const topReturnCandidates = plausibleReturnCandidates.slice(-4);

        if (topReturnCandidates.length > 0) {
          const [stdLeaveM, ...candLeaveList] = await Promise.all([
            isSelectedStdTrain
              ? Promise.resolve(initialStartMins)
              : resolveEstimatedLeaveForTrain(
                  standardTrain,
                  stdDepM,
                  stdStation,
                  activeTransitMins,
                  true
                ),
            ...topReturnCandidates.map((c) =>
              resolveEstimatedLeaveForTrain(
                c.train,
                c.candDepM,
                c.candStation,
                c.candStaticTransitM,
                false
              )
            ),
          ]);

          const stdHomeArrM = stdArrM + carWalkBuffer + carDuration;
          const stdTotalTripMins = elapsedMinutes(
            parseTimeToMinutes(minutesToTime(stdLeaveM)),
            parseTimeToMinutes(minutesToTime(stdHomeArrM))
          );

          let bestRetMatch: {
            train: LiveTrainInfo;
            lostLectureMinutes: number;
            savedArrivalMinutes: number;
            savedTotalTripMinutes: number;
            candArrMins: number;
            standardArrMins: number;
          } | null = null;

          for (let i = 0; i < topReturnCandidates.length; i++) {
            const item = topReturnCandidates[i];
            const candLeaveM = candLeaveList[i];
            if (candLeaveM < lectureStartM) continue;

            const lostMins = Math.max(0, lectureEndM - candLeaveM);
            if (lostMins > maxEarlyLeaveMinutes) continue;

            const candHomeArrM = item.candArrM + carWalkBuffer + carDuration;
            const savedArrMins = stdHomeArrM - candHomeArrM;
            const candTotalTripMins = elapsedMinutes(
              parseTimeToMinutes(minutesToTime(candLeaveM)),
              parseTimeToMinutes(minutesToTime(candHomeArrM))
            );
            const savedTotalTripMins = stdTotalTripMins - candTotalTripMins;
            const netGainMins = savedArrMins - lostMins;

            if (savedArrMins < 5) continue;
            if (netGainMins < 5 && savedTotalTripMins < 5) continue;

            const isBetter =
              !bestRetMatch ||
              savedTotalTripMins > bestRetMatch.savedTotalTripMinutes ||
              (savedTotalTripMins === bestRetMatch.savedTotalTripMinutes &&
                (netGainMins >
                  bestRetMatch.savedArrivalMinutes - bestRetMatch.lostLectureMinutes ||
                  (netGainMins ===
                    bestRetMatch.savedArrivalMinutes - bestRetMatch.lostLectureMinutes &&
                    (savedArrMins > bestRetMatch.savedArrivalMinutes ||
                      (savedArrMins === bestRetMatch.savedArrivalMinutes &&
                        lostMins < bestRetMatch.lostLectureMinutes)))));

            if (isBetter) {
              bestRetMatch = {
                train: item.train,
                lostLectureMinutes: lostMins,
                savedArrivalMinutes: savedArrMins,
                savedTotalTripMinutes: savedTotalTripMins,
                candArrMins: item.candArrM,
                standardArrMins: stdArrM,
              };
            }
          }

          if (bestRetMatch) {
            smartReturnRecommendation = {
              trainNumber: bestRetMatch.train.trainNumber,
              category: bestRetMatch.train.category,
              departureTime:
                bestRetMatch.train.departureTimePlanned ||
                bestRetMatch.train.departureTimeActual ||
                '',
              arrivalTime: isToday
                ? bestRetMatch.train.arrivalTimeActual ||
                  bestRetMatch.train.arrivalTimePlanned ||
                  ''
                : bestRetMatch.train.arrivalTimePlanned ||
                  bestRetMatch.train.arrivalTimeActual ||
                  '',
              lostLectureMinutes: bestRetMatch.lostLectureMinutes,
              savedArrivalMinutes: bestRetMatch.savedArrivalMinutes,
              savedTotalTripMinutes: bestRetMatch.savedTotalTripMinutes,
              durationMinutes: bestRetMatch.train.durationMinutes,
              standardTrainNumber: standardTrain.trainNumber,
              standardDepartureTime:
                standardTrain.departureTimePlanned ||
                standardTrain.departureTimeActual ||
                '',
              standardArrivalTime: isToday
                ? standardTrain.arrivalTimeActual ||
                  standardTrain.arrivalTimePlanned ||
                  ''
                : standardTrain.arrivalTimePlanned ||
                  standardTrain.arrivalTimeActual ||
                  '',
              smartHomeArrivalTime: minutesToTime(
                bestRetMatch.candArrMins + carWalkBuffer + carDuration
              ),
              standardHomeArrivalTime: minutesToTime(
                bestRetMatch.standardArrMins + carWalkBuffer + carDuration
              ),
              isCurrentlySelected:
                selectedTrainCleanNum ===
                bestRetMatch.train.trainNumber.replace(/\D/g, ''),
            };
          }
        }
      }
    }
  }

  return {
    direction: 'return',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture: targetLecture || undefined,
    departureTime: minutesToTime(initialStartMins),
    arrivalTime: minutesToTime(homeArrivalMins),
    totalDurationMinutes: totalTripDuration,
    legs,
    liveTrain: train,
    availableTrains,
    selectedTrainIndex: selectedIndex,
    statusBadge: {
      text: returnBadgeText,
      color: returnBadgeColor,
      isWarning: isReturnWarning,
    },
    summaryMessage: targetLecture
      ? (lectureTimeStatus?.type === 'early_departure'
          ? `Partenza anticipata ore ${minutesToTime(initialStartMins)} (${lectureTimeStatus.badgeText}) ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`
          : `Partenza ore ${minutesToTime(initialStartMins)} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`)
      : `Partenza ore ${train.departureTimePlanned || train.departureTimeActual || minutesToTime(trainDepMins)} da ${config.arrivalStation.name} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`,
    lectureTimeStatus,
    smartReturnRecommendation,
    prefetchedTransitBoard: prefetchedReturnBoard,
    lastUsefulTransitDeparture: prefetchedReturnBoard?.lastUsefulDeparture,
    transitLiveContext: resolvedReturnLiveContext,
    transitConstraintTime: resolvedReturnConstraintTime,
    transitMinDepartureTime: resolvedReturnMinDepTime,
    transitArrivalBufferMinutes: 5,
    transitPreferLatestBeforeDeadline: resolvedReturnPreferLatest,
  };
}

/**
 * Helper condiviso: combina lezioni ufficiali e manuali per un dato giorno JS (0=dom .. 6=sab)
 */
export function getDayClassesForWeekday(
  jsDayIdx: number,
  sched: ScheduleData | null,
  manuals: ManualClassEvent[],
  tabUrl?: string | null
): ClassEvent[] {
  const isWeekendDay = jsDayIdx === 0 || jsDayIdx === 6;
  if (isWeekendDay) return [];

  const schedDayIdx = jsDayIdx - 1;
  const scraped =
    sched?.days && sched.days[schedDayIdx] ? [...sched.days[schedDayIdx]] : [];
  const { dateStr } = getDateForDayIndex(schedDayIdx);
  const manualForDay = (manuals || [])
    .filter(
      (e) =>
        e.dayIndex === schedDayIdx &&
        Boolean(e.room && e.room.trim().length > 0) &&
        (!e.tabUrl || !tabUrl || e.tabUrl === tabUrl) &&
        isManualEventActiveOnDate(e, dateStr)
    )
    .map(manualEventToClassEvent);

  return [...scraped, ...manualForDay].sort(
    (a, b) =>
      parseTimeToMinutes(a.startTime || '08:30') -
      parseTimeToMinutes(b.startTime || '08:30')
  );
}

export function resolveAutoTargetClass(
  classes: ClassEvent[],
  isToday: boolean,
  direction: 'outbound' | 'return',
  now: Date = new Date(),
  minTravelTimeToCampusMins?: number
): ClassEvent | null {
  if (!classes || classes.length === 0) return null;
  if (!isToday) {
    return direction === 'outbound' ? classes[0] : classes[classes.length - 1];
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (direction === 'outbound') {
    const minTravelMins = minTravelTimeToCampusMins ?? 50;
    const reachableClass = classes.find(
      (c) => parseTimeToMinutes(c.endTime || '18:00') > nowMins + minTravelMins
    );
    if (reachableClass) {
      return reachableClass;
    }
    const anyActive = classes.find(
      (c) => parseTimeToMinutes(c.endTime || '18:00') > nowMins
    );
    return anyActive || classes[classes.length - 1];
  }

  const activeClass = classes.find((c) => {
    const s = parseTimeToMinutes(c.startTime || '08:30');
    const e = parseTimeToMinutes(c.endTime || '18:00');
    return s <= nowMins && e > nowMins;
  });
  const pastOrActive = [...classes]
    .reverse()
    .find((c) => parseTimeToMinutes(c.endTime || '18:00') <= nowMins + 30);
  return activeClass || pastOrActive || classes[classes.length - 1];
}

export function resolveViaggioTargetContext(params: {
  effDayIdx: number;
  direction: 'outbound' | 'return';
  config: CommuterConfig;
  schedule: ScheduleData | null;
  manuals: ManualClassEvent[];
  defaultTabUrl?: string | null;
  selectedClassIndex?: number | null;
  excludedLessonIds?: Set<string> | string[];
}): {
  targetDate: Date;
  targetClass: ClassEvent | null;
  isExplicitClass: boolean;
} {
  const {
    effDayIdx,
    direction,
    config,
    schedule,
    manuals,
    defaultTabUrl,
    selectedClassIndex = null,
    excludedLessonIds,
  } = params;

  const targetDate = new Date();
  const currentDay = targetDate.getDay();
  const diff = (effDayIdx - currentDay + 7) % 7;
  targetDate.setDate(targetDate.getDate() + diff);

  const isEffWeekend = effDayIdx === 0 || effDayIdx === 6;
  const currentDayClasses = getDayClassesForWeekday(
    effDayIdx,
    schedule,
    manuals,
    defaultTabUrl
  );
  const excludedSet =
    excludedLessonIds instanceof Set
      ? excludedLessonIds
      : new Set(excludedLessonIds || []);
  const schedDayIdx = jsDayToScheduleDayIndex(effDayIdx);
  const activeDayClasses =
    excludedSet.size > 0
      ? currentDayClasses.filter(
          (c) => !isLessonExcluded(schedDayIdx, c, excludedSet)
        )
      : currentDayClasses;

  const now = new Date();
  const isToday = now.getDay() === effDayIdx;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let targetClass: ClassEvent | null = null;
  const isExplicitClass =
    selectedClassIndex !== null && Boolean(currentDayClasses[selectedClassIndex]);

  if (!isEffWeekend && currentDayClasses.length > 0) {
    if (isExplicitClass) {
      targetClass = currentDayClasses[selectedClassIndex!];
    } else if (activeDayClasses.length > 0) {
      const approxTimeToStation = config?.carLeg?.enabled
        ? (config.carLeg.durationMinutes || 24) +
          (config.carLeg.parkingBufferMinutes ?? 7)
        : 10;
      const approxMinTravel =
        approxTimeToStation + 40 + (config?.transitLeg?.durationMinutes || 20);

      targetClass = resolveAutoTargetClass(
        activeDayClasses,
        isToday,
        direction,
        now,
        approxMinTravel
      );
    }
  }

  const lastClass =
    activeDayClasses.length > 0
      ? activeDayClasses[activeDayClasses.length - 1]
      : null;
  const isAllClassesFinished = Boolean(
    isToday &&
      !isEffWeekend &&
      lastClass &&
      nowMins >= parseTimeToMinutes(lastClass.endTime || '18:00')
  );

  const isTargetClassFinished = Boolean(
    isToday &&
      !isEffWeekend &&
      targetClass &&
      (isAllClassesFinished ||
        nowMins >= parseTimeToMinutes(targetClass.endTime || '18:00'))
  );

  const isTargetClassInProgress = Boolean(
    isToday &&
      !isEffWeekend &&
      targetClass &&
      nowMins >= parseTimeToMinutes(targetClass.startTime || '08:30') &&
      nowMins < parseTimeToMinutes(targetClass.endTime || '18:00')
  );

  if (
    targetClass &&
    !isTargetClassFinished &&
    !(direction === 'outbound' && isTargetClassInProgress)
  ) {
    const timeToUse =
      direction === 'outbound'
        ? targetClass.startTime || '08:30'
        : targetClass.endTime || '16:00';
    const [hh, mm] = timeToUse.split(':').map(Number);
    targetDate.setHours(hh || 8, mm || 30, 0, 0);
  } else if (isToday) {
    targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
  } else {
    targetDate.setHours(direction === 'outbound' ? 8 : 16, 30, 0, 0);
  }

  return { targetDate, targetClass, isExplicitClass };
}

export interface ViaggioStartupSnapshot {
  timestamp: number;
  dayIdx: number;
  direction: 'outbound';
  config: CommuterConfig;
  manualEvents: ManualClassEvent[];
  excludedLessons: ExcludedLessonRecord[];
  schedule: ScheduleData | null;
  defaultTabUrl: string | null;
  itinerary: CommuterItinerary | null;
  disruptions: DisruptionEvent[];
}

const STARTUP_SNAPSHOT_TTL_MS = 90000;
let warmViaggioSnapshot: ViaggioStartupSnapshot | null = null;
let inFlightStartupPrefetch: Promise<ViaggioStartupSnapshot | null> | null = null;

const PERSISTED_ITINERARIES_CACHE_KEY = 'studici_itineraries_cache_v6';
const PERSISTED_ITINERARY_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore
let persistedItinerariesMemory: Record<
  string,
  { timestamp: number; itinerary: CommuterItinerary }
> | null = null;
let persistItinerariesTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Rimuove le polilinee decodificate e le fermate dei treni non selezionati prima della persistenza su disco,
 * riducendo il peso di AsyncStorage di oltre il 90% ed evitando il superamento del limite CursorWindow (2 MB) su Android.
 */
function compactTransitDepartureForDisk(dep?: TransitBoardResult['departures'][number]) {
  if (!dep) return dep;
  const {
    transitPolyline: _tp,
    walkBeforePolyline: _wbp,
    walkAfterPolyline: _wap,
    transferWalkPolylines: _twp,
    intermediateStopCoords: _isc,
    legs,
    ...rest
  } = dep;
  return {
    ...rest,
    ...(Array.isArray(legs)
      ? {
          legs: legs.map(({ polyline: _lp, ...legRest }) => legRest),
        }
      : {}),
  };
}

function compactItineraryForPersistence(itinerary: CommuterItinerary): CommuterItinerary {
  const selectedTrainNum = itinerary.liveTrain?.trainNumber;
  const compactAvailableTrains = Array.isArray(itinerary.availableTrains)
    ? itinerary.availableTrains.map((t) =>
        t.trainNumber === selectedTrainNum
          ? t
          : { ...t, stops: undefined }
      )
    : itinerary.availableTrains;

  const board = itinerary.prefetchedTransitBoard;
  const compactBoard: TransitBoardResult | undefined = board
    ? {
        ...board,
        departures: Array.isArray(board.departures)
          ? board.departures.map((d) => compactTransitDepartureForDisk(d)!)
          : [],
        optimalDeparture: compactTransitDepartureForDisk(board.optimalDeparture),
        lastUsefulDeparture: compactTransitDepartureForDisk(board.lastUsefulDeparture),
      }
    : undefined;

  return {
    ...itinerary,
    availableTrains: compactAvailableTrains,
    prefetchedTransitBoard: compactBoard,
    lastUsefulTransitDeparture: compactTransitDepartureForDisk(
      itinerary.lastUsefulTransitDeparture
    ),
  };
}

function flushPersistedItinerariesCache(): void {
  if (persistItinerariesTimer) {
    clearTimeout(persistItinerariesTimer);
  }
  persistItinerariesTimer = setTimeout(() => {
    persistItinerariesTimer = null;
    if (!persistedItinerariesMemory) return;
    AsyncStorage.setItem(
      PERSISTED_ITINERARIES_CACHE_KEY,
      JSON.stringify(persistedItinerariesMemory)
    ).catch(() => {});
  }, 300);
}

export async function loadPersistedItinerariesCache(): Promise<
  Record<string, CommuterItinerary>
> {
  try {
    if (!persistedItinerariesMemory) {
      const raw = await AsyncStorage.getItem(PERSISTED_ITINERARIES_CACHE_KEY);
      persistedItinerariesMemory = raw ? JSON.parse(raw) : {};
    }
    const now = Date.now();
    const valid: Record<string, CommuterItinerary> = {};
    for (const [k, entry] of Object.entries(persistedItinerariesMemory || {})) {
      if (entry && entry.itinerary && now - (entry.timestamp || 0) < PERSISTED_ITINERARY_TTL_MS) {
        valid[k] = entry.itinerary;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

export function savePersistedItineraryEntry(
  key: string,
  itinerary: CommuterItinerary
): void {
  if (!key || !itinerary) return;
  void (async () => {
    try {
      if (!persistedItinerariesMemory) {
        await loadPersistedItinerariesCache();
      }
      if (!persistedItinerariesMemory) {
        persistedItinerariesMemory = {};
      }
      persistedItinerariesMemory[key] = {
        timestamp: Date.now(),
        itinerary: compactItineraryForPersistence(itinerary),
      };
      const keys = Object.keys(persistedItinerariesMemory);
      if (keys.length > 20) {
        const sorted = keys.sort(
          (a, b) =>
            (persistedItinerariesMemory?.[a]?.timestamp || 0) -
            (persistedItinerariesMemory?.[b]?.timestamp || 0)
        );
        for (const oldKey of sorted.slice(0, keys.length - 20)) {
          delete persistedItinerariesMemory[oldKey];
        }
      }
      flushPersistedItinerariesCache();
    } catch {}
  })();
}

export function clearPersistedItinerariesCache(): void {
  persistedItinerariesMemory = {};
  AsyncStorage.removeItem(PERSISTED_ITINERARIES_CACHE_KEY).catch(() => {});
}

export function invalidateViaggioStartupSnapshot(): void {
  warmViaggioSnapshot = null;
}

export function getWarmViaggioStartupSnapshot(
  dayIdx: number,
  direction: 'outbound' | 'return'
): ViaggioStartupSnapshot | null {
  if (
    warmViaggioSnapshot &&
    warmViaggioSnapshot.dayIdx === dayIdx &&
    warmViaggioSnapshot.direction === direction &&
    Date.now() - warmViaggioSnapshot.timestamp < STARTUP_SNAPSHOT_TTL_MS
  ) {
    return warmViaggioSnapshot;
  }
  return null;
}

export function getInFlightStartupPrefetch(): Promise<ViaggioStartupSnapshot | null> | null {
  return inFlightStartupPrefetch;
}

/**
 * Prefetch selettivo all'avvio dell'app: avvia in parallelo e senza bloccare il boot
 * il caricamento di configurazione Viaggio, orario, lezioni manuali, scioperi/manifestazioni
 * e il calcolo iniziale dell'itinerario odierno di andata (inclusi treno, auto e mezzi).
 */
export function prefetchViaggioStartupData(
  degreeUrlHint?: string | null
): Promise<ViaggioStartupSnapshot | null> {
  if (inFlightStartupPrefetch) {
    return inFlightStartupPrefetch;
  }

  const todayIdx = new Date().getDay();
  if (
    warmViaggioSnapshot &&
    warmViaggioSnapshot.dayIdx === todayIdx &&
    Date.now() - warmViaggioSnapshot.timestamp < STARTUP_SNAPSHOT_TTL_MS
  ) {
    return Promise.resolve(warmViaggioSnapshot);
  }

  inFlightStartupPrefetch = (async (): Promise<ViaggioStartupSnapshot | null> => {
    try {
      const disruptionsPromise = getDisruptions(false).catch(() => [] as DisruptionEvent[]);

      const [configRes, manualsRes, excludedRes, storagePairsRes] = await Promise.allSettled([
        getCommuterConfig(),
        getManualEvents(degreeUrlHint || undefined),
        getExcludedLessons(degreeUrlHint || undefined),
        AsyncStorage.multiGet(['selectedDegreeUrl', 'defaultTabUrl']),
      ]);

      if (configRes.status !== 'fulfilled') {
        await disruptionsPromise;
        return null;
      }

      const currentConfig = configRes.value;
      const currentManuals =
        manualsRes.status === 'fulfilled' ? manualsRes.value : [];
      const currentExcluded =
        excludedRes.status === 'fulfilled' ? excludedRes.value : [];
      const currentExcludedSet = buildExcludedIdSet(currentExcluded);
      const pairs = storagePairsRes.status === 'fulfilled' ? storagePairsRes.value : [];
      const url = degreeUrlHint || pairs[0]?.[1] || null;
      const defaultTabUrl =
        (url ? await AsyncStorage.getItem(`defaultTabUrl_${url}`).catch(() => null) : null) ||
        pairs[1]?.[1] ||
        null;

      let sched: ScheduleData | null = null;
      if (url) {
        try {
          const courseData = await fetchAllCourseData(url);
          const activeTab =
            courseData.tabs.find((t) => t.url === defaultTabUrl) ||
            courseData.tabs[0];
          if (activeTab) {
            sched =
              courseData.schedules[activeTab.url] ||
              courseData.schedules[activeTab.name] ||
              null;
            if (!sched) {
              sched = await fetchScheduleData(activeTab.url);
            }
          }
        } catch {
          // Errore isolato lettura orario: prosegui con itinerario senza blocchi
        }
      }

      let itin: CommuterItinerary | null = null;
      if (currentConfig.enabled !== false) {
        const { targetDate, targetClass, isExplicitClass } =
          resolveViaggioTargetContext({
            effDayIdx: todayIdx,
            direction: 'outbound',
            config: currentConfig,
            schedule: sched,
            manuals: currentManuals,
            defaultTabUrl,
            selectedClassIndex: null,
            excludedLessonIds: currentExcludedSet,
          });

        try {
          itin = await computeCommuterItinerary({
            config: currentConfig,
            scheduleData: sched,
            manualEvents: currentManuals,
            direction: 'outbound',
            targetDate,
            selectedClass: targetClass,
            isExplicitClass,
            selectedTrainOffset: 0,
            forceRefresh: false,
            excludedLessonIds: currentExcludedSet,
          });
        } catch {
          itin = null;
        }
      }

      // Non bloccare la pubblicazione dello snapshot caldo su eventuali scraping scioperi lenti:
      // attendi al massimo 250ms se già quasi pronti, altrimenti aggiorna lo snapshot appena arrivano.
      let resolvedDisruptions: DisruptionEvent[] = [];
      let disruptionsSettled = false;
      const disruptionsWithCapture = disruptionsPromise.then((list) => {
        resolvedDisruptions = list;
        disruptionsSettled = true;
        return list;
      });
      await Promise.race([
        disruptionsWithCapture,
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ]);

      if (itin) {
        savePersistedItineraryEntry(`outbound_${todayIdx}_auto`, itin);
      }
      const snapshot: ViaggioStartupSnapshot = {
        timestamp: Date.now(),
        dayIdx: todayIdx,
        direction: 'outbound',
        config: currentConfig,
        manualEvents: currentManuals,
        excludedLessons: currentExcluded,
        schedule: sched,
        defaultTabUrl,
        itinerary: itin,
        disruptions: resolvedDisruptions,
      };
      warmViaggioSnapshot = snapshot;

      if (!disruptionsSettled) {
        disruptionsWithCapture
          .then((list) => {
            if (warmViaggioSnapshot === snapshot) {
              warmViaggioSnapshot = { ...snapshot, disruptions: list };
            }
          })
          .catch(() => {});
      }
      return snapshot;
    } catch {
      return null;
    } finally {
      inFlightStartupPrefetch = null;
    }
  })();

  return inFlightStartupPrefetch;
}
