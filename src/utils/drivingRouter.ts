/**
 * Modulo per il calcolo automatico dei tempi e distanze di guida (Google Maps / OSRM / Geocoding)
 * per il tragitto casa ➔ stazione del pendolare.
 */

export interface DrivingEstimate {
  durationMinutes: number;
  baseDurationMinutes?: number;
  trafficDelayMinutes?: number;
  distanceKm: number;
  isCalculated: boolean;
  routeSummary: string;
  trafficCondition?: string;
  isPeakHour?: boolean;
  mainRoads?: string;
  fluencyStatus?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
}

// 1. Coordinate esatte delle STAZIONI FERROVIARIE (punto di arrivo effettivo del pendolare: piazzale e parcheggio FS)
// NOTA FONDAMENTALE: Le stazioni ferroviarie (es. Orte Scalo, Narni Scalo, Orvieto Scalo) si trovano a diversi km di distanza
// dai rispettivi centri storici comunali. Devono avere coordinate dedicate per non falsare il chilometraggio del viaggio.
const KNOWN_STATION_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  // Stazione di Orte FS (Piazza Giovanni XXIII / Piazza XXV Aprile, Orte Scalo VT)
  orte: { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte (Orte Scalo)' },
  'stazione orte': { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte (Orte Scalo)' },
  'stazione di orte': { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte (Orte Scalo)' },
  'orte scalo': { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte (Orte Scalo)' },

  // Stazione di Narni-Amelia FS (Via Tuderte / Narni Scalo TR)
  'narni-amelia': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia (Narni Scalo)' },
  'narni amelia': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia (Narni Scalo)' },
  narni: { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia (Narni Scalo)' },
  'stazione narni': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia (Narni Scalo)' },
  'stazione di narni': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia (Narni Scalo)' },

  // Stazione di Terni FS (Piazza Dante Alighieri, Terni)
  terni: { lat: 42.5680, lon: 12.6460, name: 'Stazione di Terni' },
  'stazione terni': { lat: 42.5680, lon: 12.6460, name: 'Stazione di Terni' },
  'stazione di terni': { lat: 42.5680, lon: 12.6460, name: 'Stazione di Terni' },

  // Stazione di Civita Castellana-Magliano FS (Piazzale Stazione, Civita Castellana VT)
  'civita castellana': { lat: 42.3020, lon: 12.4200, name: 'Stazione Civita Castellana-Magliano' },
  'civita castellana-magliano': { lat: 42.3020, lon: 12.4200, name: 'Stazione Civita Castellana-Magliano' },
  'stazione civita castellana': { lat: 42.3020, lon: 12.4200, name: 'Stazione Civita Castellana-Magliano' },

  // Stazione di Fara Sabina-Montelibretti FS (Passo Corese RI)
  'fara sabina': { lat: 42.1645, lon: 12.6710, name: 'Stazione Fara Sabina-Montelibretti' },
  'fara sabina-montelibretti': { lat: 42.1645, lon: 12.6710, name: 'Stazione Fara Sabina-Montelibretti' },
  'passo corese': { lat: 42.1645, lon: 12.6710, name: 'Stazione Fara Sabina-Montelibretti' },

  // Stazione di Monterotondo-Mentana FS (Monterotondo Scalo RM)
  monterotondo: { lat: 42.0531, lon: 12.6186, name: 'Stazione Monterotondo-Mentana' },
  'monterotondo-mentana': { lat: 42.0531, lon: 12.6186, name: 'Stazione Monterotondo-Mentana' },

  // Stazione di Poggio Mirteto FS (Poggio Mirteto Scalo RI)
  'poggio mirteto': { lat: 42.2472, lon: 12.6360, name: 'Stazione Poggio Mirteto Scalo' },

  // Stazione di Orvieto FS (Piazza della Pace, Orvieto Scalo TR)
  orvieto: { lat: 42.7240, lon: 12.1280, name: 'Stazione di Orvieto (Orvieto Scalo)' },
  'stazione orvieto': { lat: 42.7240, lon: 12.1280, name: 'Stazione di Orvieto (Orvieto Scalo)' },

  // Stazione di Chiusi-Chianciano Terme FS (Chiusi Scalo SI)
  chiusi: { lat: 43.0163, lon: 11.9542, name: 'Stazione Chiusi-Chianciano Terme' },
  'chiusi-chianciano terme': { lat: 43.0163, lon: 11.9542, name: 'Stazione Chiusi-Chianciano Terme' },

  // Stazione di Viterbo Porta Fiorentina
  'viterbo porta fiorentina': { lat: 42.4258, lon: 12.1065, name: 'Stazione Viterbo Porta Fiorentina' },
  'viterbo porta romana': { lat: 42.4140, lon: 12.1105, name: 'Stazione Viterbo Porta Romana' },
  viterbo: { lat: 42.4258, lon: 12.1065, name: 'Stazione Viterbo Porta Fiorentina' },

  // Stazione di Attigliano-Bomarzo FS
  attigliano: { lat: 42.5152, lon: 12.2955, name: 'Stazione Attigliano-Bomarzo' },
  'attigliano-bomarzo': { lat: 42.5152, lon: 12.2955, name: 'Stazione Attigliano-Bomarzo' },

  // Stazione di Alviano FS
  alviano: { lat: 42.5855, lon: 12.2778, name: 'Stazione di Alviano' },

  // Stazione di Rieti FS
  rieti: { lat: 42.4042, lon: 12.8624, name: 'Stazione di Rieti' },
};

// 2. Coordinate dei CENTRI ABITATI E COMUNI (punto di partenza se non è specificata una via)
const KNOWN_TOWN_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  amelia: { lat: 42.5535, lon: 12.4168, name: 'Amelia' },
  narni: { lat: 42.5186, lon: 12.5142, name: 'Narni Centro' },
  terni: { lat: 42.5639, lon: 12.6433, name: 'Terni Centro' },
  orte: { lat: 42.4590, lon: 12.3850, name: 'Orte Centro' },
  giove: { lat: 42.5113, lon: 12.3325, name: 'Giove' },
  attigliano: { lat: 42.5167, lon: 12.2967, name: 'Attigliano' },
  alviano: { lat: 42.5898, lon: 12.2963, name: 'Alviano' },
  guardea: { lat: 42.6225, lon: 12.2994, name: 'Guardea' },
  'penna in teverina': { lat: 42.4939, lon: 12.3556, name: 'Penna in Teverina' },
  'lugnano in teverina': { lat: 42.5746, lon: 12.3328, name: 'Lugnano in Teverina' },
  montecastrilli: { lat: 42.6508, lon: 12.4862, name: 'Montecastrilli' },
  'avigliano umbro': { lat: 42.6536, lon: 12.4278, name: 'Avigliano Umbro' },
  'san gemini': { lat: 42.6133, lon: 12.5447, name: 'San Gemini' },
  stroncone: { lat: 42.4983, lon: 12.6617, name: 'Stroncone' },
  'magliano sabina': { lat: 42.3601, lon: 12.4812, name: 'Magliano Sabina' },
  'civita castellana': { lat: 42.2965, lon: 12.4132, name: 'Civita Castellana Centro' },
  viterbo: { lat: 42.4174, lon: 12.1047, name: 'Viterbo' },
  orvieto: { lat: 42.7183, lon: 12.1121, name: 'Orvieto Centro' },
  rieti: { lat: 42.4042, lon: 12.8624, name: 'Rieti' },
};

function normalizeKey(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Calcola la distanza Haversine (linea d'aria) in km tra due coordinate
 */
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raggio terra in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const stationCoordsCache = new Map<string, { lat: number; lon: number; name: string }>();
const originCoordsCache = new Map<string, { lat: number; lon: number; name: string }>();
const osrmRouteCache = new Map<string, { durationSec: number; distanceKm: number; steps: any[] }>();

/**
 * Risolve con precisione le coordinate della STAZIONE ferroviaria (FS / Piazzale / Parcheggio)
 * garantendo che NON si punti al centro storico comunale.
 */
async function resolveStationCoordinates(stationQuery: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const clean = normalizeKey(stationQuery)
    .replace(/\bstazione\b/gi, '')
    .replace(/\bferroviaria\b/gi, '')
    .replace(/\bfs\b/gi, '')
    .replace(/\bdi\b/gi, '')
    .trim();

  if (stationCoordsCache.has(clean)) {
    return stationCoordsCache.get(clean)!;
  }

  // 1. Cerca prima corrispondenza esatta nella tabella delle stazioni ferroviarie
  if (KNOWN_STATION_COORDINATES[clean]) {
    const found = KNOWN_STATION_COORDINATES[clean];
    stationCoordsCache.set(clean, found);
    return found;
  }

  // 2. Cerca per inclusione del nome stazione nella tabella stazioni
  for (const [k, coords] of Object.entries(KNOWN_STATION_COORDINATES)) {
    if (clean === k || clean.includes(k) || k.includes(clean)) {
      return coords;
    }
  }

  // 3. Fallback geocoding dinamico via Nominatim con query esplicita stazione ferroviaria
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      `Stazione Ferroviaria di ${clean}, Italia`
    )}&format=json&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StudICI-App/1.6' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          name: data[0].display_name || `Stazione di ${clean}`,
        };
      }
    }
  } catch {}

  return null;
}

