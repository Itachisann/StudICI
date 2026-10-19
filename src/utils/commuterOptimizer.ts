import { CommuterConfig, CommuterItinerary, TripLeg } from '../types/commuter';
import { ScheduleData, ClassEvent } from './scraper';
import { resolveClassroom, formatSapienzaAddress, SAPIENZA_BUILDINGS } from './classroomLocations';
import { getOptimalRomeTransit } from './transitRouter';
import { calculateDrivingEstimate, getStationNavigationQuery } from './drivingRouter';
import {
  findOptimalCommuterTrain,
  parseTimeToMinutes,
  minutesToTime,
} from './trenitaliaApi';

export interface OptimizeOptions {
  config: CommuterConfig;
  scheduleData?: ScheduleData | null;
  direction: 'outbound' | 'return';
  targetDate?: Date;
  manualHour?: string; // override manuale orario es. "08:30"
  selectedClass?: ClassEvent | null; // lezione esplicitamente selezionata dall'utente
  selectedTrainOffset?: number; // -1 = treno prima, 0 = consigliato, +1 = treno dopo
  selectedTrainNumber?: string; // override selezione treno specifico
  forceRefresh?: boolean;
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

/**
 * Calcola l'itinerario ottimizzato per lo studente pendolare
 */
export async function computeCommuterItinerary(
  options: OptimizeOptions
): Promise<CommuterItinerary> {
  const {
    config,
    scheduleData,
    direction,
    targetDate = new Date(),
    manualHour,
    selectedClass,
    selectedTrainOffset = 0,
    selectedTrainNumber,
    forceRefresh = false,
  } = options;
  const isOutbound = direction === 'outbound';

  // 1. Individua la lezione target del giorno
  const targetLecture = findDayLecture(
    scheduleData,
    targetDate,
    direction,
    manualHour,
    selectedClass
  );

  // 2. Calcola i tempi in base alla direzione
  if (isOutbound) {
    return computeOutboundItinerary(
      config,
      targetLecture,
      targetDate,
      selectedTrainOffset,
      selectedTrainNumber,
      forceRefresh
    );
  } else {
    return computeReturnItinerary(
      config,
      targetLecture,
      targetDate,
      selectedTrainOffset,
      selectedTrainNumber,
      forceRefresh
    );
  }
}

function findDayLecture(
  scheduleData?: ScheduleData | null,
  targetDate: Date = new Date(),
  direction: 'outbound' | 'return' = 'outbound',
  manualHour?: string,
  explicitClass?: ClassEvent | null
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
    const context = `${explicitClass.building || ''} ${explicitClass.address || ''}`.trim();
    const resolved = resolveClassroom(explicitClass.room || 'Aula', context);
    const bCode = (
      explicitClass.building?.match(/RM\d{3}/i)?.[1] ||
      explicitClass.address?.match(/RM\d{3}/i)?.[1] ||
      resolved.buildingCode ||
      ''
    ).toUpperCase();

    const startTime = explicitClass.startTime || '08:30';
    const endTime = explicitClass.endTime || minutesToTime(parseTimeToMinutes(startTime) + 120);

    return {
      subject: explicitClass.subject || 'Lezione',
      room: explicitClass.room || resolved.displayName,
      buildingName: explicitClass.building || resolved.buildingName,
      buildingCode: bCode,
      address: formatSapienzaAddress(explicitClass.address || resolved.address, bCode),
      startTime,
      endTime,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
  }

  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 6 = sab
  const isWeekend = dayIndex === 0 || dayIndex === 6;

  // Nel fine settimana (sabato e domenica) non ci sono lezioni universitarie
  if (isWeekend) {
    return null;
  }

  const dayScheduleIndex = dayIndex >= 1 && dayIndex <= 5 ? dayIndex - 1 : 0; // default lunedì

  const dayClasses: ClassEvent[] =
    scheduleData?.days && scheduleData.days[dayScheduleIndex]
      ? [...scheduleData.days[dayScheduleIndex]]
      : [];

  // Ordina per orario di inizio
  dayClasses.sort(
    (a, b) =>
      parseTimeToMinutes(a.startTime || '08:30') -
      parseTimeToMinutes(b.startTime || '08:30')
  );

  if (dayClasses.length > 0) {
    let chosenClass: ClassEvent;
    const now = new Date();
    const isToday =
      targetDate.getDate() === now.getDate() &&
      targetDate.getMonth() === now.getMonth();

    if (isToday) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      if (direction === 'outbound') {
        // Selezione intelligente: se la lezione della mattina è già passata
        // seleziona la prossima lezione. Se sono tutte passate, targetta da adesso!
        const upcoming = dayClasses.find(
          (c) => parseTimeToMinutes(c.startTime || '08:30') >= nowMins - 15
        );
        if (upcoming) {
          chosenClass = upcoming;
        } else {
          const refClass = dayClasses[0];
          chosenClass = {
            ...refClass,
            startTime: minutesToTime(nowMins + 60),
            endTime: minutesToTime(nowMins + 180),
            duration: 120,
          };
        }
      } else {
        // Ritorno: seleziona la lezione che termina intorno a quest'ora o l'ultima
        const pastOrActive = [...dayClasses].reverse().find(
          (c) => parseTimeToMinutes(c.endTime || '18:00') <= nowMins + 30
        );
        chosenClass = pastOrActive || dayClasses[dayClasses.length - 1];
      }
    } else {
      chosenClass = direction === 'outbound' ? dayClasses[0] : dayClasses[dayClasses.length - 1];
    }

    const context = `${chosenClass.building || ''} ${chosenClass.address || ''}`.trim();
    const resolved = resolveClassroom(chosenClass.room || 'Aula', context);
    const bCode = (
      chosenClass.building?.match(/RM\d{3}/i)?.[1] ||
      chosenClass.address?.match(/RM\d{3}/i)?.[1] ||
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
  forceRefresh = false
): Promise<CommuterItinerary> {
  const bufferMins = config.bufferMinutes || 10;

  // Calcolo percorso mezzi urbani ottimizzato (se presente una lezione universitaria target)
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
      })
    : null;

