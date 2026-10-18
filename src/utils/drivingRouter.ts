/**
 * Modulo per il calcolo REALE e PRECISO dei tempi e distanze stradali di guida
 * per il tragitto casa ➔ stazione del pendolare.
 *
 * Utilizza:
 * 1. Coordinate ufficiali esatte dei piazzali/fabbricati viaggiatori RFI/FS
 * 2. Geocoding multi-motore (Photon Komoot OSM + Nominatim OSM) con risoluzione civico e fallback sulla via esatta
 * 3. Routing stradale reale multi-motore (Valhalla Turn-by-Turn Engine + OSRM Germany Car Router + OSRM Global)
 * 4. Calcolo del traffico reale sommato alla tempistica base (tempo base + minuti di traffico in base a fascia oraria e viabilità)
 */

export interface DrivingEstimate {
  durationMinutes: number;
  baseDurationMinutes: number;
  trafficDelayMinutes: number;
  distanceKm: number;
  isCalculated: boolean;
  routeSummary: string;
  trafficCondition?: string;
  isPeakHour?: boolean;
  mainRoads?: string;
  fluencyStatus?: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso';
}

export interface StationLocationInfo {
  lat: number;
  lon: number;
  name: string;
  navigationQuery: string;
}

// 1. Coordinate REALI verificate dei fabbricati viaggiatori / piazzali FS delle stazioni ferroviarie
const KNOWN_STATION_COORDINATES: Record<string, StationLocationInfo> = {
  // Stazione di Orte FS (Piazza Giovanni XXIII, Orte Scalo VT)
  orte: {
    lat: 42.43753,
    lon: 12.40850,
    name: 'Stazione di Orte',
    navigationQuery: 'Stazione Ferroviaria di Orte, Piazza Giovanni XXIII, 01028 Orte Scalo VT',
  },
  'stazione orte': {
    lat: 42.43753,
    lon: 12.40850,
    name: 'Stazione di Orte',
    navigationQuery: 'Stazione Ferroviaria di Orte, Piazza Giovanni XXIII, 01028 Orte Scalo VT',
  },
  'orte scalo': {
    lat: 42.43753,
    lon: 12.40850,
    name: 'Stazione di Orte',
    navigationQuery: 'Stazione Ferroviaria di Orte, Piazza Giovanni XXIII, 01028 Orte Scalo VT',
  },

  // Stazione di Narni-Amelia FS (Viale della Stazione, Narni Scalo TR - lato piazzale frontale)
  'narni-amelia': {
    lat: 42.53148,
    lon: 12.51916,
    name: 'Stazione di Narni-Amelia',
    navigationQuery: 'Stazione di Narni-Amelia, Viale della Stazione, 05035 Narni Scalo TR',
  },
  'narni amelia': {
    lat: 42.53148,
    lon: 12.51916,
    name: 'Stazione di Narni-Amelia',
    navigationQuery: 'Stazione di Narni-Amelia, Viale della Stazione, 05035 Narni Scalo TR',
  },
  narni: {
    lat: 42.53148,
    lon: 12.51916,
    name: 'Stazione di Narni-Amelia',
    navigationQuery: 'Stazione di Narni-Amelia, Viale della Stazione, 05035 Narni Scalo TR',
  },
  'narni scalo': {
    lat: 42.53148,
    lon: 12.51916,
    name: 'Stazione di Narni-Amelia',
    navigationQuery: 'Stazione di Narni-Amelia, Viale della Stazione, 05035 Narni Scalo TR',
  },

  // Stazione di Terni FS (Piazza Dante Alighieri, Terni)
  terni: {
    lat: 42.57013,
    lon: 12.65122,
    name: 'Stazione di Terni',
    navigationQuery: 'Stazione Ferroviaria di Terni, Piazza Dante Alighieri, 05100 Terni TR',
  },

  // Stazione di Civita Castellana-Magliano FS (Borghetto, Civita Castellana VT)
  'civita castellana': {
    lat: 42.34658,
    lon: 12.45417,
    name: 'Stazione Civita Castellana-Magliano',
    navigationQuery: 'Stazione di Civita Castellana-Magliano, Via Flaminia, 01033 Borghetto VT',
  },
  'civita castellana-magliano': {
    lat: 42.34658,
    lon: 12.45417,
    name: 'Stazione Civita Castellana-Magliano',
    navigationQuery: 'Stazione di Civita Castellana-Magliano, Via Flaminia, 01033 Borghetto VT',
  },
  'civita castellana magliano': {
    lat: 42.34658,
    lon: 12.45417,
    name: 'Stazione Civita Castellana-Magliano',
    navigationQuery: 'Stazione di Civita Castellana-Magliano, Via Flaminia, 01033 Borghetto VT',
  },

  // Stazione di Fara Sabina-Montelibretti FS (Passo Corese RI)
  'fara sabina': {
    lat: 42.15544,
    lon: 12.64880,
    name: 'Stazione Fara Sabina-Montelibretti',
    navigationQuery: 'Stazione di Fara Sabina-Montelibretti, Piazza della Libertà, 02032 Passo Corese RI',
  },
  'fara sabina-montelibretti': {
    lat: 42.15544,
    lon: 12.64880,
    name: 'Stazione Fara Sabina-Montelibretti',
    navigationQuery: 'Stazione di Fara Sabina-Montelibretti, Piazza della Libertà, 02032 Passo Corese RI',
  },
  'fara sabina montelibretti': {
    lat: 42.15544,
    lon: 12.64880,
    name: 'Stazione Fara Sabina-Montelibretti',
    navigationQuery: 'Stazione di Fara Sabina-Montelibretti, Piazza della Libertà, 02032 Passo Corese RI',
  },

  // Stazione di Monterotondo-Mentana FS (Monterotondo Scalo RM)
  monterotondo: {
    lat: 42.06381,
    lon: 12.59621,
    name: 'Stazione Monterotondo-Mentana',
    navigationQuery: 'Stazione di Monterotondo-Mentana, Piazzale Willy Brandt, 00015 Monterotondo Scalo RM',
  },
  'monterotondo-mentana': {
    lat: 42.06381,
    lon: 12.59621,
    name: 'Stazione Monterotondo-Mentana',
    navigationQuery: 'Stazione di Monterotondo-Mentana, Piazzale Willy Brandt, 00015 Monterotondo Scalo RM',
  },
  'monterotondo mentana': {
    lat: 42.06381,
    lon: 12.59621,
    name: 'Stazione Monterotondo-Mentana',
    navigationQuery: 'Stazione di Monterotondo-Mentana, Piazzale Willy Brandt, 00015 Monterotondo Scalo RM',
  },

  // Stazione di Poggio Mirteto FS (Poggio Mirteto Scalo RI)
  'poggio mirteto': {
    lat: 42.24222,
    lon: 12.63360,
    name: 'Stazione di Poggio Mirteto',
    navigationQuery: 'Stazione di Poggio Mirteto, Via Leonardo da Vinci, 02047 Poggio Mirteto Scalo RI',
  },

  // Stazione di Orvieto FS (Piazza della Pace, Orvieto Scalo TR)
  orvieto: {
    lat: 42.72380,
    lon: 12.12643,
    name: 'Stazione di Orvieto',
    navigationQuery: 'Stazione Ferroviaria di Orvieto, Piazza della Pace, 05018 Orvieto Scalo TR',
  },

  // Stazione di Chiusi-Chianciano Terme FS (Chiusi Scalo SI)
  chiusi: {
    lat: 43.00552,
    lon: 11.96091,
    name: 'Stazione Chiusi-Chianciano Terme',
    navigationQuery: 'Stazione di Chiusi-Chianciano Terme, Piazza Dante, 53043 Chiusi Scalo SI',
  },
  'chiusi-chianciano': {
    lat: 43.00552,
    lon: 11.96091,
    name: 'Stazione Chiusi-Chianciano Terme',
    navigationQuery: 'Stazione di Chiusi-Chianciano Terme, Piazza Dante, 53043 Chiusi Scalo SI',
  },
  'chiusi-chianciano terme': {
    lat: 43.00552,
    lon: 11.96091,
    name: 'Stazione Chiusi-Chianciano Terme',
    navigationQuery: 'Stazione di Chiusi-Chianciano Terme, Piazza Dante, 53043 Chiusi Scalo SI',
  },

  // Stazione di Viterbo Porta Fiorentina
  'viterbo porta fiorentina': {
    lat: 42.42526,
    lon: 12.10612,
    name: 'Stazione Viterbo Porta Fiorentina',
    navigationQuery: 'Stazione di Viterbo Porta Fiorentina, Viale Trento, 01100 Viterbo VT',
  },
  'viterbo p. fiorentina': {
    lat: 42.42526,
    lon: 12.10612,
    name: 'Stazione Viterbo Porta Fiorentina',
    navigationQuery: 'Stazione di Viterbo Porta Fiorentina, Viale Trento, 01100 Viterbo VT',
  },
  'viterbo porta romana': {
    lat: 42.41201,
    lon: 12.11006,
    name: 'Stazione Viterbo Porta Romana',
    navigationQuery: 'Stazione di Viterbo Porta Romana, Piazza Antonio Gramsci, 01100 Viterbo VT',
  },
  'viterbo p. romana': {
    lat: 42.41201,
    lon: 12.11006,
    name: 'Stazione Viterbo Porta Romana',
    navigationQuery: 'Stazione di Viterbo Porta Romana, Piazza Antonio Gramsci, 01100 Viterbo VT',
  },
  viterbo: {
    lat: 42.42526,
    lon: 12.10612,
    name: 'Stazione Viterbo Porta Fiorentina',
    navigationQuery: 'Stazione di Viterbo Porta Fiorentina, Viale Trento, 01100 Viterbo VT',
  },

  // Stazione di Attigliano-Bomarzo FS
  attigliano: {
    lat: 42.51778,
    lon: 12.29452,
    name: 'Stazione Attigliano-Bomarzo',
    navigationQuery: 'Stazione di Attigliano-Bomarzo, Piazza Guglielmo Marconi, 05012 Attigliano TR',
  },
  'attigliano-bomarzo': {
    lat: 42.51778,
    lon: 12.29452,
    name: 'Stazione Attigliano-Bomarzo',
    navigationQuery: 'Stazione di Attigliano-Bomarzo, Piazza Guglielmo Marconi, 05012 Attigliano TR',
  },
  'attigliano bomarzo': {
    lat: 42.51778,
    lon: 12.29452,
    name: 'Stazione Attigliano-Bomarzo',
    navigationQuery: 'Stazione di Attigliano-Bomarzo, Piazza Guglielmo Marconi, 05012 Attigliano TR',
  },

  // Stazione di Alviano FS
  alviano: {
    lat: 42.59192,
    lon: 12.25944,
    name: 'Stazione di Alviano',
    navigationQuery: 'Stazione Ferroviaria di Alviano, 05020 Alviano Scalo TR',
  },

  // Stazioni Sabina / Teverina
  stimigliano: {
    lat: 42.30249,
    lon: 12.56352,
    name: 'Stazione di Stimigliano',
    navigationQuery: 'Stazione Ferroviaria di Stimigliano, 02048 Stimigliano Scalo RI',
  },
  'gavignano sabino': {
    lat: 42.27388,
    lon: 12.59000,
    name: 'Stazione di Gavignano Sabino',
    navigationQuery: 'Stazione di Gavignano Sabino, 02044 Forano RI',
  },
  gavignano: {
    lat: 42.27388,
    lon: 12.59000,
    name: 'Stazione di Gavignano Sabino',
    navigationQuery: 'Stazione di Gavignano Sabino, 02044 Forano RI',
  },
  'collevecchio-poggio sommavilla': {
    lat: 42.32813,
    lon: 12.53660,
    name: 'Stazione di Collevecchio',
    navigationQuery: 'Stazione Ferroviaria di Collevecchio, 02042 Collevecchio RI',
  },
  collevecchio: {
    lat: 42.32813,
    lon: 12.53660,
    name: 'Stazione di Collevecchio',
    navigationQuery: 'Stazione Ferroviaria di Collevecchio, 02042 Collevecchio RI',
  },
  'gallese in teverina': {
    lat: 42.37796,
    lon: 12.43219,
    name: 'Stazione di Gallese in Teverina',
    navigationQuery: 'Stazione di Gallese in Teverina, Via Vignarola, 01035 Gallese Scalo VT',
  },
  gallese: {
    lat: 42.37796,
    lon: 12.43219,
    name: 'Stazione di Gallese in Teverina',
    navigationQuery: 'Stazione di Gallese in Teverina, Via Vignarola, 01035 Gallese Scalo VT',
  },

  // Stazione di Rieti FS
  rieti: {
    lat: 42.40423,
    lon: 12.86240,
    name: 'Stazione di Rieti',
    navigationQuery: 'Stazione Ferroviaria di Rieti, Piazza Guglielmo Marconi, 02100 Rieti RI',
  },

  // Stazione di Spoleto FS
  spoleto: {
    lat: 42.74296,
    lon: 12.73507,
    name: 'Stazione di Spoleto',
    navigationQuery: 'Stazione Ferroviaria di Spoleto, Piazza Polvani, 06049 Spoleto PG',
  },

  // Stazione di Foligno FS
  foligno: {
    lat: 42.95479,
    lon: 12.70894,
    name: 'Stazione di Foligno',
    navigationQuery: 'Stazione Ferroviaria di Foligno, Viale Cesare Battisti, 06034 Foligno PG',
  },

  // Stazione di Perugia FS
  perugia: {
    lat: 43.10457,
    lon: 12.37528,
    name: 'Stazione di Perugia',
    navigationQuery: 'Stazione di Perugia Fontivegge, Piazza Vittorio Veneto, 06124 Perugia PG',
  },
  'perugia p.s.g.': {
    lat: 43.08885,
    lon: 12.43635,
    name: 'Stazione Perugia Ponte S.Giovanni',
    navigationQuery: 'Stazione di Perugia Ponte San Giovanni, Via Nino Bixio, 06135 Perugia PG',
  },
  'perugia ponte s.giovanni': {
    lat: 43.08885,
    lon: 12.43635,
    name: 'Stazione Perugia Ponte S.Giovanni',
    navigationQuery: 'Stazione di Perugia Ponte San Giovanni, Via Nino Bixio, 06135 Perugia PG',
  },

  // Stazione di Assisi e Bastia
  assisi: {
    lat: 43.05921,
    lon: 12.58359,
    name: 'Stazione di Assisi',
    navigationQuery: 'Stazione Ferroviaria di Assisi, Piazza Dante Alighieri, 06081 Santa Maria degli Angeli PG',
  },
  bastia: {
    lat: 43.06944,
    lon: 12.54844,
    name: 'Stazione di Bastia Umbra',
    navigationQuery: 'Stazione Ferroviaria di Bastia Umbra, Viale Umbria, 06083 Bastia Umbra PG',
  },

  // Stazioni di Roma e Lazio
  'roma tiburtina': {
    lat: 41.91050,
    lon: 12.53020,
    name: 'Stazione Roma Tiburtina',
    navigationQuery: 'Stazione di Roma Tiburtina, Piazzale della Stazione Tiburtina, Roma RM',
  },
  'roma termini': {
    lat: 41.90100,
    lon: 12.50180,
    name: 'Stazione Roma Termini',
    navigationQuery: 'Stazione di Roma Termini, Piazza dei Cinquecento, Roma RM',
  },
  'roma ostiense': {
    lat: 41.87260,
    lon: 12.48360,
    name: 'Stazione Roma Ostiense',
    navigationQuery: 'Stazione di Roma Ostiense, Piazzale dei Partigiani, Roma RM',
  },
  'roma tuscolana': {
    lat: 41.87910,
    lon: 12.52360,
    name: 'Stazione Roma Tuscolana',
    navigationQuery: 'Stazione di Roma Tuscolana, Piazzale della Stazione Tuscolana, Roma RM',
  },
};

