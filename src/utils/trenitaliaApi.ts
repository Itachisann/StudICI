import AsyncStorage from '@react-native-async-storage/async-storage';
import { StationInfo, LiveTrainInfo, LiveTrainStop } from '../types/commuter';
import allStationsData from '../data/allStations.json';

export const ALL_STATIONS: StationInfo[] = allStationsData as StationInfo[];

// ViaggiaTreno espone le API resteasy su HTTP (la versione HTTPS invia un 301 verso HTTP).
// Nelle build iOS native (IPA) è configurato NSAppTransportSecurity in app.json per permettere
// la connessione a viaggiatreno.it sia in HTTP diretto che con fallback HTTPS.
const VIAGGIATRENO_BASE_URL = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formatta la data nel formato atteso da ViaggiaTreno ("Tue Oct 13 2026 09:36:00 GMT+0200"),
 * indipendente dal motore JS (Date.toString() cambia tra Hermes/JSC e può includere "(CEST)").
 */
function formatViaggiaTrenoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${p(d.getDate())} ${d.getFullYear()} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:00 GMT${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`;
}

/** Diagnostica dell'ultima interrogazione a ViaggiaTreno (mostrata nel messaggio di fallback). */
let lastFetchError = '';
let fetchOk = 0;
let fetchTotal = 0;

export function getViaggiaTrenoDiagnostics(): string {
  return `${fetchOk}/${fetchTotal} richieste ok${lastFetchError ? `, ultimo errore: ${lastFetchError}` : ''}`;
}

interface TimetableCacheEntry {
  timestamp: number;
  trains: LiveTrainInfo[];
  baseKey: string;
  isToday: boolean;
  coveredStartMins: number;
  coveredEndMins: number;
}
const FULL_DAY_RAIL_STORAGE_KEY = 'studici_fullday_rail_cache_v1';
const PLATFORM_STORAGE_KEY = 'studici_platform_cache_v1';
const FULL_DAY_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 ore per orario ferroviario programmato GTFS
const PLATFORM_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 ore per binario programmato settimanale
const STATION_DEPARTURES_CACHE_TTL_MS = 1000 * 60 * 30; // 30 min in memoria

const timetableCache = new Map<string, TimetableCacheEntry>();
const timetableInFlight = new Map<string, Promise<LiveTrainInfo[]>>();
const fullDayRailCache = new Map<string, { timestamp: number; trains: LiveTrainInfo[] }>();
const fullDayRailInFlight = new Map<string, Promise<LiveTrainInfo[]>>();
const geoInFlight = new Map<string, Promise<{ lat: number; lng: number } | null>>();
const originInfoInFlight = new Map<
  string,
  Promise<{ originCode: string; departureMillis?: number }[]>
>();
const stationDeparturesCache = new Map<string, { timestamp: number; list: any[] }>();
const stationDeparturesInFlight = new Map<string, Promise<any[] | null>>();
const stationTrainPlatformIndex = new Map<string, string>();
const plannedPlatformCache = new Map<string, { timestamp: number; platform: string }>();
const platformInFlight = new Map<string, Promise<string | undefined>>();

let fullDayStorageLoaded = false;
let fullDayStorageLoadPromise: Promise<void> | null = null;
let platformStorageLoaded = false;
let platformStorageLoadPromise: Promise<void> | null = null;

async function ensureFullDayStorageLoaded(): Promise<void> {
  if (fullDayStorageLoaded) return;
  if (fullDayStorageLoadPromise) return fullDayStorageLoadPromise;
  fullDayStorageLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(FULL_DAY_RAIL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const now = Date.now();
          for (const [k, v] of Object.entries<any>(parsed)) {
            if (
              v &&
              typeof v.timestamp === 'number' &&
              Array.isArray(v.trains) &&
              v.trains.length > 0 &&
              now - v.timestamp < FULL_DAY_CACHE_TTL_MS &&
              !fullDayRailCache.has(k)
            ) {
              fullDayRailCache.set(k, { timestamp: v.timestamp, trains: v.trains });
            }
          }
        }
      }
    } catch {}
    fullDayStorageLoaded = true;
    fullDayStorageLoadPromise = null;
  })();
  return fullDayStorageLoadPromise;
}

async function persistFullDayRailEntry(key: string, trains: LiveTrainInfo[]): Promise<void> {
  try {
    await ensureFullDayStorageLoaded();
    fullDayRailCache.set(key, { timestamp: Date.now(), trains });
    const now = Date.now();
    const entries = Array.from(fullDayRailCache.entries())
      .filter(([, val]) => val.trains.length > 0 && now - val.timestamp < FULL_DAY_CACHE_TTL_MS)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 20);
    const payload: Record<string, { timestamp: number; trains: LiveTrainInfo[] }> = {};
    for (const [k, v] of entries) {
      payload[k] = v;
    }
    await AsyncStorage.setItem(FULL_DAY_RAIL_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function ensurePlatformStorageLoaded(): Promise<void> {
  if (platformStorageLoaded) return;
  if (platformStorageLoadPromise) return platformStorageLoadPromise;
  platformStorageLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PLATFORM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const now = Date.now();
          for (const [k, v] of Object.entries<any>(parsed)) {
            if (
              v &&
              typeof v.timestamp === 'number' &&
              typeof v.platform === 'string' &&
              v.platform &&
              now - v.timestamp < PLATFORM_CACHE_TTL_MS &&
              !plannedPlatformCache.has(k)
            ) {
              plannedPlatformCache.set(k, { timestamp: v.timestamp, platform: v.platform });
            }
          }
        }
      }
    } catch {}
    platformStorageLoaded = true;
    platformStorageLoadPromise = null;
  })();
  return platformStorageLoadPromise;
}

async function persistPlatformEntry(key: string, platform: string): Promise<void> {
  try {
    await ensurePlatformStorageLoaded();
    plannedPlatformCache.set(key, { timestamp: Date.now(), platform });
    const now = Date.now();
    const entries = Array.from(plannedPlatformCache.entries())
      .filter(([, val]) => Boolean(val.platform) && now - val.timestamp < PLATFORM_CACHE_TTL_MS)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 100);
    const payload: Record<string, { timestamp: number; platform: string }> = {};
    for (const [k, v] of entries) {
      payload[k] = v;
    }
    await AsyncStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

let activeTransitousCount = 0;
const transitousWaiters: (() => void)[] = [];
async function withTransitousSlot<T>(task: () => Promise<T>, maxConcurrent = 3): Promise<T> {
  if (activeTransitousCount >= maxConcurrent) {
    await new Promise<void>((resolve) => transitousWaiters.push(resolve));
  }
  activeTransitousCount++;
  try {
    return await task();
  } finally {
    activeTransitousCount--;
    const nextWaiter = transitousWaiters.shift();
    if (nextWaiter) nextWaiter();
  }
}

const platformMissCache = new Map<string, number>();
const PLATFORM_MISS_TTL_MS = 6 * 60 * 60 * 1000;

export function clearTrenitaliaCache(): void {
  timetableCache.clear();
  fullDayRailCache.clear();
  andamentoMemoryCache.clear();
  andamentoInFlight.clear();
  trainOriginInfoCache.clear();
  originInfoInFlight.clear();
  stationDeparturesCache.clear();
  stationTrainPlatformIndex.clear();
  plannedPlatformCache.clear();
  platformMissCache.clear();
  fullDayStorageLoaded = false;
  platformStorageLoaded = false;
  AsyncStorage.multiRemove([FULL_DAY_RAIL_STORAGE_KEY, PLATFORM_STORAGE_KEY]).catch(() => {});
}

async function fetchViaggiaTrenoRawText(
  url: string,
  timeoutMs = 4500,
  retries = 1
): Promise<string | null> {
  fetchTotal++;
  const defaultHeaders = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  };

  const urlsToTry = [url];
  if (url.startsWith('http://')) {
    urlsToTry.push(url.replace('http://', 'https://'));
  } else if (url.startsWith('https://')) {
    urlsToTry.push(url.replace('https://', 'http://'));
  }

  for (const targetUrl of urlsToTry) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(targetUrl, {
          signal: controller.signal,
          headers: defaultHeaders,
        });
        if (!res.ok) {
          clearTimeout(timeout);
          lastFetchError = `HTTP ${res.status}`;
          continue;
        }
        const text = await res.text();
        clearTimeout(timeout);
        return text;
      } catch (e: any) {
        clearTimeout(timeout);
        lastFetchError =
          e?.name === 'AbortError' ? `timeout ${timeoutMs / 1000}s` : String(e?.message || e).slice(0, 80);
      }
    }
  }
  console.warn('[ViaggiaTreno]', lastFetchError, url);
  return null;
}

/**
 * Fetch JSON con timeout snello (4.5s) per singola richiesta.
 * Supporta fallback automatico tra HTTP diretto (veloce, senza 301) e HTTPS.
 * Ritorna null se la richiesta fallisce definitivamente (diverso da lista vuota valida).
 */
async function fetchViaggiaTrenoJson(url: string, timeoutMs = 4500, retries = 1): Promise<any | null> {
  const text = await fetchViaggiaTrenoRawText(url, timeoutMs, retries);
  if (text === null) return null;
  try {
    const json = JSON.parse(text);
    fetchOk++;
    return json;
  } catch (e: any) {
    lastFetchError = `risposta non valida (${text.length} caratteri): ${String(e?.message || e).slice(0, 60)}`;
    console.warn('[ViaggiaTreno]', lastFetchError, url);
    return null;
  }
}

/** Esegue i task con un numero massimo di richieste simultanee (8 parallele per saturare subito il download). */
async function runLimited<T>(tasks: (() => Promise<T>)[], limit = 8): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export const POPULAR_STATIONS: StationInfo[] = [
  { name: 'ROMA TERMINI', code: 'S08409', shortName: 'Roma Termini', lat: 41.9013, lng: 12.5008 },
  { name: 'ROMA TIBURTINA', code: 'S08217', shortName: 'Roma Tiburtina', lat: 41.9102, lng: 12.5302 },
  { name: 'FIRENZE SANTA MARIA NOVELLA', code: 'S06421', shortName: 'Firenze SMN', lat: 43.7765, lng: 11.2479 },
  { name: 'NAPOLI CENTRALE', code: 'S09218', shortName: 'Napoli C.le', lat: 40.8529, lng: 14.2723 },
  { name: 'BOLOGNA CENTRALE', code: 'S05043', shortName: 'Bologna C.le', lat: 44.5058, lng: 11.3431 },
  { name: 'MILANO CENTRALE', code: 'S01700', shortName: 'Milano C.le', lat: 45.4862, lng: 9.2045 },
  { name: 'TORINO PORTA NUOVA', code: 'S00219', shortName: 'Torino P. Nuova', lat: 45.0622, lng: 7.6784 },
  { name: 'VENEZIA SANTA LUCIA', code: 'S02593', shortName: 'Venezia S. Lucia', lat: 45.4411, lng: 12.3210 },
  { name: 'PISA CENTRALE', code: 'S06500', shortName: 'Pisa C.le', lat: 43.7085, lng: 10.3985 },
  { name: 'PERUGIA', code: 'S07004', shortName: 'Perugia', lat: 43.1065, lng: 12.3752 },
  { name: 'TERNI', code: 'S07226', shortName: 'Terni', lat: 42.5694, lng: 12.6468 },
  { name: 'ANCONA', code: 'S07113', shortName: 'Ancona', lat: 43.6067, lng: 13.5002 },
  { name: 'PESCARA', code: 'S07810', shortName: 'Pescara', lat: 42.4697, lng: 14.2056 },
  { name: 'ROMA OSTIENSE', code: 'S08406', shortName: 'Roma Ostiense', lat: 41.8727, lng: 12.4842 },
  { name: 'ROMA TUSCOLANA', code: 'S08408', shortName: 'Roma Tuscolana', lat: 41.8824, lng: 12.5238 },
  { name: 'ROMA S. PIETRO', code: 'S08402', shortName: 'Roma S. Pietro', lat: 41.8988, lng: 12.4542 },
  { name: 'VITERBO PORTA FIORENTINA', code: 'S08304', shortName: 'Viterbo P. Fiorentina', lat: 42.4277, lng: 12.1062 },
  { name: 'VITERBO PORTA ROMANA', code: 'S08306', shortName: 'Viterbo P. Romana', lat: 42.4132, lng: 12.1120 },
  { name: 'ORTE', code: 'S08209', shortName: 'Orte', lat: 42.4375, lng: 12.4085 },
  { name: 'NARNI AMELIA', code: 'S07230', shortName: 'Narni Amelia', lat: 42.5315, lng: 12.5192 },
  { name: 'CHIUSI-CHIANCIANO TERME', code: 'S06925', shortName: 'Chiusi-Chianciano', lat: 43.0147, lng: 11.9482 },
  { name: 'CIVITA CASTELLANA-MAGLIANO', code: 'S08211', shortName: 'Civita Castellana', lat: 42.3021, lng: 12.4431 },
  { name: 'FARA SABINA-MONTELIBRETTI', code: 'S08214', shortName: 'Fara Sabina', lat: 42.1643, lng: 12.7214 },
  { name: 'MONTEROTONDO-MENTANA', code: 'S08215', shortName: 'Monterotondo', lat: 42.0526, lng: 12.6074 },
  { name: 'ORVIETO', code: 'S08203', shortName: 'Orvieto', lat: 42.7247, lng: 12.1278 },
  { name: 'FOLIGNO', code: 'S07217', shortName: 'Foligno', lat: 42.9556, lng: 12.7107 },
  { name: 'SPOLETO', code: 'S07221', shortName: 'Spoleto', lat: 42.7471, lng: 12.7402 },
  { name: 'ASSISI', code: 'S07008', shortName: 'Assisi', lat: 43.0592, lng: 12.5833 },
  { name: 'AREZZO', code: 'S06915', shortName: 'Arezzo', lat: 43.4632, lng: 11.8741 },
  { name: 'CASERTA', code: 'S09211', shortName: 'Caserta', lat: 41.0664, lng: 14.3283 },
  { name: 'NETTUNO', code: 'S08710', shortName: 'Nettuno', lat: 41.4588, lng: 12.6631 },
  { name: 'GROSSETO', code: 'S06039', shortName: 'Grosseto', lat: 42.7667, lng: 11.1186 },
  { name: 'FIUMICINO AEROPORTO', code: 'S08411', shortName: 'Fiumicino Aeroporto', lat: 41.7933, lng: 12.2519 },
];

const stationGeoCache = new Map<string, { lat: number; lng: number }>();

export async function resolveStationGeoCoordinates(
  station: StationInfo
): Promise<{ lat: number; lng: number } | null> {
  if (typeof station.lat === 'number' && typeof station.lng === 'number') {
    return { lat: station.lat, lng: station.lng };
  }
  const cleanCode = (station.code || '').trim().toUpperCase();
  const pop = POPULAR_STATIONS.find(
    (s) =>
      (cleanCode && s.code.toUpperCase() === cleanCode) ||
      (station.name && normalizeStationKey(s.name) === normalizeStationKey(station.name))
  );
  if (pop?.lat && pop?.lng) {
    return { lat: pop.lat, lng: pop.lng };
  }

  const cacheKey = (station.name || cleanCode).toLowerCase().trim();
  if (stationGeoCache.has(cacheKey)) {
    return stationGeoCache.get(cacheKey)!;
  }
  const existingGeo = geoInFlight.get(cacheKey);
  if (existingGeo) return existingGeo;

  const task = (async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      const q = `Stazione ${station.name || cleanCode}`;
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'StudICI/1.0' } });
      clearTimeout(to);
      if (res.ok) {
        const data = await res.json();
        const coords = data?.features?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const found = { lat: coords[1], lng: coords[0] };
          stationGeoCache.set(cacheKey, found);
          return found;
        }
      }
    } catch {
      // fallback automatico
    }

    return null;
  })().finally(() => {
    geoInFlight.delete(cacheKey);
  });

  geoInFlight.set(cacheKey, task);
  return task;
}

function normalizeStationKey(str?: string | null): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/[-_./]/g, ' ')
    .replace(/\bSAN\b/g, 'S')
    .replace(/\bSANTA\b/g, 'S')
    .replace(/\bUMBRA\b/g, '')
    .replace(/\bDI\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Riallinea qualsiasi stazione salvata (anche con vecchi codici errati o trattini, es. NARNI-AMELIA S08208)
 * al codice ufficiale ViaggiaTreno corrispondente.
 */
export function normalizeStationInfo(station: StationInfo): StationInfo {
  if (!station) return POPULAR_STATIONS[0];
  const keyName = normalizeStationKey(station.name);
  const keyShort = normalizeStationKey(station.shortName);

  const byName = POPULAR_STATIONS.find((s) => {
    const pName = normalizeStationKey(s.name);
    const pShort = normalizeStationKey(s.shortName);
    return (
      (keyName && (pName === keyName || pShort === keyName)) ||
      (keyShort && (pName === keyShort || pShort === keyShort))
    );
  });
  if (byName) {
    return { ...byName };
  }

  const cleanCode = (station.code || '').trim().toUpperCase();
  const byCode = POPULAR_STATIONS.find((s) => s.code.toUpperCase() === cleanCode);
  if (byCode) {
    return { ...byCode };
  }

  return station;
}

function computeLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function calculateStationScore(
  s: StationInfo,
  cleanQ: string,
  normQ: string
): number {
  const name = s.name.toUpperCase();
  const shortName = (s.shortName || '').toUpperCase();
  const normName = normalizeStationKey(s.name);
  const normShort = normalizeStationKey(s.shortName);

  // 1. Corrispondenza ESATTA al 100% (Nome completo o ShortName) -> Priorità assoluta #1
  if (name === cleanQ || shortName === cleanQ) {
    return 100000;
  }
  if (normName === normQ || normShort === normQ) {
    return 95000;
  }

  // 2. Inizia esattamente con la query (Prefisso del nome o shortName)
  if (name.startsWith(cleanQ) || shortName.startsWith(cleanQ)) {
    return 80000 - Math.abs(name.length - cleanQ.length) * 10;
  }
  if (normName.startsWith(normQ) || normShort.startsWith(normQ)) {
    return 75000 - Math.abs(normName.length - normQ.length) * 10;
  }

  // 3. Una parola interna inizia esattamente con la query (es. "TERMINI" per "ROMA TERMINI")
  const words = name.split(/[\s\-_/.]+/).filter(Boolean);
  const exactWordMatch = words.some((w) => w === cleanQ);
  if (exactWordMatch) {
    return 60000 - name.length * 5;
  }
  const prefixWordMatch = words.some((w) => w.startsWith(cleanQ));
  if (prefixWordMatch) {
    return 50000 - name.length * 5;
  }

  // 4. Substring inclusa nel nome o shortName
  if (name.includes(cleanQ) || shortName.includes(cleanQ)) {
    const idx = Math.min(
      name.includes(cleanQ) ? name.indexOf(cleanQ) : 99,
      shortName.includes(cleanQ) ? shortName.indexOf(cleanQ) : 99
    );
    return 30000 - idx * 50 - name.length * 5;
  }
  if (normName.includes(normQ) || normShort.includes(normQ)) {
    return 25000 - normName.length * 5;
  }

  // 5. Corrispondenza fuzzy / per somiglianza (typo tolerance)
  if (cleanQ.length >= 3) {
    let minWordDist = 99;
    for (const w of words) {
      const sliceLen = Math.min(w.length, cleanQ.length + 1);
      const dist = computeLevenshtein(cleanQ, w.slice(0, sliceLen));
      if (dist < minWordDist) minWordDist = dist;
    }

    const wholeDist = computeLevenshtein(cleanQ, name.slice(0, cleanQ.length + 2));
    const bestDist = Math.min(minWordDist, wholeDist);

    const maxAllowed = cleanQ.length <= 4 ? 1 : cleanQ.length <= 7 ? 2 : 3;
    if (bestDist <= maxAllowed) {
      return 15000 - bestDist * 3000 - name.length * 5;
    }
  }

  return -1;
}

/**
 * Cerca stazioni dando priorità alla corrispondenza esatta, poi prefissi, parole e somiglianza
 */
export async function searchStations(query: string): Promise<StationInfo[]> {
  const cleanQ = query.trim().toUpperCase();
  if (!cleanQ) return ALL_STATIONS;

  const normQ = normalizeStationKey(cleanQ);

  // Calcola i punteggi locali
  const scoredLocal: { station: StationInfo; score: number }[] = [];
  for (const st of ALL_STATIONS) {
    const score = calculateStationScore(st, cleanQ, normQ);
    if (score >= 0) {
      scoredLocal.push({ station: st, score });
    }
  }

  scoredLocal.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.station.name.length !== b.station.name.length) {
      return a.station.name.length - b.station.name.length;
    }
    return a.station.name.localeCompare(b.station.name);
  });

  const localMatches = scoredLocal.map((item) => item.station);

  if (cleanQ.length < 3) {
    return localMatches;
  }

  const queriesToTry = Array.from(
    new Set([cleanQ.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim(), cleanQ])
  );

  const remoteMatches: StationInfo[] = [];

  for (const qStr of queriesToTry) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(
        `${VIAGGIATRENO_BASE_URL}/autocompletaStazione/${encodeURIComponent(qStr)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const text = await res.text();
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

        for (const line of lines) {
          const parts = line.split('|');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const code = parts[1].trim();
            if (
              name &&
              code &&
              !remoteMatches.some(
                (m) => m.code === code || normalizeStationKey(m.name) === normalizeStationKey(name)
              )
            ) {
              remoteMatches.push({
                name,
                code,
                shortName: formatStationName(name),
              });
            }
          }
        }
        if (remoteMatches.length > 0) break;
      }
    } catch {}
  }

  // Unisci senza duplicati preservando l'ordinamento per punteggio
  const combined = [...localMatches];
  for (const r of remoteMatches) {
    const rKey = normalizeStationKey(r.name);
    if (
      !combined.some(
        (c) => c.code === r.code || (rKey.length > 0 && normalizeStationKey(c.name) === rKey)
      )
    ) {
      combined.push(r);
    }
  }
  return combined;
}

export function formatStationName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
    )
    .join(' ');
}

export function getStationNameByCode(code?: string | null): string {
  if (!code) return '';
  const clean = code.trim().toUpperCase();
  const found = POPULAR_STATIONS.find(
    (s) => s.code.toUpperCase() === clean || s.code.endsWith(clean) || clean.endsWith(s.code)
  );
  if (found) {
    return found.shortName || found.name;
  }
  if (/^S\d+$/i.test(clean)) {
    return '';
  }
  return clean;
}