  const transitMins = transitSolution?.durationMinutes || (targetLecture ? (config.transitLeg.durationMinutes || 20) : 0);

  const now = new Date();
  const isToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let stationTargetArrivalMins: number;
  if (targetLecture) {
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const classroomArrivalMins = lectureStartMins - bufferMins;
    stationTargetArrivalMins = classroomArrivalMins - transitMins;
    if (isToday && nowMins > lectureStartMins) {
      stationTargetArrivalMins = nowMins + 50;
    }
  } else {
    // Weekend o viaggio stazione-stazione senza lezioni: calcola rispetto all'orario targetDate
    const targetHourMins = targetDate.getHours() * 60 + targetDate.getMinutes();
    stationTargetArrivalMins = isToday ? nowMins + 50 : (targetHourMins > 0 ? targetHourMins + 50 : 9 * 60);
  }
  const stationTargetArrivalStr = minutesToTime(stationTargetArrivalMins);

  const carEnabled = config.carLeg.enabled;
  // Stima preliminare orario partenza in auto (circa 50 min prima dell'arrivo a Roma)
  const approxCarDepartureTimeStr = minutesToTime(Math.max(0, stationTargetArrivalMins - 50));

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
    }),
    carEnabled
      ? calculateDrivingEstimate(
          config.originAddress,
          config.departureStation.shortName || config.departureStation.name,
          approxCarDepartureTimeStr,
          config.originCoords,
          targetDate
        )
      : Promise.resolve(null),
  ]);

  const { train, availableTrains, selectedIndex } = optimalTrainResult;

  // NOTA COMMUTER: La partenza del treno a cui ancorare il viaggio per non perdere la coincidenza
  // deve essere SEMPRE l'orario programmato ufficiale (il ritardo non posticipa la partenza programmata da casa).
  // L'arrivo effettivo a destinazione incorpora invece il ritardo reale (arrivalTimeActual).
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  // Tragitto auto con calcolo automatico percorso e profilo traffico Google Maps
  let carDuration = 0;
  let carDistanceKm = config.carLeg.distanceKm || 17.2;
  let carTrafficNote: string | undefined = undefined;
  let carTrafficFluency: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' | undefined = undefined;
  let carTrafficPeak = false;
  let carTrafficBaseline = 0;
  let carTrafficDelay = 0;

  if (drivingEst) {
    carDistanceKm = drivingEst.distanceKm || carDistanceKm;
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

  const parkDuration = carEnabled ? config.carLeg.parkingBufferMinutes || 7 : 0;

  // Orario in cui essere in stazione per il treno
  const stationReachMins = trainDepMins - parkDuration;
  // Orario di partenza da casa (anticipato dell'intera durata auto comprensiva di ritardo traffico)
  const homeDepartureMins = stationReachMins - carDuration;

  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // Calcola orari intermedi
  const legs: TripLeg[] = [];

  // Leg 1: Auto (se abilitata)
  if (carEnabled) {
    const trafficSubText = carTrafficDelay > 0 ? ` • +${carTrafficDelay}m traffico` : '';
    legs.push({
      id: 'car-leg',
      type: 'car',
      title: `Partenza da ${config.originAddress}`,
      subtitle: `Tragitto verso ${config.departureStation.shortName || config.departureStation.name} (~${carDuration} min • ${carDistanceKm} km${trafficSubText})`,
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

  legs.push({
    id: 'train-leg',
    type: 'train',
    title: `Treno ${train.trainNumber} (${train.isFast ? 'Regionale Veloce' : 'Regionale'})`,
    subtitle: `${config.departureStation.shortName || config.departureStation.name} ➔ ${config.arrivalStation.shortName || config.arrivalStation.name}`,
    startTime: train.departureTimePlanned || minutesToTime(trainDepMins),
    endTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: train.platformActual || train.platformPlanned,
      delayMinutes: train.delayMinutes,
      isLiveTrain: train.isLive,
      notes: `${train.category} verso ${train.destination} • ${platformText} • ${train.statusDescription}`,
    },
  });

  if (targetLecture && transitSolution) {
    // Leg 3: Mezzi Pubblici Urbani (ottimizzato dinamicamente)
    const actualClassroomArrivalMins = trainArrMins + transitMins;
    legs.push({
      id: 'transit-leg',
      type: 'transit',
      title: transitSolution.lineName,
      subtitle: `${config.arrivalStation.shortName || config.arrivalStation.name} ➔ ${targetLecture.room}${targetLecture.buildingName ? ` (${targetLecture.buildingName})` : ''}`,
      startTime: minutesToTime(trainArrMins),
      endTime: minutesToTime(actualClassroomArrivalMins),
      durationMinutes: transitMins,
      details: {
        transitLine: transitSolution.lineName,
        transitMode: transitSolution.mode,
        mapOriginQuery: `Stazione Roma ${config.arrivalStation.shortName || config.arrivalStation.name}`,
        mapQuery: targetLecture.address,
        mapCoords: targetLecture.latitude && targetLecture.longitude ? { lat: targetLecture.latitude, lng: targetLecture.longitude } : undefined,
        travelMode: transitSolution.mode === 'walk' ? 'walking' : 'transit',
        targetDate: targetDateStr,
        targetTime: targetLecture.startTime,
        timeType: 'arrive_by',
        notes: transitSolution.routeDescription,
      },
    });

    // Leg 4: Aula e Lezione
    const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
    const spareTime = lectureStartMins - actualClassroomArrivalMins;
    legs.push({
      id: 'lecture-leg',
      type: 'destination',
      title: `Inizio Lezione: ${targetLecture.subject}`,
      subtitle: `${targetLecture.room} • ${targetLecture.buildingName || ''}`,
      startTime: targetLecture.startTime,
      endTime: targetLecture.endTime,
      durationMinutes: Math.max(60, parseTimeToMinutes(targetLecture.endTime) - lectureStartMins),
      details: {
        notes: spareTime > 0 ? `Anticipo in aula: +${spareTime} min` : 'Arrivo puntuale a inizio lezione',
      },
    });
  } else {
    // Weekend / Nessuna lezione: Destinazione finale stazione di arrivo
    legs.push({
      id: 'destination-station-leg',
      type: 'destination',
      title: `Arrivo a Stazione ${config.arrivalStation.shortName || config.arrivalStation.name}`,
      subtitle: 'Destinazione del tragitto ferroviario raggiunta',
      startTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
      endTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
      durationMinutes: 0,
      details: {
        notes: `Arrivo al binario ${train.platformActual || train.platformPlanned || 'FS'}`,
      },
    });
  }

  const finalArrivalMins = targetLecture ? (trainArrMins + transitMins) : trainArrMins;
  const totalTripDuration = finalArrivalMins - homeDepartureMins;

  // Status badge dell'itinerario globale
  let badgeText = 'Tutto regolare';
  let badgeColor = '#34c759'; // green
  let isWarning = false;

  const outboundStatusDesc = (train?.statusDescription || '').toLowerCase();
  if (outboundStatusDesc.includes('soppresso')) {
    badgeText = 'Treno Soppresso';
    badgeColor = '#ef4444'; // red
    isWarning = true;
  } else if (train?.isLive) {
    badgeText = 'Fonte: Trenitalia';
    badgeColor = '#e05666';
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
  forceRefresh = false
): Promise<CommuterItinerary> {
  const exitClassroomBuffer = 7; // minuti per uscire e raggiungere fermata

  // Percorso ritorno mezzi urbani (verso stazione FS, se presente una lezione)
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
      })
    : null;

  const transitMins = transitSolution?.durationMinutes || (targetLecture ? (config.transitLeg.durationMinutes || 20) : 0);

  const now = new Date();
  const isToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Orario di arrivo in stazione a Roma
  let stationArrivalMins: number;
  if (targetLecture) {
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
    stationArrivalMins = lectureEndMins + exitClassroomBuffer + transitMins;
    if (isToday && nowMins > stationArrivalMins) {
      stationArrivalMins = nowMins;
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
    }),
    carEnabled
      ? calculateDrivingEstimate(
          config.originAddress,
          config.departureStation.shortName || config.departureStation.name,
          approxReturnDrivingTimeStr,
          config.originCoords,
          targetDate
        )
      : Promise.resolve(null),
  ]);

  const { train, availableTrains, selectedIndex } = optimalTrainResult;

  // NOTA COMMUTER: La partenza del treno a cui ancorare il rientro da Roma
  // deve essere l'orario programmato ufficiale. L'arrivo effettivo incorpora invece il ritardo reale.
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  let carDuration = 0;
  let carDistanceKm = config.carLeg.distanceKm || 17.2;
  let carTrafficNote: string | undefined = undefined;
  let carTrafficFluency: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' | undefined = undefined;
  let carTrafficPeak = false;
  let carTrafficBaseline = 0;
  let carTrafficDelay = 0;

  if (drivingEst) {
    carDistanceKm = drivingEst.distanceKm || carDistanceKm;
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

  if (targetLecture && transitSolution) {
    const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
    // Leg 1: Uscita da Aula
    legs.push({
      id: 'leave-lecture-leg',
      type: 'destination',
      title: `Fine Lezione: ${targetLecture.subject}`,
      subtitle: `Uscita da ${targetLecture.room} (${targetLecture.address})`,
      startTime: targetLecture.endTime,
      endTime: minutesToTime(lectureEndMins + exitClassroomBuffer),
      durationMinutes: exitClassroomBuffer,
    });

    // Leg 2: Mezzi Urbani verso Stazione
    legs.push({
      id: 'return-transit-leg',
      type: 'transit',
      title: transitSolution.lineName,
      subtitle: `${targetLecture.room} ➔ Stazione ${config.arrivalStation.shortName || config.arrivalStation.name}`,
      startTime: minutesToTime(lectureEndMins + exitClassroomBuffer),
      endTime: minutesToTime(stationArrivalMins),
      durationMinutes: transitMins,
      details: {
        transitLine: transitSolution.lineName,
        transitMode: transitSolution.mode,
        travelMode: transitSolution.mode === 'walk' ? 'walking' : 'transit',
        mapOriginQuery: targetLecture.address,
        mapQuery: `Stazione Roma ${config.arrivalStation.shortName || config.arrivalStation.name}`,
        targetDate: targetDateStr,
        targetTime: targetLecture.endTime,
        timeType: 'depart_at',
        notes: transitSolution.routeDescription,
      },
    });
  }

  // Leg Attesa Treno se c'è margine
  const waitAtStation = trainDepMins - stationArrivalMins;
  if (waitAtStation > 3) {
    legs.push({
      id: 'station-wait-leg',
      type: 'wait',
      title: `Attesa in Stazione a ${config.arrivalStation.shortName || config.arrivalStation.name}`,
      subtitle: `Binario di partenza: ${train.platformActual || train.platformPlanned || 'In definizione'}`,
      startTime: minutesToTime(stationArrivalMins),
      endTime: minutesToTime(trainDepMins),
      durationMinutes: waitAtStation,
      details: {
        platform: train.platformActual || train.platformPlanned,
      },
    });
  }

  // Leg 3: Treno di Ritorno
  const trainDuration = Math.max(10, trainArrMins - trainDepMins);
  legs.push({
    id: 'return-train-leg',
    type: 'train',
    title: `Treno ${train.trainNumber} (${train.isFast ? 'Regionale Veloce' : 'Regionale'})`,
    subtitle: `${config.arrivalStation.shortName || config.arrivalStation.name} ➔ ${config.departureStation.shortName || config.departureStation.name}`,
    startTime: train.departureTimePlanned || minutesToTime(trainDepMins),
    endTime: train.arrivalTimeActual || minutesToTime(trainArrMins),
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: train.platformActual || train.platformPlanned,
      delayMinutes: train.delayMinutes,
      isLiveTrain: train.isLive,
      notes: `${train.category} verso ${train.destination} • Binario ${train.platformActual || train.platformPlanned || 'in definizione'} • ${train.statusDescription}`,
    },
  });

  // Leg 4: Auto verso Casa
  if (carEnabled) {
    const returnTrafficSubText = carTrafficDelay > 0 ? ` • +${carTrafficDelay}m traffico` : '';
    legs.push({
      id: 'return-car-leg',
      type: 'car',
      title: `Rientro in Auto verso ${config.originAddress}`,
      subtitle: `Dalla Stazione di ${config.departureStation.shortName || config.departureStation.name} a casa (~${carDuration} min • ${carDistanceKm} km${returnTrafficSubText})`,
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

  const initialStartMins = targetLecture ? parseTimeToMinutes(targetLecture.endTime) : stationArrivalMins;
  const totalTripDuration = homeArrivalMins - initialStartMins;

  return {
    direction: 'return',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture: targetLecture || undefined,
    departureTime: targetLecture ? targetLecture.endTime : (train.departureTimePlanned || minutesToTime(trainDepMins)),
    arrivalTime: minutesToTime(homeArrivalMins),
    totalDurationMinutes: totalTripDuration,
    legs,
    liveTrain: train,
    availableTrains,
    selectedTrainIndex: selectedIndex,
    statusBadge: {
      text:
        (train?.statusDescription || '').toLowerCase().includes('soppresso')
          ? 'Treno Soppresso'
          : train?.isLive
          ? 'Fonte: Trenitalia'
          : 'Rientro in orario',
      color:
        (train?.statusDescription || '').toLowerCase().includes('soppresso')
          ? '#ef4444'
          : train?.isLive
          ? '#e05666'
          : '#34c759',
      isWarning: (train?.statusDescription || '').toLowerCase().includes('soppresso'),
    },
    summaryMessage: targetLecture
      ? `Fine lezione ore ${targetLecture.endTime} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`
      : `Partenza ore ${train.departureTimePlanned || train.departureTimeActual || minutesToTime(trainDepMins)} da ${config.arrivalStation.name} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`,
  };
}