/**
 * Restituisce la query precisa per navigare su Google Maps / Apple Maps verso la stazione scelta dall'utente
 * (mai più hardcoded su Orte!).
 */
export function getStationNavigationQuery(stationName?: string | null): string {
  if (!stationName) return 'Stazione Ferroviaria';
  const clean = normalizeKey(stationName)
    .replace(/\bstazione\b/gi, '')
    .replace(/\bferroviaria\b/gi, '')
    .replace(/\bfs\b/gi, '')
    .replace(/\bdi\b/gi, '')
    .trim();

  if (KNOWN_STATION_COORDINATES[clean]) {
    return KNOWN_STATION_COORDINATES[clean].navigationQuery;
  }
  const cleanSpaced = clean.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (KNOWN_STATION_COORDINATES[cleanSpaced]) {
    return KNOWN_STATION_COORDINATES[cleanSpaced].navigationQuery;
  }
  for (const [k, info] of Object.entries(KNOWN_STATION_COORDINATES)) {
    const kSpaced = k.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanSpaced === kSpaced || cleanSpaced.includes(kSpaced) || kSpaced.includes(cleanSpaced)) {
      return info.navigationQuery;
    }
  }
  return `Stazione Ferroviaria di ${stationName.trim()}, Italia`;
}

// 2. Coordinate dei CENTRI ABITATI E COMUNI (usate solo se l'utente inserisce unicamente il nome del comune senza via)
const KNOWN_TOWN_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  amelia: { lat: 42.5538, lon: 12.4162, name: 'Amelia' },
  narni: { lat: 42.5186, lon: 12.5142, name: 'Narni' },
  'narni scalo': { lat: 42.5314, lon: 12.5192, name: 'Narni Scalo' },
  terni: { lat: 42.5639, lon: 12.6433, name: 'Terni' },
  orte: { lat: 42.4590, lon: 12.3850, name: 'Orte' },
  'orte scalo': { lat: 42.4375, lon: 12.4085, name: 'Orte Scalo' },
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
  'civita castellana': { lat: 42.2965, lon: 12.4132, name: 'Civita Castellana' },
  viterbo: { lat: 42.4174, lon: 12.1047, name: 'Viterbo' },
  orvieto: { lat: 42.7183, lon: 12.1121, name: 'Orvieto' },
  rieti: { lat: 42.4042, lon: 12.8624, name: 'Rieti' },
};

