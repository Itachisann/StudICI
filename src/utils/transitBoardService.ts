/**
 * Service per la Transit Board (Mezzi urbani, partenze programmate e in tempo reale)
 * Supporta Roma (ATAC / Metro / Tram / Cotral) e qualsiasi città o stazione in Italia (GTFS / GTFS-RT via Transitous MOTIS 2).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ROME_STATION_COORDINATES } from './transitRouter';
import { resolveClassroom } from './classroomLocations';
import {
  fetchCloserCorridorItineraries,
  fetchTransitousTripDetails,
  optimizeSingleLegStopsViaTrip,
  prefetchTransitousStopsBoxes,
  resolveEffectiveEndpointForRouting,
  resolveWalkLegMetrics,
} from './transitClosestStopHelper';

import {
  pruneAnomalousLoopsAndSpikes,
  resolveTransitRoadwayPolyline,
  getTransitRoadwayPolylineSync,
  detectActiveDetours,
} from './transitRoadwayRouter';
import {
  analyzeTransitRouteFluency,
  estimateDynamicTransitCrowding,
  fetchLiveUrbanWeather,
} from './drivingRouter';
import { getCachedDisruptionsSync } from './disruptionsService';

export {
  pruneAnomalousLoopsAndSpikes,
  resolveTransitRoadwayPolyline,
  getTransitRoadwayPolylineSync,
  detectActiveDetours,
};

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
  scheduledDepartureTime?: string;
  arrivalTime?: string;
  scheduledArrivalTime?: string;
  delayMinutes?: number;
  liveDelayMinutes?: number;
  trafficDelayMinutes?: number;
  trafficFluency?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
  trafficCondition?: string;
  isLive?: boolean;
  durationMinutes: number;
  scheduledDurationMinutes?: number;
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
  estimatedTime: string; // Orario effettivo/stimato partenza mezzo incluso traffico/live (es. "08:12")
  scheduledAlightingTime?: string; // Orario programmato discesa mezzo (es. "08:18")
  alightingTime: string; // Orario effettivo discesa mezzo incluso traffico/live (es. "08:22")
  scheduledArrivalTime?: string; // Orario programmato arrivo finale a destinazione (es. "08:21")
  arrivalTime: string; // Orario effettivo arrivo finale a destinazione inclusa camminata a piedi (es. "08:25")
  scheduledLeaveOriginTime?: string; // Orario programmato partenza utente dall'origine (es. "08:08")
  scheduledInVehicleMinutes?: number; // Minuti programmati sui mezzi senza ritardi/traffico
  delayMinutes: number; // Ritardo complessivo su arrivo/corsa (live GTFS-RT + traffico stradale dinamico)
  liveDelayMinutes?: number; // Quota di ritardo rilevata da telemetria live GTFS-RT
  trafficDelayMinutes?: number; // Minutaggio di ritardo possibile aggiuntivo da traffico stradale (dinamico)
  trafficDepDelayMinutes?: number; // Quota traffico prima della fermata di salita
  trafficRideDelayMinutes?: number; // Quota traffico lungo la tratta a bordo
  trafficFluency?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
  trafficCondition?: string;
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
  initialOriginCoords?: { lat: number; lng: number };
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
  pastDepartures?: TransitDepartureItem[];
  optimalDeparture?: TransitDepartureItem;
  optimalIndex: number;
  lastUsefulDeparture?: TransitDepartureItem;
  lastUsefulIndex?: number;
  lastUpdated: string;
  isLiveSource: boolean;
  arrivalBufferMinutes?: number;
  preferLatestBeforeDeadline?: boolean;
  fetchFailed?: boolean;
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

// Cache in-memory + persistente per le direzioni reali (capolinea di giro) delle linee circolari/anello GTFS
const circularTurnaroundCache = new Map<string, string>();
const circularTurnaroundInFlight = new Map<string, Promise<string>>();
const CIRCULAR_TURNAROUND_STORAGE_KEY = 'studici_circular_turnaround_v2';
const CIRCULAR_TURNAROUND_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 giorni
let circularTurnaroundStorageLoaded = false;

async function ensureCircularTurnaroundLoaded(): Promise<void> {
  if (circularTurnaroundStorageLoaded) return;
  circularTurnaroundStorageLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(CIRCULAR_TURNAROUND_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt < CIRCULAR_TURNAROUND_TTL_MS &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    ) {
      for (const [k, v] of Object.entries<any>(parsed.entries)) {
        if (typeof v === 'string' && v && !circularTurnaroundCache.has(k)) {
          circularTurnaroundCache.set(k, v);
        }
      }
    }
  } catch {}
}

async function persistCircularTurnaroundCache(): Promise<void> {
  try {
    const entries: Record<string, string> = {};
    for (const [k, v] of Array.from(circularTurnaroundCache.entries()).slice(-50)) {
      entries[k] = v;
    }
    await AsyncStorage.setItem(
      CIRCULAR_TURNAROUND_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), entries })
    );
  } catch {}
}

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
 * Rimuove punti duplicati o adiacenti a distanza trascurabile (< minDistanceMeters)
 * per prevenire artefatti grafici, loop o rendering non fluidi su react-native-maps.
 */
export function deduplicateAdjacentPoints(
  points: LatLngPoint[],
  minDistanceMeters = 0.5
): LatLngPoint[] {
  if (!points || points.length <= 1) return points || [];
  const result: LatLngPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (haversineMeters(prev, curr) >= minDistanceMeters) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Garantisce in modo generico per qualsiasi mezzo (bus, tram, metro, treno)
 * e per qualsiasi linea o città una traiettoria continua al 100% tra:
 * - Fermata di salita (fromPoint) contrassegnata dall'icona del mezzo
 * - Fermate intermedie / waypoint successivi (intermediateStops)
 * - Polilinea di base / tracciato stradale o su ferro (basePolyline)
 * - Fermata di discesa (toPoint) contrassegnata dalla bandierina
 *
 * Elimina buchi, discontinuità visive o disallineamenti:
 * 1. La polilinea inizia ESATTAMENTE al marker di salita (fromPoint).
 * 2. Unisce in modo continuo i waypoint intermedi (es. ACEA, Verano, fermate intermedie).
 * 3. Incorpora e segue la geometria stradale/ferroviaria verificata nella corsia corretta.
 * 4. Termina ESATTAMENTE al marker di discesa (toPoint).
 */
/**
 * Rimuove spike, inversioni a U anomale e salti indietro lungo la traiettoria,
 * garantendo che il tracciato segua la viabilità in modo rigorosamente continuo e monodirezionale.
 */
export function filterPolylineReversals(
  poly: LatLngPoint[]
): LatLngPoint[] {
  return pruneAnomalousLoopsAndSpikes(poly);
}

export function ensureContinuousTransitPolyline(
  fromPoint?: LatLngPoint,
  toPoint?: LatLngPoint,
  intermediateStops?: (LatLngPoint | { lat: number; lng: number })[],
  basePolyline?: LatLngPoint[]
): LatLngPoint[] {
  const normStops: LatLngPoint[] = (intermediateStops || [])
    .map((s) => ('latitude' in s ? s : { latitude: s.lat, longitude: s.lng }))
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));

  const validFrom =
    fromPoint && Number.isFinite(fromPoint.latitude) && Number.isFinite(fromPoint.longitude)
      ? { latitude: fromPoint.latitude, longitude: fromPoint.longitude }
      : undefined;

  const validTo =
    toPoint && Number.isFinite(toPoint.latitude) && Number.isFinite(toPoint.longitude)
      ? { latitude: toPoint.latitude, longitude: toPoint.longitude }
      : undefined;

  const raw = (basePolyline || []).filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );

  // Fallback: se non c'è una polilinea con almeno 2 punti, unisce linearmente salita -> fermate -> discesa
  if (raw.length < 2) {
    const pts: LatLngPoint[] = [];
    if (validFrom) pts.push(validFrom);
    pts.push(...normStops);
    if (validTo) pts.push(validTo);
    return deduplicateAdjacentPoints(pts, 0.5);
  }

  // Se mancano entrambi i punti di salita e discesa, ripulisce dai falsi loop e deduplica
  if (!validFrom && !validTo) {
    return filterPolylineReversals(raw);
  }

  const projectOnPolyline = (p: LatLngPoint, poly: LatLngPoint[]) => {
    let bestProj = poly[0];
    let bestDist = Infinity;
    let bestParam = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const segA = poly[i];
      const segB = poly[i + 1];
      const dLat = segB.latitude - segA.latitude;
      const dLng = segB.longitude - segA.longitude;
      const lenSq = dLat * dLat + dLng * dLng;
      let t = 0;
      if (lenSq > 1e-12) {
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.latitude - segA.latitude) * dLat + (p.longitude - segA.longitude) * dLng) / lenSq
          )
        );
      }
      const proj = {
        latitude: segA.latitude + t * dLat,
        longitude: segA.longitude + t * dLng,
      };
      const d = haversineMeters(p, proj);
      if (d < bestDist) {
        bestDist = d;
        bestProj = proj;
        bestParam = i + t;
      }
    }
    return { proj: bestProj, dist: bestDist, param: bestParam };
  };

  let activePoly = [...raw];
  let fromProj = validFrom ? projectOnPolyline(validFrom, activePoly) : null;
  let toProj = validTo ? projectOnPolyline(validTo, activePoly) : null;

  // Inversione sicura solo se la polilinea grezza è orientata in senso marcatamente opposto
  if (fromProj && toProj && fromProj.param > toProj.param + 0.8) {
    activePoly.reverse();
    fromProj = projectOnPolyline(validFrom!, activePoly);
    toProj = projectOnPolyline(validTo!, activePoly);
  }

  const startParam = fromProj ? fromProj.param : 0;
  const endParam = toProj ? toProj.param : activePoly.length - 1;

  const startSeg = Math.floor(startParam);
  const endSeg = Math.ceil(endParam);

  const sliced: LatLngPoint[] = [];

  // Punto di salita: aggancia la proiezione stradale
  if (fromProj) {
    sliced.push(fromProj.proj);
  }

  // Punti interni della sede stradale verificata
  const firstInnerIdx = startSeg + 1;
  const lastInnerIdx = Math.floor(endParam);
  for (let i = firstInnerIdx; i <= lastInnerIdx && i < activePoly.length; i++) {
    sliced.push(activePoly[i]);
  }

  // Punto di discesa: aggancia la proiezione stradale
  if (toProj) {
    sliced.push(toProj.proj);
  }

  if (sliced.length === 0) {
    sliced.push(...activePoly.slice(Math.max(0, startSeg), Math.min(activePoly.length, endSeg + 1)));
  }

  // Il tragitto del mezzo inizia e termina rigorosamente sulla carreggiata stradale (banchina di salita e banchina di discesa),
  // senza appendere le coordinate grezze della fermata che potrebbero cadere all'interno di fabbricati o cortili privati
  const result: LatLngPoint[] = sliced.length > 0 ? sliced : activePoly;
  return filterPolylineReversals(deduplicateAdjacentPoints(result, 0.5));
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
  _stopName?: string,
  coords?: { lat: number; lng: number }
): { lat: number; lng: number } {
  if (!coords) return ROME_STATION_COORDINATES.generic;
  return coords;
}

/**
 * Ottimizza la fermata del mezzo in modo 100% DINAMICO per garantire la MINIMA camminata a piedi possibile
 * verso la destinazione (in andata) o dall'origine (nel ritorno).
 * Esamina la fermata attuale e tutte le fermate fisiche servite dal mezzo lungo il tragitto (GTFS trip),
 * selezionando la fermata che minimizza la distanza pedonale verso il punto target,
 * valido per qualsiasi linea, operatore o città senza dati statici hardcoded.
 */
