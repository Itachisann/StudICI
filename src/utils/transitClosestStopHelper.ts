import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  haversineMeters,
  LatLngPoint,
  resolveDynamicPublicStreetAccess,
  resolvePedestrianRoadwayPolyline,
} from './transitRoadwayRouter';

const STOPS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 giorni su disco/RAM
const STOPS_STORAGE_KEY = '@studici_transitous_stops_cache_v1';
const STOPTIMES_CACHE_TTL_MS = 45 * 1000; // 45 secondi
const TRIP_CACHE_TTL_MS = 1000 * 60 * 15; // 15 minuti
const STOP_OPT_PATTERN_TTL_MS = 1000 * 60 * 15; // 15 minuti

const nearbyStopsCache = new Map<string, { ts: number; stops: any[] }>();
const nearbyStopsInFlight = new Map<string, Promise<any[]>>();
const tripDetailsCache = new Map<string, { ts: number; data: any }>();
const tripDetailsInFlight = new Map<string, Promise<any | null>>();
const stopTimesCache = new Map<string, { ts: number; rows: any[] }>();
const stopTimesInFlight = new Map<string, Promise<any[]>>();
const stopOptUnchangedCache = new Map<string, number>();
const nonServingRouteCache = new Map<string, number>();

let stopsStorageLoaded = false;
let stopsStorageLoadPromise: Promise<void> | null = null;
let persistStopsTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureStopsStorageLoaded(): Promise<void> {
  if (stopsStorageLoaded) return;
  if (stopsStorageLoadPromise) return stopsStorageLoadPromise;
  stopsStorageLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STOPS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        if (parsed && typeof parsed === 'object') {
          for (const [k, entry] of Object.entries<any>(parsed)) {
            if (
              entry &&
              Array.isArray(entry.stops) &&
              typeof entry.ts === 'number' &&
              now - entry.ts < STOPS_CACHE_TTL_MS &&
              !nearbyStopsCache.has(k)
            ) {
              nearbyStopsCache.set(k, { ts: entry.ts, stops: entry.stops });
            }
          }
        }
      }
    } catch {}
    stopsStorageLoaded = true;
    stopsStorageLoadPromise = null;
  })();
  return stopsStorageLoadPromise;
}

function schedulePersistStopsCache(): void {
  if (persistStopsTimer) return;
  persistStopsTimer = setTimeout(() => {
    persistStopsTimer = null;
    try {
      const now = Date.now();
      const entries = Array.from(nearbyStopsCache.entries())
        .filter(([, v]) => now - v.ts < STOPS_CACHE_TTL_MS)
        .slice(-24);
      const payload: Record<string, { ts: number; stops: any[] }> = {};
      for (const [k, v] of entries) {
        payload[k] = {
          ts: v.ts,
          stops: v.stops.map((s) => ({
            stopId: s?.stopId,
            name: s?.name,
            lat: s?.lat,
            lon: s?.lon,
            mode: s?.mode,
          })),
        };
      }
      AsyncStorage.setItem(STOPS_STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
    } catch {}
  }, 500);
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const cur = nextIdx++;
      if (cur >= items.length) break;
      results[cur] = await worker(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

function decodePolyLocal(encoded?: string, precision = 6): LatLngPoint[] {
  if (!encoded || typeof encoded !== 'string') return [];
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / factor, longitude: lng / factor });
  }
  return points;
}