/**
 * Risolve le coordinate geografiche dell'INDIRIZZO DI PARTENZA (indirizzo con via/civico o comune).
 * Se l'utente inserisce solo via e civico senza comune (es. "Via Roma 135c"),
 * associa automaticamente il comune di riferimento (Amelia) per evitare falsi positivi in altre regioni.
 */
async function resolveOriginCoordinates(
  originQuery: string,
  referenceStationName?: string
): Promise<{ lat: number; lon: number; name: string } | null> {
  const clean = normalizeKey(originQuery);
  if (!clean) return null;

  if (originCoordsCache.has(clean)) {
    return originCoordsCache.get(clean)!;
  }

  const isSpecificStreet =
    /\b(via|viale|corso|piazza|vicolo|strada|largo|contrada|localit[aà]|loc\.|frazione|fraz\.|voc\.|vocabolo)\b/i.test(
      originQuery
    ) || /\d+/.test(originQuery);

  // Se è un indirizzo con via o numero civico specifico
  if (isSpecificStreet) {
    // Verifica se l'indirizzo contiene già un comune noto
    const containsKnownTown = Object.keys(KNOWN_TOWN_COORDINATES).some((t) => clean.includes(t));

    // Se l'utente NON ha specificato il comune (es. ha scritto solo "Via Roma 135c" o "Via Amerina 15"):
    // Prova prima con il comune pendolare predefinito (Amelia) se collegato alla tratta Orte/Narni
    if (!containsKnownTown) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          `${originQuery}, Amelia, Italia`
        )}&format=json&limit=1`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'StudICI-App/1.6' },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
            return {
              lat: parseFloat(data[0].lat),
              lon: parseFloat(data[0].lon),
              name: data[0].display_name,
            };
          }
        }
      } catch {}
    }

    // Geocoding diretto con la query specificata dall'utente (es. "Via Roma 135c, Amelia" o "Via Amerina 15, Amelia")
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        `${originQuery}, Italia`
      )}&format=json&limit=1`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'StudICI-App/1.6' },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
          return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            name: data[0].display_name,
          };
        }
      }
    } catch {}
  }

  // Se è un comune senza via specifica, cerca nella tabella dei centri abitati
  for (const [k, coords] of Object.entries(KNOWN_TOWN_COORDINATES)) {
    if (clean === k || clean.includes(k) || k.includes(clean)) {
      return coords;
    }
  }

  // Fallback geocoding per comuni non in tabella
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      `${originQuery}, Italia`
    )}&format=json&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StudICI-App/1.6' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          name: data[0].display_name,
        };
      }
    }
  } catch {}

  return null;
}

