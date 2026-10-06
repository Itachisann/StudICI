import { StationInfo, LiveTrainInfo } from '../types/commuter';

const VIAGGIATRENO_BASE_URL = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

export const POPULAR_STATIONS: StationInfo[] = [
  { name: 'ORTE', code: 'S08209', shortName: 'Orte' },
  { name: 'ROMA TIBURTINA', code: 'S08217', shortName: 'Roma Tiburtina' },
  { name: 'ROMA TERMINI', code: 'S08409', shortName: 'Roma Termini' },
  { name: 'ROMA OSTIENSE', code: 'S08419', shortName: 'Roma Ostiense' },
  { name: 'NARNI-AMELIA', code: 'S08208', shortName: 'Narni-Amelia' },
  { name: 'TERNI', code: 'S08207', shortName: 'Terni' },
  { name: 'VITERBO PORTA FIORENTINA', code: 'S08005', shortName: 'Viterbo P. Fiorentina' },
  { name: 'VITERBO PORTA ROMANA', code: 'S08006', shortName: 'Viterbo P. Romana' },
  { name: 'CIVITA CASTELLANA-MAGLIANO', code: 'S08211', shortName: 'Civita Castellana' },
  { name: 'FARA SABINA-MONTELIBRETTI', code: 'S08214', shortName: 'Fara Sabina' },
  { name: 'MONTEROTONDO-MENTANA', code: 'S08216', shortName: 'Monterotondo' },
  { name: 'ORVIETO', code: 'S08300', shortName: 'Orvieto' },
  { name: 'CHIUSI-CHIANCIANO TERME', code: 'S08304', shortName: 'Chiusi-Chianciano' },
  { name: 'RIETI', code: 'S08030', shortName: 'Rieti' },
  { name: 'POGGIO MIRTETO', code: 'S08213', shortName: 'Poggio Mirteto' },
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

function formatStationName(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Ottiene i treni in partenza in tempo reale da una stazione
 */
export async function getLiveStationDepartures(
  stationCode: string,
  targetDate: Date = new Date()
): Promise<LiveTrainInfo[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const dateStr = encodeURIComponent(targetDate.toString());
    const url = `${VIAGGIATRENO_BASE_URL}/partenze/${stationCode}/${dateStr}`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const rawList = await res.json();
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

      const delay = typeof raw.ritardo === 'number' ? raw.ritardo : 0;
      const progPlatform =
        raw.binarioProgrammatoPartenzaDescrizione ||
        raw.binarioProgrammatoPartenzaCodice ||
        null;
      const actualPlatform =
        raw.binarioEffettivoPartenzaDescrizione ||
        raw.binarioEffettivoPartenzaCodice ||
        null;

      const plannedDep = raw.compOrarioPartenza || '00:00';
      let actualDep = plannedDep;
      if (delay !== 0 && plannedDep.includes(':')) {
        const [hh, mm] = plannedDep.split(':').map(Number);
        const actualDate = new Date();
        actualDate.setHours(hh, mm + delay, 0, 0);
        actualDep = `${String(actualDate.getHours()).padStart(2, '0')}:${String(actualDate.getMinutes()).padStart(2, '0')}`;
      }

      let statusDescription = 'In orario';
      if (raw.nonPartito) {
        statusDescription = 'Non ancora partito';
      } else if (raw.provvedimento === 1 || raw.statoTreno === 'SOPPRESSO') {
        statusDescription = 'Soppresso';
      } else if (delay > 0) {
        statusDescription = `Ritardo di ${delay} min`;
      } else if (delay < 0) {
        statusDescription = `Anticipo di ${Math.abs(delay)} min`;
      }

      const isFast = catRaw.includes('RV') || catRaw.includes('VELOCE');

      results.push({
        trainNumber: raw.compNumeroTreno || `Treno ${raw.numeroTreno}`,
        category: isFast ? 'RV' : 'REG',
        destination: raw.destinazione || '',
        originStationName: raw.origine || '',
        departureTimePlanned: plannedDep,
        departureTimeActual: actualDep,
        departureMillis: raw.orarioPartenza || targetDate.getTime(),
        platformPlanned: progPlatform ? String(progPlatform).trim() : undefined,
        platformActual: actualPlatform ? String(actualPlatform).trim() : undefined,
        delayMinutes: delay,
        statusDescription,
        isLive: true,
        isFast,
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
  { trainNumber: 'RV 4151', category: 'RV', departureTime: '06:05', arrivalTimeTiburtina: '06:44', arrivalTimeTermini: '06:53', durationMinutesTiburtina: 39, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4501', category: 'REG', departureTime: '06:22', arrivalTimeTiburtina: '07:15', arrivalTimeTermini: '07:25', durationMinutesTiburtina: 53, durationMinutesTermini: 63, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4153', category: 'RV', departureTime: '06:40', arrivalTimeTiburtina: '07:19', arrivalTimeTermini: '07:28', durationMinutesTiburtina: 39, durationMinutesTermini: 48, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4155', category: 'RV', departureTime: '07:05', arrivalTimeTiburtina: '07:44', arrivalTimeTermini: '07:54', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4503', category: 'REG', departureTime: '07:18', arrivalTimeTiburtina: '08:10', arrivalTimeTermini: '08:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4157', category: 'RV', departureTime: '07:45', arrivalTimeTiburtina: '08:24', arrivalTimeTermini: '08:34', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4505', category: 'REG', departureTime: '08:15', arrivalTimeTiburtina: '09:07', arrivalTimeTermini: '09:17', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4159', category: 'RV', departureTime: '08:45', arrivalTimeTiburtina: '09:24', arrivalTimeTermini: '09:34', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4507', category: 'REG', departureTime: '09:18', arrivalTimeTiburtina: '10:10', arrivalTimeTermini: '10:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4161', category: 'RV', departureTime: '10:15', arrivalTimeTiburtina: '10:54', arrivalTimeTermini: '11:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4509', category: 'REG', departureTime: '11:15', arrivalTimeTiburtina: '12:07', arrivalTimeTermini: '12:17', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4163', category: 'RV', departureTime: '12:16', arrivalTimeTiburtina: '12:57', arrivalTimeTermini: '13:07', durationMinutesTiburtina: 41, durationMinutesTermini: 51, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4511', category: 'REG', departureTime: '13:18', arrivalTimeTiburtina: '14:10', arrivalTimeTermini: '14:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4165', category: 'RV', departureTime: '14:15', arrivalTimeTiburtina: '14:54', arrivalTimeTermini: '15:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4513', category: 'REG', departureTime: '15:18', arrivalTimeTiburtina: '16:10', arrivalTimeTermini: '16:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4167', category: 'RV', departureTime: '16:15', arrivalTimeTiburtina: '16:54', arrivalTimeTermini: '17:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4515', category: 'REG', departureTime: '17:18', arrivalTimeTiburtina: '18:10', arrivalTimeTermini: '18:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4169', category: 'RV', departureTime: '18:15', arrivalTimeTiburtina: '18:54', arrivalTimeTermini: '19:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4171', category: 'RV', departureTime: '19:15', arrivalTimeTiburtina: '19:54', arrivalTimeTermini: '20:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4517', category: 'REG', departureTime: '20:18', arrivalTimeTiburtina: '21:10', arrivalTimeTermini: '21:20', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4173', category: 'RV', departureTime: '21:15', arrivalTimeTiburtina: '21:54', arrivalTimeTermini: '22:04', durationMinutesTiburtina: 39, durationMinutesTermini: 49, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4519', category: 'REG', departureTime: '22:15', arrivalTimeTiburtina: '23:07', arrivalTimeTermini: '23:17', durationMinutesTiburtina: 52, durationMinutesTermini: 62, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
];

export const SCHEDULED_ROMA_TO_ORTE: ScheduledReturnTrainEntry[] = [
  { trainNumber: 'REG 4500', category: 'REG', departureTimeTiburtina: '06:20', arrivalTimeOrte: '07:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4150', category: 'RV', departureTimeTiburtina: '07:13', departureTimeTermini: '07:02', arrivalTimeOrte: '07:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4502', category: 'REG', departureTimeTiburtina: '08:20', arrivalTimeOrte: '09:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4152', category: 'RV', departureTimeTiburtina: '09:13', departureTimeTermini: '09:02', arrivalTimeOrte: '09:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'ANCONA' },
  { trainNumber: 'REG 4504', category: 'REG', departureTimeTiburtina: '10:20', arrivalTimeOrte: '11:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4154', category: 'RV', departureTimeTiburtina: '11:13', departureTimeTermini: '11:02', arrivalTimeOrte: '11:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'PERUGIA' },
  { trainNumber: 'REG 4506', category: 'REG', departureTimeTiburtina: '12:20', arrivalTimeOrte: '13:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4156', category: 'RV', departureTimeTiburtina: '13:13', departureTimeTermini: '13:02', arrivalTimeOrte: '13:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4508', category: 'REG', departureTimeTiburtina: '14:20', arrivalTimeOrte: '15:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4158', category: 'RV', departureTimeTiburtina: '15:13', departureTimeTermini: '15:02', arrivalTimeOrte: '15:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'ANCONA' },
  { trainNumber: 'REG 4510', category: 'REG', departureTimeTiburtina: '16:20', arrivalTimeOrte: '17:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4160', category: 'RV', departureTimeTiburtina: '17:13', departureTimeTermini: '17:02', arrivalTimeOrte: '17:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'PERUGIA' },
  { trainNumber: 'REG 4512', category: 'REG', departureTimeTiburtina: '17:43', arrivalTimeOrte: '18:35', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4162', category: 'RV', departureTimeTiburtina: '18:13', departureTimeTermini: '18:02', arrivalTimeOrte: '18:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4514', category: 'REG', departureTimeTiburtina: '18:43', arrivalTimeOrte: '19:35', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4164', category: 'RV', departureTimeTiburtina: '19:13', departureTimeTermini: '19:02', arrivalTimeOrte: '19:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'FOLIGNO' },
  { trainNumber: 'REG 4516', category: 'REG', departureTimeTiburtina: '19:43', arrivalTimeOrte: '20:35', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4166', category: 'RV', departureTimeTiburtina: '20:13', departureTimeTermini: '20:02', arrivalTimeOrte: '20:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'TERNI' },
  { trainNumber: 'REG 4518', category: 'REG', departureTimeTiburtina: '20:50', arrivalTimeOrte: '21:42', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4168', category: 'RV', departureTimeTiburtina: '21:13', departureTimeTermini: '21:02', arrivalTimeOrte: '21:54', durationMinutesTiburtina: 41, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4520', category: 'REG', departureTimeTiburtina: '22:20', arrivalTimeOrte: '23:12', durationMinutesTiburtina: 52, platformPlanned: '1', destination: 'ORTE' },
];

export interface OptimalTrainOptions {
  direction: 'outbound' | 'return';
  departureStation: StationInfo;
  arrivalStation: StationInfo;
  targetTimeStr: string; // Outbound: arrivo desiderato (es. "12:30"). Return: partenza desiderata (es. "13:30").
  targetDate?: Date;
  trainOffset?: number; // 0 = consigliato, -1 = precedente, +1 = successivo
  selectedTrainNumber?: string; // override selezione esplicita treno
}

export interface OptimalTrainResult {
  train: LiveTrainInfo;
  availableTrains: LiveTrainInfo[];
  selectedIndex: number;
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
  } = options;

  const isOutbound = direction === 'outbound';
  const isTerminiArrival = arrivalStation.name.toUpperCase().includes('TERMINI');

  // 1. Costruisci la lista base di tutti i treni regionali programmati
  let allTrains: LiveTrainInfo[] = [];

  if (isOutbound) {
    allTrains = SCHEDULED_ORTE_TO_ROMA.map((s) => {
      const arrTime = isTerminiArrival ? s.arrivalTimeTermini : s.arrivalTimeTiburtina;
      const duration = isTerminiArrival ? s.durationMinutesTermini : s.durationMinutesTiburtina;
      return {
        trainNumber: s.trainNumber,
        category: s.category,
        destination: s.destination,
        originStationName: departureStation.name,
        departureTimePlanned: s.departureTime,
        departureTimeActual: s.departureTime,
        departureMillis: targetDate.getTime(),
        arrivalTimePlanned: arrTime,
        arrivalTimeActual: arrTime,
        platformPlanned: s.platformPlanned,
        platformActual: s.platformPlanned,
        delayMinutes: 0,
        statusDescription: 'In orario',
        isLive: false,
        durationMinutes: duration,
        isFast: s.category === 'RV',
      };
    });
  } else {
    allTrains = SCHEDULED_ROMA_TO_ORTE.map((s) => {
      const depTime = (isTerminiArrival && s.departureTimeTermini) ? s.departureTimeTermini : s.departureTimeTiburtina;
      return {
        trainNumber: s.trainNumber,
        category: s.category,
        destination: s.destination,
        originStationName: departureStation.name,
        departureTimePlanned: depTime,
        departureTimeActual: depTime,
        departureMillis: targetDate.getTime(),
        arrivalTimePlanned: s.arrivalTimeOrte,
        arrivalTimeActual: s.arrivalTimeOrte,
        platformPlanned: s.platformPlanned,
        platformActual: s.platformPlanned,
        delayMinutes: 0,
        statusDescription: 'In orario',
        isLive: false,
        durationMinutes: s.durationMinutesTiburtina,
        isFast: s.category === 'RV',
      };
    });
  }

  // 2. Se è oggi, interroga ViaggiaTreno Live per arricchire con ritardi e binari in tempo reale
  const isToday =
    targetDate.getDate() === new Date().getDate() &&
    targetDate.getMonth() === new Date().getMonth();

  if (isToday) {
    try {
      const liveList = await getLiveStationDepartures(departureStation.code, targetDate);

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
          matched.departureTimeActual = live.departureTimeActual || matched.departureTimePlanned;
          if (live.platformActual) matched.platformActual = live.platformActual;
          if (live.platformPlanned) matched.platformPlanned = live.platformPlanned;

          // Aggiorna l'orario effettivo di arrivo in base al ritardo Trenitalia
          if (matched.arrivalTimePlanned) {
            const arrMins = parseTimeToMinutes(matched.arrivalTimePlanned) + live.delayMinutes;
            matched.arrivalTimeActual = minutesToTime(arrMins);
          }
        } else {
          // Treno regionale live straordinario non in tabella fissa
          const destUpper = live.destination.toUpperCase();
          const isEligible = isOutbound
            ? (destUpper.includes('ROMA') || destUpper.includes('TERMINI') || destUpper.includes('TIBURTINA'))
            : (destUpper.includes('ORTE') || destUpper.includes('FIRENZE') || destUpper.includes('ANCONA') || destUpper.includes('PERUGIA'));

          if (isEligible) {
            const depMins = parseTimeToMinutes(live.departureTimeActual || live.departureTimePlanned);
            const duration = live.isFast ? 41 : 52;
            const arrMins = depMins + duration;
            live.arrivalTimePlanned = minutesToTime(parseTimeToMinutes(live.departureTimePlanned) + duration);
            live.arrivalTimeActual = minutesToTime(arrMins);
            live.durationMinutes = duration;
            allTrains.push(live);
          }
        }
      }
    } catch {}
  }

  // Ordina tutti i treni cronologicamente per orario di partenza
  allTrains.sort(
    (a, b) =>
      parseTimeToMinutes(a.departureTimePlanned) -
      parseTimeToMinutes(b.departureTimePlanned)
  );

  // 3. Algoritmo di selezione del treno migliore (Regionale Veloce preferito)
  const targetMins = parseTimeToMinutes(targetTimeStr);
  let recommendedIdx = 0;

  if (isOutbound) {
    // Cerchiamo treni che arrivano in tempo (entro targetMins + 3 di tolleranza)
    const onTimeIndices: number[] = [];
    allTrains.forEach((t, idx) => {
      const arr = parseTimeToMinutes(t.arrivalTimePlanned || t.arrivalTimeActual || '');
      if (arr <= targetMins + 3) {
        onTimeIndices.push(idx);
      }
    });

    if (onTimeIndices.length > 0) {
      // Nella finestra utile precedente (ultimi 75 minuti prima del target):
      // Cerca se esiste un Regionale Veloce (RV)
      const windowIndices = onTimeIndices.filter((idx) => {
        const arr = parseTimeToMinutes(allTrains[idx].arrivalTimePlanned || '');
        return arr >= targetMins - 75;
      });

      const rvInWindow = windowIndices.filter((idx) => allTrains[idx].isFast);

      if (rvInWindow.length > 0) {
        // Prendi l'ultimo RV nella finestra (viaggio veloce, arriva appena prima)
        recommendedIdx = rvInWindow[rvInWindow.length - 1];
      } else if (windowIndices.length > 0) {
        // Altrimenti prendi il Regionale più vicino all'orario
        recommendedIdx = windowIndices[windowIndices.length - 1];
      } else {
        recommendedIdx = onTimeIndices[onTimeIndices.length - 1];
      }
    } else {
      // Se nessun treno arriva in tempo (es. orario prima mattina), prendi il primo
      recommendedIdx = 0;
    }
  } else {
    // Ritorno: primo treno che parte dopo l'orario di fine lezione + rientro in stazione
    const eligibleIndices: number[] = [];
    allTrains.forEach((t, idx) => {
      const dep = parseTimeToMinutes(t.departureTimePlanned || t.departureTimeActual || '');
      if (dep >= targetMins) {
        eligibleIndices.push(idx);
      }
    });

    if (eligibleIndices.length > 0) {
      // Nei primi 60 minuti successivi, privilegia RV se disponibile
      const soonIndices = eligibleIndices.filter((idx) => {
        const dep = parseTimeToMinutes(allTrains[idx].departureTimePlanned || '');
        return dep <= targetMins + 60;
      });

      const rvSoon = soonIndices.filter((idx) => allTrains[idx].isFast);
      if (rvSoon.length > 0) {
        recommendedIdx = rvSoon[0];
      } else {
        recommendedIdx = eligibleIndices[0];
      }
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
    selectedIndex = Math.max(0, Math.min(allTrains.length - 1, recommendedIdx + trainOffset));
  }

  const chosenTrain = { ...allTrains[selectedIndex] };
  chosenTrain.hasEarlierTrain = selectedIndex > 0;
  chosenTrain.hasLaterTrain = selectedIndex < allTrains.length - 1;

  // Sliding window per le alternative da mostrare nell'interfaccia (fino a 5 treni)
  const sliceStart = Math.max(0, selectedIndex - 2);
  const sliceEnd = Math.min(allTrains.length, selectedIndex + 3);
  const availableTrains = allTrains.slice(sliceStart, sliceEnd);

  return {
    train: chosenTrain,
    availableTrains,
    selectedIndex,
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
