/**
 * Service per la Transit Board (Mezzi urbani, partenze programmate e in tempo reale)
 * Supporta Roma (ATAC / Metro / Tram / Cotral) e qualsiasi città o stazione in Italia (GTFS / GTFS-RT via Transitous MOTIS 2).
 */

import { Ionicons } from '@expo/vector-icons';
import { ROME_STATION_COORDINATES } from './transitRouter';
import { resolveClassroom } from './classroomLocations';

export interface LatLngPoint {
  latitude: number;
  longitude: number;
}

export interface TransitLegDetail {
  line: string;
  mode: 'bus' | 'metro' | 'tram' | 'rail';
  headsign?: string;
  fromStop: string;
  toStop: string;
  fromStopCoords?: { lat: number; lng: number };
  toStopCoords?: { lat: number; lng: number };
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes: number;
  intermediateStopsCount?: number;
  intermediateStopNames?: string[];
  polyline?: LatLngPoint[];
}

export interface TransitDepartureItem {
  id: string;
  line: string; // es. "492", "71", "163", "Metro B"
  mode: 'bus' | 'metro' | 'tram' | 'rail';
  headsign: string; // Direzione effettiva della corsa (es. "L.go Chigi", "Staz.ne Metro Cipro (MA)")
  fromStop: string; // Fermata di salita (es. "Staz.ne Tiburtina (MB)")
  toStop: string; // Fermata di discesa ("quella dove scendo", es. "Tiburtina / Castro Laurenziano")
  scheduledTime: string; // Orario programmato partenza mezzo (es. "08:10")
  estimatedTime: string; // Orario stimato/live partenza mezzo (es. "08:10")
  alightingTime: string; // Orario di arrivo del mezzo alla fermata di discesa (es. "08:18")
  arrivalTime: string; // Orario di arrivo finale a destinazione inclusa camminata a piedi (es. "08:21")
  delayMinutes: number;
  isLive: boolean;
  durationMinutes: number; // Durata reale dal mezzo fino a destinazione (inVehicleMinutes + walkAfterMinutes)
  totalDoorToDoorMinutes: number; // Durata totale (walkBeforeMinutes + inVehicleMinutes + walkAfterMinutes)
  inVehicleMinutes: number; // Minuti effettivi a bordo del mezzo
  walkingMinutes: number; // Minuti totali a piedi (walkBefore + walkAfter)
  walkBeforeMinutes: number; // Minuti a piedi per raggiungere la fermata di salita
  walkAfterMinutes: number; // Minuti a piedi dalla fermata di discesa fino all'aula/stazione
  statusType: 'on_time' | 'delayed' | 'early' | 'scheduled' | 'cancelled';
  statusLabel: string;
  alerts?: string[];
  isDirect: boolean;
  transfersCount: number;
  transferSummary?: string; // es. "Metro B ➔ Bus 71"
  legs?: TransitLegDetail[]; // Dettaglio unificato di ogni tratta della corsa (se con cambio)
  fromStopCoords?: { lat: number; lng: number };
  toStopCoords?: { lat: number; lng: number };
  finalDestCoords?: { lat: number; lng: number };
  finalDestinationName?: string;
  intermediateStopsCount?: number;
  intermediateStopNames?: string[];
  intermediateStopCoords?: { name: string; lat: number; lng: number }[];
  transitPolyline?: LatLngPoint[];
  walkBeforePolyline?: LatLngPoint[];
  walkAfterPolyline?: LatLngPoint[];
  transferWalkPolylines?: LatLngPoint[][];
  crowdingLevel?: 'low' | 'medium' | 'high';
  operator?: string;
  isSuggested?: boolean;
  isOptimal?: boolean;
}

export interface TransitBoardResult {
  stationName: string;
  destinationName: string;
  directLines: string[];
  departures: TransitDepartureItem[];
  optimalDeparture?: TransitDepartureItem;
  optimalIndex: number;
  lastUpdated: string;
  isLiveSource: boolean;
}

const CURATED_LINE_PALETTE = [
  '#0284c7',
  '#ea580c',
  '#d97706',
  '#4f46e5',
  '#0891b2',
  '#9333ea',
  '#db2777',
  '#0d9488',
  '#e11d48',
  '#2563eb',
];

// Cache in-memory per le direzioni reali (capolinea di giro) delle linee circolari/anello GTFS
const circularTurnaroundCache = new Map<string, string>();

/**
 * Decodifica una stringa Google Encoded Polyline (precisione 6 o 5 usata da MOTIS/Transitous)
 * in una lista di coordinate per il disegno su MapView.
 */
export function decodeEncodedPolyline(
  encoded?: string,
  precision = 6
): LatLngPoint[] {
  if (!encoded || typeof encoded !== 'string') return [];
  const points: LatLngPoint[] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  try {
    while (index < len) {
      let b: number;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= len);
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= len);
      const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({
        latitude: lat / factor,
        longitude: lng / factor,
      });
    }
  } catch {
    return points;
  }

  return points;
}

export function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Proietta ortogonalmente il punto P sul segmento A-B della polilinea.
 */
function projectPointOnSegment(
  p: LatLngPoint,
  a: LatLngPoint,
  b: LatLngPoint
): { point: LatLngPoint; distanceMeters: number } {
  const dLat = b.latitude - a.latitude;
  const dLng = b.longitude - a.longitude;
  const lenSq = dLat * dLat + dLng * dLng;

  if (lenSq < 1e-12) {
    return {
      point: a,
      distanceMeters: haversineMeters(p, a),
    };
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.latitude - a.latitude) * dLat + (p.longitude - a.longitude) * dLng) / lenSq
    )
  );

  const proj: LatLngPoint = {
    latitude: a.latitude + t * dLat,
    longitude: a.longitude + t * dLng,
  };

  return {
    point: proj,
    distanceMeters: haversineMeters(p, proj),
  };
}

/**
 * Se la coordinata della fermata si trova entro maxDistMeters (default 200m)
 * da qualsiasi segmento della polilinea del percorso, la aggancia perfettamente
 * sul tracciato stradale disegnato. Questo impedisce ai marker di fluttuare fuori strada.
 */
export function snapCoordinateToPolyline(
  coord?: { lat: number; lng: number } | LatLngPoint,
  polyline?: LatLngPoint[],
  maxDistMeters = 200
): LatLngPoint {
  if (!coord) return { latitude: 41.903932, longitude: 12.520330 };
  const p: LatLngPoint =
    'latitude' in coord
      ? coord
      : { latitude: coord.lat, longitude: coord.lng };

  if (!polyline || polyline.length < 2) {
    return p;
  }

  let bestPoint = p;
  let minDistance = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const { point, distanceMeters } = projectPointOnSegment(
      p,
      polyline[i],
      polyline[i + 1]
    );
    if (distanceMeters < minDistance) {
      minDistance = distanceMeters;
      bestPoint = point;
    }
  }

  if (minDistance <= maxDistMeters) {
    return bestPoint;
  }
  return p;
}

/**
 * Calcola in modo affidabile il minutaggio pedonale reale tra due coordinate geografiche
 * (oppure lungo una polilinea pedonale decodificata se disponibile).
 * Velocità pedonale media urbana con attraversamenti: 4.5 km/h = 75 metri/minuto,
 * con fattore di tortuosità della rete stradale urbana reale (1.20x - 1.28x).
 */
export function calculateRealWalkMinutes(
  from: { lat: number; lng: number } | { latitude: number; longitude: number },
  to: { lat: number; lng: number } | { latitude: number; longitude: number },
  polyline?: LatLngPoint[],
  options?: { isUphill?: boolean; elevationDeltaMeters?: number }
): { minutes: number; distanceMeters: number } {
  const fromLat = 'lat' in from ? from.lat : from.latitude;
  const fromLng = 'lng' in from ? from.lng : from.longitude;
  const toLat = 'lat' in to ? to.lat : to.latitude;
  const toLng = 'lng' in to ? to.lng : to.longitude;

  let distanceMeters = 0;
  if (polyline && polyline.length >= 2) {
    for (let i = 1; i < polyline.length; i++) {
      distanceMeters += haversineMeters(polyline[i - 1], polyline[i]);
    }
  }

  const straightMeters = haversineMeters(
    { latitude: fromLat, longitude: fromLng },
    { latitude: toLat, longitude: toLng }
  );

  if (distanceMeters < straightMeters) {
    const detourFactor = straightMeters < 150 ? 1.12 : straightMeters < 450 ? 1.22 : 1.28;
    distanceMeters = straightMeters * detourFactor;
  }

  if (distanceMeters < 35) {
    return { minutes: 1, distanceMeters: Math.round(distanceMeters) };
  }

  // Rilevamento salita urbana ed eventuale pendenza stradale:
  // Se specificato esplicitamente oppure se il tragitto pedonale proviene da assi ribassati/valli e sale verso quote universitarie
  // (es. salita da Via Catania / Lega Lombarda / Scalo verso Castro Laurenziano / Policlinico), il passo pedonale rallenta
  const isUphill =
    options?.isUphill ??
    ((options?.elevationDeltaMeters ?? 0) > 6 ||
      (fromLat > 41.905 && fromLng < 12.518 && toLat < 41.904 && toLng >= 12.518) ||
      (fromLat < 41.904 && fromLng > 12.525 && toLat > 41.907 && toLng < 12.525));

  // Velocità pedonale media urbana: 75 m/min in piano/discesa (4.5 km/h), ~58 m/min in salita (~3.5 km/h con pendenza/semafori)
  const walkingSpeedMpm = isUphill ? 58 : 75;
  const minutes = Math.max(1, Math.round(distanceMeters / walkingSpeedMpm));
  return { minutes, distanceMeters: Math.round(distanceMeters) };
}

/**
 * Assicura che le fermate (salita, fermate intermedie, discesa) siano posizionate esattamente
 * sulla sede stradale e sulla corretta banchina, evitando coordinate GTFS grezze che ricadono
 * all'interno del perimetro di fabbricati/edifici privati o cortili (es. lotto CUT a P.le delle Crociate).
 */
export function snapStopToRoadway(
  stopName?: string,
  coords?: { lat: number; lng: number }
): { lat: number; lng: number } {
  if (!coords) return { lat: 41.90955, lng: 12.53038 };
  const sNorm = (stopName || '').toLowerCase();

  // Tiburtina / Crociate: banchina stradale ordinaria su Via Tiburtina / P.le delle Crociate
  if (sNorm.includes('crociate')) {
    if (coords.lat < 41.90795 && coords.lng > 12.5255) {
      return { lat: 41.907907, lng: 12.525800 }; // Inbound (verso Stazione)
    }
    return { lat: 41.908035, lng: 12.525917 }; // Outbound (verso Verano/Castro)
  }

  // Tiburtina / Valerio Massimo: banchina laterale ordinaria (lato nord-ovest per andata, lato sud-est per ritorno)
  if (sNorm.includes('valerio massimo')) {
    if (coords.lat > 41.9060 || coords.lng > 12.5225) {
      return { lat: 41.905772, lng: 12.522396 }; // Inbound (carreggiata sud-est verso Stazione)
    }
    return { lat: 41.905884, lng: 12.522221 }; // Outbound (carreggiata nord-ovest verso Castro/Verano)
  }

  // Tiburtina / Castro Laurenziano: banchina laterale sul marciapiede all'angolo con Via del Castro Laurenziano
  if (sNorm.includes('castro laurenziano')) {
    if (coords.lng > 12.52055) {
      return { lat: 41.903813, lng: 12.520513 }; // Inbound (carreggiata sud-est verso Stazione)
    }
    return { lat: 41.903932, lng: 12.520330 }; // Outbound (carreggiata nord-ovest verso Castro/Verano)
  }

  return coords;
}

/**
 * Pulisce la polilinea del mezzo da punti duplicati, offset imprecisi di vecchi feed GTFS
 * e zig-zag anomali, garantendo che le tratte transit non saltino tra corsie o dentro edifici.
 */