export const MULTI_STATION_CITIES = [
  'roma',
  'milano',
  'torino',
  'napoli',
  'firenze',
  'venezia',
  'genova',
  'bologna',
  'verona',
  'bari',
  'palermo',
  'catania',
  'trieste',
  'reggio calabria',
  'reggio emilia',
  'pisa',
  'padova',
  'salerno',
  'ancona',
  'viterbo',
];

export function cleanStationName(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(c\s*le|cle|centr|cent|cntr)\b/g, ' centrale ')
    .replace(/\b(p\s*ta|p\s*te)\b/g, ' porta ')
    .replace(/\b(p\s*n|p\s*nuova)\b/g, ' porta nuova ')
    .replace(/\b(p\s*s|p\s*susa)\b/g, ' porta susa ')
    .replace(/\b(p\s*g|p\s*garibaldi)\b/g, ' porta garibaldi ')
    .replace(/\b(p\s*r|p\s*romana)\b/g, ' porta romana ')
    .replace(/\b(s\s*m\s*n|smn|s\s*m\s*novella)\b/g, ' santa maria novella ')
    .replace(/\b(s\s*l|s\s*lucia)\b/g, ' santa lucia ')
    .replace(/\b(tib|tibur)\b/g, ' tiburtina ')
    .replace(/\b(term)\b/g, ' termini ')
    .replace(/\b(c\s*m|campo\s*marte)\b/g, ' campo di marte ')
    .replace(/\b(p\s*f|p\s*fiorentina)\b/g, ' porta fiorentina ')
    .replace(/\b(aerop|aero|apt)\b/g, ' aeroporto ')
    .replace(/\b(s\s*pietro|san\s*pietro)\b/g, ' san pietro ')
    .replace(/\b(s|st)\b/g, ' san ')
    .replace(/\b(sta)\b/g, ' santa ')
    .replace(/\b(p\s*za|pza|p\s*le|ple)\b/g, ' ')
    .replace(/\b(fs|staz|stazione)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSameStation(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const cleanA = cleanStationName(a);
  const cleanB = cleanStationName(b);
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.replace(/\s+/g, '') === cleanB.replace(/\s+/g, '')) return true;

  // Controllo stazioni in città metropolitane o con più scali ferroviari
  for (const city of MULTI_STATION_CITIES) {
    const aStartsWithCity = cleanA === city || cleanA.startsWith(city + ' ');
    const bStartsWithCity = cleanB === city || cleanB.startsWith(city + ' ');

    if (aStartsWithCity && bStartsWithCity) {
      const restA = cleanA.slice(city.length).trim();
      const restB = cleanB.slice(city.length).trim();
      // Entrambe specificano uno scalo (es. Tuscolana vs Tiburtina, Centrale vs Rogoredo)
      if (restA.length > 0 && restB.length > 0) {
        return restA === restB || restA.replace(/\s+/g, '') === restB.replace(/\s+/g, '');
      }
      // Se una ha solo il nome della città (es. "Roma") e l'altra ha uno scalo specifico (es. "Roma Tiburtina"), NON coincidono
      return false;
    }

    if (aStartsWithCity && !bStartsWithCity) {
      const restA = cleanA.slice(city.length).trim();
      if (restA.length > 0 && (restA === cleanB || restA.replace(/\s+/g, '') === cleanB.replace(/\s+/g, ''))) {
        return true;
      }
    }

    if (!aStartsWithCity && bStartsWithCity) {
      const restB = cleanB.slice(city.length).trim();
      if (restB.length > 0 && (restB === cleanA || restB.replace(/\s+/g, '') === cleanA.replace(/\s+/g, ''))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Ottiene i treni in partenza in tempo reale da una stazione
 */
export async function getLiveStationDepartures(
  stationCode: string,
  targetDate: Date = new Date(),
  includeIntercity = false
): Promise<LiveTrainInfo[]> {
  try {
    const dateStr = encodeURIComponent(formatViaggiaTrenoDate(targetDate));
    const url = `${VIAGGIATRENO_BASE_URL}/partenze/${stationCode}/${dateStr}`;

    const rawList = await fetchViaggiaTrenoJson(url);
    if (!Array.isArray(rawList)) return [];

    const results: LiveTrainInfo[] = [];

    for (const raw of rawList) {
      const catRaw = (raw.categoriaDescrizione || raw.categoria || '').toUpperCase();
      const isIntercity =
        catRaw.includes('IC') ||
        catRaw.includes('INTERCITY') ||
        catRaw === 'ICN';
      const isRegional =
        catRaw.includes('REG') ||
        catRaw.includes('RV') ||
        catRaw === 'R' ||
        catRaw.includes('REGIONALE');

      const isAllowed = isRegional || (includeIntercity && isIntercity);
      if (!isAllowed) continue;
      if (raw.provvedimento === 1 || raw.statoTreno === 'SOPPRESSO') continue;

      const plannedDep = raw.compOrarioPartenza || '00:00';
      const plannedDepM = parseTimeToMinutes(plannedDep);
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();

      // FILTRO N.D. TRENITALIA:
      // Se l'orario di partenza programmato è già passato e Trenitalia riporta N.D. (ritardo null, non in stazione, o NON_DISPONIBILE):
      // il treno è N.D. e non deve uscire proprio!
      const isND =
        nowMins > plannedDepM &&
        (raw.ritardo === null || raw.ritardo === undefined || raw.statoTreno === 'NON_DISPONIBILE') &&
        raw.inStazione !== true;
      if (isND) continue;

      const delay = typeof raw.ritardo === 'number' ? raw.ritardo : 0;
      const progPlatform =
        raw.binarioProgrammatoPartenzaDescrizione ||
        raw.binarioProgrammatoPartenzaCodice ||
        null;
      const actualPlatform =
        raw.binarioEffettivoPartenzaDescrizione ||
        raw.binarioEffettivoPartenzaCodice ||
        null;

      const isOriginStation = Boolean(
        raw.codOrigine === stationCode ||
        raw.idOrigine === stationCode ||
        (typeof raw.origine === 'string' && raw.origine.trim().length === 0)
      );

      let cleanLiveDep =
        cleanViaggiaTrenoTime(raw.compOrarioPartenzaZeroEffettivo) ||
        cleanViaggiaTrenoTime(raw.compOrarioEffettivoPartenza);

      if (!cleanLiveDep && typeof raw.partenzaTreno === 'number' && raw.partenzaTreno > 0) {
        const pDate = new Date(raw.partenzaTreno);
        cleanLiveDep = `${String(pDate.getHours()).padStart(2, '0')}:${String(pDate.getMinutes()).padStart(2, '0')}`;
      }

      let actualDep = plannedDep;
      if (cleanLiveDep && parseTimeToMinutes(cleanLiveDep) >= parseTimeToMinutes(plannedDep)) {
        actualDep = cleanLiveDep;
      } else if (delay > 0) {
        const [ph, pm] = plannedDep.split(':').map(Number);
        actualDep = minutesToTime(ph * 60 + pm + delay);
      }

      const isPartitoAtStation =
        Array.isArray(raw.compInStazionePartenza) &&
        Boolean(raw.compInStazionePartenza[0]?.toLowerCase().includes('partito'));

      const isDeparted = Boolean(
        raw.nonPartito === false ||
        isPartitoAtStation ||
        (typeof raw.partenzaTreno === 'number' && raw.partenzaTreno > 0)
      );

      const isOriginDepartureDelay = Boolean(
        !isPartitoAtStation &&
        raw.nonPartito === true &&
        nowMins >= plannedDepM &&
        nowMins - plannedDepM <= 120
      );

      const isInStationAtDep = Boolean(
        !isPartitoAtStation &&
        (raw.inStazione === true ||
          isOriginDepartureDelay ||
          (Array.isArray(raw.compInStazionePartenza) &&
            Boolean(raw.compInStazionePartenza[0]?.toLowerCase().includes('stazione'))))
      );

      const depMins = parseTimeToMinutes(actualDep);
      const isDepartedFromStation = Boolean(
        !isInStationAtDep && (
          isOriginStation
            ? (isPartitoAtStation || (raw.nonPartito === false && cleanLiveDep && nowMins > depMins))
            : (isPartitoAtStation || (isDeparted && nowMins > depMins && raw.inStazione !== true))
        )
      );

      const isStoppedInStation = isInStationAtDep;
      const stoppedStationName = isInStationAtDep ? formatStationName(getStationNameByCode(stationCode)) : undefined;
      const estimatedDepM = Math.max(
        plannedDepM + Math.max(0, delay),
        cleanLiveDep ? parseTimeToMinutes(cleanLiveDep) : 0
      );
      const stoppedStationEstimatedDep = isStoppedInStation ? minutesToTime(estimatedDepM) : undefined;

      // Il ritardo segue sempre il programma (plannedDepM), mentre il badge "Fermo a" scatta se si supera la partenza
      let effectiveDelay = delay;
      let stoppedMinutes: number | undefined = undefined;
      if (isStoppedInStation) {
        if (nowMins > plannedDepM) {
          const lateAccumulated = nowMins - plannedDepM;
          stoppedMinutes = Math.max(1, lateAccumulated);
          if (effectiveDelay < lateAccumulated) {
            effectiveDelay = lateAccumulated;
          }
          actualDep = minutesToTime(plannedDepM + effectiveDelay);
        } else if (delay <= 0) {
          effectiveDelay = 0;
          actualDep = plannedDep;
        }
      }

      let statusDescription = 'In orario';
      if (raw.provvedimento === 1 || raw.statoTreno === 'SOPPRESSO') {
        statusDescription = 'Soppresso';
      } else if (raw.provvedimento === 3 || raw.statoTreno === 'DEVIATO') {
        statusDescription = 'Deviato';
      } else if (isStoppedInStation) {
        if (isOriginDepartureDelay) {
          statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
        } else if (nowMins > estimatedDepM) {
          const durationStr = stoppedMinutes ? ` (da ${stoppedMinutes} min)` : '';
          statusDescription = effectiveDelay > 0 ? `Fermo a ${stoppedStationName}${durationStr}` : `Fermo a ${stoppedStationName}`;
        } else if (effectiveDelay > 0) {
          statusDescription = `Ritardo di ${effectiveDelay} min`;
        } else {
          statusDescription = isOriginStation || !isDeparted || nowMins < plannedDepM ? 'Non partito' : 'In orario';
        }
      } else if (isDepartedFromStation) {
        statusDescription = 'In viaggio';
      } else if (isOriginDepartureDelay) {
        statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
      } else if (effectiveDelay > 0) {
        statusDescription = `Ritardo di ${effectiveDelay} min`;
      } else if (effectiveDelay < 0) {
        statusDescription = `Anticipo di ${Math.abs(effectiveDelay)} min`;
      } else {
        statusDescription = isOriginStation || !isDeparted || nowMins < plannedDepM ? 'Non partito' : 'In orario';
      }

      let alertMessage: string | undefined = undefined;
      const rawNotice = (raw.segnalazioni || raw.subTitle || raw.avviso || '').trim();
      const delayReason = (raw.motivoRitardoPrevalente || '').trim();
      if (rawNotice) {
        alertMessage = rawNotice;
      } else if (delayReason) {
        alertMessage = `Causa ritardo: ${delayReason}`;
      } else if (raw.provvedimento === 3 || raw.statoTreno === 'DEVIATO') {
        alertMessage = 'Treno deviato su percorso alternativo da Trenitalia';
      }

      let capacityWarning: string | undefined = undefined;
      const isNotPurchasable =
        Boolean(raw.nonAcquistabile || raw.bigliettiNonAcquistabili) ||
        (typeof rawNotice === 'string' &&
          /biglietti\s+non\s+acquistabili|posti\s+esauriti/i.test(rawNotice));

      if (isNotPurchasable) {
        capacityWarning = 'Biglietti non acquistabili (Disponibilità posti limitata)';
      }

      const isFast = !isIntercity && (catRaw.includes('RV') || catRaw.includes('VELOCE'));

      const resolvedOriginName =
        (raw.origine && raw.origine.trim().length > 0)
          ? formatStationName(raw.origine)
          : isOriginStation
          ? getStationNameByCode(stationCode)
          : getStationNameByCode(raw.codOrigine || raw.idOrigine);

      let trainNumber = raw.compNumeroTreno;
      if (!trainNumber) {
        trainNumber = isIntercity ? `IC ${raw.numeroTreno}` : (isFast ? `RV ${raw.numeroTreno}` : `REG ${raw.numeroTreno}`);
      } else if (isIntercity && !/^IC\b/i.test(trainNumber)) {
        trainNumber = `IC ${raw.numeroTreno}`;
      }

      results.push({
        trainNumber,
        category: isIntercity ? 'IC' : (isFast ? 'RV' : 'REG'),
        destination: raw.destinazione ? formatStationName(raw.destinazione) : '',
        originStationName: resolvedOriginName,
        originStationCode: raw.codOrigine || raw.idOrigine || stationCode || undefined,
        departureTimePlanned: plannedDep,
        departureTimeActual: actualDep,
        departureMillis: raw.orarioPartenza || targetDate.getTime(),
        platformPlanned: cleanPlatform(progPlatform),
        platformActual: cleanPlatform(actualPlatform),
        delayMinutes: effectiveDelay,
        statusDescription,
        isLive: true,
        isFast,
        isOriginStation,
        isDeparted,
        isDepartedFromStation,
        isStoppedInStation,
        stoppedStationName,
        stoppedStationEstimatedDep,
        stoppedMinutes,
        alertMessage,
        capacityWarning,
        notPurchasable: isNotPurchasable,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Ottiene i dettagli completi della corsa (fermate, orario arrivo a destinazione, binario arrivo)
 */
export async function getLiveTrainDetails(
  originStationCode: string,
  trainNumber: number | string,
  departureMillis: number
): Promise<{
  stops: {
    stationName: string;
    arrivalTimePlanned?: string;
    arrivalTimeActual?: string;
    departureTimePlanned?: string;
    platformPlanned?: string;
    platformActual?: string;
  }[];
} | null> {
  try {
    const cleanNum = String(trainNumber).replace(/\D/g, '');
    if (!cleanNum) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const url = `${VIAGGIATRENO_BASE_URL}/andamentoTreno/${originStationCode}/${cleanNum}/${departureMillis}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.fermate)) return null;

    const stops = json.fermate.map((f: any) => ({
      stationName: f.stazione || '',
      arrivalTimePlanned: f.arrivo_teorico ? formatMillisToTime(f.arrivo_teorico) : f.compOrarioArrivo,
      departureTimePlanned: f.partenza_teorica ? formatMillisToTime(f.partenza_teorica) : f.compOrarioPartenza,
      platformPlanned: f.binarioProgrammatoArrivoDescrizione || f.binarioProgrammatoPartenzaDescrizione,
      platformActual: f.binarioEffettivoArrivoDescrizione || f.binarioEffettivoPartenzaDescrizione,
    }));

    return { stops };
  } catch {
    return null;
  }
}

function formatMillisToTime(millis: number): string {
  const d = new Date(millis);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Pulisce eventuali stringhe d'orario di ViaggiaTreno che contengono markup o percorsi di icone
 * (es. "/vt_static/img/legenda/icone_legenda/regolare.png13:39" -> "13:39")
 */
export function cleanViaggiaTrenoTime(rawStr?: string | null): string | null {
  if (!rawStr) return null;
  const match = String(rawStr).match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

/**
 * Pulisce e converte i binari espressi in numeri romani (es. "IV" -> "4", "III" -> "3", "2 EST" -> "2 EST")
 * in modo da visualizzare sempre numeri arabi standard.
 */
export function cleanPlatform(raw?: string | number | null): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '--' || s === '0' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return undefined;

  // Tabella di conversione numeri romani tipici delle stazioni italiane
  const romanMap: { [key: string]: string } = {
    I: '1',
    II: '2',
    III: '3',
    IV: '4',
    V: '5',
    VI: '6',
    VII: '7',
    VIII: '8',
    IX: '9',
    X: '10',
    XI: '11',
    XII: '12',
    XIII: '13',
    XIV: '14',
    XV: '15',
    XVI: '16',
    XVII: '17',
    XVIII: '18',
    XIX: '19',
    XX: '20',
  };

  // Se è un numero romano esatto
  const upper = s.toUpperCase();
  if (romanMap[upper]) {
    return romanMap[upper];
  }

  // Se contiene prefissi/suffissi (es. "BIN. IV" o "IV OVEST")
  const converted = upper.replace(/\b([IVXLCDM]+)\b/g, (match) => romanMap[match] || match);
  return converted;
}

export interface ScheduledTrainEntry {
  trainNumber: string;
  category: 'RV' | 'REG' | 'IC';
  departureTime: string; // Orte departure
  arrivalTimeTiburtina: string; // Roma Tiburtina arrival
  arrivalTimeTermini: string; // Roma Termini arrival
  durationMinutesTiburtina: number;
  durationMinutesTermini: number;
  platformPlanned: string;
  destination: string;
}

export interface ScheduledReturnTrainEntry {
  trainNumber: string;
  category: 'RV' | 'REG' | 'IC';
  departureTimeTiburtina: string; // Roma Tiburtina departure
  departureTimeTermini?: string; // Roma Termini departure
  arrivalTimeOrte: string; // Orte arrival
  durationMinutesTiburtina: number;
  platformPlanned: string;
  destination: string;
}

export const SCHEDULED_ORTE_TO_ROMA: ScheduledTrainEntry[] = [
  { trainNumber: 'RV 4093', category: 'RV', departureTime: '05:14', arrivalTimeTiburtina: '05:48', arrivalTimeTermini: '05:58', durationMinutesTiburtina: 34, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4539', category: 'RV', departureTime: '05:42', arrivalTimeTiburtina: '06:15', arrivalTimeTermini: '06:26', durationMinutesTiburtina: 33, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 20405', category: 'REG', departureTime: '05:59', arrivalTimeTiburtina: '07:30', arrivalTimeTermini: '07:42', durationMinutesTiburtina: 91, durationMinutesTermini: 103, platformPlanned: '4', destination: 'FIUMICINO AEROPORTO' },
  { trainNumber: 'RV 4095', category: 'RV', departureTime: '06:28', arrivalTimeTiburtina: '07:03', arrivalTimeTermini: '07:18', durationMinutesTiburtina: 35, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4151', category: 'RV', departureTime: '06:34', arrivalTimeTiburtina: '07:14', arrivalTimeTermini: '07:24', durationMinutesTiburtina: 40, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4521', category: 'RV', departureTime: '07:00', arrivalTimeTiburtina: '07:33', arrivalTimeTermini: '07:48', durationMinutesTiburtina: 33, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'IC 581', category: 'IC', departureTime: '07:18', arrivalTimeTiburtina: '07:49', arrivalTimeTermini: '08:03', durationMinutesTiburtina: 31, durationMinutesTermini: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4256', category: 'RV', departureTime: '07:20', arrivalTimeTiburtina: '07:59', arrivalTimeTermini: '08:15', durationMinutesTiburtina: 39, durationMinutesTermini: 55, platformPlanned: '5', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4097', category: 'RV', departureTime: '07:28', arrivalTimeTiburtina: '08:03', arrivalTimeTermini: '08:19', durationMinutesTiburtina: 35, durationMinutesTermini: 51, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4523', category: 'RV', departureTime: '07:45', arrivalTimeTiburtina: '08:14', arrivalTimeTermini: '08:32', durationMinutesTiburtina: 29, durationMinutesTermini: 47, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4721', category: 'RV', departureTime: '08:05', arrivalTimeTiburtina: '08:39', arrivalTimeTermini: '08:57', durationMinutesTiburtina: 34, durationMinutesTermini: 52, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'IC 583', category: 'IC', departureTime: '08:34', arrivalTimeTiburtina: '09:05', arrivalTimeTermini: '09:18', durationMinutesTiburtina: 31, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'IC 533', category: 'IC', departureTime: '09:12', arrivalTimeTiburtina: '09:43', arrivalTimeTermini: '09:56', durationMinutesTiburtina: 31, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4519', category: 'REG', departureTime: '09:32', arrivalTimeTiburtina: '10:35', arrivalTimeTermini: '10:48', durationMinutesTiburtina: 63, durationMinutesTermini: 76, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4099', category: 'REG', departureTime: '09:40', arrivalTimeTiburtina: '10:49', arrivalTimeTermini: '11:02', durationMinutesTiburtina: 69, durationMinutesTermini: 82, platformPlanned: '3', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4153', category: 'RV', departureTime: '12:16', arrivalTimeTiburtina: '12:47', arrivalTimeTermini: '13:00', durationMinutesTiburtina: 31, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4725', category: 'RV', departureTime: '13:52', arrivalTimeTiburtina: '14:28', arrivalTimeTermini: '14:40', durationMinutesTiburtina: 36, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'IC 585', category: 'IC', departureTime: '15:43', arrivalTimeTiburtina: '16:14', arrivalTimeTermini: '16:27', durationMinutesTiburtina: 31, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4105', category: 'RV', departureTime: '16:11', arrivalTimeTiburtina: '16:48', arrivalTimeTermini: '17:00', durationMinutesTiburtina: 37, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4155', category: 'RV', departureTime: '17:10', arrivalTimeTiburtina: '17:46', arrivalTimeTermini: '18:00', durationMinutesTiburtina: 36, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4733', category: 'RV', departureTime: '17:56', arrivalTimeTiburtina: '18:30', arrivalTimeTermini: '18:45', durationMinutesTiburtina: 34, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4107', category: 'REG', departureTime: '18:15', arrivalTimeTiburtina: '19:35', arrivalTimeTermini: '19:48', durationMinutesTiburtina: 80, durationMinutesTermini: 93, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'IC 599', category: 'IC', departureTime: '18:27', arrivalTimeTiburtina: '19:00', arrivalTimeTermini: '19:15', durationMinutesTiburtina: 33, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4537', category: 'REG', departureTime: '19:02', arrivalTimeTiburtina: '20:10', arrivalTimeTermini: '20:25', durationMinutesTiburtina: 68, durationMinutesTermini: 83, platformPlanned: '3', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4157', category: 'RV', departureTime: '21:47', arrivalTimeTiburtina: '22:21', arrivalTimeTermini: '22:35', durationMinutesTiburtina: 34, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4111', category: 'RV', departureTime: '22:25', arrivalTimeTiburtina: '23:01', arrivalTimeTermini: '23:15', durationMinutesTiburtina: 36, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4161', category: 'RV', departureTime: '23:00', arrivalTimeTiburtina: '23:34', arrivalTimeTermini: '23:48', durationMinutesTiburtina: 34, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
];

export const SCHEDULED_ROMA_TO_ORTE: ScheduledReturnTrainEntry[] = [
  { trainNumber: 'RV 4150', category: 'RV', departureTimeTiburtina: '05:55', arrivalTimeOrte: '06:32', durationMinutesTiburtina: 37, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'RV 4712', category: 'RV', departureTimeTiburtina: '06:53', arrivalTimeOrte: '07:36', durationMinutesTiburtina: 43, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'IC 534', category: 'IC', departureTimeTiburtina: '08:00', arrivalTimeOrte: '08:31', durationMinutesTiburtina: 31, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4152', category: 'RV', departureTimeTiburtina: '09:33', arrivalTimeOrte: '10:11', durationMinutesTiburtina: 38, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'IC 584', category: 'IC', departureTimeTiburtina: '10:00', arrivalTimeOrte: '10:31', durationMinutesTiburtina: 31, platformPlanned: '6', destination: 'TRIESTE CENTRALE' },
  { trainNumber: 'IC 588', category: 'IC', departureTimeTiburtina: '10:38', arrivalTimeOrte: '11:10', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4100', category: 'RV', departureTimeTiburtina: '11:08', arrivalTimeOrte: '11:47', durationMinutesTiburtina: 39, platformPlanned: '2', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 20635', category: 'REG', departureTimeTiburtina: '11:46', arrivalTimeOrte: '13:17', durationMinutesTiburtina: 91, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'REG 4512', category: 'REG', departureTimeTiburtina: '11:53', arrivalTimeOrte: '13:04', durationMinutesTiburtina: 71, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'IC 590', category: 'IC', departureTimeTiburtina: '12:12', arrivalTimeOrte: '12:44', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'MILANO CENTRALE' },
  { trainNumber: 'REG 20643', category: 'REG', departureTimeTiburtina: '12:46', arrivalTimeOrte: '14:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4154', category: 'RV', departureTimeTiburtina: '13:29', arrivalTimeOrte: '14:03', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'REG 20653', category: 'REG', departureTimeTiburtina: '13:46', arrivalTimeOrte: '15:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4730', category: 'RV', departureTimeTiburtina: '14:28', arrivalTimeOrte: '15:07', durationMinutesTiburtina: 39, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'REG 20665', category: 'REG', departureTimeTiburtina: '14:46', arrivalTimeOrte: '16:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'IC 540', category: 'IC', departureTimeTiburtina: '15:38', arrivalTimeOrte: '16:10', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'REG 20677', category: 'REG', departureTimeTiburtina: '16:01', arrivalTimeOrte: '17:25', durationMinutesTiburtina: 84, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4156', category: 'RV', departureTimeTiburtina: '16:03', arrivalTimeOrte: '16:42', durationMinutesTiburtina: 39, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'REG 20683', category: 'REG', departureTimeTiburtina: '16:46', arrivalTimeOrte: '18:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4514', category: 'RV', departureTimeTiburtina: '17:09', arrivalTimeOrte: '17:45', durationMinutesTiburtina: 36, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'RV 4106', category: 'RV', departureTimeTiburtina: '17:30', departureTimeTermini: '17:20', arrivalTimeOrte: '18:02', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4530', category: 'REG', departureTimeTiburtina: '17:37', arrivalTimeOrte: '18:53', durationMinutesTiburtina: 76, platformPlanned: '6', destination: 'VITERBO P. FIORENTINA' },
  { trainNumber: 'REG 20693', category: 'REG', departureTimeTiburtina: '17:46', arrivalTimeOrte: '19:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4732', category: 'RV', departureTimeTiburtina: '18:10', arrivalTimeOrte: '18:45', durationMinutesTiburtina: 35, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'IC 598', category: 'IC', departureTimeTiburtina: '18:28', arrivalTimeOrte: '19:00', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'MILANO CENTRALE' },
  { trainNumber: 'RV 4158', category: 'RV', departureTimeTiburtina: '18:41', arrivalTimeOrte: '19:15', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4734', category: 'RV', departureTimeTiburtina: '19:12', arrivalTimeOrte: '19:44', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'RV 4534', category: 'RV', departureTimeTiburtina: '19:20', arrivalTimeOrte: '19:58', durationMinutesTiburtina: 38, platformPlanned: '6', destination: 'VITERBO P. FIORENTINA' },
  { trainNumber: 'IC 592', category: 'IC', departureTimeTiburtina: '19:40', arrivalTimeOrte: '20:12', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'TRIESTE CENTRALE' },
  { trainNumber: 'RV 4110', category: 'RV', departureTimeTiburtina: '20:29', departureTimeTermini: '20:21', arrivalTimeOrte: '20:56', durationMinutesTiburtina: 27, platformPlanned: '6', destination: 'FIRENZE SMN' },
  { trainNumber: 'RV 4262', category: 'RV', departureTimeTiburtina: '20:32', arrivalTimeOrte: '21:15', durationMinutesTiburtina: 43, platformPlanned: '17', destination: 'RIETI' },
  { trainNumber: 'RV 4160', category: 'RV', departureTimeTiburtina: '21:25', arrivalTimeOrte: '22:00', durationMinutesTiburtina: 35, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4108', category: 'RV', departureTimeTiburtina: '22:00', arrivalTimeOrte: '22:34', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'CHIUSI-CHIANCIANO' },
  { trainNumber: 'RV 4538', category: 'RV', departureTimeTiburtina: '23:00', arrivalTimeOrte: '23:36', durationMinutesTiburtina: 36, platformPlanned: '6', destination: 'TERNI' },
];

export interface OptimalTrainOptions {
  direction: 'outbound' | 'return';
  departureStation: StationInfo;
  arrivalStation: StationInfo;
  targetTimeStr: string; // Outbound: arrivo desiderato (es. "12:30"). Return: partenza desiderata (es. "13:30").
  targetDate?: Date;
  trainOffset?: number; // 0 = consigliato, -1 = precedente, +1 = successivo
  selectedTrainNumber?: string; // override selezione esplicita treno
  forceRefresh?: boolean; // true per forzare chiamata diretta a Trenitalia bypassando la cache
  minDepartureMins?: number; // Orario minimo (in minuti da mezzanotte) di partenza del treno affinché sia prendibile dal viaggiatore
  ignoreCurrentTime?: boolean; // true per usare esclusivamente l'orario programmato ufficiale senza ritardi live né filtro sull'ora corrente
  includeIntercity?: boolean; // Se true, include anche i treni Intercity (IC) oltre a RV e Regionali
  preferredDepartureTime?: string; // Treno preferito dall'utente, individuato dall'orario di partenza (HH:MM)
  scheduledOnly?: boolean; // true per preferire il timetable GTFS programmato evitando chiamate ViaggiaTreno quando possibile (con fallback automatico se vuoto)
}

export interface OptimalTrainResult {
  train: LiveTrainInfo;
  availableTrains: LiveTrainInfo[];
  selectedIndex: number;
  recommendedIndex: number;
}

/**
 * Recupera tutte le possibili corse (origine e data/orario partenza) per un numero treno tramite ViaggiaTreno.
 * Gestisce i numeri treno duplicati su reti diverse (es. 4731 Milano vs 4731 Perugia) usando l'endpoint autocomplete.
 */
async function getTrainOriginCandidates(
  trainNum: string
): Promise<{ originCode: string; departureMillis?: number }[]> {
  const cleanNum = trainNum.replace(/\D/g, '');
  if (!cleanNum) return [];
  const originKey = cleanNum + '_' + new Date().toDateString();
  const hit = trainOriginInfoCache.get(originKey);
  if (hit && hit.length > 0) return hit;

  const existing = originInfoInFlight.get(originKey);
  if (existing) return existing;

  const task = (async (): Promise<{ originCode: string; departureMillis?: number }[]> => {
    const candidates: { originCode: string; departureMillis?: number }[] = [];
    const seenOrigins = new Set<string>();
    const addCandidate = (originCode?: string | null, departureMillis?: number) => {
      const code = (originCode || '').trim().toUpperCase();
      if (!code || seenOrigins.has(code)) return;
      seenOrigins.add(code);
      candidates.push({
        originCode: code,
        departureMillis:
          typeof departureMillis === 'number' && !Number.isNaN(departureMillis) && departureMillis > 0
            ? departureMillis
            : undefined,
      });
    };

    try {
      const autoText = await fetchViaggiaTrenoRawText(
        `${VIAGGIATRENO_BASE_URL}/cercaNumeroTrenoTrenoAutocomplete/${cleanNum}`,
        2800,
        0
      );
      if (autoText) {
        fetchOk++;
        const lines = autoText.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const barParts = line.split('|');
          if (barParts.length < 2) continue;
          const rhs = barParts[barParts.length - 1].trim();
          const tokens = rhs.split('-').map((t) => t.trim()).filter(Boolean);
          if (tokens.length < 2) continue;
          const candNum = tokens[0].replace(/\D/g, '');
          if (candNum !== cleanNum) continue;
          const lastToken = tokens[tokens.length - 1];
          const hasMillis = tokens.length >= 3 && /^\d{10,}$/.test(lastToken);
          const origCode = hasMillis ? tokens.slice(1, -1).join('-') : tokens.slice(1).join('-');
          const depMillis = hasMillis ? Number(lastToken) : undefined;
          addCandidate(origCode, depMillis);
        }
      }
    } catch {}

    if (candidates.length === 0) {
      try {
        const data = await fetchViaggiaTrenoJson(
          `${VIAGGIATRENO_BASE_URL}/cercaNumeroTreno/${cleanNum}`,
          2500,
          0
        );
        if (data && data.codLocOrig) {
          addCandidate(
            data.codLocOrig as string,
            data.millisDataPartenza ? Number(data.millisDataPartenza) : undefined
          );
        }
      } catch {}
    }

    if (candidates.length > 0) {
      trainOriginInfoCache.set(originKey, candidates);
    }
    return candidates;
  })().finally(() => {
    originInfoInFlight.delete(originKey);
  });

  originInfoInFlight.set(originKey, task);
  return task;
}

/**
 * Interroga ViaggiaTreno API in tempo reale per ottenere tutti i treni regionali
 * effettivi in circolazione o programmati tra due stazioni per qualsiasi data/orario.
 * Utilizza cache in memoria dinamica (45s live, 10m futuro) e 8 chiamate concorrenti.
 */
export async function fetchLiveTrenitaliaTimetable(
  depCode: string,
  arrCode: string,
  targetDate: Date,
  targetTimeStr: string,
  direction: 'outbound' | 'return',
  forceRefresh = false,
  ignoreCurrentTime = false,
  includeIntercity = false
): Promise<LiveTrainInfo[]> {
  try {
    const isToday =
      !ignoreCurrentTime &&
      targetDate.getDate() === new Date().getDate() &&
      targetDate.getMonth() === new Date().getMonth() &&
      targetDate.getFullYear() === new Date().getFullYear();

    const targetMins = parseTimeToMinutes(targetTimeStr);
    let targetDepMins =
      direction === 'outbound'
        ? Math.max(0, targetMins - 60)
        : targetMins;

    // Se è oggi e l'orario richiesto è già trascorso, ancorare la ricerca su adesso (now - 30m)
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (isToday && targetDepMins < nowMins - 30) {
      targetDepMins = Math.max(0, nowMins - 30);
    }

    // Verifica Cache in Memoria ad alte prestazioni (con riuso finestra oraria già coperta su stessa giornata)
    const dateKey = `${targetDate.getFullYear()}-${targetDate.getMonth() + 1}-${targetDate.getDate()}`;
    const timeBucket = Math.floor(targetDepMins / 30);
    const baseCacheKey = `${depCode}_${arrCode}_${dateKey}_${ignoreCurrentTime ? 'sched' : 'live'}_${includeIntercity ? 'ic' : 'noic'}`;
    const cacheKey = `${baseCacheKey}_${timeBucket}_${direction}`;
    const cacheTtl = isToday ? 45000 : 600000; // 45s oggi per ritardi live, 10m per giorni futuri
    const needStartMins = Math.max(0, targetDepMins - 60);
    const needEndMins = Math.min(1439, targetDepMins + 120);

    if (!forceRefresh) {
      const cached = timetableCache.get(cacheKey);
      if (cached && cached.trains.length > 0 && Date.now() - cached.timestamp < cacheTtl) {
        return cached.trains;
      }

      for (const entry of timetableCache.values()) {
        if (
          entry.baseKey === baseCacheKey &&
          entry.isToday === isToday &&
          entry.trains.length > 0 &&
          Date.now() - entry.timestamp < cacheTtl &&
          needStartMins >= entry.coveredStartMins &&
          needEndMins <= entry.coveredEndMins
        ) {
          return entry.trains;
        }
      }

      const inFlight = timetableInFlight.get(cacheKey);
      if (inFlight) return inFlight;
    }

    const depDateIso = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    const fetchTask = (async (): Promise<LiveTrainInfo[]> => {

    // Finestre di campionamento calibrate per la massima copertura con il minimo numero di richieste:
    // -90m: copre treni partiti fino a 1h30 fa ancora in viaggio verso destinazione
    // -30m, +45m, +135m, +225m: sequenza continua con sovrapposizione
    const depOffsets = [-90, -30, 45, 135, 225];
    const arrOffsets = [-30, 30, 105, 195, 285];

    const buildTimes = (offsets: number[]) =>
      offsets.map((off) => {
        const d = new Date(targetDate);
        const m = Math.max(0, Math.min(1439, targetDepMins + off));
        d.setHours(Math.floor(m / 60), m % 60, 0, 0);
        return d;
      });

    const depTimes = buildTimes(depOffsets);
    const arrTimes = buildTimes(arrOffsets);

    fetchOk = 0;
    fetchTotal = 0;
    lastFetchError = '';

    const allLists = await runLimited<any | null>([
      ...depTimes.map(
        (d) => () =>
          fetchViaggiaTrenoJson(
            `${VIAGGIATRENO_BASE_URL}/partenze/${depCode}/${encodeURIComponent(formatViaggiaTrenoDate(d))}`
          )
      ),
      ...arrTimes.map(
        (d) => () =>
          fetchViaggiaTrenoJson(
            `${VIAGGIATRENO_BASE_URL}/arrivi/${arrCode}/${encodeURIComponent(formatViaggiaTrenoDate(d))}`
          )
      ),
    ]);
    const depLists = allLists.slice(0, depTimes.length);
    const arrLists = allLists.slice(depTimes.length);

    const depMap = new Map<string, any[]>();
    for (const list of depLists) {
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t.numeroTreno) {
            const numKey = String(t.numeroTreno);
            const origKey = String(t.codOrigine || t.idOrigine || '').trim().toUpperCase();
            const entries = depMap.get(numKey) || [];
            const dupIdx = entries.findIndex(
              (e) =>
                String(e.codOrigine || e.idOrigine || '').trim().toUpperCase() === origKey &&
                e.compOrarioPartenza === t.compOrarioPartenza
            );
            if (dupIdx >= 0) {
              entries[dupIdx] = t;
            } else {
              entries.push(t);
            }
            depMap.set(numKey, entries);
            const rawPlat = cleanPlatform(
              t.binarioProgrammatoPartenzaDescrizione || t.binarioProgrammatoPartenzaCodice || undefined
            );
            if (rawPlat) {
              stationTrainPlatformIndex.set(`${depCode}_${numKey}_${depDateIso}`, rawPlat);
            }
          }
        }
      }
    }

    const arrMap = new Map<string, any[]>();
    for (const list of arrLists) {
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t.numeroTreno) {
            const numKey = String(t.numeroTreno);
            const origKey = String(t.codOrigine || t.idOrigine || '').trim().toUpperCase();
            const entries = arrMap.get(numKey) || [];
            const dupIdx = entries.findIndex(
              (e) =>
                String(e.codOrigine || e.idOrigine || '').trim().toUpperCase() === origKey &&
                e.compOrarioArrivo === t.compOrarioArrivo
            );
            if (dupIdx >= 0) {
              entries[dupIdx] = t;
            } else {
              entries.push(t);
            }
            arrMap.set(numKey, entries);
          }
        }
      }
    }

    const trains: LiveTrainInfo[] = [];
    const matchedNumbers = new Set<string>();
    const matchedTrainKeys = new Set<string>();

    for (const [num, depEntries] of depMap) {
      for (const dep of depEntries) {
      const catRaw = (dep.categoriaDescrizione || dep.categoria || '').toUpperCase();
      const isIntercity =
        catRaw.includes('IC') ||
        catRaw.includes('INTERCITY') ||
        catRaw === 'ICN';
      const isRegional =
        catRaw.includes('REG') ||
        catRaw.includes('RV') ||
        catRaw === 'R' ||
        catRaw.includes('REGIONALE');

      const isAllowed = isRegional || (includeIntercity && isIntercity);
      if (!isAllowed) continue;
      if (!ignoreCurrentTime && (dep.provvedimento === 1 || dep.statoTreno === 'SOPPRESSO')) continue;

      const arrEntries = arrMap.get(num);
      if (!arrEntries || arrEntries.length === 0) continue;

      const depOrig = String(dep.codOrigine || dep.idOrigine || '').trim().toUpperCase();
      const depPlanStr = dep.compOrarioPartenza;
      if (!depPlanStr) continue;
      const depPlanRefM = parseTimeToMinutes(depPlanStr);

      const arr = arrEntries.find((candidateArr) => {
        const arrOrig = String(candidateArr.codOrigine || candidateArr.idOrigine || '').trim().toUpperCase();
        if (depOrig && arrOrig && depOrig !== arrOrig) return false;
        if (!candidateArr.compOrarioArrivo) return false;
        const [cdh, cdm] = depPlanStr.split(':').map(Number);
        const [cah, cam] = candidateArr.compOrarioArrivo.split(':').map(Number);
        let cdur = cah * 60 + cam - (cdh * 60 + cdm);
        if (cdur < 0) cdur += 1440;
        if (cdur < 2 || cdur > 900) return false;
        return Math.abs(parseTimeToMinutes(depPlanStr) - depPlanRefM) === 0;
      });
      if (!arr) continue;

      const depPlanned = dep.compOrarioPartenza;
      const arrPlanned = arr.compOrarioArrivo;
      if (!depPlanned || !arrPlanned) continue;

      const depPlannedM = parseTimeToMinutes(depPlanned);
      // FILTRO N.D. TRENITALIA:
      // Se l'orario di partenza è già passato e Trenitalia non ha dati live né su partenza né su arrivo
      // (nessun ritardo né orario effettivo e non è al binario): il treno è N.D. e viene scartato.
      // Se invece ha dati live sull'arrivo a destinazione (è partito ed è in viaggio), non è N.D.!
      const hasLiveArrival =
        typeof arr.ritardo === 'number' ||
        Boolean(cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo));
      const hasLiveDeparture =
        typeof dep.ritardo === 'number' ||
        Boolean(cleanViaggiaTrenoTime(dep.compOrarioEffettivoPartenza));
      const isND =
        isToday &&
        nowMins > depPlannedM &&
        !hasLiveDeparture &&
        !hasLiveArrival &&
        dep.inStazione !== true;
      if (isND) continue;

      const [dh, dm] = depPlanned.split(':').map(Number);
      const [ah, am] = arrPlanned.split(':').map(Number);
      let dur = ah * 60 + am - (dh * 60 + dm);
      if (dur < 0) dur += 1440;

      // Durata ragionevole tra stazioni nella stessa direzione (tra 2 min e 15 ore)
      if (dur < 2 || dur > 900) continue;

      // Ritardo reale: preferisce quello alla partenza, altrimenti quello riportato sull'arrivo
      const liveDelay =
        typeof dep.ritardo === 'number'
          ? dep.ritardo
          : typeof arr.ritardo === 'number'
            ? arr.ritardo
            : 0;
      const delay = isToday ? liveDelay : 0;

      const isOriginStation = Boolean(
        dep.codOrigine === depCode ||
        dep.idOrigine === depCode ||
        (typeof dep.origine === 'string' && dep.origine.trim().length === 0)
      );

      let cleanLiveDep = cleanViaggiaTrenoTime(dep.compOrarioEffettivoPartenza);
      if (isOriginStation) {
        if (!cleanLiveDep) {
          cleanLiveDep = cleanViaggiaTrenoTime(dep.compOrarioPartenzaZeroEffettivo);
        }
        if (!cleanLiveDep && typeof dep.partenzaTreno === 'number' && dep.partenzaTreno > 0) {
          const pDate = new Date(dep.partenzaTreno);
          cleanLiveDep = `${String(pDate.getHours()).padStart(2, '0')}:${String(pDate.getMinutes()).padStart(2, '0')}`;
        }
      }

      let depActual = depPlanned;
      if (isToday && cleanLiveDep && parseTimeToMinutes(cleanLiveDep) >= parseTimeToMinutes(depPlanned)) {
        depActual = cleanLiveDep;
      } else if (delay > 0) {
        depActual = minutesToTime(dh * 60 + dm + delay);
      }

      let arrActual = arrPlanned;
      const cleanLiveArr = cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo);
      if (isToday && cleanLiveArr && parseTimeToMinutes(cleanLiveArr) >= parseTimeToMinutes(arrPlanned)) {
        arrActual = cleanLiveArr;
      } else if (delay > 0) {
        arrActual = minutesToTime(ah * 60 + am + delay);
      }

      const isPartitoAtStation =
        Array.isArray(dep.compInStazionePartenza) &&
        Boolean(dep.compInStazionePartenza[0]?.toLowerCase().includes('partito'));

      const hasAnyLiveBoardSignal = Boolean(
        isPartitoAtStation ||
        dep.inStazione === true ||
        hasLiveDeparture ||
        hasLiveArrival
      );

      // In ViaggiaTreno, nonPartito: true indica che il treno NON è ancora partito dall'origine generale.
      // partenzaTreno può contenere l'epoch programmato anche prima della partenza: non va usato per marcare isDeparted.
      const explicitlyNotDeparted =
        dep.nonPartito === true &&
        !isPartitoAtStation &&
        dep.inStazione !== true &&
        !cleanLiveDep;

      const isDeparted = explicitlyNotDeparted
        ? false
        : Boolean(
            isPartitoAtStation ||
            dep.inStazione === true ||
            (dep.nonPartito === false && hasAnyLiveBoardSignal)
          );

      const isOriginDepartureDelay = Boolean(
        isToday &&
        !isPartitoAtStation &&
        dep.nonPartito === true &&
        nowMins >= parseTimeToMinutes(depPlanned) &&
        nowMins - parseTimeToMinutes(depPlanned) <= 120
      );

      const isInStationAtDep = Boolean(
        isToday &&
        !isPartitoAtStation &&
        (dep.inStazione === true ||
          isOriginDepartureDelay ||
          (Array.isArray(dep.compInStazionePartenza) &&
            Boolean(dep.compInStazionePartenza[0]?.toLowerCase().includes('stazione'))))
      );

      const depMinsActual = parseTimeToMinutes(depActual);
      // Un treno è passato/partito da questa stazione:
      // - NON può essere già passato se è attualmente in stazione (isInStationAtDep === true)!
      // - se ha origine qui: se è partito dalla stazione
      // - se è passante: se è partito dall'origine E non è in stazione E l'orario effettivo di passaggio da qui è già trascorso!
      const isDepartedFromStation = Boolean(
        isToday &&
        !isInStationAtDep && (
          isOriginStation
            ? (isPartitoAtStation || (dep.nonPartito === false && cleanLiveDep && nowMins > depMinsActual))
            : (isPartitoAtStation || (isDeparted && nowMins > depMinsActual && dep.inStazione !== true))
        )
      );

      let departureDelayAtStation: number | undefined = undefined;
      if (isDepartedFromStation) {
        if (cleanLiveDep) {
          depActual = cleanLiveDep;
          departureDelayAtStation = Math.max(0, parseTimeToMinutes(cleanLiveDep) - parseTimeToMinutes(depPlanned));
        } else {
          // Se è già passato e non abbiamo un orario di partenza effettivo esplicito al tabellone,
          // non applichiamo il ritardo globale maturato a valle alla partenza già avvenuta
          depActual = depPlanned;
          departureDelayAtStation = 0;
        }
      }

      let isStoppedInStation = isInStationAtDep;
      let stoppedStationName = isInStationAtDep ? formatStationName(getStationNameByCode(depCode)) : undefined;
      const depPlanM = parseTimeToMinutes(depPlanned);
      const estimatedDepM = Math.max(
        depPlanM + Math.max(0, delay),
        cleanLiveDep ? parseTimeToMinutes(cleanLiveDep) : 0
      );
      let stoppedStationEstimatedDep = isStoppedInStation ? minutesToTime(estimatedDepM) : undefined;

      // Se il treno è fermo in stazione alla partenza:
      // il ritardo segue sempre il programma (depPlanned)
      let effectiveDelay = delay;
      let stoppedMinutes: number | undefined = undefined;
      if (isStoppedInStation) {
        if (nowMins > depPlanM) {
          const lateAccumulated = nowMins - depPlanM;
          stoppedMinutes = Math.max(1, lateAccumulated);
          effectiveDelay = Math.max(delay, lateAccumulated);
          depActual = minutesToTime(depPlanM + effectiveDelay);
          arrActual = minutesToTime(parseTimeToMinutes(arrPlanned) + effectiveDelay);
        } else if (delay <= 0) {
          // Fermo al binario prima dell'orario di partenza e senza ritardo pregresso: partenza in orario!
          depActual = depPlanned;
          effectiveDelay = 0;
        }
      }

      let statusDescription = 'In orario';
      if (isToday) {
        if (dep.provvedimento === 1 || dep.statoTreno === 'SOPPRESSO') {
          statusDescription = 'Soppresso';
        } else if (dep.provvedimento === 3 || dep.statoTreno === 'DEVIATO') {
          statusDescription = 'Deviato';
        } else if (isStoppedInStation) {
          if (isOriginDepartureDelay) {
            statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
          } else if (nowMins > estimatedDepM) {
            const durationStr = stoppedMinutes ? ` (da ${stoppedMinutes} min)` : '';
            statusDescription = effectiveDelay > 0 ? `Fermo a ${stoppedStationName}${durationStr}` : `Fermo a ${stoppedStationName}`;
          } else if (effectiveDelay > 0) {
            statusDescription = `Ritardo di ${effectiveDelay} min`;
          } else {
            statusDescription = isOriginStation || !isDeparted || nowMins < depPlanM ? 'Non partito' : 'In orario';
          }
        } else if (isDepartedFromStation) {
          statusDescription = 'In viaggio';
        } else if (isOriginDepartureDelay) {
          statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
        } else if (effectiveDelay > 0) {
          statusDescription = `Ritardo di ${effectiveDelay} min`;
        } else if (effectiveDelay < 0) {
          statusDescription = `Anticipo di ${Math.abs(effectiveDelay)} min`;
        } else {
          statusDescription = isOriginStation || !isDeparted || nowMins < depPlanM ? 'Non partito' : 'In orario';
        }
      } else {
        statusDescription = 'Non partito';
      }

      let alertMessage: string | undefined = undefined;
      const rawNotice = (dep.segnalazioni || dep.subTitle || dep.avviso || '').trim();
      const delayReason = (dep.motivoRitardoPrevalente || '').trim();
      if (rawNotice) {
        alertMessage = rawNotice;
      } else if (delayReason) {
        alertMessage = `Causa ritardo: ${delayReason}`;
      } else if (dep.provvedimento === 3 || dep.statoTreno === 'DEVIATO') {
        alertMessage = 'Treno deviato su percorso alternativo da Trenitalia';
      }

      let capacityWarning: string | undefined = undefined;
      const isNotPurchasable =
        Boolean(dep.nonAcquistabile || dep.bigliettiNonAcquistabili) ||
        (typeof rawNotice === 'string' &&
          /biglietti\s+non\s+acquistabili|posti\s+esauriti/i.test(rawNotice));

      if (isNotPurchasable) {
        capacityWarning = 'Biglietti non acquistabili (Disponibilità posti limitata)';
      }

      const isFast = !isIntercity && (catRaw.includes('RV') || catRaw.includes('VELOCE') || dur <= 45);
      let trainNumber = dep.compNumeroTreno;
      if (!trainNumber) {
        trainNumber = isIntercity ? `IC ${num}` : (isFast ? `RV ${num}` : `REG ${num}`);
      } else if (isIntercity) {
        if (!/^IC\b/i.test(trainNumber)) {
          trainNumber = `IC ${num}`;
        }
      } else if (isFast) {
        trainNumber = trainNumber.replace(/^REG\b/i, 'RV');
      }

      const platformPlanned =
        dep.binarioProgrammatoPartenzaDescrizione ||
        dep.binarioProgrammatoPartenzaCodice ||
        undefined;
      const platformActual =
        dep.binarioEffettivoPartenzaDescrizione ||
        dep.binarioEffettivoPartenzaCodice ||
        undefined;

      const rawOrigin =
        (arr.origine && arr.origine.trim().length > 0)
          ? arr.origine
          : (dep.origine && dep.origine.trim().length > 0)
          ? dep.origine
          : undefined;

      const codeOrigin = getStationNameByCode(dep.codOrigine || dep.idOrigine || arr.codOrigine || arr.idOrigine);

      const resolvedOriginName =
        rawOrigin
          ? formatStationName(rawOrigin)
          : isOriginStation
          ? getStationNameByCode(depCode)
          : (codeOrigin || getStationNameByCode(depCode));

      trains.push({
        trainNumber,
        category: isIntercity ? 'IC' : (isFast ? 'RV' : 'REG'),
        destination: dep.destinazione ? formatStationName(dep.destinazione) : '',
        originStationName: resolvedOriginName,
        originStationCode: dep.codOrigine || dep.idOrigine || depCode || undefined,
        departureTimePlanned: depPlanned,
        departureTimeActual: depActual,
        departureMillis: dep.orarioPartenza || targetDate.getTime(),
        arrivalTimePlanned: arrPlanned,
        arrivalTimeActual: arrActual,
        platformPlanned: cleanPlatform(platformPlanned),
        platformActual: cleanPlatform(platformActual),
        delayMinutes: effectiveDelay,
        statusDescription,
        isLive: true,
        durationMinutes: dur,
        isFast,
        isOriginStation,
        isDeparted,
        isDepartedFromStation,
        departureDelayAtStation,
        isStoppedInStation,
        stoppedStationName,
        stoppedStationEstimatedDep,
        stoppedMinutes,
        alertMessage,
        capacityWarning,
        notPurchasable: isNotPurchasable,
      });

      matchedNumbers.add(String(num).replace(/\D/g, ''));
      matchedTrainKeys.add(
        `${String(num).replace(/\D/g, '')}_${String(dep.codOrigine || dep.idOrigine || '').trim().toUpperCase()}`
      );
      }
    }

    // RECUPERO TRENI GIÀ PARTITI DALLA STAZIONE DI PARTENZA MA ANCORA IN VIAGGIO VERSO DESTINAZIONE:
    // Quando un treno lascia la stazione di partenza da oltre 10-15 minuti, ViaggiaTreno lo rimuove
    // dall'endpoint /partenze. Tuttavia, il treno è ancora presente nell'endpoint /arrivi della stazione
    // di arrivo (arrMap) con ritardo reale e orario effettivo.
    // Recupero dinamico e verificato al 100% per qualsiasi tratta senza dipendenza da orari statici:
    if (isToday) {
      // RECUPERO DINAMICO E VERIFICATO DA arrMap:
      // Solo convogli regionali/RV/IC non ancora abbinati che transitano REALMENTE per depCode e arrCode.
      // Si verifica la fermata tramite origine corsa o andamentoTreno in tempo reale per la data odierna.
      const unverifiedCandidates: { numStr: string; arr: any; origCode: string; datePart: number }[] = [];

      for (const [numStr, arrEntries] of arrMap) {
        for (const arr of arrEntries) {
        const cleanNumStr = String(numStr).replace(/\D/g, '');
        const candOrig = String(arr.codOrigine || arr.idOrigine || '').trim().toUpperCase();
        if (
          matchedNumbers.has(cleanNumStr) &&
          (!candOrig || matchedTrainKeys.has(`${cleanNumStr}_${candOrig}`))
        ) {
          continue;
        }
        if (arr.provvedimento === 1 || arr.statoTreno === 'SOPPRESSO') continue;

        const catRaw = (arr.categoriaDescrizione || arr.categoria || '').toUpperCase();
        const isIntercity =
          catRaw.includes('IC') ||
          catRaw.includes('INTERCITY') ||
          catRaw === 'ICN';
        const isRegional =
          catRaw.includes('REG') ||
          catRaw.includes('RV') ||
          catRaw === 'R' ||
          catRaw.includes('REGIONALE');
        const isAllowed = isRegional || (includeIntercity && isIntercity);
        if (!isAllowed) continue;

        const arrPlanned = arr.compOrarioArrivo;
        if (!arrPlanned) continue;
        const arrPlannedM = parseTimeToMinutes(arrPlanned);

        // Filtra solo treni che arrivano entro una finestra plausibile rispetto all'orario attuale / target
        if (arrPlannedM < Math.max(0, nowMins - 90) || arrPlannedM > Math.min(1439, targetDepMins + 240)) {
          continue;
        }

        const origCode = arr.codOrigine || arr.idOrigine || '';
        const datePart = arr.dataPartenzaTreno || targetDate.getTime();
        unverifiedCandidates.push({ numStr: cleanNumStr, arr, origCode, datePart });
        }
      }

        // Se ci sono candidati, verifichiamo il loro percorso reale con andamentoTreno in parallelo
        if (unverifiedCandidates.length > 0) {
          const depStationObj = { code: depCode, name: getStationNameByCode(depCode) || '' };
          const arrStationObj = { code: arrCode, name: getStationNameByCode(arrCode) || '' };

          // Limitiamo a max 8 candidati per non sovraccaricare la rete
          const toVerify = unverifiedCandidates.slice(0, 8);

          await Promise.all(
            toVerify.map(async ({ numStr, arr, origCode, datePart }) => {
              try {
                const candidateOrigins: { originCode: string; departureMillis?: number }[] = [];
                if (origCode) {
                  candidateOrigins.push({ originCode: origCode.trim().toUpperCase(), departureMillis: datePart });
                } else {
                  const autoCands = await getTrainOriginCandidates(numStr);
                  candidateOrigins.push(...autoCands);
                }
                if (candidateOrigins.length === 0) return;

                let aData: any = null;
                let routeMatch: { depStop: any; arrStop: any; depIdx: number; arrIdx: number } | null = null;
                let resolvedOrigCode = '';
                let resolvedDatePart = datePart;

                for (const cand of candidateOrigins) {
                  const candDate = cand.departureMillis || datePart;
                  const url = `${VIAGGIATRENO_BASE_URL}/andamentoTreno/${cand.originCode}/${numStr}/${candDate}`;
                  const fetched = await fetchViaggiaTrenoJson(url, 2500);
                  if (!fetched || !Array.isArray(fetched.fermate) || fetched.fermate.length === 0) continue;
                  upsertAndamentoCacheEntry(numStr, cand.originCode, fetched);
                  const matched = findOrderedRouteStopsInAndamento(fetched, depStationObj, arrStationObj);
                  if (matched) {
                    aData = fetched;
                    routeMatch = matched;
                    resolvedOrigCode = cand.originCode;
                    resolvedDatePart = candDate;
                    break;
                  }
                }

                // Deve fermare sia alla stazione di salita che a quella di discesa, nell'ordine esatto
                if (!aData || !routeMatch) {
                  return;
                }
                const { depStop, arrStop } = routeMatch;

                const depPlan = extractStopPlannedTime(depStop, 'dep');
                const arrPlan = extractStopPlannedTime(arrStop, 'arr');
                const depPlanned = depPlan.timeStr || '';
                const arrPlanned =
                  cleanViaggiaTrenoTime(arr.compOrarioArrivo) || arrPlan.timeStr || '';
                if (!depPlanned || !arrPlanned) return;

                const arrPlannedM = parseTimeToMinutes(arrPlanned);
                const depPlannedM = parseTimeToMinutes(depPlanned);
                const rawDelay =
                  typeof aData.ritardo === 'number'
                    ? aData.ritardo
                    : typeof arr.ritardo === 'number'
                    ? arr.ritardo
                    : 0;
                const cleanLiveArr = cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo);
                const dur = Math.max(15, arrPlannedM - depPlannedM);
                const catRaw = (
                  arr.categoriaDescrizione ||
                  arr.categoria ||
                  aData.categoria ||
                  ''
                ).toUpperCase();
                const isIntercity =
                  catRaw.includes('IC') ||
                  catRaw.includes('INTERCITY') ||
                  catRaw === 'ICN';
                const isFast =
                  !isIntercity && (catRaw.includes('RV') || catRaw.includes('VELOCE'));
                const numInt = arr.numeroTreno || numStr;
                const trainNumber = isIntercity
                  ? `IC ${numInt}`
                  : isFast
                  ? `RV ${numInt}`
                  : `REG ${numInt}`;

                const rawOrigin = arr.origine || aData.origine;
                const resolvedOriginName = rawOrigin
                  ? formatStationName(rawOrigin)
                  : getStationNameByCode(resolvedOrigCode);

                const recoveredTrain: LiveTrainInfo = {
                  trainNumber,
                  category: isIntercity ? 'IC' : isFast ? 'RV' : 'REG',
                  destination: arr.destinazione
                    ? formatStationName(arr.destinazione)
                    : aData.destinazione
                    ? formatStationName(aData.destinazione)
                    : '',
                  originStationName: resolvedOriginName,
                  originStationCode: resolvedOrigCode,
                  departureTimePlanned: depPlanned,
                  departureTimeActual: depPlanned,
                  departureMillis: resolvedDatePart,
                  arrivalTimePlanned: arrPlanned,
                  arrivalTimeActual:
                    cleanLiveArr || minutesToTime(arrPlannedM + Math.max(0, rawDelay)),
                  delayMinutes: rawDelay,
                  statusDescription: 'In orario',
                  isLive: true,
                  durationMinutes: dur,
                  isFast,
                  isOriginStation: resolvedOrigCode === depCode,
                  isDeparted: Boolean(
                    arr.nonPartito === false || arr.inStazione === true || arr.arrivato === true
                  ),
                  isDepartedFromStation: false,
                  isStoppedInStation: false,
                };

                applyAndamentoToTrain(
                  recoveredTrain,
                  aData,
                  { code: depCode, name: getStationNameByCode(depCode) || '' },
                  { code: arrCode, name: getStationNameByCode(arrCode) || '' }
                );
                if (recoveredTrain.departureTimePlanned && recoveredTrain.arrivalTimePlanned) {
                  const refDepM = parseTimeToMinutes(recoveredTrain.departureTimePlanned);
                  const refArrM = parseTimeToMinutes(recoveredTrain.arrivalTimePlanned);
                  if (refArrM > refDepM) {
                    recoveredTrain.durationMinutes = Math.max(15, refArrM - refDepM);
                  }
                }

                trains.push(recoveredTrain);

                matchedNumbers.add(numStr);
              } catch {}
            })
          );
        }
      }

    // Arricchimento in tempo reale con andamentoTreno:
    // Rileva con precisione se un convoglio è attualmente fermo in una stazione (arrivato ma non partito)
    // o se ha già effettuato la partenza da una fermata specifica, calcolando il ritardo accumulato in banchina
    // e popolando andamentoMemoryCache per evitare flash al cambio treno.
    if (isToday && trains.length > 0) {
      const activeCirculating = trains
        .filter(
          (t) =>
            t.isLive &&
            Math.abs(nowMins - parseTimeToMinutes(t.departureTimePlanned)) <= 240
        )
        .sort((a, b) => {
          const score = (t: LiveTrainInfo) => {
            const depM = parseTimeToMinutes(t.departureTimePlanned);
            const arrM = parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '');
            const isFinishedPenalty =
              t.isArrivedAtDestination || (arrM > 0 && nowMins > arrM + 10) ? 1000 : 0;
            const dist = Math.min(Math.abs(depM - nowMins), Math.abs(depM - targetDepMins));
            return isFinishedPenalty + dist;
          };
          return score(a) - score(b);
        });

      if (activeCirculating.length > 0) {
        const depStationObj = { code: depCode, name: getStationNameByCode(depCode) || '' };
        const arrStationObj = { code: arrCode, name: getStationNameByCode(arrCode) || '' };
        await Promise.all(
          activeCirculating.slice(0, 10).map(async (t) => {
            try {
              const aData = await fetchSingleTrainAndamento(
                t,
                depStationObj,
                arrStationObj,
                targetDate.getTime(),
                forceRefresh
              );
              if (!aData || !Array.isArray(aData.fermate)) return;
              applyAndamentoToTrain(t, aData, depStationObj, arrStationObj);
            } catch {}
          })
        );
      }
    }

    trains.sort(
      (a, b) =>
        parseTimeToMinutes(a.departureTimePlanned) -
        parseTimeToMinutes(b.departureTimePlanned)
    );

    if (trains.length > 0) {
      if (timetableCache.size >= 30) {
        const oldestKey = timetableCache.keys().next().value;
        if (oldestKey) timetableCache.delete(oldestKey);
      }
      timetableCache.set(cacheKey, {
        timestamp: Date.now(),
        trains,
        baseKey: baseCacheKey,
        isToday,
        coveredStartMins: Math.max(0, targetDepMins - 75),
        coveredEndMins: Math.min(1439, targetDepMins + 240),
      });
    }

    return trains;
    })();

    if (!forceRefresh) {
      timetableInFlight.set(cacheKey, fetchTask);
    }
    try {
      return await fetchTask;
    } finally {
      if (timetableInFlight.get(cacheKey) === fetchTask) {
        timetableInFlight.delete(cacheKey);
      }
    }
  } catch (err) {
    console.warn('Errore fetchLiveTrenitaliaTimetable:', err);
    return [];
  }
}

interface AndamentoCacheEntry {
  originCode: string;
  aData: any;
  timestamp: number;
  finished: boolean;
}

// Cache in memoria delle fermate convoglio (andamentoTreno) per azzerare la latenza nei cambi treno.
// Per ogni numero treno salva una lista per origine distinta (es. 4731 Milano vs 4731 Perugia).
const andamentoMemoryCache = new Map<string, AndamentoCacheEntry[]>();
const andamentoInFlight = new Map<string, Promise<any | null>>();
const trainOriginInfoCache = new Map<string, { originCode: string; departureMillis?: number }[]>();

function buildRouteCacheKey(
  cleanNum: string,
  departureStation?: { code?: string; name?: string },
  arrivalStation?: { code?: string; name?: string }
): string {
  const normDep = departureStation
    ? normalizeStationInfo({ code: departureStation.code || '', name: departureStation.name || '' })
    : undefined;
  const normArr = arrivalStation
    ? normalizeStationInfo({ code: arrivalStation.code || '', name: arrivalStation.name || '' })
    : undefined;
  const depKey = (normDep?.code || normDep?.name || '').trim().toUpperCase();
  const arrKey = (normArr?.code || normArr?.name || '').trim().toUpperCase();
  return `${cleanNum}__${depKey}__${arrKey}`;
}

/**
 * Verifica che la corsa in `aData` serva entrambe le stazioni richieste nello stesso ordine (salita -> discesa).
 * Impedisce di mescolare treni duplicati su tratte diverse (es. 4731 Milano vs 4731 Perugia->Roma) o in direzione opposta.
 */
function findOrderedRouteStopsInAndamento(
  aData: any,
  departureStation?: { code?: string; name?: string },
  arrivalStation?: { code?: string; name?: string }
): { depStop: any; arrStop: any; depIdx: number; arrIdx: number } | null {
  const fermate = Array.isArray(aData?.fermate) ? aData.fermate : [];
  if (fermate.length < 2) return null;

  const normDep =
    departureStation && (departureStation.code || departureStation.name)
      ? normalizeStationInfo({ code: departureStation.code || '', name: departureStation.name || '' })
      : undefined;
  const normArr =
    arrivalStation && (arrivalStation.code || arrivalStation.name)
      ? normalizeStationInfo({ code: arrivalStation.code || '', name: arrivalStation.name || '' })
      : undefined;
  if (!normDep || !normArr) return null;

  const findStopIdx = (st: { code?: string; name?: string }) => {
    const cleanCode = (st.code || '').trim().toUpperCase();
    const cleanName = st.name ? formatStationName(st.name) : '';
    if (cleanCode) {
      const byCode = fermate.findIndex(
        (f: any) => String(f?.id || '').trim().toUpperCase() === cleanCode
      );
      if (byCode >= 0) return byCode;
    }
    if (cleanName) {
      return fermate.findIndex(
        (f: any) => f?.stazione && isSameStation(f.stazione, cleanName)
      );
    }
    return -1;
  };

  const depIdx = findStopIdx(normDep);
  const arrIdx = findStopIdx(normArr);
  if (depIdx < 0 || arrIdx < 0 || depIdx >= arrIdx) {
    return null;
  }

  const depStop = fermate[depIdx];
  const arrStop = fermate[arrIdx];
  if (
    typeof depStop?.progressivo === 'number' &&
    typeof arrStop?.progressivo === 'number' &&
    depStop.progressivo >= arrStop.progressivo
  ) {
    return null;
  }

  return { depStop, arrStop, depIdx, arrIdx };
}

function scoreAndamentoMatchForTrain(
  aData: any,
  depStop: any,
  train?: Pick<LiveTrainInfo, 'departureTimePlanned' | 'originStationCode' | 'isLive'>
): number {
  let score = 0;
  if (train?.isLive && train.originStationCode) {
    const aOrig = String(aData?.idOrigine || aData?.fermate?.[0]?.id || '').trim().toUpperCase();
    if (aOrig && aOrig === train.originStationCode.trim().toUpperCase()) {
      score -= 1000;
    }
  }
  if (train?.departureTimePlanned) {
    const targetM = parseTimeToMinutes(train.departureTimePlanned);
    const stopPlan = extractStopPlannedTime(depStop, 'dep');
    if (targetM > 0 && stopPlan.mins > 0) {
      let diff = Math.abs(stopPlan.mins - targetM);
      if (diff > 720) diff = 1440 - diff;
      score += diff;
    }
  }
  return score;
}

function upsertAndamentoCacheEntry(cleanNum: string, originCode: string, aData: any): void {
  if (!cleanNum || !aData || !Array.isArray(aData.fermate) || aData.fermate.length === 0) return;
  const resolvedOrig = String(
    originCode || aData.idOrigine || aData.fermate[0]?.id || ''
  )
    .trim()
    .toUpperCase();
  if (!resolvedOrig) return;

  const lastStop = aData.fermate[aData.fermate.length - 1];
  const entry: AndamentoCacheEntry = {
    originCode: resolvedOrig,
    aData,
    timestamp: Date.now(),
    finished: Boolean(aData.arrivato === true || (lastStop && lastStop.arrivoReale)),
  };

  const existingList = andamentoMemoryCache.get(cleanNum) || [];
  const nextList = existingList.filter((e) => e.originCode !== resolvedOrig);
  nextList.push(entry);
  andamentoMemoryCache.set(cleanNum, nextList);
}

function findCachedAndamentoForRoute(
  cleanNum: string,
  departureStation?: { code?: string; name?: string },
  arrivalStation?: { code?: string; name?: string },
  train?: Pick<LiveTrainInfo, 'departureTimePlanned' | 'originStationCode' | 'isLive'>,
  allowExpired = false
): AndamentoCacheEntry | undefined {
  const entries = andamentoMemoryCache.get(cleanNum);
  if (!entries || entries.length === 0) return undefined;

  const nowMs = Date.now();
  const validEntries = entries.filter((entry) => {
    if (!Array.isArray(entry.aData?.fermate) || entry.aData.fermate.length === 0) return false;
    if (!allowExpired) {
      const ttl = entry.finished ? 10 * 60_000 : 45_000;
      if (nowMs - entry.timestamp >= ttl) return false;
    }
    return true;
  });
  if (validEntries.length === 0) return undefined;

  if (!departureStation || !arrivalStation) {
    return validEntries[0];
  }

  let bestEntry: AndamentoCacheEntry | undefined;
  let bestScore = Infinity;
  for (const entry of validEntries) {
    const match = findOrderedRouteStopsInAndamento(entry.aData, departureStation, arrivalStation);
    if (!match) continue;
    const sc = scoreAndamentoMatchForTrain(entry.aData, match.depStop, train);
    if (sc < bestScore) {
      bestScore = sc;
      bestEntry = entry;
    }
  }
  return bestEntry;
}

export function isTrainAndamentoFresh(
  trainNumber: string,
  departureStation?: { code?: string; name?: string },
  arrivalStation?: { code?: string; name?: string }
): boolean {
  const cleanNum = (trainNumber || '').replace(/\D/g, '');
  if (!cleanNum) return false;
  return Boolean(findCachedAndamentoForRoute(cleanNum, departureStation, arrivalStation));
}

/**
 * Applica immediatamente al treno i dati di andamentoTreno già presenti in andamentoMemoryCache (se freschi e coerenti con la tratta).
 */
export function enrichTrainFromCachedAndamento(
  train: LiveTrainInfo,
  departureStation: { code: string; name: string },
  arrivalStation: { code: string; name: string }
): boolean {
  const cleanNum = (train.trainNumber || '').replace(/\D/g, '');
  if (!cleanNum) return false;
  const cached = findCachedAndamentoForRoute(cleanNum, departureStation, arrivalStation, train);
  if (!cached) return false;
  return applyAndamentoToTrain(train, cached.aData, departureStation, arrivalStation);
}

async function fetchSingleTrainAndamento(
  train: LiveTrainInfo,
  departureStation: { code: string; name: string },
  arrivalStation: { code: string; name: string },
  fallbackMillis: number,
  forceRefresh = false
): Promise<any | null> {
  const cleanNum = (train.trainNumber || '').replace(/\D/g, '');
  if (!cleanNum) return null;

  const cached = findCachedAndamentoForRoute(cleanNum, departureStation, arrivalStation, train);
  if (!forceRefresh && cached) {
    return cached.aData;
  }

  const routeKey = buildRouteCacheKey(cleanNum, departureStation, arrivalStation);
  if (!forceRefresh) {
    const existing = andamentoInFlight.get(routeKey);
    if (existing) return existing;
  }

  const probeCandidate = async (
    origCode: string,
    depMilli?: number
  ): Promise<{ origCode: string; aData: any; depStop: any; score: number } | null> => {
    const url = `${VIAGGIATRENO_BASE_URL}/andamentoTreno/${origCode}/${cleanNum}/${depMilli || fallbackMillis}`;
    const fresh = await fetchViaggiaTrenoJson(url, 2500, 0);
    if (!fresh || !Array.isArray(fresh.fermate) || fresh.fermate.length === 0) return null;
    upsertAndamentoCacheEntry(cleanNum, origCode, fresh);
    const match = findOrderedRouteStopsInAndamento(fresh, departureStation, arrivalStation);
    if (!match) return null;
    return {
      origCode,
      aData: fresh,
      depStop: match.depStop,
      score: scoreAndamentoMatchForTrain(fresh, match.depStop, train),
    };
  };

  const task = (async (): Promise<any | null> => {
    let bestData: any = null;
    try {
      const triedOrigins = new Set<string>();

      // Se il treno proviene già dal tabellone live con origine reale, prova quella prima (1 sola chiamata)
      const liveOrig = train.isLive ? (train.originStationCode || '').trim().toUpperCase() : '';
      if (liveOrig) {
        triedOrigins.add(liveOrig);
        const fastHit = await probeCandidate(liveOrig, train.departureMillis || fallbackMillis);
        if (fastHit) {
          return fastHit.aData;
        }
      }

      // Altrimenti recupera tutte le corse omonime (es. 4731 Milano vs 4731 Perugia) e verifica la tratta in parallelo
      const autoCandidates = await getTrainOriginCandidates(cleanNum);
      const pendingCandidates: { originCode: string; departureMillis?: number }[] = [];
      for (const cand of autoCandidates) {
        if (!triedOrigins.has(cand.originCode)) {
          triedOrigins.add(cand.originCode);
          pendingCandidates.push(cand);
        }
      }

      const fallbackOrig = !train.isLive ? (train.originStationCode || '').trim().toUpperCase() : '';
      if (fallbackOrig && !triedOrigins.has(fallbackOrig)) {
        triedOrigins.add(fallbackOrig);
        pendingCandidates.push({
          originCode: fallbackOrig,
          departureMillis: train.departureMillis || fallbackMillis,
        });
      }

      if (pendingCandidates.length > 0) {
        const results = await Promise.all(
          pendingCandidates.slice(0, 6).map((c) => probeCandidate(c.originCode, c.departureMillis))
        );
        let bestScore = Infinity;
        for (const res of results) {
          if (res && res.score < bestScore) {
            bestScore = res.score;
            bestData = res.aData;
          }
        }
      }
    } catch {}

    if (!bestData) {
      const staleFallback = findCachedAndamentoForRoute(
        cleanNum,
        departureStation,
        arrivalStation,
        train,
        true
      );
      if (staleFallback) bestData = staleFallback.aData;
    }
    return bestData;
  })().finally(() => {
    if (andamentoInFlight.get(routeKey) === task) {
      andamentoInFlight.delete(routeKey);
    }
  });

  if (!forceRefresh) {
    andamentoInFlight.set(routeKey, task);
  }
  return task;
}

function findLastStopProgressIndex(aData: any): {
  latestProgressIdx: number;
  lastRealIdx: number;
  lastDetIdx: number;
} {
  const fermate = Array.isArray(aData?.fermate) ? aData.fermate : [];
  let lastRealIdx = -1;
  for (let i = fermate.length - 1; i >= 0; i--) {
    const f = fermate[i];
    const hasArr = typeof f?.arrivoReale === 'number' && f.arrivoReale > 0;
    const hasDep = typeof f?.partenzaReale === 'number' && f.partenzaReale > 0;
    if (hasArr || hasDep) {
      lastRealIdx = i;
      break;
    }
  }

  let lastDetIdx = -1;
  // Evita di interpretare rilevamenti preliminari all'origine come progressione se non risulta partito ne' ha fermate reali
  if (
    (lastRealIdx >= 0 || aData?.nonPartito !== true) &&
    typeof aData?.stazioneUltimoRilevamento === 'string' &&
    aData.stazioneUltimoRilevamento.trim()
  ) {
    const rawDet = aData.stazioneUltimoRilevamento.trim();
    if (rawDet !== '--' && !/^[-.\s]+$/.test(rawDet)) {
      for (let i = fermate.length - 1; i >= 0; i--) {
        if (isSameStation(fermate[i]?.stazione || '', rawDet)) {
          lastDetIdx = i;
          break;
        }
      }
    }
  }

  return {
    latestProgressIdx: Math.max(lastRealIdx, lastDetIdx),
    lastRealIdx,
    lastDetIdx,
  };
}

function mapAndamentoStops(aData: any): LiveTrainStop[] {
  const { latestProgressIdx, lastRealIdx } = findLastStopProgressIndex(aData);
  return aData.fermate.map((f: any, idx: number) => {
    const hasArr = typeof f.arrivoReale === 'number' && f.arrivoReale > 0;
    const hasDep = typeof f.partenzaReale === 'number' && f.partenzaReale > 0;
    const isSuppressed = f.actualFermataType === 3 || f.tipoFermata === 'C' || f.soppressa === true;
    const isPassed = !isSuppressed && (hasDep || (latestProgressIdx >= 0 && idx < latestProgressIdx));
    const isCurrent = Boolean(!isPassed && !isSuppressed && hasArr && !hasDep && idx === lastRealIdx);
    return {
      stationName: formatStationName(f.stazione || ''),
      stationCode: f.id,
      isPassed,
      isCurrent,
      actualTime: f.partenzaReale
        ? formatMillisToTime(f.partenzaReale)
        : f.arrivoReale
        ? formatMillisToTime(f.arrivoReale)
        : undefined,
      plannedTime: f.partenza_teorica
        ? formatMillisToTime(f.partenza_teorica)
        : f.arrivo_teorico
        ? formatMillisToTime(f.arrivo_teorico)
        : cleanViaggiaTrenoTime(f.compOrarioPartenza || f.compOrarioArrivo || '') || undefined,
      delayMinutes:
        typeof f.ritardoPartenza === 'number'
          ? f.ritardoPartenza
          : typeof f.ritardoArrivo === 'number'
          ? f.ritardoArrivo
          : undefined,
      isExtraordinary: Boolean(
        f.tipoFermata === 'S' ||
        f.straordinaria === true ||
        f.programmata === false ||
        (typeof f.tipoFermataDescrizione === 'string' && f.tipoFermataDescrizione.toLowerCase().includes('straordinar')) ||
        (typeof f.actualFermataType === 'string' && f.actualFermataType.toLowerCase().includes('straordinar'))
      ),
    };
  });
}

/**
 * Restituisce i minuti trascorsi oltre targetMins rispetto a nowMins (con gestione cambio mezzanotte).
 */
function elapsedMinutesPast(targetMins: number, nowMins: number): number {
  if (targetMins <= 0) return 0;
  if (nowMins >= targetMins) {
    const diff = nowMins - targetMins;
    return diff <= 240 ? diff : 0;
  }
  if (targetMins - nowMins > 1200) {
    const diff = nowMins + 1440 - targetMins;
    return diff <= 240 ? diff : 0;
  }
  return 0;
}

/**
 * Estrae l'orario programmato di partenza o arrivo di una fermata ViaggiaTreno.
 */
function extractStopPlannedTime(
  stop: any,
  kind: 'dep' | 'arr'
): { timeStr?: string; mins: number } {
  if (!stop) return { mins: 0 };
  const theoreticalMs = kind === 'dep' ? stop.partenza_teorica : stop.arrivo_teorica;
  const progMs = kind === 'dep' ? stop.programmataPartenza : stop.programmataArrivo;
  const compTime = kind === 'dep' ? stop.compOrarioPartenza : stop.compOrarioArrivo;

  let timeStr: string | undefined;
  if (typeof theoreticalMs === 'number') {
    timeStr = formatMillisToTime(theoreticalMs);
  } else if (typeof progMs === 'number') {
    timeStr = formatMillisToTime(progMs);
  } else if (compTime) {
    timeStr = cleanViaggiaTrenoTime(compTime) || undefined;
  }
  if (!timeStr && typeof stop.programmata === 'number') {
    timeStr = formatMillisToTime(stop.programmata);
  }
  return {
    timeStr,
    mins: timeStr ? parseTimeToMinutes(timeStr) : 0,
  };
}

/**
 * Individua l'eventuale fermata intermedia in cui il treno risulta attualmente fermo:
 * cerca l'ultima fermata con un rilevamento reale prima del capolinea finale (e prima della fermata di discesa),
 * e verifica che abbia arrivoReale ma non partenzaReale.
 */
function findActiveStoppedStop(
  fermate: any[],
  arrIdx: number,
  lastDetIdx = -1
): { stop: any; index: number } | undefined {
  if (!Array.isArray(fermate) || fermate.length < 2) return undefined;
  const lastIdx = fermate.length - 1;
  for (let i = fermate.length - 1; i >= 0; i--) {
    const f = fermate[i];
    const hasArr = typeof f.arrivoReale === 'number' && f.arrivoReale > 0;
    const hasDep = typeof f.partenzaReale === 'number' && f.partenzaReale > 0;
    if (!hasArr && !hasDep) continue;
    // Se l'ultimo rilevamento ufficiale e' gia' oltre la fermata i, non considerarla sosta attiva
    if (lastDetIdx > i) return undefined;
    // Il treno è arrivato all'ultima fermata attiva oltre/al capolinea o oltre arrIdx -> non è fermo in sosta
    if (hasArr && !hasDep && i < lastIdx && (arrIdx < 0 || i < arrIdx)) {
      return { stop: f, index: i };
    }
    return undefined;
  }
  return undefined;
}

/**
 * Restituisce l'ultima fermata attiva (non soppressa) prima di `arrIdx` (penultima stazione).
 */
function findPenultimateActiveStop(
  fermate: any[],
  arrIdx: number
): { stop: any; index: number } | undefined {
  if (!Array.isArray(fermate) || arrIdx <= 0) return undefined;
  for (let i = arrIdx - 1; i >= 0; i--) {
    const f = fermate[i];
    const isSuppressed =
      f?.actualFermataType === 3 || f?.tipoFermata === 'C' || f?.soppressa === true;
    if (!isSuppressed) {
      return { stop: f, index: i };
    }
  }
  return undefined;
}

/**
 * Applica a un treno i dati reali della corsa (andamentoTreno): fermate, orari programmati ed effettivi,
 * binari e ritardi specifici alle due stazioni del pendolare, stato di partenza/arrivo.
 * Funziona anche per treni già conclusi (ViaggiaTreno conserva la corsa fino a fine giornata).
 */
function applyAndamentoToTrain(
  train: LiveTrainInfo,
  aData: any,
  departureStation: { code: string; name: string },
  arrivalStation: { code: string; name: string }
): boolean {
  const routeMatch = findOrderedRouteStopsInAndamento(aData, departureStation, arrivalStation);
  if (!routeMatch) {
    return false;
  }

  train.stops = mapAndamentoStops(aData);

  if (aData.stazioneUltimoRilevamento) {
    train.lastDetectionStationName = formatStationName(aData.stazioneUltimoRilevamento);
  }
  if (typeof aData.oraUltimoRilevamento === 'number') {
    train.lastDetectionTime = formatMillisToTime(aData.oraUltimoRilevamento);
  }

  const { depStop, arrStop, depIdx, arrIdx } = routeMatch;

  const { latestProgressIdx, lastRealIdx, lastDetIdx } = findLastStopProgressIndex(aData);
  const firstStop = aData.fermate[0];
  const hasAnyReal = lastRealIdx >= 0;
  const hasMidwayDetection = lastDetIdx > 0;
  const notDepartedFromOrigin =
    !hasAnyReal &&
    !hasMidwayDetection &&
    (aData.nonPartito === true ||
      (aData.nonPartito !== false &&
        !train.isDeparted &&
        !train.isDepartedFromStation));

  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const nowM = nowDate.getHours() * 60 + nowDate.getMinutes();

  const aDataDelay = typeof aData.ritardo === 'number' ? aData.ritardo : 0;
  const aDataPosDelay = Math.max(0, aDataDelay);

  if (aData.origine && !train.originStationName) {
    train.originStationName = formatStationName(aData.origine);
  }
  if (firstStop) {
    if (firstStop.stazione) {
      train.originStationName = formatStationName(firstStop.stazione);
    }
    if (firstStop.id) train.originStationCode = firstStop.id;
    const originPlanDep = extractStopPlannedTime(firstStop, 'dep');
    if (originPlanDep.timeStr) {
      train.originDepartureTimePlanned = originPlanDep.timeStr;
    }
    if (typeof firstStop.partenzaReale === 'number' && firstStop.partenzaReale > 0) {
      train.originDepartureTimeActual = formatMillisToTime(firstStop.partenzaReale);
    }
  }
  train.isLive = true;

  // Aggiorna gli orari programmati alle due stazioni del pendolare
  if (depStop) {
    const pAct = cleanPlatform(
      depStop.binarioEffettivoPartenzaDescrizione ||
      depStop.binarioEffettivoPartenzaCodice ||
      depStop.binarioEffettivoArrivoDescrizione
    );
    const pPlan = cleanPlatform(
      depStop.binarioProgrammatoPartenzaDescrizione ||
      depStop.binarioProgrammatoPartenzaCodice ||
      depStop.binarioProgrammatoArrivoDescrizione
    );
    if (pAct) train.platformActual = pAct;
    if (pPlan) train.platformPlanned = pPlan;

    const depPlan = extractStopPlannedTime(depStop, 'dep');
    if (depPlan.timeStr) train.departureTimePlanned = depPlan.timeStr;
  }

  if (arrStop) {
    const arrPlan = extractStopPlannedTime(arrStop, 'arr');
    if (arrPlan.timeStr) train.arrivalTimePlanned = arrPlan.timeStr;
  }

  const planDepM = parseTimeToMinutes(train.departureTimePlanned);
  const planArrM = parseTimeToMinutes(train.arrivalTimePlanned || '');

  // Stato di sosta attiva in una fermata precedente o intermedia (es. treno fermo a Terni prima di Orte)
  const stoppedMatch = !notDepartedFromOrigin
    ? findActiveStoppedStop(aData.fermate, arrIdx, lastDetIdx)
    : undefined;
  const stoppedStop = stoppedMatch?.stop;
  const stoppedIdx = stoppedMatch?.index ?? -1;

  let stopLiveDelay = 0;
  let stopEarlyArr = 0;

  if (stoppedStop) {
    const stopPlanDep = extractStopPlannedTime(stoppedStop, 'dep');
    const clockLateAtStop = stopPlanDep.mins > 0 ? elapsedMinutesPast(stopPlanDep.mins, nowM) : 0;
    const stopDepRit = typeof stoppedStop.ritardoPartenza === 'number' ? stoppedStop.ritardoPartenza : 0;
    const stopArrRit = typeof stoppedStop.ritardoArrivo === 'number' ? stoppedStop.ritardoArrivo : 0;

    stopLiveDelay = Math.max(0, stopDepRit, aDataPosDelay, clockLateAtStop);
    if (stopLiveDelay === 0) {
      stopEarlyArr = stopArrRit < 0 ? stopArrRit : aDataDelay < 0 ? aDataDelay : 0;
    }

    train.isStoppedInStation = true;
    train.stoppedStationName = formatStationName(stoppedStop.stazione || departureStation.name);
    train.stoppedSinceMillis = stoppedStop.arrivoReale;
    train.stoppedMinutes = Math.max(1, Math.round((nowMs - stoppedStop.arrivoReale) / 60000));
    if (stopPlanDep.mins > 0) {
      train.stoppedStationEstimatedDep = minutesToTime(stopPlanDep.mins + stopLiveDelay);
    } else if (stoppedStop === depStop && planDepM > 0) {
      train.stoppedStationEstimatedDep = minutesToTime(planDepM + stopLiveDelay);
    }
  } else {
    train.isStoppedInStation = false;
    train.stoppedStationName = undefined;
    train.stoppedSinceMillis = undefined;
    train.stoppedMinutes = undefined;
    train.stoppedStationEstimatedDep = undefined;
  }

  if (notDepartedFromOrigin) {
    const originPlanDep = extractStopPlannedTime(firstStop, 'dep');
    const fallbackOriginMins =
      originPlanDep.mins > 0
        ? originPlanDep.mins
        : train.isOriginStation || (depStop && firstStop && depStop.id === firstStop.id)
        ? planDepM
        : 0;
    const originClockLate = fallbackOriginMins > 0 ? elapsedMinutesPast(fallbackOriginMins, nowM) : 0;
    const originDepRit = firstStop && typeof firstStop.ritardoPartenza === 'number' ? firstStop.ritardoPartenza : 0;
    const originDelay = Math.max(0, aDataPosDelay, originDepRit, originClockLate);

    train.isDeparted = false;
    train.isDepartedFromStation = false;
    train.isArrivedAtDestination = false;
    train.canPredictEarlyArrival = false;
    train.delayMinutes = originDelay;
    train.departureDelayAtStation = originDelay;
    train.arrivalDelayAtStation = originDelay;
    if (planDepM > 0) {
      train.departureTimeActual = minutesToTime(planDepM + originDelay);
    } else if (train.departureTimePlanned) {
      train.departureTimeActual = train.departureTimePlanned;
    }
    if (planArrM > 0) {
      train.arrivalTimeActual = minutesToTime(planArrM + originDelay);
    }

    if (originClockLate > 0 && firstStop) {
      train.isStoppedInStation = true;
      train.stoppedStationName = formatStationName(
        firstStop.stazione || train.originStationName || departureStation.name
      );
      train.stoppedSinceMillis = undefined;
      train.stoppedMinutes = originDelay;
      train.stoppedStationEstimatedDep = minutesToTime(fallbackOriginMins + originDelay);
      train.statusDescription = `Non partito (+${originDelay} min)`;
    } else {
      train.isStoppedInStation = false;
      train.stoppedStationName = undefined;
      train.stoppedSinceMillis = undefined;
      train.stoppedMinutes = undefined;
      train.stoppedStationEstimatedDep = undefined;
      train.statusDescription = originDelay > 0 ? `Ritardo di ${originDelay} min` : 'Non partito';
    }
    return true;
  }

  if (
    aData.nonPartito === false ||
    hasAnyReal ||
    hasMidwayDetection ||
    (typeof aData.partenzaTreno === 'number' && aData.partenzaTreno > 0)
  ) {
    train.isDeparted = true;
  }

  // Valutazione partenza dalla stazione del pendolare
  // Copre anche il caso in cui ViaggiaTreno ometta partenzaReale alla fermata (es. origine) pur avendo rilevamenti successivi
  const passedBeyondDepStop = depIdx >= 0 && latestProgressIdx > depIdx;
  const hasDepartedFromDepStop =
    Boolean(depStop && typeof depStop.partenzaReale === 'number' && depStop.partenzaReale > 0) ||
    Boolean(stoppedStop && depIdx >= 0 && stoppedIdx > depIdx) ||
    passedBeyondDepStop;

  let effectiveDepDelay = 0;
  if (depStop && typeof depStop.partenzaReale === 'number' && depStop.partenzaReale > 0) {
    const rawDepAct = formatMillisToTime(depStop.partenzaReale);
    const rawDepDelay =
      typeof depStop.ritardoPartenza === 'number'
        ? depStop.ritardoPartenza
        : parseTimeToMinutes(rawDepAct) - planDepM;
    // La partenza non anticipa mai rispetto all'orario programmato
    effectiveDepDelay = Math.max(0, rawDepDelay);
    train.departureDelayAtStation = effectiveDepDelay;
    train.departureTimeActual =
      effectiveDepDelay > 0 && planDepM > 0
        ? minutesToTime(planDepM + effectiveDepDelay)
        : train.departureTimePlanned;
    train.isDepartedFromStation = true;
    train.isDeparted = true;
  } else if (hasDepartedFromDepStop) {
    train.isDepartedFromStation = true;
    train.isDeparted = true;
    let inferredDepDelay =
      depStop && typeof depStop.ritardoPartenza === 'number' && depStop.ritardoPartenza > 0
        ? depStop.ritardoPartenza
        : undefined;
    if (inferredDepDelay === undefined && depIdx >= 0) {
      for (let i = depIdx + 1; i < aData.fermate.length; i++) {
        const f = aData.fermate[i];
        const fHasReal =
          (typeof f.arrivoReale === 'number' && f.arrivoReale > 0) ||
          (typeof f.partenzaReale === 'number' && f.partenzaReale > 0);
        if (!fHasReal) continue;
        if (typeof f.ritardoArrivo === 'number') {
          inferredDepDelay = Math.max(0, f.ritardoArrivo);
        } else if (typeof f.ritardoPartenza === 'number') {
          inferredDepDelay = Math.max(0, f.ritardoPartenza);
        }
        break;
      }
    }
    if (inferredDepDelay === undefined) {
      inferredDepDelay = aDataPosDelay;
    }
    effectiveDepDelay = Math.max(0, inferredDepDelay);
    train.departureDelayAtStation = effectiveDepDelay;
    if (planDepM > 0) {
      train.departureTimeActual =
        effectiveDepDelay > 0
          ? minutesToTime(planDepM + effectiveDepDelay)
          : train.departureTimePlanned;
    }
    if (depIdx === 0 && !train.originDepartureTimeActual && train.departureTimeActual) {
      train.originDepartureTimeActual = train.departureTimeActual;
    }
  } else {
    train.isDepartedFromStation = false;
    const depRit = depStop && typeof depStop.ritardoPartenza === 'number' ? depStop.ritardoPartenza : 0;
    const clockPastDep = planDepM > 0 ? elapsedMinutesPast(planDepM, nowM) : 0;
    effectiveDepDelay = Math.max(0, depRit, aDataPosDelay, stopLiveDelay, clockPastDep);
    train.departureDelayAtStation = effectiveDepDelay;
    train.departureTimeActual =
      effectiveDepDelay > 0 && planDepM > 0
        ? minutesToTime(planDepM + effectiveDepDelay)
        : train.departureTimePlanned;
  }

  const passedBeyondArrStop = arrIdx >= 0 && latestProgressIdx > arrIdx;
  const arrivedAtTerminusStop =
    aData.arrivato === true && arrIdx >= 0 && arrIdx === aData.fermate.length - 1;

  // Valutazione arrivo alla stazione di destinazione del pendolare
  if (arrStop) {
    const arrReal =
      typeof arrStop.arrivoReale === 'number' && arrStop.arrivoReale > 0
        ? arrStop.arrivoReale
        : typeof arrStop.partenzaReale === 'number' && arrStop.partenzaReale > 0
        ? arrStop.partenzaReale
        : undefined;

    if (arrReal || passedBeyondArrStop || arrivedAtTerminusStop) {
      const rawArrAct = arrReal ? formatMillisToTime(arrReal) : train.arrivalTimeActual || train.arrivalTimePlanned;
      train.isArrivedAtDestination = true;
      train.isDeparted = true;
      train.isDepartedFromStation = true;
      train.isStoppedInStation = false;
      train.stoppedStationName = undefined;
      train.stoppedSinceMillis = undefined;
      train.stoppedMinutes = undefined;
      train.stoppedStationEstimatedDep = undefined;
      train.statusDescription = 'Arrivato';
      train.trainStatusType = 'arrived';
      const hasExplicitArrRit =
        typeof arrStop.ritardoArrivo === 'number' && (Boolean(arrReal) || arrStop.ritardoArrivo !== 0);
      const realDelay = hasExplicitArrRit
        ? arrStop.ritardoArrivo
        : arrReal && rawArrAct && planArrM > 0
        ? parseTimeToMinutes(rawArrAct) - planArrM
        : aDataDelay;
      train.canPredictEarlyArrival = true;
      train.arrivalDelayAtStation = realDelay;
      train.delayMinutes = realDelay;
      train.arrivalTimeActual =
        realDelay !== 0 && planArrM > 0
          ? minutesToTime(planArrM + realDelay)
          : rawArrAct;
      return true;
    }

    const curArrDelay =
      typeof arrStop.ritardoArrivo === 'number' && arrStop.ritardoArrivo !== 0
        ? arrStop.ritardoArrivo
        : aDataDelay;

    const penMatch = findPenultimateActiveStop(aData.fermate, arrIdx);
    const penStop = penMatch?.stop;
    const penIdx = penMatch?.index ?? -1;
    const penHasDeparted = Boolean(
      penStop && typeof penStop.partenzaReale === 'number' && penStop.partenzaReale > 0
    );
    const inFinalSegment = Boolean(
      !stoppedStop &&
        penIdx >= 0 &&
        (penHasDeparted || latestProgressIdx > penIdx)
    );
    // L'anticipo sull'orario di arrivo vale solo quando il treno è già nell'ultimo pezzo di tratta
    // (tra penultima stazione e discesa) e in quel tratto risulta effettivamente in anticipo.
    const hasEarlyInFinalSegment = Boolean(
      inFinalSegment &&
        penStop &&
        curArrDelay < 0 &&
        ((typeof penStop.ritardoPartenza === 'number' && penStop.ritardoPartenza < 0) ||
          (typeof penStop.partenzaReale === 'number' &&
            typeof aData.oraUltimoRilevamento === 'number' &&
            aData.oraUltimoRilevamento > penStop.partenzaReale) ||
          (!penHasDeparted && latestProgressIdx > penIdx) ||
          (typeof arrStop.ritardoArrivo === 'number' && arrStop.ritardoArrivo < 0))
    );
    train.canPredictEarlyArrival = hasEarlyInFinalSegment;

    if (train.isDepartedFromStation) {
      if (stoppedStop) {
        train.delayMinutes = stopLiveDelay > 0 ? stopLiveDelay : stopEarlyArr;
        const effArrDelay =
          stopLiveDelay > 0 ? Math.max(stopLiveDelay, curArrDelay) : Math.max(0, curArrDelay);
        train.arrivalDelayAtStation = effArrDelay;
        if (planArrM > 0) {
          train.arrivalTimeActual = minutesToTime(planArrM + effArrDelay);
        }
      } else {
        train.delayMinutes = aDataDelay;
        const effArrDelay = hasEarlyInFinalSegment ? curArrDelay : Math.max(0, curArrDelay);
        train.arrivalDelayAtStation = effArrDelay;
        if (planArrM > 0) {
          train.arrivalTimeActual = minutesToTime(planArrM + effArrDelay);
        }
      }
    } else {
      // Non ancora partito dalla stazione del pendolare: un anticipo a monte non anticipa l'arrivo
      const effDelay = Math.max(0, curArrDelay, effectiveDepDelay, stopLiveDelay);
      train.delayMinutes = effDelay > 0 ? effDelay : stopLiveDelay === 0 && stoppedStop ? stopEarlyArr : aDataDelay;
      train.arrivalDelayAtStation = effDelay;
      if (planArrM > 0) {
        train.arrivalTimeActual = minutesToTime(planArrM + effDelay);
      }
    }
  } else if (aData.arrivato === true) {
    train.isArrivedAtDestination = true;
    train.canPredictEarlyArrival = true;
    train.isStoppedInStation = false;
    train.stoppedStationName = undefined;
    train.stoppedSinceMillis = undefined;
    train.stoppedMinutes = undefined;
    train.stoppedStationEstimatedDep = undefined;
    train.statusDescription = 'Arrivato';
    train.trainStatusType = 'arrived';
    return true;
  } else {
    // Fallback senza arrStop esplicita: senza riferimento di penultima e discesa non anticipa l'arrivo
    train.canPredictEarlyArrival = false;
    const effDelay = Math.max(effectiveDepDelay, stopLiveDelay, aDataPosDelay);
    train.delayMinutes = effDelay > 0 ? effDelay : stopEarlyArr < 0 ? stopEarlyArr : aDataDelay;
    if (planArrM > 0) {
      const effArr = Math.max(0, train.delayMinutes);
      train.arrivalDelayAtStation = effArr;
      train.arrivalTimeActual = minutesToTime(planArrM + effArr);
    }
  }

  if (!train.isArrivedAtDestination) {
    if (stoppedStop) {
      const durationStr = train.stoppedMinutes ? ` (da ${train.stoppedMinutes} min)` : '';
      train.statusDescription = `Fermo a ${train.stoppedStationName}${durationStr}`;
    } else {
      train.statusDescription =
        train.delayMinutes > 0
          ? `Ritardo di ${train.delayMinutes} min`
          : train.isDepartedFromStation
          ? 'In viaggio'
          : 'In orario';
    }
  }

  return true;
}

/**
 * Calcola con precisione astronomica l'offset UTC in ore del fuso orario italiano
 * (Europe/Rome: CET UTC+1 in inverno, CEST UTC+2 in estate con ora legale).
 * Implementazione deterministica e indipendente dal supporto timeZone del motore JS (Hermes/JSC/V8).
 */
export function getItalyOffsetHours(d: Date): number {
  const year = d.getUTCFullYear();
  // Inizio ora legale in Europa: ultima domenica di marzo alle 01:00 UTC (02:00 CET -> 03:00 CEST)
  const march31 = new Date(Date.UTC(year, 2, 31));
  const lastSundayMarch = 31 - march31.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, lastSundayMarch, 1, 0, 0));

  // Fine ora legale in Europa: ultima domenica di ottobre alle 01:00 UTC (03:00 CEST -> 02:00 CET)
  const oct31 = new Date(Date.UTC(year, 9, 31));
  const lastSundayOct = 31 - oct31.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 9, lastSundayOct, 1, 0, 0));

  const t = d.getTime();
  return t >= dstStart.getTime() && t < dstEnd.getTime() ? 2 : 1;
}

/**
 * Converte un timestamp ISO (espresso in UTC con 'Z' o con offset)
 * nell'orario locale della stazione ferroviaria italiana ('Europe/Rome').
 * Gestisce con precisione millimetrica sia l'ora solare (CET, UTC+1) che l'ora legale (CEST, UTC+2),
 * evitando discrepanze di fuso orario tra GTFS e orari reali di ViaggiaTreno anche su Hermes.
 */
export function formatIsoToLocalHHMM(
  isoString?: string | null,
  _timeZone = 'Europe/Rome'
): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const offset = getItalyOffsetHours(d);
  const localD = new Date(d.getTime() + offset * 3600_000);
  const hh = String(localD.getUTCHours()).padStart(2, '0');
  const mm = String(localD.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Converte un timestamp ISO nella data locale in formato 'YYYY-MM-DD' ('Europe/Rome').
 */
export function formatIsoToLocalDate(
  isoString?: string | null,
  _timeZone = 'Europe/Rome'
): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const offset = getItalyOffsetHours(d);
  const localD = new Date(d.getTime() + offset * 3600_000);
  const yyyy = localD.getUTCFullYear();
  const mm = String(localD.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(localD.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Recupera l'orario ferroviario dinamico dell'intera giornata da GTFS (Transitous)
 * per consentire all'utente di scorrere e selezionare qualsiasi treno della data prescelta
 * (inclusi treni del mattino o della sera precedenti a quello attualmente visualizzato),
 * calcolato dinamicamente sulle stazioni reali di salita e discesa senza dipendere da dati statici.
 */
export async function fetchDynamicFullDayRailTimetable(
  depStation: StationInfo,
  arrStation: StationInfo,
  targetDate: Date,
  includeIntercity = false,
  forceRefresh = false
): Promise<LiveTrainInfo[]> {
  const p = (n: number) => String(n).padStart(2, '0');
  const dateIso = `${targetDate.getFullYear()}-${p(targetDate.getMonth() + 1)}-${p(targetDate.getDate())}`;
  const targetDayStr = dateIso;
  const cacheKey = `${depStation.code}_${arrStation.code}_${dateIso}_${includeIntercity ? 'ic' : 'noic'}_v2`;

  if (!forceRefresh) {
    await ensureFullDayStorageLoaded();
    const cached = fullDayRailCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FULL_DAY_CACHE_TTL_MS) {
      return cached.trains;
    }
    const existing = fullDayRailInFlight.get(cacheKey);
    if (existing) return existing;
  }

  const distKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const task = (async (): Promise<LiveTrainInfo[]> => {
    try {
      const [depCoords, arrCoords] = await Promise.all([
        resolveStationGeoCoordinates(depStation),
        resolveStationGeoCoordinates(arrStation),
      ]);
      if (!depCoords || !arrCoords) {
        return [];
      }

      // Richiesta singola ottimizzata a Transitous su finestra intera giornata (03:00Z +21h, soli treni diretti)
      // con concorrenza limitata (max 3) e retry su rate-limit HTML/5xx; integra 13:00Z solo se vicina al limite.
      const transitModesParam =
        'RAIL,REGIONAL_RAIL,SUBURBAN,LONG_DISTANCE,NIGHT_RAIL,HIGHSPEED_RAIL';
      const fetchWindow = async (
        utcHour: string,
        numItineraries: number,
        searchWindowSec: number
      ): Promise<any[]> =>
        withTransitousSlot(async () => {
          const planUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${depCoords.lat.toFixed(5)},${depCoords.lng.toFixed(5)}&toPlace=${arrCoords.lat.toFixed(5)},${arrCoords.lng.toFixed(5)}&time=${dateIso}T${utcHour}:00:00Z&numItineraries=${numItineraries}&searchWindow=${searchWindowSec}&maxTransfers=0&transitModes=${transitModesParam}`;
          for (let attempt = 0; attempt < 2; attempt++) {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), 5500);
            try {
              const res = await fetch(planUrl, {
                signal: ctrl.signal,
                headers: { 'User-Agent': 'StudICI/1.0', Accept: 'application/json' },
              });
              clearTimeout(to);
              if (!res.ok) {
                if (attempt === 0) {
                  await new Promise((r) => setTimeout(r, 140 + Math.random() * 140));
                  continue;
                }
                return [];
              }
              const data = await res.json();
              return Array.isArray(data?.itineraries) ? data.itineraries : [];
            } catch {
              clearTimeout(to);
              if (attempt === 0) {
                await new Promise((r) => setTimeout(r, 140 + Math.random() * 140));
                continue;
              }
              return [];
            }
          }
          return [];
        });

      const isRailMode = (m: string) => {
        const mode = (m || '').toUpperCase();
        return (
          mode === 'RAIL' ||
          mode === 'REGIONAL_RAIL' ||
          mode === 'SUBURBAN' ||
          mode === 'LONG_DISTANCE' ||
          mode === 'NIGHT_RAIL' ||
          mode === 'HIGH_SPEED_RAIL' ||
          mode === 'HIGHSPEED_RAIL'
        );
      };

      const fullDayIts = await fetchWindow('03', 80, 75600);
      let maxCoveredMins = 0;
      if (fullDayIts.length >= 75) {
        for (const it of fullDayIts) {
          const legsArr: any[] = Array.isArray(it?.legs) ? it.legs : [];
          for (const l of legsArr) {
            if (!isRailMode(l?.mode)) continue;
            const st = l.startTime || l.scheduledStartTime || '';
            if (!st || formatIsoToLocalDate(st) !== targetDayStr) continue;
            const hhmm = formatIsoToLocalHHMM(st);
            const mins = hhmm ? parseTimeToMinutes(hhmm) : 0;
            if (mins > maxCoveredMins) maxCoveredMins = mins;
          }
        }
      }
      const afternoonIts =
        fullDayIts.length >= 75 && maxCoveredMins < 19 * 60 + 30
          ? await fetchWindow('13', 60, 39600)
          : [];
      const itineraries = afternoonIts.length > 0 ? [...fullDayIts, ...afternoonIts] : fullDayIts;
      const trains: LiveTrainInfo[] = [];
      const seenTrainNumbers = new Set<string>();

      for (const it of itineraries) {
        const legs: any[] = Array.isArray(it?.legs) ? it.legs : [];
        const railLegs = legs.filter((l) => isRailMode(l?.mode));
        // Considera solo itinerari ferroviari diretti (1 sola tratta treno) per evitare spezzoni con cambio
        if (railLegs.length !== 1) continue;

        for (const leg of railLegs) {
          const mode = (leg.mode || '').toUpperCase();

          // Sanity check ampio sulle coordinate per evitare tratte completamente fuori rotta
          if (typeof leg.from?.lat === 'number' && typeof leg.from?.lon === 'number') {
            if (distKm(leg.from.lat, leg.from.lon, depCoords.lat, depCoords.lng) > 25) {
              continue;
            }
          }
          if (typeof leg.to?.lat === 'number' && typeof leg.to?.lon === 'number') {
            if (distKm(leg.to.lat, leg.to.lon, arrCoords.lat, arrCoords.lng) > 25) {
              continue;
            }
          }

          const startTime: string = leg.startTime || leg.scheduledStartTime || '';
          // Controlla che il treno parta nella giornata richiesta in fuso orario locale italiano
          const legDayStr = formatIsoToLocalDate(startTime);
          if (legDayStr !== targetDayStr) continue;

          const rawCat = (leg.routeShortName || leg.mode || '').toUpperCase();
          const isIC = rawCat.includes('IC') || mode === 'LONG_DISTANCE' || mode === 'NIGHT_RAIL';
          if (isIC && !includeIntercity) continue;
          const isExplicitHighSpeed =
            rawCat.includes('FR') ||
            rawCat.includes('FA') ||
            rawCat.includes('FB') ||
            rawCat.includes('FRECCIA') ||
            rawCat.includes('ITALO') ||
            rawCat === 'AV';
          if (isExplicitHighSpeed) continue;

          const rawNum: string =
            leg.tripShortName ||
            (leg.routeShortName ? leg.routeShortName.replace(/\D/g, '') : '') ||
            (leg.tripId ? String(leg.tripId).replace(/\D/g, '') : '');
          const cleanNum = rawNum.replace(/\D/g, '');
          if (!cleanNum || seenTrainNumbers.has(cleanNum)) continue;

          seenTrainNumbers.add(cleanNum);

          // Conversione corretta dal timestamp ISO UTC al fuso orario locale italiano (CET / CEST)
          const depTime = formatIsoToLocalHHMM(startTime);
          const endTime: string = leg.endTime || leg.scheduledEndTime || '';
          const arrTime = formatIsoToLocalHHMM(endTime);

          if (!depTime || !arrTime) continue;

          const durMinutes =
            typeof leg.duration === 'number'
              ? Math.round(leg.duration / 60)
              : parseTimeToMinutes(arrTime) - parseTimeToMinutes(depTime);

          // Allinea la classificazione RV/veloce alla stessa euristica di ViaggiaTreno (dur <= 45)
          const isFast = !isIC && (rawCat === 'RV' || rawCat.includes('VELOCE') || durMinutes <= 45);
          const category = isFast ? 'RV' : isIC ? 'IC' : 'REG';
          const destName = leg.headsign || leg.to?.name || arrStation.name;

          const rawFromName = leg.from?.name
            ? formatStationName(leg.from.name)
            : formatStationName(depStation.name);
          const rawToName = leg.to?.name
            ? formatStationName(leg.to.name)
            : formatStationName(arrStation.name);
          const intermediateStops: LiveTrainStop[] = Array.isArray(leg.intermediateStops)
            ? leg.intermediateStops
                .filter((st: any) => Boolean(st?.name))
                .map((st: any) => {
                  const stIso =
                    st.departure || st.scheduledDeparture || st.arrival || st.scheduledArrival || '';
                  const stTime = stIso ? formatIsoToLocalHHMM(stIso) : '';
                  return {
                    stationName: formatStationName(st.name),
                    plannedTime: stTime || undefined,
                  };
                })
            : [];
          const allStops: LiveTrainStop[] = [
            ...(intermediateStops[0]?.stationName.toLowerCase() === rawFromName.toLowerCase()
              ? []
              : [{ stationName: rawFromName, plannedTime: depTime }]),
            ...intermediateStops,
            ...(intermediateStops[intermediateStops.length - 1]?.stationName.toLowerCase() ===
            rawToName.toLowerCase()
              ? []
              : [{ stationName: rawToName, plannedTime: arrTime }]),
          ];

          trains.push({
            trainNumber: `${category} ${cleanNum}`,
            category,
            destination: destName,
            originStationName: depStation.name,
            originStationCode: depStation.code,
            departureTimePlanned: depTime,
            departureTimeActual: depTime,
            departureMillis: new Date(startTime).getTime() || targetDate.getTime(),
            arrivalTimePlanned: arrTime,
            arrivalTimeActual: arrTime,
            delayMinutes: 0,
            statusDescription: 'Programmato',
            isDeparted: false,
            isDepartedFromStation: false,
            isLive: false,
            durationMinutes: Math.max(1, durMinutes),
            isFast,
            stops: allStops.length > 0 ? allStops : undefined,
          });
        }
      }

      if (trains.length > 0) {
        trains.sort(
          (a, b) =>
            parseTimeToMinutes(a.departureTimePlanned) -
            parseTimeToMinutes(b.departureTimePlanned)
        );
        fullDayRailCache.set(cacheKey, { timestamp: Date.now(), trains });
        void persistFullDayRailEntry(cacheKey, trains);
        return trains;
      }
    } catch (err) {
      console.warn('[TrenitaliaApi] Full-day dynamic schedule fetch failed:', err);
    }

    return [];
  })().finally(() => {
    if (fullDayRailInFlight.get(cacheKey) === task) {
      fullDayRailInFlight.delete(cacheKey);
    }
  });

  if (!forceRefresh) {
    fullDayRailInFlight.set(cacheKey, task);
  }
  return task;
}

/**
 * Risolve il binario programmato di partenza di un singolo treno su una stazione e data specifiche.
 * Usa cache persistente (24h per giorno della settimana), indice in memoria da chiamate /partenze precedenti
 * e una singola interrogazione mirata a ViaggiaTreno (fallback andamentoTreno se necessario).
 */
export async function resolvePlannedTrainPlatform(options: {
  trainNumber: string;
  departureStationCode: string;
  departureTimeStr: string;
  queryDate: Date;
  forceRefresh?: boolean;
}): Promise<string | undefined> {
  const cleanNum = (options.trainNumber || '').replace(/\D/g, '');
  const depCode = (
    normalizeStationInfo({ name: '', code: options.departureStationCode }).code ||
    options.departureStationCode ||
    ''
  )
    .trim()
    .toUpperCase();
  const depMins = parseTimeToMinutes(options.departureTimeStr);
  if (!cleanNum || !depCode || Number.isNaN(depMins)) return undefined;

  const qDate = options.queryDate;
  const p = (n: number) => String(n).padStart(2, '0');
  const dateIso = `${qDate.getFullYear()}-${p(qDate.getMonth() + 1)}-${p(qDate.getDate())}`;
  const platformKey = `${depCode}_${cleanNum}_dow${qDate.getDay()}_${options.departureTimeStr}`;
  const indexKey = `${depCode}_${cleanNum}_${dateIso}`;

  if (!options.forceRefresh) {
    await ensurePlatformStorageLoaded();
    const cached = plannedPlatformCache.get(platformKey);
    if (cached?.platform && Date.now() - cached.timestamp < PLATFORM_CACHE_TTL_MS) {
      return cached.platform;
    }
    const missedAt = platformMissCache.get(platformKey);
    if (missedAt && Date.now() - missedAt < PLATFORM_MISS_TTL_MS) {
      return undefined;
    }
    const indexed = stationTrainPlatformIndex.get(indexKey);
    if (indexed) {
      plannedPlatformCache.set(platformKey, { timestamp: Date.now(), platform: indexed });
      void persistPlatformEntry(platformKey, indexed);
      return indexed;
    }
    const existing = platformInFlight.get(platformKey);
    if (existing) return existing;
  }

  const task = (async (): Promise<string | undefined> => {
    try {
      // Interroga /partenze in una finestra di 15 min appena prima della partenza (copertura empirica -15/+75 min)
      const bucket15Mins = Math.floor(Math.max(0, depMins - 5) / 15) * 15;
      const depWindowKey = `${depCode}_${dateIso}_${bucket15Mins}`;

      let depList: any[] | null = null;
      if (!options.forceRefresh) {
        const cachedList = stationDeparturesCache.get(depWindowKey);
        if (cachedList && Date.now() - cachedList.timestamp < STATION_DEPARTURES_CACHE_TTL_MS) {
          depList = cachedList.list;
        }
      }

      if (!depList) {
        let inFlightDep: Promise<any[] | null> | undefined = options.forceRefresh
          ? undefined
          : stationDeparturesInFlight.get(depWindowKey);
        if (!inFlightDep) {
          const queryTime = new Date(
            qDate.getFullYear(),
            qDate.getMonth(),
            qDate.getDate(),
            Math.floor(bucket15Mins / 60),
            bucket15Mins % 60,
            0,
            0
          );
          const created = fetchViaggiaTrenoJson(
            `${VIAGGIATRENO_BASE_URL}/partenze/${depCode}/${encodeURIComponent(formatViaggiaTrenoDate(queryTime))}`,
            4000,
            1
          )
            .then((data) => {
              if (Array.isArray(data)) {
                stationDeparturesCache.set(depWindowKey, { timestamp: Date.now(), list: data });
                for (const t of data) {
                  const n = String(t?.numeroTreno || '').replace(/\D/g, '');
                  if (!n) continue;
                  const rawP = cleanPlatform(
                    t.binarioProgrammatoPartenzaDescrizione ||
                      t.binarioProgrammatoPartenzaCodice ||
                      t.binarioEffettivoPartenzaDescrizione ||
                      t.binarioEffettivoPartenzaCodice ||
                      undefined
                  );
                  if (rawP) {
                    stationTrainPlatformIndex.set(`${depCode}_${n}_${dateIso}`, rawP);
                  }
                }
                return data;
              }
              return null;
            })
            .finally(() => {
              if (stationDeparturesInFlight.get(depWindowKey) === created) {
                stationDeparturesInFlight.delete(depWindowKey);
              }
            });
          inFlightDep = created;
          stationDeparturesInFlight.set(depWindowKey, created);
        }
        depList = await inFlightDep;
      }

      let resolvedPlat = stationTrainPlatformIndex.get(indexKey);
      if (!resolvedPlat && Array.isArray(depList)) {
        const match = depList.find((t: any) => String(t?.numeroTreno || '').replace(/\D/g, '') === cleanNum);
        if (match) {
          resolvedPlat = cleanPlatform(
            match.binarioProgrammatoPartenzaDescrizione ||
              match.binarioProgrammatoPartenzaCodice ||
              match.binarioEffettivoPartenzaDescrizione ||
              match.binarioEffettivoPartenzaCodice ||
              undefined
          );
        }
      }

      // Fallback mirato tramite andamentoTreno se /partenze non includeva questo treno
      if (!resolvedPlat) {
        const originCandidates = await getTrainOriginCandidates(cleanNum);
        for (const originInfo of originCandidates) {
          const aData = await fetchViaggiaTrenoJson(
            `${VIAGGIATRENO_BASE_URL}/andamentoTreno/${originInfo.originCode}/${cleanNum}/${originInfo.departureMillis || Date.now()}`,
            3000,
            0
          );
          const fermate = Array.isArray(aData?.fermate) ? aData.fermate : [];
          const stopMatch = fermate.find(
            (f: any) => String(f?.id || '').trim().toUpperCase() === depCode
          );
          if (stopMatch) {
            upsertAndamentoCacheEntry(cleanNum, originInfo.originCode, aData);
            resolvedPlat = cleanPlatform(
              stopMatch.binarioProgrammatoPartenzaDescrizione ||
                stopMatch.binarioProgrammatoPartenzaCodice ||
                stopMatch.binarioEffettivoPartenzaDescrizione ||
                stopMatch.binarioEffettivoPartenzaCodice ||
                undefined
            );
            if (resolvedPlat) break;
          }
        }
      }

      if (resolvedPlat) {
        platformMissCache.delete(platformKey);
        stationTrainPlatformIndex.set(indexKey, resolvedPlat);
        plannedPlatformCache.set(platformKey, { timestamp: Date.now(), platform: resolvedPlat });
        void persistPlatformEntry(platformKey, resolvedPlat);
        return resolvedPlat;
      }
      platformMissCache.set(platformKey, Date.now());
    } catch {}
    return undefined;
  })().finally(() => {
    if (platformInFlight.get(platformKey) === task) {
      platformInFlight.delete(platformKey);
    }
  });

  if (!options.forceRefresh) {
    platformInFlight.set(platformKey, task);
  }
  return task;
}

/**
 * Trova il treno regionale ottimale (privilegiando Regionale Veloce)
 * e fornisce le alternative disponibili prima e dopo per il tragitto pendolare.
 */
export async function findOptimalCommuterTrain(options: OptimalTrainOptions): Promise<OptimalTrainResult> {
  const {
    direction,
    departureStation: rawDepartureStation,
    arrivalStation: rawArrivalStation,
    targetTimeStr,
    targetDate = new Date(),
    trainOffset = 0,
    selectedTrainNumber,
    forceRefresh = false,
    minDepartureMins,
    ignoreCurrentTime = false,
    includeIntercity = false,
    preferredDepartureTime,
    scheduledOnly = false,
  } = options;

  const departureStation = normalizeStationInfo(rawDepartureStation);
  const arrivalStation = normalizeStationInfo(rawArrivalStation);

  const isOutbound = direction === 'outbound';
  const now = new Date();
  const isRequestedToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();
  const isToday = !ignoreCurrentTime && isRequestedToday;

  // Se si richiede l'orario programmato canonico (ignoreCurrentTime = true) e la data passata è oggi,
  // sposta la data di interrogazione a +7 giorni (stesso giorno della settimana futura):
  // ViaggiaTreno rimuove dal tabellone odierno i treni già partiti o soppressi in giornata.
  const effectiveQueryDate =
    ignoreCurrentTime && isRequestedToday
      ? new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate() + 7,
          targetDate.getHours(),
          targetDate.getMinutes(),
          0,
          0
        )
      : targetDate;

  const effectiveDateIso = `${effectiveQueryDate.getFullYear()}-${String(effectiveQueryDate.getMonth() + 1).padStart(2, '0')}-${String(effectiveQueryDate.getDate()).padStart(2, '0')}`;

  // 1. In modalità scheduledOnly (es. sync calendario veloce) usa prima GTFS e chiama ViaggiaTreno solo come fallback;
  // altrimenti interroga ViaggiaTreno in tempo reale + GTFS in parallelo.
  let liveTrains: LiveTrainInfo[] = [];
  let fullDayTrains: LiveTrainInfo[] = [];

  if (scheduledOnly) {
    fullDayTrains = await fetchDynamicFullDayRailTimetable(
      departureStation,
      arrivalStation,
      effectiveQueryDate,
      includeIntercity,
      forceRefresh
    );
    if (fullDayTrains.length === 0) {
      liveTrains = await fetchLiveTrenitaliaTimetable(
        departureStation.code,
        arrivalStation.code,
        effectiveQueryDate,
        targetTimeStr,
        direction,
        forceRefresh,
        ignoreCurrentTime,
        includeIntercity
      );
    }
  } else {
    [liveTrains, fullDayTrains] = await Promise.all([
      fetchLiveTrenitaliaTimetable(
        departureStation.code,
        arrivalStation.code,
        effectiveQueryDate,
        targetTimeStr,
        direction,
        forceRefresh,
        ignoreCurrentTime,
        includeIntercity
      ),
      fetchDynamicFullDayRailTimetable(
        departureStation,
        arrivalStation,
        effectiveQueryDate,
        includeIntercity,
        forceRefresh
      ),
    ]);
  }

  const liveMap = new Map<string, LiveTrainInfo>();
  for (const t of liveTrains) {
    const clean = t.trainNumber.replace(/\D/g, '');
    if (clean) liveMap.set(clean, t);
  }

  const allTrains: LiveTrainInfo[] = [];
  const nowMinsCurrent = now.getHours() * 60 + now.getMinutes();

  if (fullDayTrains.length > 0) {
    for (const ft of fullDayTrains) {
      const clean = ft.trainNumber.replace(/\D/g, '');
      const live = liveMap.get(clean);
      if (live) {
        if (ignoreCurrentTime) {
          // Per sincronizzazione calendario o calcoli standard, non applicare ritardi/stati temporanei di oggi
          allTrains.push({
            ...live,
            departureTimeActual: live.departureTimePlanned || ft.departureTimePlanned,
            arrivalTimeActual: live.arrivalTimePlanned || ft.arrivalTimePlanned,
            delayMinutes: 0,
            isDeparted: false,
            isDepartedFromStation: false,
            isLive: false,
            statusDescription: 'Programmato',
          });
        } else {
          allTrains.push(live);
        }
        liveMap.delete(clean);
      } else {
        const depM = parseTimeToMinutes(ft.departureTimePlanned);
        const isPassed = isToday && nowMinsCurrent > depM + 3;
        const cachedPlat =
          ft.platformPlanned ||
          stationTrainPlatformIndex.get(`${departureStation.code}_${clean}_${effectiveDateIso}`);
        allTrains.push({
          ...ft,
          platformPlanned: cachedPlat,
          isDeparted: isPassed,
          isDepartedFromStation: isPassed,
          statusDescription: isToday ? (isPassed ? 'In viaggio' : 'Programmato') : 'Programmato',
        });
      }
    }
    // Aggiungi eventuali corse straordinarie presenti in ViaggiaTreno ma non in GTFS
    for (const lt of liveMap.values()) {
      allTrains.push(lt);
    }
  } else {
    allTrains.push(...liveTrains);
  }

  // Se la data richiesta NON è oggi (es. giorni precedenti o successivi),
  // azzera qualsiasi residuo di stato live, ritardi o soppressioni di oggi:
  // l'utente deve poter consultare l'orario ufficiale programmato.
  if (!isToday) {
    for (const t of allTrains) {
      t.isLive = false;
      t.delayMinutes = 0;
      t.departureTimeActual = t.departureTimePlanned;
      t.arrivalTimeActual = t.arrivalTimePlanned;
      t.platformActual = t.platformPlanned;
      t.statusDescription = 'Programmato';
      t.isDeparted = false;
      t.isDepartedFromStation = false;
      t.isStoppedInStation = false;
      t.stoppedStationName = undefined;
      t.stoppedStationEstimatedDep = undefined;
      t.alertMessage = undefined;
      t.capacityWarning = undefined;
    }
  }

  // Se è oggi, applica prima eventuali dati già presenti in andamentoMemoryCache a tutti i treni della lista
  // in modo che slider e selezione non mostrino mai stati non ancora allineati con andamentoTreno.
  if (isToday && !scheduledOnly) {
    for (let i = 0; i < allTrains.length; i++) {
      const copy = { ...allTrains[i] };
      enrichTrainFromCachedAndamento(copy, departureStation, arrivalStation);
      allTrains[i] = copy;
    }
  }

  // Ordina tutti i treni cronologicamente per orario di partenza
  allTrains.sort(
    (a, b) =>
      parseTimeToMinutes(a.departureTimePlanned) -
      parseTimeToMinutes(b.departureTimePlanned)
  );

  // 3. Algoritmo di selezione del treno migliore (Regionale Veloce preferito)
  const targetMins = parseTimeToMinutes(targetTimeStr);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Se è oggi, per treni che hanno problemi REALI alla partenza o sono fermi in stazione oltre l'orario:
  if (isToday) {
    for (const t of allTrains) {
      if (
        t.isDepartedFromStation === false &&
        (t.isDeparted === false || t.isStoppedInStation === true)
      ) {
        const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
        if (nowMins >= depPlanM && nowMins - depPlanM <= 120) {
          const lateM = nowMins - depPlanM;
          const effectiveLate = Math.max(t.delayMinutes || 0, lateM);
          t.delayMinutes = effectiveLate;
          t.departureTimeActual = minutesToTime(depPlanM + effectiveLate);
          if (t.arrivalTimePlanned) {
            const arrPlanM = parseTimeToMinutes(t.arrivalTimePlanned);
            t.arrivalTimeActual = minutesToTime(arrPlanM + effectiveLate);
          }
        }
      }

      // Per qualsiasi treno con ritardo o fermo in stazione, assicura che departureTimeActual e arrivalTimeActual
      // siano sincronizzati con il ritardo effettivo rispetto al programma affinché l'orario programmato appaia barrato nell'UI
      if (t.isLive && t.delayMinutes > 0) {
        // Se il treno NON è ancora partito dalla stazione del pendolare, propaga il ritardo rispetto al programma:
        if (!t.isDepartedFromStation && t.departureTimePlanned) {
          const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
          if (t.isStoppedInStation) {
            const lateM = Math.max(
              t.delayMinutes,
              nowMins > depPlanM ? nowMins - depPlanM : 0
            );
            t.departureTimeActual = minutesToTime(depPlanM + lateM);
            t.departureDelayAtStation = lateM;
          } else {
            // Convoglio ancora in linea verso questa stazione
            const expDepActual = minutesToTime(depPlanM + t.delayMinutes);
            if (!t.departureTimeActual || parseTimeToMinutes(t.departureTimeActual) < parseTimeToMinutes(expDepActual)) {
              t.departureTimeActual = expDepActual;
            }
          }
        }
        // L'arrivo alla destinazione finale invece risente sempre del ritardo globale attuale
        if (t.arrivalTimePlanned) {
          const arrPlanM = parseTimeToMinutes(t.arrivalTimePlanned);
          const expArrActual = minutesToTime(arrPlanM + t.delayMinutes);
          if (!t.arrivalTimeActual || parseTimeToMinutes(t.arrivalTimeActual) < parseTimeToMinutes(expArrActual)) {
            t.arrivalTimeActual = expArrActual;
          }
        }
      }
    }
  }

  // Verifica se un treno è prendibile dal viaggiatore:
  // se è oggi, esclude treni già partiti dalla stazione di riferimento o treni che partono prima
  // del tempo minimo necessario al passeggero per raggiungere la stazione (minDepartureMins o nowMins)
  const isTrainCatchable = (t: LiveTrainInfo) => {
    if (!isToday) return true;
    if (t.isDepartedFromStation) return false;
    const depM = parseTimeToMinutes(t.departureTimeActual || t.departureTimePlanned);
    const effectiveMinDep = minDepartureMins != null ? minDepartureMins : nowMins;
    // Un treno la cui partenza effettiva o programmata è precedente al tempo di arrivo in stazione non è prendibile
    if (depM < effectiveMinDep) return false;
    return true;
  };

  let recommendedIdx = 0;
  const isFastOrIC = (t: LiveTrainInfo) => Boolean(t.isFast || t.category === 'IC');

  if (isOutbound) {
    // Cerchiamo treni che arrivano in tempo (entro targetMins + 3 di tolleranza) e prendibili
    const onTimeIndices: number[] = [];
    allTrains.forEach((t, idx) => {
      const arr = parseTimeToMinutes(t.arrivalTimePlanned || t.arrivalTimeActual || '');
      if (arr <= targetMins + 3 && isTrainCatchable(t)) {
        onTimeIndices.push(idx);
      }
    });

    if (onTimeIndices.length > 0) {
      // 'fast_first': nella finestra utile precedente (ultimi 80 minuti prima del target) privilegia RV/IC
      const windowIndices = onTimeIndices.filter((idx) => {
        const arr = parseTimeToMinutes(allTrains[idx].arrivalTimePlanned || '');
        return arr >= targetMins - 80;
      });

      const rvInWindow = windowIndices.filter((idx) => isFastOrIC(allTrains[idx]));

      if (rvInWindow.length > 0) {
        recommendedIdx = rvInWindow[rvInWindow.length - 1];
      } else if (windowIndices.length > 0) {
        recommendedIdx = windowIndices[windowIndices.length - 1];
      } else {
        recommendedIdx = onTimeIndices[onTimeIndices.length - 1];
      }
    } else {
      // Se nessun treno prendibile arriva prima della lezione (es. treni prima già partiti):
      // Targetta il PROSSIMO treno in partenza dalla stazione di riferimento
      if (isToday) {
        const nextCatchableIdx = allTrains.findIndex((t) => isTrainCatchable(t));
        if (nextCatchableIdx !== -1) {
          recommendedIdx = nextCatchableIdx;
        } else {
          recommendedIdx = Math.max(0, allTrains.length - 1);
        }
      } else {
        recommendedIdx = 0;
      }
    }

    // Treno preferito dall'utente (match per orario di partenza): sovrascrive sempre la scelta consigliata se prendibile
    if (preferredDepartureTime) {
      const targetPrefMins = parseTimeToMinutes(preferredDepartureTime);
      const prefIdx = allTrains.findIndex((t) => {
        const depStr = t.departureTimePlanned || t.departureTimeActual || '';
        const depMatch =
          depStr === preferredDepartureTime ||
          (targetPrefMins > 0 && parseTimeToMinutes(depStr) === targetPrefMins);
        return depMatch && isTrainCatchable(t);
      });
      if (prefIdx !== -1) recommendedIdx = prefIdx;
    }
  } else {
    // Ritorno: primo treno che parte dopo l'orario di fine lezione + rientro in stazione
    const eligibleIndices: number[] = [];
    allTrains.forEach((t, idx) => {
      const dep = parseTimeToMinutes(t.departureTimePlanned || t.departureTimeActual || '');
      if (dep >= targetMins && isTrainCatchable(t)) {
        eligibleIndices.push(idx);
      }
    });

    if (eligibleIndices.length > 0) {
      // Nei primi 75 minuti successivi, privilegia RV/IC se disponibile
      const soonIndices = eligibleIndices.filter((idx) => {
        const dep = parseTimeToMinutes(allTrains[idx].departureTimePlanned || '');
        return dep <= targetMins + 75;
      });

      const rvSoon = soonIndices.filter((idx) => isFastOrIC(allTrains[idx]));
      if (rvSoon.length > 0) {
        recommendedIdx = rvSoon[0];
      } else {
        recommendedIdx = eligibleIndices[0];
      }
    } else if (isToday) {
      const nextCatchableIdx = allTrains.findIndex((t) => isTrainCatchable(t));
      recommendedIdx = nextCatchableIdx !== -1 ? nextCatchableIdx : Math.max(0, allTrains.length - 1);
    } else {
      recommendedIdx = Math.max(0, allTrains.length - 1);
    }

    // Treno preferito dall'utente (match per orario di partenza): sovrascrive sempre la scelta consigliata se prendibile
    if (preferredDepartureTime) {
      const targetPrefMins = parseTimeToMinutes(preferredDepartureTime);
      const prefIdx = allTrains.findIndex((t) => {
        const depStr = t.departureTimePlanned || t.departureTimeActual || '';
        const depMatch =
          depStr === preferredDepartureTime ||
          (targetPrefMins > 0 && parseTimeToMinutes(depStr) === targetPrefMins);
        return depMatch && isTrainCatchable(t);
      });
      if (prefIdx !== -1) recommendedIdx = prefIdx;
    }
  }

  // 4. Risolvi la scelta finale in base a offset o treno esplicitamente selezionato
  let selectedIndex = recommendedIdx;

  if (selectedTrainNumber) {
    const cleanNum = selectedTrainNumber.replace(/\D/g, '');
    const foundIdx = allTrains.findIndex((t) => t.trainNumber.replace(/\D/g, '') === cleanNum);
    if (foundIdx !== -1) {
      selectedIndex = foundIdx;
    }
  } else if (trainOffset !== 0) {
    selectedIndex = Math.max(0, Math.min(Math.max(0, allTrains.length - 1), recommendedIdx + trainOffset));
  }

  const selectedIndexSafe = Math.max(0, Math.min(Math.max(0, allTrains.length - 1), selectedIndex));
  const fallbackTrain: LiveTrainInfo = {
    trainNumber: 'REG',
    category: 'REG',
    destination: arrivalStation.name,
    originStationName: departureStation.name,
    originStationCode: departureStation.code,
    departureTimePlanned: '06:00',
    departureTimeActual: '06:00',
    departureMillis: targetDate.getTime(),
    arrivalTimePlanned: '06:45',
    arrivalTimeActual: '06:45',
    delayMinutes: 0,
    statusDescription: 'Non partito',
    isLive: false,
    durationMinutes: 45,
    isFast: false,
    isOriginStation: true,
  };

  const chosenTrain = allTrains[selectedIndexSafe]
    ? { ...allTrains[selectedIndexSafe] }
    : fallbackTrain;

  chosenTrain.hasEarlierTrain = selectedIndexSafe > 0;
  chosenTrain.hasLaterTrain = selectedIndexSafe < allTrains.length - 1;

  // Arricchisce SEMPRE il treno selezionato con la corsa reale (andamentoTreno) quando è oggi:
  // vale anche per i treni già arrivati / non più sul tabellone / provenienti dalla tabella statica.
  if (isToday) {
    const aData = await fetchSingleTrainAndamento(
      chosenTrain,
      departureStation,
      arrivalStation,
      targetDate.getTime(),
      forceRefresh
    );
    if (aData && applyAndamentoToTrain(chosenTrain, aData, departureStation, arrivalStation)) {
      allTrains[selectedIndexSafe] = chosenTrain;
    }
  }


  // Alternative da mostrare nello slider dell'interfaccia:
  // Include tutti i treni della tratta affinché l'utente possa scorrere all'indietro e in avanti liberamente,
  // visualizzando e selezionando anche i treni con orario antecedente.
  const availableTrains: LiveTrainInfo[] = allTrains.length > 0 ? allTrains : [chosenTrain];

  // Prefetch in background (non bloccante) di andamentoTreno per i 2 treni adiacenti nello slider,
  // applicando subito i dati al relativo LiveTrainInfo quando arrivano
  if (isToday && !scheduledOnly && availableTrains.length > 1) {
    const adjIndices = [selectedIndexSafe - 1, selectedIndexSafe + 1].filter(
      (idx) => idx >= 0 && idx < availableTrains.length && idx !== selectedIndexSafe
    );
    for (const idx of adjIndices) {
      const adjTrain = availableTrains[idx];
      if (adjTrain && !isTrainAndamentoFresh(adjTrain.trainNumber, departureStation, arrivalStation)) {
        void fetchSingleTrainAndamento(
          adjTrain,
          departureStation,
          arrivalStation,
          targetDate.getTime()
        )
          .then((adjData) => {
            if (adjData && Array.isArray(adjData.fermate) && adjData.fermate.length > 0) {
              applyAndamentoToTrain(adjTrain, adjData, departureStation, arrivalStation);
            }
          })
          .catch(() => null);
      }
    }
  }

  return {
    train: chosenTrain,
    availableTrains,
    selectedIndex: selectedIndexSafe,
    recommendedIndex: Math.max(0, Math.min(Math.max(0, availableTrains.length - 1), recommendedIdx)),
  };
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [hh, mm] = timeStr.split(':').map((v) => parseInt(v, 10) || 0);
  return hh * 60 + mm;
}

export function minutesToTime(mins: number): string {
  const norm = ((mins % 1440) + 1440) % 1440;
  const hh = Math.floor(norm / 60);
  const mm = norm % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export interface TrainStatusResult {
  statusType: 'scheduled' | 'running' | 'on_time' | 'delayed' | 'early' | 'cancelled' | 'diverted' | 'interrupted' | 'warning';
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  iconName: 'time-outline' | 'calendar-outline' | 'checkmark-circle-outline' | 'warning-outline' | 'flash-outline' | 'close-circle' | 'git-branch-outline' | 'alert-circle' | 'flag-outline' | 'train-outline' | 'pause-circle-outline';
  alertMessage?: string;
  capacityWarning?: string;
  delayBadge?: {
    label: string;
    color: string;
    bg: string;
    border: string;
    iconName?: string;
  };
  dwellBadge?: {
    label: string;
    color: string;
    bg: string;
    border: string;
  };
}

/**
 * Valuta lo stato effettivo e veritiero del treno secondo la logica Trenitalia / ViaggiaTreno:
 * 1. Se il treno ha avvisi di soppressione, deviazione o interruzione, li segnala immediatamente.
 * 2. Se la data target non è oggi (es. domani o futuro), lo stato è "Programmato".
 * 3. Se è oggi ma l'orario attuale è prima della partenza, è "Programmato".
 * 4. Se l'orario attuale è tra partenza e arrivo, indica lo stato reale del viaggio (in orario, ritardo, anticipo).
 * 5. Valuta la capienza ("Biglietti non acquistabili") senza inventare dati.
 */
export function evaluateTrainStatus(
  train: LiveTrainInfo,
  targetDate: Date = new Date(),
  stationName?: string
): TrainStatusResult {
  const now = new Date();
  const isToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();

  const descLower = (train.statusDescription || '').toLowerCase();
  const alertLower = (train.alertMessage || '').toLowerCase();

  // 1. Cancellato / Soppresso
  if (
    descLower.includes('soppresso') ||
    descLower.includes('cancellat') ||
    alertLower.includes('cancellat') ||
    alertLower.includes('soppresso')
  ) {
    return {
      statusType: 'cancelled',
      badgeLabel: 'Cancellato',
      badgeColor: '#ef4444',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeBorder: 'rgba(239, 68, 68, 0.3)',
      iconName: 'close-circle',
      alertMessage: train.alertMessage || 'Treno soppresso da Trenitalia',
      capacityWarning: train.capacityWarning,
    };
  }

  // 2. Interruzione linea
  if (descLower.includes('interruzi') || alertLower.includes('interruzi')) {
    return {
      statusType: 'interrupted',
      badgeLabel: 'Interruzione linea',
      badgeColor: '#ef4444',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeBorder: 'rgba(239, 68, 68, 0.3)',
      iconName: 'alert-circle',
      alertMessage: train.alertMessage || 'Interruzione linea comunicata da Trenitalia',
      capacityWarning: train.capacityWarning,
    };
  }

  // 3. Deviato / Variazione di percorso
  if (
    descLower.includes('deviato') ||
    alertLower.includes('deviato') ||
    alertLower.includes('variazione')
  ) {
    const delayVal = Math.max(0, train.delayMinutes || 0);
    const delayBadge = delayVal > 0 ? {
      label: `+${delayVal}m ritardo`,
      color: delayVal > 5 ? '#ef4444' : '#f59e0b',
      bg: delayVal > 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
      border: delayVal > 5 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)',
      iconName: 'warning-outline',
    } : undefined;

    return {
      statusType: 'diverted',
      badgeLabel: 'Deviato',
      badgeColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeBorder: 'rgba(245, 158, 11, 0.3)',
      iconName: 'git-branch-outline',
      alertMessage: train.alertMessage || 'Treno deviato su percorso alternativo da Trenitalia',
      capacityWarning: train.capacityWarning,
      delayBadge,
    };
  }

  // 4. Se la data di ricerca non è oggi (es. giorno precedente o successivo):
  if (!isToday) {
    return {
      statusType: 'scheduled',
      badgeLabel: 'Programmato',
      badgeColor: '#94a3b8',
      badgeBg: 'rgba(148, 163, 184, 0.12)',
      badgeBorder: 'rgba(148, 163, 184, 0.25)',
      iconName: 'calendar-outline',
    };
  }

  // 5. Se è oggi: verifica orario attuale rispetto alla corsa
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const plannedDepMins = parseTimeToMinutes(train.departureTimePlanned || '00:00');
  const actualArrMins = parseTimeToMinutes(
    train.arrivalTimeActual || train.arrivalTimePlanned || '00:00'
  );
  const isAtCommuterStation =
    !train.stoppedStationName ||
    !stationName ||
    isSameStation(train.stoppedStationName, stationName);

  const depStopIdxInTrain =
    Array.isArray(train.stops) && stationName
      ? train.stops.findIndex((s) => isSameStation(s.stationName, stationName))
      : -1;
  const searchStartIdx = depStopIdxInTrain >= 0 ? depStopIdxInTrain + 1 : 1;
  const hasRealProgressBeyondDep =
    Array.isArray(train.stops) &&
    train.stops.some(
      (s, idx) => idx >= searchStartIdx && (s.isPassed || s.isCurrent || Boolean(s.actualTime))
    );

  // ── CASO UNIFICATO: Treno NON ancora partito dalla stazione di partenza/origine ──
  const isNotYetDepartedFromOrigin =
    !hasRealProgressBeyondDep &&
    (train.isDeparted === false ||
      (isAtCommuterStation && train.isOriginStation && !train.isDepartedFromStation));

  if (isNotYetDepartedFromOrigin) {
    const programDelay = Math.max(
      0,
      train.delayMinutes || 0,
      isAtCommuterStation && nowMins > plannedDepMins ? nowMins - plannedDepMins : 0
    );
    const lateAccumulated = Math.max(
      programDelay,
      nowMins >= plannedDepMins ? nowMins - plannedDepMins : 0,
      train.stoppedMinutes || 0
    );

    // Se l'orario di partenza è già trascorso (corsa ritardata/ferma prima del via)
    if (nowMins >= plannedDepMins) {
      const delayInfo = lateAccumulated > 0 ? ` (+${lateAccumulated}m)` : '';
      return {
        statusType: lateAccumulated > 5 ? 'delayed' : lateAccumulated > 0 ? 'warning' : 'scheduled',
        badgeLabel: `Non partito${delayInfo}`,
        badgeColor: lateAccumulated > 5 ? '#ef4444' : lateAccumulated > 0 ? '#f59e0b' : '#94a3b8',
        badgeBg:
          lateAccumulated > 5
            ? 'rgba(239, 68, 68, 0.15)'
            : lateAccumulated > 0
            ? 'rgba(245, 158, 11, 0.15)'
            : 'rgba(148, 163, 184, 0.12)',
        badgeBorder:
          lateAccumulated > 5
            ? 'rgba(239, 68, 68, 0.3)'
            : lateAccumulated > 0
            ? 'rgba(245, 158, 11, 0.3)'
            : 'rgba(148, 163, 184, 0.25)',
        iconName: 'time-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    // Prima della partenza programmata: in attesa dell'orario al binario o programmato
    if (programDelay > 0) {
      return {
        statusType: 'delayed',
        badgeLabel: `Non partito (+${programDelay}m)`,
        badgeColor: programDelay > 5 ? '#ef4444' : '#f59e0b',
        badgeBg:
          programDelay > 5
            ? 'rgba(239, 68, 68, 0.15)'
            : 'rgba(245, 158, 11, 0.15)',
        badgeBorder:
          programDelay > 5
            ? 'rgba(239, 68, 68, 0.3)'
            : 'rgba(245, 158, 11, 0.3)',
        iconName: 'time-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    return {
      statusType: 'scheduled',
      badgeLabel: 'Non partito',
      badgeColor: '#94a3b8',
      badgeBg: 'rgba(148, 163, 184, 0.12)',
      badgeBorder: 'rgba(148, 163, 184, 0.25)',
      iconName: 'time-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Se il convoglio è fermo in una stazione intermedia lungo il percorso:
  if (train.isStoppedInStation) {
    const estimatedDepMins = parseTimeToMinutes(
      train.stoppedStationEstimatedDep || train.departureTimeActual || train.departureTimePlanned || '00:00'
    );
    const stName = train.stoppedStationName || stationName || 'Stazione';
    const extraPastEst = estimatedDepMins > 0 ? elapsedMinutesPast(estimatedDepMins, nowMins) : 0;
    const isLateBeyondDep = extraPastEst > 0;
    const programDelay = Math.max(0, train.delayMinutes || 0) + extraPastEst;
    const stoppedTime = train.stoppedMinutes ?? (isLateBeyondDep ? extraPastEst : undefined);

    const delayBadge = programDelay > 0 ? {
      label: `+${programDelay}m ritardo`,
      color: programDelay > 5 ? '#ef4444' : '#f59e0b',
      bg: programDelay > 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
      border: programDelay > 5 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)',
      iconName: 'warning-outline',
    } : undefined;

    // Se è fermo regolarmente entro la partenza stimata e senza ritardo: mostra il badge azzurro "Fermo a [Stazione]"
    // (ed eventuale badge "Anticipo (Xm)" se è arrivato in anticipo alla stazione, senza modificare gli orari)
    if (!isLateBeyondDep && programDelay === 0) {
      const earlyBadge =
        train.delayMinutes < 0
          ? {
              label: `Anticipo (${Math.abs(train.delayMinutes)}m)`,
              color: '#10b981',
              bg: 'rgba(16, 185, 129, 0.15)',
              border: 'rgba(16, 185, 129, 0.3)',
              iconName: 'flash-outline',
            }
          : undefined;
      return {
        statusType: 'running',
        badgeLabel: `Fermo a ${stName}`,
        badgeColor: '#38bdf8',
        badgeBg: 'rgba(56, 189, 248, 0.15)',
        badgeBorder: 'rgba(56, 189, 248, 0.3)',
        iconName: 'pause-circle-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
        delayBadge: earlyBadge,
        dwellBadge: undefined,
      };
    }

    // Se è fermo oltre la partenza stimata o ha ritardo accumulato:
    const stoppedInfo = programDelay === 0 && stoppedTime !== undefined && stoppedTime > 0
      ? ` (da ${stoppedTime}m)`
      : '';

    const dwellBadge = (programDelay > 0 && stoppedTime !== undefined && stoppedTime > 0) ? {
      label: `In banchina da ${stoppedTime}m`,
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.25)',
    } : undefined;

    return {
      statusType: programDelay > 5 ? 'delayed' : programDelay > 0 ? 'warning' : 'running',
      badgeLabel: `Fermo a ${stName}${stoppedInfo}`,
      badgeColor: programDelay > 5 ? '#ef4444' : programDelay > 0 ? '#f59e0b' : '#38bdf8',
      badgeBg:
        programDelay > 5
          ? 'rgba(239, 68, 68, 0.15)'
          : programDelay > 0
          ? 'rgba(245, 158, 11, 0.15)'
          : 'rgba(56, 189, 248, 0.15)',
      badgeBorder:
        programDelay > 5
          ? 'rgba(239, 68, 68, 0.3)'
          : programDelay > 0
          ? 'rgba(245, 158, 11, 0.3)'
          : 'rgba(56, 189, 248, 0.3)',
      iconName: 'pause-circle-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
      delayBadge,
      dwellBadge,
    };
  }

  // Se il treno è già passato per la stazione di riferimento del pendolare:
  if (train.isDepartedFromStation) {
    const delayBadge =
      train.delayMinutes > 0
        ? {
            label: `+${train.delayMinutes}m ritardo`,
            color: train.delayMinutes > 5 ? '#ef4444' : '#f59e0b',
            bg: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            border: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)',
            iconName: 'warning-outline',
          }
        : train.delayMinutes < 0
        ? {
            label: `Anticipo (${Math.abs(train.delayMinutes)}m)`,
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.15)',
            border: 'rgba(16, 185, 129, 0.3)',
            iconName: 'checkmark-circle-outline',
          }
        : undefined;

    const isTrainArrivedAtDest = Boolean(
      train.isArrivedAtDestination ||
      train.trainStatusType === 'arrived' ||
      (train.statusDescription && train.statusDescription.toLowerCase().includes('arrivato')) ||
      (train.isDepartedFromStation && actualArrMins > 0 && nowMins >= actualArrMins) ||
      (actualArrMins > 0 && nowMins >= actualArrMins && train.isDeparted)
    );

    if (isTrainArrivedAtDest) {
      const finalDelay = train.arrivalDelayAtStation !== undefined
        ? train.arrivalDelayAtStation
        : train.delayMinutes;

      // Per i treni già arrivati non si mostra il badge di ritardo/anticipo nell'intestazione:
      // restano solo gli orari effettivi con l'indicazione compatta sotto l'orario.
      return {
        statusType: finalDelay > 0 ? 'delayed' : 'on_time',
        badgeLabel: 'Arrivato',
        badgeColor: '#64748b',
        badgeBg: 'rgba(100, 116, 139, 0.15)',
        badgeBorder: 'rgba(100, 116, 139, 0.25)',
        iconName: 'flag-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
        delayBadge: undefined,
      };
    }

    return {
      statusType: train.delayMinutes > 0 ? 'delayed' : 'running',
      badgeLabel: 'In viaggio',
      badgeColor: '#64748b',
      badgeBg: 'rgba(100, 116, 139, 0.15)',
      badgeBorder: 'rgba(100, 116, 139, 0.25)',
      iconName: 'train-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
      delayBadge,
    };
  }

  // Caso 5A: Treno deve ancora passare da questa stazione (orario attuale strettamente prima della partenza programmata)
  if (nowMins < plannedDepMins) {
    // 1. Ha già un ritardo calcolato/comunicato da Trenitalia
    if (train.delayMinutes > 0) {
      return {
        statusType: 'delayed',
        badgeLabel: `+${train.delayMinutes}m ritardo`,
        badgeColor: train.delayMinutes > 5 ? '#ef4444' : '#f59e0b',
        badgeBg: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
        badgeBorder: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)',
        iconName: 'warning-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    // 2. È in anticipo rispetto alla marcia prevista
    if (train.delayMinutes < 0) {
      return {
        statusType: 'early',
        badgeLabel: `Anticipo (${Math.abs(train.delayMinutes)}m)`,
        badgeColor: '#10b981',
        badgeBg: 'rgba(16, 185, 129, 0.15)',
        badgeBorder: 'rgba(16, 185, 129, 0.3)',
        iconName: 'flash-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    // 3. Treno che parte direttamente da questa stazione o che non è ancora partito dall'origine
    if (train.isOriginStation || train.isDeparted === false || !train.isLive) {
      return {
        statusType: 'scheduled',
        badgeLabel: 'Non partito',
        badgeColor: '#94a3b8',
        badgeBg: 'rgba(148, 163, 184, 0.12)',
        badgeBorder: 'rgba(148, 163, 184, 0.25)',
        iconName: 'time-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    // 4. Treno passante che è già partito dall'origine remota ed è in viaggio verso qui (in orario)
    if (train.isLive && train.isDeparted) {
      return {
        statusType: 'running',
        badgeLabel: 'In orario',
        badgeColor: '#34c759',
        badgeBg: 'rgba(52, 199, 89, 0.15)',
        badgeBorder: 'rgba(52, 199, 89, 0.3)',
        iconName: 'checkmark-circle-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    // 5. Default per treni programmati
    return {
      statusType: 'scheduled',
      badgeLabel: 'Non partito',
      badgeColor: '#94a3b8',
      badgeBg: 'rgba(148, 163, 184, 0.12)',
      badgeBorder: 'rgba(148, 163, 184, 0.25)',
      iconName: 'time-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Caso 5B: Treno in viaggio (ha già lasciato l'origine ed è in marcia sulla linea o in avvicinamento)
  if (train.delayMinutes > 0) {
    return {
      statusType: 'delayed',
      badgeLabel: `+${train.delayMinutes}m ritardo`,
      badgeColor: train.delayMinutes > 5 ? '#ef4444' : '#f59e0b',
      badgeBg: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
      badgeBorder: train.delayMinutes > 5 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)',
      iconName: 'warning-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  } else if (train.delayMinutes < 0) {
    return {
      statusType: 'early',
      badgeLabel: `Anticipo (${Math.abs(train.delayMinutes)}m)`,
      badgeColor: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeBorder: 'rgba(16, 185, 129, 0.3)',
      iconName: 'flash-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  } else {
    return {
      statusType: 'running',
      badgeLabel: 'In orario',
      badgeColor: '#34c759',
      badgeBg: 'rgba(52, 199, 89, 0.15)',
      badgeBorder: 'rgba(52, 199, 89, 0.3)',
      iconName: 'checkmark-circle-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }
}
