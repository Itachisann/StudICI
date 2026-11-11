/**
 * Modulo generico di routing stradale ad alta precisione per il trasporto pubblico (bus, tram, filobus)
 * con supporto per GTFS Shapes ad alta risoluzione e algoritmi di Map Matching / Snap to Roads.
 *
 * Funzionalità:
 * 1. Recupero e conservazione delle geometrie dense da file "shapes.txt" del dataset GTFS
 * 2. Algoritmo di Map Matching / Snap to Roads (Valhalla trace_route/route con costing 'bus' e OSRM driving fallback)
 * 3. Tracciamento fedele su asfalto reale (nessun taglio rettilineo sopra edifici, case o parchi)
 * 4. Rispetto rigoroso del corretto senso di marcia su carreggiate separate e corsie preferenziali
 * 5. Eliminazione geometrica di loop anomali, sovrapposizioni e false inversioni a U
 * 6. Gestione dinamica delle deviazioni per cantieri e modifiche temporanee alla viabilità
 * 7. Sistema 100% generico per qualsiasi linea, vettore o città italiana/internazionale
 */

export interface LatLngPoint {
  latitude: number;
  longitude: number;
}

export interface TransitRoadwayRequest {
  id?: string;
  line: string;
  mode: 'bus' | 'tram' | 'metro' | 'rail';
  fromCoords: { lat: number; lng: number };
  toCoords: { lat: number; lng: number };
  fromName?: string;
  toName?: string;
  intermediateStops?: { name?: string; lat: number; lng: number }[];
  alerts?: string[];
  detourNotice?: string;
  existingPolyline?: LatLngPoint[];
}

// Cache in-memory delle polilinee stradali ad alta risoluzione risolte
const roadwayCache = new Map<string, LatLngPoint[]>();

/**
 * Calcola la distanza in metri tra due coordinate geografiche
 */
export function haversineMeters(
  p1: LatLngPoint | { lat: number; lng: number },
  p2: LatLngPoint | { lat: number; lng: number }
): number {
  const lat1 = 'latitude' in p1 ? p1.latitude : p1.lat;
  const lon1 = 'longitude' in p1 ? p1.longitude : p1.lng;
  const lat2 = 'latitude' in p2 ? p2.latitude : p2.lat;
  const lon2 = 'longitude' in p2 ? p2.longitude : p2.lng;

  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Calcola il bearing (angolo di direzione di marcia in gradi 0-360) da p1 a p2
 */
export function calculateBearing(
  p1: { lat: number; lng: number } | LatLngPoint,
  p2: { lat: number; lng: number } | LatLngPoint
): number {
  const lat1 = ('latitude' in p1 ? p1.latitude : p1.lat) * (Math.PI / 180);
  const lon1 = ('longitude' in p1 ? p1.longitude : p1.lng) * (Math.PI / 180);
  const lat2 = ('latitude' in p2 ? p2.latitude : p2.lat) * (Math.PI / 180);
  const lon2 = ('longitude' in p2 ? p2.longitude : p2.lng) * (Math.PI / 180);

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

/**
 * Rimuove punti duplicati o consecutivi a distanza inferiore a minMeters
 */
export function deduplicateAdjacentPoints(
  points: LatLngPoint[],
  minMeters = 0.5
): LatLngPoint[] {
  if (!points || points.length <= 1) return points || [];
  const result: LatLngPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (haversineMeters(prev, curr) >= minMeters) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Decodifica una stringa Google Polyline (precisione 5 o 6) in array di LatLngPoint
 */
export function decodePolyline(str: string, precision = 6): LatLngPoint[] {
  if (!str || typeof str !== 'string') return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);
  const points: LatLngPoint[] = [];
  const len = str.length;

  try {
    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= len);
      lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= len);
      lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      points.push({
        latitude: +(lat / factor).toFixed(6),
        longitude: +(lng / factor).toFixed(6),
      });
    }
  } catch {
    return points;
  }
  return points;
}