function encodePolyLocal(points: LatLngPoint[], precision = 6): string {
  if (!points || points.length === 0) return '';
  const factor = Math.pow(10, precision);
  let lastLat = 0;
  let lastLng = 0;
  let out = '';

  const encodeSigned = (val: number) => {
    let v = val < 0 ? ~(val << 1) : val << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };

  for (const pt of points) {
    const iLat = Math.round(pt.latitude * factor);
    const iLng = Math.round(pt.longitude * factor);
    encodeSigned(iLat - lastLat);
    encodeSigned(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

function slicePolylineBetweenStops(
  poly: LatLngPoint[],
  fromStop: { lat: number; lng: number },
  toStop: { lat: number; lng: number }
): LatLngPoint[] {
  if (!poly || poly.length < 2) return [];
  let bestStart = 0;
  let minD1 = Infinity;
  let bestEnd = poly.length - 1;
  let minD2 = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const d1 = haversineMeters(poly[i], fromStop);
    if (d1 < minD1) {
      minD1 = d1;
      bestStart = i;
    }
  }
  for (let i = bestStart; i < poly.length; i++) {
    const d2 = haversineMeters(poly[i], toStop);
    if (d2 < minD2) {
      minD2 = d2;
      bestEnd = i;
    }
  }
  if (bestEnd > bestStart) {
    return poly.slice(bestStart, bestEnd + 1);
  }
  return [];
}

function polylineLengthM(points: LatLngPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += haversineMeters(points[i - 1], points[i]);
  }
  return len;
}

function normStopKey(name?: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(m[abc1]?\)|\(fs\)|staz\.?ne|stazione|fermata|piazzale|p\.le|p\.za|l\.go/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Risolve dinamicamente l'accesso stradale esterno per edifici/campus chiusi (es. cortili universitari),
 * lasciando inalterati i punti che non sono edifici o distano oltre la soglia di cortile.
 */
export async function resolveEffectiveEndpointForRouting(
  rawCoords: { lat: number; lng: number },
  isBuildingOrCustomEndpoint: boolean
): Promise<{ lat: number; lng: number; snappedFromInterior: boolean }> {
  if (!isBuildingOrCustomEndpoint) {
    return { ...rawCoords, snappedFromInterior: false };
  }
  try {
    const access = await resolveDynamicPublicStreetAccess(rawCoords);
    if (access && access.distanceMeters >= 8 && access.distanceMeters <= 68) {
      return {
        lat: access.lat,
        lng: access.lng,
        snappedFromInterior: true,
      };
    }
  } catch {
    // fallback alle coordinate originali
  }
  return { ...rawCoords, snappedFromInterior: false };
}

/**
 * Calcola durata e tracciato pedonale reale su marciapiede con passo urbano standard (~78 m/min).
 */
export async function resolveWalkLegMetrics(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<{ polyline: LatLngPoint[]; distanceMeters: number; minutes: number }> {
  const straight = haversineMeters(origin, destination);
  if (straight <= 20) {
    return {
      polyline: [
        { latitude: origin.lat, longitude: origin.lng },
        { latitude: destination.lat, longitude: destination.lng },
      ],
      distanceMeters: straight,
      minutes: 0,
    };
  }

  try {
    const poly = await resolvePedestrianRoadwayPolyline(origin, destination);
    if (poly && poly.length >= 2) {
      const dist = polylineLengthM(poly);
      const effectiveDist = Math.max(straight, dist);
      // Velocità pedonale urbana realistica (~78 m/min ≈ 4.7 km/h, allineata a Google Maps)
      const mins = Math.max(1, Math.round(effectiveDist / 78));
      return {
        polyline: poly,
        distanceMeters: Math.round(effectiveDist),
        minutes: mins,
      };
    }
  } catch {
    // fallback sotto
  }

  const fallbackDist = straight * 1.15;
  return {
    polyline: [
      { latitude: origin.lat, longitude: origin.lng },
      { latitude: destination.lat, longitude: destination.lng },
    ],
    distanceMeters: Math.round(fallbackDist),
    minutes: Math.max(1, Math.round(fallbackDist / 78)),
  };
}

async function fetchTransitousStopsBox(
  center: { lat: number; lng: number },
  deltaLat = 0.0052,
  deltaLng = 0.0068
): Promise<any[]> {
  await ensureStopsStorageLoaded();
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}_${deltaLat.toFixed(3)}`;
  const cached = nearbyStopsCache.get(key);
  if (cached && Date.now() - cached.ts < STOPS_CACHE_TTL_MS) {
    return cached.stops;
  }
  const existing = nearbyStopsInFlight.get(key);
  if (existing) {
    return existing;
  }

  const maxLat = (center.lat + deltaLat).toFixed(5);
  const minLat = (center.lat - deltaLat).toFixed(5);
  const minLon = (center.lng - deltaLng).toFixed(5);
  const maxLon = (center.lng + deltaLng).toFixed(5);
  const url = `https://api.transitous.org/api/v1/map/stops?min=${maxLat},${minLon}&max=${minLat},${maxLon}`;

  const task = (async (): Promise<any[]> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3200);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      nearbyStopsCache.set(key, { ts: Date.now(), stops: list });
      schedulePersistStopsCache();
      return list;
    } catch {
      return [];
    }
  })().finally(() => {
    nearbyStopsInFlight.delete(key);
  });

  nearbyStopsInFlight.set(key, task);
  return task;
}

/**
 * Avvia in anticipo il prefetch delle bounding box di fermate in parallelo a MOTIS /plan.
 */
export function prefetchTransitousStopsBoxes(
  originCoords: { lat: number; lng: number },
  destCoords: { lat: number; lng: number }
): void {
  if (haversineMeters(originCoords, destCoords) < 350) return;
  fetchTransitousStopsBox(originCoords, 0.0062, 0.0080).catch(() => {});
  fetchTransitousStopsBox(destCoords, 0.0052, 0.0068).catch(() => {});
}

export async function fetchTransitousTripDetails(tripId: string): Promise<any | null> {
  if (!tripId) return null;
  const cached = tripDetailsCache.get(tripId);
  if (cached && Date.now() - cached.ts < TRIP_CACHE_TTL_MS) {
    return cached.data;
  }
  const existing = tripDetailsInFlight.get(tripId);
  if (existing) {
    return existing;
  }

  const url = `https://api.transitous.org/api/v5/trip?tripId=${encodeURIComponent(tripId)}`;
  const task = (async (): Promise<any | null> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2800);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (tripDetailsCache.size > 140) {
        const oldestKey = tripDetailsCache.keys().next().value;
        if (oldestKey) tripDetailsCache.delete(oldestKey);
      }
      tripDetailsCache.set(tripId, { ts: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  })().finally(() => {
    tripDetailsInFlight.delete(tripId);
  });

  tripDetailsInFlight.set(tripId, task);
  return task;
}