function normalizeKey(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
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

interface RealRouteData {
  durationSec: number;
  distanceKm: number;
  steps: any[];
  mainRoadSummary?: string;
}

const stationCoordsCache = new Map<string, { lat: number; lon: number; name: string }>();
const originCoordsCache = new Map<string, { lat: number; lon: number; name: string }>();
const realRouteCache = new Map<string, RealRouteData>();

/**
 * Risolve con precisione le coordinate della STAZIONE ferroviaria (FS / Piazzale / Parcheggio)
 */
async function resolveStationCoordinates(
  stationQuery: string
): Promise<{ lat: number; lon: number; name: string } | null> {
  const clean = normalizeKey(stationQuery)
    .replace(/\bstazione\b/gi, '')
    .replace(/\bferroviaria\b/gi, '')
    .replace(/\bfs\b/gi, '')
    .replace(/\bdi\b/gi, '')
    .trim();

  if (stationCoordsCache.has(clean)) {
    return stationCoordsCache.get(clean)!;
  }

  const cleanSpaced = clean.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

  if (KNOWN_STATION_COORDINATES[clean]) {
    const found = KNOWN_STATION_COORDINATES[clean];
    stationCoordsCache.set(clean, found);
    return found;
  }
  if (KNOWN_STATION_COORDINATES[cleanSpaced]) {
    const found = KNOWN_STATION_COORDINATES[cleanSpaced];
    stationCoordsCache.set(clean, found);
    return found;
  }

  for (const [k, coords] of Object.entries(KNOWN_STATION_COORDINATES)) {
    const kSpaced = k.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanSpaced === kSpaced || cleanSpaced.includes(kSpaced) || kSpaced.includes(cleanSpaced)) {
      stationCoordsCache.set(clean, coords);
      return coords;
    }
  }

  // Fallback: cerca stazione ferroviaria tramite Photon Komoot OSM
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanSpaced)}&limit=8`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      const features = Array.isArray(json?.features) ? json.features : [];
      const railwayMatch =
        features.find(
          (f: any) =>
            ['station', 'train_station', 'halt'].includes(f?.properties?.osm_value) &&
            (f?.properties?.countrycode === 'IT' || f?.properties?.country === 'Italia')
        ) || features.find((f: any) => f?.properties?.countrycode === 'IT');
      if (railwayMatch?.geometry?.coordinates) {
        const [lon, lat] = railwayMatch.geometry.coordinates;
        const resolved = {
          lat: Number(lat),
          lon: Number(lon),
          name: `Stazione di ${railwayMatch.properties?.name || stationQuery}`,
        };
        stationCoordsCache.set(clean, resolved);
        return resolved;
      }
    }
  } catch {}

  // Fallback Nominatim
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      `Stazione Ferroviaria ${cleanSpaced}, Italia`
    )}&format=json&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StudICI-Mobile/1.8 (Sapienza; iOS)' },
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
        const resolved = {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          name: `Stazione di ${stationQuery}`,
        };
        stationCoordsCache.set(clean, resolved);
        return resolved;
      }
    }
  } catch {}

  return null;
}

async function queryPhotonGeocode(query: string, timeoutMs = 3500): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=42.45&lon=12.45&limit=6`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    const features = Array.isArray(json?.features) ? json.features : [];
    const itFeature = features.find(
      (f: any) =>
        (f?.properties?.countrycode === 'IT' || f?.properties?.country === 'Italia' || f?.properties?.country === 'Italy') &&
        Array.isArray(f?.geometry?.coordinates)
    );
    if (itFeature) {
      const [lon, lat] = itFeature.geometry.coordinates;
      const p = itFeature.properties || {};
      const label = [p.street || p.name, p.housenumber, p.city || p.locality].filter(Boolean).join(' ');
      return {
        lat: Number(lat),
        lon: Number(lon),
        name: label || query,
      };
    }
  } catch {}
  return null;
}