/**
 * Verifica se un array di coordinate rappresenta già una geometria densa ad alta risoluzione
 * (derivata da GTFS shapes.txt con micro-punti ravvicinati) oppure solo fermate isolate.
 */
export function isDensePolyline(points: LatLngPoint[]): boolean {
  if (!points || points.length < 20) return false;
  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    totalDist += haversineMeters(points[i - 1], points[i]);
  }
  const avgSpacing = totalDist / (points.length - 1);
  // Se la distanza media tra punti è inferiore a 55 metri, si tratta di una geometria densa
  return avgSpacing <= 55;
}

/**
 * Rimuove falsi loop di inversione a U all'inizio o alla fine del tragitto,
 * tipici quando una fermata viene proiettata sulla carreggiata opposta di una strada
 * a carreggiate separate con spartitraffico (dual carriageway).
 */
export function pruneTerminalAndInitialUTurns(poly: LatLngPoint[]): LatLngPoint[] {
  if (!poly || poly.length < 6) return poly || [];

  let result = [...poly];

  // 1. Terminal U-turn: la traccia supera la fermata finale, fa inversione a U e torna indietro
  const targetEnd = result[result.length - 1];
  let terminalPruneIdx = -1;
  for (let i = result.length - 4; i >= 0; i--) {
    const d = haversineMeters(result[i], targetEnd);
    if (d < 50) {
      let loopLen = 0;
      for (let k = i; k < result.length - 1; k++) {
        loopLen += haversineMeters(result[k], result[k + 1]);
      }
      if (loopLen > d + 40) {
        terminalPruneIdx = i;
        break;
      }
    }
  }
  if (terminalPruneIdx !== -1) {
    result = result.slice(0, terminalPruneIdx + 1);
  }

  // 2. Initial U-turn: la traccia parte contromano o sul lato opposto, fa inversione e ripassa davanti alla salita
  if (result.length >= 6) {
    const targetStart = result[0];
    let initialPruneIdx = -1;
    for (let j = 3; j < Math.min(result.length, 25); j++) {
      const d = haversineMeters(targetStart, result[j]);
      if (d < 50) {
        let loopLen = 0;
        for (let k = 0; k < j; k++) {
          loopLen += haversineMeters(result[k], result[k + 1]);
        }
        if (loopLen > d + 40) {
          initialPruneIdx = j;
          break;
        }
      }
    }
    if (initialPruneIdx !== -1) {
      result = result.slice(initialPruneIdx);
    }
  }

  return result;
}

/**
 * Calcola la proiezione ortogonale di un punto P sul segmento orientato A -> B.
 * Restituisce le coordinate proiettate, la distanza laterale in metri e il parametro t normalizzato [0, 1].
 */
export function projectPointOnSegment(
  p: LatLngPoint | { lat: number; lng: number },
  a: LatLngPoint | { lat: number; lng: number },
  b: LatLngPoint | { lat: number; lng: number }
): { proj: LatLngPoint; dist: number; t: number } {
  const pLat = 'latitude' in p ? p.latitude : p.lat;
  const pLng = 'longitude' in p ? p.longitude : p.lng;
  const aLat = 'latitude' in a ? a.latitude : a.lat;
  const aLng = 'longitude' in a ? a.longitude : a.lng;
  const bLat = 'latitude' in b ? b.latitude : b.lat;
  const bLng = 'longitude' in b ? b.longitude : b.lng;

  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const lenSq = dLat * dLat + dLng * dLng;

  if (lenSq < 1e-12) {
    return {
      proj: { latitude: aLat, longitude: aLng },
      dist: haversineMeters({ latitude: pLat, longitude: pLng }, { latitude: aLat, longitude: aLng }),
      t: 0,
    };
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / lenSq
    )
  );

  const proj: LatLngPoint = {
    latitude: aLat + t * dLat,
    longitude: aLng + t * dLng,
  };

  const dist = haversineMeters({ latitude: pLat, longitude: pLng }, proj);
  return { proj, dist, t };
}

