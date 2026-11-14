import {
  CommuterConfig,
  CommuterItinerary,
  TripLeg,
  LiveTrainInfo,
  SmartReturnRecommendation,
} from '../types/commuter';
import { ScheduleData, ClassEvent } from './scraper';
import {
  ManualClassEvent,
  manualEventToClassEvent,
  isManualEventActiveOnDate,
} from './manualEvents';
import { getDateForDayIndex } from './attendance';
import { resolveClassroom, formatSapienzaAddress, SAPIENZA_BUILDINGS } from './classroomLocations';
import { getOptimalRomeTransit } from './transitRouter';
import { getStationTransitBoard, TransitBoardResult } from './transitBoardService';
import { calculateDrivingEstimate, getStationNavigationQuery } from './drivingRouter';
import {
  findOptimalCommuterTrain,
  parseTimeToMinutes,
  minutesToTime,
  formatStationName,
} from './trenitaliaApi';

/**
 * Chiave della preferenza treno: direzione + giorno della settimana + orario della lezione
 * (stabile di settimana in settimana). Senza lezione (es. weekend) usa "none".
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

function getPreferredTrainDeparture(
  config: CommuterConfig,
  direction: 'outbound' | 'return',
  date: Date,
  lecture?: { startTime?: string; endTime?: string } | null
): string | undefined {
  return config.trainPreferences?.preferredTrains?.[
    getTrainPreferenceKey(direction, date, lecture)
  ]?.departureTime;
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
  forceRefresh?: boolean;
  ignoreCurrentTime?: boolean; // calcola l'orario programmato canonico senza filtrare rispetto all'ora attuale
  fastCalendarMode?: boolean; // salta chiamate ausiliarie (OSRM/ATAC) per sincronizzazione calendario veloce
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
    forceRefresh = false,
    ignoreCurrentTime = false,
    fastCalendarMode = false,
  } = options;
  const isOutbound = direction === 'outbound';
  const dayClasses = getDayClassesForDate(scheduleData, targetDate, manualEvents);

  // 1. Individua la lezione target del giorno
  const targetLecture = findDayLecture(
    scheduleData,
    targetDate,
    direction,
    manualHour,
    selectedClass,
    ignoreCurrentTime,
    manualEvents
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
      dayClasses,
      isExplicitClass,
      fastCalendarMode
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
      fastCalendarMode
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
  manualEvents?: ManualClassEvent[]
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

  // Se l'utente ha selezionato direttamente una lezione dall'interfaccia
  if (explicitClass) {
    return classEventToLectureTarget(explicitClass);
  }

  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 6 = sab
  const isWeekend = dayIndex === 0 || dayIndex === 6;

  // Nel fine settimana (sabato e domenica) non ci sono lezioni universitarie
  if (isWeekend) {
    return null;
  }

  const dayClasses = getDayClassesForDate(scheduleData, targetDate, manualEvents);

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
  fastCalendarMode = false
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
    // Weekend o viaggio stazione-stazione senza lezioni: calcola rispetto all'orario targetDate
    const targetHourMins = targetDate.getHours() * 60 + targetDate.getMinutes();
    if (isToday) {
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
      preferredDepartureTime: getPreferredTrainDeparture(config, 'outbound', targetDate, targetLecture),
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
  const actualRomeStation = getRomeStationName(config, train, 'outbound');

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
    getPreferredTrainDeparture(config, 'outbound', targetDate, targetLecture)
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

  const targetDateStr = targetDate.toISOString().slice(0, 10);

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
  const trainDuration = Math.max(10, trainArrMins - trainDepMins);
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
  let resolvedClassroomArrivalMins = trainArrMins + activeTransitMins;

  if (targetLecture && activeTransitSolution) {
    // Se il treno effettivamente raggiungibile/selezionato fa arrivare in aula dopo la fine della lezione target iniziale
    // (es. alle 08:07 la prima lezione 08:00-10:00 è ancora in corso ma il primo treno utile 09:32->10:35 arriva alle 10:53),
    // riallinea la lezione target alla prima lezione del giorno ancora attiva/futura al momento dell'arrivo in aula.
    const approxClassroomArrival = trainArrMins + activeTransitMins;
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

    // Leg 3: Mezzi Pubblici Urbani (risolto dinamicamente sull'ultimo mezzo utile considerando tempi di percorrenza e camminata a piedi)
    let isWalkLeg = activeTransitSolution.mode === 'walk';
    let transitStartStr = minutesToTime(trainArrMins);
    let transitDurMins = activeTransitMins;
    let actualClassroomArrivalMins = trainArrMins + activeTransitMins;
    let resolvedOutboundDirectLines: string[] = [];

    if (!isWalkLeg && !fastCalendarMode) {
      try {
        const isTrainAlreadyArrived = Boolean(
          train.isArrivedAtDestination || train.trainStatusType === 'arrived'
        );
        const isTransitLive = Boolean(
          isToday &&
            !isTrainAlreadyArrived &&
            Math.abs(trainArrMins - nowMins) <= 45
        );
        const targetLabel = targetLecture.buildingName
          ? `${targetLecture.buildingName} (${targetLecture.room})`
          : targetLecture.room;
        const boardData = await getStationTransitBoard({
          stationName: actualRomeStation,
          targetName: targetLabel,
          targetCoords:
            targetLecture.latitude && targetLecture.longitude
              ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
              : undefined,
          targetDate: isTransitLive ? undefined : targetDateStr,
          targetTime: isTransitLive ? 'now' : targetLecture.startTime,
          direction: 'to_campus',
          isLiveContext: isTransitLive,
          constraintTime: targetLecture.startTime,
          minDepartureTime: outboundArrTime,
        });
        prefetchedOutboundBoard = boardData;
        resolvedOutboundLiveContext = isTransitLive;
        resolvedOutboundConstraintTime = targetLecture.startTime;
        resolvedOutboundMinDepTime = outboundArrTime;
        resolvedOutboundDirectLines = boardData.directLines || [];
        const opt = boardData.optimalDeparture || boardData.departures[0];
        if (opt) {
          const optDepStr = isTransitLive
            ? opt.estimatedTime || opt.scheduledTime
            : opt.scheduledTime;
          const optArrM = parseTimeToMinutes(opt.arrivalTime);
          if (optDepStr && optArrM > 0) {
            transitStartStr = optDepStr;
            transitDurMins = opt.durationMinutes;
            actualClassroomArrivalMins = optArrM;
          }
        }
      } catch {
        // Fallback silenzioso alla stima statica
      }
    }

    // Secondo controllo post-risoluzione del mezzo urbano reale: se l'orario esatto di arrivo in aula
    // supera la fine di targetLecture ma c'è una lezione successiva in corso/futura, aggiorna targetLecture.
    if (
      !isExplicitClass &&
      dayClasses.length > 0 &&
      actualClassroomArrivalMins >= parseTimeToMinutes(targetLecture.endTime)
    ) {
      const nextReachableClass = dayClasses.find((c) => {
        const cEnd = parseTimeToMinutes(c.endTime || '18:00');
        return cEnd > actualClassroomArrivalMins && (!isToday || nowMins < cEnd);
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
          }
        }
      }
    }

    resolvedClassroomArrivalMins = actualClassroomArrivalMins;
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);

    const isLectureFinished =
      lectureEndMins > 0 && actualClassroomArrivalMins >= lectureEndMins;

    const isLateArrival =
      !isLectureFinished &&
      actualClassroomArrivalMins > lectureStartMins &&
      actualClassroomArrivalMins < lectureEndMins;

    legs.push({
      id: 'transit-leg',
      type: isWalkLeg ? 'walk' : 'transit',
      title: isWalkLeg
        ? 'A piedi'
        : resolvedOutboundDirectLines.length > 0
          ? `Linee ${resolvedOutboundDirectLines.join(' / ')}`
          : activeTransitSolution.lineName,
      subtitle: `${actualRomeStation} → ${targetLecture.room}${targetLecture.buildingName ? ` (${targetLecture.buildingName})` : ''}`,
      startTime: transitStartStr,
      endTime: minutesToTime(actualClassroomArrivalMins),
      durationMinutes: transitDurMins,
      details: {
        transitLine: activeTransitSolution.lineName,
        transitMode: activeTransitSolution.mode,
        mapOriginQuery: `Stazione ${actualRomeStation}`,
        mapQuery: targetLecture.address,
        mapCoords: targetLecture.latitude && targetLecture.longitude ? { lat: targetLecture.latitude, lng: targetLecture.longitude } : undefined,
        travelMode: activeTransitSolution.mode === 'walk' ? 'walking' : 'transit',
        targetDate: targetDateStr,
        targetTime: targetLecture.startTime,
        timeType: 'arrive_by',
        notes: activeTransitSolution.routeDescription,
      },
    });

    if (isLectureFinished) {
      // Se la lezione è già finita al momento in cui l'utente arriva in aula,
      // all'andata la card dell'aula NON deve uscire tra le tappe del viaggio
    } else if (isLateArrival) {
      // Arrivo a lezione già in corso: la tappa diventa "Arrivo a lezione" con badge dei minuti rimanenti
      const remainingMins = Math.max(1, lectureEndMins - actualClassroomArrivalMins);
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
        startTime: minutesToTime(actualClassroomArrivalMins),
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
      const spareTime = lectureStartMins - actualClassroomArrivalMins;
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

  const finalArrivalMins = targetLecture ? resolvedClassroomArrivalMins : trainArrMins;
  const totalTripDuration = finalArrivalMins - homeDepartureMins;

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
    prefetchedTransitBoard: prefetchedOutboundBoard,
    transitLiveContext: resolvedOutboundLiveContext,
    transitConstraintTime: resolvedOutboundConstraintTime,
    transitMinDepartureTime: resolvedOutboundMinDepTime,
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
  fastCalendarMode = false
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
    // Weekend o viaggio stazione-stazione: calcola rispetto all'orario targetDate
    const targetHourMins = targetDate.getHours() * 60 + targetDate.getMinutes();
    stationArrivalMins = isToday ? nowMins : (targetHourMins > 0 ? targetHourMins : 16 * 60);
  }
  const stationArrivalStr = minutesToTime(stationArrivalMins);

  const carEnabled = config.carLeg.enabled;
  const carWalkBuffer = carEnabled ? 3 : 0; // recupero auto dal parcheggio (3 min dall'arrivo del treno alla partenza in auto)
  // Stima preliminare orario arrivo in stazione di rientro (~45m di treno)
  const approxReturnDrivingTimeStr = minutesToTime(stationArrivalMins + 45 + carWalkBuffer);

  // Esecuzione in PARALLELO: ricerca treni Trenitalia e stima stradale OSRM per azzerare i tempi morti
  const [optimalTrainResult, drivingEst] = await Promise.all([
    findOptimalCommuterTrain({
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
      preferredDepartureTime: getPreferredTrainDeparture(config, 'return', targetDate, targetLecture),
      scheduledOnly: fastCalendarMode && ignoreCurrentTime,
    }),
    carEnabled && !fastCalendarMode
      ? calculateDrivingEstimate(
          config.originAddress,
          config.departureStation.shortName || config.departureStation.name,
          approxReturnDrivingTimeStr,
          config.originCoords,
          targetDate
        )
      : Promise.resolve(null),
  ]);

  let { train, availableTrains, selectedIndex } = optimalTrainResult;
  let prefetchedReturnBoard: TransitBoardResult | undefined;
  let resolvedReturnLiveContext: boolean | undefined;
  let resolvedReturnConstraintTime: string | undefined;
  let resolvedReturnMinDepTime: string | undefined;
  const standardTrainIdxBase =
    typeof optimalTrainResult.recommendedIndex === 'number'
      ? optimalTrainResult.recommendedIndex
      : selectedIndex;

  const preferredReturnDep = getPreferredTrainDeparture(
    config,
    'return',
    targetDate,
    targetLecture
  );

  // Garanzia Assoluta: se è oggi e siamo nella selezione consigliata (offset 0, nessun treno esplicito e nessuna preferenza esplicita),
  // il treno non può MAI partire prima dell'orario in cui il viaggiatore giunge in stazione (stationArrivalMins).
  let resolvedStandardIdx = standardTrainIdxBase;
  if (isToday || preferredReturnDep) {
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

  if (isToday && selectedTrainOffset === 0 && !selectedTrainNumber && !preferredReturnDep) {
    const currentTrainDep = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
    if (currentTrainDep < stationArrivalMins && availableTrains[resolvedStandardIdx]) {
      train = availableTrains[resolvedStandardIdx];
      selectedIndex = resolvedStandardIdx;
    }
  }

  // Analisi Rientro Smart Anticipato:
  // Valuta se un treno leggermente antecedente (entro maxEarlyLeaveMinutes di perdita a fine lezione)
  // permette un anticipo sostanziale sull'arrivo rispetto al treno standard post-lezione.
  const trainPrefs = config.trainPreferences;
  const smartReturnEnabled = trainPrefs?.smartReturnEnabled ?? true;
  const maxEarlyLeaveMinutes = smartReturnEnabled
    ? Math.max(0, trainPrefs?.maxEarlyLeaveMinutes ?? 15)
    : 0;
  const minReturnGainMinutes = Math.max(15, trainPrefs?.minReturnGainMinutes ?? 25);
  const standardTrain = availableTrains[resolvedStandardIdx] || train;

  interface SmartCandidateMatch {
    idx: number;
    train: LiveTrainInfo;
    lostLectureMinutes: number;
    savedArrivalMinutes: number;
    standardTrain: LiveTrainInfo;
    candArrMins: number;
    standardArrMins: number;
  }

  let bestSmartMatch: SmartCandidateMatch | null = null;

  if (targetLecture && smartReturnEnabled && maxEarlyLeaveMinutes > 0 && availableTrains.length > 1) {
    const lectureStartM = parseTimeToMinutes(targetLecture.startTime);
    const lectureEndM = parseTimeToMinutes(targetLecture.endTime);
    const lectureAlreadyEnded = isToday && nowMins >= lectureEndM;

    if (!lectureAlreadyEnded && lectureEndM > lectureStartM) {
      const stdDepM = parseTimeToMinutes(
        standardTrain.departureTimePlanned || standardTrain.departureTimeActual || ''
      );
      const stdArrM = isToday
        ? parseTimeToMinutes(standardTrain.arrivalTimeActual || standardTrain.arrivalTimePlanned || '')
        : parseTimeToMinutes(standardTrain.arrivalTimePlanned || standardTrain.arrivalTimeActual || '');

      if (stdDepM > 0 && stdArrM > 0) {
        let bestScore = -Infinity;

        for (let idx = 0; idx < availableTrains.length; idx++) {
          const cand = availableTrains[idx];
          const candNum = cand.trainNumber.replace(/\D/g, '');
          const stdNum = standardTrain.trainNumber.replace(/\D/g, '');
          if (candNum && candNum === stdNum) continue;

          const statusLow = (cand.statusDescription || '').toLowerCase();
          if (statusLow.includes('soppresso') || statusLow.includes('cancellato')) continue;

          const candDepM = parseTimeToMinutes(cand.departureTimePlanned || cand.departureTimeActual || '');
          const candArrM = isToday
            ? parseTimeToMinutes(cand.arrivalTimeActual || cand.arrivalTimePlanned || '')
            : parseTimeToMinutes(cand.arrivalTimePlanned || cand.arrivalTimeActual || '');

          if (candDepM <= 0 || candArrM <= 0 || candDepM >= stdDepM) continue;

          const candStation = getRomeStationName(config, cand, 'return');
          let candTransitM = transitMins;
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
            if (altTransit) candTransitM = altTransit.durationMinutes;
          }

          if (isToday) {
            if (cand.isDepartedFromStation) continue;
            const liveDepM = parseTimeToMinutes(cand.departureTimeActual || cand.departureTimePlanned || '');
            if (liveDepM < nowMins + candTransitM + 2) continue;
          }

          const reqLeaveM = candDepM - candTransitM - exitClassroomBuffer;
          const lostMins = lectureEndM - Math.max(lectureStartM, reqLeaveM);
          if (lostMins < 1 || lostMins > maxEarlyLeaveMinutes) continue;

          const savedArrMins = stdArrM - candArrM;
          const minRequiredSaved = Math.max(minReturnGainMinutes, lostMins * 2);
          if (savedArrMins < minRequiredSaved || savedArrMins - lostMins < 15) continue;

          const score = savedArrMins - lostMins * 1.5;
          if (
            score > bestScore ||
            (score === bestScore && bestSmartMatch && lostMins < bestSmartMatch.lostLectureMinutes)
          ) {
            bestScore = score;
            bestSmartMatch = {
              idx,
              train: cand,
              lostLectureMinutes: lostMins,
              savedArrivalMinutes: savedArrMins,
              standardTrain,
              candArrMins: candArrM,
              standardArrMins: stdArrM,
            };
          }
        }
      }
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

  let carDuration = 0;
  // La distanza chilometrica tra stazione di riferimento e residenza è fissa e costante;
  // con il traffico varia solo il minutaggio di percorrenza (~X min), non i km.
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

  const homeArrivalMins = trainArrMins + carWalkBuffer + carDuration;
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

    const isWalkLeg = activeTransitSolution.mode === 'walk';
    let resolvedReturnDirectLines: string[] = [];
    let resolvedReturnOpt: {
      startMins: number;
      endMins: number;
      durationMinutes: number;
    } | null = null;

    if (!isWalkLeg && trainDepMins > 0 && !fastCalendarMode) {
      try {
        const isTransitLive = Boolean(
          isToday &&
            !isTrainAlreadyPassed &&
            (isLectureFinished ||
              isLectureInProgress ||
              Math.abs(trainDepMins - nowMins) <= 60) &&
            Math.abs(trainDepMins - nowMins) <= 75
        );
        const targetLabel = targetLecture.buildingName
          ? `${targetLecture.buildingName} (${targetLecture.room})`
          : targetLecture.room;
        const computedMinDepTime =
          !isLectureFinished && !isEarlyDeparture ? targetLecture.endTime : undefined;
        const computedConstraintTime = minutesToTime(trainDepMins);
        const boardData = await getStationTransitBoard({
          stationName: actualRomeStation,
          targetName: targetLabel,
          targetCoords:
            targetLecture.latitude && targetLecture.longitude
              ? { lat: targetLecture.latitude, lng: targetLecture.longitude }
              : undefined,
          targetDate: isTransitLive ? undefined : targetDateStr,
          targetTime: isTransitLive ? 'now' : minutesToTime(Math.max(0, trainDepMins - activeTransitMins)),
          direction: 'to_station',
          isLiveContext: isTransitLive,
          constraintTime: computedConstraintTime,
          minDepartureTime: computedMinDepTime,
        });
        prefetchedReturnBoard = boardData;
        resolvedReturnLiveContext = isTransitLive;
        resolvedReturnConstraintTime = computedConstraintTime;
        resolvedReturnMinDepTime = computedMinDepTime;
        resolvedReturnDirectLines = boardData.directLines || [];
        const opt = boardData.optimalDeparture || boardData.departures[0];
        if (opt) {
          const depStr = isTransitLive
            ? opt.estimatedTime || opt.scheduledTime
            : opt.scheduledTime;
          const sM = parseTimeToMinutes(depStr);
          const eM = parseTimeToMinutes(opt.arrivalTime);
          if (sM > 0 && eM > 0) {
            resolvedReturnOpt = {
              startMins: sM,
              endMins: eM,
              durationMinutes: opt.durationMinutes,
            };
          }
        }
      } catch {
        // Fallback silenzioso alla stima statica
      }
    }

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

      let transitBadgeText: string | undefined = undefined;
      let transitBadgeColor = '#64748b';
      let transitBadgeBg = 'rgba(100, 116, 139, 0.15)';
      let transitNotes = activeTransitSolution.routeDescription || 'Ultimo mezzo utile prima del passaggio del treno';
      let lostLectureMins: number | undefined = undefined;

      if (isEarlyForLecture) {
        const effectiveLeaveFromLecture = Math.max(lectureStartMins, lockedTransitStartMins);
        const lostMins = Math.max(1, lectureEndMins - effectiveLeaveFromLecture);
        const formattedLost = formatMinutesToHours(lostMins);
        const lostBadge = `Perdi ${formattedLost} di lezione`;

        lectureTimeStatus = {
          type: 'early_departure',
          minutes: lostMins,
          badgeText: lostBadge,
        };
        lostLectureMins = lostMins;
        transitBadgeText = lostBadge;
        transitBadgeColor = '#f59e0b';
        transitBadgeBg = 'rgba(245, 158, 11, 0.15)';
        transitNotes = `Partenza anticipata durante la lezione • ${lostBadge} • Ultimo mezzo utile`;
      }

      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : resolvedReturnDirectLines.length > 0
          ? `Linee ${resolvedReturnDirectLines.join(' / ')}`
          : activeTransitSolution.lineName,
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
          badgeText: transitBadgeText,
          badgeColor: transitBadgeColor,
          badgeBg: transitBadgeBg,
          lostLectureMinutes: lostLectureMins,
        },
      });
      // Nessuna attesa fittizia o negativa: il pullman è ancorato all'orario esatto di passaggio del treno.
    } else if (isLectureFinished) {
      // SCENARIO 1: Lezione già terminata (treno non ancora passato)
      // Calcola l'ultimo mezzo utile prima del treno per arrivare alla stazione in tempo
      const stationBuffer = 5; // buffer per raggiungere il binario
      const targetArrivalAtStationMins = Math.max(0, trainDepMins - stationBuffer);
      const idealLatestDepartureMins = Math.max(0, targetArrivalAtStationMins - activeTransitMins);

      // Se l'orario attuale supera l'orario ideale di partenza, prendi il mezzo adesso live
      const startTransitMins = resolvedReturnOpt
        ? resolvedReturnOpt.startMins
        : (isToday && nowMins > idealLatestDepartureMins)
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
        : resolvedReturnDirectLines.length > 0
          ? `Linee ${resolvedReturnDirectLines.join(' / ')}`
          : activeTransitSolution.lineName,
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
        },
      });

      const waitAtStation = trainDepMins - endTransitMins;
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
    } else if (isEarlyDeparture) {
      // SCENARIO 2: Treno che richiede di partire prima del termine della lezione (live o non-live)
      let leaveLectureAtMins: number;
      let startTransitMins: number;
      let lostMins: number;

      if (resolvedReturnOpt) {
        startTransitMins = resolvedReturnOpt.startMins;
        leaveLectureAtMins = Math.max(lectureStartMins, startTransitMins - exitClassroomBuffer);
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

      legs.push({
        id: 'leave-lecture-leg',
        type: 'destination',
        title: "Esci dall'aula",
        subtitle: `${targetLecture.room} • ${targetLecture.subject}`,
        startTime: minutesToTime(leaveLectureAtMins),
        endTime: minutesToTime(startTransitMins),
        durationMinutes: Math.max(1, startTransitMins - leaveLectureAtMins),
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
        : resolvedReturnDirectLines.length > 0
          ? `Linee ${resolvedReturnDirectLines.join(' / ')}`
          : activeTransitSolution.lineName,
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
          notes: `Partenza anticipata durante la lezione • ${lostBadge}`,
          badgeText: lostBadge,
          badgeColor: '#f59e0b',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
          lostLectureMinutes: lostMins,
        },
      });

      const waitAtStation = trainDepMins - endTransitMins;
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

      // Mostra sempre l'uscita dall'aula al termine della lezione
      initialStartMins = lectureEndMins;
      legs.push({
        id: 'leave-lecture-leg',
        type: 'destination',
        title: "Esci dall'aula",
        subtitle: `${targetLecture.room} • Fine lezione ${targetLecture.endTime}`,
        startTime: targetLecture.endTime,
        endTime: minutesToTime(earliestCampusLeaveMins),
        durationMinutes: exitClassroomBuffer,
      });

      // Leg 2: Mezzi Urbani verso Stazione (ancorato all'ultimo mezzo utile)
      legs.push({
        id: 'return-transit-leg',
        type: isWalkLeg ? 'walk' : 'transit',
        title: isWalkLeg
        ? 'A piedi'
        : resolvedReturnDirectLines.length > 0
          ? `Linee ${resolvedReturnDirectLines.join(' / ')}`
          : activeTransitSolution.lineName,
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
        },
      });

      const waitAtStation = trainDepMins - transitEndMins;
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
      const waitAtStation = trainDepMins - stationArrivalMins;
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
  const trainDuration = Math.max(10, trainArrMins - trainDepMins);
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

  const totalTripDuration = homeArrivalMins - initialStartMins;

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

  const smartReturnRecommendation: SmartReturnRecommendation | undefined = bestSmartMatch
    ? {
        trainNumber: bestSmartMatch.train.trainNumber,
        category: bestSmartMatch.train.category,
        departureTime:
          bestSmartMatch.train.departureTimePlanned ||
          bestSmartMatch.train.departureTimeActual ||
          '',
        arrivalTime: isToday
          ? bestSmartMatch.train.arrivalTimeActual ||
            bestSmartMatch.train.arrivalTimePlanned ||
            ''
          : bestSmartMatch.train.arrivalTimePlanned ||
            bestSmartMatch.train.arrivalTimeActual ||
            '',
        lostLectureMinutes: bestSmartMatch.lostLectureMinutes,
        savedArrivalMinutes: bestSmartMatch.savedArrivalMinutes,
        durationMinutes: bestSmartMatch.train.durationMinutes,
        standardTrainNumber: bestSmartMatch.standardTrain.trainNumber,
        standardDepartureTime:
          bestSmartMatch.standardTrain.departureTimePlanned ||
          bestSmartMatch.standardTrain.departureTimeActual ||
          '',
        standardArrivalTime: isToday
          ? bestSmartMatch.standardTrain.arrivalTimeActual ||
            bestSmartMatch.standardTrain.arrivalTimePlanned ||
            ''
          : bestSmartMatch.standardTrain.arrivalTimePlanned ||
            bestSmartMatch.standardTrain.arrivalTimeActual ||
            '',
        smartHomeArrivalTime: minutesToTime(bestSmartMatch.candArrMins + carWalkBuffer + carDuration),
        standardHomeArrivalTime: minutesToTime(
          bestSmartMatch.standardArrMins + carWalkBuffer + carDuration
        ),
        isCurrentlySelected:
          train.trainNumber.replace(/\D/g, '') ===
          bestSmartMatch.train.trainNumber.replace(/\D/g, ''),
      }
    : undefined;

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
    transitLiveContext: resolvedReturnLiveContext,
    transitConstraintTime: resolvedReturnConstraintTime,
    transitMinDepartureTime: resolvedReturnMinDepTime,
  };
}
