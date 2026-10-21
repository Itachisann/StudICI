export interface StationInfo {
  name: string;
  code: string; // es. S08209 per Orte, S08217 per Roma Tiburtina
  shortName?: string;
}

export interface CommuterConfig {
  enabled: boolean;
  originAddress: string; // es. "Amelia"
  originCoords?: { lat: number; lon: number }; // coordinate esatte se il luogo è stato scelto dalla ricerca
  carLeg: {
    enabled: boolean;
    durationMinutes: number; // es. 24
    baseDurationMinutes?: number;
    trafficDelayMinutes?: number;
    trafficCondition?: string;
    trafficFluency?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
    parkingBufferMinutes: number; // es. 7
    stationAddress?: string; // es. "Stazione di Orte, Piazza XXV Aprile, Orte"
    distanceKm?: number; // es. 17.2
  };
  departureStation: StationInfo;
  arrivalStation: StationInfo;
  transitLeg: {
    preferredMode: 'auto' | 'bus' | 'metro' | 'tram' | 'walk' | 'mix';
    durationMinutes: number; // es. 20
    lineSuggestion?: string; // es. "Bus 492 / Metro B"
  };
  bufferMinutes: number; // Anticipo prima dell'inizio della lezione (es. 10 min)
  destinationType: 'auto' | 'custom'; // 'auto' usa l'aula della prima lezione, 'custom' usa customAddress
  customDestinationAddress?: string;
  customDestinationName?: string;
}

export interface LiveTrainInfo {
  trainNumber: string; // es. "RV 4153"
  category: string; // es. "RV", "REG"
  destination: string; // es. "ROMA TERMINI"
  originStationName: string;
  originStationCode?: string; // es. "S08304"
  departureTimePlanned: string; // "12:16"
  departureTimeActual?: string; // "12:18"
  departureMillis: number;
  arrivalTimePlanned?: string; // "12:57"
  arrivalTimeActual?: string; // "12:59"
  arrivalMillis?: number;
  platformPlanned?: string; // "3"
  platformActual?: string; // "3"
  delayMinutes: number; // 0, 2, 5
  statusDescription: string; // "In orario", "In ritardo di 4 min", "Soppresso"
  isLive: boolean;
  durationMinutes?: number; // es. 41
  isFast?: boolean; // true se Regionale Veloce (RV)
  isOriginStation?: boolean; // true se il treno ha origine da questa stazione (senza fermate precedenti)
  isDeparted?: boolean; // true se il treno è già effettivamente partito dall'origine
  isDepartedFromStation?: boolean; // true se il treno è già partito dalla stazione di riferimento del pendolare
  departureDelayAtStation?: number; // ritardo effettivo registrato specificamente alla partenza da questa stazione
  isStoppedInStation?: boolean; // true se il treno è attualmente fermo in una stazione (arrivato ma non ancora partito)
  stoppedStationName?: string; // nome della stazione in cui il treno è fermo
  stoppedStationEstimatedDep?: string; // orario di partenza stimato (HH:MM) dalla stazione in cui è fermo
  stoppedMinutes?: number; // quanti minuti effettivi il treno è fermo nella stazione (da quanto è fermo)
  stoppedSinceMillis?: number; // timestamp ms di arrivo nella stazione in cui è fermo
  hasEarlierTrain?: boolean;
  hasLaterTrain?: boolean;
  trainStatusType?: 'scheduled' | 'running' | 'on_time' | 'delayed' | 'early' | 'cancelled' | 'diverted' | 'interrupted' | 'warning';
  statusBadgeLabel?: string;
  alertMessage?: string;
  capacityWarning?: string;
  notPurchasable?: boolean;
}

export interface TripLeg {
  id: string;
  type: 'car' | 'train' | 'transit' | 'walk' | 'wait' | 'destination';
  title: string;
  subtitle: string;
  startTime: string; // "06:33"
  endTime: string; // "06:58"
  durationMinutes: number;
  details?: {
    platform?: string;
    trainNumber?: string;
    delay?: number;
    delayMinutes?: number;
    transitLine?: string;
    transitMode?: 'tram' | 'metro' | 'bus' | 'walk' | 'mix';
    notes?: string;
    isLiveTrain?: boolean;
    mapQuery?: string;
    mapOriginQuery?: string;
    mapCoords?: { lat: number; lng: number };
    travelMode?: 'driving' | 'transit' | 'walking';
    targetTime?: string; // es. "08:30"
    targetDate?: string; // es. "2026-10-07"
    timeType?: 'arrive_by' | 'depart_at';
    targetEpochSeconds?: number;
    trafficCondition?: string;
    trafficFluency?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
    isTrafficPeak?: boolean;
    trafficBaselineMinutes?: number;
    trafficDelayMinutes?: number;
    badgeText?: string;
    badgeColor?: string;
    badgeBg?: string;
    remainingLectureMinutes?: number;
    lostLectureMinutes?: number;
  };
}

export interface CommuterItinerary {
  direction: 'outbound' | 'return'; // andata (casa -> università) | ritorno (università -> casa)
  targetDate: string; // YYYY-MM-DD
  targetLecture?: {
    subject: string;
    room: string;
    buildingName?: string;
    buildingCode?: string;
    address: string;
    startTime: string; // "08:30"
    endTime: string; // "10:30"
    latitude?: number;
    longitude?: number;
  };
  departureTime: string; // "06:33"
  arrivalTime: string; // "08:20"
  totalDurationMinutes: number;
  legs: TripLeg[];
  liveTrain?: LiveTrainInfo | null;
  availableTrains?: LiveTrainInfo[];
  selectedTrainIndex?: number;
  statusBadge: {
    text: string;
    color: string;
    isWarning?: boolean;
  };
  summaryMessage: string;
  lectureTimeStatus?: {
    type: 'late_arrival' | 'early_departure';
    minutes: number;
    badgeText: string;
  };
}