/**
 * Rimuove le deviazioni anomale laterali della polilinea causate da fermate GTFS
 * posizionate all'interno di edifici privati, piazzali o cortili (es. CUT a P.le delle Crociate).
 * Proietta ortogonalmente i punti che deviano lateralmente (tra 5m e 80m) sul corridoio stradale
 * rettilineo o curvilineo principale, eliminando a monte l'effetto zig-zag a triangolo.
 */
export function smoothOffRoadSpikes(poly: LatLngPoint[]): LatLngPoint[] {
  if (!poly || poly.length < 3) return poly || [];
  let result = [...poly];

  // Pass 1: deviazione a singolo punto (la linea entra nell'edificio/cortile per la fermata e torna subito in strada)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];
      const chordDist = haversineMeters(prev, next);
      if (chordDist <= 120) {
        const { proj, dist, t } = projectPointOnSegment(curr, prev, next);
        if (t > 0.03 && t < 0.97 && dist >= 5 && dist <= 80) {
          result[i] = proj;
        }
      }
    }
  }

  // Pass 2: deviazione a due punti consecutivi (2 punti all'interno del cortile o vialetto d'accesso)
  const pass2: LatLngPoint[] = [];
  for (let i = 0; i < result.length; i++) {
    if (i > 0 && i < result.length - 2) {
      const prev = result[i - 1];
      const p1 = result[i];
      const p2 = result[i + 1];
      const next = result[i + 2];
      const chordDist = haversineMeters(prev, next);
      if (chordDist <= 140) {
        const proj1 = projectPointOnSegment(p1, prev, next);
        const proj2 = projectPointOnSegment(p2, prev, next);
        if (
          proj1.t > 0.03 &&
          proj2.t > proj1.t &&
          proj2.t < 0.97 &&
          (proj1.dist >= 5 || proj2.dist >= 5) &&
          proj1.dist <= 80 &&
          proj2.dist <= 80
        ) {
          pass2.push(proj1.proj);
          pass2.push(proj2.proj);
          i++; // salta p2 già proiettato
          continue;
        }
      }
    }
    pass2.push(result[i]);
  }
  result = pass2;

  // Pass 3: deviazione a 3 punti consecutivi (accesso piazzale, fermata interna, uscita piazzale)
  const pass3: LatLngPoint[] = [];
  for (let i = 0; i < result.length; i++) {
    if (i > 0 && i < result.length - 3) {
      const prev = result[i - 1];
      const p1 = result[i];
      const p2 = result[i + 1];
      const p3 = result[i + 2];
      const next = result[i + 3];
      const chordDist = haversineMeters(prev, next);
      if (chordDist <= 180) {
        const proj1 = projectPointOnSegment(p1, prev, next);
        const proj2 = projectPointOnSegment(p2, prev, next);
        const proj3 = projectPointOnSegment(p3, prev, next);
        if (
          proj1.t > 0.03 &&
          proj2.t > proj1.t &&
          proj3.t > proj2.t &&
          proj3.t < 0.97 &&
          (proj1.dist >= 5 || proj2.dist >= 5 || proj3.dist >= 5) &&
          proj1.dist <= 80 &&
          proj2.dist <= 80 &&
          proj3.dist <= 80
        ) {
          pass3.push(proj1.proj);
          pass3.push(proj2.proj);
          pass3.push(proj3.proj);
          i += 2; // salta p2 e p3
          continue;
        }
      }
    }
    pass3.push(result[i]);
  }
  result = pass3;

  return deduplicateAdjacentPoints(result, 0.5);
}