export function cleanTransitPolylineRoadway(polyline: LatLngPoint[]): LatLngPoint[] {
  if (!polyline || polyline.length < 3) return polyline;
  const result: LatLngPoint[] = [];

  for (let i = 0; i < polyline.length; i++) {
    const pt = polyline[i];
    // Rimuove punti duplicati consecutivi (< 1.5 metri)
    if (result.length > 0) {
      const last = result[result.length - 1];
      if (
        Math.abs(last.latitude - pt.latitude) < 0.000015 &&
        Math.abs(last.longitude - pt.longitude) < 0.000015
      ) {
        continue;
      }
    }

    // Filtra spike anomali a zig-zag: se un punto salta lateralmente e poi ritorna subito
    if (i > 0 && i < polyline.length - 1) {
      const prev = polyline[i - 1];
      const next = polyline[i + 1];
      const dDirect = haversineMeters(prev, next);
      const dViaPt = haversineMeters(prev, pt) + haversineMeters(pt, next);
      // Spike acuto: deviazione laterale notevole rispetto alla linea diretta
      if (dDirect < 75 && dViaPt > dDirect + 18) {
        continue;
      }
    }

    // Filtra spike doppio (2 punti consecutivi che saltano fuori strada/nell'erba e ritornano)
    if (i > 0 && i < polyline.length - 2) {
      const prev = polyline[i - 1];
      const nextNext = polyline[i + 2];
      const dDirect2 = haversineMeters(prev, nextNext);
      const dVia2 =
        haversineMeters(prev, pt) +
        haversineMeters(pt, polyline[i + 1]) +
        haversineMeters(polyline[i + 1], nextNext);
      if (dDirect2 < 90 && dVia2 > dDirect2 + 35) {
        i++; // salta entrambi i punti anomali
        continue;
      }
    }

    result.push(pt);
  }

  return result.length >= 2 ? result : polyline;
}

/**
 * Risolve in modo generale per qualsiasi linea (71, 163, 448, 492, 545, ecc.)
 * la traiettoria corretta lungo la carreggiata stradale verificata, garantendo che i bus
 * viaggino sempre nella corsia corretta (es. corsia nord-ovest per Castro Laurenziano/Verano,
 * corsia sud-est verso Stazione Tiburtina) senza mai finire nella corsia contromano, fare zig-zag
 * o passare sopra fabbricati e spartitraffico chiusi per cantiere tranviario.
 */
export function resolveOptimizedTransitPolyline(
  fromName: string,
  toName: string,
  fromCoords: { lat: number; lng: number },
  toCoords: { lat: number; lng: number },
  rawPolyline: LatLngPoint[]
): LatLngPoint[] {
  const fNorm = (fromName || '').toLowerCase();
  const tNorm = (toName || '').toLowerCase();

  const isTiburtinaOrigin =
    (fNorm.includes('tiburtina') &&
      (fNorm.includes('mb') || fNorm.includes('staz') || fNorm.includes('fs'))) ||
    (fromCoords.lat > 41.9080 && fromCoords.lng > 12.5270);

  const isTiburtinaDestination =
    (tNorm.includes('tiburtina') &&
      (tNorm.includes('mb') || tNorm.includes('staz') || tNorm.includes('fs'))) ||
    (toCoords.lat > 41.9080 && toCoords.lng > 12.5270);

  const isToCastro = tNorm.includes('castro') || tNorm.includes('laurenziano');
  const isFromCastro = fNorm.includes('castro') || fNorm.includes('laurenziano');
  const isToVerano = tNorm.includes('verano');
  const isFromVerano = fNorm.includes('verano');
  const isToValerio = tNorm.includes('valerio') || tNorm.includes('massimo');
  const isFromValerio = fNorm.includes('valerio') || fNorm.includes('massimo');
  const isToCrociate = tNorm.includes('crociate');
  const isFromCrociate = fNorm.includes('crociate');

  // Corridoio Via Tiburtina: Andata (dalla Stazione Tiburtina verso sud-ovest)
  if (isTiburtinaOrigin || (fromCoords.lat > 41.9080 && fromCoords.lng > 12.5270)) {
    if (isToVerano) {
      return TIBURTINA_OUTBOUND_TO_VERANO;
    }
    if (isToCastro || (toCoords.lat <= 41.9042 && toCoords.lng >= 12.5190 && toCoords.lng <= 12.5220)) {
      return TIBURTINA_OUTBOUND_TO_CASTRO;
    }
    if (isToValerio) {
      const idx = TIBURTINA_OUTBOUND_TO_CASTRO.findIndex(
        (p) => Math.abs(p.latitude - 41.905884) < 0.0003 && Math.abs(p.longitude - 12.522221) < 0.0003
      );
      if (idx > 0) return TIBURTINA_OUTBOUND_TO_CASTRO.slice(0, idx + 1);
    }
    if (isToCrociate) {
      const idx = TIBURTINA_OUTBOUND_TO_CASTRO.findIndex(
        (p) => Math.abs(p.latitude - 41.908035) < 0.0003 && Math.abs(p.longitude - 12.525917) < 0.0003
      );
      if (idx > 0) return TIBURTINA_OUTBOUND_TO_CASTRO.slice(0, idx + 1);
    }
  }

  // Corridoio Via Tiburtina: Ritorno (verso la Stazione Tiburtina in direzione nord-est)
  if (isTiburtinaDestination || (toCoords.lat > 41.9080 && toCoords.lng > 12.5270)) {
    if (isFromVerano) {
      return TIBURTINA_INBOUND_FROM_VERANO;
    }
    if (isFromCastro || (fromCoords.lat <= 41.9042 && fromCoords.lng >= 12.5190 && fromCoords.lng <= 12.5220)) {
      return TIBURTINA_INBOUND_FROM_CASTRO;
    }
    if (isFromValerio) {
      const idx = TIBURTINA_INBOUND_FROM_CASTRO.findIndex(
        (p) => Math.abs(p.latitude - 41.905772) < 0.0004 && Math.abs(p.longitude - 12.522396) < 0.0004
      );
      if (idx >= 0) return TIBURTINA_INBOUND_FROM_CASTRO.slice(idx);
    }
    if (isFromCrociate) {
      const idx = TIBURTINA_INBOUND_FROM_CASTRO.findIndex(
        (p) => Math.abs(p.latitude - 41.907907) < 0.0004 && Math.abs(p.longitude - 12.525800) < 0.0004
      );
      if (idx >= 0) return TIBURTINA_INBOUND_FROM_CASTRO.slice(idx);
    }
  }

  // Corsa di passaggio che attraversa il corridoio di Via Tiburtina verso sud-ovest (es. linee generiche)
  if (
    fromCoords.lat > 41.9075 &&
    toCoords.lat < 41.9045 &&
    fromCoords.lng > 12.5250 &&
    toCoords.lng < 12.5220
  ) {
    return isToVerano ? TIBURTINA_OUTBOUND_TO_VERANO : TIBURTINA_OUTBOUND_TO_CASTRO;
  }
  // Corsa di passaggio verso nord-est
  if (
    fromCoords.lat < 41.9045 &&
    toCoords.lat > 41.9075 &&
    fromCoords.lng < 12.5220 &&
    toCoords.lng > 12.5250
  ) {
    return isFromVerano ? TIBURTINA_INBOUND_FROM_VERANO : TIBURTINA_INBOUND_FROM_CASTRO;
  }

  // Per qualsiasi altra linea / città in Italia: applica il filtro geometrico anti-zigzag
  return cleanTransitPolylineRoadway(rawPolyline);
}

/**
 * Normalizza e formatta i nomi di fermate e direzioni provenienti dai feed GTFS (spesso tutti maiuscoli)
 */
export function formatStopDisplayName(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  // Se non è tutto maiuscolo, preserva la formattazione originale
  if (trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }

  const preserveUpper = new Set([
    '(MA)',
    '(MB)',
    '(MB1)',
    '(MC)',
    '(FS)',
    '(FL1)',
    '(FL2)',
    '(FL3)',
    'FS',
    'MA',
    'MB',
    'MC',
    'II',
    'III',
    'IV',
    'VI',
    'XX',
    'XXV',
  ]);

  return trimmed
    .replace(/\//g, ' / ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      if (upper === 'STAZ.NE') return 'Staz.ne';
      if (upper === 'P.ZA') return 'P.za';
      if (upper === 'P.LE') return 'P.le';
      if (upper === 'L.GO') return 'L.go';
      if (upper === 'V.LE') return 'V.le';
      if (upper === 'S.') return 'S.';
      if (word.length <= 1) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\s+\/\s+/g, ' / ');
}

function normalizeStopTokens(name?: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(m[abc1]?\)|\(fs\)|staz\.?ne|stazione|fermata|piazzale|p\.le|p\.za|l\.go/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Verifica se la direzione GTFS coincide erroneamente con la fermata di partenza
 * (tipico delle linee ad anello/circolari come il 71 a Roma, dove tripFrom === tripTo).
 * In tal caso interroga l'elenco completo delle fermate della corsa per individuare il vero capolinea di svolta
 * (es. "L.go Chigi" per il 71 in uscita da Tiburtina).
 */
async function resolveVerifiedHeadsign(primaryLeg: any): Promise<string> {
  const rawHeadsign = (primaryLeg.headsign || '').trim();
  const fromName = (primaryLeg.from?.name || '').trim();
  const toName = (primaryLeg.to?.name || '').trim();
  const tripFromName = (primaryLeg.tripFrom?.name || '').trim();
  const tripToName = (primaryLeg.tripTo?.name || '').trim();

  const normHead = normalizeStopTokens(rawHeadsign);
  const normFrom = normalizeStopTokens(fromName);
  const normTo = normalizeStopTokens(toName);
  const normTripFrom = normalizeStopTokens(tripFromName);
  const normTripTo = normalizeStopTokens(tripToName);

  const isLoopTrip =
    Boolean(normTripFrom && normTripTo && normTripFrom === normTripTo) ||
    Boolean(
      primaryLeg.tripFrom?.stopId &&
        primaryLeg.tripTo?.stopId &&
        primaryLeg.tripFrom.stopId === primaryLeg.tripTo.stopId
    );

  const headsignMatchesOrigin =
    !normHead ||
    (normFrom.length >= 4 &&
      (normHead === normFrom ||
        normHead.includes(normFrom) ||
        normFrom.includes(normHead)));

  // Se la linea non è circolare e l'headsign non coincide con la fermata di salita, l'headsign GTFS è già corretto
  if (!isLoopTrip && !headsignMatchesOrigin) {
    return formatStopDisplayName(rawHeadsign);
  }

  // Se siamo su una linea circolare ma stiamo effettivamente tornando verso il capolinea finale (to === headsign),
  // allora la direzione mostrata (es. Staz.ne Tiburtina tornando da Castro Laurenziano) è già quella giusta!
  if (
    normHead &&
    normTo &&
    !headsignMatchesOrigin &&
    (normTo === normHead || normTo.includes(normHead) || normHead.includes(normTo))
  ) {
    return formatStopDisplayName(rawHeadsign);
  }

  const routeKey = `${primaryLeg.routeId || primaryLeg.routeShortName || 'route'}_${primaryLeg.directionId || '0'}_${normFrom}`;
  const cachedTurnaround = circularTurnaroundCache.get(routeKey);
  if (cachedTurnaround) {
    return cachedTurnaround;
  }

  // Interroga /api/v5/trip di Transitous per trovare il punto più distante (capolinea di svolta dell'anello)
  if (primaryLeg.tripId) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2400);
      const tripUrl = `https://api.transitous.org/api/v5/trip?tripId=${encodeURIComponent(primaryLeg.tripId)}`;
      const res = await fetch(tripUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);

      if (res.ok) {
        const tripData = await res.json();
        const fullLeg = tripData?.legs?.[0];
        const allStops: any[] = Array.isArray(fullLeg?.intermediateStops)
          ? fullLeg.intermediateStops
          : [];
        const loopOriginLat = fullLeg?.from?.lat ?? primaryLeg.from?.lat;
        const loopOriginLon = fullLeg?.from?.lon ?? primaryLeg.from?.lon;

        if (allStops.length > 0 && typeof loopOriginLat === 'number' && typeof loopOriginLon === 'number') {
          let maxDist = -1;
          let turnaroundIdx = Math.floor(allStops.length / 2);

          allStops.forEach((s, idx) => {
            if (typeof s?.lat === 'number' && typeof s?.lon === 'number') {
              const d = Math.hypot(s.lat - loopOriginLat, s.lon - loopOriginLon);
              if (d > maxDist) {
                maxDist = d;
                turnaroundIdx = idx;
              }
            }
          });

          const turnaroundStopName = allStops[turnaroundIdx]?.name;
          if (turnaroundStopName) {
            // Verifica se la fermata di discesa dell'utente si trova nella prima metà dell'anello (verso il turnaround)
            // o nella seconda metà (dopo il turnaround, tornando al capolinea)
            const toStopId = primaryLeg.to?.stopId;
            let userAlightIdx = allStops.findIndex(
              (s) => (toStopId && s.stopId === toStopId) || normalizeStopTokens(s.name) === normTo
            );

            if (userAlightIdx === -1 || userAlightIdx <= turnaroundIdx + 2) {
              const formatted = formatStopDisplayName(turnaroundStopName);
              circularTurnaroundCache.set(routeKey, formatted);
              return formatted;
            } else if (tripToName && !headsignMatchesOrigin) {
              const formatted = formatStopDisplayName(tripToName);
              circularTurnaroundCache.set(routeKey, formatted);
              return formatted;
            }
          }
        }
      }
    } catch {
      // Continua con il fallback intelligente
    }
  }

  // Fallback se il dettaglio trip non risponde: usa la fermata di discesa o l'ultima fermata intermedia nota
  if (toName && normalizeStopTokens(toName) !== normFrom) {
    return formatStopDisplayName(toName);
  }

  return formatStopDisplayName(rawHeadsign || toName || 'Centro');
}