async function fetchTransitousStopTimes(
  stopId: string,
  queryIso: string,
  limit = 24
): Promise<any[]> {
  // Bucket a 1 minuto sulla cache RAM per evitare duplicati su refresh ravvicinati
  const bucketIso = queryIso.slice(0, 16);
  const cacheKey = `${stopId}|${bucketIso}|${limit}`;
  const cached = stopTimesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STOPTIMES_CACHE_TTL_MS) {
    return cached.rows;
  }
  const existing = stopTimesInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const url = `https://api.transitous.org/api/v1/stoptimes?stopId=${encodeURIComponent(
    stopId
  )}&time=${encodeURIComponent(queryIso)}&n=${limit}`;
  const task = (async (): Promise<any[]> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'StudICI/1.0 (https://github.com/studici; contact@studici.app)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data?.stopTimes) ? data.stopTimes : [];
      if (stopTimesCache.size > 80) {
        const oldestKey = stopTimesCache.keys().next().value;
        if (oldestKey) stopTimesCache.delete(oldestKey);
      }
      stopTimesCache.set(cacheKey, { ts: Date.now(), rows });
      return rows;
    } catch {
      return [];
    }
  })().finally(() => {
    stopTimesInFlight.delete(cacheKey);
  });

  stopTimesInFlight.set(cacheKey, task);
  return task;
}

function getAllOrderedTripStops(tripData: any): any[] {
  const it = Array.isArray(tripData?.itineraries) ? tripData.itineraries[0] : tripData;
  const leg = it?.legs?.[0];
  if (!leg) return [];
  const stops: any[] = [];
  if (leg.from) stops.push(leg.from);
  if (Array.isArray(leg.intermediateStops)) stops.push(...leg.intermediateStops);
  if (leg.to) stops.push(leg.to);
  return stops;
}

/**
 * Ottimizza dinamicamente la fermata di salita (e di discesa) di un itinerario diretto
 * consultando /api/v5/trip, per evitare che l'utente venga mandato a piedi a una fermata più lontana
 * quando la stessa identica corsa ferma più vicino lungo il percorso.
 */