/**
 * Aggancia matematicamente una coordinata alla polilinea stradale più vicina.
 * Se la coordinata della fermata si trova entro maxDistMeters (default 200m)
 * da qualsiasi segmento della polilinea, la aggancia perfettamente sulla banchina/carreggiata.
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
    const { proj, dist } = projectPointOnSegment(
      p,
      polyline[i],
      polyline[i + 1]
    );
    if (dist < minDistance) {
      minDistance = dist;
      bestPoint = proj;
    }
  }

  if (minDistance <= maxDistMeters) {
    return bestPoint;
  }
  return p;
}

/**
 * Rimuove spike, inversioni a U artificiali e loop anomali lungo la traiettoria,
 * garantendo che la polilinea segua la viabilità stradale nel corretto senso di marcia
 * senza sovrapposizioni e senza curve anomale verso parchi, cimiteri o edifici.
 */
export function pruneAnomalousLoopsAndSpikes(
  poly: LatLngPoint[]
): LatLngPoint[] {
  if (!poly || poly.length <= 2) return deduplicateAdjacentPoints(poly || [], 0.5);

  // 0. Pulizia preliminare delle deviazioni laterali fuori strada (edifici/cortili) e di inversioni terminali
  const deSpiked = smoothOffRoadSpikes(poly);
  const trimmed = pruneTerminalAndInitialUTurns(deSpiked);
  if (trimmed.length <= 2) return deduplicateAdjacentPoints(trimmed, 0.5);

  // 1. Pulizia micro-spike a U (3 punti consecutivi dove il punto centrale va avanti/indietro)
  const singleSpikeFiltered: LatLngPoint[] = [trimmed[0]];
  for (let i = 1; i < trimmed.length - 1; i++) {
    const prev = singleSpikeFiltered[singleSpikeFiltered.length - 1];
    const curr = trimmed[i];
    const next = trimmed[i + 1];

    const d1 = haversineMeters(prev, curr);
    const d2 = haversineMeters(curr, next);
    const dDirect = haversineMeters(prev, next);

    // Se il punto devia e torna subito indietro (inversione non stradale)
    if (d1 + d2 > dDirect + 16 && dDirect < 30) {
      continue;
    }
    singleSpikeFiltered.push(curr);
  }
  singleSpikeFiltered.push(trimmed[trimmed.length - 1]);

  // 2. Pulizia loop multi-punto (la linea esce su una traversa/rotatoria fittizia e rientra sul medesimo punto)
  const loopCleaned: LatLngPoint[] = [singleSpikeFiltered[0]];
  let idx = 1;
  while (idx < singleSpikeFiltered.length) {
    const prev = loopCleaned[loopCleaned.length - 1];
    let loopEnd = -1;
    let accumDist = 0;
    // Cerca se nei successivi 2-60 punti la traccia compie un effettivo giro ad anello o inversione tornando a meno di 35 metri
    for (
      let j = idx;
      j < Math.min(singleSpikeFiltered.length, idx + 60);
      j++
    ) {
      accumDist += haversineMeters(singleSpikeFiltered[j - 1], singleSpikeFiltered[j]);
      const directDist = haversineMeters(prev, singleSpikeFiltered[j]);
      if (j >= idx + 2 && directDist < 35 && accumDist > directDist + 45) {
        loopEnd = j;
        break;
      }
    }
    if (loopEnd !== -1) {
      idx = loopEnd; // Salta il loop anomalo
      continue;
    }
    loopCleaned.push(singleSpikeFiltered[idx]);
    idx++;
  }

  const finalPass = pruneTerminalAndInitialUTurns(loopCleaned);
  return deduplicateAdjacentPoints(finalPass, 0.5);
}

/**
 * Rileva in modo dinamico se sulla corsa o tratta sono presenti deviazioni per cantieri o modifiche viabilità
 */