/**
 * Restituisce il colore specifico assegnato a ciascuna linea (preservato in tutta la UI e nei modali)
 */
export function getLineBadgeColor(
  line: string,
  mode?: TransitDepartureItem['mode']
): string {
  const lNorm = (line || '').toLowerCase().trim();
  if (lNorm.includes('metro a') || lNorm === 'ma' || lNorm === 'linea a') return '#f97316';
  if (
    lNorm.includes('metro b') ||
    lNorm === 'mb' ||
    lNorm === 'mb1' ||
    lNorm === 'nmb' ||
    lNorm === 'linea b'
  ) {
    return '#2563eb';
  }
  if (lNorm.includes('metro c') || lNorm === 'mc' || lNorm === 'linea c') return '#10b981';
  if (mode === 'tram' || lNorm.startsWith('tram')) {
    if (lNorm.includes('14')) return '#059669';
    if (lNorm.includes('5')) return '#10b981';
    if (lNorm.includes('3')) return '#0d9488';
    if (lNorm.includes('19')) return '#047857';
    return '#059669';
  }
  if (mode === 'rail') return '#7c3aed';
  if (lNorm.includes('492')) return '#0284c7';
  if (lNorm.includes('71')) return '#ea580c';
  if (lNorm.includes('163')) return '#d97706';
  if (lNorm.includes('448')) return '#4f46e5';
  if (lNorm.includes('545')) return '#0d9488';
  if (lNorm.includes('310')) return '#0891b2';
  if (lNorm.includes('649')) return '#9333ea';
  if (lNorm.includes('62')) return '#db2777';
  if (lNorm.includes('490')) return '#0d9488';
  if (lNorm.includes('495')) return '#7c3aed';

  let hash = 0;
  for (let i = 0; i < lNorm.length; i++) {
    hash = (hash * 31 + lNorm.charCodeAt(i)) >>> 0;
  }
  return CURATED_LINE_PALETTE[hash % CURATED_LINE_PALETTE.length];
}

export function getTransitModeIcon(
  mode?: TransitDepartureItem['mode'],
  line?: string
): keyof typeof Ionicons.glyphMap {
  const lNorm = (line || '').toLowerCase();
  if (mode === 'metro' || lNorm.includes('metro')) return 'subway-outline';
  if (mode === 'tram' || lNorm.includes('tram')) return 'git-commit-outline';
  if (mode === 'rail') return 'train-outline';
  return 'bus-outline';
}