export async function optimizeSingleLegStopsViaTrip(params: {
  leg: any;
  originCoords: { lat: number; lng: number };
  destCoords: { lat: number; lng: number };
  originLeaveEpochMs?: number;
}): Promise<any> {
  const { leg, originCoords, destCoords, originLeaveEpochMs } = params;
  if (!leg?.tripId) return leg;

  const currentFromLat = leg.from?.lat;
  const currentFromLon = leg.from?.lon;
  const currentToLat = leg.to?.lat;
  const currentToLon = leg.to?.lon;
  if (
    typeof currentFromLat !== 'number' ||
    typeof currentFromLon !== 'number' ||
    typeof currentToLat !== 'number' ||
    typeof currentToLon !== 'number'
  ) {
    return leg;
  }

  const distOrigToCurr = haversineMeters(originCoords, {
    lat: currentFromLat,
    lng: currentFromLon,
  });
  const distCurrToDest = haversineMeters(destCoords, {
    lat: currentToLat,
    lng: currentToLon,
  });

  // Se entrambe le fermate sono già vicinissime (< 200m), non serve ottimizzare oltre
  if (distOrigToCurr < 200 && distCurrToDest < 200) {
    return leg;
  }

  // Se un'altra corsa della stessa linea/direzione/coppia fermate ha già dimostrato che non esiste
  // una fermata più vicina per questo corridoio, evita di riscaricare /api/v5/trip.
  const optPatternKey = `${leg.routeId || leg.routeShortName || ''}|${leg.directionId || ''}|${leg.from?.stopId || normStopKey(leg.from?.name)}|${leg.to?.stopId || normStopKey(leg.to?.name)}|${originCoords.lat.toFixed(4)},${originCoords.lng.toFixed(4)}|${destCoords.lat.toFixed(4)},${destCoords.lng.toFixed(4)}`;
  const cachedUnchangedTs = stopOptUnchangedCache.get(optPatternKey);
  if (cachedUnchangedTs && Date.now() - cachedUnchangedTs < STOP_OPT_PATTERN_TTL_MS) {
    return leg;
  }

  const tripData = await fetchTransitousTripDetails(leg.tripId);
  if (!tripData) return leg;

  const tripIt = Array.isArray(tripData?.itineraries) ? tripData.itineraries[0] : tripData;
  const tripLeg = tripIt?.legs?.[0];
  const allStops = getAllOrderedTripStops(tripData);
  if (allStops.length < 2) return leg;

  const normCurrFrom = normStopKey(leg.from?.name);
  const normCurrTo = normStopKey(leg.to?.name);
  const legStartMs = leg.startTime ? new Date(leg.startTime).getTime() : NaN;
  const legEndMs = leg.endTime ? new Date(leg.endTime).getTime() : NaN;

  const getStopDepMs = (s: any) => {
    const iso = s?.departure || s?.scheduledDeparture || s?.arrival || s?.scheduledArrival;
    return iso ? new Date(iso).getTime() : NaN;
  };
  const getStopArrMs = (s: any) => {
    const iso = s?.arrival || s?.scheduledArrival || s?.departure || s?.scheduledDeparture;
    return iso ? new Date(iso).getTime() : NaN;
  };

  let fromIdx = -1;
  let bestFromTimeDiff = Infinity;
  for (let i = 0; i < allStops.length; i++) {
    const s = allStops[i];
    const idMatch = Boolean(leg.from?.stopId && s?.stopId === leg.from.stopId);
    const nameCoordMatch = Boolean(
      normCurrFrom &&
        normStopKey(s?.name) === normCurrFrom &&
        typeof s?.lat === 'number' &&
        typeof s?.lon === 'number' &&
        haversineMeters({ lat: s.lat, lng: s.lon }, { lat: currentFromLat, lng: currentFromLon }) < 180
    );
    if (!idMatch && !nameCoordMatch) continue;
    const sMs = getStopDepMs(s);
    const diff =
      Number.isFinite(legStartMs) && Number.isFinite(sMs)
        ? Math.abs(sMs - legStartMs)
        : 0;
    if (diff <= 15 * 60000 && diff < bestFromTimeDiff) {
      bestFromTimeDiff = diff;
      fromIdx = i;
    }
  }

  let toIdx = -1;
  let bestToTimeDiff = Infinity;
  if (fromIdx >= 0) {
    for (let i = fromIdx + 1; i < allStops.length; i++) {
      const s = allStops[i];
      const idMatch = Boolean(leg.to?.stopId && s?.stopId === leg.to.stopId);
      const nameCoordMatch = Boolean(
        normCurrTo &&
          normStopKey(s?.name) === normCurrTo &&
          typeof s?.lat === 'number' &&
          typeof s?.lon === 'number' &&
          haversineMeters({ lat: s.lat, lng: s.lon }, { lat: currentToLat, lng: currentToLon }) < 180
      );
      if (!idMatch && !nameCoordMatch) continue;
      const sMs = getStopArrMs(s);
      const diff =
        Number.isFinite(legEndMs) && Number.isFinite(sMs)
          ? Math.abs(sMs - legEndMs)
          : 0;
      if (diff <= 15 * 60000 && diff < bestToTimeDiff) {
        bestToTimeDiff = diff;
        toIdx = i;
      }
    }
  }

  if (fromIdx < 0 || toIdx <= fromIdx) return leg;

  const origSpan = toIdx - fromIdx;
  // Cerca una fermata di salita più vicina solo nell'intorno locale dello stesso ramo direzionale
  // (evitando di saltare sul ramo opposto di una linea circolare)
  const minSearchFrom = Math.max(0, fromIdx - 4);
  const maxSearchFrom = toIdx - 1;
  let bestFromIdx = fromIdx;
  let bestFromDist = distOrigToCurr;
  for (let i = minSearchFrom; i <= maxSearchFrom; i++) {
    const s = allStops[i];
    if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
    const d = haversineMeters(originCoords, { lat: s.lat, lng: s.lon });
    if (d < bestFromDist - 45 && d <= 600) {
      const depMs = getStopDepMs(s);
      const walkEstMs = Math.max(1, Math.round((d * 1.15) / 78)) * 60000;
      if (originLeaveEpochMs && Number.isFinite(depMs) && depMs < originLeaveEpochMs + walkEstMs) {
        continue;
      }
      if (Number.isFinite(legStartMs) && Number.isFinite(depMs) && Math.abs(depMs - legStartMs) > 8 * 60000) {
        continue;
      }
      bestFromDist = d;
      bestFromIdx = i;
    }
  }

  // Cerca una fermata di discesa più vicina solo nell'intorno locale dopo la salita
  const maxSearchTo = Math.min(allStops.length - 1, toIdx + 4);
  let bestToIdx = toIdx;
  let bestToDist = distCurrToDest;
  for (let i = bestFromIdx + 1; i <= maxSearchTo; i++) {
    if (i - bestFromIdx > origSpan + 4) break;
    const s = allStops[i];
    if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
    const d = haversineMeters(destCoords, { lat: s.lat, lng: s.lon });
    if (d < bestToDist - 45 && d <= 600) {
      const arrMs = getStopArrMs(s);
      if (Number.isFinite(legEndMs) && Number.isFinite(arrMs) && Math.abs(arrMs - legEndMs) > 8 * 60000) {
        continue;
      }
      bestToDist = d;
      bestToIdx = i;
    }
  }

  if (bestFromIdx === fromIdx && bestToIdx === toIdx) {
    stopOptUnchangedCache.set(optPatternKey, Date.now());
    return leg;
  }

  const candFrom = allStops[bestFromIdx];
  const candTo = allStops[bestToIdx];
  const fromDistToDest = haversineMeters({ lat: candFrom.lat, lng: candFrom.lon }, destCoords);
  const toDistToDest = haversineMeters({ lat: candTo.lat, lng: candTo.lon }, destCoords);
  if (toDistToDest >= fromDistToDest - 120) {
    stopOptUnchangedCache.set(optPatternKey, Date.now());
    return leg;
  }

  const newFrom = allStops[bestFromIdx];
  const newTo = allStops[bestToIdx];
  const newIntermediates = allStops.slice(bestFromIdx + 1, bestToIdx);
  const startTime =
    newFrom.departure || newFrom.arrival || newFrom.scheduledDeparture || leg.startTime;
  const endTime =
    newTo.arrival || newTo.departure || newTo.scheduledArrival || leg.endTime;
  const schedStart =
    newFrom.scheduledDeparture || newFrom.scheduledArrival || startTime;
  const depDelaySec =
    startTime && schedStart
      ? Math.round((new Date(startTime).getTime() - new Date(schedStart).getTime()) / 1000)
      : leg.departureDelay;

  let newLegGeometry = leg.legGeometry;
  if (tripLeg?.legGeometry?.points) {
    const precision = tripLeg.legGeometry.precision || 6;
    const fullPoly = decodePolyLocal(tripLeg.legGeometry.points, precision);
    const sliced = slicePolylineBetweenStops(
      fullPoly,
      { lat: newFrom.lat, lng: newFrom.lon },
      { lat: newTo.lat, lng: newTo.lon }
    );
    if (sliced.length >= 2) {
      newLegGeometry = {
        points: encodePolyLocal(sliced, precision),
        precision,
      };
    }
  }

  return {
    ...leg,
    from: { ...newFrom, departure: startTime },
    to: { ...newTo, arrival: endTime },
    startTime,
    endTime,
    scheduledStartTime: schedStart,
    scheduledEndTime: newTo.scheduledArrival || newTo.scheduledDeparture || endTime,
    departureDelay: Number.isFinite(depDelaySec) ? depDelaySec : leg.departureDelay,
    intermediateStops: newIntermediates,
    legGeometry: newLegGeometry,
  };
}