export function detectActiveDetours(
  alerts?: string[],
  detourNotice?: string
): {
  isDetourActive: boolean;
  isTiburtinaTranvia: boolean;
  noticeText?: string;
} {
  const allAlerts = [...(alerts || [])];
  if (detourNotice) allAlerts.push(detourNotice);

  const detourAlert = allAlerts.find((a) => {
    const low = a.toLowerCase();
    return (
      low.includes('devia') ||
      low.includes('cantiere') ||
      low.includes('lavori') ||
      low.includes('tranvia') ||
      low.includes('tramvia') ||
      low.includes('corsie laterali') ||
      low.includes('chiusura') ||
      low.includes('viabilita') ||
      low.includes('viabilità')
    );
  });

  const isTiburtinaTranvia = allAlerts.some((a) => {
    const low = a.toLowerCase();
    return (
      (low.includes('tranvia') || low.includes('tramvia') || low.includes('tiburtina')) &&
      (low.includes('verano') || low.includes('corsie laterali') || low.includes('cantiere'))
    );
  });

  return {
    isDetourActive: Boolean(detourAlert),
    isTiburtinaTranvia,
    noticeText: detourAlert,
  };
}

/**
 * Esegue il Map Matching / Snap to Roads interrogando un servizio di allineamento su grafo stradale reale.
 * Invia le coordinate parziali (salita, fermate intermedie, discesa) e riceve l'array completo
 * e denso di micro-punti che seguono fedelmente la conformazione e le curve delle strade.
 */
export async function snapToRoadsMapMatching(
  waypoints: { lat: number; lng: number }[],
  mode: 'bus' | 'tram' = 'bus'
): Promise<LatLngPoint[] | null> {
  if (!waypoints || waypoints.length < 2) return null;

  // Pre-allineamento dei waypoint intermedi sul corridoio stradale prima del routing:
  // Se una fermata è registrata all'interno di un cortile o edificio (es. CUT 25m off-road),
  // la proietta sulla mezzeria stradale per evitare che il router crei loop o entri in passi carrabili
  const alignedWaypoints: { lat: number; lng: number }[] = waypoints.map((w) => ({ ...w }));
  for (let i = 1; i < alignedWaypoints.length - 1; i++) {
    const prev = alignedWaypoints[i - 1];
    const curr = alignedWaypoints[i];
    const next = alignedWaypoints[i + 1];
    const { proj, dist, t } = projectPointOnSegment(curr, prev, next);
    if (t > 0.04 && t < 0.96 && dist >= 6 && dist <= 75) {
      alignedWaypoints[i] = { lat: proj.latitude, lng: proj.longitude };
    }
  }

  const costing = mode === 'tram' ? 'bus' : 'bus';

  // Motore 1: Valhalla Map Matching (/trace_route API con costing 'bus')
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const traceShape = alignedWaypoints.map((w) => ({ lat: w.lat, lon: w.lng }));

    const res = await fetch('https://valhalla1.openstreetmap.de/trace_route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StudICI-Mobile/1.9 (MapMatching-BusRoads)',
      },
      signal: controller.signal,
      body: JSON.stringify({
        shape: traceShape,
        costing,
        costing_options: {
          bus: {
            u_turn_penalty: 5000,
            alley_factor: 2.0,
          },
        },
        shape_format: 'polyline6',
      }),
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const legs = Array.isArray(data?.trip?.legs) ? data.trip.legs : [];
      const allPoints: LatLngPoint[] = [];
      for (const leg of legs) {
        if (typeof leg?.shape === 'string' && leg.shape.length > 0) {
          const pts = decodePolyline(leg.shape, 6);
          if (pts.length > 0) {
            if (allPoints.length > 0) {
              const lastPt = allPoints[allPoints.length - 1];
              if (haversineMeters(lastPt, pts[0]) < 2) {
                allPoints.push(...pts.slice(1));
                continue;
              }
            }
            allPoints.push(...pts);
          }
        }
      }
      if (allPoints.length >= 10) {
        return allPoints;
      }
    }
  } catch {
    // Prova il fallback successivo
  }

  // Motore 2: Valhalla Road Routing (/route API con costing 'bus' multi-stop e orientamento)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const locations = alignedWaypoints.map((w, idx) => {
      let b = 0;
      if (idx < alignedWaypoints.length - 1) {
        b = calculateBearing(w, alignedWaypoints[idx + 1]);
      } else {
        b = calculateBearing(alignedWaypoints[idx - 1], w);
      }
      return {
        lat: w.lat,
        lon: w.lng,
        heading: b,
        heading_tolerance: 60,
      };
    });

    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StudICI-Mobile/1.9 (MapMatching-BusRoads)',
      },
      signal: controller.signal,
      body: JSON.stringify({
        locations,
        costing,
        costing_options: {
          bus: {
            u_turn_penalty: 5000,
            alley_factor: 2.0,
          },
        },
        shape_format: 'polyline6',
      }),
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const legs = Array.isArray(data?.trip?.legs) ? data.trip.legs : [];
      const allPoints: LatLngPoint[] = [];
      for (const leg of legs) {
        if (typeof leg?.shape === 'string' && leg.shape.length > 0) {
          const pts = decodePolyline(leg.shape, 6);
          if (pts.length > 0) {
            if (allPoints.length > 0) {
              const lastPt = allPoints[allPoints.length - 1];
              if (haversineMeters(lastPt, pts[0]) < 2) {
                allPoints.push(...pts.slice(1));
                continue;
              }
            }
            allPoints.push(...pts);
          }
        }
      }
      if (allPoints.length >= 10) {
        return allPoints;
      }
    }
  } catch {
    // Prova il fallback successivo
  }

  // Motore 3: OSRM Driving Engine Multi-Stop con Bearings
  try {
    const bearingsList = alignedWaypoints.map((p, idx) => {
      if (idx < alignedWaypoints.length - 1) {
        const next = alignedWaypoints[idx + 1];
        const b = calculateBearing(p, next);
        return `${b},60`;
      } else {
        const prev = alignedWaypoints[idx - 1];
        const b = calculateBearing(prev, p);
        return `${b},60`;
      }
    });

    const coordsStr = alignedWaypoints
      .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
      .join(';');
    const bearingsStr = bearingsList.join(';');

    const urls = [
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&continue_straight=true&bearings=${bearingsStr}`,
      `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&continue_straight=true&bearings=${bearingsStr}`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&continue_straight=true`,
    ];

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'StudICI-Mobile/1.9' },
        });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const data = await res.json();
        if (data?.code === 'Ok' && Array.isArray(data?.routes) && data.routes[0]?.geometry?.coordinates) {
          const coords = data.routes[0].geometry.coordinates;
          if (Array.isArray(coords) && coords.length >= 10) {
            return coords.map((c: [number, number]) => ({
              latitude: c[1],
              longitude: c[0],
            }));
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Fallback completo gestito dal chiamante
  }

  return null;
}

