import { StationInfo, LiveTrainInfo } from '../types/commuter';

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
}
const timetableCache = new Map<string, TimetableCacheEntry>();

export function clearTrenitaliaCache(): void {
  timetableCache.clear();
}

/**
 * Fetch JSON con timeout snello (4.5s) per singola richiesta.
 * Supporta fallback automatico tra HTTP diretto (veloce, senza 301) e HTTPS.
 * Ritorna null se la richiesta fallisce definitivamente (diverso da lista vuota valida).
 */
async function fetchViaggiaTrenoJson(url: string, timeoutMs = 4500, retries = 1): Promise<any | null> {
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
        try {
          const json = JSON.parse(text);
          fetchOk++;
          return json;
        } catch (e: any) {
          lastFetchError = `risposta non valida (${text.length} caratteri): ${String(e?.message || e).slice(0, 60)}`;
        }
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
  { name: 'ORTE', code: 'S08209', shortName: 'Orte' },
  { name: 'ROMA TIBURTINA', code: 'S08217', shortName: 'Roma Tiburtina' },
  { name: 'ROMA TERMINI', code: 'S08409', shortName: 'Roma Termini' },
  { name: 'ROMA OSTIENSE', code: 'S08419', shortName: 'Roma Ostiense' },
  { name: 'ROMA TUSCOLANA', code: 'S08417', shortName: 'Roma Tuscolana' },
  { name: 'NARNI-AMELIA', code: 'S08208', shortName: 'Narni-Amelia' },
  { name: 'TERNI', code: 'S08207', shortName: 'Terni' },
  { name: 'PERUGIA', code: 'S07004', shortName: 'Perugia' },
  { name: 'PERUGIA PONTE SAN GIOVANNI', code: 'S07003', shortName: 'Perugia P.S.G.' },
  { name: 'ANCONA', code: 'S07113', shortName: 'Ancona' },
  { name: 'FOLIGNO', code: 'S07204', shortName: 'Foligno' },
  { name: 'SPOLETO', code: 'S07200', shortName: 'Spoleto' },
  { name: 'ASSISI', code: 'S07207', shortName: 'Assisi' },
  { name: 'BASTIA UMBRA', code: 'S07208', shortName: 'Bastia' },
  { name: 'FABRIANO', code: 'S07214', shortName: 'Fabriano' },
  { name: 'JESI', code: 'S07218', shortName: 'Jesi' },
  { name: 'FALCONARA MARITTIMA', code: 'S07106', shortName: 'Falconara M.' },
  { name: 'PESARO', code: 'S07100', shortName: 'Pesaro' },
  { name: 'VITERBO PORTA FIORENTINA', code: 'S08005', shortName: 'Viterbo P. Fiorentina' },
  { name: 'VITERBO PORTA ROMANA', code: 'S08006', shortName: 'Viterbo P. Romana' },
  { name: 'CIVITA CASTELLANA-MAGLIANO', code: 'S08211', shortName: 'Civita Castellana' },
  { name: 'FARA SABINA-MONTELIBRETTI', code: 'S08214', shortName: 'Fara Sabina' },
  { name: 'MONTEROTONDO-MENTANA', code: 'S08216', shortName: 'Monterotondo' },
  { name: 'ORVIETO', code: 'S08300', shortName: 'Orvieto' },
  { name: 'ALVIANO', code: 'S08302', shortName: 'Alviano' },
  { name: 'ATTIGLIANO-BOMARZO', code: 'S08303', shortName: 'Attigliano' },
  { name: 'CHIUSI-CHIANCIANO TERME', code: 'S08304', shortName: 'Chiusi-Chianciano' },
  { name: 'AREZZO', code: 'S06311', shortName: 'Arezzo' },
  { name: 'FIRENZE SANTA MARIA NOVELLA', code: 'S06400', shortName: 'Firenze SMN' },
  { name: 'FIRENZE CAMPO DI MARTE', code: 'S06421', shortName: 'Firenze Campo Marte' },
  { name: 'RIETI', code: 'S08030', shortName: 'Rieti' },
  { name: 'POGGIO MIRTETO', code: 'S08213', shortName: 'Poggio Mirteto' },
  { name: 'PESCARA', code: 'S07810', shortName: 'Pescara' },
  { name: 'CASERTA', code: 'S09211', shortName: 'Caserta' },
  { name: 'NAPOLI CENTRALE', code: 'S09218', shortName: 'Napoli C.le' },
  { name: 'NETTUNO', code: 'S08710', shortName: 'Nettuno' },
  { name: 'GROSSETO', code: 'S06039', shortName: 'Grosseto' },
  { name: 'FIUMICINO AEROPORTO', code: 'S08500', shortName: 'Fiumicino Aeroporto' },
];

/**
 * Cerca stazioni tramite ViaggiaTreno API, combinando i risultati con le stazioni frequenti
 */
