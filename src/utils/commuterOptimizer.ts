import { CommuterConfig, CommuterItinerary, TripLeg } from '../types/commuter';
import { ScheduleData, ClassEvent } from './scraper';
import { resolveClassroom, formatSapienzaAddress, SAPIENZA_BUILDINGS } from './classroomLocations';
import { getOptimalRomeTransit } from './transitRouter';
import { calculateDrivingEstimate } from './drivingRouter';
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
      selectedTrainNumber
    );
  } else {
    return computeReturnItinerary(
      config,
      targetLecture,
      targetDate,
      selectedTrainOffset,
      selectedTrainNumber
    );
  }
}

function findDayLecture(
  scheduleData?: ScheduleData | null,
  targetDate: Date = new Date(),
  direction: 'outbound' | 'return' = 'outbound',
  manualHour?: string,
  explicitClass?: ClassEvent | null
): DayLectureTarget {
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

  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 5 = ven
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
        // (es. studente rimasto a casa per le lezioni 9-12), seleziona la prossima lezione!
        const upcoming = dayClasses.find(
          (c) => parseTimeToMinutes(c.startTime || '08:30') >= nowMins - 15
        );
        chosenClass = upcoming || dayClasses[dayClasses.length - 1];
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
  targetLecture: DayLectureTarget,
  targetDate: Date,
  selectedTrainOffset = 0,
  selectedTrainNumber?: string
): Promise<CommuterItinerary> {
  const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
  const bufferMins = config.bufferMinutes || 10;

  // Calcolo percorso mezzi urbani ottimizzato (privilegiando ZERO cambi)
  const transitSolution = getOptimalRomeTransit({
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
  });

  const transitMins = transitSolution.durationMinutes || config.transitLeg.durationMinutes || 20;

  // Orario target di arrivo alla stazione di Roma (es. Tiburtina)
  // Arrivo in aula = inizio - buffer
  const classroomArrivalMins = lectureStartMins - bufferMins;
  const stationTargetArrivalMins = classroomArrivalMins - transitMins;
  const stationTargetArrivalStr = minutesToTime(stationTargetArrivalMins);

  // Trova il treno regionale ottimale (privilegiando RV) e le alternative disponibili
  const { train, availableTrains, selectedIndex } = await findOptimalCommuterTrain({
    direction: 'outbound',
    departureStation: config.departureStation,
    arrivalStation: config.arrivalStation,
    targetTimeStr: stationTargetArrivalStr,
    targetDate,
    trainOffset: selectedTrainOffset,
    selectedTrainNumber,
  });

  // NOTA COMMUTER: La partenza del treno a cui ancorare il viaggio per non perdere la coincidenza
  // deve essere SEMPRE l'orario programmato ufficiale (il ritardo non posticipa la partenza programmata da casa).
  // L'arrivo effettivo a destinazione incorpora invece il ritardo reale (arrivalTimeActual).
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  // Tragitto auto con calcolo automatico percorso e profilo traffico Google Maps
  const carEnabled = config.carLeg.enabled;
  let carDuration = 0;
  let carDistanceKm = config.carLeg.distanceKm || 17.2;
  let carTrafficNote: string | undefined = undefined;

  if (carEnabled) {
    const drivingEst = await calculateDrivingEstimate(
      config.originAddress,
      config.departureStation.shortName || config.departureStation.name,
      stationTargetArrivalStr
    );
    carDuration = drivingEst.durationMinutes || config.carLeg.durationMinutes || 24;
    carDistanceKm = drivingEst.distanceKm || carDistanceKm;
    carTrafficNote = drivingEst.trafficCondition;
  }

  const parkDuration = carEnabled ? config.carLeg.parkingBufferMinutes || 7 : 0;

  // Orario in cui essere in stazione per il treno
  const stationReachMins = trainDepMins - parkDuration;
  // Orario di partenza da casa
  const homeDepartureMins = stationReachMins - carDuration;

  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // Calcola orari intermedi
  const legs: TripLeg[] = [];

  // Leg 1: Auto (se abilitata)
  if (carEnabled) {
    legs.push({
      id: 'car-leg',
      type: 'car',
      title: `Partenza in Auto da ${config.originAddress}`,
      subtitle: `Tragitto verso Stazione di ${config.departureStation.shortName || config.departureStation.name} (~${carDuration} min • ${carDistanceKm} km${carTrafficNote ? ` • ${carTrafficNote}` : ''})`,
      startTime: minutesToTime(homeDepartureMins),
      endTime: minutesToTime(homeDepartureMins + carDuration),
      durationMinutes: carDuration,
      details: {
        mapQuery: config.carLeg.stationAddress || `Stazione di ${config.departureStation.shortName || config.departureStation.name}`,
        mapOriginQuery: config.originAddress,
        travelMode: 'driving',
        targetDate: targetDateStr,
        targetTime: minutesToTime(homeDepartureMins),
        timeType: 'depart_at',
        notes: 'Tocca per aprire la navigazione con orario impostato',
      },
    });

    // Leg Parcheggio
    legs.push({
      id: 'park-leg',
      type: 'wait',
      title: 'Parcheggio & Accesso Binario',
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
      title: `Arrivo in Stazione a ${config.departureStation.shortName || config.departureStation.name}`,
      subtitle: `Accesso ai binari`,
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

  // Leg 3: Mezzi Pubblici Urbani (ottimizzato dinamicamente)
  const actualClassroomArrivalMins = trainArrMins + transitMins;
  legs.push({
    id: 'transit-leg',
    type: 'transit',
    title: transitSolution.lineName,
    subtitle: `${config.arrivalStation.shortName || config.arrivalStation.name} ➔ ${targetLecture.room} (${transitSolution.inVehicleMinutes > 0 ? `${transitSolution.inVehicleMinutes}m a bordo + ` : ''}${transitSolution.walkingMinutes}m a piedi)`,
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

  const totalTripDuration = actualClassroomArrivalMins - homeDepartureMins;

  // Status badge
  let badgeText = 'Tutto regolare';
  let badgeColor = '#34c759'; // green
  let isWarning = false;

  if (train.delayMinutes > 5) {
    badgeText = `Ritardo treno +${train.delayMinutes}m`;
    badgeColor = '#f59e0b'; // orange
    isWarning = true;
  } else if (train.statusDescription.toLowerCase().includes('soppresso')) {
    badgeText = 'Treno Soppresso';
    badgeColor = '#ef4444'; // red
    isWarning = true;
  } else if (train.isLive) {
    badgeText = 'Dati Trenitalia';
    badgeColor = '#38bdf8'; // blue
  }

  const summary = `Parti alle ${minutesToTime(homeDepartureMins)} da ${config.originAddress} con ${train.trainNumber} (${train.departureTimePlanned || train.departureTimeActual}) per essere in ${targetLecture.room} alle ${minutesToTime(actualClassroomArrivalMins)} (inizio lezione ${targetLecture.startTime})`;

  return {
    direction: 'outbound',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture,
    departureTime: minutesToTime(homeDepartureMins),
    arrivalTime: minutesToTime(actualClassroomArrivalMins),
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
  targetLecture: DayLectureTarget,
  targetDate: Date,
  selectedTrainOffset = 0,
  selectedTrainNumber?: string
): Promise<CommuterItinerary> {
  const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
  const exitClassroomBuffer = 7; // minuti per uscire e raggiungere fermata

  // Percorso ritorno mezzi urbani (verso stazione FS, privilegiando ZERO cambi)
  const transitSolution = getOptimalRomeTransit({
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
  });

  const transitMins = transitSolution.durationMinutes || config.transitLeg.durationMinutes || 20;

  // Orario di arrivo in stazione a Roma
  const stationArrivalMins = lectureEndMins + exitClassroomBuffer + transitMins;
  const stationArrivalStr = minutesToTime(stationArrivalMins);

  // Trova il treno regionale di ritorno ottimale e alternative
  const { train, availableTrains, selectedIndex } = await findOptimalCommuterTrain({
    direction: 'return',
    departureStation: config.arrivalStation, // da Roma Tiburtina
    arrivalStation: config.departureStation, // verso Orte
    targetTimeStr: stationArrivalStr,
    targetDate,
    trainOffset: selectedTrainOffset,
    selectedTrainNumber,
  });

  // NOTA COMMUTER: La partenza del treno a cui ancorare il rientro da Roma
  // deve essere l'orario programmato ufficiale. L'arrivo effettivo incorpora invece il ritardo reale.
  const trainDepMins = parseTimeToMinutes(train.departureTimePlanned || train.departureTimeActual || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  const carEnabled = config.carLeg.enabled;
  let carDuration = 0;
  let carDistanceKm = config.carLeg.distanceKm || 17.2;
  let carTrafficNote: string | undefined = undefined;

  const carWalkBuffer = carEnabled ? 5 : 0; // recupero auto dal parcheggio
  const returnDrivingTimeStr = minutesToTime(trainArrMins + carWalkBuffer);

  if (carEnabled) {
    const drivingEst = await calculateDrivingEstimate(
      config.originAddress,
      config.departureStation.shortName || config.departureStation.name,
      returnDrivingTimeStr
    );
    carDuration = drivingEst.durationMinutes || config.carLeg.durationMinutes || 24;
    carDistanceKm = drivingEst.distanceKm || carDistanceKm;
    carTrafficNote = drivingEst.trafficCondition;
  }

  const homeArrivalMins = trainArrMins + carWalkBuffer + carDuration;

  const legs: TripLeg[] = [];

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

  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // Leg 2: Mezzi Urbani verso Stazione
  legs.push({
    id: 'return-transit-leg',
    type: 'transit',
    title: transitSolution.lineName,
    subtitle: `${targetLecture.room} ➔ Stazione ${config.arrivalStation.shortName || config.arrivalStation.name} (${transitSolution.inVehicleMinutes > 0 ? `${transitSolution.inVehicleMinutes}m a bordo + ` : ''}${transitSolution.walkingMinutes}m a piedi)`,
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
    legs.push({
      id: 'return-car-leg',
      type: 'car',
      title: `Rientro in Auto verso ${config.originAddress}`,
      subtitle: `Dalla Stazione di ${config.departureStation.shortName || config.departureStation.name} a casa (~${carDuration} min • ${carDistanceKm} km${carTrafficNote ? ` • ${carTrafficNote}` : ''})`,
      startTime: minutesToTime(trainArrMins + carWalkBuffer),
      endTime: minutesToTime(homeArrivalMins),
      durationMinutes: carDuration,
      details: {
        travelMode: 'driving',
        mapOriginQuery: config.carLeg.stationAddress || `Stazione di ${config.departureStation.shortName || config.departureStation.name}`,
        mapQuery: config.originAddress,
        targetDate: targetDateStr,
        targetTime: minutesToTime(trainArrMins + carWalkBuffer),
        timeType: 'depart_at',
        notes: 'Tocca per aprire la navigazione con orario impostato',
      },
    });
  }

  const totalTripDuration = homeArrivalMins - lectureEndMins;

  return {
    direction: 'return',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture,
    departureTime: targetLecture.endTime,
    arrivalTime: minutesToTime(homeArrivalMins),
    totalDurationMinutes: totalTripDuration,
    legs,
    liveTrain: train,
    availableTrains,
    selectedTrainIndex: selectedIndex,
    statusBadge: {
      text:
        train.delayMinutes > 5
          ? `Ritardo treno +${train.delayMinutes}m`
          : train.isLive
          ? 'Dati Trenitalia'
          : 'Rientro in orario',
      color:
        train.delayMinutes > 5
          ? '#f59e0b'
          : train.isLive
          ? '#38bdf8'
          : '#34c759',
      isWarning: train.delayMinutes > 5,
    },
    summaryMessage: `Fine lezione ore ${targetLecture.endTime} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`,
  };
}