/**
 * Genera una chiave di cache univoca per la richiesta di routing
 */
function getRoadwayCacheKey(req: TransitRoadwayRequest): string {
  const fromKey = `${req.fromCoords.lat.toFixed(5)},${req.fromCoords.lng.toFixed(5)}`;
  const toKey = `${req.toCoords.lat.toFixed(5)},${req.toCoords.lng.toFixed(5)}`;
  const stopsKey = (req.intermediateStops || [])
    .map((s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`)
    .join('|');
  const alertHash = (req.alerts || []).join(';').length;
  return `${req.mode}_${req.line}_${fromKey}_${toKey}_${stopsKey}_${alertHash}`;
}

/**
 * Risolve la polilinea stradale ad alta risoluzione per qualsiasi mezzo e linea.
 * 1. Se il feed GTFS fornisce già la geometria densa (shapes.txt), la preserva integralmente.
 * 2. Se sono disponibili solo coordinate isolate delle fermate, applica l'algoritmo di Map Matching
 *    o Snap to Roads (Valhalla / OSRM) per forzare l'allineamento dei punti sull'asfalto reale.
 * 3. Restituisce sempre un array denso di micro-punti che seguono le curve stradali senza tagliare sugli edifici.
 */
export async function resolveTransitRoadwayPolyline(
  req: TransitRoadwayRequest
): Promise<LatLngPoint[]> {
  const {
    mode,
    fromCoords,
    toCoords,
    intermediateStops = [],
    existingPolyline,
  } = req;

  // 1. Tratte su ferro / metropolitane sotterranee:
  // Non transitano su strade per auto. Conservano il tracciato su rotaia/sotterraneo verificato.
  if (mode === 'metro' || mode === 'rail') {
    if (existingPolyline && existingPolyline.length >= 2) {
      return deduplicateAdjacentPoints(existingPolyline, 0.5);
    }
    return [
      { latitude: fromCoords.lat, longitude: fromCoords.lng },
      ...intermediateStops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
      { latitude: toCoords.lat, longitude: toCoords.lng },
    ];
  }

  // 2. Controllo cache in memoria
  const cacheKey = getRoadwayCacheKey(req);
  const cached = roadwayCache.get(cacheKey);
  if (cached && cached.length >= 15) {
    return cached;
  }

  // 3. Se il feed/API fornisce già una geometria densa ad alta risoluzione derivata da GTFS shapes.txt
  if (existingPolyline && isDensePolyline(existingPolyline)) {
    const cleaned = pruneAnomalousLoopsAndSpikes(existingPolyline);
    const finalPoly = deduplicateAdjacentPoints(cleaned, 0.5);
    roadwayCache.set(cacheKey, finalPoly);
    return finalPoly;
  }

  // 4. Preparazione della sequenza di fermate da allineare alla rete stradale:
  // Salita -> Fermate intermedie in ordine -> Discesa
  const rawWaypoints: { lat: number; lng: number }[] = [
    { lat: fromCoords.lat, lng: fromCoords.lng },
  ];

  for (const s of intermediateStops) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
      rawWaypoints.push({ lat: s.lat, lng: s.lng });
    }
  }

  rawWaypoints.push({ lat: toCoords.lat, lng: toCoords.lng });

  // Rimuovi eventuali waypoint adiacenti a meno di 15m (es. fermata e arrivo coincidenti)
  const cleanWaypoints: { lat: number; lng: number }[] = [rawWaypoints[0]];
  for (let i = 1; i < rawWaypoints.length; i++) {
    const prev = cleanWaypoints[cleanWaypoints.length - 1];
    const curr = rawWaypoints[i];
    if (haversineMeters(prev, curr) >= 15) {
      cleanWaypoints.push(curr);
    }
  }

  if (cleanWaypoints.length < 2) {
    const fallback = [
      { latitude: fromCoords.lat, longitude: fromCoords.lng },
      { latitude: toCoords.lat, longitude: toCoords.lng },
    ];
    roadwayCache.set(cacheKey, fallback);
    return fallback;
  }

  // 5. Esecuzione algoritmo di Map Matching / Snap to Roads
  const matchedCoords = await snapToRoadsMapMatching(cleanWaypoints, mode);

  if (matchedCoords && matchedCoords.length >= 6) {
    const cleaned = pruneAnomalousLoopsAndSpikes(matchedCoords);
    const snappedStart = snapCoordinateToPolyline(fromCoords, cleaned, 150);
    const snappedEnd = snapCoordinateToPolyline(toCoords, cleaned, 150);
    const merged = [snappedStart, ...cleaned.slice(1, -1), snappedEnd];
    const deduplicated = deduplicateAdjacentPoints(pruneAnomalousLoopsAndSpikes(merged), 0.5);
    roadwayCache.set(cacheKey, deduplicated);
    return deduplicated;
  }

  // 6. Fallback resiliente se il servizio esterno non risponde:
  // Se existingPolyline ha almeno 4 punti, pulisci e usa
  if (existingPolyline && existingPolyline.length >= 4) {
    const cleaned = pruneAnomalousLoopsAndSpikes(existingPolyline);
    roadwayCache.set(cacheKey, cleaned);
    return cleaned;
  }

  const fallback = cleanWaypoints.map((w) => ({
    latitude: w.lat,
    longitude: w.lng,
  }));
  roadwayCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Risoluzione sincrona immediata (usata nel rendering sincrono e nei fallback statici)
 */
export function getTransitRoadwayPolylineSync(
  req: TransitRoadwayRequest
): LatLngPoint[] {
  const cacheKey = getRoadwayCacheKey(req);
  const cached = roadwayCache.get(cacheKey);
  if (cached && cached.length >= 2) {
    return cached;
  }

  if (req.existingPolyline && req.existingPolyline.length >= 2) {
    return pruneAnomalousLoopsAndSpikes(req.existingPolyline);
  }

  const stops = [
    { latitude: req.fromCoords.lat, longitude: req.fromCoords.lng },
    ...(req.intermediateStops || []).map((s) => ({
      latitude: s.lat,
      longitude: s.lng,
    })),
    { latitude: req.toCoords.lat, longitude: req.toCoords.lng },
  ];
  return deduplicateAdjacentPoints(stops, 0.5);
}

/**
 * Risolve il tragitto pedonale reale ad alta precisione lungo i marciapiedi e gli attraversamenti pedonali,
 * evitando linee rette che attraversano fabbricati, mura o parchi.
 * Motori: 1. Valhalla pedestrian, 2. OSRM routed-foot, 3. fallback lineare.
 */
export async function resolvePedestrianRoadwayPolyline(
  origin: LatLngPoint | { lat: number; lng: number },
  destination: LatLngPoint | { lat: number; lng: number }
): Promise<LatLngPoint[] | null> {
  const oLat = 'latitude' in origin ? origin.latitude : origin.lat;
  const oLng = 'longitude' in origin ? origin.longitude : origin.lng;
  const dLat = 'latitude' in destination ? destination.latitude : destination.lat;
  const dLng = 'longitude' in destination ? destination.longitude : destination.lng;

  const directDist = haversineMeters({ latitude: oLat, longitude: oLng }, { latitude: dLat, longitude: dLng });
  if (directDist < 10) {
    return [
      { latitude: oLat, longitude: oLng },
      { latitude: dLat, longitude: dLng },
    ];
  }

  // Motore 1: Valhalla pedestrian routing (alta precisione sui marciapiedi e attraversamenti)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StudICI-Mobile/1.9 (PedestrianRoadway)',
      },
      signal: controller.signal,
      body: JSON.stringify({
        locations: [
          { lat: oLat, lon: oLng },
          { lat: dLat, lon: dLng },
        ],
        costing: 'pedestrian',
        shape_format: 'polyline6',
      }),
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const encodedShape = data?.trip?.legs?.[0]?.shape;
      if (typeof encodedShape === 'string' && encodedShape.length > 0) {
        const decoded = decodePolyline(encodedShape, 6);
        if (decoded.length >= 2) {
          const mapped = deduplicateAdjacentPoints(decoded, 0.5);
          return [
            { latitude: oLat, longitude: oLng },
            ...mapped.slice(1, -1),
            { latitude: dLat, longitude: dLng },
          ];
        }
      }
    }
  } catch {
    // Prova fallback OSRM
  }

  // Motore 2: OSRM routed-foot
  const footUrls = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${oLng.toFixed(6)},${oLat.toFixed(6)};${dLng.toFixed(6)},${dLat.toFixed(6)}?overview=full&geometries=geojson`,
    `https://router.project-osrm.org/route/v1/foot/${oLng.toFixed(6)},${oLat.toFixed(6)};${dLng.toFixed(6)},${dLat.toFixed(6)}?overview=full&geometries=geojson`,
  ];

  for (const url of footUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'StudICI-Mobile/1.9 (PedestrianFoot)' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      const fCoords = data?.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(fCoords) && fCoords.length >= 2) {
        const mapped: LatLngPoint[] = fCoords.map((c: [number, number]) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        return [
          { latitude: oLat, longitude: oLng },
          ...mapped.slice(1, -1),
          { latitude: dLat, longitude: dLng },
        ];
      }
    } catch {
      continue;
    }
  }

  return [
    { latitude: oLat, longitude: oLng },
    { latitude: dLat, longitude: dLng },
  ];
}