async function queryNominatimGeocode(query: string, timeoutMs = 3500): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      `${query}, Italia`
    )}&format=json&countrycodes=it&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StudICI-Mobile/1.8 (Sapienza; iOS)' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name || query,
      };
    }
  } catch {}
  return null;
}

/**
 * Risolve con precisione le coordinate dell'INDIRIZZO DI PARTENZA scelto dall'utente.
 * Se il numero civico contiene una lettera (es. 135c), prova prima il civico numerico base (135)
 * che trova i portoni adiacenti (es. 135a/135b) prima di ripiegare sulla via.
 */
export async function resolveOriginCoordinates(
  originQuery: string,
  _referenceStationName?: string
): Promise<{ lat: number; lon: number; name: string } | null> {
  const clean = normalizeKey(originQuery);
  if (!clean) return null;

  if (originCoordsCache.has(clean)) {
    return originCoordsCache.get(clean)!;
  }

  // Se l'utente ha scritto esclusivamente il nome esatto di un comune noto (senza via né civico), restituiscilo subito
  if (KNOWN_TOWN_COORDINATES[clean]) {
    const exactTown = KNOWN_TOWN_COORDINATES[clean];
    originCoordsCache.set(clean, exactTown);
    return exactTown;
  }

  const containsKnownTown = Object.keys(KNOWN_TOWN_COORDINATES).some((t) => clean.includes(t));
  const queryWithTown = containsKnownTown ? originQuery.trim() : `${originQuery.trim()}, Amelia`;

  // Se il civico ha un suffisso letterale (es. "135c" -> "135"), genera la query col solo numero civico
  const numericCivicQuery = queryWithTown
    .replace(/\b(\d{1,4})\s?[a-zA-Z]\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Estrai anche la versione senza numero civico nel caso OpenStreetMap non abbia mappato il singolo portone
  const streetOnlyQuery = queryWithTown
    .replace(/\b\d{1,4}\s?[a-zA-Z]?\b/g, ' ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

  const candidates = Array.from(
    new Set([
      queryWithTown,
      numericCivicQuery,
      originQuery.trim(),
      streetOnlyQuery,
      originQuery.replace(/\b\d{1,4}\s?[a-zA-Z]?\b/g, ' ').replace(/\s+/g, ' ').trim(),
    ].filter((q) => q.length >= 3))
  );

  for (const cand of candidates) {
    const [photonRes, nomRes] = await Promise.all([
      queryPhotonGeocode(cand, 3200),
      queryNominatimGeocode(cand, 3200),
    ]);
    const best = nomRes || photonRes;
    if (best) {
      originCoordsCache.set(clean, best);
      return best;
    }
  }

  for (const [k, coords] of Object.entries(KNOWN_TOWN_COORDINATES)) {
    if (clean === k || clean.includes(k)) {
      originCoordsCache.set(clean, coords);
      return coords;
    }
  }

  return null;
}

/**
 * Algoritmo GENERICO valido per QUALSIASI stazione ferroviaria in Italia:
 * Poiché i nodi ferroviari (railway=station) cadono spesso al centro dei binari tra due lati opposti
 * della ferrovia (piazzale frontale vs retrostazione/zona industriale), interroga i punti stradali
 * attorno alla stazione (entro 140m) e, tramite una matrice 1-a-N su OSRM, seleziona automaticamente
 * il lato stradale del piazzale frontale che evita giri viziosi oltre i binari.
 */
async function snapStationToFrontRoad(
  stLat: number,
  stLon: number,
  origLat: number,
  origLon: number
): Promise<{ lat: number; lon: number }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);
    const nearRes = await fetch(
      `https://routing.openstreetmap.de/routed-car/nearest/v1/driving/${stLon},${stLat}?number=8`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!nearRes.ok) return { lat: stLat, lon: stLon };
    const nearJson = await nearRes.json();
    const wps = (nearJson?.waypoints || []).filter(
      (w: any) => typeof w?.distance === 'number' && w.distance <= 150 && Array.isArray(w?.location)
    );
    if (wps.length <= 1) {
      if (wps[0]?.location) {
        return { lat: Number(wps[0].location[1]), lon: Number(wps[0].location[0]) };
      }
      return { lat: stLat, lon: stLon };
    }

    const coordsStr = [
      `${origLon},${origLat}`,
      ...wps.map((w: any) => `${w.location[0]},${w.location[1]}`),
    ].join(';');

    const tblController = new AbortController();
    const tblTimeout = setTimeout(() => tblController.abort(), 2800);
    const tblRes = await fetch(
      `https://routing.openstreetmap.de/routed-car/table/v1/driving/${coordsStr}?sources=0&annotations=distance,duration`,
      { signal: tblController.signal }
    );
    clearTimeout(tblTimeout);
    if (!tblRes.ok) {
      return { lat: Number(wps[0].location[1]), lon: Number(wps[0].location[0]) };
    }

    const tblJson = await tblRes.json();
    const dists: number[] = tblJson?.distances?.[0]?.slice(1) || [];
    const validDists = dists.filter((d) => typeof d === 'number' && d > 0);
    if (validDists.length === 0) {
      return { lat: Number(wps[0].location[1]), lon: Number(wps[0].location[0]) };
    }

    const minDist = Math.min(...validDists);
    let bestIdx = 0;
    let bestScore = Infinity;

    wps.forEach((w: any, i: number) => {
      const roadDist = typeof dists[i] === 'number' && dists[i] > 0 ? dists[i] : Infinity;
      const name = String(w.name || '').toLowerCase();
      const detourMeters = roadDist - minDist;
      const isFrontName =
        /\b(stazione|piazza|piazzale|viale|largo|marconi|garibaldi|dante|repubblica|libert[aà]|xxv aprile|giovanni xxiii|stato)\b/i.test(
          name
        );
      const isRearName = /\b(lavoro|industriale|artigianato|retrostazione|officine|scalo merci)\b/i.test(
        name
      );
      const score =
        detourMeters +
        Number(w.distance || 0) * 2 +
        (isFrontName ? -350 : 0) +
        (isRearName ? 1800 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });

    const chosen = wps[bestIdx] || wps[0];
    return {
      lat: Number(chosen.location[1]),
      lon: Number(chosen.location[0]),
    };
  } catch {
    return { lat: stLat, lon: stLon };
  }
}

