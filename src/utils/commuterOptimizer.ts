import { CommuterConfig, CommuterItinerary, TripLeg, LiveTrainInfo } from '../types/commuter';
import { ScheduleData, ClassEvent } from './scraper';
import { resolveClassroom, formatSapienzaAddress, SAPIENZA_BUILDINGS } from './classroomLocations';
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
}

/**
 * Calcola l'itinerario ottimizzato per lo studente pendolare
 */
export async function computeCommuterItinerary(
  options: OptimizeOptions
): Promise<CommuterItinerary> {
  const { config, scheduleData, direction, targetDate = new Date(), manualHour } = options;
  const isOutbound = direction === 'outbound';

  // 1. Individua la lezione target del giorno
  const targetLecture = findDayLecture(scheduleData, targetDate, direction, manualHour);

  // 2. Calcola i tempi in base alla direzione
  if (isOutbound) {
    return computeOutboundItinerary(config, targetLecture, targetDate);
  } else {
    return computeReturnItinerary(config, targetLecture, targetDate);
  }
}

function findDayLecture(
  scheduleData?: ScheduleData | null,
  targetDate: Date = new Date(),
  direction: 'outbound' | 'return' = 'outbound',
  manualHour?: string
) {
  const dayIndex = targetDate.getDay(); // 0 = dom, 1 = lun, ..., 5 = ven
  const dayScheduleIndex = dayIndex >= 1 && dayIndex <= 5 ? dayIndex - 1 : 0; // default lunedì

  const dayClasses: ClassEvent[] =
    scheduleData?.days && scheduleData.days[dayScheduleIndex]
      ? [...scheduleData.days[dayScheduleIndex]]
      : [];

  // Ordina per orario di inizio
  dayClasses.sort((a, b) => parseTimeToMinutes(a.startTime || '08:30') - parseTimeToMinutes(b.startTime || '08:30'));

  if (manualHour) {
    const resolved = resolveClassroom('Aula 1');
    return {
      subject: 'Lezione Programmata',
      room: 'Aula 1',
      buildingName: resolved.buildingName,
      address: formatSapienzaAddress(resolved.address),
      startTime: manualHour,
      endTime: minutesToTime(parseTimeToMinutes(manualHour) + 120),
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
  }

  if (dayClasses.length > 0) {
    const selectedClass = direction === 'outbound' ? dayClasses[0] : dayClasses[dayClasses.length - 1];
    const resolved = resolveClassroom(selectedClass.room || 'Aula');

    const startTime = selectedClass.startTime || '08:30';
    const endTime = selectedClass.endTime || minutesToTime(parseTimeToMinutes(startTime) + 120);

    return {
      subject: selectedClass.subject || 'Lezione',
      room: resolved.displayName,
      buildingName: selectedClass.building || resolved.buildingName,
      address: formatSapienzaAddress(selectedClass.address || resolved.address),
      startTime,
      endTime,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
  }

  // Fallback predefinito se giornata libera o fine settimana
  const defaultBuilding = SAPIENZA_BUILDINGS.RM102; // Ariosto
  const defaultStart = direction === 'outbound' ? '08:30' : '15:30';
  const defaultEnd = direction === 'outbound' ? '10:30' : '17:30';

  return {
    subject: 'Prima Lezione del Giorno',
    room: 'Aula 1 (Sede Ariosto)',
    buildingName: defaultBuilding.name,
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
  targetLecture: ReturnType<typeof findDayLecture>,
  targetDate: Date
): Promise<CommuterItinerary> {
  const lectureStartMins = parseTimeToMinutes(targetLecture.startTime);
  const bufferMins = config.bufferMinutes || 10;
  const transitMins = config.transitLeg.durationMinutes || 22;

  // Orario target di arrivo alla stazione di Roma (es. Tiburtina)
  // Arrivo in aula = inizio - buffer
  const classroomArrivalMins = lectureStartMins - bufferMins;
  const stationTargetArrivalMins = classroomArrivalMins - transitMins;
  const stationTargetArrivalStr = minutesToTime(stationTargetArrivalMins);

  // Trova il treno migliore
  const train: LiveTrainInfo = await findOptimalCommuterTrain({
    direction: 'outbound',
    departureStation: config.departureStation,
    arrivalStation: config.arrivalStation,
    targetTimeStr: stationTargetArrivalStr,
    targetDate,
  });

  const trainDepMins = parseTimeToMinutes(train.departureTimeActual || train.departureTimePlanned || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  // Tragitto auto
  const carEnabled = config.carLeg.enabled;
  const carDuration = carEnabled ? config.carLeg.durationMinutes || 25 : 0;
  const parkDuration = carEnabled ? config.carLeg.parkingBufferMinutes || 7 : 0;

  // Orario in cui essere in stazione per il treno
  const stationReachMins = trainDepMins - parkDuration;
  // Orario di partenza da casa
  const homeDepartureMins = stationReachMins - carDuration;

  // Calcola orari intermedi
  const legs: TripLeg[] = [];

  // Leg 1: Auto (se abilitata)
  if (carEnabled) {
    legs.push({
      id: 'car-leg',
      type: 'car',
      title: `Partenza in Auto da ${config.originAddress}`,
      subtitle: `Tragitto verso ${config.departureStation.shortName || config.departureStation.name} (~${carDuration} min)`,
      startTime: minutesToTime(homeDepartureMins),
      endTime: minutesToTime(homeDepartureMins + carDuration),
      durationMinutes: carDuration,
      details: {
        mapQuery: config.carLeg.stationAddress || `Stazione di ${config.departureStation.shortName || config.departureStation.name}`,
        travelMode: 'driving',
        notes: `Guida da ${config.originAddress} alla stazione ferroviaria`,
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

  // Leg 2: Treno
  const trainDuration = Math.max(10, trainArrMins - trainDepMins);
  const platformText = train.platformActual || train.platformPlanned
    ? `Binario ${train.platformActual || train.platformPlanned}`
    : 'Binario in definizione';

  legs.push({
    id: 'train-leg',
    type: 'train',
    title: `Treno ${train.trainNumber}`,
    subtitle: `${config.departureStation.shortName || config.departureStation.name} ➔ ${config.arrivalStation.shortName || config.arrivalStation.name}`,
    startTime: minutesToTime(trainDepMins),
    endTime: minutesToTime(trainArrMins),
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: train.platformActual || train.platformPlanned,
      delayMinutes: train.delayMinutes,
      isLiveTrain: train.isLive,
      notes: `${train.category} verso ${train.destination} • ${platformText} • ${train.statusDescription}`,
    },
  });

  // Leg 3: Mezzi Pubblici Urbani
  const actualClassroomArrivalMins = trainArrMins + transitMins;
  legs.push({
    id: 'transit-leg',
    type: 'transit',
    title: `Mezzi Pubblici Roma`,
    subtitle: `${config.arrivalStation.shortName || config.arrivalStation.name} ➔ ${targetLecture.room}`,
    startTime: minutesToTime(trainArrMins),
    endTime: minutesToTime(actualClassroomArrivalMins),
    durationMinutes: transitMins,
    details: {
      transitLine: config.transitLeg.lineSuggestion || 'Bus 492 / Metro B',
      mapQuery: targetLecture.address,
      mapCoords: targetLecture.latitude && targetLecture.longitude ? { lat: targetLecture.latitude, lng: targetLecture.longitude } : undefined,
      travelMode: 'transit',
      notes: `${config.transitLeg.lineSuggestion || 'Bus 492 / Metro B'} verso ${targetLecture.address}`,
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
    badgeText = 'Dati Trenitalia Live';
    badgeColor = '#38bdf8'; // blue
  }

  const summary = `Parti alle ${minutesToTime(homeDepartureMins)} da ${config.originAddress} per essere in ${targetLecture.room} alle ${minutesToTime(actualClassroomArrivalMins)} (${targetLecture.startTime})`;

  return {
    direction: 'outbound',
    targetDate: targetDate.toISOString().slice(0, 10),
    targetLecture,
    departureTime: minutesToTime(homeDepartureMins),
    arrivalTime: minutesToTime(actualClassroomArrivalMins),
    totalDurationMinutes: totalTripDuration,
    legs,
    liveTrain: train,
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
  targetLecture: ReturnType<typeof findDayLecture>,
  targetDate: Date
): Promise<CommuterItinerary> {
  const lectureEndMins = parseTimeToMinutes(targetLecture.endTime);
  const exitClassroomBuffer = 7; // minuti per uscire e raggiungere fermata
  const transitMins = config.transitLeg.durationMinutes || 22;

  // Orario di arrivo in stazione a Roma
  const stationArrivalMins = lectureEndMins + exitClassroomBuffer + transitMins;
  const stationArrivalStr = minutesToTime(stationArrivalMins);

  // Trova il primo treno utile in partenza DOPO l'arrivo in stazione
  const train: LiveTrainInfo = await findOptimalCommuterTrain({
    direction: 'return',
    departureStation: config.arrivalStation, // da Roma Tiburtina
    arrivalStation: config.departureStation, // verso Orte
    targetTimeStr: stationArrivalStr,
    targetDate,
  });

  const trainDepMins = parseTimeToMinutes(train.departureTimeActual || train.departureTimePlanned || '');
  const trainArrMins = parseTimeToMinutes(train.arrivalTimeActual || train.arrivalTimePlanned || '');

  const carEnabled = config.carLeg.enabled;
  const carDuration = carEnabled ? config.carLeg.durationMinutes || 25 : 0;
  const carWalkBuffer = carEnabled ? 5 : 0; // recupero auto dal parcheggio

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

  // Leg 2: Mezzi Urbani verso Stazione
  legs.push({
    id: 'return-transit-leg',
    type: 'transit',
    title: `Mezzi Pubblici verso ${config.arrivalStation.shortName || config.arrivalStation.name}`,
    subtitle: `${targetLecture.room} ➔ Stazione Ferroviaria (~${transitMins} min)`,
    startTime: minutesToTime(lectureEndMins + exitClassroomBuffer),
    endTime: minutesToTime(stationArrivalMins),
    durationMinutes: transitMins,
    details: {
      transitLine: config.transitLeg.lineSuggestion || 'Bus 492 / Metro B',
      travelMode: 'transit',
      mapQuery: `Stazione di ${config.arrivalStation.name}`,
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
    title: `Treno ${train.trainNumber}`,
    subtitle: `${config.arrivalStation.shortName || config.arrivalStation.name} ➔ ${config.departureStation.shortName || config.departureStation.name}`,
    startTime: minutesToTime(trainDepMins),
    endTime: minutesToTime(trainArrMins),
    durationMinutes: trainDuration,
    details: {
      trainNumber: train.trainNumber,
      platform: train.platformActual || train.platformPlanned,
      delayMinutes: train.delayMinutes,
      isLiveTrain: train.isLive,
      notes: `${train.category} verso ${train.destination} • Binario ${train.platformActual || train.platformPlanned || 'in definizione'}`,
    },
  });

  // Leg 4: Auto verso Casa
  if (carEnabled) {
    legs.push({
      id: 'return-car-leg',
      type: 'car',
      title: `Rientro in Auto verso ${config.originAddress}`,
      subtitle: `Dalla stazione a casa (~${carDuration} min)`,
      startTime: minutesToTime(trainArrMins + carWalkBuffer),
      endTime: minutesToTime(homeArrivalMins),
      durationMinutes: carDuration,
      details: {
        travelMode: 'driving',
        mapQuery: config.originAddress,
        notes: `Guida da ${config.departureStation.shortName || config.departureStation.name} a ${config.originAddress}`,
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
    statusBadge: {
      text: train.delayMinutes > 5 ? `Ritardo treno +${train.delayMinutes}m` : 'Rientro in orario',
      color: train.delayMinutes > 5 ? '#f59e0b' : '#34c759',
      isWarning: train.delayMinutes > 5,
    },
    summaryMessage: `Fine lezione ore ${targetLecture.endTime} ➔ Arrivo a casa a ${config.originAddress} alle ore ${minutesToTime(homeArrivalMins)}`,
  };
}