export interface RouteFluencyResult {
  finalMinutes: number;
  baseMinutes: number;
  delayMinutes: number;
  status: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
  conditionDescription: string;
  routeSummary: string;
  isPeakHour: boolean;
  mainRoads?: string;
  speedKmh: number;
}

/**
 * Analizzatore universale e DINAMICO delle condizioni di scorrevolezza e traffico per qualsiasi percorso stradale
 * da qualsiasi indirizzo/località verso qualsiasi stazione ferroviaria in Italia.
 *
 * Implementa un modello analogo a Google Maps:
 * - Tempo base di percorrenza free-flow (senza rallentamenti artificiali fissi)
 * - Curva dinamica continua di congestione (Gaussiana centrata nei momenti di reale afflusso pendolare)
 * - Distinzione netta tra feriale e weekend (sabato/domenica sempre scorrevole, 0 ritardi)
 * - Nessun falso allarme: se il ritardo fisiologico è <= 1 min, il traffico è classificato come "scorrevole"
 *   senza imporre penalità arbitrarie.
 */
export function analyzeRouteFluency(options: {
  distanceKm: number;
  durationSec: number;
  steps?: any[];
  targetTimeStr?: string;
  targetDate?: Date;
  stationName?: string;
  originName?: string;
}): RouteFluencyResult {
  const { distanceKm, durationSec, steps, targetTimeStr, targetDate, stationName, originName } = options;

  let totalMins = 0;
  if (targetTimeStr && targetTimeStr.includes(':')) {
    const [th, tm] = targetTimeStr.split(':').map(Number);
    totalMins = th * 60 + tm;
  } else {
    const now = new Date();
    totalMins = now.getHours() * 60 + now.getMinutes();
  }

  // Base free-flow duration (tempo a strada libera, punto di riferimento analogo al baseline Google Maps)
  const baseMinutes = Math.max(1, Math.round(durationSec / 60));
  const speedKmh = Math.round(distanceKm / (baseMinutes / 60));

  // 1. Estrazione strade principali e complessità degli incroci dal percorso OSRM
  let totalIntersections = 0;
  const roadNames = new Set<string>();

  if (steps && Array.isArray(steps)) {
    for (const s of steps) {
      totalIntersections += s.intersections?.length || 1;
      const ref = (s.ref || '').trim();
      const name = (s.name || '').trim();
      if (ref && ref.length >= 2 && !/^(rotatoria|uscita|rampa)/i.test(ref)) {
        roadNames.add(ref);
      } else if (name && name.length >= 3 && !/^(rotatoria|uscita|rampa|svincolo|strada)/i.test(name)) {
        roadNames.add(name);
      }
    }
  }

  const intersectionsPerKm = distanceKm > 0 ? totalIntersections / distanceKm : 1;
  const mainRoadsList = Array.from(roadNames).slice(0, 2);
  const mainRoadsText = mainRoadsList.length > 0 ? ` via ${mainRoadsList.join(' e ')}` : '';

  // 2. Analisi giorno della settimana e contesto orario dinamico (curva continua stile Google Maps)
  const dateObj = targetDate || new Date();
  const dayOfWeek = dateObj.getDay(); // 0 = Domenica, 6 = Sabato
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let delayMinutes = 0;
  let status: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' = 'scorrevole';
  let conditionDescription = 'traffico scorrevole (in linea con i tempi ottimali)';
  let isPeakHour = false;

  if (isWeekend) {
    // Nel fine settimana il traffico pendolare lavorativo/scolastico è azzerato
    status = 'scorrevole';
    conditionDescription = 'viabilità del fine settimana: traffico scorrevole';
    delayMinutes = 0;
    isPeakHour = false;
  } else {
    // Giorni feriali: curva continua di densità di traffico (senza gradini rigidi)
    // Picco mattutino pendolari centrato alle 07:50 (470 min) con dispersione naturale
    const morningDiff = totalMins - 470;
    const morningIntensity = Math.exp(-(morningDiff * morningDiff) / (2 * 25 * 25));

    // Picco serale rientro pendolare centrato alle 18:00 (1080 min)
    const eveningDiff = totalMins - 1080;
    const eveningIntensity = Math.exp(-(eveningDiff * eveningDiff) / (2 * 30 * 30));

    // Ponderazione feriale: Martedì-Giovedì picco massimo (1.0), Lunedì e Venerdì mattina più diluiti
    let dayWeight = 1.0;
    if (dayOfWeek === 1) dayWeight = 0.85; // Lunedì
    else if (dayOfWeek === 5) dayWeight = 0.8; // Venerdì mattina

    const effectiveIntensity = Math.max(morningIntensity, eveningIntensity) * dayWeight;
    isPeakHour = effectiveIntensity > 0.45;

    // Se la velocità di crociera è elevata (> 65 km/h, superstrada/strada statale aperta),
    // la tratta assorbe molto meglio il traffico rispetto a vie urbane strette
    const speedFactor = speedKmh > 65 ? 0.75 : 1.0;
    const urbanDensityFactor = intersectionsPerKm > 1.3 ? 1.2 : 1.0;

    // Margine massimo di ritardo fisiologico stimabile (tipicamente 2-5 min per percorsi pendolari extraurbani)
    const maxCongestionDelay = Math.min(6, Math.max(2, Math.round(baseMinutes * 0.18 * speedFactor * urbanDensityFactor)));

    // Calcolo del ritardo dinamico effettivo
    const rawDelay = maxCongestionDelay * effectiveIntensity;
    delayMinutes = Math.round(rawDelay);

    // Classificazione dello stato (ispirata alla logica di Google Maps)
    if (delayMinutes <= 1) {
      // Traffico in linea con il tempo free-flow: NESSUN ritardo forzato o allarmismo
      delayMinutes = 0;
      status = 'scorrevole';
      conditionDescription = isPeakHour
        ? 'ora di punta regolare: viabilità fluida senza intoppi'
        : 'traffico scorrevole (in linea con i tempi ottimali)';
    } else if (delayMinutes === 2) {
      status = 'moderato';
      conditionDescription = `traffico moderato (+${delayMinutes} min rispetto al tempo base)`;
    } else if (delayMinutes <= 4) {
      status = 'rallentamenti';
      conditionDescription = `rallentamenti verso la stazione (+${delayMinutes} min rispetto al tempo base)`;
    } else {
      status = 'intenso';
      conditionDescription = `traffico intenso di rientro (+${delayMinutes} min rispetto al tempo base)`;
    }
  }

  const finalMinutes = Math.max(3, baseMinutes + delayMinutes);

  const destName = stationName || 'Stazione FS';
  const startName = originName || 'Partenza';
  const kmFormatted = +(distanceKm).toFixed(1);

  const delayText = delayMinutes > 0 ? ` • +${delayMinutes}m ritardo` : ' • scorrevole';
  const routeSummary = `${startName} ➔ ${destName} (${kmFormatted} km${mainRoadsText} • ~${finalMinutes} min${delayText})`;

  return {
    finalMinutes,
    baseMinutes,
    delayMinutes,
    status,
    conditionDescription,
    routeSummary,
    isPeakHour,
    mainRoads: mainRoadsList.join(' e ') || undefined,
    speedKmh,
  };
}