export function optimizeTransitStopForMinWalk(params: {
  direction: 'to_campus' | 'to_station';
  currentStopName: string;
  currentStopCoords: { lat: number; lng: number };
  boardStopCoords?: { lat: number; lng: number };
  targetCoords: { lat: number; lng: number }; // finalDestCoords (andata o ritorno)
  intermediateStops: { name: string; lat: number; lng: number }[];
  lineShort: string;
  mode: string;
  candidateTripStops?: { name: string; lat: number; lng: number }[];
}): {
  optimizedStopName: string;
  optimizedStopCoords: { lat: number; lng: number };
  optimizedIntermediateStops: { name: string; lat: number; lng: number }[];
  didChange: boolean;
} {
  const {
    currentStopName,
    currentStopCoords,
    boardStopCoords,
    targetCoords,
    intermediateStops,
    mode,
    candidateTripStops,
  } = params;

  if (mode === 'subway' || mode === 'metro' || mode === 'rail') {
    return {
      optimizedStopName: currentStopName,
      optimizedStopCoords: currentStopCoords,
      optimizedIntermediateStops: intermediateStops,
      didChange: false,
    };
  }

  // Costruisce dinamicamente la lista di tutte le fermate fisiche candidate
  const candidateStops: { name: string; lat: number; lng: number; source: 'current' | 'intermediate' | 'trip' }[] = [
    { ...currentStopCoords, name: currentStopName, source: 'current' },
  ];

  for (const s of intermediateStops) {
    if (s && typeof s.lat === 'number' && typeof s.lng === 'number') {
      if (!candidateStops.some((c) => Math.abs(c.lat - s.lat) < 0.0001 && Math.abs(c.lng - s.lng) < 0.0001)) {
        candidateStops.push({ ...s, source: 'intermediate' });
      }
    }
  }

  if (Array.isArray(candidateTripStops)) {
    for (const s of candidateTripStops) {
      if (s && typeof s.lat === 'number' && typeof s.lng === 'number') {
        if (!candidateStops.some((c) => Math.abs(c.lat - s.lat) < 0.0001 && Math.abs(c.lng - s.lng) < 0.0001)) {
          candidateStops.push({ ...s, source: 'trip' });
        }
      }
    }
  }

  const currDist = haversineMeters(
    { latitude: currentStopCoords.lat, longitude: currentStopCoords.lng },
    { latitude: targetCoords.lat, longitude: targetCoords.lng }
  );

  let bestStop = candidateStops[0];
  let bestDist = currDist;

  const boardToTargetDist = boardStopCoords
    ? haversineMeters(
        { latitude: boardStopCoords.lat, longitude: boardStopCoords.lng },
        { latitude: targetCoords.lat, longitude: targetCoords.lng }
      )
    : Infinity;

  for (const cand of candidateStops) {
    const d = haversineMeters(
      { latitude: cand.lat, longitude: cand.lng },
      { latitude: targetCoords.lat, longitude: targetCoords.lng }
    );
    if (boardStopCoords) {
      const distFromBoard = haversineMeters(
        { latitude: boardStopCoords.lat, longitude: boardStopCoords.lng },
        { latitude: cand.lat, longitude: cand.lng }
      );
      if (distFromBoard < 200 || d > boardToTargetDist - 150) {
        continue;
      }
    }
    // Privilegia la fermata alternativa se accorcia sensibilmente la camminata (almeno 35 metri in meno)
    if (d < bestDist - 35) {
      bestDist = d;
      bestStop = cand;
    }
  }

  if (bestStop.source === 'current' || Math.abs(bestDist - currDist) < 35) {
    return {
      optimizedStopName: currentStopName,
      optimizedStopCoords: currentStopCoords,
      optimizedIntermediateStops: intermediateStops,
      didChange: false,
    };
  }

  // Ricostruisce la lista di fermate intermedie allineata alla nuova fermata scelta
  let newIntermediates = [...intermediateStops];
  if (bestStop.source === 'intermediate') {
    const idx = newIntermediates.findIndex(
      (s) => Math.abs(s.lat - bestStop.lat) < 0.0003 && Math.abs(s.lng - bestStop.lng) < 0.0003
    );
    if (idx >= 0) {
      newIntermediates = newIntermediates.slice(0, idx);
    }
  } else if (bestStop.source === 'trip') {
    if (!newIntermediates.some((s) => Math.abs(s.lat - currentStopCoords.lat) < 0.0003 && Math.abs(s.lng - currentStopCoords.lng) < 0.0003)) {
      newIntermediates.push({
        name: currentStopName,
        lat: currentStopCoords.lat,
        lng: currentStopCoords.lng,
      });
    }
  }

  return {
    optimizedStopName: bestStop.name,
    optimizedStopCoords: { lat: bestStop.lat, lng: bestStop.lng },
    optimizedIntermediateStops: newIntermediates,
    didChange: true,
  };
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
 * Normalizza e ripulisce dinamicamente qualsiasi polilinea GTFS/OSRM da loop anomali e micro-spike,
 * in modo valido per qualsiasi linea o città senza tracciati statici hardcoded.
 */
export function resolveOptimizedTransitPolyline(
  _fromName: string,
  _toName: string,
  _fromCoords: { lat: number; lng: number },
  _toCoords: { lat: number; lng: number },
  rawPolyline: LatLngPoint[]
): LatLngPoint[] {
  if (rawPolyline && rawPolyline.length >= 15) {
    const cleaned = pruneAnomalousLoopsAndSpikes(rawPolyline);
    return deduplicateAdjacentPoints(cleaned, 0.5);
  }
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

function isSameStopEntity(
  nameA?: string,
  nameB?: string,
  stopIdA?: string,
  stopIdB?: string
): boolean {
  if (stopIdA && stopIdB && stopIdA === stopIdB) return true;
  const rawA = (nameA || '').trim().toLowerCase();
  const rawB = (nameB || '').trim().toLowerCase();
  if (!rawA || !rawB) return false;
  if (rawA === rawB) return true;
  const normA = normalizeStopTokens(nameA);
  const normB = normalizeStopTokens(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // Evita falsi positivi tra una stazione/capolinea (es. "Staz.ne Tiburtina (MB)") e una fermata lungo la via omonima (es. "Tiburtina/Castro Laurenziano")
  const hasSlashA = rawA.includes('/');
  const hasSlashB = rawB.includes('/');
  if (hasSlashA !== hasSlashB) return false;
  return false;
}

/**
 * Verifica se la direzione GTFS coincide erroneamente con la fermata di partenza
 * (tipico delle linee ad anello/circolari come il 71 a Roma, dove tripFrom === tripTo).
 * In tal caso interroga l'elenco completo delle fermate della corsa (inclusi capolinea iniziale e finale)
 * e determina in base alla posizione reale e all'orario di salita/discesa se il mezzo sta andando
 * verso il punto di svolta dell'anello (es. "L.go Chigi") o se sta rientrando verso il capolinea finale (es. "Staz.ne Tiburtina (MB)").
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
    isSameStopEntity(rawHeadsign, fromName, undefined, primaryLeg.from?.stopId);

  const headsignMatchesDest = isSameStopEntity(
    rawHeadsign,
    toName,
    undefined,
    primaryLeg.to?.stopId
  );

  // Se la linea non è circolare e l'headsign non coincide con la fermata di salita, l'headsign GTFS è già corretto
  if (!isLoopTrip && !headsignMatchesOrigin) {
    return formatStopDisplayName(rawHeadsign);
  }

  // Se siamo su una linea circolare e la fermata di discesa coincide già col capolinea finale (to === headsign e from !== headsign),
  // allora stiamo rientrando verso il capolinea finale (es. Staz.ne Tiburtina tornando da Castro Laurenziano)
  if (normHead && headsignMatchesDest && !headsignMatchesOrigin) {
    return formatStopDisplayName(rawHeadsign);
  }

  await ensureCircularTurnaroundLoaded();
  const routeKey = `${primaryLeg.routeId || primaryLeg.routeShortName || 'route'}_${primaryLeg.directionId || '0'}_${normFrom}_${normTo}`;
  const cachedTurnaround = circularTurnaroundCache.get(routeKey);
  if (cachedTurnaround) {
    return cachedTurnaround;
  }

  const existingInFlight = circularTurnaroundInFlight.get(routeKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  // Interroga /api/v5/trip di Transitous tramite cache/dedup condivisa per determinare il ramo dell'anello
  if (primaryLeg.tripId) {
    const task = (async (): Promise<string> => {
      try {
        const tripData = await fetchTransitousTripDetails(primaryLeg.tripId);
        if (tripData) {
          const tripIt = Array.isArray(tripData?.itineraries)
            ? tripData.itineraries[0]
            : tripData;
          const fullLeg = tripIt?.legs?.[0];
          const allStops: any[] = [];
          if (fullLeg?.from) allStops.push(fullLeg.from);
          if (Array.isArray(fullLeg?.intermediateStops)) {
            allStops.push(...fullLeg.intermediateStops);
          }
          if (fullLeg?.to) allStops.push(fullLeg.to);

          const loopOriginLat = fullLeg?.from?.lat ?? primaryLeg.from?.lat;
          const loopOriginLon = fullLeg?.from?.lon ?? primaryLeg.from?.lon;

          if (
            allStops.length >= 3 &&
            typeof loopOriginLat === 'number' &&
            typeof loopOriginLon === 'number'
          ) {
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

            const legStartMs = primaryLeg.startTime
              ? new Date(primaryLeg.startTime).getTime()
              : NaN;
            const legEndMs = primaryLeg.endTime
              ? new Date(primaryLeg.endTime).getTime()
              : NaN;
            const fromStopId = primaryLeg.from?.stopId;
            const toStopId = primaryLeg.to?.stopId;

            let userBoardIdx = -1;
            let bestBoardTimeDiff = Infinity;
            for (let i = 0; i < allStops.length; i++) {
              const s = allStops[i];
              const match =
                (fromStopId && s?.stopId === fromStopId) ||
                isSameStopEntity(s?.name, fromName, s?.stopId, fromStopId);
              if (!match) continue;
              const sIso = s?.departure || s?.scheduledDeparture || s?.arrival;
              const sMs = sIso ? new Date(sIso).getTime() : NaN;
              const diff =
                Number.isFinite(legStartMs) && Number.isFinite(sMs)
                  ? Math.abs(sMs - legStartMs)
                  : 0;
              if (diff < bestBoardTimeDiff) {
                bestBoardTimeDiff = diff;
                userBoardIdx = i;
              }
            }

            let userAlightIdx = -1;
            let bestAlightTimeDiff = Infinity;
            for (let i = Math.max(0, userBoardIdx + 1); i < allStops.length; i++) {
              const s = allStops[i];
              const match =
                (toStopId && s?.stopId === toStopId) ||
                isSameStopEntity(s?.name, toName, s?.stopId, toStopId);
              if (!match) continue;
              const sIso = s?.arrival || s?.scheduledArrival || s?.departure;
              const sMs = sIso ? new Date(sIso).getTime() : NaN;
              const diff =
                Number.isFinite(legEndMs) && Number.isFinite(sMs)
                  ? Math.abs(sMs - legEndMs)
                  : 0;
              if (diff < bestAlightTimeDiff) {
                bestAlightTimeDiff = diff;
                userAlightIdx = i;
              }
            }

            const turnaroundStopName = allStops[turnaroundIdx]?.name;
            const finalTerminusName =
              allStops[allStops.length - 1]?.name || tripToName || rawHeadsign;

            if (turnaroundStopName) {
              // Ramo di andata dell'anello (prima del giro di boa): direzione = capolinea di svolta (es. L.go Chigi)
              // Ramo di ritorno dell'anello (dopo il giro di boa): direzione = capolinea finale (es. Staz.ne Tiburtina (MB))
              const isOnReturnHalfOfLoop =
                (userBoardIdx >= turnaroundIdx && userBoardIdx >= 0) ||
                (userAlightIdx > turnaroundIdx + 1 &&
                  (userBoardIdx < 0 || userBoardIdx >= Math.floor(turnaroundIdx * 0.6)));

              const chosenHeadsign = isOnReturnHalfOfLoop
                ? finalTerminusName
                : turnaroundStopName;
              if (chosenHeadsign) {
                const formatted = formatStopDisplayName(chosenHeadsign);
                circularTurnaroundCache.set(routeKey, formatted);
                void persistCircularTurnaroundCache();
                return formatted;
              }
            }
          }
        }
      } catch {
        // Continua con il fallback intelligente
      }

      if (toName && !isSameStopEntity(toName, fromName)) {
        return formatStopDisplayName(toName);
      }
      return formatStopDisplayName(rawHeadsign || toName || 'Centro');
    })().finally(() => {
      circularTurnaroundInFlight.delete(routeKey);
    });

    circularTurnaroundInFlight.set(routeKey, task);
    return task;
  }

  if (toName && !isSameStopEntity(toName, fromName)) {
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

function resolveDateWithDayOffset(targetDate?: string, dayOffset = 0): string {
  const base =
    targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      ? (() => {
          const [y, m, d] = targetDate.split('-').map(Number);
          return new Date(y, m - 1, d, 12, 0, 0);
        })()
      : (() => {
          const now = new Date();
          return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
        })();
  if (dayOffset !== 0) {
    base.setDate(base.getDate() + dayOffset);
  }
  const yy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
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

function unwrapMinutesFromRef(mins: number, refMins: number): number {
  if (mins < 0) return mins;
  if (refMins >= 0 && mins < refMins && refMins - mins > 720) {
    return mins + 1440;
  }
  return mins;
}

/**
 * Individua la corsa ottimale (il mezzo più efficiente per arrivare a destinazione,
 * considerando camminata iniziale, durata reale del mezzo e camminata finale fino all'aula/stazione,
 * privilegiando minor cammino a piedi e arrivo più rapido) e, quando esiste un vincolo orario
 * (es. partenza treno o inizio lezione), identifica anche l'ultima corsa utile per non perdere il vincolo.
 */
export function findOptimalTransitDeparture(
  departures: TransitDepartureItem[],
  options: {
    direction: 'to_campus' | 'to_station';
    isLiveContext: boolean;
    constraintTime?: string; // Ritorno: partenza treno. Andata: inizio lezione.
    minDepartureTime?: string; // Andata: arrivo treno in stazione. Ritorno: fine lezione.
    targetTime?: string;
    arrivalBufferMinutes?: number; // Anticipo in aula (andata) o in stazione (ritorno) rispetto al vincolo
    preferLatestBeforeDeadline?: boolean; // Uscita anticipata da lezione: calibra a ritroso dal treno per perdere meno minuti possibili
  }
): {
  optimal: TransitDepartureItem | undefined;
  optimalIndex: number;
  lastUseful?: TransitDepartureItem;
  lastUsefulIndex?: number;
} {
  if (!departures || departures.length === 0) {
    return { optimal: undefined, optimalIndex: 0 };
  }

  const { direction, isLiveContext, constraintTime, minDepartureTime } = options;
  const effectiveAdvanceMins = Math.max(
    0,
    typeof options.arrivalBufferMinutes === 'number'
      ? options.arrivalBufferMinutes
      : direction === 'to_station'
        ? 5
        : 0
  );
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const rawDeadlineMins = parseHHMMToMins(constraintTime);
  const rawMinDepMins = parseHHMMToMins(minDepartureTime);
  const rawClockBase = isLiveContext
    ? nowMins
    : rawMinDepMins > 0
      ? rawMinDepMins
      : rawDeadlineMins > 0
        ? Math.max(0, rawDeadlineMins - 60)
        : nowMins;

  const deadlineMins =
    rawDeadlineMins > 0 ? unwrapMinutesFromRef(rawDeadlineMins, rawClockBase) : -1;
  const unwrappedMinDepMins =
    rawMinDepMins > 0 ? unwrapMinutesFromRef(rawMinDepMins, rawClockBase) : -1;

  const getDepMins = (d: TransitDepartureItem) => {
    const raw = parseHHMMToMins(d.estimatedTime || d.scheduledTime);
    return unwrapMinutesFromRef(raw, rawClockBase);
  };

  const getDestArrMins = (d: TransitDepartureItem) => {
    const depM = getDepMins(d);
    const rawArrM = parseHHMMToMins(d.arrivalTime);
    if (rawArrM >= 0) {
      const refForArr = depM >= 0 ? depM : rawClockBase;
      return unwrapMinutesFromRef(rawArrM, refForArr);
    }
    const rideAndAfter =
      d.inVehicleMinutes !== undefined
        ? Math.max(1, d.inVehicleMinutes) + (d.walkAfterMinutes || 0)
        : d.durationMinutes;
    return depM >= 0 ? depM + rideAndAfter : -1;
  };

  // Quando minDepartureTime è valorizzato (es. fine lezione in ritorno standard o arrivo treno in andata),
  // va sempre rispettato rigorosamente per non far perdere minuti di lezione né proporre corse irraggiungibili.
  const effectiveMinDepMins = unwrappedMinDepMins > 0 ? unwrappedMinDepMins : -1;

  // Orario minimo in cui l'utente può iniziare a muoversi dall'origine (stazione, aula o posizione GPS attuale)
  const isNowTarget = options.targetTime === 'now';
  const minOriginStartMins =
    isLiveContext || isNowTarget
      ? Math.max(nowMins, effectiveMinDepMins > 0 ? effectiveMinDepMins : 0)
      : effectiveMinDepMins > 0
        ? effectiveMinDepMins
        : 0;

  // 1. Filtra le corse effettivamente raggiungibili (partenza mezzo meno camminata iniziale >= ora uscita possibile).
  //    Tolleranza 0 in ogni direzione e contesto: tiene sempre conto dei minuti a piedi dall'origine reale
  //    (fine lezione, arrivo treno, orario/posizione attuale) senza basarsi sulla sola partenza del mezzo.
  const strictReachable = departures.filter((d) => {
    const depM = getDepMins(d);
    if (depM < 0) return false;
    const leaveOriginM = depM - (d.walkBeforeMinutes || 0);
    return leaveOriginM >= minOriginStartMins;
  });
  const hasStrictReachable = strictReachable.length > 0;
  const reachable = hasStrictReachable ? strictReachable : [...departures];

  // 2. Filtra le corse che arrivano a destinazione (mezzo + cambi + tutte le camminate) entro il vincolo comprensivo di anticipo
  const effectiveDeadline = deadlineMins > 0 ? deadlineMins - effectiveAdvanceMins : -1;
  const strictEffectiveMatches =
    effectiveDeadline > 0 && hasStrictReachable
      ? strictReachable.filter((d) => {
          const destArrM = getDestArrMins(d);
          return destArrM > 0 && destArrM <= effectiveDeadline;
        })
      : [];
  const strictWithinDeadlineMatches =
    deadlineMins > 0 && hasStrictReachable
      ? strictReachable.filter((d) => {
          const destArrM = getDestArrMins(d);
          return destArrM > 0 && destArrM <= deadlineMins;
        })
      : [];

  let onTimeCandidates = reachable;
  if (deadlineMins > 0) {
    const enforceLowerArrivalWindow = !isLiveContext && minOriginStartMins <= 0;
    const baseEffectiveMatches =
      strictEffectiveMatches.length > 0
        ? strictEffectiveMatches
        : reachable.filter((d) => {
            const destArrM = getDestArrMins(d);
            return destArrM > 0 && destArrM <= effectiveDeadline;
          });

    if (baseEffectiveMatches.length > 0) {
      const withinWindow = enforceLowerArrivalWindow
        ? baseEffectiveMatches.filter((d) => getDestArrMins(d) >= effectiveDeadline - 65)
        : baseEffectiveMatches;
      onTimeCandidates = withinWindow.length > 0 ? withinWindow : baseEffectiveMatches;
    } else {
      const withinStrict = reachable.filter((d) => {
        const destArrM = getDestArrMins(d);
        if (destArrM <= 0 || destArrM > deadlineMins) return false;
        return enforceLowerArrivalWindow ? destArrM >= deadlineMins - 65 : true;
      });
      if (withinStrict.length > 0) {
        onTimeCandidates = withinStrict;
      }
    }
  }

  const getWalkTotal = (d: TransitDepartureItem) =>
    (d.walkBeforeMinutes || 0) + (d.walkAfterMinutes || 0);

  const getLeaveOriginMins = (d: TransitDepartureItem) => {
    const depM = getDepMins(d);
    return depM >= 0 ? depM - (d.walkBeforeMinutes || 0) : -1;
  };

  const getDoorToDoorMins = (d: TransitDepartureItem) =>
    typeof d.totalDoorToDoorMinutes === 'number' && d.totalDoorToDoorMinutes > 0
      ? d.totalDoorToDoorMinutes
      : (d.walkBeforeMinutes || 0) + d.durationMinutes;

  // 3. Rimuovi le corse dominate considerando anche il momento di partenza dall'origine (sottraendo il cammino iniziale) e il cammino totale
  const filterNonDominated = (candidatesList: TransitDepartureItem[]) =>
    candidatesList.filter((cand) => {
      const cLeave = getLeaveOriginMins(cand);
      const cArr = getDestArrMins(cand);
      const cWalk = getWalkTotal(cand);
      const isDominated = candidatesList.some((other) => {
        if (other.id === cand.id) return false;
        const oLeave = getLeaveOriginMins(other);
        const oArr = getDestArrMins(other);
        const oWalk = getWalkTotal(other);
        return (
          oLeave >= cLeave &&
          oArr <= cArr &&
          oWalk <= cWalk &&
          (oLeave > cLeave || oArr < cArr || oWalk < cWalk)
        );
      });
      return !isDominated;
    });

  const nonDominated = filterNonDominated(onTimeCandidates);
  const pool = nonDominated.length > 0 ? nonDominated : onTimeCandidates;

  // 4. Scelta del mezzo ottimale:
  //    - In modalità uscita anticipata da lezione (preferLatestBeforeDeadline): procede a ritroso dal vincolo treno
  //      per massimizzare l'orario di uscita dall'aula (perdendo il minor numero possibile di minuti di lezione),
  //      bilanciando comunque la camminata a piedi tra opzioni equivalenti.
  //    - In modalità standard (andata, ritorno post-lezione, live): privilegia il minor tempo a piedi complessivo,
  //      l'arrivo anticipato a destinazione e la minore durata porta-a-porta nella prima finestra utile.
  const useBackwardMinimizeLoss = Boolean(
    options.preferLatestBeforeDeadline &&
      direction === 'to_station' &&
      deadlineMins > 0 &&
      effectiveMinDepMins <= 0
  );

  let chosen: TransitDepartureItem | undefined;

  if (useBackwardMinimizeLoss) {
    const latestPool = [...pool].sort((a, b) => {
      const aLeave = getLeaveOriginMins(a);
      const bLeave = getLeaveOriginMins(b);
      if (bLeave !== aLeave) return bLeave - aLeave;
      const aWalk = getWalkTotal(a);
      const bWalk = getWalkTotal(b);
      if (aWalk !== bWalk) return aWalk - bWalk;
      const aDoor = getDoorToDoorMins(a);
      const bDoor = getDoorToDoorMins(b);
      if (aDoor !== bDoor) return aDoor - bDoor;
      if (a.transfersCount !== b.transfersCount) return a.transfersCount - b.transfersCount;
      return getDestArrMins(a) - getDestArrMins(b);
    });
    const maxLeaveOrigin = latestPool.length > 0 ? getLeaveOriginMins(latestPool[0]) : 0;
    const lateWindow = latestPool.filter((d) => getLeaveOriginMins(d) >= maxLeaveOrigin - 5);
    const lateCandidates = lateWindow.length > 0 ? lateWindow : latestPool.slice(0, 4);

    const pickLeastLostLecture = (
      best: TransitDepartureItem,
      curr: TransitDepartureItem
    ): TransitDepartureItem => {
      const bLeave = getLeaveOriginMins(best);
      const cLeave = getLeaveOriginMins(curr);
      const leaveDiff = cLeave - bLeave; // positivo se curr permette di uscire dall'aula più tardi
      const bWalk = getWalkTotal(best);
      const cWalk = getWalkTotal(curr);
      const walkDiff = cWalk - bWalk; // negativo se curr ha meno minuti a piedi

      // Se l'orario di uscita dall'aula è praticamente identico (<= 1 min di scarto),
      // privilegia la corsa con sensibilmente meno camminata (>= 3 min in meno).
      if (Math.abs(leaveDiff) <= 1 && Math.abs(walkDiff) >= 3) {
        return walkDiff < 0 ? curr : best;
      }
      // Obiettivo primario in uscita anticipata: uscire il più tardi possibile per perdere meno minuti di lezione
      if (leaveDiff !== 0) {
        return leaveDiff > 0 ? curr : best;
      }
      if (walkDiff !== 0) {
        return walkDiff < 0 ? curr : best;
      }
      const bDoor = getDoorToDoorMins(best);
      const cDoor = getDoorToDoorMins(curr);
      if (cDoor !== bDoor) {
        return cDoor < bDoor ? curr : best;
      }
      if (curr.transfersCount !== best.transfersCount) {
        return curr.transfersCount < best.transfersCount ? curr : best;
      }
      const bArr = getDestArrMins(best);
      const cArr = getDestArrMins(curr);
      if (cArr > 0 && bArr > 0 && cArr !== bArr) {
        return cArr < bArr ? curr : best;
      }
      return getDepMins(curr) > getDepMins(best) ? curr : best;
    };

    chosen =
      lateCandidates.length > 0
        ? lateCandidates.reduce((best, curr) => pickLeastLostLecture(best, curr), lateCandidates[0])
        : departures[0];
  } else {
    const sortedPool = [...pool].sort(
      (a, b) => getLeaveOriginMins(a) - getLeaveOriginMins(b) || getDepMins(a) - getDepMins(b)
    );
    const firstLeaveOrigin = sortedPool.length > 0 ? getLeaveOriginMins(sortedPool[0]) : 0;

    // Finestra di connessione utile (corse con partenza dall'origine entro 25 minuti dalla prima opzione raggiungibile)
    const immediateWindow = sortedPool.filter(
      (d) => getLeaveOriginMins(d) <= firstLeaveOrigin + 25
    );
    const candidates = immediateWindow.length > 0 ? immediateWindow : sortedPool.slice(0, 4);

    const pickMoreEfficient = (
      best: TransitDepartureItem,
      curr: TransitDepartureItem
    ): TransitDepartureItem => {
      const bArr = getDestArrMins(best);
      const cArr = getDestArrMins(curr);
      const bWalk = getWalkTotal(best);
      const cWalk = getWalkTotal(curr);
      const walkDiff = cWalk - bWalk; // negativo se curr ha una camminata a piedi inferiore

      // Criterio 1: MINOR TEMPO A PIEDI.
      // Se entrambe le opzioni arrivano entro una finestra ravvicinata (<= 6 minuti di scarto sull'arrivo finale):
      // la corsa che garantisce la minore camminata a piedi (almeno 2 minuti di cammino in meno) vince SEMPRE!
      if (Math.abs(walkDiff) >= 2 && cArr > 0 && bArr > 0 && Math.abs(cArr - bArr) <= 6) {
        return walkDiff < 0 ? curr : best;
      }

      // Criterio 2: Arrivo a destinazione (se differisce di oltre 6 minuti o con camminata simile, vince chi arriva prima)
      if (cArr > 0 && bArr > 0 && Math.abs(cArr - bArr) >= 2) {
        return cArr < bArr ? curr : best;
      }

      // Criterio 3: A parità di arrivo (differenza <= 1 min), vicinanza fermata / minore camminata
      if (Math.abs(walkDiff) >= 2) {
        return walkDiff < 0 ? curr : best;
      }

      // Criterio 4: Minore durata porta-a-porta complessiva (piedi + bordo + piedi)
      const bDoor = getDoorToDoorMins(best);
      const cDoor = getDoorToDoorMins(curr);
      if (cDoor !== bDoor) {
        return cDoor < bDoor ? curr : best;
      }

      // Criterio 5: Corsa diretta (meno cambi)
      if (curr.transfersCount !== best.transfersCount) {
        return curr.transfersCount < best.transfersCount ? curr : best;
      }

      // Criterio 6: Partenza dall'origine meno anticipata (meno attesa a vuoto)
      const bLeave = getLeaveOriginMins(best);
      const cLeave = getLeaveOriginMins(curr);
      if (cLeave !== bLeave) {
        return cLeave > bLeave ? curr : best;
      }

      return getDepMins(curr) > getDepMins(best) ? curr : best;
    };

    chosen =
      candidates.length > 0
        ? candidates.reduce((best, curr) => pickMoreEfficient(best, curr), candidates[0])
        : departures[0];
  }

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

  // 5. Individua l'ultima corsa utile per non mancare il vincolo (treno o inizio lezione comprensivo di anticipo):
  //    - non può MAI precedere nella lista cronologica la corsa consigliata (lastUsefulIndex >= optimalIndex);
  //    - tra le corse nella fascia più tarda utile (entro 1 min dall'uscita massima dall'origine),
  //      privilegia quella che arriva prima delle altre con la durata TOTALE porta-a-porta più breve.
  let lastUseful: TransitDepartureItem | undefined = undefined;
  let lastUsefulIndex: number | undefined = undefined;
  const lastUsefulCandidates =
    strictEffectiveMatches.length > 0
      ? strictEffectiveMatches
      : strictWithinDeadlineMatches;
  if (deadlineMins > 0 && lastUsefulCandidates.length > 0) {
    const eligibleLastCandidates = lastUsefulCandidates.filter((d) => {
      const dIdx = departures.findIndex((x) => x.id === d.id);
      return dIdx >= optimalIndex;
    });
    const scopedLastCandidates =
      eligibleLastCandidates.length > 0 ? eligibleLastCandidates : lastUsefulCandidates;
    const nonDomLast = filterNonDominated(scopedLastCandidates);
    const lastUsefulPool = nonDomLast.length > 0 ? nonDomLast : scopedLastCandidates;

    const maxLastLeave = lastUsefulPool.reduce(
      (maxM, d) => Math.max(maxM, getLeaveOriginMins(d)),
      -Infinity
    );
    const finalTier = lastUsefulPool.filter((d) => getLeaveOriginMins(d) >= maxLastLeave - 1);
    const tierPool = finalTier.length > 0 ? finalTier : lastUsefulPool;

    const sortedForLast = [...tierPool].sort((a, b) => {
      const aArr = getDestArrMins(a);
      const bArr = getDestArrMins(b);
      const aDoor = getDoorToDoorMins(a);
      const bDoor = getDoorToDoorMins(b);
      if (aArr > 0 && bArr > 0) {
        // Bilancia arrivo più anticipato e durata TOTALE porta-a-porta più breve
        const aCombined = aArr + aDoor;
        const bCombined = bArr + bDoor;
        if (aCombined !== bCombined) return aCombined - bCombined;
      }
      if (aDoor !== bDoor) return aDoor - bDoor;
      if (aArr > 0 && bArr > 0 && aArr !== bArr) return aArr - bArr;
      if (a.transfersCount !== b.transfersCount) return a.transfersCount - b.transfersCount;
      const aLeave = getLeaveOriginMins(a);
      const bLeave = getLeaveOriginMins(b);
      if (bLeave !== aLeave) return bLeave - aLeave;
      return getDepMins(b) - getDepMins(a);
    });
    lastUseful = sortedForLast[0];

    if (lastUseful) {
      const foundLastIdx = departures.findIndex((d) => d.id === lastUseful!.id);
      lastUsefulIndex = foundLastIdx >= 0 ? foundLastIdx : optimalIndex;
    }
  }

  return {
    optimal: chosen || departures[0],
    optimalIndex,
    lastUseful,
    lastUsefulIndex,
  };
}

export function buildStraightPolyline(
  points: { lat: number; lng: number }[]
): LatLngPoint[] {
  return points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}






/**
 * Risultato tabellone dinamico vuoto per corse non attive o rete non raggiungibile.
 * Nessuna corsa fittizia o hardcoded.
 */
export function getStaticFallbackDepartures(options: {
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
  return {
    stationName: options.stationName,
    destinationName: options.destName,
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

interface CachedTransitBoardEntry {
  timestamp: number;
  data: TransitBoardResult;
  baseKey: string;
  isLiveContext: boolean;
  rawConstraintMins: number;
  rawMinDepMins: number;
  minDepCoveredMins: number;
  maxDepCoveredMins: number;
}

const transitBoardMemoryCache = new Map<string, CachedTransitBoardEntry>();
const inFlightBoardRequests = new Map<string, Promise<TransitBoardResult>>();

function buildBoardCacheEntry(
  data: TransitBoardResult,
  baseKey: string,
  isLiveContext: boolean,
  rawConstraintMins: number,
  rawMinDepMins: number
): CachedTransitBoardEntry {
  const depMinsList = data.departures
    .map((d) => parseHHMMToMins(d.estimatedTime || d.scheduledTime))
    .filter((m) => m >= 0);
  const minDepCoveredMins = depMinsList.length > 0 ? Math.min(...depMinsList) : -1;
  const maxDepCoveredMins = depMinsList.length > 0 ? Math.max(...depMinsList) : -1;
  return {
    timestamp: Date.now(),
    data,
    baseKey,
    isLiveContext,
    rawConstraintMins,
    rawMinDepMins,
    minDepCoveredMins,
    maxDepCoveredMins,
  };
}

function isStopInsideStationHub(
  stationCoords: { lat: number; lng: number },
  stopCoords: { lat: number; lng: number },
  stationName: string,
  stopName: string
): boolean {
  const distMeters = haversineMeters(
    { latitude: stationCoords.lat, longitude: stationCoords.lng },
    { latitude: stopCoords.lat, longitude: stopCoords.lng }
  );
  // Entro 135m dal punto stazione (banchine del piazzale o accesso metro della stazione stessa)
  if (distMeters <= 135) return true;
  // Fino a 260m se il nome della fermata identifica esplicitamente lo stesso hub di stazione
  if (distMeters <= 260) {
    const stToken =
      (stationName || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(roma|stazione|staz\.?ne|fs|centrale|p\.?le|piazzale)\b/g, '')
        .trim()
        .split(/\s+/)[0] || '';
    const stopLow = (stopName || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const isExplicitHubTag =
      stopLow.includes('staz') ||
      stopLow.includes('(mb)') ||
      stopLow.includes('(ma)') ||
      stopLow.includes('(mc)') ||
      stopLow.includes('(fs)') ||
      stopLow.includes('piazzale') ||
      stopLow.includes('capolinea');
    if (stToken.length >= 3 && stopLow.includes(stToken) && isExplicitHubTag) {
      return true;
    }
  }
  return false;
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
  arrivalBufferMinutes?: number;
  preferLatestBeforeDeadline?: boolean;
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
    arrivalBufferMinutes,
    preferLatestBeforeDeadline = false,
    forceRefresh = false,
    signal,
  } = options;

  const effectiveAdvanceMins = Math.max(
    0,
    typeof arrivalBufferMinutes === 'number'
      ? arrivalBufferMinutes
      : direction === 'to_station'
        ? 5
        : 0
  );

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

  const cacheKey = `${direction}|${originLat.toFixed(4)},${originLng.toFixed(4)}|${destLat.toFixed(4)},${destLng.toFixed(4)}|${targetDate || 'today'}|${targetTime || ''}|${constraintTime || ''}|${minDepartureTime || ''}|buf:${effectiveAdvanceMins}|${preferLatestBeforeDeadline ? 'late' : 'std'}|${isLiveContext ? 'live' : 'sched'}`;
  const baseCacheKey = `${direction}|${originLat.toFixed(4)},${originLng.toFixed(4)}|${destLat.toFixed(4)},${destLng.toFixed(4)}|${targetDate || 'today'}|${isLiveContext ? 'live' : 'sched'}`;
  const reqConstraintMins = parseHHMMToMins(constraintTime);
  const reqMinDepMins = parseHHMMToMins(minDepartureTime);
  const getCacheTtl = (entry: CachedTransitBoardEntry) =>
    entry.isLiveContext ? 45000 : 600000;

  if (!forceRefresh) {
    const cached = transitBoardMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < getCacheTtl(cached)) {
      return cached.data;
    }

    // Riuso di una finestra temporale compatibile dalla cache (es. cambio verso treno adiacente)
    for (const entry of transitBoardMemoryCache.values()) {
      if (entry.baseKey !== baseCacheKey) continue;
      if (Date.now() - entry.timestamp >= getCacheTtl(entry)) continue;
      if (!entry.data.departures || entry.data.departures.length === 0) continue;
      if (entry.minDepCoveredMins < 0 || entry.maxDepCoveredMins < 0) continue;

      let windowCoversRequest = false;
      if (direction === 'to_campus') {
        const lowerBound =
          entry.rawMinDepMins > 0 ? entry.rawMinDepMins : entry.minDepCoveredMins;
        const coversStart =
          reqMinDepMins <= 0 ||
          (reqMinDepMins >= lowerBound && reqMinDepMins <= entry.maxDepCoveredMins - 10);
        const coversEnd =
          reqConstraintMins <= 0 ||
          (entry.rawConstraintMins > 0 && entry.rawConstraintMins >= reqConstraintMins - 5) ||
          entry.maxDepCoveredMins >= reqConstraintMins - 10;
        windowCoversRequest = coversStart && coversEnd;
      } else {
        const upperBound =
          entry.rawConstraintMins > 0 ? entry.rawConstraintMins : entry.maxDepCoveredMins;
        const coversEnd =
          reqConstraintMins > 0 &&
          reqConstraintMins <= upperBound &&
          reqConstraintMins >= entry.minDepCoveredMins + 15;
        const coversStart =
          reqMinDepMins <= 0 || reqMinDepMins >= entry.minDepCoveredMins - 2;
        windowCoversRequest = coversEnd && coversStart;
      }

      if (!windowCoversRequest) continue;

      let reusedDeps: TransitDepartureItem[] = entry.data.departures.map((d) => ({
        ...d,
        isSuggested: false,
        isOptimal: false,
      }));

      const nowForReuse = new Date().getHours() * 60 + new Date().getMinutes();
      const isNowReuse = isLiveContext || targetTime === 'now';
      const reuseRefMins = isNowReuse
        ? nowForReuse
        : reqMinDepMins > 0
          ? reqMinDepMins
          : reqConstraintMins > 0
            ? Math.max(0, reqConstraintMins - 60)
            : nowForReuse;

      if (reqMinDepMins > 0 || isNowReuse) {
        const effectiveReuseMin = isNowReuse
          ? Math.max(
              nowForReuse,
              reqMinDepMins > 0 ? unwrapMinutesFromRef(reqMinDepMins, nowForReuse) : 0
            )
          : unwrapMinutesFromRef(reqMinDepMins, reuseRefMins);
        const reachableFromOrigin = reusedDeps.filter((d) => {
          const depM = unwrapMinutesFromRef(
            parseHHMMToMins(d.estimatedTime || d.scheduledTime),
            reuseRefMins
          );
          if (depM < 0) return false;
          const isDelayedPendingArrival = Boolean(
            (d.delayMinutes > 0 || (d.liveDelayMinutes ?? 0) > 0) &&
              depM >= effectiveReuseMin
          );
          return (
            depM - (d.walkBeforeMinutes || 0) >= effectiveReuseMin ||
            isDelayedPendingArrival
          );
        });
        reusedDeps = reachableFromOrigin;
      } else if (direction === 'to_station' && reqConstraintMins > 0) {
        const relConstraint = unwrapMinutesFromRef(reqConstraintMins, reuseRefMins);
        const beforeTrain = reusedDeps.filter((d) => {
          const arrM = parseHHMMToMins(d.arrivalTime);
          if (arrM >= 0) {
            return unwrapMinutesFromRef(arrM, reuseRefMins) <= relConstraint + 2;
          }
          const depM = parseHHMMToMins(d.estimatedTime || d.scheduledTime);
          return (
            depM >= 0 &&
            unwrapMinutesFromRef(depM, reuseRefMins) + d.durationMinutes <= relConstraint + 2
          );
        });
        if (beforeTrain.length > 0) {
          reusedDeps = beforeTrain;
        }
      }

      if (reusedDeps.length === 0) continue;

      const { optimal, optimalIndex, lastUseful, lastUsefulIndex } = findOptimalTransitDeparture(reusedDeps, {
        direction,
        isLiveContext,
        constraintTime,
        minDepartureTime,
        targetTime,
        arrivalBufferMinutes: effectiveAdvanceMins,
        preferLatestBeforeDeadline,
      });

      const directSet = new Set<string>();
      for (const d of reusedDeps) {
        if (d.isDirect) directSet.add(d.line);
      }
      if (directSet.size === 0) {
        reusedDeps.slice(0, 4).forEach((d) => directSet.add(d.line));
      }

      return {
        ...entry.data,
        directLines: Array.from(directSet),
        departures: reusedDeps,
        pastDepartures: entry.data.pastDepartures,
        optimalDeparture: optimal,
        optimalIndex,
        lastUsefulDeparture: lastUseful,
        lastUsefulIndex,
        arrivalBufferMinutes: effectiveAdvanceMins,
        preferLatestBeforeDeadline,
      };
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
    // - In ANDATA (to_campus): la lista nella card "Mezzi" mostra i primi pullman/metro efficienti subito dopo l'arrivo del treno (o da adesso se già in stazione),
    //   e se la lezione è più avanti interroga in parallelo con arriveBy=true per individuare anche l'ultima corsa utile.
    // - Nel RITORNO (to_station): in condizioni live o con minDepartureTime definito (fine lezione / partenza immediata),
    //   interroga a partire da adesso / fine lezione con useArriveBy=false per privilegiare il mezzo più efficiente,
    //   ed esegue in parallelo arriveBy=true prima del treno per mostrare l'ultima corsa utile sulla timeline.
    let useArriveBy = false;
    let queryTimeForApi = targetTime;
    const relConstraintFromNow =
      constraintMins > 0 ? unwrapMinutesFromRef(constraintMins, nowMins) : -1;
    const relMinDepFromNow =
      minDepMins > 0 ? unwrapMinutesFromRef(minDepMins, nowMins) : -1;
    const relConstraintFromMinDep =
      constraintMins > 0 && minDepMins > 0
        ? unwrapMinutesFromRef(constraintMins, minDepMins)
        : constraintMins;

    if (!isLiveContext) {
      if (direction === 'to_station') {
        if (minDepMins > 0) {
          // In modalità standard con fine lezione nota, interroga sempre a partire dalla fine della lezione
          queryTimeForApi = minsToHHMM(minDepMins);
          useArriveBy = false;
        } else if (constraintMins >= 0) {
          // Modalità uscita anticipata / senza fine lezione: arriva in stazione con l'anticipo configurato prima del treno
          queryTimeForApi = minsToHHMM((constraintMins - effectiveAdvanceMins + 1440) % 1440);
          useArriveBy = true;
        }
      } else if (direction === 'to_campus' && minDepMins > 0) {
        // In andata mostra sempre i primi mezzi subito dopo l'arrivo del treno in stazione
        queryTimeForApi = minsToHHMM(minDepMins);
        useArriveBy = false;
      } else if (direction === 'to_campus' && constraintMins >= 0) {
        queryTimeForApi = minsToHHMM((constraintMins - effectiveAdvanceMins + 1440) % 1440);
        useArriveBy = true;
      }
    } else {
      if (direction === 'to_station') {
        if (relMinDepFromNow > nowMins + 2) {
          queryTimeForApi = minsToHHMM(minDepMins);
          useArriveBy = false;
        } else {
          queryTimeForApi = 'now';
          useArriveBy = false;
        }
      } else if (direction === 'to_campus' && relMinDepFromNow > nowMins + 2) {
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
    const [effectiveOrigin, effectiveDest] = await Promise.all([
      resolveEffectiveEndpointForRouting(
        { lat: originLat, lng: originLng },
        direction === 'to_station'
      ),
      resolveEffectiveEndpointForRouting(
        { lat: destLat, lng: destLng },
        direction === 'to_campus'
      ),
    ]);
    const planUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${effectiveOrigin.lat.toFixed(5)},${effectiveOrigin.lng.toFixed(5)}&toPlace=${effectiveDest.lat.toFixed(5)},${effectiveDest.lng.toFixed(5)}&time=${encodeURIComponent(queryIso)}${useArriveBy ? '&arriveBy=true' : ''}&numItineraries=20&detailedTransfers=false`;

    // Query parallela dedicata alle corse precedenti (-30 min) così non satura i risultati futuri su corridoi frequenti
    let pastDepUrl: string | null = null;
    if (!useArriveBy && (isLiveContext || queryTimeForApi === 'now')) {
      const anchorM = queryTimeForApi === 'now' ? nowMins : minDepMins;
      if (anchorM >= 0) {
        const lookbackM = (anchorM - 30 + 1440) % 1440;
        let pastDate = isLiveContext && queryTimeForApi === 'now' ? undefined : targetDate;
        if (anchorM < 30) {
          pastDate = resolveDateWithDayOffset(pastDate, -1);
        }
        const pastIso = buildQueryIsoTime(pastDate, minsToHHMM(lookbackM));
        pastDepUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${effectiveOrigin.lat.toFixed(5)},${effectiveOrigin.lng.toFixed(5)}&toPlace=${effectiveDest.lat.toFixed(5)},${effectiveDest.lng.toFixed(5)}&time=${encodeURIComponent(pastIso)}&numItineraries=12&detailedTransfers=false`;
      }
    }

    // Query secondaria con arriveBy=true sul vincolo comprensivo di anticipo per identificare con precisione l'ultima corsa utile
    let secondaryDepUrl: string | null = null;
    if (!useArriveBy && constraintMins >= 0) {
      const startCheckMins = isLiveContext
        ? Math.max(nowMins, relMinDepFromNow > 0 ? relMinDepFromNow : nowMins)
        : minDepMins > 0
          ? minDepMins
          : nowMins;
      const targetConstraintRel = isLiveContext ? relConstraintFromNow : relConstraintFromMinDep;
      const targetEffectiveRel = targetConstraintRel - effectiveAdvanceMins;
      const minGap =
        preferLatestBeforeDeadline && direction === 'to_station'
          ? 0
          : direction === 'to_station'
            ? 12
            : 20;
      if (targetEffectiveRel > startCheckMins + minGap) {
        const secMins = (constraintMins - effectiveAdvanceMins + 1440) % 1440;
        const secDayOffset =
          (targetConstraintRel > 1439 ? 1 : 0) -
          (constraintMins < effectiveAdvanceMins ? 1 : 0);
        const secBaseDate = isLiveContext ? undefined : targetDate;
        const secDate = resolveDateWithDayOffset(secBaseDate, secDayOffset);
        secondaryDepUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${effectiveOrigin.lat.toFixed(5)},${effectiveOrigin.lng.toFixed(5)}&toPlace=${effectiveDest.lat.toFixed(5)},${effectiveDest.lng.toFixed(5)}&time=${encodeURIComponent(
          buildQueryIsoTime(secDate, minsToHHMM(secMins))
        )}&arriveBy=true&numItineraries=15&detailedTransfers=false`;
      }
    }

    // Avvia il prefetch delle fermate circostanti in parallelo a MOTIS /plan (rimuove lo stadio dal percorso seriale)
    prefetchTransitousStopsBoxes(effectiveOrigin, effectiveDest);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const onExternalAbort = () => controller.abort();
      if (signal) {
        signal.addEventListener('abort', onExternalAbort);
      }

      const reqHeaders = {
        'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
        Accept: 'application/json',
      };

      const isQueryToday = (() => {
        if (!targetDate) return true;
        const todayIso = new Date().toISOString().slice(0, 10);
        return targetDate.trim() === todayIso;
      })();

      const [res, secRes, pastRes, liveWeather] = await Promise.all([
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
        pastDepUrl
          ? fetch(pastDepUrl, {
              signal: controller.signal,
              headers: reqHeaders,
            }).catch(() => null)
          : Promise.resolve(null),
        isQueryToday
          ? fetchLiveUrbanWeather(effectiveOrigin.lat, effectiveOrigin.lng).catch(
              () => null
            )
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
      let pastItineraries: any[] = [];
      if (pastRes && pastRes.ok) {
        try {
          const pastData = await pastRes.json();
          if (Array.isArray(pastData?.itineraries)) {
            pastItineraries = pastData.itineraries;
          }
        } catch {
          // Ignora errore opzionale sulla query lookback
        }
      }
      const itineraries: any[] = [
        ...primaryItineraries,
        ...secondaryItineraries,
        ...pastItineraries,
      ];

      const existingTripIds = new Set<string>();
      const preferredLinesHint = new Set<string>();
      for (const it of itineraries) {
        const trLegs = Array.isArray(it?.legs)
          ? it.legs.filter((l: any) => l?.mode && l.mode !== 'WALK')
          : [];
        for (const tl of trLegs) {
          if (tl?.tripId) existingTripIds.add(tl.tripId);
          if (trLegs.length === 1 && tl?.routeShortName) {
            preferredLinesHint.add(String(tl.routeShortName).trim().toUpperCase());
          }
        }
      }

      const corridorStartIso = useArriveBy
        ? itineraries.reduce<string>((minIso, it) => {
            const st = it?.startTime;
            return st && (!minIso || st < minIso) ? st : minIso;
          }, '') || new Date(new Date(queryIso).getTime() - 45 * 60000).toISOString()
        : queryIso;

      try {
        const extraItins = await fetchCloserCorridorItineraries({
          originCoords: effectiveOrigin,
          destCoords: effectiveDest,
          destName: direction === 'to_station' ? stationName : targetName,
          queryIso: corridorStartIso,
          windowMinutes: useArriveBy ? 75 : 120,
          existingTripIds,
          preferredLinesHint,
        });
        if (extraItins.length > 0) {
          itineraries.push(...extraItins);
        }
      } catch {
        // Arricchimento opzionale: prosegue con gli itinerari /plan principali
      }

      const originLeaveEpochMs = !useArriveBy ? new Date(queryIso).getTime() : undefined;
      // Raggruppa per pattern (linea|direzione|fermata salita|fermata discesa):
      // sonda prima 1 corsa rappresentativa per pattern così i pattern già ottimali saltano /v5/trip per tutte le altre corse.
      const singleLegTasks: { legsArr: any[]; tIdx: number; patternKey: string }[] = [];
      for (const it of itineraries.slice(0, 18)) {
        const legsArr = Array.isArray(it?.legs) ? it.legs : [];
        const trIdxs = legsArr
          .map((l: any, idx: number) => (l?.mode && l.mode !== 'WALK' ? idx : -1))
          .filter((idx: number) => idx >= 0);
        if (trIdxs.length !== 1) continue;
        const tIdx = trIdxs[0];
        const leg = legsArr[tIdx];
        const patternKey = `${leg?.routeId || leg?.routeShortName || ''}|${leg?.directionId || ''}|${leg?.from?.stopId || ''}|${leg?.to?.stopId || ''}`;
        singleLegTasks.push({ legsArr, tIdx, patternKey });
      }
      const firstByPattern: typeof singleLegTasks = [];
      const restByPattern: typeof singleLegTasks = [];
      const seenPatternKeys = new Set<string>();
      for (const item of singleLegTasks) {
        if (!seenPatternKeys.has(item.patternKey)) {
          seenPatternKeys.add(item.patternKey);
          firstByPattern.push(item);
        } else {
          restByPattern.push(item);
        }
      }
      const runOptItem = async (item: (typeof singleLegTasks)[number]) => {
        const optLeg = await optimizeSingleLegStopsViaTrip({
          leg: item.legsArr[item.tIdx],
          originCoords: effectiveOrigin,
          destCoords: effectiveDest,
          originLeaveEpochMs,
        });
        if (optLeg !== item.legsArr[item.tIdx]) {
          item.legsArr[item.tIdx] = optLeg;
        }
      };
      await Promise.all(firstByPattern.map(runOptItem));
      if (restByPattern.length > 0) {
        await Promise.all(restByPattern.map(runOptItem));
      }

      // Risolve dinamicamente i tragitti pedonali reali su marciapiede per le fermate uniche
      // (eliminando giri viziosi da cortili interni OSM e velocità pedonali MOTIS troppo lente)
      const uniqueBoardStops = new Map<string, { lat: number; lng: number; name: string }>();
      const uniqueAlightStops = new Map<string, { lat: number; lng: number }>();
      for (const it of itineraries) {
        const legsArr = Array.isArray(it?.legs) ? it.legs : [];
        const trLegs = legsArr.filter((l: any) => l?.mode && l.mode !== 'WALK');
        if (trLegs.length === 0) continue;
        const firstTr = trLegs[0];
        const lastTr = trLegs[trLegs.length - 1];
        if (typeof firstTr?.from?.lat === 'number' && typeof firstTr?.from?.lon === 'number') {
          const k = `${firstTr.from.lat.toFixed(4)},${firstTr.from.lon.toFixed(4)}`;
          if (!uniqueBoardStops.has(k) && uniqueBoardStops.size < 8) {
            uniqueBoardStops.set(k, {
              lat: firstTr.from.lat,
              lng: firstTr.from.lon,
              name: firstTr.from.name || '',
            });
          }
        }
        if (typeof lastTr?.to?.lat === 'number' && typeof lastTr?.to?.lon === 'number') {
          const k = `${lastTr.to.lat.toFixed(4)},${lastTr.to.lon.toFixed(4)}`;
          if (!uniqueAlightStops.has(k) && uniqueAlightStops.size < 8) {
            uniqueAlightStops.set(k, { lat: lastTr.to.lat, lng: lastTr.to.lon });
          }
        }
      }

      const preWalkBeforeList: {
        stop: { lat: number; lng: number };
        metrics: { polyline: LatLngPoint[]; distanceMeters: number; minutes: number };
      }[] = [];
      const preWalkAfterList: {
        stop: { lat: number; lng: number };
        metrics: { polyline: LatLngPoint[]; distanceMeters: number; minutes: number };
      }[] = [];

      try {
        const rawOrig = { lat: originLat, lng: originLng };
        const rawDest = { lat: destLat, lng: destLng };
        const [beforeResults, afterResults] = await Promise.all([
          Promise.all(
            Array.from(uniqueBoardStops.values()).map(async (stop) => {
              if (
                direction === 'to_campus' &&
                isStopInsideStationHub(rawOrig, stop, stationName, stop.name)
              ) {
                return {
                  stop,
                  metrics: { polyline: [], distanceMeters: 0, minutes: 0 },
                };
              }
              return {
                stop,
                metrics: await resolveWalkLegMetrics(rawOrig, stop),
              };
            })
          ),
          Promise.all(
            Array.from(uniqueAlightStops.values()).map(async (stop) => ({
              stop,
              metrics: await resolveWalkLegMetrics(stop, rawDest),
            }))
          ),
        ]);
        preWalkBeforeList.push(...beforeResults);
        preWalkAfterList.push(...afterResults);
      } catch {
        // fallback al calcolo locale esistente
      }

      const findPreWalkMatch = (
        list: {
          stop: { lat: number; lng: number };
          metrics: { polyline: LatLngPoint[]; distanceMeters: number; minutes: number };
        }[],
        coord: { lat: number; lng: number }
      ) => {
        let best: { polyline: LatLngPoint[]; distanceMeters: number; minutes: number } | null = null;
        let bestD = 160;
        for (const item of list) {
          const d = haversineMeters(
            { latitude: item.stop.lat, longitude: item.stop.lng },
            { latitude: coord.lat, longitude: coord.lng }
          );
          if (d < bestD) {
            bestD = d;
            best = item.metrics;
          }
        }
        return best;
      };

      if (itineraries.length === 0) {
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

      const pendingItems: {
        primaryLeg: any;
        transitLegs: any[];
        draft: Omit<TransitDepartureItem, 'headsign'>;
      }[] = [];
      const clockDiffMins = (startMins: number, endMins: number): number => {
        if (startMins < 0 || endMins < 0) return 0;
        let diff = endMins - startMins;
        if (diff < -720) diff += 1440;
        return Math.max(0, diff);
      };
      const signedClockDiffMins = (schedMins: number, actualMins: number): number => {
        if (schedMins < 0 || actualMins < 0) return 0;
        let diff = actualMins - schedMins;
        if (diff < -720) diff += 1440;
        if (diff > 720) diff -= 1440;
        return diff;
      };
      const resolvedTripDate = (() => {
        if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate.trim())) {
          const parsed = new Date(`${targetDate.trim()}T12:00:00`);
          if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
      })();
      const nowClockDate = new Date();
      const nowClockMins =
        nowClockDate.getHours() * 60 + nowClockDate.getMinutes();
      const todayIsoStr = nowClockDate.toISOString().slice(0, 10);
      const isTargetDayToday =
        resolvedTripDate.toDateString() === nowClockDate.toDateString();

      // Raccoglie i ritardi GPS reali osservati adesso sulle corse di superficie dello stesso corridoio
      const liveCorridorSamples: { line: string; delayMins: number }[] = [];
      if (isTargetDayToday) {
        for (const itSample of itineraries) {
          const sampleLegs: any[] = Array.isArray(itSample?.legs)
            ? itSample.legs
            : [];
          for (const sl of sampleLegs) {
            if (
              !sl ||
              sl.mode === 'WALK' ||
              sl.mode === 'SUBWAY' ||
              sl.mode === 'METRO' ||
              sl.mode === 'RAIL'
            ) {
              continue;
            }
            const isSlRealtime =
              sl.realTime === true ||
              sl.departureTimestampReason === 'REALTIME' ||
              sl.arrivalTimestampReason === 'REALTIME';
            if (!isSlRealtime) continue;
            const sSched = parseHHMMToMins(
              formatIsoToHHMM(sl.scheduledStartTime || sl.startTime)
            );
            const sLive = parseHHMMToMins(formatIsoToHHMM(sl.startTime));
            if (sSched < 0 || sLive < 0) continue;
            const deltaFromNow = signedClockDiffMins(nowClockMins, sLive);
            if (deltaFromNow < -10 || deltaFromNow > 65) continue;
            const dM = Math.max(0, signedClockDiffMins(sSched, sLive));
            liveCorridorSamples.push({
              line: String(sl.routeShortName || '').trim().toUpperCase(),
              delayMins: dM,
            });
          }
        }
      }
      const getObservedCorridorDelay = (lineName: string): number | null => {
        if (!isTargetDayToday || liveCorridorSamples.length === 0) return null;
        const normL = lineName.trim().toUpperCase();
        const sameLine = liveCorridorSamples.filter((s) => s.line === normL);
        if (sameLine.length > 0) {
          const sum = sameLine.reduce((a, b) => a + b.delayMins, 0);
          return Math.round(sum / sameLine.length);
        }
        const sumAll = liveCorridorSamples.reduce((a, b) => a + b.delayMins, 0);
        return Math.round(sumAll / liveCorridorSamples.length);
      };

      // Eventi reali di viabilità e scioperi TPL attivi oggi dalla cache di disruptionsService
      const todayActiveDisruptions = isTargetDayToday
        ? getCachedDisruptionsSync().filter(
            (ev) =>
              ev.startDate <= todayIsoStr &&
              ev.endDate >= todayIsoStr &&
              !ev.isNocturnal &&
              ev.aiImpactsPassengerService !== false
          )
        : [];
      const hasActiveTplStrikeToday = todayActiveDisruptions.some(
        (ev) => ev.category === 'sciopero_tpl'
      );
      const hasUrbanDisruptionForLine = (lineName: string): boolean => {
        if (todayActiveDisruptions.length === 0) return false;
        const cleanL = lineName.replace(/[^\w]/g, '');
        const lineRe = cleanL ? new RegExp(`\\b${cleanL}\\b`, 'i') : null;
        return todayActiveDisruptions.some((ev) => {
          if (ev.category === 'sciopero_treni' || ev.category === 'sciopero_tpl') {
            return false;
          }
          const txt = `${ev.title} ${ev.notes || ''} ${(ev.affectedAreas || []).join(' ')}`;
          return Boolean(
            (lineRe && lineRe.test(txt)) ||
              /tiburtin|regina elena|policlinic|sapienza|termini|nomentan|verano|castro pretorio/i.test(
                txt
              )
          );
        });
      };
      const computePolylineGeometryMetrics = (
        pts: LatLngPoint[],
        fbFrom?: { lat: number; lng: number },
        fbTo?: { lat: number; lng: number }
      ): { distanceKm: number; intersectionsCount: number } => {
        if (pts.length >= 2) {
          let meters = 0;
          let turns = 0;
          let distSincePrevBearing = 0;
          let prevBearing: number | null = null;
          for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const segM = haversineMeters(p0, p1);
            meters += segM;
            distSincePrevBearing += segM;
            if (distSincePrevBearing >= 45) {
              const dLat = p1.latitude - p0.latitude;
              const dLon =
                (p1.longitude - p0.longitude) *
                Math.cos(((p0.latitude + p1.latitude) * 0.5 * Math.PI) / 180);
              const bearing = (Math.atan2(dLon, dLat) * 180) / Math.PI;
              if (prevBearing !== null) {
                let delta = Math.abs(bearing - prevBearing);
                if (delta > 180) delta = 360 - delta;
                if (delta >= 26) turns++;
              }
              prevBearing = bearing;
              distSincePrevBearing = 0;
            }
          }
          const distanceKm = Math.max(0.25, meters / 1000);
          // Somma svolte geometriche reali + incroci semaforici tipici lungo i rettilinei urbani
          const intersectionsCount = Math.max(
            1,
            turns + Math.round(distanceKm * 1.35)
          );
          return { distanceKm, intersectionsCount };
        }
        if (fbFrom && fbTo) {
          const straightM = haversineMeters(
            { latitude: fbFrom.lat, longitude: fbFrom.lng },
            { latitude: fbTo.lat, longitude: fbTo.lng }
          );
          const distanceKm = Math.max(0.25, (straightM * 1.28) / 1000);
          return {
            distanceKm,
            intersectionsCount: Math.max(2, Math.round(distanceKm * 2.2)),
          };
        }
        return { distanceKm: 1.5, intersectionsCount: 3 };
      };
      const isOuterOriginRailwayStation =
        direction === 'to_campus' &&
        Boolean(stationName) &&
        !stationName.toLowerCase().includes('mia posizione');
      const isLikelyTerminusStop = (stopName: string): boolean => {
        const low = (stopName || '').toLowerCase();
        if (!low) return false;
        if (
          isOuterOriginRailwayStation &&
          (low.includes('staz') ||
            low.includes('termini') ||
            low.includes('tiburtina') ||
            low.includes('ostiense') ||
            low.includes('trastevere') ||
            low.includes('tuscolana') ||
            low.includes('nomentana') ||
            low.includes('san pietro'))
        ) {
          return true;
        }
        return (
          low.includes('staz.ne') ||
          low.includes('capolinea') ||
          low.includes('autostazione')
        );
      };
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
        let fromStopCoords = snapStopToRoadway(primaryLeg.from?.name, rawFromCoords);

        const rawToCoords =
          lastTransitLeg.to?.lat && lastTransitLeg.to?.lon
            ? { lat: lastTransitLeg.to.lat, lng: lastTransitLeg.to.lon }
            : { lat: destLat, lng: destLng };
        let toStopCoords = snapStopToRoadway(lastTransitLeg.to?.name, rawToCoords);
        let toStopName = formatStopDisplayName(lastTransitLeg.to?.name || '');

        const finalDestCoords = { lat: destLat, lng: destLng };
        const originCoords = { lat: originLat, lng: originLng };

        // Filtro direzionale dinamico generale (valido per qualsiasi linea e qualsiasi tratta):
        // Scarta corse che vanno nel verso opposto, che non avvicinano sensibilmente alla destinazione
        // (es. 1 fermata nel verso sbagliato + lunga camminata), o che compiono un intero giro circolare opposto.
        const directOriginDestDist = haversineMeters(
          { latitude: originCoords.lat, longitude: originCoords.lng },
          { latitude: finalDestCoords.lat, longitude: finalDestCoords.lng }
        );
        if (directOriginDestDist > 250) {
          const fromDistToDest = haversineMeters(
            { latitude: rawFromCoords.lat, longitude: rawFromCoords.lng },
            { latitude: finalDestCoords.lat, longitude: finalDestCoords.lng }
          );
          const toDistToDest = haversineMeters(
            { latitude: rawToCoords.lat, longitude: rawToCoords.lng },
            { latitude: finalDestCoords.lat, longitude: finalDestCoords.lng }
          );
          const fromDistToOrig = haversineMeters(
            { latitude: rawFromCoords.lat, longitude: rawFromCoords.lng },
            { latitude: originCoords.lat, longitude: originCoords.lng }
          );
          const toDistToOrig = haversineMeters(
            { latitude: rawToCoords.lat, longitude: rawToCoords.lng },
            { latitude: originCoords.lat, longitude: originCoords.lng }
          );
          const minRequiredProgress = Math.min(180, directOriginDestDist * 0.2);
          // 1) Il tragitto sul mezzo deve effettivamente ridurre la distanza dalla destinazione
          // 2) La fermata di salita deve trovarsi sul lato dell'origine e quella di discesa sul lato della destinazione
          if (
            toDistToDest > fromDistToDest - minRequiredProgress ||
            fromDistToOrig >= fromDistToDest + 40 ||
            toDistToDest >= toDistToOrig + 40
          ) {
            continue;
          }
        }

        const rawIntermediate: any[] = Array.isArray(primaryLeg.intermediateStops)
          ? primaryLeg.intermediateStops
          : [];
        let intermediateStopCoords = rawIntermediate
          .filter((s) => s?.name && typeof s.lat === 'number' && typeof s.lon === 'number')
          .map((s) => {
            const snapped = snapStopToRoadway(s.name, { lat: s.lat, lng: s.lon });
            return {
              name: formatStopDisplayName(s.name),
              lat: snapped.lat,
              lng: snapped.lng,
            };
          });

        // Verifica anti-loop sulle fermate intermedie (es. corsa circolare presa sul lato opposto che fa tutto il giro della città)
        if (isDirect && intermediateStopCoords.length >= 2 && directOriginDestDist > 250) {
          const fromStopDistOrig = haversineMeters(
            { latitude: rawFromCoords.lat, longitude: rawFromCoords.lng },
            { latitude: originCoords.lat, longitude: originCoords.lng }
          );
          let hasCircularLoopBack = false;
          let maxDistFromOriginAlongRide = fromStopDistOrig;
          let cumulativeStopsDist = 0;
          let prevPt = { latitude: rawFromCoords.lat, longitude: rawFromCoords.lng };
          for (const intStop of intermediateStopCoords) {
            const curPt = { latitude: intStop.lat, longitude: intStop.lng };
            cumulativeStopsDist += haversineMeters(prevPt, curPt);
            prevPt = curPt;
            const dOrig = haversineMeters(curPt, {
              latitude: originCoords.lat,
              longitude: originCoords.lng,
            });
            if (dOrig > maxDistFromOriginAlongRide) {
              maxDistFromOriginAlongRide = dOrig;
            } else if (
              maxDistFromOriginAlongRide > Math.max(700, fromStopDistOrig + 450) &&
              dOrig <= Math.max(240, fromStopDistOrig + 80)
            ) {
              hasCircularLoopBack = true;
              break;
            }
          }
          cumulativeStopsDist += haversineMeters(prevPt, {
            latitude: rawToCoords.lat,
            longitude: rawToCoords.lng,
          });
          const straightRideDist = haversineMeters(
            { latitude: rawFromCoords.lat, longitude: rawFromCoords.lng },
            { latitude: rawToCoords.lat, longitude: rawToCoords.lng }
          );
          if (
            hasCircularLoopBack ||
            (straightRideDist > 350 &&
              cumulativeStopsDist > Math.max(1500, straightRideDist * 2.4))
          ) {
            continue;
          }
        }

        let intermediateStopNames = intermediateStopCoords.map((s) => s.name);

        // OTTIMIZZAZIONE GENERICA PER IL MINOR TEMPO A PIEDI:
        // Si applica unicamente alle corse dirette (1 tratta transit):
        // In ENTRAMBE le direzioni ('to_campus' e 'to_station'), la destinazione da raggiungere a piedi dal mezzo è finalDestCoords!
        if (isDirect && transitLegs.length === 1) {
          const optStop = optimizeTransitStopForMinWalk({
            direction,
            currentStopName: toStopName,
            currentStopCoords: toStopCoords,
            boardStopCoords: fromStopCoords,
            targetCoords: finalDestCoords,
            intermediateStops: intermediateStopCoords,
            lineShort,
            mode,
          });

          if (optStop.didChange) {
            toStopName = optStop.optimizedStopName;
            toStopCoords = optStop.optimizedStopCoords;
            intermediateStopCoords = optStop.optimizedIntermediateStops;
            intermediateStopNames = intermediateStopCoords.map((s) => s.name);
          }
        }
        const intermediateStopsCount = intermediateStopNames.length + 1;

        // Decodifica le polilinee reali del mezzo e dei tratti a piedi (singolo passaggio di pruning in resolveOptimizedTransitPolyline)
        const rawTransitPolyline: LatLngPoint[] = [];
        for (const tl of transitLegs) {
          const pts = decodeEncodedPolyline(
            tl.legGeometry?.points,
            tl.legGeometry?.precision || 6
          );
          rawTransitPolyline.push(...pts);
        }

        const optimizedTransitPolyline = resolveOptimizedTransitPolyline(
          primaryLeg.from?.name || '',
          lastTransitLeg.to?.name || '',
          fromStopCoords,
          toStopCoords,
          rawTransitPolyline
        );
        const transitPolyline = ensureContinuousTransitPolyline(
          { latitude: fromStopCoords.lat, longitude: fromStopCoords.lng },
          { latitude: toStopCoords.lat, longitude: toStopCoords.lng },
          intermediateStopCoords,
          optimizedTransitPolyline
        );

        // Aggancio matematico generico delle coordinate di fermata alla carreggiata stradale:
        // Sposta i marker da eventuali cortili/edifici privati (coordinate GTFS grezze) alla banchina del marciapiede stradale
        if (transitPolyline.length >= 2) {
          const snappedFrom = snapCoordinateToPolyline(fromStopCoords, transitPolyline, 150);
          fromStopCoords = { lat: snappedFrom.latitude, lng: snappedFrom.longitude };

          const snappedTo = snapCoordinateToPolyline(toStopCoords, transitPolyline, 150);
          toStopCoords = { lat: snappedTo.latitude, lng: snappedTo.longitude };

          intermediateStopCoords = intermediateStopCoords.map((s) => {
            const snappedInt = snapCoordinateToPolyline({ lat: s.lat, lng: s.lng }, transitPolyline, 150);
            return {
              name: s.name,
              lat: snappedInt.latitude,
              lng: snappedInt.longitude,
            };
          });
        }

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

        const preBefore = findPreWalkMatch(preWalkBeforeList, fromStopCoords);
        if (preBefore && preBefore.polyline.length >= 2) {
          walkBeforePolyline.length = 0;
          walkBeforePolyline.push(...preBefore.polyline);
        }

        const preAfter = findPreWalkMatch(preWalkAfterList, toStopCoords);
        if (preAfter && preAfter.polyline.length >= 2) {
          walkAfterPolyline.length = 0;
          walkAfterPolyline.push(...preAfter.polyline);
        }

        // Se l'utente parte dai binari di una stazione reale in andata (non da GPS libero),
        // calcola sempre il tempo reale a piedi dal binario alla fermata di salita del mezzo/metro,
        // garantendo una stima realistica minima per uscita banchina/sottopassaggio anche dentro l'hub stazione.
        const isOriginRailwayStation =
          direction === 'to_campus' &&
          Boolean(stationName) &&
          !stationName.toLowerCase().includes('mia posizione');
        const isAtOriginStationHub =
          isOriginRailwayStation &&
          isStopInsideStationHub(
            originCoords,
            fromStopCoords,
            stationName,
            primaryLeg.from?.name || ''
          );
        const effectiveOriginCoords = originCoords;

        // Calcolo verificato della camminata reale (rete pedonale urbana reale senza deviazioni da cortili chiusi)
        const realWalkBefore = calculateRealWalkMinutes(
          originCoords,
          fromStopCoords,
          walkBeforePolyline
        );
        const realWalkAfter = calculateRealWalkMinutes(toStopCoords, finalDestCoords, walkAfterPolyline);

        const walkBeforeSec = walkBeforeLegs.reduce(
          (acc, l) => acc + (typeof l.duration === 'number' ? l.duration : 0),
          0
        );
        const apiBeforeMin = Math.round(walkBeforeSec / 60);
        const rawWalkBeforeMinutes = preBefore
          ? preBefore.minutes
          : apiBeforeMin > 0 && Math.abs(apiBeforeMin - realWalkBefore.minutes) <= 1
            ? apiBeforeMin
            : realWalkBefore.minutes;

        let walkBeforeMinutes = rawWalkBeforeMinutes;
        if (isOriginRailwayStation) {
          const stLow = stationName.toLowerCase();
          const isMajorRailHub =
            stLow.includes('termini') ||
            stLow.includes('tiburtina') ||
            stLow.includes('ostiense') ||
            stLow.includes('trastevere');
          const minPlatformWalk = isAtOriginStationHub
            ? isMajorRailHub && (mode === 'metro' || realWalkBefore.distanceMeters >= 80)
              ? 3
              : 2
            : 1;
          walkBeforeMinutes = Math.max(minPlatformWalk, rawWalkBeforeMinutes);
        }

        // 2) Raccolta avvisi attivi su tutte le tratte (inclusi cantieri/deviazioni/traffico)
        const alertMsgs: string[] = [];
        for (const tl of transitLegs) {
          if (Array.isArray(tl.alerts)) {
            for (const al of tl.alerts) {
              const header = (al.headerText || '').trim();
              const desc = (al.descriptionText || '')
                .replace(/\r\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              const combined =
                header && desc && !desc.startsWith(header)
                  ? `${header}: ${desc}`
                  : header || desc;
              if (combined && !alertMsgs.includes(combined)) {
                alertMsgs.push(combined);
              }
            }
          }
        }
        const hasActiveRoadAlert = alertMsgs.some((msg) =>
          /deviazion|traffico|rallentament|lavori|cantiere|chiusur|incidente/i.test(msg)
        );

        // 3) Costruzione tratte con estrazione completa ritardi live GTFS-RT (anche da scostamento ISO MOTIS v5)
        //    + calcolo DINAMICO del ritardo da traffico stradale (stesso motore fisico/temporale dell'andata)
        let prevLegEffEndM = -1;
        let prevLegSchedEndM = -1;
        const transferLegDetails: TransitLegDetail[] = transitLegs.map((tl, legIdx) => {
          const tlMode: 'bus' | 'metro' | 'tram' | 'rail' =
            tl.mode === 'SUBWAY' || tl.mode === 'METRO'
              ? 'metro'
              : tl.mode === 'TRAM'
                ? 'tram'
                : tl.mode === 'RAIL'
                  ? 'rail'
                  : 'bus';
          const tlLine = tl.routeShortName || (tlMode === 'metro' ? 'Metro B' : 'Bus');

          const schedStartStr = formatIsoToHHMM(tl.scheduledStartTime || tl.startTime);
          const schedEndStr = formatIsoToHHMM(tl.scheduledEndTime || tl.endTime);
          const liveStartStr = formatIsoToHHMM(tl.startTime);
          const liveEndStr = formatIsoToHHMM(tl.endTime);

          const schedStartM = parseHHMMToMins(schedStartStr);
          const schedEndM = parseHHMMToMins(schedEndStr);
          const liveStartM = parseHHMMToMins(liveStartStr);
          const liveEndM = parseHHMMToMins(liveEndStr);

          const schedDur =
            schedStartM >= 0 && schedEndM >= 0
              ? Math.max(1, clockDiffMins(schedStartM, schedEndM))
              : typeof tl.duration === 'number' && tl.duration > 0
                ? Math.max(1, Math.round(tl.duration / 60))
                : 5;

          const startEpoch = tl.startTime ? new Date(tl.startTime).getTime() : NaN;
          const schedStartEpoch = tl.scheduledStartTime
            ? new Date(tl.scheduledStartTime).getTime()
            : startEpoch;
          const endEpoch = tl.endTime ? new Date(tl.endTime).getTime() : NaN;
          const schedEndEpoch = tl.scheduledEndTime
            ? new Date(tl.scheduledEndTime).getTime()
            : endEpoch;

          const isoDepDiffSec =
            !isNaN(startEpoch) && !isNaN(schedStartEpoch)
              ? (startEpoch - schedStartEpoch) / 1000
              : 0;
          const isoArrDiffSec =
            !isNaN(endEpoch) && !isNaN(schedEndEpoch)
              ? (endEpoch - schedEndEpoch) / 1000
              : 0;

          const rawDepDelaySec =
            typeof tl.departureDelay === 'number' ? tl.departureDelay : isoDepDiffSec;
          const rawArrDelaySec =
            typeof tl.arrivalDelay === 'number' ? tl.arrivalDelay : isoArrDiffSec;

          const legHasRealtimeFlag = Boolean(
            isLiveContext &&
              (tl.realTime === true ||
                tl.departureTimestampReason === 'REALTIME' ||
                tl.arrivalTimestampReason === 'REALTIME' ||
                Math.abs(rawDepDelaySec) >= 45 ||
                Math.abs(rawArrDelaySec) >= 45)
          );

          const liveDepDelayMins = legHasRealtimeFlag
            ? Math.max(
                0,
                schedStartM >= 0 && liveStartM >= 0
                  ? signedClockDiffMins(schedStartM, liveStartM)
                  : Math.round(rawDepDelaySec / 60)
              )
            : 0;
          const liveRideDur =
            legHasRealtimeFlag && liveStartM >= 0 && liveEndM >= 0
              ? Math.max(1, clockDiffMins(liveStartM, liveEndM))
              : schedDur;

          const intStops = Array.isArray(tl.intermediateStops)
            ? tl.intermediateStops
                .filter((s: any) => s?.name)
                .map((s: any) => formatStopDisplayName(s.name))
            : [];
          const legPts = decodeEncodedPolyline(
            tl.legGeometry?.points,
            tl.legGeometry?.precision || 6
          );
          const rawFrom =
            tl.from && typeof tl.from.lat === 'number'
              ? { lat: tl.from.lat, lng: tl.from.lon }
              : undefined;
          const rawTo =
            tl.to && typeof tl.to.lat === 'number'
              ? { lat: tl.to.lat, lng: tl.to.lon }
              : undefined;
          const cleanedLegPts =
            legPts.length >= 2 ? pruneAnomalousLoopsAndSpikes(legPts) : legPts;
          const continuousLegPolyline =
            legIdx === 0 && isDirect && transitPolyline.length >= 2
              ? transitPolyline
              : cleanedLegPts.length >= 2
                ? ensureContinuousTransitPolyline(
                    rawFrom ? { latitude: rawFrom.lat, longitude: rawFrom.lng } : undefined,
                    rawTo ? { latitude: rawTo.lat, longitude: rawTo.lng } : undefined,
                    [],
                    cleanedLegPts
                  )
                : undefined;

          let snappedLegFrom = rawFrom;
          let snappedLegTo = rawTo;
          if (continuousLegPolyline && continuousLegPolyline.length >= 2) {
            if (rawFrom) {
              const sF = snapCoordinateToPolyline(rawFrom, continuousLegPolyline, 150);
              snappedLegFrom = { lat: sF.latitude, lng: sF.longitude };
            }
            if (rawTo) {
              const sT = snapCoordinateToPolyline(rawTo, continuousLegPolyline, 150);
              snappedLegTo = { lat: sT.latitude, lng: sT.longitude };
            }
          }

          const legStopsCount =
            legIdx === 0 && isDirect ? intermediateStopsCount : intStops.length + 1;
          const geom = computePolylineGeometryMetrics(
            continuousLegPolyline || [],
            snappedLegFrom,
            snappedLegTo
          );
          // Il traffico previsto non ufficiale si calcola SOLO nella finestra ravvicinata (~1 ora da adesso, oggi)
          const refCheckM = liveStartM >= 0 ? liveStartM : schedStartM;
          const diffFromNowM =
            isTargetDayToday && refCheckM >= 0
              ? signedClockDiffMins(nowClockMins, refCheckM)
              : 9999;
          const isWithinLiveTrafficWindow =
            isTargetDayToday && diffFromNowM >= -5 && diffFromNowM <= 65;

          const fluency = analyzeTransitRouteFluency({
            mode: tlMode,
            distanceKm: geom.distanceKm,
            baseRideMinutes: schedDur,
            intersectionsCount: geom.intersectionsCount,
            stopsCount: legStopsCount,
            isOriginTerminus:
              legIdx === 0 && isLikelyTerminusStop(tl.from?.name || ''),
            targetTimeStr: schedStartStr || liveStartStr,
            targetDate: resolvedTripDate,
            isWithinLiveWindow: isWithinLiveTrafficWindow,
            observedCorridorDelayMins: getObservedCorridorDelay(tlLine),
            weather: isWithinLiveTrafficWindow ? liveWeather : null,
            hasActiveRoadAlert,
            hasActiveUrbanDisruption: hasUrbanDisruptionForLine(tlLine),
          });

          // Se il mezzo trasmette già telemetria live GTFS-RT, la partenza usa il dato satellitare reale
          // (evitando doppio conteggio del traffico a monte); altrimenti usa la stima dinamica a monte.
          const appliedDepTraffic = legHasRealtimeFlag
            ? 0
            : fluency.departureTrafficDelayMinutes;
          let effStartM =
            schedStartM >= 0
              ? (schedStartM + (legHasRealtimeFlag ? liveDepDelayMins : appliedDepTraffic)) % 1440
              : liveStartM;

          // Nei cambi multi-tratta preserva il tempo minimo di interscambio se la tratta precedente ha accumulato ritardo
          if (legIdx > 0 && prevLegEffEndM >= 0) {
            const minTransferGap =
              prevLegSchedEndM >= 0 && schedStartM >= 0
                ? Math.min(4, clockDiffMins(prevLegSchedEndM, schedStartM))
                : 1;
            const minNextBoardM = (prevLegEffEndM + minTransferGap) % 1440;
            if (effStartM >= 0 && signedClockDiffMins(minNextBoardM, effStartM) < 0) {
              effStartM = minNextBoardM;
            }
          }

          const liveRideStretch = Math.max(0, liveRideDur - schedDur);
          const effRideStretch = Math.max(liveRideStretch, fluency.rideTrafficDelayMinutes);
          const appliedRideTraffic = Math.max(0, effRideStretch - liveRideStretch);
          const effDur = Math.max(1, schedDur + effRideStretch);
          const effEndM =
            effStartM >= 0 ? (effStartM + effDur) % 1440 : liveEndM;

          prevLegEffEndM = effEndM;
          prevLegSchedEndM = schedEndM;

          const legLiveTotal = liveDepDelayMins + liveRideStretch;
          const legTrafficTotal = appliedDepTraffic + appliedRideTraffic;
          const legTotalDelay =
            schedEndM >= 0 && effEndM >= 0
              ? Math.max(0, signedClockDiffMins(schedEndM, effEndM))
              : legLiveTotal + legTrafficTotal;

          return {
            line: tlLine,
            mode: tlMode,
            headsign: formatStopDisplayName(tl.headsign || ''),
            fromStop: formatStopDisplayName(tl.from?.name || ''),
            toStop: formatStopDisplayName(tl.to?.name || ''),
            fromStopCoords: snappedLegFrom,
            toStopCoords: snappedLegTo,
            departureTime: effStartM >= 0 ? minsToHHMM(effStartM) : liveStartStr || undefined,
            scheduledDepartureTime: schedStartStr || undefined,
            arrivalTime: effEndM >= 0 ? minsToHHMM(effEndM) : liveEndStr || undefined,
            scheduledArrivalTime: schedEndStr || undefined,
            delayMinutes: legTotalDelay,
            liveDelayMinutes: legLiveTotal,
            trafficDelayMinutes: legTrafficTotal,
            trafficFluency: fluency.status,
            trafficCondition: fluency.conditionDescription,
            isLive: legHasRealtimeFlag,
            durationMinutes: effDur,
            scheduledDurationMinutes: schedDur,
            intermediateStopsCount: legStopsCount,
            intermediateStopNames:
              legIdx === 0 && isDirect
                ? intermediateStopNames.length > 0
                  ? intermediateStopNames
                  : undefined
                : intStops.length > 0
                  ? intStops
                  : undefined,
            polyline: continuousLegPolyline,
          };
        });

        const firstLegDetail = transferLegDetails[0];
        const lastLegDetail = transferLegDetails[transferLegDetails.length - 1];

        const resolvedSchedDep = firstLegDetail?.scheduledDepartureTime || schedDep;
        const resolvedEstDep = firstLegDetail?.departureTime || estDep || resolvedSchedDep;
        const resolvedSchedAlight =
          lastLegDetail?.scheduledArrivalTime ||
          formatIsoToHHMM(
            lastTransitLeg.scheduledEndTime ||
              lastTransitLeg.endTime ||
              primaryLeg.scheduledEndTime ||
              primaryLeg.endTime
          );
        const resolvedEstAlight =
          lastLegDetail?.arrivalTime || alightTime || resolvedSchedAlight;

        const schedDepMins = parseHHMMToMins(resolvedSchedDep);
        const estDepMins = parseHHMMToMins(resolvedEstDep);
        const schedAlightMins = parseHHMMToMins(resolvedSchedAlight);
        const estAlightMins = parseHHMMToMins(resolvedEstAlight);

        const scheduledInVehicleMinutes =
          schedDepMins >= 0 && schedAlightMins >= 0
            ? Math.max(1, clockDiffMins(schedDepMins, schedAlightMins))
            : Math.max(1, firstLegDetail?.scheduledDurationMinutes || 7);
        const inVehicleMinutes =
          estDepMins >= 0 && estAlightMins >= 0
            ? Math.max(1, clockDiffMins(estDepMins, estAlightMins))
            : Math.max(1, firstLegDetail?.durationMinutes || scheduledInVehicleMinutes);

        // 4) Camminata dalla fermata di discesa fino alla destinazione finale (walkAfter)
        const walkAfterSec = walkAfterLegs.reduce(
          (acc, l) => acc + (typeof l.duration === 'number' ? l.duration : 0),
          0
        );
        const apiAfterMin = Math.round(walkAfterSec / 60);
        const walkAfterMinutes = preAfter
          ? preAfter.minutes
          : apiAfterMin > 0 && Math.abs(apiAfterMin - realWalkAfter.minutes) <= 2
            ? apiAfterMin
            : realWalkAfter.minutes;

        const durationMinutes = Math.max(1, inVehicleMinutes + walkAfterMinutes);
        const totalDoorToDoorMinutes = Math.max(
          durationMinutes,
          walkBeforeMinutes + durationMinutes
        );

        const normalizedAlightTime =
          estDepMins >= 0
            ? minsToHHMM(estDepMins + inVehicleMinutes)
            : resolvedEstAlight;
        const scheduledAlightingTime =
          schedDepMins >= 0
            ? minsToHHMM(schedDepMins + scheduledInVehicleMinutes)
            : resolvedSchedAlight;
        const arrivalTime =
          estDepMins >= 0
            ? minsToHHMM(estDepMins + durationMinutes)
            : formatIsoToHHMM(it.endTime || lastTransitLeg.endTime);
        const scheduledArrivalTime =
          schedDepMins >= 0
            ? minsToHHMM(schedDepMins + scheduledInVehicleMinutes + walkAfterMinutes)
            : arrivalTime;
        const scheduledLeaveOriginTime =
          schedDepMins >= 0
            ? minsToHHMM(schedDepMins - walkBeforeMinutes)
            : undefined;

        const isRealtimeFeed = transferLegDetails.some((l) => Boolean(l.isLive));
        const isLive = isRealtimeFeed;

        const totalLiveDelayMins = transferLegDetails.reduce(
          (acc, l) => acc + (l.liveDelayMinutes || 0),
          0
        );
        const totalTrafficDelayMins = transferLegDetails.reduce(
          (acc, l) => acc + (l.trafficDelayMinutes || 0),
          0
        );
        const depTrafficMins = isRealtimeFeed
          ? 0
          : Math.max(0, signedClockDiffMins(schedDepMins, estDepMins));
        const rideTrafficMins = Math.max(0, totalTrafficDelayMins - depTrafficMins);

        const schedArrM = parseHHMMToMins(scheduledArrivalTime);
        const estArrM = parseHHMMToMins(arrivalTime);
        const arrShiftMins =
          schedArrM >= 0 && estArrM >= 0
            ? Math.max(0, signedClockDiffMins(schedArrM, estArrM))
            : 0;
        const depShiftMins =
          schedDepMins >= 0 && estDepMins >= 0
            ? Math.max(0, signedClockDiffMins(schedDepMins, estDepMins))
            : 0;
        const delayMins = Math.max(arrShiftMins, depShiftMins, totalTrafficDelayMins);

        const fluencyRank: Record<'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso', number> = {
          scorrevole: 0,
          moderato: 1,
          rallentamenti: 2,
          intenso: 3,
        };
        let worstFluency: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' = 'scorrevole';
        let worstCondition = firstLegDetail?.trafficCondition || '';
        for (const l of transferLegDetails) {
          const st = l.trafficFluency || 'scorrevole';
          if (fluencyRank[st] > fluencyRank[worstFluency]) {
            worstFluency = st;
            worstCondition = l.trafficCondition || worstCondition;
          }
        }

        let statusType: TransitDepartureItem['statusType'] = 'scheduled';
        let statusLabel = 'Programmata';

        if (primaryLeg.cancelled) {
          statusType = 'cancelled';
          statusLabel = 'Cancellata';
        } else if (delayMins >= 1) {
          statusType = 'delayed';
          if (isRealtimeFeed && totalTrafficDelayMins > 0) {
            statusLabel = `In ritardo (+${delayMins}m · incluso traffico)`;
          } else if (isRealtimeFeed) {
            statusLabel = `In ritardo (+${delayMins}m)`;
          } else {
            statusLabel = `Traffico stimato (+${delayMins}m)`;
          }
        } else if (isRealtimeFeed) {
          statusType = 'on_time';
          statusLabel = 'In orario';
        }

        const stLowForCrowding = stationName.toLowerCase();
        const isMajorHubForCrowding =
          stLowForCrowding.includes('termini') ||
          stLowForCrowding.includes('tiburtina') ||
          stLowForCrowding.includes('ostiense');
        const crowdingLevel = estimateDynamicTransitCrowding({
          mode,
          targetTimeStr: resolvedEstDep,
          targetDate: resolvedTripDate,
          isMajorHub: isMajorHubForCrowding,
          weather: isTargetDayToday ? liveWeather : null,
          liveDelayMinutes: totalLiveDelayMins,
          trafficDelayMinutes: totalTrafficDelayMins,
          hasActiveTplStrike: hasActiveTplStrikeToday,
        });

        // Estrai i tratti a piedi di interscambio allineati 1-a-1 per ogni coppia di tratte consecutive
        const transitLegIndices: number[] = [];
        for (let i = 0; i < legs.length; i++) {
          if (legs[i].mode !== 'WALK') transitLegIndices.push(i);
        }
        const transferWalkPolylines: LatLngPoint[][] = [];
        for (let k = 0; k < transitLegIndices.length - 1; k++) {
          const gapPts: LatLngPoint[] = [];
          for (let i = transitLegIndices[k] + 1; i < transitLegIndices[k + 1]; i++) {
            const l = legs[i];
            if (l.mode === 'WALK') {
              const pts = decodeEncodedPolyline(l.legGeometry?.points, l.legGeometry?.precision || 6);
              if (pts.length >= 2) {
                gapPts.push(...pts);
              } else if (l.from?.lat && l.to?.lat) {
                gapPts.push(
                  { latitude: l.from.lat, longitude: l.from.lon },
                  { latitude: l.to.lat, longitude: l.to.lon }
                );
              }
            }
          }
          transferWalkPolylines.push(gapPts);
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
          transitLegs,
          draft: {
            id: `transitous-${itinIdx}-${tripKey}`,
            line: !isDirect
              ? transitLegs.map((tl) => tl.routeShortName).filter(Boolean).join(' + ') || lineShort
              : lineShort,
            mode,
            fromStop: formatStopDisplayName(
              primaryLeg.from?.name || (direction === 'to_station' ? targetName : stationName)
            ),
            toStop:
              toStopName ||
              formatStopDisplayName(
                lastTransitLeg.to?.name || (direction === 'to_station' ? stationName : targetName)
              ),
            scheduledTime: resolvedSchedDep,
            estimatedTime: resolvedEstDep,
            scheduledAlightingTime,
            alightingTime: normalizedAlightTime,
            scheduledArrivalTime,
            arrivalTime,
            scheduledLeaveOriginTime,
            scheduledInVehicleMinutes,
            delayMinutes: Math.max(0, delayMins),
            liveDelayMinutes: totalLiveDelayMins,
            trafficDelayMinutes: totalTrafficDelayMins,
            trafficDepDelayMinutes: depTrafficMins,
            trafficRideDelayMinutes: rideTrafficMins,
            trafficFluency: worstFluency,
            trafficCondition: worstCondition || undefined,
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
            initialOriginCoords: effectiveOriginCoords,
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
            transferWalkPolylines: transferWalkPolylines.some((pts) => pts.length >= 2)
              ? transferWalkPolylines
              : undefined,
            crowdingLevel,
            operator: primaryLeg.agencyName || (mode === 'metro' ? 'ATAC Metro Roma' : 'ATAC Roma'),
          },
        });
      }

      if (pendingItems.length === 0) {
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
      const filteredByWalk = pendingItems.filter((p) => {
        const wAfter = p.draft.walkAfterMinutes || 0;
        return wAfter <= Math.max(12, minDirectWalk + 6);
      });
      const candidatePending = filteredByWalk.length > 0 ? filteredByWalk : pendingItems;

      // Filtra prima della risoluzione headsign le corse che richiederebbero di partire dall'origine prima
      // dell'orario minimo utile (fine lezione, arrivo del treno o orario attuale in live/GPS),
      // tenendo sempre conto del tempo reale a piedi fino alla fermata di salita (walkBeforeMinutes).
      let filteredPending = candidatePending;
      let pastPending: typeof candidatePending = [];
      const isNowQuery = isLiveContext || targetTime === 'now';
      if (minDepMins > 0 || isNowQuery) {
        const filterRefMins = isNowQuery ? nowMins : minDepMins;
        const effectiveMinOrigin = isNowQuery
          ? Math.max(nowMins, minDepMins > 0 ? unwrapMinutesFromRef(minDepMins, nowMins) : 0)
          : minDepMins;
        const afterMinDep: typeof candidatePending = [];
        const pastLookback: typeof candidatePending = [];
        for (const item of candidatePending) {
          const depM = unwrapMinutesFromRef(
            parseHHMMToMins(item.draft.estimatedTime || item.draft.scheduledTime),
            filterRefMins
          );
          if (depM < 0) continue;
          const leaveM = depM - (item.draft.walkBeforeMinutes || 0);
          const isDelayedPendingArrival = Boolean(
            (item.draft.delayMinutes > 0 || (item.draft.liveDelayMinutes ?? 0) > 0) &&
              depM >= effectiveMinOrigin
          );
          if (leaveM >= effectiveMinOrigin || isDelayedPendingArrival) {
            afterMinDep.push(item);
          } else if (isNowQuery && depM >= effectiveMinOrigin - 30) {
            pastLookback.push(item);
          }
        }
        if (afterMinDep.length > 0) {
          filteredPending = afterMinDep;
        }
        pastPending = pastLookback.slice(0, 10);
      }

      const resolveHeadsignsForItems = async (
        items: typeof candidatePending
      ): Promise<TransitDepartureItem[]> =>
        Promise.all(
          items.map(async (item) => {
            const primaryHeadsign = await resolveVerifiedHeadsign(item.primaryLeg);
            let resolvedLegs = item.draft.legs;
            if (
              resolvedLegs &&
              resolvedLegs.length > 1 &&
              item.transitLegs.length === resolvedLegs.length
            ) {
              const legHeadsigns = await Promise.all(
                item.transitLegs.map((tl, idx) =>
                  idx === 0 ? Promise.resolve(primaryHeadsign) : resolveVerifiedHeadsign(tl)
                )
              );
              resolvedLegs = resolvedLegs.map((leg, idx) => ({
                ...leg,
                headsign: legHeadsigns[idx] || leg.headsign,
              }));
            }
            return {
              ...item.draft,
              headsign: primaryHeadsign,
              legs: resolvedLegs,
            };
          })
        );

      // Risolve in parallelo la direzione reale per corse future e corse passate negli ultimi 30 minuti
      const [finalDepartures, pastDepartures] = await Promise.all([
        resolveHeadsignsForItems(filteredPending),
        pastPending.length > 0
          ? resolveHeadsignsForItems(pastPending)
          : Promise.resolve([]),
      ]);

      const sortClockRef = isLiveContext
        ? nowMins
        : minDepMins > 0
          ? minDepMins
          : constraintMins > 0
            ? Math.max(0, constraintMins - 60)
            : nowMins;

      if (pastDepartures.length > 1) {
        pastDepartures.sort((a, b) => {
          const aTimeStr = a.estimatedTime || a.scheduledTime;
          const bTimeStr = b.estimatedTime || b.scheduledTime;
          const aDep = unwrapMinutesFromRef(parseHHMMToMins(aTimeStr), sortClockRef);
          const bDep = unwrapMinutesFromRef(parseHHMMToMins(bTimeStr), sortClockRef);
          return bDep - aDep;
        });
      }

      // Ordine rigorosamente cronologico per orario di partenza crescente
      finalDepartures.sort((a, b) => {
        const aTimeStr = a.estimatedTime || a.scheduledTime;
        const bTimeStr = b.estimatedTime || b.scheduledTime;
        const aDep = unwrapMinutesFromRef(parseHHMMToMins(aTimeStr), sortClockRef);
        const bDep = unwrapMinutesFromRef(parseHHMMToMins(bTimeStr), sortClockRef);
        if (aDep !== bDep) {
          return aDep - bDep;
        }
        const aWalk = (a.walkBeforeMinutes || 0) + (a.walkAfterMinutes || 0);
        const bWalk = (b.walkBeforeMinutes || 0) + (b.walkAfterMinutes || 0);
        if (aWalk !== bWalk) {
          return aWalk - bWalk;
        }
        return a.durationMinutes - b.durationMinutes;
      });

      const { optimal, optimalIndex, lastUseful, lastUsefulIndex } = findOptimalTransitDeparture(
        finalDepartures,
        {
          direction,
          isLiveContext,
          constraintTime,
          minDepartureTime,
          targetTime,
          arrivalBufferMinutes: effectiveAdvanceMins,
          preferLatestBeforeDeadline,
        }
      );

      const orderedDirectLines: string[] = [];
      const seenOrderedLines = new Set<string>();
      for (const d of finalDepartures) {
        if (!d.isDirect) continue;
        const k = d.line.trim().toLowerCase();
        if (k && !seenOrderedLines.has(k)) {
          seenOrderedLines.add(k);
          orderedDirectLines.push(d.line);
        }
      }
      const directLines =
        orderedDirectLines.length > 0 ? orderedDirectLines : Array.from(directLinesSet);
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
        pastDepartures: pastDepartures.length > 0 ? pastDepartures : undefined,
        optimalDeparture: optimal,
        optimalIndex,
        lastUsefulDeparture: lastUseful,
        lastUsefulIndex,
        lastUpdated: new Date().toLocaleTimeString('it-IT', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        isLiveSource: isLiveContext,
        arrivalBufferMinutes: effectiveAdvanceMins,
        preferLatestBeforeDeadline,
      };

      if (transitBoardMemoryCache.size >= 40) {
        const oldestKey = transitBoardMemoryCache.keys().next().value;
        if (oldestKey) transitBoardMemoryCache.delete(oldestKey);
      }
      transitBoardMemoryCache.set(
        cacheKey,
        buildBoardCacheEntry(
          result,
          baseCacheKey,
          isLiveContext,
          reqConstraintMins,
          reqMinDepMins
        )
      );

      return result;
    } catch {
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
        isLiveSource: isLiveContext,
        fetchFailed: true,
      };
    }
  };

  const promise = executeRequest().finally(() => {
    inFlightBoardRequests.delete(cacheKey);
  });
  inFlightBoardRequests.set(cacheKey, promise);
  return promise;
}

// ── Persistenza "Recenti aperti" per singolo viaggio (reset automatico dopo 2 ore o al cambio giorno) ──
const RECENT_TRANSIT_STORAGE_KEY = '@studici_recent_transit_departures_v1';
export const RECENT_TRANSIT_TTL_MS = 2 * 60 * 60 * 1000; // 2 ore
const MAX_RECENT_PER_TRIP = 5;

export interface RecentTransitEntry {
  tripKey: string;
  openedAt: number;
  dateIso: string;
  departure: TransitDepartureItem;
}

let recentTransitMemCache: RecentTransitEntry[] | null = null;

function buildRecentTripKey(stationName: string, destinationName: string): string {
  return `${(stationName || '').trim().toLowerCase()}|${(destinationName || '').trim().toLowerCase()}`;
}

function getDepartureMatchSignature(dep: TransitDepartureItem): string {
  return `${(dep.line || '').trim().toLowerCase()}|${(dep.scheduledTime || '').trim()}|${(dep.fromStop || '').trim().toLowerCase()}`;
}

function compactDepartureForRecentStorage(dep: TransitDepartureItem): TransitDepartureItem {
  return {
    ...dep,
    transitPolyline: undefined,
    walkBeforePolyline: undefined,
    walkAfterPolyline: undefined,
    transferWalkPolylines: undefined,
    legs: dep.legs?.map((l) => ({ ...l, polyline: undefined })),
  };
}

function pruneExpiredRecentEntries(entries: RecentTransitEntry[]): RecentTransitEntry[] {
  const now = Date.now();
  const todayIso = new Date().toISOString().slice(0, 10);
  return entries.filter(
    (e) =>
      e &&
      typeof e.openedAt === 'number' &&
      now - e.openedAt <= RECENT_TRANSIT_TTL_MS &&
      e.dateIso === todayIso &&
      Boolean(e.departure?.line)
  );
}

async function loadAllRecentEntries(): Promise<RecentTransitEntry[]> {
  if (recentTransitMemCache) {
    const pruned = pruneExpiredRecentEntries(recentTransitMemCache);
    if (pruned.length !== recentTransitMemCache.length) {
      recentTransitMemCache = pruned;
      AsyncStorage.setItem(RECENT_TRANSIT_STORAGE_KEY, JSON.stringify(pruned)).catch(() => {});
    }
    return pruned;
  }
  try {
    const raw = await AsyncStorage.getItem(RECENT_TRANSIT_STORAGE_KEY);
    if (!raw) {
      recentTransitMemCache = [];
      return [];
    }
    const parsed = JSON.parse(raw);
    const list: RecentTransitEntry[] = Array.isArray(parsed) ? parsed : [];
    const pruned = pruneExpiredRecentEntries(list);
    recentTransitMemCache = pruned;
    if (pruned.length !== list.length) {
      AsyncStorage.setItem(RECENT_TRANSIT_STORAGE_KEY, JSON.stringify(pruned)).catch(() => {});
    }
    return pruned;
  } catch {
    recentTransitMemCache = [];
    return [];
  }
}

export async function getRecentTransitDepartures(
  stationName: string,
  destinationName: string
): Promise<RecentTransitEntry[]> {
  const tripKey = buildRecentTripKey(stationName, destinationName);
  const all = await loadAllRecentEntries();
  return all.filter((e) => e.tripKey === tripKey);
}

export async function recordRecentTransitDeparture(
  stationName: string,
  destinationName: string,
  departure: TransitDepartureItem
): Promise<RecentTransitEntry[]> {
  const tripKey = buildRecentTripKey(stationName, destinationName);
  const todayIso = new Date().toISOString().slice(0, 10);
  const sig = getDepartureMatchSignature(departure);
  const all = await loadAllRecentEntries();

  const others = all.filter((e) => e.tripKey !== tripKey);
  const sameTrip = all.filter(
    (e) => e.tripKey === tripKey && getDepartureMatchSignature(e.departure) !== sig
  );

  const nextForTrip: RecentTransitEntry[] = [
    {
      tripKey,
      openedAt: Date.now(),
      dateIso: todayIso,
      departure: compactDepartureForRecentStorage(departure),
    },
    ...sameTrip,
  ].slice(0, MAX_RECENT_PER_TRIP);

  const nextAll = [...nextForTrip, ...others];
  recentTransitMemCache = nextAll;
  try {
    await AsyncStorage.setItem(RECENT_TRANSIT_STORAGE_KEY, JSON.stringify(nextAll));
  } catch {
    // ignore storage errors
  }
  return nextForTrip;
}

export async function clearRecentTransitDepartures(
  stationName: string,
  destinationName: string
): Promise<void> {
  const tripKey = buildRecentTripKey(stationName, destinationName);
  const all = await loadAllRecentEntries();
  const nextAll = all.filter((e) => e.tripKey !== tripKey);
  recentTransitMemCache = nextAll;
  try {
    await AsyncStorage.setItem(RECENT_TRANSIT_STORAGE_KEY, JSON.stringify(nextAll));
  } catch {
    // ignore
  }
}

export function findMatchingDepartureInBoard(
  target: TransitDepartureItem,
  board: TransitBoardResult | null | undefined
): TransitDepartureItem | null {
  if (!board) return null;
  const pool = [...(board.departures || []), ...(board.pastDepartures || [])];
  if (pool.length === 0) return null;
  const byId = pool.find((d) => d.id === target.id);
  if (byId) return byId;
  const targetSig = getDepartureMatchSignature(target);
  return pool.find((d) => getDepartureMatchSignature(d) === targetSig) || null;
}