export async function searchStations(query: string): Promise<StationInfo[]> {
  const cleanQ = query.trim().toUpperCase();
  if (!cleanQ) return POPULAR_STATIONS;

  const localMatches = POPULAR_STATIONS.filter(
    (s) => s.name.includes(cleanQ) || (s.shortName && s.shortName.toUpperCase().includes(cleanQ))
  );

  if (cleanQ.length < 3) {
    return localMatches;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(
      `${VIAGGIATRENO_BASE_URL}/autocompletaStazione/${encodeURIComponent(cleanQ)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const remoteMatches: StationInfo[] = [];

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const code = parts[1].trim();
          if (name && code && !remoteMatches.some((m) => m.code === code)) {
            remoteMatches.push({
              name,
              code,
              shortName: formatStationName(name),
            });
          }
        }
      }

      // Unisci senza duplicati
      const combined = [...localMatches];
      for (const r of remoteMatches) {
        if (!combined.some((c) => c.code === r.code)) {
          combined.push(r);
        }
      }
      return combined;
    }
  } catch {}

  return localMatches;
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

/**
 * Ottiene i treni in partenza in tempo reale da una stazione
 */
export async function getLiveStationDepartures(
  stationCode: string,
  targetDate: Date = new Date()
): Promise<LiveTrainInfo[]> {
  try {
    const dateStr = encodeURIComponent(formatViaggiaTrenoDate(targetDate));
    const url = `${VIAGGIATRENO_BASE_URL}/partenze/${stationCode}/${dateStr}`;

    const rawList = await fetchViaggiaTrenoJson(url);
    if (!Array.isArray(rawList)) return [];

    const results: LiveTrainInfo[] = [];

    for (const raw of rawList) {
      const catRaw = (raw.categoriaDescrizione || raw.categoria || '').toUpperCase();
      // STRETTO: Solo treni Regionali o Regionali Veloci (escludi AV, Frecciarossa, Italo, Intercity)
      const isRegional =
        catRaw.includes('REG') ||
        catRaw.includes('RV') ||
        catRaw === 'R' ||
        catRaw.includes('REGIONALE');

      if (!isRegional) continue;
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

      const isInStationAtDep = Boolean(
        !isPartitoAtStation &&
        (raw.inStazione === true ||
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

      // Se il treno è fermo in stazione e l'orario programmato di partenza è trascorso,
      // il ritardo si accumula minuto per minuto finché non parte:
      let effectiveDelay = delay;
      if (isStoppedInStation && nowMins > parseTimeToMinutes(plannedDep)) {
        const lateAccumulated = nowMins - parseTimeToMinutes(plannedDep);
        if (effectiveDelay < lateAccumulated) {
          effectiveDelay = lateAccumulated;
        }
        actualDep = minutesToTime(parseTimeToMinutes(plannedDep) + effectiveDelay);
      }

      // SOLO SE CI SONO PROBLEMI REALI ALLA PARTENZA PROPRIO (treno all'origine non ancora partito oltre l'orario):
      const isRealDepartureIssue =
        !isDepartedFromStation &&
        !isStoppedInStation &&
        raw.nonPartito === true &&
        nowMins > parseTimeToMinutes(plannedDep) &&
        nowMins - parseTimeToMinutes(plannedDep) <= 90;

      if (isRealDepartureIssue) {
        if (effectiveDelay <= 0) {
          effectiveDelay = nowMins - parseTimeToMinutes(plannedDep);
        }
        actualDep = minutesToTime(parseTimeToMinutes(plannedDep) + effectiveDelay);
      }

      let statusDescription = 'In orario';
      if (raw.provvedimento === 1 || raw.statoTreno === 'SOPPRESSO') {
        statusDescription = 'Soppresso';
      } else if (raw.provvedimento === 3 || raw.statoTreno === 'DEVIATO') {
        statusDescription = 'Deviato';
      } else if (isStoppedInStation) {
        statusDescription = effectiveDelay > 0 ? `Fermo a ${stoppedStationName} (+${effectiveDelay} min)` : `Fermo a ${stoppedStationName}`;
      } else if (isRealDepartureIssue) {
        statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
      } else if (isDepartedFromStation) {
        statusDescription = effectiveDelay > 0 ? `Già passato (+${effectiveDelay} min)` : 'Già passato';
      } else if (raw.nonPartito === true) {
        statusDescription = 'Non partito';
      } else if (effectiveDelay > 0) {
        statusDescription = `Ritardo di ${effectiveDelay} min`;
      } else if (effectiveDelay < 0) {
        statusDescription = `Anticipo di ${Math.abs(effectiveDelay)} min`;
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

      const isFast = catRaw.includes('RV') || catRaw.includes('VELOCE');

      const resolvedOriginName =
        (raw.origine && raw.origine.trim().length > 0)
          ? formatStationName(raw.origine)
          : isOriginStation
          ? getStationNameByCode(stationCode)
          : getStationNameByCode(raw.codOrigine || raw.idOrigine);

      results.push({
        trainNumber: raw.compNumeroTreno || `Treno ${raw.numeroTreno}`,
        category: isFast ? 'RV' : 'REG',
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
  if (!s || s === '-' || s === '--') return undefined;

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
  category: 'RV' | 'REG';
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
  category: 'RV' | 'REG';
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
  { trainNumber: 'RV 4256', category: 'RV', departureTime: '07:20', arrivalTimeTiburtina: '07:59', arrivalTimeTermini: '08:15', durationMinutesTiburtina: 39, durationMinutesTermini: 55, platformPlanned: '5', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4097', category: 'RV', departureTime: '07:28', arrivalTimeTiburtina: '08:03', arrivalTimeTermini: '08:19', durationMinutesTiburtina: 35, durationMinutesTermini: 51, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4523', category: 'RV', departureTime: '07:45', arrivalTimeTiburtina: '08:14', arrivalTimeTermini: '08:32', durationMinutesTiburtina: 29, durationMinutesTermini: 47, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4721', category: 'RV', departureTime: '08:05', arrivalTimeTiburtina: '08:39', arrivalTimeTermini: '08:57', durationMinutesTiburtina: 34, durationMinutesTermini: 52, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4519', category: 'REG', departureTime: '09:32', arrivalTimeTiburtina: '10:35', arrivalTimeTermini: '10:48', durationMinutesTiburtina: 63, durationMinutesTermini: 76, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4099', category: 'REG', departureTime: '09:40', arrivalTimeTiburtina: '10:49', arrivalTimeTermini: '11:02', durationMinutesTiburtina: 69, durationMinutesTermini: 82, platformPlanned: '3', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4153', category: 'RV', departureTime: '12:16', arrivalTimeTiburtina: '12:47', arrivalTimeTermini: '13:00', durationMinutesTiburtina: 31, durationMinutesTermini: 44, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4725', category: 'RV', departureTime: '13:52', arrivalTimeTiburtina: '14:28', arrivalTimeTermini: '14:40', durationMinutesTiburtina: 36, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4105', category: 'RV', departureTime: '16:11', arrivalTimeTiburtina: '16:48', arrivalTimeTermini: '17:00', durationMinutesTiburtina: 37, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4155', category: 'RV', departureTime: '17:10', arrivalTimeTiburtina: '17:46', arrivalTimeTermini: '18:00', durationMinutesTiburtina: 36, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4733', category: 'RV', departureTime: '17:56', arrivalTimeTiburtina: '18:30', arrivalTimeTermini: '18:45', durationMinutesTiburtina: 34, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4107', category: 'REG', departureTime: '18:15', arrivalTimeTiburtina: '19:35', arrivalTimeTermini: '19:48', durationMinutesTiburtina: 80, durationMinutesTermini: 93, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4537', category: 'REG', departureTime: '19:02', arrivalTimeTiburtina: '20:10', arrivalTimeTermini: '20:25', durationMinutesTiburtina: 68, durationMinutesTermini: 83, platformPlanned: '3', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4157', category: 'RV', departureTime: '21:47', arrivalTimeTiburtina: '22:21', arrivalTimeTermini: '22:35', durationMinutesTiburtina: 34, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4111', category: 'RV', departureTime: '22:25', arrivalTimeTiburtina: '23:01', arrivalTimeTermini: '23:15', durationMinutesTiburtina: 36, durationMinutesTermini: 50, platformPlanned: '3', destination: 'ROMA TERMINI' },
];

export const SCHEDULED_ROMA_TO_ORTE: ScheduledReturnTrainEntry[] = [
  { trainNumber: 'RV 4150', category: 'RV', departureTimeTiburtina: '05:55', arrivalTimeOrte: '06:32', durationMinutesTiburtina: 37, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'RV 4712', category: 'RV', departureTimeTiburtina: '06:53', arrivalTimeOrte: '07:36', durationMinutesTiburtina: 43, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'RV 4152', category: 'RV', departureTimeTiburtina: '09:33', arrivalTimeOrte: '10:11', durationMinutesTiburtina: 38, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4100', category: 'RV', departureTimeTiburtina: '11:08', arrivalTimeOrte: '11:47', durationMinutesTiburtina: 39, platformPlanned: '2', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 20635', category: 'REG', departureTimeTiburtina: '11:46', arrivalTimeOrte: '13:17', durationMinutesTiburtina: 91, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'REG 4512', category: 'REG', departureTimeTiburtina: '11:53', arrivalTimeOrte: '13:04', durationMinutesTiburtina: 71, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'REG 20643', category: 'REG', departureTimeTiburtina: '12:46', arrivalTimeOrte: '14:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4154', category: 'RV', departureTimeTiburtina: '13:29', arrivalTimeOrte: '14:03', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'REG 20653', category: 'REG', departureTimeTiburtina: '13:46', arrivalTimeOrte: '15:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4730', category: 'RV', departureTimeTiburtina: '14:28', arrivalTimeOrte: '15:07', durationMinutesTiburtina: 39, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'REG 20665', category: 'REG', departureTimeTiburtina: '14:46', arrivalTimeOrte: '16:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'REG 20677', category: 'REG', departureTimeTiburtina: '16:01', arrivalTimeOrte: '17:25', durationMinutesTiburtina: 84, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4156', category: 'RV', departureTimeTiburtina: '16:03', arrivalTimeOrte: '16:42', durationMinutesTiburtina: 39, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'REG 20683', category: 'REG', departureTimeTiburtina: '16:46', arrivalTimeOrte: '18:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4514', category: 'RV', departureTimeTiburtina: '17:09', arrivalTimeOrte: '17:45', durationMinutesTiburtina: 36, platformPlanned: '6', destination: 'FOLIGNO' },
  { trainNumber: 'RV 4106', category: 'RV', departureTimeTiburtina: '17:28', arrivalTimeOrte: '18:02', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4530', category: 'REG', departureTimeTiburtina: '17:37', arrivalTimeOrte: '18:53', durationMinutesTiburtina: 76, platformPlanned: '6', destination: 'VITERBO P. FIORENTINA' },
  { trainNumber: 'REG 20693', category: 'REG', departureTimeTiburtina: '17:46', arrivalTimeOrte: '19:12', durationMinutesTiburtina: 86, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4732', category: 'RV', departureTimeTiburtina: '18:10', arrivalTimeOrte: '18:45', durationMinutesTiburtina: 35, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'RV 4158', category: 'RV', departureTimeTiburtina: '18:41', arrivalTimeOrte: '19:15', durationMinutesTiburtina: 34, platformPlanned: '6', destination: 'ANCONA' },
  { trainNumber: 'RV 4734', category: 'RV', departureTimeTiburtina: '19:12', arrivalTimeOrte: '19:44', durationMinutesTiburtina: 32, platformPlanned: '6', destination: 'PERUGIA' },
  { trainNumber: 'RV 4534', category: 'RV', departureTimeTiburtina: '19:20', arrivalTimeOrte: '19:58', durationMinutesTiburtina: 38, platformPlanned: '6', destination: 'VITERBO P. FIORENTINA' },
  { trainNumber: 'RV 4110', category: 'RV', departureTimeTiburtina: '20:21', arrivalTimeOrte: '20:56', durationMinutesTiburtina: 35, platformPlanned: '6', destination: 'FIRENZE SMN' },
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
}

export interface OptimalTrainResult {
  train: LiveTrainInfo;
  availableTrains: LiveTrainInfo[];
  selectedIndex: number;
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
  forceRefresh = false
): Promise<LiveTrainInfo[]> {
  try {
    const isToday =
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

    // Verifica Cache in Memoria ad alte prestazioni
    const dateKey = `${targetDate.getFullYear()}-${targetDate.getMonth() + 1}-${targetDate.getDate()}`;
    const timeBucket = Math.floor(targetDepMins / 30);
    const cacheKey = `${depCode}_${arrCode}_${dateKey}_${timeBucket}_${direction}`;

    if (!forceRefresh) {
      const cached = timetableCache.get(cacheKey);
      if (cached && cached.trains.length > 0) {
        const ttl = isToday ? 45000 : 600000; // 45s oggi per ritardi live, 10m per giorni futuri
        if (Date.now() - cached.timestamp < ttl) {
          return cached.trains;
        }
      }
    }

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

    const depMap = new Map<string, any>();
    for (const list of depLists) {
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t.numeroTreno) {
            depMap.set(String(t.numeroTreno), t);
          }
        }
      }
    }

    const arrMap = new Map<string, any>();
    for (const list of arrLists) {
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t.numeroTreno) {
            arrMap.set(String(t.numeroTreno), t);
          }
        }
      }
    }

    const trains: LiveTrainInfo[] = [];
    const matchedNumbers = new Set<string>();

    for (const [num, dep] of depMap) {
      const catRaw = (dep.categoriaDescrizione || dep.categoria || '').toUpperCase();
      // STRETTO: Solo treni Regionali o Regionali Veloci (escludi AV, Frecciarossa, Italo, Intercity)
      const isRegional =
        catRaw.includes('REG') ||
        catRaw.includes('RV') ||
        catRaw === 'R' ||
        catRaw.includes('REGIONALE');

      if (!isRegional) continue;
      if (dep.provvedimento === 1 || dep.statoTreno === 'SOPPRESSO') continue;

      const arr = arrMap.get(num);
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

      // Durata ragionevole tra stazioni nella stessa direzione (tra 15 e 150 min)
      if (dur < 15 || dur > 150) continue;

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
      if (cleanLiveDep && parseTimeToMinutes(cleanLiveDep) >= parseTimeToMinutes(depPlanned)) {
        depActual = cleanLiveDep;
      } else if (delay > 0) {
        depActual = minutesToTime(dh * 60 + dm + delay);
      }

      let arrActual = arrPlanned;
      const cleanLiveArr = cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo);
      if (cleanLiveArr && parseTimeToMinutes(cleanLiveArr) >= parseTimeToMinutes(arrPlanned)) {
        arrActual = cleanLiveArr;
      } else if (delay > 0) {
        arrActual = minutesToTime(ah * 60 + am + delay);
      }

      const isPartitoAtStation =
        Array.isArray(dep.compInStazionePartenza) &&
        Boolean(dep.compInStazionePartenza[0]?.toLowerCase().includes('partito'));

      // In ViaggiaTreno, nonPartito: true indica che il treno NON è ancora partito dall'origine generale
      const isDeparted = Boolean(
        dep.nonPartito === false ||
        isPartitoAtStation ||
        (typeof dep.partenzaTreno === 'number' && dep.partenzaTreno > 0)
      );

      const isInStationAtDep = Boolean(
        isToday &&
        !isPartitoAtStation &&
        (dep.inStazione === true ||
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

      let isStoppedInStation = isInStationAtDep;
      let stoppedStationName = isInStationAtDep ? formatStationName(getStationNameByCode(depCode)) : undefined;

      // Se il treno è fermo in stazione alla partenza e l'orario programmato è già trascorso:
      // il ritardo si calcola minuto per minuto finché non parte
      let effectiveDelay = delay;
      if (isStoppedInStation && nowMins > parseTimeToMinutes(depPlanned)) {
        const lateAccumulated = nowMins - parseTimeToMinutes(depPlanned);
        if (effectiveDelay < lateAccumulated) {
          effectiveDelay = lateAccumulated;
        }
        depActual = minutesToTime(parseTimeToMinutes(depPlanned) + effectiveDelay);
        arrActual = minutesToTime(parseTimeToMinutes(arrPlanned) + effectiveDelay);
      }

      // SOLO SE CI SONO PROBLEMI REALI ALLA PARTENZA PROPRIO (treno fermo non ancora partito dall'origine):
      const isRealDepartureIssue =
        isToday &&
        !isDepartedFromStation &&
        !isStoppedInStation &&
        dep.nonPartito === true &&
        nowMins > parseTimeToMinutes(depPlanned) &&
        nowMins - parseTimeToMinutes(depPlanned) <= 90;

      if (isRealDepartureIssue) {
        if (effectiveDelay <= 0) {
          effectiveDelay = nowMins - parseTimeToMinutes(depPlanned);
        }
        depActual = minutesToTime(parseTimeToMinutes(depPlanned) + effectiveDelay);
        arrActual = minutesToTime(parseTimeToMinutes(arrPlanned) + effectiveDelay);
      }

      let statusDescription = 'In orario';
      if (isToday) {
        if (dep.provvedimento === 1 || dep.statoTreno === 'SOPPRESSO') {
          statusDescription = 'Soppresso';
        } else if (dep.provvedimento === 3 || dep.statoTreno === 'DEVIATO') {
          statusDescription = 'Deviato';
        } else if (isStoppedInStation) {
          statusDescription = effectiveDelay > 0 ? `Fermo a ${stoppedStationName} (+${effectiveDelay} min)` : `Fermo a ${stoppedStationName}`;
        } else if (isRealDepartureIssue) {
          statusDescription = effectiveDelay > 0 ? `Non partito (+${effectiveDelay} min)` : 'Non partito';
        } else if (isDepartedFromStation) {
          statusDescription = effectiveDelay > 0 ? `Già passato (+${effectiveDelay} min)` : 'Già passato';
        } else if (dep.nonPartito === true) {
          statusDescription = 'Non partito';
        } else if (effectiveDelay > 0) {
          statusDescription = `Ritardo di ${effectiveDelay} min`;
        } else if (effectiveDelay < 0) {
          statusDescription = `Anticipo di ${Math.abs(effectiveDelay)} min`;
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

      const isFast = catRaw.includes('RV') || catRaw.includes('VELOCE') || dur <= 45;
      const compNum = dep.compNumeroTreno || (isFast ? `RV ${num}` : `REG ${num}`);
      const trainNumber = isFast ? compNum.replace(/^REG\b/i, 'RV') : compNum;

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
        category: isFast ? 'RV' : 'REG',
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
        isStoppedInStation,
        stoppedStationName,
        alertMessage,
        capacityWarning,
        notPurchasable: isNotPurchasable,
      });

      matchedNumbers.add(String(num).replace(/\D/g, ''));
    }

    // RECUPERO TRENI GIÀ PARTITI DALLA STAZIONE DI PARTENZA MA ANCORA IN VIAGGIO VERSO DESTINAZIONE:
    // Quando un treno lascia la stazione di partenza da oltre 10-15 minuti, ViaggiaTreno lo rimuove
    // dall'endpoint /partenze. Tuttavia, il treno è ancora presente nell'endpoint /arrivi della stazione
    // di arrivo (arrMap) con ritardo reale e orario effettivo.
    // Verifichiamo i treni programmati della linea per recuperare quelli già passati ma non ancora arrivati al capolinea.
    if (isToday) {
      const isOrteToRoma =
        (depCode === 'S08209' && (arrCode === 'S08409' || arrCode === 'S08419')) ||
        (direction === 'outbound' && depCode === 'S08209');
      const isRomaToOrte =
        ((depCode === 'S08409' || depCode === 'S08419') && arrCode === 'S08209') ||
        (direction === 'return' && arrCode === 'S08209');

      if (isOrteToRoma || isRomaToOrte) {
        const scheduledList = isOrteToRoma ? SCHEDULED_ORTE_TO_ROMA : SCHEDULED_ROMA_TO_ORTE;
        for (const sched of scheduledList) {
          const cleanNum = sched.trainNumber.replace(/\D/g, '');
          if (matchedNumbers.has(cleanNum)) continue;

          const arr = arrMap.get(cleanNum);
          if (!arr) continue;

          // Se il treno è soppresso, saltalo
          if (arr.provvedimento === 1 || arr.statoTreno === 'SOPPRESSO') continue;

          const catRaw = (arr.categoriaDescrizione || arr.categoria || sched.category || '').toUpperCase();
          const isRegional =
            catRaw.includes('REG') ||
            catRaw.includes('RV') ||
            catRaw === 'R' ||
            catRaw.includes('REGIONALE');
          if (!isRegional) continue;

          let depPlanned = '';
          let arrPlanned = '';
          let dur = 0;
          const platformPlanned = sched.platformPlanned;

          if (isOrteToRoma) {
            const s = sched as ScheduledTrainEntry;
            depPlanned = s.departureTime;
            arrPlanned = arr.compOrarioArrivo || (arrCode === 'S08409' ? s.arrivalTimeTermini : s.arrivalTimeTiburtina);
            dur = arrCode === 'S08409' ? s.durationMinutesTermini : s.durationMinutesTiburtina;
          } else {
            const s = sched as ScheduledReturnTrainEntry;
            depPlanned = (depCode === 'S08409' && s.departureTimeTermini) ? s.departureTimeTermini : s.departureTimeTiburtina;
            arrPlanned = arr.compOrarioArrivo || s.arrivalTimeOrte;
            dur = s.durationMinutesTiburtina;
          }

          if (!depPlanned || !arrPlanned) continue;

          const depPlannedM = parseTimeToMinutes(depPlanned);
          const arrPlannedM = parseTimeToMinutes(arrPlanned);

          const liveDelay = typeof arr.ritardo === 'number' ? arr.ritardo : 0;
          const delay = liveDelay;

          let depActual = depPlanned;
          if (delay > 0) {
            depActual = minutesToTime(depPlannedM + delay);
          }

          let arrActual = arrPlanned;
          const cleanLiveArr = cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo);
          if (cleanLiveArr && parseTimeToMinutes(cleanLiveArr) >= arrPlannedM) {
            arrActual = cleanLiveArr;
          } else if (delay > 0) {
            arrActual = minutesToTime(arrPlannedM + delay);
          }

          const depActualM = parseTimeToMinutes(depActual);
          const isDeparted = Boolean(arr.nonPartito === false || arr.inStazione === true || arr.arrivato === true);

          // Il treno è già passato dalla stazione di partenza se l'orario effettivo di passaggio è trascorso
          const isDepartedFromStation = nowMins >= depActualM;

          let statusDescription = 'In orario';
          if (isDepartedFromStation) {
            statusDescription = delay > 0 ? `Già passato (+${delay} min)` : 'Già passato';
          } else if (arr.nonPartito === true) {
            statusDescription = 'Non partito';
          } else if (delay > 0) {
            statusDescription = `Ritardo di ${delay} min`;
          } else if (delay < 0) {
            statusDescription = `Anticipo di ${Math.abs(delay)} min`;
          }

          let alertMessage: string | undefined = undefined;
          const rawNotice = (arr.segnalazioni || arr.subTitle || arr.avviso || '').trim();
          const delayReason = (arr.motivoRitardoPrevalente || '').trim();
          if (rawNotice) {
            alertMessage = rawNotice;
          } else if (delayReason) {
            alertMessage = `Causa ritardo: ${delayReason}`;
          }

          const isFast = sched.category === 'RV';
          const isOriginStation = Boolean(
            (arr.codOrigine && arr.codOrigine === depCode) ||
            (arr.idOrigine && arr.idOrigine === depCode)
          );

          const rawOrigin = arr.origine && arr.origine.trim().length > 0 ? arr.origine : undefined;
          const codeOrigin = getStationNameByCode(arr.codOrigine || arr.idOrigine);
          const resolvedOriginName = rawOrigin
            ? formatStationName(rawOrigin)
            : (codeOrigin || (isOriginStation ? getStationNameByCode(depCode) : ''));

          trains.push({
            trainNumber: sched.trainNumber,
            category: sched.category,
            destination: sched.destination ? formatStationName(sched.destination) : (arr.destinazione ? formatStationName(arr.destinazione) : ''),
            originStationName: resolvedOriginName,
            originStationCode: arr.codOrigine || arr.idOrigine || undefined,
            departureTimePlanned: depPlanned,
            departureTimeActual: depActual,
            departureMillis: targetDate.getTime(),
            arrivalTimePlanned: arrPlanned,
            arrivalTimeActual: arrActual,
            platformPlanned: cleanPlatform(platformPlanned),
            platformActual: cleanPlatform(arr.binarioEffettivoArrivoDescrizione || arr.binarioProgrammatoArrivoDescrizione || platformPlanned),
            delayMinutes: delay,
            statusDescription,
            isLive: true,
            durationMinutes: dur,
            isFast,
            isOriginStation,
            isDeparted,
            isDepartedFromStation,
            alertMessage,
          });

          matchedNumbers.add(cleanNum);
        }
      }
    }

    // Arricchimento in tempo reale con andamentoTreno:
    // Rileva con precisione se un convoglio è attualmente fermo in una stazione (arrivato ma non partito)
    // o se ha già effettuato la partenza da una fermata specifica, calcolando il ritardo accumulato in banchina.
    if (isToday && trains.length > 0) {
      const activeCirculating = trains.filter(
        (t) =>
          t.isLive &&
          t.originStationCode &&
          t.departureMillis &&
          Math.abs(nowMins - parseTimeToMinutes(t.departureTimePlanned)) <= 120
      );

      if (activeCirculating.length > 0) {
        await Promise.all(
          activeCirculating.slice(0, 4).map(async (t) => {
            try {
              const cleanNum = t.trainNumber.replace(/\D/g, '');
              const url = `${VIAGGIATRENO_BASE_URL}/andamentoTreno/${t.originStationCode}/${cleanNum}/${t.departureMillis}`;
              const aData = await fetchViaggiaTrenoJson(url, 2500);
              if (!aData || !Array.isArray(aData.fermate)) return;

              const depStationFormatted = formatStationName(getStationNameByCode(depCode)).toLowerCase();

              // 1. Controlla la fermata corrispondente alla stazione di partenza del pendolare (depCode)
              const depStop = aData.fermate.find(
                (f: any) =>
                  f.id === depCode ||
                  (f.stazione && formatStationName(f.stazione).toLowerCase() === depStationFormatted)
              );

              if (depStop) {
                if (depStop.partenzaReale !== null && depStop.partenzaReale !== undefined) {
                  // Il treno è già partito da questa stazione!
                  t.isDepartedFromStation = true;
                  t.isStoppedInStation = false;
                  if (typeof depStop.ritardoPartenza === 'number') {
                    t.delayMinutes = depStop.ritardoPartenza;
                  }
                  t.statusDescription =
                    t.delayMinutes > 0
                      ? `Già passato (+${t.delayMinutes} min)`
                      : 'Già passato';
                  return;
                }

                if (
                  depStop.arrivoReale !== null &&
                  depStop.arrivoReale !== undefined &&
                  (depStop.partenzaReale === null || depStop.partenzaReale === undefined)
                ) {
                  // Il treno è arrivato a questa stazione ma non è ancora partito: è fermo al binario!
                  t.isDepartedFromStation = false;
                  t.isStoppedInStation = true;
                  t.stoppedStationName = formatStationName(
                    depStop.stazione || getStationNameByCode(depCode)
                  );

                  const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
                  const accLate = Math.max(
                    typeof aData.ritardo === 'number' ? aData.ritardo : t.delayMinutes,
                    nowMins > depPlanM ? nowMins - depPlanM : 0
                  );
                  t.delayMinutes = accLate;
                  t.departureTimeActual = minutesToTime(depPlanM + accLate);
                  if (t.arrivalTimePlanned) {
                    t.arrivalTimeActual = minutesToTime(
                      parseTimeToMinutes(t.arrivalTimePlanned) + accLate
                    );
                  }
                  t.statusDescription =
                    accLate > 0
                      ? `Fermo a ${t.stoppedStationName} (+${accLate} min)`
                      : `Fermo a ${t.stoppedStationName}`;
                  return;
                }
              }

              // 2. Se non è fermo a depCode, verifica se è fermo in una stazione precedente lungo il percorso
              const stoppedStop = aData.fermate.find(
                (f: any) =>
                  f.arrivoReale !== null &&
                  f.arrivoReale !== undefined &&
                  (f.partenzaReale === null || f.partenzaReale === undefined)
              );

              if (stoppedStop) {
                t.isStoppedInStation = true;
                t.stoppedStationName = formatStationName(stoppedStop.stazione);
                const stopPlanDepM = stoppedStop.partenza_teorica
                  ? new Date(stoppedStop.partenza_teorica).getHours() * 60 +
                    new Date(stoppedStop.partenza_teorica).getMinutes()
                  : 0;
                const accLate = Math.max(
                  typeof aData.ritardo === 'number' ? aData.ritardo : t.delayMinutes,
                  stopPlanDepM > 0 && nowMins > stopPlanDepM ? nowMins - stopPlanDepM : 0
                );
                t.delayMinutes = accLate;

                // Propaga il ritardo accumulato in banchina alla partenza e all'arrivo alla stazione del pendolare
                if (accLate > 0) {
                  const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
                  t.departureTimeActual = minutesToTime(depPlanM + accLate);
                  if (t.arrivalTimePlanned) {
                    t.arrivalTimeActual = minutesToTime(
                      parseTimeToMinutes(t.arrivalTimePlanned) + accLate
                    );
                  }
                }

                t.statusDescription =
                  accLate > 0
                    ? `Fermo a ${t.stoppedStationName} (+${accLate} min)`
                    : `Fermo a ${t.stoppedStationName}`;
              } else if (aData.inStazione === true && aData.stazioneUltimoRilevamento) {
                t.isStoppedInStation = true;
                t.stoppedStationName = formatStationName(aData.stazioneUltimoRilevamento);
                if (typeof aData.ritardo === 'number') {
                  t.delayMinutes = Math.max(t.delayMinutes, aData.ritardo);
                }
                if (t.delayMinutes > 0) {
                  const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
                  t.departureTimeActual = minutesToTime(depPlanM + t.delayMinutes);
                  if (t.arrivalTimePlanned) {
                    t.arrivalTimeActual = minutesToTime(
                      parseTimeToMinutes(t.arrivalTimePlanned) + t.delayMinutes
                    );
                  }
                }
                t.statusDescription =
                  t.delayMinutes > 0
                    ? `Fermo a ${t.stoppedStationName} (+${t.delayMinutes} min)`
                    : `Fermo a ${t.stoppedStationName}`;
              }
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
      timetableCache.set(cacheKey, {
        timestamp: Date.now(),
        trains,
      });
    }

    return trains;
  } catch (err) {
    console.warn('Errore fetchLiveTrenitaliaTimetable:', err);
    return [];
  }
}

/**
 * Trova il treno regionale ottimale (privilegiando Regionale Veloce)
 * e fornisce le alternative disponibili prima e dopo per il tragitto pendolare.
 */
export async function findOptimalCommuterTrain(options: OptimalTrainOptions): Promise<OptimalTrainResult> {
  const {
    direction,
    departureStation,
    arrivalStation,
    targetTimeStr,
    targetDate = new Date(),
    trainOffset = 0,
    selectedTrainNumber,
    forceRefresh = false,
  } = options;

  const isOutbound = direction === 'outbound';
  const isTerminiArrival = arrivalStation.name.toUpperCase().includes('TERMINI');
  const now = new Date();
  const isToday =
    targetDate.getDate() === now.getDate() &&
    targetDate.getMonth() === now.getMonth() &&
    targetDate.getFullYear() === now.getFullYear();

  // 1. Interroga ViaggiaTreno in tempo reale per trovare i treni reali programmati/circolanti
  let allTrains: LiveTrainInfo[] = await fetchLiveTrenitaliaTimetable(
    departureStation.code,
    arrivalStation.code,
    targetDate,
    targetTimeStr,
    direction,
    forceRefresh
  );

  // 2. Se l'API non risponde (es. offline), usa i dati di fallback aggiornati
  if (allTrains.length === 0) {
    if (isOutbound) {
      allTrains = SCHEDULED_ORTE_TO_ROMA.map((s) => {
        const arrTime = isTerminiArrival ? s.arrivalTimeTermini : s.arrivalTimeTiburtina;
        const duration = isTerminiArrival ? s.durationMinutesTermini : s.durationMinutesTiburtina;
        return {
          trainNumber: s.trainNumber,
          category: s.category,
          destination: s.destination,
          originStationName: departureStation.name,
          originStationCode: departureStation.code,
          departureTimePlanned: s.departureTime,
          departureTimeActual: s.departureTime,
          departureMillis: targetDate.getTime(),
          arrivalTimePlanned: arrTime,
          arrivalTimeActual: arrTime,
          platformPlanned: s.platformPlanned,
          platformActual: s.platformPlanned,
          delayMinutes: 0,
          statusDescription: 'Non partito',
          alertMessage:
            fetchTotal > 0 && fetchOk === 0
              ? 'Connessione a Trenitalia non riuscita. Visualizzazione orari ufficiali programmati.'
              : undefined,
          isLive: false,
          durationMinutes: duration,
          isFast: s.category === 'RV',
        };
      });
    } else {
      allTrains = SCHEDULED_ROMA_TO_ORTE.map((s) => {
        const depTime = isTerminiArrival && s.departureTimeTermini ? s.departureTimeTermini : s.departureTimeTiburtina;
        return {
          trainNumber: s.trainNumber,
          category: s.category,
          destination: s.destination,
          originStationName: departureStation.name,
          originStationCode: departureStation.code,
          departureTimePlanned: depTime,
          departureTimeActual: depTime,
          departureMillis: targetDate.getTime(),
          arrivalTimePlanned: s.arrivalTimeOrte,
          arrivalTimeActual: s.arrivalTimeOrte,
          platformPlanned: s.platformPlanned,
          platformActual: s.platformPlanned,
          delayMinutes: 0,
          statusDescription: 'Non partito',
          alertMessage:
            fetchTotal > 0 && fetchOk === 0
              ? 'Connessione a Trenitalia non riuscita. Visualizzazione orari ufficiali programmati.'
              : undefined,
          isLive: false,
          durationMinutes: s.durationMinutesTiburtina,
          isFast: s.category === 'RV',
        };
      });
    }

    if (isToday) {
      try {
        const liveList = await getLiveStationDepartures(departureStation.code, new Date());
        for (const live of liveList) {
          const liveNumDigits = live.trainNumber.replace(/\D/g, '');
          if (!liveNumDigits) continue;

          const matchIdx = allTrains.findIndex(
            (t) => t.trainNumber.replace(/\D/g, '') === liveNumDigits
          );

          if (matchIdx !== -1) {
            const matched = allTrains[matchIdx];
            matched.isLive = true;
            matched.delayMinutes = live.delayMinutes;
            matched.statusDescription = live.statusDescription;
            matched.departureTimeActual =
              live.delayMinutes > 0
                ? live.departureTimeActual || matched.departureTimePlanned
                : matched.departureTimePlanned;
            matched.isOriginStation = live.isOriginStation;
            matched.isDeparted = live.isDeparted;
            if (live.isDepartedFromStation !== undefined) {
              matched.isDepartedFromStation = live.isDepartedFromStation;
            }
            if (live.platformActual) matched.platformActual = cleanPlatform(live.platformActual);
            if (live.platformPlanned) matched.platformPlanned = cleanPlatform(live.platformPlanned);
            matched.alertMessage = live.alertMessage;

            if (matched.arrivalTimePlanned) {
              const arrMins =
                parseTimeToMinutes(matched.arrivalTimePlanned) +
                (live.delayMinutes > 0 ? live.delayMinutes : 0);
              matched.arrivalTimeActual = minutesToTime(arrMins);
            }
          }
        }
      } catch {}
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

  // Se è oggi:
  // 1. Escludi i treni la cui corsa è già conclusa (arrivati alla destinazione finale da oltre 5 minuti)
  // 2. Escludi i treni N.D. senza riscontro live passati da oltre 5 minuti
  // 3. MANTIENI i treni già partiti ma ancora in viaggio fino all'arrivo a destinazione (per i "treni prima")
  if (isToday) {
    allTrains = allTrains.filter((t) => {
      const depM = parseTimeToMinutes(t.departureTimePlanned || '00:00');
      const arrM = parseTimeToMinutes(t.arrivalTimeActual || t.arrivalTimePlanned || '00:00');

      let arrNorm = arrM;
      if (arrM > 0 && depM > 0 && arrM < depM) {
        // Treno che viaggia a cavallo della mezzanotte
        arrNorm += 1440;
      }
      let nowNorm = nowMins;
      if (depM > 1200 && nowMins < 300) {
        nowNorm += 1440;
      }

      // Treno già arrivato alla destinazione finale da oltre 5 minuti: escludi
      if (arrNorm > 0 && nowNorm > arrNorm + 5) {
        return false;
      }

      // Treno N.D. senza dati live la cui partenza è passata da oltre 5 minuti: escludi
      if (nowMins > depM + 5 && !t.delayMinutes && !t.isDepartedFromStation && !t.isLive) {
        return false;
      }

      return true;
    });
  }

  // Se tutti i treni odierni sono passati o non disponibili da API, ripristina la tabella programmata con avviso
  if (allTrains.length === 0) {
    if (isOutbound) {
      allTrains = SCHEDULED_ORTE_TO_ROMA.map((s) => {
        const arrTime = isTerminiArrival ? s.arrivalTimeTermini : s.arrivalTimeTiburtina;
        const duration = isTerminiArrival ? s.durationMinutesTermini : s.durationMinutesTiburtina;
        return {
          trainNumber: s.trainNumber,
          category: s.category,
          destination: s.destination,
          originStationName: departureStation.name,
          originStationCode: departureStation.code,
          departureTimePlanned: s.departureTime,
          departureTimeActual: s.departureTime,
          departureMillis: targetDate.getTime(),
          arrivalTimePlanned: arrTime,
          arrivalTimeActual: arrTime,
          platformPlanned: s.platformPlanned,
          platformActual: s.platformPlanned,
          delayMinutes: 0,
          statusDescription: isToday ? 'Corse odierne concluse' : 'Non partito',
          isLive: false,
          durationMinutes: duration,
          isFast: s.category === 'RV',
        };
      });
    } else {
      allTrains = SCHEDULED_ROMA_TO_ORTE.map((s) => {
        const depTime = isTerminiArrival && s.departureTimeTermini ? s.departureTimeTermini : s.departureTimeTiburtina;
        return {
          trainNumber: s.trainNumber,
          category: s.category,
          destination: s.destination,
          originStationName: departureStation.name,
          originStationCode: departureStation.code,
          departureTimePlanned: depTime,
          departureTimeActual: depTime,
          departureMillis: targetDate.getTime(),
          arrivalTimePlanned: s.arrivalTimeOrte,
          arrivalTimeActual: s.arrivalTimeOrte,
          platformPlanned: s.platformPlanned,
          platformActual: s.platformPlanned,
          delayMinutes: 0,
          statusDescription: isToday ? 'Corse odierne concluse' : 'Non partito',
          isLive: false,
          durationMinutes: s.durationMinutesTiburtina,
          isFast: s.category === 'RV',
        };
      });
    }
  }

  // Se è oggi, per treni live che hanno problemi REALI alla partenza o sono fermi in stazione oltre l'orario:
  if (isToday) {
    for (const t of allTrains) {
      if (
        t.isLive &&
        t.isDepartedFromStation === false &&
        (t.isDeparted === false || t.isStoppedInStation === true)
      ) {
        const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
        if (nowMins > depPlanM && nowMins - depPlanM <= 120) {
          const lateM = nowMins - depPlanM;
          if (!t.delayMinutes || t.delayMinutes < lateM) {
            t.delayMinutes = lateM;
            t.departureTimeActual = minutesToTime(depPlanM + lateM);
            if (t.arrivalTimePlanned) {
              const arrPlanM = parseTimeToMinutes(t.arrivalTimePlanned);
              t.arrivalTimeActual = minutesToTime(arrPlanM + lateM);
            }
          }
        }
      }

      // Per qualsiasi treno con ritardo o fermo in stazione, assicura che departureTimeActual e arrivalTimeActual
      // siano sincronizzati con il ritardo effettivo affinché l'orario programmato appaia barrato nell'UI
      if (t.isLive && t.delayMinutes > 0 && t.departureTimePlanned) {
        const depPlanM = parseTimeToMinutes(t.departureTimePlanned);
        const expDepActual = minutesToTime(depPlanM + t.delayMinutes);
        if (!t.departureTimeActual || parseTimeToMinutes(t.departureTimeActual) < parseTimeToMinutes(expDepActual)) {
          t.departureTimeActual = expDepActual;
        }
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
  // se è oggi, esclude treni già partiti dalla stazione di riferimento o treni passati da ore
  const isTrainCatchable = (t: LiveTrainInfo) => {
    if (!isToday) return true;
    if (t.isDepartedFromStation) return false;
    // Se il treno è fermo in stazione (es. al binario pronto a partire o con ritardo alla partenza): è prendibile!
    if (t.isStoppedInStation && !t.isDepartedFromStation) return true;
    const depM = parseTimeToMinutes(t.departureTimeActual || t.departureTimePlanned);
    // Solo treni con partenza futura o al minuto attuale.
    // Se è un treno fermo al binario per problemi di partenza, massimo 60 min di ritardo.
    if (depM >= nowMins) return true;
    if (t.isOriginStation && t.isDeparted === false && nowMins - depM <= 60) return true;
    return false;
  };

  let recommendedIdx = 0;

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
      // Nella finestra utile precedente (ultimi 80 minuti prima del target):
      // Cerca se esiste un Regionale Veloce (RV)
      const windowIndices = onTimeIndices.filter((idx) => {
        const arr = parseTimeToMinutes(allTrains[idx].arrivalTimePlanned || '');
        return arr >= targetMins - 80;
      });

      const rvInWindow = windowIndices.filter((idx) => allTrains[idx].isFast);

      if (rvInWindow.length > 0) {
        // Prendi l'ultimo RV nella finestra (viaggio veloce, arriva comodamente prima della lezione)
        recommendedIdx = rvInWindow[rvInWindow.length - 1];
      } else if (windowIndices.length > 0) {
        // Altrimenti prendi il Regionale più vicino all'orario
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
      // Nei primi 75 minuti successivi, privilegia RV se disponibile
      const soonIndices = eligibleIndices.filter((idx) => {
        const dep = parseTimeToMinutes(allTrains[idx].departureTimePlanned || '');
        return dep <= targetMins + 75;
      });

      const rvSoon = soonIndices.filter((idx) => allTrains[idx].isFast);
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
  };

  const chosenTrain = allTrains[selectedIndexSafe]
    ? { ...allTrains[selectedIndexSafe] }
    : fallbackTrain;

  chosenTrain.hasEarlierTrain = selectedIndexSafe > 0;
  chosenTrain.hasLaterTrain = selectedIndexSafe < allTrains.length - 1;

  // Sliding window ampia per le alternative da mostrare nell'interfaccia (fino a 10 treni inclusi i treni precedenti in viaggio)
  const sliceStart = Math.max(0, selectedIndexSafe - 4);
  const sliceEnd = Math.min(allTrains.length, selectedIndexSafe + 6);
  const availableTrains = allTrains.length > 0 ? allTrains.slice(sliceStart, sliceEnd) : [chosenTrain];

  return {
    train: chosenTrain,
    availableTrains,
    selectedIndex: selectedIndexSafe,
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
    return {
      statusType: 'diverted',
      badgeLabel: 'Deviato',
      badgeColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeBorder: 'rgba(245, 158, 11, 0.3)',
      iconName: 'git-branch-outline',
      alertMessage: train.alertMessage || 'Treno deviato su percorso alternativo da Trenitalia',
      capacityWarning: train.capacityWarning,
    };
  }

  // 4. Se la data di ricerca è futura (non oggi, es. domani o un giorno successivo):
  if (!isToday) {
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

  // 5. Se è oggi: verifica orario attuale rispetto alla corsa
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const actualArrMins = parseTimeToMinutes(
    train.arrivalTimeActual || train.arrivalTimePlanned || '00:00'
  );

  // Se il convoglio è fermo in una stazione (es. arrivato ma non ancora partito da quella stazione):
  if (train.isStoppedInStation) {
    const stName = train.stoppedStationName || stationName || 'Stazione';
    const delayInfo = train.delayMinutes > 0 ? ` (+${train.delayMinutes}m)` : '';
    return {
      statusType: train.delayMinutes > 5 ? 'delayed' : train.delayMinutes > 0 ? 'warning' : 'running',
      badgeLabel: `Fermo a ${stName}${delayInfo}`,
      badgeColor: train.delayMinutes > 5 ? '#ef4444' : train.delayMinutes > 0 ? '#f59e0b' : '#38bdf8',
      badgeBg: train.delayMinutes > 5
        ? 'rgba(239, 68, 68, 0.15)'
        : train.delayMinutes > 0
        ? 'rgba(245, 158, 11, 0.15)'
        : 'rgba(56, 189, 248, 0.15)',
      badgeBorder: train.delayMinutes > 5
        ? 'rgba(239, 68, 68, 0.3)'
        : train.delayMinutes > 0
        ? 'rgba(245, 158, 11, 0.3)'
        : 'rgba(56, 189, 248, 0.3)',
      iconName: 'pause-circle-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Se il treno è già passato per la stazione di riferimento del pendolare:
  if (train.isDepartedFromStation) {
    if (actualArrMins > 0 && nowMins > actualArrMins + 3) {
      return {
        statusType: train.delayMinutes > 0 ? 'delayed' : 'on_time',
        badgeLabel: train.delayMinutes > 0 ? `Arrivato (+${train.delayMinutes}m)` : 'Arrivato • In orario',
        badgeColor: '#64748b',
        badgeBg: 'rgba(100, 116, 139, 0.15)',
        badgeBorder: 'rgba(100, 116, 139, 0.25)',
        iconName: 'flag-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }

    const delayInfo = train.delayMinutes > 0 ? ` (+${train.delayMinutes}m)` : '';
    return {
      statusType: train.delayMinutes > 0 ? 'delayed' : 'running',
      badgeLabel: `Già passato${delayInfo}`,
      badgeColor: train.delayMinutes > 5 ? '#ef4444' : train.delayMinutes > 0 ? '#f59e0b' : '#34c759',
      badgeBg: train.delayMinutes > 5
        ? 'rgba(239, 68, 68, 0.15)'
        : train.delayMinutes > 0
        ? 'rgba(245, 158, 11, 0.15)'
        : 'rgba(52, 199, 89, 0.15)',
      badgeBorder: train.delayMinutes > 5
        ? 'rgba(239, 68, 68, 0.3)'
        : train.delayMinutes > 0
        ? 'rgba(245, 158, 11, 0.3)'
        : 'rgba(52, 199, 89, 0.3)',
      iconName: 'train-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Caso 5A: Treno deve ancora partire da questa stazione (orario attuale strettamente prima della partenza programmata)
  const plannedDepMins = parseTimeToMinutes(train.departureTimePlanned || '00:00');
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

    // 3. Treno che parte direttamente da questa stazione o programmato
    if (train.isOriginStation) {
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

    // 5. Treno non ancora partito / programmato (es. partenza tra 1 o 2 ore)
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

  // Caso 5B: Treno con problemi REALI alla partenza (origine corsa non ancora partita oltre l'orario programmato)
  const isRealDepartureIssue =
    train.isDepartedFromStation === false &&
    train.isDeparted === false &&
    nowMins >= plannedDepMins &&
    nowMins - plannedDepMins <= 90;

  if (isRealDepartureIssue) {
    const effectiveDelay = train.delayMinutes > 0 ? train.delayMinutes : Math.max(0, nowMins - plannedDepMins);
    const delayInfo = effectiveDelay > 0 ? ` (+${effectiveDelay}m)` : '';

    return {
      statusType: effectiveDelay > 0 ? 'delayed' : 'scheduled',
      badgeLabel: `Non partito${delayInfo}`,
      badgeColor: effectiveDelay > 5 ? '#ef4444' : effectiveDelay > 0 ? '#f59e0b' : '#94a3b8',
      badgeBg: effectiveDelay > 5
        ? 'rgba(239, 68, 68, 0.15)'
        : effectiveDelay > 0
        ? 'rgba(245, 158, 11, 0.15)'
        : 'rgba(148, 163, 184, 0.12)',
      badgeBorder: effectiveDelay > 5
        ? 'rgba(239, 68, 68, 0.3)'
        : effectiveDelay > 0
        ? 'rgba(245, 158, 11, 0.3)'
        : 'rgba(148, 163, 184, 0.25)',
      iconName: 'time-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Caso 5C: Treno in viaggio (ha già lasciato l'origine ed è in marcia sulla linea o in avvicinamento)
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
