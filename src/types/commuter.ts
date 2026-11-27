import type { TransitBoardResult, TransitDepartureItem } from '../utils/transitBoardService';

export interface StationInfo {
  name: string;
  code: string; // es. S08209 per Orte, S08217 per Roma Tiburtina
  shortName?: string;
  lat?: number;
  lng?: number;
}

/**
 * Treno preferito indicizzato a livello giornaliero: legato al giorno della settimana,
 * alla direzione ("outbound" | "return") e all'identificativo univoco del treno
 * (numero treno + orario di partenza programmato), condiviso tra tutte le lezioni della giornata.
 */
export interface PreferredTrain {
  /** Identificativo univoco giornaliero della preferenza */
  id?: string;
  /** Direzione associata alla preferenza */
  direction?: 'outbound' | 'return';
  /** Giorno della settimana JS (0 = Domenica, 1 = Lunedì ... 6 = Sabato) */
  dayIndex?: number;
  /** Numero del treno normalizzato (es. "4110") */
  trainNumber?: string;
  /** Categoria commerciale del treno (es. "RV", "REG", "IC") */
  category?: string;
  /** Orario di partenza programmato (HH:MM) */
  departureTime: string;
  /** Orario di arrivo programmato (HH:MM) */
  arrivalTime?: string;
  /** Etichetta informativa (es. "RV 4110") */
  label?: string;
  /** @deprecated Campo legacy non più usato per l'indicizzazione esclusiva per lezione */
  subject?: string;
  /** @deprecated Campo legacy non più usato per l'indicizzazione esclusiva per lezione */
  room?: string;
}

export interface TrainPreferences {
  /**
   * Treni preferiti indicizzati a livello giornaliero (consentite più corse per direzione
   * nello stesso giorno, deduplicate per treno). Vedi `src/utils/preferredTrains.ts`.
   */
  preferredTrains?: Record<string, PreferredTrain>;
  /** Abilita l'analisi del consiglio di rientro anticipato */
  smartReturnEnabled?: boolean;
  /** Minuti massimi di fine lezione sacrificabili al ritorno (0 = disattivo) */
  maxEarlyLeaveMinutes?: number;
  /** Guadagno minimo reale sull'arrivo (in minuti) richiesto per consigliare l'uscita anticipata */
  minReturnGainMinutes?: number;
}

export interface SmartReturnRecommendation {
  trainNumber: string;
  category: string;
  departureTime: string;
  arrivalTime: string;
  lostLectureMinutes: number;
  savedArrivalMinutes: number;
  savedTotalTripMinutes?: number;
  durationMinutes?: number;
  standardTrainNumber: string;
  standardDepartureTime: string;
  standardArrivalTime: string;
  smartHomeArrivalTime: string;
  standardHomeArrivalTime: string;
  isCurrentlySelected: boolean;
}

export interface SmartOutboundRecommendation {
  trainNumber: string;
  category: string;
  departureTime: string;
  arrivalTime: string;
  lostLectureMinutes: number;
  savedDepartureMinutes: number;
  savedTotalTripMinutes?: number;
  smartTotalTripMinutes?: number;
  standardTotalTripMinutes?: number;
  smartArrivalTime?: string;
  transitLineLabel?: string;
  durationMinutes?: number;
  standardTrainNumber: string;
  standardDepartureTime: string;
  standardArrivalTime: string;
  smartHomeDepartureTime: string;
  standardHomeDepartureTime: string;
  isCurrentlySelected: boolean;
}

export interface StrikeAlertPreferences {
  /** Crea evento su Calendario (iOS) / notifica (Android) 7 giorni prima dello sciopero (ore 09:00) */
  notify7DaysBefore: boolean;
  /** Crea evento su Calendario (iOS) / notifica (Android) 1 giorno prima dello sciopero (ore 09:00) */
  notify1DayBefore: boolean;
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
  includeIntercity?: boolean; // Se true, include anche i treni Intercity (IC) oltre a RV e Regionali
  trainPreferences?: TrainPreferences;
  strikeAlerts?: StrikeAlertPreferences;
}

export interface LiveTrainStop {
  stationName: string;
  stationCode?: string;
  isPassed?: boolean;
  isCurrent?: boolean;
  actualTime?: string;
  plannedTime?: string;
  delayMinutes?: number;
  isExtraordinary?: boolean;
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
  departureDelayAtStation?: number;
  isArrivedAtDestination?: boolean;
  arrivalDelayAtStation?: number; // ritardo effettivo registrato specificamente alla partenza da questa stazione
  canPredictEarlyArrival?: boolean; // true solo se in marcia nell'ultimo tratto (tra penultima e discesa) con anticipo o già arrivato
  isStoppedInStation?: boolean; // true se il treno è attualmente fermo in una stazione (arrivato ma non ancora partito)
  stoppedStationName?: string; // nome della stazione in cui il treno è fermo
  stoppedStationEstimatedDep?: string; // orario di partenza stimato (HH:MM) dalla stazione in cui è fermo
  stoppedMinutes?: number; // quanti minuti effettivi il treno è fermo nella stazione (da quanto è fermo)
  stoppedSinceMillis?: number; // timestamp ms di arrivo nella stazione in cui è fermo
  stops?: LiveTrainStop[]; // fermate sequenziali del convoglio dall'origine al capolinea
  lastDetectionStationName?: string; // nome della stazione dell'ultimo rilevamento (transito/fermata)
  lastDetectionTime?: string; // orario dell'ultimo rilevamento
  originDepartureTimePlanned?: string; // orario programmato di partenza dall'origine
  originDepartureTimeActual?: string; // orario effettivo di partenza dall'origine
  hasEarlierTrain?: boolean;
  hasLaterTrain?: boolean;
  isTelemetryUnavailable?: boolean;
  trainStatusType?: 'scheduled' | 'running' | 'on_time' | 'delayed' | 'early' | 'arrived' | 'cancelled' | 'diverted' | 'interrupted' | 'warning' | 'telemetry_unavailable';
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
    walkBeforeMinutes?: number;
    inVehicleMinutes?: number;
    walkAfterMinutes?: number;
    busDepartureTime?: string;
    busAlightingTime?: string;
    coincidenceAvailableFromTime?: string;
    firstAvailableDepartureTime?: string;
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
  smartReturnRecommendation?: SmartReturnRecommendation;
  smartOutboundRecommendation?: SmartOutboundRecommendation;
  prefetchedTransitBoard?: TransitBoardResult;
  lastUsefulTransitDeparture?: TransitDepartureItem;
  transitLiveContext?: boolean;
  transitConstraintTime?: string;
  transitMinDepartureTime?: string;
  transitArrivalBufferMinutes?: number;
  transitPreferLatestBeforeDeadline?: boolean;
}