/**
 * Calcola automaticamente il tempo stimato di guida e la distanza tra l'indirizzo di partenza
 * e la stazione ferroviaria per qualsiasi località in Italia.
 * Interroga il motore di routing OSRM con steps ed esegue l'analisi dinamica di scorrevolezza.
 */
export async function calculateDrivingEstimate(
  originAddress: string,
  stationName: string,
  targetTimeStr?: string,
  originCoords?: { lat: number; lon: number },
  targetDate?: Date
): Promise<DrivingEstimate> {
  const origin = originAddress.trim() || 'Amelia';
  const station = stationName.trim() || 'Orte';

  try {
    const [coordsOrigin, coordsStation] = await Promise.all([
      originCoords
        ? Promise.resolve({ lat: originCoords.lat, lon: originCoords.lon, name: origin })
        : resolveOriginCoordinates(origin, station),
      resolveStationCoordinates(station),
    ]);

    if (coordsOrigin && coordsStation) {
      const routeKey = `${coordsOrigin.lat.toFixed(4)},${coordsOrigin.lon.toFixed(4)}_${coordsStation.lat.toFixed(4)},${coordsStation.lon.toFixed(4)}`;
      let routeData = osrmRouteCache.get(routeKey);

      if (!routeData) {
        // 1. Calcolo percorso stradale turn-by-turn con OSRM ed estrazione manovre/strade
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);

          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsOrigin.lon},${coordsOrigin.lat};${coordsStation.lon},${coordsStation.lat}?steps=true&overview=false`;
          const res = await fetch(osrmUrl, { signal: controller.signal });
          clearTimeout(timeout);

          if (res.ok) {
            const json = await res.json();
            if (json?.routes && json.routes[0]) {
              routeData = {
                durationSec: json.routes[0].duration,
                distanceKm: +(json.routes[0].distance / 1000).toFixed(1),
                steps: json.routes[0].legs?.[0]?.steps || [],
              };
              osrmRouteCache.set(routeKey, routeData);
            }
          }
        } catch {}
      }

      if (routeData) {
        // Analisi dinamica universale della scorrevolezza (0ms CPU)
        const fluency = analyzeRouteFluency({
          distanceKm: routeData.distanceKm,
          durationSec: routeData.durationSec,
          steps: routeData.steps,
          targetTimeStr,
          targetDate,
          stationName: coordsStation.name,
          originName: origin,
        });

        return {
          durationMinutes: fluency.finalMinutes,
          baseDurationMinutes: fluency.baseMinutes,
          trafficDelayMinutes: fluency.delayMinutes,
          distanceKm: routeData.distanceKm,
          isCalculated: true,
          routeSummary: fluency.routeSummary,
          trafficCondition: fluency.conditionDescription,
          isPeakHour: fluency.isPeakHour,
          mainRoads: fluency.mainRoads,
          fluencyStatus: fluency.status,
        };
      }

      // 2. Modello matematico stradale (tortuosità 1.38x per viabilità provinciale/regionale, velocità media 44 km/h)
      const directKm = haversineDistanceKm(
        coordsOrigin.lat,
        coordsOrigin.lon,
        coordsStation.lat,
        coordsStation.lon
      );
      const roadKm = +(directKm * 1.38).toFixed(1);
      const estimatedSec = (roadKm / 44) * 3600;

      const fluency = analyzeRouteFluency({
        distanceKm: roadKm,
        durationSec: estimatedSec,
        targetTimeStr,
        targetDate,
        stationName: coordsStation.name,
        originName: origin,
      });

      return {
        durationMinutes: fluency.finalMinutes,
        baseDurationMinutes: fluency.baseMinutes,
        trafficDelayMinutes: fluency.delayMinutes,
        distanceKm: roadKm,
        isCalculated: true,
        routeSummary: fluency.routeSummary,
        trafficCondition: fluency.conditionDescription,
        isPeakHour: fluency.isPeakHour,
        fluencyStatus: fluency.status,
      };
    }
  } catch {}

  // Fallback universale di sicurezza se il geocoding fallisce
  const fallbackKm = 18.0;
  const fallbackSec = (fallbackKm / 44) * 3600;
  const fallbackFluency = analyzeRouteFluency({
    distanceKm: fallbackKm,
    durationSec: fallbackSec,
    targetTimeStr,
    targetDate,
    stationName: station,
    originName: origin,
  });

  return {
    durationMinutes: fallbackFluency.finalMinutes,
    baseDurationMinutes: fallbackFluency.baseMinutes,
    trafficDelayMinutes: fallbackFluency.delayMinutes,
    distanceKm: fallbackKm,
    isCalculated: false,
    routeSummary: fallbackFluency.routeSummary,
    trafficCondition: fallbackFluency.conditionDescription,
    isPeakHour: fallbackFluency.isPeakHour,
    fluencyStatus: fallbackFluency.status,
  };
}

export interface PlaceSuggestion {
  id: string;
  title: string; // es. "Via Amerina 15"
  subtitle: string; // es. "Amelia, Terni, Umbria"
  label: string; // etichetta compatta salvata come indirizzo di partenza
  lat: number;
  lon: number;
}

async function nominatimSearch(q: string, signal?: AbortSignal): Promise<any[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      q
    )}&format=jsonv2&addressdetails=1&limit=8&countrycodes=it&accept-language=it&dedupe=1`;
    const res = await fetch(url, { signal, headers: { 'User-Agent': 'StudICI-App/1.6' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.filter((d: any) => d?.lat && d?.lon) : [];
  } catch {
    return [];
  }
}

/**
 * Ricerca luoghi/indirizzi in stile Mappe (autocompletamento) tramite Nominatim.
 * - Prima cerca l'indirizzo esatto (via + civico).
 * - Se OpenStreetMap non conosce quel civico, cerca la via senza numero e propone la via
 *   con il civico digitato (posizione approssimata sulla via), senza risultati duplicati.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const numberMatch = q.match(/(?:^|[\s,])(\d{1,4}\s?[a-zA-Z]?)(?=$|[\s,])/);
  const houseNumber = numberMatch ? numberMatch[1].replace(/\s+/g, '') : '';
  const baseQuery = numberMatch
    ? q.replace(numberMatch[0], ' ').replace(/\s*,\s*,/g, ',').replace(/\s+/g, ' ').replace(/^,|,$/g, '').trim()
    : q;

  let raw = await nominatimSearch(q, signal);
  let approximate = false;

  const hasExactNumber = raw.some((d) => d?.address?.house_number);
  if (houseNumber && !hasExactNumber && baseQuery.length >= 3) {
    const byStreet = await nominatimSearch(baseQuery, signal);
    if (byStreet.length > 0) {
      raw = byStreet;
      approximate = true;
    }
  }

  const seen = new Set<string>();
  const results: PlaceSuggestion[] = [];

  for (const d of raw) {
    const a = d.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || '';
    const locality = a.city || a.town || a.village || a.municipality || a.hamlet || '';
    const province = a.county || a.state_district || '';
    const region = a.state || '';

    let title: string;
    if (approximate && road) {
      title = `${road} ${houseNumber}`;
    } else if (road) {
      title = `${road}${a.house_number ? ' ' + a.house_number : ''}`;
    } else {
      title = d.name || locality || String(d.display_name).split(',')[0];
    }
    if (d.name && d.name !== road && !approximate && d.category !== 'highway') {
      title = d.name;
    }

    const key = `${title}|${locality}|${province}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const subtitleParts = [locality, province, region].filter(
      (p, i, arr) => p && p !== title && arr.indexOf(p) === i
    );
    if (approximate) subtitleParts.unshift('Posizione approssimata sulla via');

    results.push({
      id: String(d.place_id),
      title,
      subtitle: subtitleParts.join(' · '),
      label: [title, locality].filter((p, i, arr) => p && arr.indexOf(p) === i).join(', '),
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
    });
    if (results.length >= 6) break;
  }

  return results;
}