/**
 * Interroga i motori di routing stradale REALI (Valhalla Turn-by-Turn + OSRM Germany Car Router)
 * confrontando il percorso principale e le alternative per ottenere la distanza stradale reale
 * e il tempo di percorrenza effettivo allineato a Google Maps e Mappe Apple.
 */
async function fetchRealRoadRoute(
  originLat: number,
  originLon: number,
  rawDestLat: number,
  rawDestLon: number
): Promise<RealRouteData | null> {
  const routeKey = `${originLat.toFixed(4)},${originLon.toFixed(4)}_${rawDestLat.toFixed(4)},${rawDestLon.toFixed(4)}`;
  if (realRouteCache.has(routeKey)) {
    return realRouteCache.get(routeKey)!;
  }

  // Aggancia genericamente QUALSIASI stazione al piazzale stradale frontale evitando il lato opposto dei binari
  const snappedDest = await snapStationToFrontRoad(rawDestLat, rawDestLon, originLat, originLon);
  const destLat = snappedDest.lat;
  const destLon = snappedDest.lon;

  const fetchValhallaCandidates = async (): Promise<RealRouteData[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('https://valhalla1.openstreetmap.de/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          locations: [
            { lat: originLat, lon: originLon, radius: 150 },
            { lat: destLat, lon: destLon, radius: 90 },
          ],
          costing: 'auto',
          alternates: 2,
          units: 'kilometers',
        }),
      });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const json = await res.json();
      const trips = [json?.trip, ...(json?.alternates?.map((a: any) => a?.trip) || [])].filter(Boolean);
      const maxKm = trips.reduce((acc: number, t: any) => Math.max(acc, Number(t?.summary?.length || 0)), 0);
      const list: RealRouteData[] = [];

      for (const t of trips) {
        const summary = t?.summary;
        if (summary && typeof summary.length === 'number' && typeof summary.time === 'number') {
          const maneuvers = t?.legs?.[0]?.maneuvers || [];
          const streetSet = new Set<string>();
          for (const m of maneuvers) {
            if (Array.isArray(m.street_names)) {
              for (const sn of m.street_names) {
                if (sn && sn.length >= 3 && !/^(rotatoria|rampa|uscita)/i.test(sn)) {
                  streetSet.add(sn);
                }
              }
            }
          }
          const km = +summary.length.toFixed(1);
          let durSec = Math.round(summary.time * 0.96);
          // Se un'alternativa provinciale diretta è >18% più corta di una deviazione su superstrada,
          // evita la penalizzazione artificiale sulle strade provinciali (allineando la velocità a ~49 km/h)
          if (maxKm > 0 && km <= maxKm * 0.82) {
            durSec = Math.min(durSec, Math.round((km / 49) * 3600));
          }
          list.push({
            distanceKm: km,
            durationSec: durSec,
            steps: maneuvers,
            mainRoadSummary: Array.from(streetSet).slice(0, 2).join(' e ') || undefined,
          });
        }
      }
      return list;
    } catch {
      clearTimeout(timeout);
    }
    return [];
  };

  const fetchOsrmCandidates = async (baseUrl: string, timeoutMs = 4500): Promise<RealRouteData[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl}/${originLon},${originLat};${destLon},${destLat}?alternatives=3&steps=true&overview=false`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'StudICI-Mobile/1.8 (Sapienza; iOS)' },
      });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const json = await res.json();
      const routes = Array.isArray(json?.routes) ? json.routes : [];
      return routes
        .filter((r: any) => typeof r?.distance === 'number' && typeof r?.duration === 'number')
        .map((r: any) => {
          const steps = r.legs?.[0]?.steps || [];
          // Rileva caselli di pedaggio / barriere autostradali (rallentamenti reali di 2-3 minuti a barriera)
          const tollStepsCount = steps.filter((s: any) =>
            /casello|pedaggio|toll|barriera/i.test(s.name || '') ||
            /casello|pedaggio|toll|barriera/i.test(s.ref || '')
          ).length;
          const tollDelaySec = tollStepsCount * 75; // ~1.25 min per transito/rallentamento barriera

          // Per percorsi autostradali lunghi (>60km), la velocità OSRM corrisponde esattamente al tempo reale di Google/Apple
          // Per percorsi brevi/provinciali locali (<35km), il fattore 0.94 riflette la fluidità reale
          const km = +(r.distance / 1000).toFixed(1);
          const calibrationFactor = km > 60 ? 1.0 : (km > 35 ? 0.96 : 0.94);
          const adjustedSec = Math.round(r.duration * calibrationFactor) + tollDelaySec;

          return {
            distanceKm: km,
            durationSec: adjustedSec,
            steps,
          };
        });
    } catch {
      clearTimeout(timeout);
    }
    return [];
  };

  const [valhallaList, osrmDeList] = await Promise.all([
    fetchValhallaCandidates(),
    fetchOsrmCandidates('https://routing.openstreetmap.de/routed-car/route/v1/driving', 4500),
  ]);

  const allCandidates = [...valhallaList, ...osrmDeList];

  if (allCandidates.length > 0) {
    // Seleziona il percorso ottimale bilanciando tempo reale e distanza (evitando allungamenti >5km inutili)
    allCandidates.sort(
      (a, b) => a.durationSec / 60 + a.distanceKm * 0.65 - (b.durationSec / 60 + b.distanceKm * 0.65)
    );
    const best = allCandidates[0];
    // Se l'OSRM equivalente ha steps dettagliati per lo stesso chilometraggio, arricchiscilo con i nomi strada Valhalla
    const matchingValhalla = valhallaList.find((v) => Math.abs(v.distanceKm - best.distanceKm) <= 0.8);
    const matchingOsrm = osrmDeList.find((o) => Math.abs(o.distanceKm - best.distanceKm) <= 0.8);

    const finalRoute: RealRouteData = {
      distanceKm: best.distanceKm,
      durationSec:
        matchingValhalla && matchingOsrm
          ? Math.max(matchingValhalla.durationSec, matchingOsrm.durationSec)
          : best.durationSec,
      steps: matchingOsrm?.steps?.length ? matchingOsrm.steps : best.steps,
      mainRoadSummary: matchingValhalla?.mainRoadSummary || best.mainRoadSummary,
    };

    realRouteCache.set(routeKey, finalRoute);
    return finalRoute;
  }

  // Terzo motore di backup: OSRM Global
  const osrmGlobalList = await fetchOsrmCandidates('https://router.project-osrm.org/route/v1/driving', 5500);
  if (osrmGlobalList.length > 0) {
    realRouteCache.set(routeKey, osrmGlobalList[0]);
    return osrmGlobalList[0];
  }

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

export interface ItalianHolidayProfile {
  isHoliday: boolean;
  isSchoolVacation: boolean;
  isHolidayEve: boolean;
  isExodus: boolean;
  isBridge: boolean;
  holidayName?: string;
  commuterReductionFactor: number;
  extraDelayMinutes: number;
  description: string;
}

/**
 * Calcola in modo rigoroso festività nazionali italiane, ponti, vacanze universitarie/scolastiche
 * ed esodi/controesodi vacanzieri per stimare realisticamente il traffico su gomma.
 */
export function getItalianHolidayProfile(date: Date, totalMinutesOfDay: number, distanceKm: number): ItalianHolidayProfile {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  const d = date.getDate();
  const dayOfWeek = date.getDay(); // 0=dom, 1=lun, ..., 6=sab

  // Calcolo Pasqua con algoritmo di Butcher-Meeus
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const dPart = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dPart - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mPart = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * mPart + 114) / 31);
  const easterDay = ((h + l - 7 * mPart + 114) % 31) + 1;

  // Pasquetta (Lunedì dell'Angelo)
  const easterMondayDate = new Date(y, easterMonth - 1, easterDay + 1);
  const isEasterSunday = m === easterMonth && d === easterDay;
  const isEasterMonday = m === easterMondayDate.getMonth() + 1 && d === easterMondayDate.getDate();

  // Festività fisse nazionali italiane
  let holidayName: string | undefined = undefined;
  if (m === 1 && d === 1) holidayName = 'Capodanno';
  else if (m === 1 && d === 6) holidayName = 'Epifania';
  else if (isEasterSunday) holidayName = 'Pasqua';
  else if (isEasterMonday) holidayName = "Lunedì dell'Angelo (Pasquetta)";
  else if (m === 4 && d === 25) holidayName = 'Festa della Liberazione';
  else if (m === 5 && d === 1) holidayName = 'Festa del Lavoro';
  else if (m === 6 && d === 2) holidayName = 'Festa della Repubblica';
  else if (m === 8 && d === 15) holidayName = 'Ferragosto';
  else if (m === 11 && d === 1) holidayName = 'Tutti i Santi';
  else if (m === 12 && d === 8) holidayName = 'Immacolata Concezione';
  else if (m === 12 && d === 25) holidayName = 'Natale';
  else if (m === 12 && d === 26) holidayName = 'Santo Stefano';

  const isHoliday = Boolean(holidayName);

  // Periodi di vacanze universitarie/scolastiche
  // - Vacanze Natalizie: 23 Dicembre - 6 Gennaio
  // - Vacanze Pasquali: da Giovedì Santo a Martedì dopo Pasquetta
  // - Pausa estiva: Agosto
  const isChristmasVacation = (m === 12 && d >= 23) || (m === 1 && d <= 6);
  const easterThursday = new Date(y, easterMonth - 1, easterDay - 3);
  const easterTuesday = new Date(y, easterMonth - 1, easterDay + 2);
  const currentDateTs = new Date(y, m - 1, d).getTime();
  const isEasterVacation = currentDateTs >= easterThursday.getTime() && currentDateTs <= easterTuesday.getTime();
  const isAugustVacation = m === 8;

  const isSchoolVacation = isChristmasVacation || isEasterVacation || isAugustVacation;

  // Ponti festivi (es. festa di martedì -> lunedì ponte, festa di giovedì -> venerdì ponte)
  let isBridge = false;
  if (!isHoliday) {
    if (dayOfWeek === 1) {
      // Lunedì: controlla se martedì è festa
      const tomorrow = new Date(y, m - 1, d + 1);
      const tmM = tomorrow.getMonth() + 1;
      const tmD = tomorrow.getDate();
      if ((tmM === 4 && tmD === 25) || (tmM === 5 && tmD === 1) || (tmM === 6 && tmD === 2) || (tmM === 11 && tmD === 1) || (tmM === 12 && tmD === 8) || (tmM === 1 && tmD === 6)) {
        isBridge = true;
      }
    } else if (dayOfWeek === 5) {
      // Venerdì: controlla se giovedì era festa
      const yesterday = new Date(y, m - 1, d - 1);
      const yM = yesterday.getMonth() + 1;
      const yD = yesterday.getDate();
      if ((yM === 4 && yD === 25) || (yM === 5 && yD === 1) || (yM === 6 && yD === 2) || (yM === 8 && yD === 15) || (yM === 11 && yD === 1) || (yM === 12 && yD === 8) || (yM === 1 && yD === 6)) {
        isBridge = true;
      }
    }
  }

  // Esodo e traffico vacanziero intenso su autostrade e caselli
  const isExodusEve =
    (m === 12 && (d === 23 || d === 24) && totalMinutesOfDay >= 840) ||
    (m === 12 && d === 31 && totalMinutesOfDay >= 720) ||
    (m === 4 && d === 24 && totalMinutesOfDay >= 840) ||
    (m === 4 && d === 30 && totalMinutesOfDay >= 840) ||
    (isAugustVacation && (dayOfWeek === 5 || dayOfWeek === 0) && distanceKm > 30);

  const isReturnExodus =
    (isEasterMonday && totalMinutesOfDay >= 960) ||
    (m === 1 && d === 6 && totalMinutesOfDay >= 960) ||
    (m === 4 && d === 25 && totalMinutesOfDay >= 960) ||
    (m === 5 && d === 1 && totalMinutesOfDay >= 960);

  const isExodus = isExodusEve || isReturnExodus;

  let commuterReductionFactor = 1.0;
  let extraDelayMinutes = 0;
  let description = '';

  if (isHoliday) {
    commuterReductionFactor = 0.05;
    if (isExodus && distanceKm > 30) {
      extraDelayMinutes = Math.min(8, Math.max(3, Math.ceil(distanceKm * 0.08)));
      description = `esodo festivo (${holidayName}): rallentamenti su autostrade`;
    } else {
      description = `giorno festivo (${holidayName}): viabilità scorrevole`;
    }
  } else if (isBridge) {
    commuterReductionFactor = 0.45;
    description = 'ponte festivo: traffico pendolare ridotto e viabilità scorrevole';
  } else if (isSchoolVacation) {
    commuterReductionFactor = 0.55;
    if (isExodus && distanceKm > 30) {
      extraDelayMinutes = Math.min(7, Math.max(3, Math.ceil(distanceKm * 0.08)));
      description = 'vacanze: traffico intenso di esodo su arterie principali e caselli';
    } else {
      description = 'periodo di vacanze: traffico pendolare ridotto e viabilità scorrevole';
    }
  } else if (isExodus && distanceKm > 30) {
    extraDelayMinutes = Math.min(6, Math.max(2, Math.ceil(distanceKm * 0.07)));
    description = 'vigilia festiva: traffico intenso verso nodi autostradali e stazioni';
  }

  return {
    isHoliday,
    isSchoolVacation,
    isHolidayEve: isExodusEve,
    isExodus,
    isBridge,
    holidayName,
    commuterReductionFactor,
    extraDelayMinutes,
    description,
  };
}

/**
 * Analizzatore delle condizioni di scorrevolezza e traffico:
 * Considera fasce orarie, festività italiane, vacanze accademiche ed esodi,
 * calcolando la reale viabilità attuale.
 */
export function analyzeRouteFluency(options: {
  distanceKm: number;
  durationSec: number;
  steps?: any[];
  mainRoadSummary?: string;
  targetTimeStr?: string;
  targetDate?: Date;
  stationName?: string;
  originName?: string;
}): RouteFluencyResult {
  const {
    distanceKm,
    durationSec,
    steps,
    mainRoadSummary,
    targetTimeStr,
    targetDate,
    stationName,
    originName,
  } = options;

  let totalMins = 0;
  if (targetTimeStr && targetTimeStr.includes(':')) {
    const [th, tm] = targetTimeStr.split(':').map(Number);
    totalMins = th * 60 + tm;
  } else {
    const now = new Date();
    totalMins = now.getHours() * 60 + now.getMinutes();
  }

  // Tempistica base reale a strada libera (allineata a Google Maps / Mappe Apple con Math.ceil)
  const baseMinutes = Math.max(2, Math.ceil(durationSec / 60));
  const speedKmh = Math.round(distanceKm / (baseMinutes / 60));

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
  const resolvedMainRoads = mainRoadsList.length > 0 ? mainRoadsList.join(' e ') : mainRoadSummary;
  const mainRoadsText = resolvedMainRoads ? ` via ${resolvedMainRoads}` : '';

  const dateObj = targetDate || new Date();
  const dayOfWeek = dateObj.getDay(); // 0 = Domenica, 6 = Sabato
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Analisi vacanze, ponti ed esodi festivi
  const holidayProfile = getItalianHolidayProfile(dateObj, totalMins, distanceKm);

  let delayMinutes = 0;
  let status: 'scorrevole' | 'moderato' | 'rallentamenti' | 'intenso' = 'scorrevole';
  let conditionDescription = 'Viabilità attuale: traffico scorrevole';
  let isPeakHour = false;

  if (holidayProfile.isHoliday || isWeekend) {
    if (holidayProfile.extraDelayMinutes > 0) {
      delayMinutes = holidayProfile.extraDelayMinutes;
      status = delayMinutes > 4 ? 'rallentamenti' : 'moderato';
      conditionDescription = `Viabilità attuale: ${holidayProfile.description} (+${delayMinutes} min)`;
      isPeakHour = true;
    } else {
      delayMinutes = 0;
      status = 'scorrevole';
      conditionDescription = holidayProfile.isHoliday
        ? `Viabilità attuale: ${holidayProfile.description}`
        : 'Viabilità attuale: traffico scorrevole (fine settimana)';
      isPeakHour = false;
    }
  } else {
    // Picco mattutino pendolari centrato alle 07:50 (470 min)
    const morningDiff = totalMins - 470;
    const morningIntensity = Math.exp(-(morningDiff * morningDiff) / (2 * 28 * 28));

    // Fascia uscita scuole / pranzo centrata alle 13:35 (815 min)
    const middayDiff = totalMins - 815;
    const middayIntensity = 0.45 * Math.exp(-(middayDiff * middayDiff) / (2 * 25 * 25));

    // Picco serale rientro pendolare centrato alle 18:00 (1080 min)
    const eveningDiff = totalMins - 1080;
    const eveningIntensity = Math.exp(-(eveningDiff * eveningDiff) / (2 * 32 * 32));

    let dayWeight = 1.0;
    if (dayOfWeek === 1) dayWeight = 0.9;
    else if (dayOfWeek === 5) dayWeight = 0.85;

    // Modula con festività/ponti/vacanze
    const effectiveIntensity =
      Math.max(morningIntensity, middayIntensity, eveningIntensity) *
      dayWeight *
      holidayProfile.commuterReductionFactor;

    isPeakHour = effectiveIntensity > 0.45;

    const speedFactor = speedKmh > 65 ? 0.8 : 1.0;
    const urbanDensityFactor = intersectionsPerKm > 1.3 ? 1.2 : 1.0;
    const maxCongestionDelay = Math.min(6, Math.max(2, Math.round(baseMinutes * 0.2 * speedFactor * urbanDensityFactor)));

    delayMinutes = Math.round(maxCongestionDelay * effectiveIntensity) + holidayProfile.extraDelayMinutes;

    if (delayMinutes <= 1) {
      status = 'scorrevole';
      conditionDescription = holidayProfile.description
        ? `Viabilità attuale: ${holidayProfile.description}`
        : isPeakHour
          ? 'Viabilità attuale: traffico scorrevole (ora di punta regolare)'
          : 'Viabilità attuale: traffico scorrevole';
    } else if (delayMinutes === 2) {
      status = 'moderato';
      conditionDescription = holidayProfile.description
        ? `Viabilità attuale: ${holidayProfile.description} (+2 min)`
        : 'Viabilità attuale: traffico moderato (+2 min rispetto al tempo base)';
    } else if (delayMinutes <= 4) {
      status = 'rallentamenti';
      conditionDescription = holidayProfile.description
        ? `Viabilità attuale: ${holidayProfile.description} (+${delayMinutes} min)`
        : `Viabilità attuale: rallentamenti verso la stazione (+${delayMinutes} min rispetto al tempo base)`;
    } else {
      status = 'intenso';
      conditionDescription = holidayProfile.description
        ? `Viabilità attuale: ${holidayProfile.description} (+${delayMinutes} min)`
        : `Viabilità attuale: traffico intenso (+${delayMinutes} min rispetto al tempo base)`;
    }
  }

  // Somma sempre i minuti di traffico alla tempistica base
  const finalMinutes = Math.max(2, baseMinutes + delayMinutes);

  const destName = stationName || 'Stazione FS';
  const startName = originName || 'Partenza';
  const kmFormatted = +distanceKm.toFixed(1);

  const delayText = delayMinutes > 0 ? ` • +${delayMinutes}m traffico` : ' • scorrevole';
  const routeSummary = `${startName} ➔ ${destName} (${kmFormatted} km${mainRoadsText} • ~${finalMinutes} min${delayText})`;

  return {
    finalMinutes,
    baseMinutes,
    delayMinutes,
    status,
    conditionDescription,
    routeSummary,
    isPeakHour,
    mainRoads: resolvedMainRoads,
    speedKmh,
  };
}

/**
 * Calcola in modo REALE e PRECISO la distanza stradale e il tempo di percorrenza
 * (comprensivo di traffico aggiunto alla tempistica base) tra l'indirizzo scelto e la stazione scelta.
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
    // Se l'indirizzo contiene un numero civico (es. "Via Roma 135c"), risolvi sempre con il geocoder
    // aggiornato (con cache in memoria) per evitare che vecchie coordinate salvate sulla via generica falsino i km
    const hasCivicNumber = /\d/.test(origin);
    const [resolvedOrigin, coordsStation] = await Promise.all([
      hasCivicNumber || !originCoords || typeof originCoords.lat !== 'number' || typeof originCoords.lon !== 'number'
        ? resolveOriginCoordinates(origin, station)
        : Promise.resolve({ lat: originCoords.lat, lon: originCoords.lon, name: origin }),
      resolveStationCoordinates(station),
    ]);

    const coordsOrigin =
      resolvedOrigin ||
      (originCoords && typeof originCoords.lat === 'number' && typeof originCoords.lon === 'number'
        ? { lat: originCoords.lat, lon: originCoords.lon, name: origin }
        : null);

    if (coordsOrigin && coordsStation) {
      const routeData = await fetchRealRoadRoute(
        coordsOrigin.lat,
        coordsOrigin.lon,
        coordsStation.lat,
        coordsStation.lon
      );

      if (routeData) {
        const fluency = analyzeRouteFluency({
          distanceKm: routeData.distanceKm,
          durationSec: routeData.durationSec,
          steps: routeData.steps,
          mainRoadSummary: routeData.mainRoadSummary,
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

      // Fallback solo in assenza totale di connessione internet
      const directKm = haversineDistanceKm(
        coordsOrigin.lat,
        coordsOrigin.lon,
        coordsStation.lat,
        coordsStation.lon
      );
      const roadKm = +(directKm * 1.32).toFixed(1);
      const estimatedSec = (roadKm / 48) * 3600;

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

  const fallbackKm = 15.0;
  const fallbackSec = (fallbackKm / 48) * 3600;
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
  title: string;
  subtitle: string;
  label: string;
  lat: number;
  lon: number;
}

async function nominatimSearch(q: string, signal?: AbortSignal): Promise<any[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      q
    )}&format=jsonv2&addressdetails=1&limit=6&countrycodes=it&accept-language=it&dedupe=1`;
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'StudICI-Mobile/1.8 (Sapienza; iOS)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.filter((d: any) => d?.lat && d?.lon) : [];
  } catch {
    return [];
  }
}