export function parseHHMMToMins(timeStr?: string): number {
  if (!timeStr || !timeStr.includes(':')) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

export function minsToHHMM(totalMins: number): string {
  const norm = ((Math.round(totalMins) % 1440) + 1440) % 1440;
  const h = String(Math.floor(norm / 60)).padStart(2, '0');
  const m = String(norm % 60).padStart(2, '0');
  return `${h}:${m}`;
}

const EXTRA_STATION_COORDS: Record<string, { lat: number; lng: number }> = {
  orte: { lat: 42.43753, lng: 12.4085 },
  'orte scalo': { lat: 42.43753, lng: 12.4085 },
  narni: { lat: 42.53148, lng: 12.51916 },
  'narni-amelia': { lat: 42.53148, lng: 12.51916 },
  terni: { lat: 42.57013, lng: 12.65122 },
  'civita castellana': { lat: 42.34658, lng: 12.45417 },
  'civita castellana-magliano': { lat: 42.34658, lng: 12.45417 },
  viterbo: { lat: 42.4231, lng: 12.1065 },
  'viterbo porta fiorentina': { lat: 42.4231, lng: 12.1065 },
  'viterbo porta romana': { lat: 42.4144, lng: 12.1105 },
  'milano centrale': { lat: 45.4859, lng: 9.2045 },
  'torino porta nuova': { lat: 45.0622, lng: 7.6784 },
  'bologna centrale': { lat: 44.5058, lng: 11.3431 },
  'firenze santa maria novella': { lat: 43.7765, lng: 11.248 },
  'napoli centrale': { lat: 40.8529, lng: 14.2723 },
};

export function resolveStationCoordinates(stationName: string): { lat: number; lng: number } {
  const norm = (stationName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (norm.includes('tiburtina')) return ROME_STATION_COORDINATES.tiburtina;
  if (norm.includes('termini')) return ROME_STATION_COORDINATES.termini;
  if (norm.includes('ostiense') || norm.includes('piramide')) return ROME_STATION_COORDINATES.ostiense;
  if (norm.includes('tuscolana')) return ROME_STATION_COORDINATES.tuscolana;
  if (norm.includes('trastevere')) return ROME_STATION_COORDINATES.trastevere;
  if (norm.includes('san pietro') || norm.includes('s. pietro')) return ROME_STATION_COORDINATES.san_pietro;
  if (norm.includes('valle aurelia')) return ROME_STATION_COORDINATES.valle_aurelia;
  if (norm.includes('prenestina')) return ROME_STATION_COORDINATES.prenestina;
  if (norm.includes('nomentana')) return ROME_STATION_COORDINATES.nomentana;

  for (const [key, coords] of Object.entries(EXTRA_STATION_COORDS)) {
    if (norm.includes(key)) {
      return coords;
    }
  }

  return ROME_STATION_COORDINATES.generic;
}

function normalizeMode(modeStr?: string, routeType?: number): 'bus' | 'metro' | 'tram' | 'rail' {
  const m = (modeStr || '').toUpperCase();
  if (m === 'SUBWAY' || m === 'METRO' || routeType === 1) return 'metro';
  if (m === 'TRAM' || routeType === 0) return 'tram';
  if (m === 'RAIL' || m === 'REGIONAL_RAIL' || routeType === 2) return 'rail';
  return 'bus';
}

function formatIsoToHHMM(isoStr?: string): string {
  if (!isoStr) return '--:--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  } catch {
    return '--:--';
  }
}

function buildQueryIsoTime(targetDate?: string, targetTime?: string): string {
  try {
    const now = new Date();
    if (targetTime === 'now' || (!targetDate && !targetTime)) {
      return now.toISOString();
    }

    let y = now.getFullYear();
    let m = now.getMonth();
    let d = now.getDate();

    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      const parts = targetDate.split('-').map(Number);
      y = parts[0];
      m = parts[1] - 1;
      d = parts[2];
    }

    let hh = now.getHours();
    let mm = now.getMinutes();

    if (targetTime && /^\d{1,2}:\d{2}$/.test(targetTime)) {
      const parts = targetTime.split(':').map(Number);
      hh = parts[0];
      mm = parts[1];
    }

    const qDate = new Date(y, m, d, hh, mm, 0);
    return qDate.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Individua la corsa ottimale (l'ultimo mezzo utile per arrivare a destinazione in tempo,
 * considerando camminata iniziale, durata reale del mezzo e camminata finale fino all'aula/stazione,
 * e privilegiando a parità di fascia la corsa con durata minore che fa arrivare prima).
 */
export function findOptimalTransitDeparture(
  departures: TransitDepartureItem[],
  options: {
    direction: 'to_campus' | 'to_station';
    isLiveContext: boolean;
    constraintTime?: string; // Ritorno: partenza treno. Andata: inizio lezione.
    minDepartureTime?: string; // Andata: arrivo treno in stazione.
    targetTime?: string;
  }
): { optimal: TransitDepartureItem | undefined; optimalIndex: number } {
  if (!departures || departures.length === 0) {
    return { optimal: undefined, optimalIndex: 0 };
  }

  const { direction, isLiveContext, constraintTime, minDepartureTime } = options;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const getDepMins = (d: TransitDepartureItem) =>
    parseHHMMToMins(isLiveContext && d.isLive ? d.estimatedTime || d.scheduledTime : d.scheduledTime);

  const getDestArrMins = (d: TransitDepartureItem) => {
    const arrM = parseHHMMToMins(d.arrivalTime);
    if (arrM >= 0) return arrM;
    const depM = getDepMins(d);
    return depM >= 0 ? depM + d.durationMinutes : -1;
  };

  const deadlineMins = parseHHMMToMins(constraintTime);
  const rawMinDepMins = parseHHMMToMins(minDepartureTime);
  const effectiveMinDepMins =
    direction === 'to_campus'
      ? rawMinDepMins
      : rawMinDepMins > 0 && (deadlineMins < 0 || deadlineMins - rawMinDepMins >= 14)
        ? rawMinDepMins
        : -1;

  // Orario minimo in cui l'utente può iniziare a muoversi dall'origine (stazione o aula)
  const minOriginStartMins = isLiveContext
    ? Math.max(nowMins - 1, effectiveMinDepMins > 0 ? effectiveMinDepMins : 0)
    : effectiveMinDepMins > 0
      ? effectiveMinDepMins
      : 0;

  // 1. Filtra le corse prendibili (considerando anche i minuti a piedi per raggiungere la fermata di salita)
  let reachable = departures.filter((d) => {
    const depM = getDepMins(d);
    if (depM < 0) return false;
    const leaveOriginM = depM - (d.walkBeforeMinutes || 0);
    return leaveOriginM >= minOriginStartMins - 1;
  });

  if (reachable.length === 0) {
    reachable = [...departures];
  }

  // 2. Filtra le corse che arrivano a destinazione (inclusa la camminata dalla fermata di discesa) entro il vincolo orario
  let onTimeCandidates = reachable;
  if (deadlineMins > 0) {
    // Per il ritorno in stazione consideriamo almeno 2 minuti di margine per raggiungere il binario;
    // per l'andata l'arrivo in aula (inclusa la camminata a piedi) deve avvenire entro l'orario di inizio lezione
    const effectiveDeadline = direction === 'to_station' ? deadlineMins - 2 : deadlineMins;
    const withinEffective = reachable.filter((d) => {
      const destArrM = getDestArrMins(d);
      return destArrM > 0 && destArrM <= effectiveDeadline && destArrM >= effectiveDeadline - 65;
    });

    if (withinEffective.length > 0) {
      onTimeCandidates = withinEffective;
    } else {
      const withinStrict = reachable.filter((d) => {
        const destArrM = getDestArrMins(d);
        return destArrM > 0 && destArrM <= deadlineMins && destArrM >= deadlineMins - 65;
      });
      if (withinStrict.length > 0) {
        onTimeCandidates = withinStrict;
      }
    }
  }

  // 3. Rimuovi le corse dominate (più lente: partono prima o uguale ma arrivano dopo un'altra corsa valida)
  const nonDominated = onTimeCandidates.filter((cand) => {
    const cDep = getDepMins(cand);
    const cArr = getDestArrMins(cand);
    const isDominated = onTimeCandidates.some((other) => {
      if (other.id === cand.id) return false;
      const oDep = getDepMins(other);
      const oArr = getDestArrMins(other);
      return oDep >= cDep && oArr <= cArr && (oDep > cDep || oArr < cArr);
    });
    return !isDominated;
  });

  const pool = nonDominated.length > 0 ? nonDominated : onTimeCandidates;

  // 4. Scelta del mezzo ottimale (soluzione più rapida, vicina ed efficiente):
  //    Tra le corse raggiungibili nella prima finestra utile dopo l'arrivo del treno o da adesso,
  //    privilegia l'arrivo anticipato a destinazione con la minore durata di viaggio e camminata a piedi.
  //    (Es. bus alle 8:47 che impiega 16m -> arrivo 9:03 vs bus alle 8:50 che impiega 10m -> arrivo 9:00:
  //    viene selezionato e suggerito quello delle 8:50 perché arriva prima a destinazione e risparmia tempo).
  const sortedPool = [...pool].sort((a, b) => getDepMins(a) - getDepMins(b));
  const firstDep = sortedPool.length > 0 ? getDepMins(sortedPool[0]) : 0;

  // Finestra di connessione utile (corse entro 25 minuti dalla prima partenza raggiungibile)
  const immediateWindow = sortedPool.filter((d) => getDepMins(d) <= firstDep + 25);
  const candidates = immediateWindow.length > 0 ? immediateWindow : sortedPool.slice(0, 4);

  const chooseBest = (list: TransitDepartureItem[]): TransitDepartureItem => {
    return list.reduce((best, curr) => {
      const bArr = getDestArrMins(best);
      const cArr = getDestArrMins(curr);
      const bWalk = (best.walkBeforeMinutes || 0) + (best.walkAfterMinutes || 0);
      const cWalk = (curr.walkBeforeMinutes || 0) + (curr.walkAfterMinutes || 0);

      // Criterio 1: Arrivo a destinazione (se differisce di almeno 2 minuti, vince chi arriva prima)
      if (cArr > 0 && bArr > 0 && Math.abs(cArr - bArr) >= 2) {
        return cArr < bArr ? curr : best;
      }

      // Criterio 2: A parità di arrivo (differenza <= 1 min), vicinanza fermata / minore camminata
      if (Math.abs(cWalk - bWalk) >= 2) {
        return cWalk < bWalk ? curr : best;
      }

      // Criterio 3: Minore durata complessiva / tempo effettivo a bordo
      if (curr.durationMinutes !== best.durationMinutes) {
        return curr.durationMinutes < best.durationMinutes ? curr : best;
      }

      // Criterio 4: Corsa diretta (meno cambi)
      if (curr.transfersCount !== best.transfersCount) {
        return curr.transfersCount < best.transfersCount ? curr : best;
      }

      // Criterio 5: Meno attesa a vuoto alla fermata di salita
      return getDepMins(curr) > getDepMins(best) ? curr : best;
    }, list[0]);
  };

  const chosen = candidates.length > 0 ? chooseBest(candidates) : departures[0];

  if (chosen) {
    chosen.isSuggested = true;
    chosen.isOptimal = true;
  }

  const idx = chosen ? departures.findIndex((d) => d.id === chosen.id) : 0;
  const optimalIndex = idx >= 0 ? idx : 0;
  if (departures[optimalIndex]) {
    departures[optimalIndex].isSuggested = true;
    departures[optimalIndex].isOptimal = true;
  }

  return {
    optimal: chosen || departures[0],
    optimalIndex,
  };
}

function buildStraightPolyline(
  points: { lat: number; lng: number }[]
): LatLngPoint[] {
  return points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}


// ── CORRIDOI STRADALI VERIFICATI PER PULLMAN E TRAM SU VIA TIBURTINA (DEVIAZIONE CANTIERE TRANVIA) ──
// Andata (Sud-Ovest verso Castro Laurenziano / Verano):
// Transito continuo sulla carreggiata laterale nord-ovest (Way 142371901 + 1330675123 + 142371900 + 31860828),
// evitando la sede centrale chiusa per i lavori della tranvia Verano-Tiburtina, senza zig-zag o tratti contromano.
export const TIBURTINA_OUTBOUND_TO_CASTRO: LatLngPoint[] = [
  // Capolinea bus Stazione Tiburtina (Piazzale della Stazione Tiburtina)
  { latitude: 41.909550, longitude: 12.530377 },
  { latitude: 41.909650, longitude: 12.530050 },
  { latitude: 41.909454, longitude: 12.529797 },
  { latitude: 41.909290, longitude: 12.529830 },
  { latitude: 41.908970, longitude: 12.529677 },
  { latitude: 41.908787, longitude: 12.529303 },
  { latitude: 41.908703, longitude: 12.529090 },
  { latitude: 41.908615, longitude: 12.528888 },
  { latitude: 41.908585, longitude: 12.528822 },
  // Curva attraverso Piazza delle Crociate verso l'immissione su Via Tiburtina
  { latitude: 41.908530, longitude: 12.528150 },
  { latitude: 41.908480, longitude: 12.527450 },
  { latitude: 41.908400, longitude: 12.526800 },
  { latitude: 41.908220, longitude: 12.526250 },
  // Fermata Tiburtina / Crociate (banchina laterale ordinaria)
  { latitude: 41.908035, longitude: 12.525917 },
  // Carreggiata laterale nord-ovest di Via Tiburtina (Way 142371901)
  { latitude: 41.907991, longitude: 12.525408 },
  { latitude: 41.907954, longitude: 12.525295 },
  { latitude: 41.907927, longitude: 12.525210 },
  { latitude: 41.907901, longitude: 12.525127 },
  { latitude: 41.907869, longitude: 12.525035 },
  { latitude: 41.907833, longitude: 12.524936 },
  { latitude: 41.907794, longitude: 12.524842 },
  { latitude: 41.907682, longitude: 12.524577 },
  { latitude: 41.907618, longitude: 12.524440 },
  { latitude: 41.907548, longitude: 12.524303 },
  { latitude: 41.907433, longitude: 12.524105 },
  { latitude: 41.907310, longitude: 12.523907 },
  { latitude: 41.907150, longitude: 12.523672 },
  { latitude: 41.907026, longitude: 12.523494 },
  { latitude: 41.906890, longitude: 12.523314 },
  { latitude: 41.906765, longitude: 12.523160 },
  { latitude: 41.906630, longitude: 12.523004 },
  { latitude: 41.906499, longitude: 12.522865 },
  { latitude: 41.906370, longitude: 12.522728 },
  // Fermata Tiburtina / Valerio Massimo (banchina laterale ordinaria)
  { latitude: 41.905884, longitude: 12.522221 },
  // Prosecuzione su viabilità laterale nord-ovest (Way 1330675123 + 142371900 + 31860828)
  { latitude: 41.905799, longitude: 12.522134 },
  { latitude: 41.905350, longitude: 12.521657 },
  { latitude: 41.904697, longitude: 12.521016 },
  { latitude: 41.904408, longitude: 12.520742 },
  { latitude: 41.904052, longitude: 12.520436 },
  // Fermata Tiburtina / Castro Laurenziano (banchina laterale sul marciapiede davanti Via del Castro Laurenziano)
  { latitude: 41.903932, longitude: 12.520330 },
];

export const TIBURTINA_OUTBOUND_TO_VERANO: LatLngPoint[] = [
  ...TIBURTINA_OUTBOUND_TO_CASTRO,
  { latitude: 41.903859, longitude: 12.520286 },
  { latitude: 41.903567, longitude: 12.520106 },
  { latitude: 41.903187, longitude: 12.519780 },
  { latitude: 41.902640, longitude: 12.519320 },
  { latitude: 41.902190, longitude: 12.518908 }, // Piazzale del Verano
];

// Ritorno (Nord-Est verso Stazione Tiburtina):
// Transito continuo sulla carreggiata laterale sud-est (Way 23036876 + 51081970 + 122080729 + 1448323550)
export const TIBURTINA_INBOUND_FROM_CASTRO: LatLngPoint[] = [
  // Fermata Tiburtina / Castro Laurenziano (ritorno su carreggiata laterale sud-est)
  { latitude: 41.903813, longitude: 12.520513 },
  { latitude: 41.904057, longitude: 12.520715 },
  { latitude: 41.904215, longitude: 12.520850 },
  { latitude: 41.904404, longitude: 12.521016 },
  { latitude: 41.904600, longitude: 12.521198 },
  { latitude: 41.904974, longitude: 12.521568 },
  { latitude: 41.905291, longitude: 12.521893 },
  { latitude: 41.905540, longitude: 12.522163 },
  // Fermata Tiburtina / Valerio Massimo (ritorno)
  { latitude: 41.905772, longitude: 12.522396 },
  { latitude: 41.905930, longitude: 12.522562 },
  { latitude: 41.906220, longitude: 12.522871 },
  { latitude: 41.906339, longitude: 12.522997 },
  { latitude: 41.906539, longitude: 12.523211 },
  { latitude: 41.906603, longitude: 12.523283 },
  { latitude: 41.906668, longitude: 12.523357 },
  { latitude: 41.906734, longitude: 12.523444 },
  { latitude: 41.906798, longitude: 12.523527 },
  { latitude: 41.907010, longitude: 12.523810 },
  { latitude: 41.907165, longitude: 12.524040 },
  { latitude: 41.907349, longitude: 12.524346 },
  { latitude: 41.907511, longitude: 12.524656 },
  { latitude: 41.907636, longitude: 12.524942 },
  { latitude: 41.907700, longitude: 12.525112 },
  { latitude: 41.907842, longitude: 12.525546 },
  // Fermata Tiburtina / Crociate (ritorno)
  { latitude: 41.907907, longitude: 12.525800 },
  // Ingresso Piazzale Stazione Tiburtina
  { latitude: 41.908147, longitude: 12.529594 },
  { latitude: 41.908585, longitude: 12.528822 },
  { latitude: 41.908850, longitude: 12.529473 },
  { latitude: 41.909290, longitude: 12.529830 },
  { latitude: 41.909550, longitude: 12.530377 }, // Piazzale Stazione Tiburtina
];

export const TIBURTINA_INBOUND_FROM_VERANO: LatLngPoint[] = [
  { latitude: 41.902190, longitude: 12.518908 }, // Piazzale del Verano
  { latitude: 41.902640, longitude: 12.519320 },
  { latitude: 41.903187, longitude: 12.519780 },
  { latitude: 41.903567, longitude: 12.520106 },
  ...TIBURTINA_INBOUND_FROM_CASTRO,
];

// Tracciato sotterraneo reale Metro B (Tiburtina FS <-> Policlinico via Bologna)
const METRO_B_TIBURTINA_TO_POLICLINICO: LatLngPoint[] = [
  { latitude: 41.91008, longitude: 12.53062 }, // Tiburtina FS
  { latitude: 41.91120, longitude: 12.52720 },
  { latitude: 41.91260, longitude: 12.52340 },
  { latitude: 41.91340, longitude: 12.52080 }, // Stazione Bologna
  { latitude: 41.91010, longitude: 12.51620 },
  { latitude: 41.90720, longitude: 12.51310 },
  { latitude: 41.90468, longitude: 12.51052 }, // Stazione Policlinico
];
const METRO_B_POLICLINICO_TO_TIBURTINA: LatLngPoint[] = [...METRO_B_TIBURTINA_TO_POLICLINICO].reverse();

const ROUTE_BUS_310_CASTRO_TO_POLICLINICO: LatLngPoint[] = [
  { latitude: 41.903932, longitude: 12.520330 }, // Castro Laurenziano
  { latitude: 41.904200, longitude: 12.518500 }, // Regina Elena / Università
  { latitude: 41.904450, longitude: 12.514500 },
  { latitude: 41.904680, longitude: 12.510520 }, // Policlinico
];
const ROUTE_BUS_310_POLICLINICO_TO_CASTRO: LatLngPoint[] = [
  ...ROUTE_BUS_310_CASTRO_TO_POLICLINICO,
].reverse();

function getStaticFallbackDepartures(options: {
  stationName: string;
  destName: string;
  targetTime?: string;
  direction?: 'to_campus' | 'to_station';
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  constraintTime?: string;
  minDepartureTime?: string;
  isLiveContext?: boolean;
}): TransitBoardResult {
  const {
    stationName,
    destName,
    targetTime,
    direction = 'to_campus',
    stationCoords,
    targetCoords,
    constraintTime,
    minDepartureTime,
    isLiveContext = false,
  } = options;

  const normSt = (stationName || '').toLowerCase();
  const stCoords = stationCoords || resolveStationCoordinates(stationName);
  const tgCoords = targetCoords || { lat: 41.90165, lng: 12.51985 };

  const isFarFromRome =
    Math.abs(stCoords.lat - 41.9028) > 0.25 || Math.abs(stCoords.lng - 12.4964) > 0.25;
  if (isFarFromRome) {
    return {
      stationName,
      destinationName: destName,
      directLines: [],
      departures: [],
      optimalIndex: 0,
      lastUpdated: new Date().toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      isLiveSource: false,
    };
  }

  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let baseTotalMins = parseHHMMToMins(targetTime || nowStr);
  if (baseTotalMins < 0) baseTotalMins = 8 * 60 + 10;

  if (direction === 'to_campus' && minDepartureTime && !isLiveContext) {
    const trainArrM = parseHHMMToMins(minDepartureTime);
    if (trainArrM > 0) {
      baseTotalMins = trainArrM + 2;
    }
  } else if (!isLiveContext && constraintTime) {
    const deadlineM = parseHHMMToMins(constraintTime);
    if (deadlineM > 0) {
      baseTotalMins = deadlineM - 22;
    }
  }

  let directLines: string[] = ['492', '71', '163', '448', 'Metro B'];
  const departures: TransitDepartureItem[] = [];
  const isToStation = direction === 'to_station';
  const depHour = Math.floor((((baseTotalMins % 1440) + 1440) % 1440) / 60);
  const isPeakHour = (depHour >= 7 && depHour <= 9) || (depHour >= 17 && depHour <= 19);

  const buildItem = (
    id: string,
    line: string,
    mode: 'bus' | 'metro' | 'tram' | 'rail',
    headsign: string,
    fromStop: string,
    toStop: string,
    offsetMins: number,
    inVehicleMinutes: number,
    fromStopCoords: { lat: number; lng: number },
    toStopCoords: { lat: number; lng: number },
    finalDestCoords: { lat: number; lng: number },
    intermediateStops: { name: string; lat: number; lng: number }[],
    crowdingLevel: 'low' | 'medium' | 'high',
    customTransitPolyline?: LatLngPoint[],
    customAlerts?: string[],
    isDirect: boolean = true,
    transfersCount: number = 0,
    transferSummary?: string,
    legs?: TransitLegDetail[],
    transferWalkPolylines?: LatLngPoint[][]
  ): TransitDepartureItem => {
    const originCoords = isToStation ? tgCoords : stCoords;
    const realWalkBefore = calculateRealWalkMinutes(originCoords, fromStopCoords);
    const realWalkAfter = calculateRealWalkMinutes(toStopCoords, finalDestCoords);
    const walkBeforeMinutes = realWalkBefore.minutes;
    const walkAfterMinutes = realWalkAfter.minutes;

    const depM = baseTotalMins + offsetMins;
    const sched = minsToHHMM(depM);
    const alightM = depM + inVehicleMinutes;
    const alight = minsToHHMM(alightM);
    const durationMinutes = Math.max(1, inVehicleMinutes + walkAfterMinutes);
    const arr = minsToHHMM(depM + durationMinutes);

    const transitPolyline =
      customTransitPolyline && customTransitPolyline.length >= 2
        ? customTransitPolyline
        : buildStraightPolyline([
            fromStopCoords,
            ...intermediateStops.map((s) => ({ lat: s.lat, lng: s.lng })),
            toStopCoords,
          ]);
    const walkAfterPolyline =
      walkAfterMinutes > 0
        ? buildStraightPolyline([toStopCoords, finalDestCoords])
        : [];

    return {
      id,
      line,
      mode,
      headsign,
      fromStop,
      toStop,
      scheduledTime: sched,
      estimatedTime: sched,
      alightingTime: alight,
      arrivalTime: arr,
      delayMinutes: 0,
      isLive: isLiveContext,
      durationMinutes,
      totalDoorToDoorMinutes: walkBeforeMinutes + durationMinutes,
      inVehicleMinutes,
      walkingMinutes: walkBeforeMinutes + walkAfterMinutes,
      walkBeforeMinutes,
      walkAfterMinutes,
      statusType: isLiveContext ? 'on_time' : 'scheduled',
      statusLabel: isLiveContext ? 'In orario' : 'Programmata',
      alerts: customAlerts && customAlerts.length > 0 ? customAlerts : undefined,
      isDirect,
      transfersCount,
      transferSummary,
      legs,
      transferWalkPolylines,
      fromStopCoords,
      toStopCoords,
      finalDestCoords,
      finalDestinationName: isToStation ? `Stazione ${stationName}` : destName,
      intermediateStopsCount: intermediateStops.length + 1,
      intermediateStopNames: intermediateStops.map((s) => s.name),
      intermediateStopCoords: intermediateStops,
      transitPolyline,
      walkAfterPolyline,
      crowdingLevel,
      operator: mode === 'metro' ? 'ATAC Metro Roma' : 'ATAC Roma',
    };
  };

    if (normSt.includes('tiburtina')) {
    directLines = ['545', '649', '448', '71', '492', '163', 'Metro B'];
    const tiburtinaBusCoords = { lat: 41.90955, lng: 12.53038 };
    const tiburtinaMetroCoords = { lat: 41.91008, lng: 12.53062 };
    const policlinicoMetroCoords = { lat: 41.90468, lng: 12.51052 };

    const tiburtinaTramDetourAlert = [
      'Cantiere nuova tranvia Verano-Tiburtina: transito su corsie laterali della viabilità ordinaria anziché sulla sede centrale; fermate attive su banchina laterale.',
    ];
    const line71DetourAlert = [
      'Linea 71: percorso deviato su corsie laterali di Via Tiburtina e nodo Verano per cantieri della nuova tramvia.',
    ];

    // Fermate sulla viabilità laterale ordinaria nord-ovest (andata verso Castro Laurenziano / Verano)
    const castroStopCoordsOutbound = { lat: 41.903932, lng: 12.520330 };
    const veranoStopCoordsOutbound = { lat: 41.902190, lng: 12.518908 };
    const viaTiburtinaIntermediateOutbound = [
      { name: 'Tiburtina / Crociate', lat: 41.908035, lng: 12.525917 },
      { name: 'Tiburtina / Valerio Massimo', lat: 41.905884, lng: 12.522221 },
    ];

    // Fermate sulla carreggiata laterale ordinaria sud-est (ritorno verso Stazione Tiburtina)
    const castroStopCoordsInbound = { lat: 41.903813, lng: 12.520513 };
    const veranoStopCoordsInbound = { lat: 41.902190, lng: 12.518908 };
    const viaTiburtinaIntermediateInbound = [
      { name: 'Tiburtina / Valerio Massimo', lat: 41.905772, lng: 12.522396 },
      { name: 'Tiburtina / Crociate', lat: 41.907907, lng: 12.525800 },
    ];

    const isDestVerano = (destName || '').toLowerCase().includes('verano');
    const targetAlightCoords = isDestVerano ? veranoStopCoordsOutbound : castroStopCoordsOutbound;
    const targetAlightName = isDestVerano ? 'Verano' : 'Tiburtina / Castro Laurenziano';
    const outboundBusCorridor = isDestVerano ? TIBURTINA_OUTBOUND_TO_VERANO : TIBURTINA_OUTBOUND_TO_CASTRO;
    const inboundBusCorridor = isDestVerano ? TIBURTINA_INBOUND_FROM_VERANO : TIBURTINA_INBOUND_FROM_CASTRO;
    const originBoardCoords = isDestVerano ? veranoStopCoordsInbound : castroStopCoordsInbound;
    const originBoardName = isDestVerano ? 'Verano' : 'Tiburtina / Castro Laurenziano';

    if (isToStation) {
      departures.push(
        buildItem(
          'fb-ret-448',
          '448',
          'bus',
          'Balsamo Crivelli (via Staz.ne Tiburtina)',
          originBoardName,
          'Staz.ne Tiburtina (MB)',
          2,
          5,
          originBoardCoords,
          tiburtinaBusCoords,
          stCoords,
          viaTiburtinaIntermediateInbound,
          isPeakHour ? 'medium' : 'low',
          inboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-ret-71',
          '71',
          'bus',
          'Staz.ne Tiburtina (MB)',
          originBoardName,
          'Staz.ne Tiburtina (MB)',
          5,
          5,
          originBoardCoords,
          tiburtinaBusCoords,
          stCoords,
          viaTiburtinaIntermediateInbound,
          isPeakHour ? 'medium' : 'low',
          inboundBusCorridor,
          line71DetourAlert
        ),
        buildItem(
          'fb-ret-492',
          '492',
          'bus',
          'Staz.ne Tiburtina (MB)',
          originBoardName,
          'Staz.ne Tiburtina (MB)',
          8,
          5,
          originBoardCoords,
          tiburtinaBusCoords,
          stCoords,
          viaTiburtinaIntermediateInbound,
          isPeakHour ? 'medium' : 'low',
          inboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-ret-163',
          '163',
          'bus',
          'Rebibbia (via Staz.ne Tiburtina)',
          originBoardName,
          'Staz.ne Tiburtina (MB)',
          11,
          5,
          originBoardCoords,
          tiburtinaBusCoords,
          stCoords,
          viaTiburtinaIntermediateInbound,
          isPeakHour ? 'medium' : 'low',
          inboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-ret-mb',
          'Metro B',
          'metro',
          'Rebibbia / Jonio',
          'Policlinico (Metro B)',
          'Tiburtina FS (Metro B)',
          13,
          4,
          policlinicoMetroCoords,
          tiburtinaMetroCoords,
          stCoords,
          [{ name: 'Bologna', lat: 41.9134, lng: 12.5208 }],
          isPeakHour ? 'high' : 'medium',
          METRO_B_POLICLINICO_TO_TIBURTINA
        ),
        buildItem(
          'fb-ret-transfer-1',
          '310 + Metro B',
          'bus',
          'Termini / Vescovio (cambio Policlinico)',
          originBoardName,
          'Tiburtina FS (Metro B)',
          15,
          7,
          originBoardCoords,
          tiburtinaMetroCoords,
          stCoords,
          [],
          isPeakHour ? 'medium' : 'low',
          undefined,
          undefined,
          false,
          1,
          'Bus 310 ➔ Metro B',
          [
            {
              line: '310',
              mode: 'bus',
              headsign: 'Vescovio',
              fromStop: originBoardName,
              toStop: 'Policlinico (Metro B)',
              durationMinutes: 3,
              intermediateStopsCount: 1,
              intermediateStopNames: ['Regina Elena / Università'],
              fromStopCoords: originBoardCoords,
              toStopCoords: { lat: 41.9042, lng: 12.5185 },
              polyline: ROUTE_BUS_310_CASTRO_TO_POLICLINICO,
            },
            {
              line: 'Metro B',
              mode: 'metro',
              headsign: 'Rebibbia / Jonio',
              fromStop: 'Policlinico (Metro B)',
              toStop: 'Tiburtina FS (Metro B)',
              durationMinutes: 4,
              intermediateStopsCount: 1,
              intermediateStopNames: ['Bologna'],
              fromStopCoords: policlinicoMetroCoords,
              toStopCoords: tiburtinaMetroCoords,
              polyline: METRO_B_POLICLINICO_TO_TIBURTINA,
            },
          ],
          [
            [
              { latitude: 41.9042, longitude: 12.5185 },
              { latitude: 41.90468, longitude: 12.51052 },
            ],
          ]
        )
      );
    } else {
      departures.push(
        buildItem(
          'fb-out-448',
          '448',
          'bus',
          'Verano',
          'Staz.ne Tiburtina (MB)',
          targetAlightName,
          2,
          4,
          tiburtinaBusCoords,
          targetAlightCoords,
          tgCoords,
          viaTiburtinaIntermediateOutbound,
          isPeakHour ? 'medium' : 'low',
          outboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-out-71',
          '71',
          'bus',
          'L.go Chigi',
          'Staz.ne Tiburtina (MB)',
          targetAlightName,
          4,
          4,
          tiburtinaBusCoords,
          targetAlightCoords,
          tgCoords,
          viaTiburtinaIntermediateOutbound,
          isPeakHour ? 'medium' : 'low',
          outboundBusCorridor,
          line71DetourAlert
        ),
        buildItem(
          'fb-out-492',
          '492',
          'bus',
          'Staz.ne Metro Cipro (MA)',
          'Staz.ne Tiburtina (MB)',
          targetAlightName,
          7,
          4,
          tiburtinaBusCoords,
          targetAlightCoords,
          tgCoords,
          viaTiburtinaIntermediateOutbound,
          isPeakHour ? 'medium' : 'low',
          outboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-out-163',
          '163',
          'bus',
          'Verano',
          'Staz.ne Tiburtina (MB)',
          targetAlightName,
          9,
          4,
          tiburtinaBusCoords,
          targetAlightCoords,
          tgCoords,
          viaTiburtinaIntermediateOutbound,
          isPeakHour ? 'medium' : 'low',
          outboundBusCorridor,
          tiburtinaTramDetourAlert
        ),
        buildItem(
          'fb-out-mb',
          'Metro B',
          'metro',
          'Laurentina',
          'Tiburtina FS (Metro B)',
          'Policlinico (Metro B)',
          12,
          4,
          tiburtinaMetroCoords,
          policlinicoMetroCoords,
          tgCoords,
          [{ name: 'Bologna', lat: 41.9134, lng: 12.5208 }],
          isPeakHour ? 'high' : 'medium',
          METRO_B_TIBURTINA_TO_POLICLINICO
        ),
        buildItem(
          'fb-out-transfer-1',
          'Metro B + 310',
          'metro',
          'Laurentina (cambio Policlinico)',
          'Tiburtina FS (Metro B)',
          'Regina Elena / Castro Laurenziano',
          14,
          7,
          tiburtinaMetroCoords,
          { lat: 41.9042, lng: 12.5185 },
          tgCoords,
          [],
          isPeakHour ? 'medium' : 'low',
          METRO_B_TIBURTINA_TO_POLICLINICO,
          undefined,
          false,
          1,
          'Metro B ➔ Bus 310',
          [
            {
              line: 'Metro B',
              mode: 'metro',
              headsign: 'Laurentina',
              fromStop: 'Tiburtina FS (Metro B)',
              toStop: 'Policlinico (Metro B)',
              durationMinutes: 4,
              intermediateStopsCount: 1,
              intermediateStopNames: ['Bologna'],
              fromStopCoords: tiburtinaMetroCoords,
              toStopCoords: policlinicoMetroCoords,
              polyline: METRO_B_TIBURTINA_TO_POLICLINICO,
            },
            {
              line: '310',
              mode: 'bus',
              headsign: 'Termini (MA-MB-FS)',
              fromStop: 'Policlinico (Metro B)',
              toStop: 'Regina Elena / Castro Laurenziano',
              durationMinutes: 3,
              intermediateStopsCount: 1,
              intermediateStopNames: ['Regina Elena / Università'],
              fromStopCoords: { lat: 41.9042, lng: 12.5185 },
              toStopCoords: tgCoords,
              polyline: ROUTE_BUS_310_POLICLINICO_TO_CASTRO,
            },
          ],
          [
            [
              { latitude: 41.90468, longitude: 12.51052 },
              { latitude: 41.9042, longitude: 12.5185 },
            ],
          ]
        )
      );
    }
  } else {
    directLines = ['310', '492', '71', 'Metro B'];
    departures.push(
      buildItem(
        'fb-gen-1',
        '492',
        'bus',
        isToStation ? `Staz.ne ${stationName}` : 'Staz.ne Metro Cipro (MA)',
        isToStation ? 'Università / De Lollis' : `${stationName} (Capolinea Bus)`,
        isToStation ? `${stationName} (Piazzale FS)` : 'Università / Castro Laurenziano',
        3,
        8,
        isToStation ? tgCoords : stCoords,
        isToStation ? stCoords : tgCoords,
        isToStation ? stCoords : tgCoords,
        [],
        'low'
      )
    );
  }

  const { optimal, optimalIndex } = findOptimalTransitDeparture(departures, {
    direction,
    isLiveContext,
    constraintTime,
    minDepartureTime,
    targetTime,
  });

  return {
    stationName,
    destinationName: destName,
    directLines,
    departures,
    optimalDeparture: optimal,
    optimalIndex,
    lastUpdated: new Date().toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    isLiveSource: isLiveContext,
  };
}

const transitBoardMemoryCache = new Map<
  string,
  { timestamp: number; data: TransitBoardResult }
>();
const inFlightBoardRequests = new Map<string, Promise<TransitBoardResult>>();

function inferCorridorIntermediateStops(
  fromName: string,
  toName: string,
  mode: string
): { names: string[]; coords: { name: string; lat: number; lng: number }[] } {
  const normFrom = (fromName || '').toLowerCase();
  const normTo = (toName || '').toLowerCase();

  // Corridoio Via Tiburtina <-> Castro Laurenziano / Verano (qualsiasi bus urbano)
  const isTib = normFrom.includes('tiburtina') || normTo.includes('tiburtina');
  const isCastroOrVerano =
    normFrom.includes('castro') || normTo.includes('castro') ||
    normFrom.includes('verano') || normTo.includes('verano');

  if (isTib && isCastroOrVerano && mode !== 'subway' && mode !== 'metro') {
    const isOutbound = normTo.includes('castro') || normTo.includes('verano');
    const stops = isOutbound
      ? [
          { name: 'Tiburtina / Crociate', lat: 41.908035, lng: 12.525917 },
          { name: 'Tiburtina / Valerio Massimo', lat: 41.905884, lng: 12.522221 },
        ]
      : [
          { name: 'Tiburtina / Valerio Massimo', lat: 41.905772, lng: 12.522396 },
          { name: 'Tiburtina / Crociate', lat: 41.907907, lng: 12.525800 },
        ];
    return { names: stops.map((s) => s.name), coords: stops };
  }

  // Corridoio Tiburtina <-> Catania / Cremona (Linee 490, 495, 649)
  const isCatania = normFrom.includes('catania') || normTo.includes('catania') ||
                    normFrom.includes('cremona') || normTo.includes('cremona');
  if (isTib && isCatania && mode !== 'subway' && mode !== 'metro') {
    const isOutbound = normTo.includes('catania') || normTo.includes('cremona');
    const stops = isOutbound
      ? [
          { name: 'Crociate', lat: 41.90825, lng: 12.52591 },
          { name: 'Lega Lombarda / Provincie', lat: 41.90750, lng: 12.52210 },
        ]
      : [
          { name: 'Lega Lombarda / Provincie', lat: 41.90750, lng: 12.52210 },
          { name: 'Crociate', lat: 41.90825, lng: 12.52591 },
        ];
    return { names: stops.map((s) => s.name), coords: stops };
  }

  // Metro B Tiburtina <-> Policlinico
  const isPoliclinico = normFrom.includes('policlinico') || normTo.includes('policlinico');
  if (isTib && isPoliclinico && (mode === 'subway' || mode === 'metro')) {
    const stop = [{ name: 'Bologna', lat: 41.9135, lng: 12.5218 }];
    return { names: stop.map((s) => s.name), coords: stop };
  }

  // Bus 310 Policlinico <-> Castro Laurenziano
  if (isPoliclinico && (normTo.includes('castro') || normFrom.includes('castro'))) {
    const stop = [{ name: 'Regina Elena / Università', lat: 41.9042, lng: 12.5185 }];
    return { names: stop.map((s) => s.name), coords: stop };
  }

  return { names: [], coords: [] };
}

/**
 * Interroga Transitous / GTFS-RT calcolando percorsi reali (camminata + mezzo + camminata),
 * geometrie complete per la mappa, direzioni corrette per linee circolari e l'ultimo mezzo utile.
 */
export async function getStationTransitBoard(options: {
  stationName: string;
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  targetName?: string;
  targetDate?: string;
  targetTime?: string;
  direction?: 'to_campus' | 'to_station';
  isLiveContext?: boolean;
  constraintTime?: string;
  minDepartureTime?: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<TransitBoardResult> {
  const {
    stationName,
    stationCoords: providedStCoords,
    targetCoords: providedTgCoords,
    targetName = 'Destinazione',
    targetDate,
    targetTime,
    direction = 'to_campus',
    isLiveContext = false,
    constraintTime,
    minDepartureTime,
    forceRefresh = false,
    signal,
  } = options;

  const stCoords = providedStCoords || resolveStationCoordinates(stationName);

  let tgCoords = providedTgCoords;
  if (!tgCoords && targetName) {
    const rc = resolveClassroom(targetName);
    if (rc.latitude && rc.longitude) {
      tgCoords = { lat: rc.latitude, lng: rc.longitude };
    }
  }
  if (!tgCoords) {
    tgCoords = { lat: 41.90561, lng: 12.51786 };
  }

  const originLat = direction === 'to_station' ? tgCoords.lat : stCoords.lat;
  const originLng = direction === 'to_station' ? tgCoords.lng : stCoords.lng;
  const destLat = direction === 'to_station' ? stCoords.lat : tgCoords.lat;
  const destLng = direction === 'to_station' ? stCoords.lng : tgCoords.lng;

  const cacheKey = `${direction}|${originLat.toFixed(4)},${originLng.toFixed(4)}|${destLat.toFixed(4)},${destLng.toFixed(4)}|${targetDate || 'today'}|${targetTime || ''}|${constraintTime || ''}|${minDepartureTime || ''}|${isLiveContext ? 'live' : 'sched'}`;

  if (!forceRefresh) {
    const cached = transitBoardMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 45000) {
      return cached.data;
    }
    const inFlight = inFlightBoardRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const executeRequest = async (): Promise<TransitBoardResult> => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const constraintMins = parseHHMMToMins(constraintTime);
    const minDepMins = parseHHMMToMins(minDepartureTime);

    // Determina la strategia di interrogazione:
    // - In ANDATA (to_campus): la lista nella card "Mezzi" mostra i primi pullman/metro in partenza subito dopo l'arrivo del treno (o da adesso se già in stazione),
    //   mentre la card esterna della tappa usa anche la query arriveBy sulla lezione per riportare l'ultimo mezzo utile per arrivare in tempo.
    // - Nel RITORNO (to_station): mostra le corse che permettono di arrivare in stazione in tempo per il treno (arriveBy).
    let useArriveBy = false;
    let queryTimeForApi = targetTime;

    if (!isLiveContext) {
      if (direction === 'to_station' && constraintMins > 0) {
        // Arrivare in stazione almeno 2 minuti prima della partenza del treno
        queryTimeForApi = minsToHHMM(constraintMins - 2);
        useArriveBy = true;
      } else if (direction === 'to_campus' && minDepMins > 0) {
        // In andata mostra sempre i primi mezzi subito dopo l'arrivo del treno in stazione
        queryTimeForApi = minsToHHMM(minDepMins);
        useArriveBy = false;
      } else if (direction === 'to_campus' && constraintMins > 0) {
        queryTimeForApi = minsToHHMM(constraintMins);
        useArriveBy = true;
      }
    } else {
      if (direction === 'to_station' && constraintMins > nowMins + 15) {
        queryTimeForApi = minsToHHMM(constraintMins - 2);
        useArriveBy = true;
      } else if (direction === 'to_campus' && minDepMins > nowMins + 2) {
        // Il treno non è ancora arrivato alla stazione di Roma: interroga subito dopo l'arrivo del treno
        queryTimeForApi = minsToHHMM(minDepMins);
        useArriveBy = false;
      } else {
        queryTimeForApi = 'now';
        useArriveBy = false;
      }
    }

    const queryIso = buildQueryIsoTime(
      isLiveContext && queryTimeForApi === 'now' ? undefined : targetDate,
      queryTimeForApi
    );
    const planUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${originLat.toFixed(5)},${originLng.toFixed(5)}&toPlace=${destLat.toFixed(5)},${destLng.toFixed(5)}&time=${encodeURIComponent(queryIso)}${useArriveBy ? '&arriveBy=true' : ''}&numItineraries=30`;

    // In andata, se la lezione inizia più avanti rispetto all'arrivo del treno, interroga in parallelo anche con arriveBy=true
    // sull'inizio della lezione: così la lista parte dai primi mezzi subito dopo il treno e include fino all'ultimo mezzo utile per arrivare in tempo.
    const secondaryDepUrl =
      !useArriveBy &&
      direction === 'to_campus' &&
      constraintMins > 0 &&
      minDepMins > 0 &&
      constraintMins > minDepMins + 12
        ? `https://api.transitous.org/api/v5/plan?fromPlace=${originLat.toFixed(5)},${originLng.toFixed(5)}&toPlace=${destLat.toFixed(5)},${destLng.toFixed(5)}&time=${encodeURIComponent(
            buildQueryIsoTime(targetDate, minsToHHMM(constraintMins))
          )}&arriveBy=true&numItineraries=30`
        : null;

    try {
      const controller = new AbortController();
      // Timeout esteso a 15s per consentire il calcolo interregionale su grafi complessi
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const onExternalAbort = () => controller.abort();
      if (signal) {
        signal.addEventListener('abort', onExternalAbort);
      }

      const reqHeaders = {
        'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
        Accept: 'application/json',
      };

      const [res, secRes] = await Promise.all([
        fetch(planUrl, {
          signal: controller.signal,
          headers: reqHeaders,
        }),
        secondaryDepUrl
          ? fetch(secondaryDepUrl, {
              signal: controller.signal,
              headers: reqHeaders,
            }).catch(() => null)
          : Promise.resolve(null),
      ]);

      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }

      if (!res.ok) {
        throw new Error(`Transitous API response status ${res.status}`);
      }

      const data = await res.json();
      const primaryItineraries: any[] = Array.isArray(data?.itineraries) ? data.itineraries : [];
      let secondaryItineraries: any[] = [];
      if (secRes && secRes.ok) {
        try {
          const secData = await secRes.json();
          if (Array.isArray(secData?.itineraries)) {
            secondaryItineraries = secData.itineraries;
          }
        } catch {
          // Ignora errore opzionale sulla query secondaria
        }
      }
      const itineraries: any[] = [...primaryItineraries, ...secondaryItineraries];

      if (itineraries.length === 0) {
        const isFarFromRome =
          Math.abs(originLat - 41.9028) > 0.25 || Math.abs(originLng - 12.4964) > 0.25;
        if (isFarFromRome) {
          return {
            stationName,
            destinationName: targetName,
            directLines: [],
            departures: [],
            optimalIndex: 0,
            lastUpdated: new Date().toLocaleTimeString('it-IT', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            isLiveSource: false,
          };
        }
        return getStaticFallbackDepartures({
          stationName,
          destName: targetName,
          targetTime,
          direction,
          stationCoords: stCoords,
          targetCoords: tgCoords,
          constraintTime,
          minDepartureTime,
          isLiveContext,
        });
      }

      const pendingItems: {
        primaryLeg: any;
        draft: Omit<TransitDepartureItem, 'headsign'>;
      }[] = [];
      const directLinesSet = new Set<string>();
      const seenTripIds = new Set<string>();

      for (const [itinIdx, it] of itineraries.entries()) {
        const legs: any[] = Array.isArray(it.legs) ? it.legs : [];
        const firstTransitIdx = legs.findIndex((l) => l.mode !== 'WALK');
        if (firstTransitIdx === -1) continue;

        let lastTransitIdx = firstTransitIdx;
        for (let i = legs.length - 1; i >= firstTransitIdx; i--) {
          if (legs[i].mode !== 'WALK') {
            lastTransitIdx = i;
            break;
          }
        }

        const transitLegs = legs.filter((l) => l.mode !== 'WALK');
        const primaryLeg = transitLegs[0];
        const lastTransitLeg = transitLegs[transitLegs.length - 1];

        const lineShort = (
          primaryLeg.routeShortName ||
          primaryLeg.displayName ||
          primaryLeg.route ||
          ''
        ).trim();
        if (!lineShort) continue;

        const tripKey = `${lineShort}_${primaryLeg.startTime}_${primaryLeg.to?.name || ''}`;
        if (seenTripIds.has(tripKey)) continue;
        seenTripIds.add(tripKey);

        const isDirect = transitLegs.length === 1;

        const mode = normalizeMode(primaryLeg.mode, primaryLeg.routeType);
        const schedDep = formatIsoToHHMM(primaryLeg.scheduledStartTime || primaryLeg.startTime);
        const estDep = formatIsoToHHMM(primaryLeg.startTime);
        const alightTime = formatIsoToHHMM(lastTransitLeg.endTime || primaryLeg.endTime);

        const rawFromCoords =
          primaryLeg.from?.lat && primaryLeg.from?.lon
            ? { lat: primaryLeg.from.lat, lng: primaryLeg.from.lon }
            : { lat: originLat, lng: originLng };
        const fromStopCoords = snapStopToRoadway(primaryLeg.from?.name, rawFromCoords);

        const rawToCoords =
          lastTransitLeg.to?.lat && lastTransitLeg.to?.lon
            ? { lat: lastTransitLeg.to.lat, lng: lastTransitLeg.to.lon }
            : { lat: destLat, lng: destLng };
        const toStopCoords = snapStopToRoadway(lastTransitLeg.to?.name, rawToCoords);

        const finalDestCoords = { lat: destLat, lng: destLng };
        const originCoords = { lat: originLat, lng: originLng };

        const rawIntermediate: any[] = Array.isArray(primaryLeg.intermediateStops)
          ? primaryLeg.intermediateStops
          : [];
        const intermediateStopCoords = rawIntermediate
          .filter((s) => s?.name && typeof s.lat === 'number' && typeof s.lon === 'number')
          .map((s) => {
            const snapped = snapStopToRoadway(s.name, { lat: s.lat, lng: s.lon });
            return {
              name: formatStopDisplayName(s.name),
              lat: snapped.lat,
              lng: snapped.lng,
            };
          });
        let intermediateStopNames = intermediateStopCoords.map((s) => s.name);
        if (intermediateStopNames.length === 0) {
          const inferred = inferCorridorIntermediateStops(
            primaryLeg.from?.name || '',
            lastTransitLeg.to?.name || '',
            (primaryLeg.mode || '').toLowerCase()
          );
          if (inferred.coords.length > 0) {
            intermediateStopCoords.push(...inferred.coords);
            intermediateStopNames = inferred.names;
          }
        }
        const intermediateStopsCount = intermediateStopNames.length + 1;

        // Decodifica le polilinee reali del mezzo e dei tratti a piedi
        const rawTransitPolyline: LatLngPoint[] = [];
        for (const tl of transitLegs) {
          const pts = decodeEncodedPolyline(
            tl.legGeometry?.points,
            tl.legGeometry?.precision || 6
          );
          rawTransitPolyline.push(...pts);
        }
        const transitPolyline = resolveOptimizedTransitPolyline(
          primaryLeg.from?.name || '',
          lastTransitLeg.to?.name || '',
          fromStopCoords,
          toStopCoords,
          rawTransitPolyline
        );

        const walkBeforeLegs = legs.slice(0, firstTransitIdx);
        const walkBeforePolyline: LatLngPoint[] = [];
        for (const wl of walkBeforeLegs) {
          const pts = decodeEncodedPolyline(
            wl.legGeometry?.points,
            wl.legGeometry?.precision || 6
          );
          walkBeforePolyline.push(...pts);
        }

        const walkAfterLegs = legs.slice(lastTransitIdx + 1);
        const walkAfterPolyline: LatLngPoint[] = [];
        for (const wl of walkAfterLegs) {
          const pts = decodeEncodedPolyline(
            wl.legGeometry?.points,
            wl.legGeometry?.precision || 6
          );
          walkAfterPolyline.push(...pts);
        }

        // Calcolo verificato della camminata reale (4.5 km/h, 75 m/min con fattore rete pedonale urbana)
        const realWalkBefore = calculateRealWalkMinutes(originCoords, fromStopCoords, walkBeforePolyline);
        const realWalkAfter = calculateRealWalkMinutes(toStopCoords, finalDestCoords);

        const walkBeforeSec = walkBeforeLegs.reduce(
          (acc, l) => acc + (typeof l.duration === 'number' ? l.duration : 0),
          0
        );
        const apiBeforeMin = Math.round(walkBeforeSec / 60);
        const walkBeforeMinutes =
          apiBeforeMin > 0 && Math.abs(apiBeforeMin - realWalkBefore.minutes) <= 1
            ? apiBeforeMin
            : realWalkBefore.minutes;

        // 2) Tragitto a bordo del mezzo fino alla fermata di discesa (inVehicle)
        const transitStartMs = new Date(primaryLeg.startTime).getTime();
        const transitEndMs = new Date(lastTransitLeg.endTime || primaryLeg.endTime).getTime();
        const inVehicleMinutes =
          !isNaN(transitStartMs) && !isNaN(transitEndMs) && transitEndMs > transitStartMs
            ? Math.max(1, Math.round((transitEndMs - transitStartMs) / 60000))
            : Math.max(1, Math.round((primaryLeg.duration || 420) / 60));

        // 3) Camminata dalla fermata di discesa fino alla destinazione finale (walkAfter)
        const walkAfterSec = walkAfterLegs.reduce(
          (acc, l) => acc + (typeof l.duration === 'number' ? l.duration : 0),
          0
        );
        const apiAfterMin = Math.round(walkAfterSec / 60);
        // Se l'API restituisce un percorso pedonale con deviazioni anomale (> 2 min di scarto rispetto alla distanza stradale reale), usa il calcolo stradale verificato
        const walkAfterMinutes =
          apiAfterMin > 0 && Math.abs(apiAfterMin - realWalkAfter.minutes) <= 2
            ? apiAfterMin
            : realWalkAfter.minutes;

        // Durata effettiva dal momento in cui parte il mezzo fino all'arrivo a destinazione (aula o stazione)
        const durationMinutes = Math.max(1, inVehicleMinutes + walkAfterMinutes);
        const totalDoorToDoorMinutes = Math.max(
          durationMinutes,
          walkBeforeMinutes + durationMinutes
        );

        const activeDepTimeStr = isLiveContext ? estDep : schedDep;
        const activeDepMins = parseHHMMToMins(activeDepTimeStr);
        const arrivalTime =
          activeDepMins >= 0
            ? minsToHHMM(activeDepMins + durationMinutes)
            : formatIsoToHHMM(it.endTime || lastTransitLeg.endTime);

        const delaySec =
          typeof primaryLeg.departureDelay === 'number' ? primaryLeg.departureDelay : 0;
        const delayMins = Math.round(delaySec / 60);
        // Rileva se la corsa dispone effettivamente di dati in tempo reale via feed satellitare GTFS-RT
        const isRealtimeFeed =
          primaryLeg.realTime === true || primaryLeg.departureTimestampReason === 'REALTIME';
        const isLive = isRealtimeFeed;

        let statusType: TransitDepartureItem['statusType'] = 'scheduled';
        let statusLabel = 'Programmata';

        if (primaryLeg.cancelled) {
          statusType = 'cancelled';
          statusLabel = 'Cancellata';
        } else if (isRealtimeFeed) {
          if (delayMins > 1) {
            statusType = 'delayed';
            statusLabel = `In ritardo (+${delayMins}m)`;
          } else {
            statusType = 'on_time';
            statusLabel = 'In orario';
          }
        }

        const alertMsgs: string[] = [];
        if (Array.isArray(primaryLeg.alerts)) {
          for (const al of primaryLeg.alerts) {
            const header = (al.headerText || '').trim();
            const desc = (al.descriptionText || '').replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim();
            const combined = header && desc && !desc.startsWith(header)
              ? `${header}: ${desc}`
              : header || desc;
            if (combined && !alertMsgs.includes(combined)) {
              alertMsgs.push(combined);
            }
          }
        }

        // Rilevamento deviazioni per cantieri attivi (es. lavori nuova tranvia Verano-Tiburtina e Circonvallazione Verano)
        const fNorm = (primaryLeg.from?.name || '').toLowerCase();
        const tNorm = (lastTransitLeg.to?.name || '').toLowerCase();
        const isTiburtinaCorridor =
          (fNorm.includes('tiburtina') || tNorm.includes('tiburtina')) &&
          (tNorm.includes('castro') ||
            tNorm.includes('laurenziano') ||
            tNorm.includes('verano') ||
            tNorm.includes('valerio') ||
            tNorm.includes('crociate') ||
            fNorm.includes('castro') ||
            fNorm.includes('verano'));

        if (
          isTiburtinaCorridor &&
          ['71', '163', '448', '492', '545', 'c3'].includes(lineShort.toLowerCase())
        ) {
          const detourMsg =
            lineShort === '71'
              ? 'Linea 71: percorso deviato su corsie laterali di Via Tiburtina e nodo Verano per cantieri della nuova tranvia.'
              : 'Cantiere nuova tranvia Verano-Tiburtina: transito su corsie laterali della viabilità ordinaria anziché sulla sede centrale; fermate attive su banchina laterale.';
          if (
            !alertMsgs.some(
              (m) =>
                m.toLowerCase().includes('tranvia') ||
                m.toLowerCase().includes('cantiere') ||
                m.toLowerCase().includes('corsie laterali')
            )
          ) {
            alertMsgs.unshift(detourMsg);
          }
        }

        const depHour = parseInt((isLiveContext ? estDep : schedDep).split(':')[0], 10);
        const isPeakHour =
          !isNaN(depHour) && ((depHour >= 7 && depHour <= 9) || (depHour >= 17 && depHour <= 19));
        const crowdingLevel: 'low' | 'medium' | 'high' = isPeakHour
          ? mode === 'metro'
            ? 'high'
            : 'medium'
          : 'low';

        const transferLegDetails: TransitLegDetail[] = transitLegs.map((tl) => {
          const tlMode: 'bus' | 'metro' | 'tram' | 'rail' =
            tl.mode === 'SUBWAY' || tl.mode === 'METRO'
              ? 'metro'
              : tl.mode === 'TRAM'
              ? 'tram'
              : tl.mode === 'RAIL'
              ? 'rail'
              : 'bus';
          const tlLine = tl.routeShortName || (tlMode === 'metro' ? 'Metro B' : 'Bus');
          const startD = tl.startTime ? new Date(tl.startTime) : null;
          const endD = tl.endTime ? new Date(tl.endTime) : null;
          const startM = startD && !isNaN(startD.getTime()) ? startD.getHours() * 60 + startD.getMinutes() : -1;
          const endM = endD && !isNaN(endD.getTime()) ? endD.getHours() * 60 + endD.getMinutes() : -1;
          const dur = typeof tl.duration === 'number' && tl.duration > 0
            ? Math.max(1, Math.round(tl.duration / 60))
            : endM >= 0 && startM >= 0 && endM > startM ? endM - startM : 5;
          let intStops = Array.isArray(tl.intermediateStops)
            ? tl.intermediateStops.filter((s: any) => s?.name).map((s: any) => formatStopDisplayName(s.name))
            : [];
          if (intStops.length === 0) {
            const inferred = inferCorridorIntermediateStops(
              tl.from?.name || '',
              tl.to?.name || '',
              (tl.mode || '').toLowerCase()
            );
            if (inferred.names.length > 0) {
              intStops = inferred.names;
            }
          }
          const legPts = decodeEncodedPolyline(
            tl.legGeometry?.points,
            tl.legGeometry?.precision || 6
          );
          return {
            line: tlLine,
            mode: tlMode,
            headsign: formatStopDisplayName(tl.headsign || ''),
            fromStop: formatStopDisplayName(tl.from?.name || ''),
            toStop: formatStopDisplayName(tl.to?.name || ''),
            fromStopCoords: tl.from && typeof tl.from.lat === 'number' ? { lat: tl.from.lat, lng: tl.from.lon } : undefined,
            toStopCoords: tl.to && typeof tl.to.lat === 'number' ? { lat: tl.to.lat, lng: tl.to.lon } : undefined,
            departureTime: startM >= 0 ? minsToHHMM(startM) : undefined,
            arrivalTime: endM >= 0 ? minsToHHMM(endM) : undefined,
            durationMinutes: dur,
            intermediateStopsCount: intStops.length,
            intermediateStopNames: intStops.length > 0 ? intStops : undefined,
            polyline: legPts.length >= 2 ? legPts : undefined,
          };
        });

        // Estrai i tratti a piedi di interscambio tra un mezzo e l'altro
        const transferWalkPolylines: LatLngPoint[][] = [];
        for (let i = firstTransitIdx + 1; i < lastTransitIdx; i++) {
          const l = legs[i];
          if (l.mode === 'WALK') {
            const pts = decodeEncodedPolyline(l.legGeometry?.points, l.legGeometry?.precision || 6);
            if (pts.length >= 2) {
              transferWalkPolylines.push(pts);
            } else if (l.from?.lat && l.to?.lat) {
              transferWalkPolylines.push([
                { latitude: l.from.lat, longitude: l.from.lon },
                { latitude: l.to.lat, longitude: l.to.lon },
              ]);
            }
          }
        }

        const transferSummaryStr = transitLegs
          .map((tl) => {
            const isSub = tl.mode === 'SUBWAY' || tl.mode === 'METRO';
            const name = tl.routeShortName || '';
            if (isSub) {
              return name.toLowerCase().includes('metro') ? name : `Metro ${name || 'B'}`.trim();
            }
            return name ? `Bus ${name}` : 'Bus';
          })
          .join(' ➔ ');

        pendingItems.push({
          primaryLeg,
          draft: {
            id: `transitous-${itinIdx}-${tripKey}`,
            line: !isDirect
              ? transitLegs.map((tl) => tl.routeShortName).filter(Boolean).join(' + ') || lineShort
              : lineShort,
            mode,
            fromStop: formatStopDisplayName(
              primaryLeg.from?.name || (direction === 'to_station' ? targetName : stationName)
            ),
            toStop: formatStopDisplayName(
              lastTransitLeg.to?.name || (direction === 'to_station' ? stationName : targetName)
            ),
            scheduledTime: schedDep,
            estimatedTime: estDep,
            alightingTime: alightTime,
            arrivalTime,
            delayMinutes: Math.max(0, delayMins),
            isLive,
            durationMinutes,
            totalDoorToDoorMinutes,
            inVehicleMinutes,
            walkingMinutes: walkBeforeMinutes + walkAfterMinutes,
            walkBeforeMinutes,
            walkAfterMinutes,
            statusType,
            statusLabel,
            alerts: alertMsgs.length > 0 ? alertMsgs : undefined,
            isDirect,
            transfersCount: transitLegs.length - 1,
            transferSummary: !isDirect ? transferSummaryStr : undefined,
            legs: !isDirect ? transferLegDetails : undefined,
            fromStopCoords,
            toStopCoords,
            finalDestCoords,
            finalDestinationName:
              direction === 'to_station' ? `Stazione ${stationName}` : targetName,
            intermediateStopsCount,
            intermediateStopNames:
              intermediateStopNames.length > 0 ? intermediateStopNames : undefined,
            intermediateStopCoords:
              intermediateStopCoords.length > 0 ? intermediateStopCoords : undefined,
            transitPolyline: transitPolyline.length > 0 ? transitPolyline : undefined,
            walkBeforePolyline:
              walkBeforePolyline.length > 0 ? walkBeforePolyline : undefined,
            walkAfterPolyline:
              walkAfterPolyline.length > 0 ? walkAfterPolyline : undefined,
            transferWalkPolylines:
              transferWalkPolylines.length > 0 ? transferWalkPolylines : undefined,
            crowdingLevel,
            operator: primaryLeg.agencyName || (mode === 'metro' ? 'ATAC Metro Roma' : 'ATAC Roma'),
          },
        });
      }

      if (pendingItems.length === 0) {
        // Se la posizione di partenza è fuori Roma/in un'altra regione (> 25km dal centro di Roma),
        // evita di mostrare il fallback statico fittizio dei bus urbani romani (71, 492, ecc.)
        const isFarFromRome =
          Math.abs(originLat - 41.9028) > 0.25 || Math.abs(originLng - 12.4964) > 0.25;
        if (isFarFromRome) {
          return {
            stationName,
            destinationName: targetName,
            directLines: [],
            departures: [],
            optimalIndex: 0,
            lastUpdated: new Date().toLocaleTimeString('it-IT', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            isLiveSource: false,
          };
        }
        return getStaticFallbackDepartures({
          stationName,
          destName: targetName,
          targetTime,
          direction,
          stationCoords: stCoords,
          targetCoords: tgCoords,
          constraintTime,
          minDepartureTime,
          isLiveContext,
        });
      }

      // Trova la minima camminata a piedi a destinazione tra le opzioni disponibili
      const directCandidates = pendingItems.filter((p) => p.draft.isDirect);
      const minDirectWalk = directCandidates.length > 0
        ? Math.min(...directCandidates.map((p) => p.draft.walkAfterMinutes || 0))
        : Math.min(...pendingItems.map((p) => p.draft.walkAfterMinutes || 0));

      // Popola directLinesSet con tutte le linee dirette che raggiungono l'area di destinazione
      for (const p of pendingItems) {
        if (p.draft.isDirect) {
          const wAfter = p.draft.walkAfterMinutes || 0;
          if (wAfter <= Math.max(12, minDirectWalk + 6)) {
            directLinesSet.add(p.draft.line);
          }
        }
      }

      // Trattieni tutte le corse dirette e utili con camminata a piedi ragionevole (<= 12 min a piedi),
      // evitando di scartare opzioni valide ma ordinando sempre in testa i tragitti con camminata minima
      const candidatePending = pendingItems.filter((p) => {
        const wAfter = p.draft.walkAfterMinutes || 0;
        return wAfter <= Math.max(12, minDirectWalk + 6);
      });

      // In andata (dalla stazione verso il campus), filtra prima della risoluzione headsign le corse partite prima dell'arrivo del treno
      let filteredPending = candidatePending;
      if (direction === 'to_campus' && minDepMins > 0) {
        const afterTrain = candidatePending.filter((item) => {
          const depM = parseHHMMToMins(
            isLiveContext ? item.draft.estimatedTime : item.draft.scheduledTime
          );
          return depM >= 0 && depM - (item.draft.walkBeforeMinutes || 0) >= minDepMins - 1;
        });
        if (afterTrain.length > 0) {
          filteredPending = afterTrain;
        }
      }

      // Risolve in parallelo la direzione reale per tutte le corse utili (gestendo linee circolari come il 71 in modo generale)
      const finalDepartures: TransitDepartureItem[] = await Promise.all(
        filteredPending.map(async (item) => ({
          ...item.draft,
          headsign: await resolveVerifiedHeadsign(item.primaryLeg),
        }))
      );

      // Ordine cronologico con priorità alla minima camminata a piedi e minor durata totale (combinazione mezzi-piedi più breve)
      finalDepartures.sort((a, b) => {
        const aDep = parseHHMMToMins(a.estimatedTime);
        const bDep = parseHHMMToMins(b.estimatedTime);
        if (Math.abs(aDep - bDep) <= 1) {
          if (a.walkAfterMinutes !== b.walkAfterMinutes) {
            return a.walkAfterMinutes - b.walkAfterMinutes;
          }
          return a.durationMinutes - b.durationMinutes;
        }
        return a.estimatedTime.localeCompare(b.estimatedTime);
      });

      const { optimal, optimalIndex } = findOptimalTransitDeparture(finalDepartures, {
        direction,
        isLiveContext,
        constraintTime,
        minDepartureTime,
        targetTime,
      });

      const directLines = Array.from(directLinesSet);
      if (directLines.length === 0) {
        finalDepartures.slice(0, 4).forEach((d) => {
          if (!directLines.includes(d.line)) directLines.push(d.line);
        });
      }

      const result: TransitBoardResult = {
        stationName,
        destinationName: targetName,
        directLines,
        departures: finalDepartures,
        optimalDeparture: optimal,
        optimalIndex,
        lastUpdated: new Date().toLocaleTimeString('it-IT', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        isLiveSource: isLiveContext,
      };

      transitBoardMemoryCache.set(cacheKey, {
        timestamp: Date.now(),
        data: result,
      });

      return result;
    } catch {
      const isFarFromRome =
        Math.abs(originLat - 41.9028) > 0.25 || Math.abs(originLng - 12.4964) > 0.25;
      if (isFarFromRome) {
        return {
          stationName,
          destinationName: targetName,
          directLines: [],
          departures: [],
          optimalIndex: 0,
          lastUpdated: new Date().toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          isLiveSource: false,
        };
      }
      return getStaticFallbackDepartures({
        stationName,
        destName: targetName,
        targetTime,
        direction,
        stationCoords: stCoords,
        targetCoords: tgCoords,
        constraintTime,
        minDepartureTime,
        isLiveContext,
      });
    }
  };

  const promise = executeRequest().finally(() => {
    inFlightBoardRequests.delete(cacheKey);
  });
  inFlightBoardRequests.set(cacheKey, promise);
  return promise;
}