/**
 * Integra le partenze dirette dalle fermate fisicamente più vicine a piedi tramite
 * /api/v1/map/stops + /api/v1/stoptimes + /api/v5/trip, evitando che l'algoritmo Pareto di MOTIS
 * nasconda linee reali (es. 71/545/492/490/649) alle paline più comode.
 */
export async function fetchCloserCorridorItineraries(params: {
  originCoords: { lat: number; lng: number };
  destCoords: { lat: number; lng: number };
  destName?: string;
  queryIso: string;
  windowMinutes?: number;
  existingTripIds: Set<string>;
  preferredLinesHint?: Set<string>;
  includeMetro?: boolean;
}): Promise<any[]> {
  const {
    originCoords,
    destCoords,
    destName = '',
    queryIso,
    windowMinutes = 120,
    existingTripIds,
    preferredLinesHint,
    includeMetro = true,
  } = params;

  const directOriginDestDist = haversineMeters(originCoords, destCoords);
  if (directOriginDestDist < 350) return [];

  const [originStops, destStops] = await Promise.all([
    fetchTransitousStopsBox(originCoords, 0.0062, 0.0080),
    fetchTransitousStopsBox(destCoords, 0.0052, 0.0068),
  ]);

  if (originStops.length === 0 || destStops.length === 0) return [];

  const destStopIdSet = new Set<string>();
  for (const ds of destStops) {
    if (ds?.stopId && typeof ds.lat === 'number' && typeof ds.lon === 'number') {
      if (haversineMeters(destCoords, { lat: ds.lat, lng: ds.lon }) <= 580) {
        destStopIdSet.add(ds.stopId);
      }
    }
  }
  if (destStopIdSet.size === 0) return [];

  // Seleziona le fermate di origine preservando ENTRAMBI i lati della carreggiata
  // (due banchine opposte con lo stesso nome hanno stopId diversi e servono direzioni opposte!)
  const originCandidates: { stop: any; dist: number; isMetro: boolean }[] = [];
  const seenStopIds = new Set<string>();
  const nameCountMap = new Map<string, { lat: number; lng: number }[]>();
  let metroAdded = false;
  const sortedOrigin = [...originStops]
    .filter((s) => s?.stopId && typeof s.lat === 'number' && typeof s.lon === 'number')
    .map((s) => ({
      stop: s,
      dist: haversineMeters(originCoords, { lat: s.lat, lng: s.lon }),
      isMetro:
        s?.mode === 'SUBWAY' ||
        /\(m[abc1]?\)/i.test(s?.name || '') ||
        /^policlinico$/i.test((s?.name || '').trim()) ||
        /^tiburtina f\.?s\.?$/i.test((s?.name || '').trim()),
    }))
    .sort((a, b) => a.dist - b.dist);

  for (const item of sortedOrigin) {
    const stopId = String(item.stop.stopId);
    if (seenStopIds.has(stopId)) continue;

    if (item.isMetro) {
      if (!includeMetro || metroAdded || item.dist > 850) continue;
      seenStopIds.add(stopId);
      originCandidates.push(item);
      metroAdded = true;
      continue;
    }
    if (item.dist > 480 || originCandidates.length >= 12) continue;
    const normName = normStopKey(item.stop.name) || stopId;
    const existingForName = nameCountMap.get(normName) || [];
    // Salta solo duplicati fisicamente sovrapposti (< 14m sulla stessa banchina) o oltre 2 banchine omonime
    const isSamePlatform = existingForName.some(
      (pt) => haversineMeters(pt, { lat: item.stop.lat, lng: item.stop.lon }) < 14
    );
    if (isSamePlatform || existingForName.length >= 2) continue;
    seenStopIds.add(stopId);
    existingForName.push({ lat: item.stop.lat, lng: item.stop.lon });
    nameCountMap.set(normName, existingForName);
    originCandidates.push(item);
  }

  if (originCandidates.length === 0) return [];

  const baseEpochMs = new Date(queryIso).getTime();
  const maxEpochMs = baseEpochMs + windowMinutes * 60000;

  const stopTimesLists = await runWithConcurrency(
    originCandidates,
    5,
    (c) => fetchTransitousStopTimes(c.stop.stopId, queryIso, 24)
  );

  const destKey = `${destCoords.lat.toFixed(3)},${destCoords.lng.toFixed(3)}`;
  const destTokens = normStopKey(destName);

  // Raccogli tripId candidati non ancora presenti in MOTIS /plan, dando priorità alle linee del corridoio
  const candidateTrips: {
    tripId: string;
    depMs: number;
    boardDist: number;
    priority: number;
    nonServeKey: string;
  }[] = [];
  const seenTripIds = new Set<string>();

  stopTimesLists.forEach((rows, idx) => {
    const boardDist = originCandidates[idx].dist;
    const minReachMs =
      baseEpochMs + Math.round((boardDist * 1.1) / 78) * 60000 - 60000;

    for (const row of rows) {
      const tripId = row?.tripId;
      if (!tripId || existingTripIds.has(tripId) || seenTripIds.has(tripId)) continue;

      const depIso = row?.place?.departure || row?.place?.scheduledDeparture;
      if (!depIso) continue;
      const depMs = new Date(depIso).getTime();
      if (!Number.isFinite(depMs) || depMs < minReachMs || depMs > maxEpochMs) continue;

      const lineUpper = String(row?.routeShortName || '').trim().toUpperCase();
      if (!lineUpper) continue;

      const normHead = normStopKey(row?.headsign);
      const nonServeKey = `${lineUpper}|${normHead}|${destKey}`;
      const cachedNonServeTs = nonServingRouteCache.get(nonServeKey);
      if (cachedNonServeTs && Date.now() - cachedNonServeTs < 1000 * 60 * 30) {
        continue;
      }

      seenTripIds.add(tripId);
      const isHintLine = preferredLinesHint?.has(lineUpper) ? 1 : 0;
      const headMatchesDest =
        destTokens.length >= 4 &&
        (normHead.includes(destTokens) || destTokens.includes(normHead))
          ? 1
          : 0;
      const priority =
        isHintLine * 12000 +
        headMatchesDest * 6000 -
        Math.round((depMs - baseEpochMs) / 60000) * 12 -
        Math.round(boardDist / 25);
      candidateTrips.push({ tripId, depMs, boardDist, priority, nonServeKey });
    }
  });

  candidateTrips.sort((a, b) => b.priority - a.priority);
  if (candidateTrips.length === 0) return [];

  // Sonda in 2 fasi per evitare di scaricare 4-8 corse della stessa linea che NON serve il corridoio:
  // Fase A: 1 solo trip di prova per ogni combinazione unica (linea|headsign) fino a 10 linee uniche.
  const probeCandidates: typeof candidateTrips = [];
  const remainingByRoute = new Map<string, typeof candidateTrips>();
  const probedRouteKeys = new Set<string>();

  for (const cand of candidateTrips) {
    if (!probedRouteKeys.has(cand.nonServeKey)) {
      if (probeCandidates.length < 10) {
        probedRouteKeys.add(cand.nonServeKey);
        probeCandidates.push(cand);
      }
    } else {
      const list = remainingByRoute.get(cand.nonServeKey) || [];
      if (list.length < 3) {
        list.push(cand);
        remainingByRoute.set(cand.nonServeKey, list);
      }
    }
  }

  const probeResults = await runWithConcurrency(
    probeCandidates,
    5,
    (c) => fetchTransitousTripDetails(c.tripId)
  );

  // Identifica quali linee servono davvero destStopIdSet e scarica corse aggiuntive solo per quelle
  const confirmedFollowups: typeof candidateTrips = [];
  for (let pIdx = 0; pIdx < probeCandidates.length; pIdx++) {
    const tripData = probeResults[pIdx];
    const allStops = tripData ? getAllOrderedTripStops(tripData) : [];
    const servesDest = allStops.some(
      (s) =>
        (s?.stopId && destStopIdSet.has(s.stopId)) ||
        (typeof s?.lat === 'number' &&
          typeof s?.lon === 'number' &&
          haversineMeters({ lat: s.lat, lng: s.lon }, destCoords) <= 580)
    );
    if (!servesDest) {
      nonServingRouteCache.set(probeCandidates[pIdx].nonServeKey, Date.now());
      continue;
    }
    const extra = remainingByRoute.get(probeCandidates[pIdx].nonServeKey);
    if (extra && extra.length > 0) {
      confirmedFollowups.push(...extra);
    }
  }

  confirmedFollowups.sort((a, b) => b.priority - a.priority);
  const followupBudget = Math.max(0, 14 - probeCandidates.length);
  const selectedFollowups = confirmedFollowups.slice(0, followupBudget);
  const followupResults =
    selectedFollowups.length > 0
      ? await runWithConcurrency(selectedFollowups, 5, (c) =>
          fetchTransitousTripDetails(c.tripId)
        )
      : [];

  const selectedCandidates = [...probeCandidates, ...selectedFollowups];
  const tripResults = [...probeResults, ...followupResults];

  const syntheticItineraries: any[] = [];

  for (let tIdx = 0; tIdx < tripResults.length; tIdx++) {
    const tripData = tripResults[tIdx];
    const tripIt = Array.isArray(tripData?.itineraries) ? tripData.itineraries[0] : tripData;
    const fullLeg = tripIt?.legs?.[0];
    if (!fullLeg) continue;

    const allStops = getAllOrderedTripStops(tripData);
    if (allStops.length < 2) {
      nonServingRouteCache.set(selectedCandidates[tIdx].nonServeKey, Date.now());
      continue;
    }

    // Individua la coppia (bestBoardIdx, bestAlightIdx) con bestBoardIdx < bestAlightIdx che:
    // 1. procede realmente nel verso dall'origine alla destinazione (avvicinando il passeggero a destCoords);
    // 2. non effettua giri ad anello passando dal capolinea opposto (nessuna fermata intermedia k tra i e j
    //    che ripassi vicino all'origine o abbia già raggiunto la destinazione, e tortuosità contenuta);
    // 3. minimizza la combinazione di camminata e durata a bordo.
    const minRequiredProgressM = Math.min(200, directOriginDestDist * 0.25);
    let bestBoardIdx = -1;
    let bestBoardDist = Infinity;
    let bestAlightIdx = -1;
    let bestAlightDist = Infinity;
    let bestPairScore = Infinity;

    for (let i = 0; i < allStops.length - 1; i++) {
      const s = allStops[i];
      if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
      const dOrig = haversineMeters(originCoords, { lat: s.lat, lng: s.lon });
      if (dOrig > 560) continue;

      const depIso = s.departure || s.scheduledDeparture || s.arrival;
      const depMs = depIso ? new Date(depIso).getTime() : NaN;
      const walkEstMs = Math.max(1, Math.round((dOrig * 1.12) / 78)) * 60000;
      if (!Number.isFinite(depMs) || depMs < baseEpochMs + walkEstMs - 60000 || depMs > maxEpochMs) {
        continue;
      }

      const fromDistToDest = haversineMeters({ lat: s.lat, lng: s.lon }, destCoords);
      if (dOrig >= fromDistToDest) continue;

      for (let j = i + 1; j < allStops.length; j++) {
        const ds = allStops[j];
        if (typeof ds?.lat !== 'number' || typeof ds?.lon !== 'number') continue;
        const dDest = haversineMeters(destCoords, { lat: ds.lat, lng: ds.lon });
        if (!destStopIdSet.has(ds.stopId) && dDest > 540) continue;

        // Il mezzo deve effettivamente avvicinare il passeggero alla destinazione
        if (dDest > fromDistToDest - minRequiredProgressM) continue;
        const toDistToOrig = haversineMeters({ lat: ds.lat, lng: ds.lon }, originCoords);
        if (dDest >= toDistToOrig) continue;

        const alightIso = ds.arrival || ds.scheduledArrival || ds.departure;
        const alightMs = alightIso ? new Date(alightIso).getTime() : NaN;
        if (!Number.isFinite(alightMs)) continue;
        const rideMins = (alightMs - depMs) / 60000;
        if (rideMins < 1 || rideMins > 35) continue;

        // Verifica assenza di loop intermedio (es. salita sulla banchina opposta di una linea circolare come il 71
        // che va prima a L.go Chigi, ripassa vicino all'origine e poi arriva a destinazione)
        let hasLoopOrOvershoot = false;
        let pathDistM = 0;
        let prevPt = { lat: s.lat, lng: s.lon };
        for (let k = i + 1; k <= j; k++) {
          const ks = allStops[k];
          if (typeof ks?.lat !== 'number' || typeof ks?.lon !== 'number') continue;
          const kPt = { lat: ks.lat, lng: ks.lon };
          pathDistM += haversineMeters(prevPt, kPt);
          prevPt = kPt;
          if (k < j) {
            const kDistOrig = haversineMeters(originCoords, kPt);
            const kDistDest = haversineMeters(destCoords, kPt);
            // Se dopo essersi allontanato dall'origine il mezzo ripassa vicino all'origine (ramo opposto dell'anello), scarta
            if (k > i + 2 && kDistOrig <= Math.max(240, dOrig + 70)) {
              hasLoopOrOvershoot = true;
              break;
            }
            // Se una fermata precedente è già sensibilmente più vicina alla destinazione finale, evita di proseguire oltre
            if (kDistDest < dDest - 60) {
              hasLoopOrOvershoot = true;
              break;
            }
          }
        }
        if (hasLoopOrOvershoot) continue;

        const straightStopDistM = haversineMeters(
          { lat: s.lat, lng: s.lon },
          { lat: ds.lat, lng: ds.lon }
        );
        if (straightStopDistM > 350 && pathDistM > Math.max(1400, straightStopDistM * 2.35)) {
          continue;
        }

        const pairScore = dOrig + dDest + rideMins * 38;
        if (pairScore < bestPairScore) {
          bestPairScore = pairScore;
          bestBoardIdx = i;
          bestBoardDist = dOrig;
          bestAlightIdx = j;
          bestAlightDist = dDest;
        }
      }
    }

    if (bestBoardIdx < 0 || bestAlightIdx <= bestBoardIdx) {
      nonServingRouteCache.set(selectedCandidates[tIdx].nonServeKey, Date.now());
      continue;
    }

    const fromStop = allStops[bestBoardIdx];
    const toStop = allStops[bestAlightIdx];
    const boardIso =
      fromStop.departure || fromStop.scheduledDeparture || fromStop.arrival;
    const alightIso =
      toStop.arrival || toStop.scheduledArrival || toStop.departure;
    if (!boardIso || !alightIso) continue;

    const boardMs = new Date(boardIso).getTime();
    const alightMs = new Date(alightIso).getTime();
    const rideMinutes = (alightMs - boardMs) / 60000;

    // Scarta corse che compiono giri circolari opposti eccessivamente lunghi (es. 71 giro lungo 65m)
    if (!Number.isFinite(rideMinutes) || rideMinutes < 1 || rideMinutes > 50) {
      continue;
    }

    const walkBeforeSec = Math.max(60, Math.round((bestBoardDist * 1.15) / 1.3));
    const walkAfterSec = Math.max(30, Math.round((bestAlightDist * 1.15) / 1.3));
    const totalStartIso = new Date(boardMs - walkBeforeSec * 1000).toISOString();
    const totalEndIso = new Date(alightMs + walkAfterSec * 1000).toISOString();

    let slicedLegGeometry: any = undefined;
    if (fullLeg?.legGeometry?.points) {
      const precision = fullLeg.legGeometry.precision || 6;
      const decoded = decodePolyLocal(fullLeg.legGeometry.points, precision);
      const sliced = slicePolylineBetweenStops(
        decoded,
        { lat: fromStop.lat, lng: fromStop.lon },
        { lat: toStop.lat, lng: toStop.lon }
      );
      if (sliced.length >= 2) {
        slicedLegGeometry = {
          points: encodePolyLocal(sliced, precision),
          precision,
        };
      }
    }

    const schedBoardIso = fromStop.scheduledDeparture || boardIso;
    const depDelaySec = Math.round(
      (new Date(boardIso).getTime() - new Date(schedBoardIso).getTime()) / 1000
    );

    const intermediateStops = allStops.slice(bestBoardIdx + 1, bestAlightIdx);
    const transitLeg = {
      mode: fullLeg.mode || 'BUS',
      routeShortName: fullLeg.routeShortName || '',
      routeId: fullLeg.routeId,
      directionId: fullLeg.directionId,
      headsign: fullLeg.headsign || toStop.name,
      agencyName: fullLeg.agencyName || 'Atac',
      realTime: Boolean(fullLeg.realTime),
      tripId: selectedCandidates[tIdx].tripId,
      tripFrom: fullLeg.from,
      tripTo: fullLeg.to,
      startTime: boardIso,
      endTime: alightIso,
      scheduledStartTime: schedBoardIso,
      scheduledEndTime: toStop.scheduledArrival || alightIso,
      departureDelay: Number.isFinite(depDelaySec) ? depDelaySec : 0,
      from: { ...fromStop, departure: boardIso },
      to: { ...toStop, arrival: alightIso },
      intermediateStops,
      legGeometry: slicedLegGeometry,
    };

    const walkBeforeLeg = {
      mode: 'WALK',
      startTime: totalStartIso,
      endTime: boardIso,
      duration: walkBeforeSec,
      distance: Math.round(bestBoardDist * 1.15),
    };

    const walkAfterLeg = {
      mode: 'WALK',
      startTime: alightIso,
      endTime: totalEndIso,
      duration: walkAfterSec,
      distance: Math.round(bestAlightDist * 1.15),
    };

    syntheticItineraries.push({
      duration: Math.round((alightMs + walkAfterSec * 1000 - (boardMs - walkBeforeSec * 1000)) / 1000),
      startTime: totalStartIso,
      endTime: totalEndIso,
      legs: [walkBeforeLeg, transitLeg, walkAfterLeg],
    });
  }

  return syntheticItineraries;
}
