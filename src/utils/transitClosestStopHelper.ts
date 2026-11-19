import {
  haversineMeters,
  LatLngPoint,
  resolveDynamicPublicStreetAccess,
  resolvePedestrianRoadwayPolyline,
} from './transitRoadwayRouter';

const STOPS_CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 ore
const nearbyStopsCache = new Map<string, { ts: number; stops: any[] }>();
const tripDetailsCache = new Map<string, { ts: number; data: any }>();
const nonServingRouteCache = new Map<string, number>();

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
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}_${deltaLat.toFixed(3)}`;
  const cached = nearbyStopsCache.get(key);
  if (cached && Date.now() - cached.ts < STOPS_CACHE_TTL_MS) {
    return cached.stops;
  }

  const maxLat = (center.lat + deltaLat).toFixed(5);
  const minLat = (center.lat - deltaLat).toFixed(5);
  const minLon = (center.lng - deltaLng).toFixed(5);
  const maxLon = (center.lng + deltaLng).toFixed(5);
  const url = `https://api.transitous.org/api/v1/map/stops?min=${maxLat},${minLon}&max=${minLat},${maxLon}`;

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
    return list;
  } catch {
    return [];
  }
}

async function fetchTransitousTripDetails(tripId: string): Promise<any | null> {
  if (!tripId) return null;
  const cached = tripDetailsCache.get(tripId);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 15) {
    return cached.data;
  }

  const url = `https://api.transitous.org/api/v5/trip?tripId=${encodeURIComponent(tripId)}`;
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
    tripDetailsCache.set(tripId, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

async function fetchTransitousStopTimes(
  stopId: string,
  queryIso: string,
  limit = 24
): Promise<any[]> {
  const url = `https://api.transitous.org/api/v1/stoptimes?stopId=${encodeURIComponent(
    stopId
  )}&time=${encodeURIComponent(queryIso)}&n=${limit}`;
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
    return Array.isArray(data?.stopTimes) ? data.stopTimes : [];
  } catch {
    return [];
  }
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

  const tripData = await fetchTransitousTripDetails(leg.tripId);
  if (!tripData) return leg;

  const tripIt = Array.isArray(tripData?.itineraries) ? tripData.itineraries[0] : tripData;
  const tripLeg = tripIt?.legs?.[0];
  const allStops = getAllOrderedTripStops(tripData);
  if (allStops.length < 2) return leg;

  const normCurrFrom = normStopKey(leg.from?.name);
  const normCurrTo = normStopKey(leg.to?.name);

  let fromIdx = allStops.findIndex(
    (s) =>
      (leg.from?.stopId && s.stopId === leg.from.stopId) ||
      (normCurrFrom && normStopKey(s.name) === normCurrFrom && haversineMeters({ lat: s.lat, lng: s.lon }, { lat: currentFromLat, lng: currentFromLon }) < 180)
  );
  let toIdx = allStops.findIndex(
    (s, idx) =>
      idx > Math.max(0, fromIdx) &&
      ((leg.to?.stopId && s.stopId === leg.to.stopId) ||
        (normCurrTo && normStopKey(s.name) === normCurrTo && haversineMeters({ lat: s.lat, lng: s.lon }, { lat: currentToLat, lng: currentToLon }) < 180))
  );

  if (fromIdx < 0 || toIdx <= fromIdx) return leg;

  // Cerca una fermata di salita più vicina (senza tagliare dopo toIdx)
  let bestFromIdx = fromIdx;
  let bestFromDist = distOrigToCurr;
  for (let i = 0; i < toIdx; i++) {
    const s = allStops[i];
    if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
    const d = haversineMeters(originCoords, { lat: s.lat, lng: s.lon });
    if (d < bestFromDist - 45 && d <= 600) {
      const depIso = s.departure || s.arrival || s.scheduledDeparture || s.scheduledArrival;
      const depMs = depIso ? new Date(depIso).getTime() : NaN;
      const walkEstMs = Math.max(1, Math.round((d * 1.15) / 78)) * 60000;
      if (originLeaveEpochMs && Number.isFinite(depMs) && depMs < originLeaveEpochMs + walkEstMs) {
        continue;
      }
      bestFromDist = d;
      bestFromIdx = i;
    }
  }

  // Cerca una fermata di discesa più vicina dopo la salita
  let bestToIdx = toIdx;
  let bestToDist = distCurrToDest;
  for (let i = bestFromIdx + 1; i < allStops.length; i++) {
    const s = allStops[i];
    if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
    const d = haversineMeters(destCoords, { lat: s.lat, lng: s.lon });
    if (d < bestToDist - 45 && d <= 600) {
      bestToDist = d;
      bestToIdx = i;
    }
  }

  if (bestFromIdx === fromIdx && bestToIdx === toIdx) {
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

  // Raggruppa le fermate di origine per nome cluster (max 8 fermate vicine <= 480m + max 1 metro <= 850m)
  const originCandidates: { stop: any; dist: number; isMetro: boolean }[] = [];
  const seenNames = new Set<string>();
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
    if (item.isMetro) {
      if (!includeMetro || metroAdded || item.dist > 850) continue;
      const key = `metro_${normStopKey(item.stop.name) || item.stop.stopId}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      originCandidates.push(item);
      metroAdded = true;
      continue;
    }
    if (item.dist > 480 || originCandidates.length >= 7) continue;
    const key = normStopKey(item.stop.name) || item.stop.stopId;
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    originCandidates.push(item);
  }

  if (originCandidates.length === 0) return [];

  const baseEpochMs = new Date(queryIso).getTime();
  const maxEpochMs = baseEpochMs + windowMinutes * 60000;

  const stopTimesLists = await Promise.all(
    originCandidates.map((c) => fetchTransitousStopTimes(c.stop.stopId, queryIso, 24))
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
  const selectedCandidates = candidateTrips.slice(0, 16);
  if (selectedCandidates.length === 0) return [];

  const tripResults = await Promise.all(
    selectedCandidates.map((c) => fetchTransitousTripDetails(c.tripId))
  );

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

    // Cerca tutte le fermate di discesa vicine alla destinazione (dopo la potenziale salita)
    let bestBoardIdx = -1;
    let bestBoardDist = Infinity;
    let bestAlightIdx = -1;
    let bestAlightDist = Infinity;

    for (let i = 0; i < allStops.length; i++) {
      const s = allStops[i];
      if (typeof s?.lat !== 'number' || typeof s?.lon !== 'number') continue;
      const dOrig = haversineMeters(originCoords, { lat: s.lat, lng: s.lon });
      if (dOrig <= 560 && dOrig < bestBoardDist) {
        const depIso = s.departure || s.scheduledDeparture || s.arrival;
        const depMs = depIso ? new Date(depIso).getTime() : NaN;
        const walkEstMs = Math.max(1, Math.round((dOrig * 1.12) / 78)) * 60000;
        if (Number.isFinite(depMs) && depMs >= baseEpochMs + walkEstMs - 60000 && depMs <= maxEpochMs) {
          // Verifica che dopo questa fermata ci sia una fermata vicina alla destinazione
          let foundDestAfter = false;
          for (let j = i + 1; j < allStops.length; j++) {
            const ds = allStops[j];
            if (typeof ds?.lat !== 'number' || typeof ds?.lon !== 'number') continue;
            if (
              destStopIdSet.has(ds.stopId) ||
              haversineMeters(destCoords, { lat: ds.lat, lng: ds.lon }) <= 540
            ) {
              foundDestAfter = true;
              break;
            }
          }
          if (foundDestAfter) {
            bestBoardDist = dOrig;
            bestBoardIdx = i;
          }
        }
      }
    }

    if (bestBoardIdx < 0) {
      nonServingRouteCache.set(selectedCandidates[tIdx].nonServeKey, Date.now());
      continue;
    }

    for (let j = bestBoardIdx + 1; j < allStops.length; j++) {
      const ds = allStops[j];
      if (typeof ds?.lat !== 'number' || typeof ds?.lon !== 'number') continue;
      const dDest = haversineMeters(destCoords, { lat: ds.lat, lng: ds.lon });
      if ((destStopIdSet.has(ds.stopId) || dDest <= 540) && dDest < bestAlightDist) {
        bestAlightDist = dDest;
        bestAlightIdx = j;
      }
    }

    if (bestAlightIdx <= bestBoardIdx) continue;

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