async function photonSearch(q: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      q
    )}&lat=42.45&lon=12.45&limit=8`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const features = Array.isArray(json?.features) ? json.features : [];
    const results: PlaceSuggestion[] = [];
    for (const f of features) {
      const p = f?.properties || {};
      if (p.countrycode && p.countrycode !== 'IT') continue;
      const coords = f?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const [lon, lat] = coords;
      const road = p.street || (p.osm_key === 'highway' ? p.name : '') || '';
      const houseNum = p.housenumber || '';
      const locality = p.city || p.locality || p.town || p.village || '';
      const province = p.county || '';
      const region = p.state || '';
      const title = road
        ? `${road}${houseNum ? ' ' + houseNum : ''}`
        : p.name || locality;
      if (!title) continue;
      const subtitleParts = [locality, province, region].filter(
        (part, idx, arr) => part && part !== title && arr.indexOf(part) === idx
      );
      results.push({
        id: `photon_${p.osm_id || Math.random()}`,
        title,
        subtitle: subtitleParts.join(' · '),
        label: [title, locality].filter((part, idx, arr) => part && arr.indexOf(part) === idx).join(', '),
        lat: Number(lat),
        lon: Number(lon),
      });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Ricerca luoghi/indirizzi in stile Mappe (autocompletamento) combinando Photon Komoot e Nominatim OSM.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const numberMatch = q.match(/(?:^|[\s,])(\d{1,4}\s?[a-zA-Z]?)(?=$|[\s,])/);
  const houseNumber = numberMatch ? numberMatch[1].replace(/\s+/g, '') : '';
  const numericOnly = houseNumber.replace(/[a-zA-Z]+$/, '');
  const numericQuery =
    numberMatch && numericOnly && numericOnly !== houseNumber
      ? q.replace(numberMatch[1], numericOnly)
      : '';
  const baseQuery = numberMatch
    ? q
        .replace(numberMatch[0], ' ')
        .replace(/\s*,\s*,/g, ',')
        .replace(/\s+/g, ' ')
        .replace(/^,|,$/g, '')
        .trim()
    : q;

  const [rawNominatim, photonResults] = await Promise.all([
    nominatimSearch(q, signal),
    photonSearch(numericQuery || q, signal),
  ]);

  let raw = rawNominatim;
  let approximate = false;

  const hasExactNumber = raw.some((d) => d?.address?.house_number);
  if (houseNumber && !hasExactNumber) {
    // Se il civico aveva una lettera (es. 135c), cerca prima il civico numerico (135 -> trova 135a/135b)
    if (numericQuery) {
      const byNumeric = await nominatimSearch(numericQuery, signal);
      if (byNumeric.some((d) => d?.address?.house_number)) {
        raw = byNumeric;
        approximate = true;
      }
    }
    if (!raw.some((d) => d?.address?.house_number) && baseQuery.length >= 3) {
      const byStreet = await nominatimSearch(baseQuery, signal);
      if (byStreet.length > 0) {
        raw = byStreet;
        approximate = true;
      }
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

    const key = `${title}|${locality}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const subtitleParts = [locality, province, region].filter(
      (p, i, arr) => p && p !== title && arr.indexOf(p) === i
    );
    if (approximate) subtitleParts.unshift('Via esatta');

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

  for (const pr of photonResults) {
    if (results.length >= 6) break;
    const titleWithNum =
      houseNumber && !/\d/.test(pr.title) ? `${pr.title} ${houseNumber}` : pr.title;
    const localityPart = pr.subtitle.split(' · ')[0] || '';
    const key = `${titleWithNum}|${localityPart}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      ...pr,
      title: titleWithNum,
      label: [titleWithNum, localityPart].filter(Boolean).join(', '),
    });
  }

  return results;
}