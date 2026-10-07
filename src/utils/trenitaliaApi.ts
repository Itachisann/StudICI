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
      // Se il treno ha ritardo, la partenza da prendere per recarsi in stazione rimane
      // quella programmata (non si aggiunge il ritardo alla partenza, ma solo all'arrivo a destinazione)
      const actualDep = plannedDep;

      let statusDescription = 'In orario';
      if (raw.nonPartito) {
        statusDescription = 'Non ancora partito';
      } else if (raw.provvedimento === 1 || raw.statoTreno === 'SOPPRESSO') {
        statusDescription = 'Soppresso';
      } else if (raw.provvedimento === 3 || raw.statoTreno === 'DEVIATO') {
        statusDescription = 'Deviato';
      } else if (delay > 0) {
        statusDescription = `Ritardo di ${delay} min`;
      } else if (delay < 0) {
        statusDescription = `Anticipo di ${Math.abs(delay)} min`;
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
}

export interface OptimalTrainResult {
  train: LiveTrainInfo;
  availableTrains: LiveTrainInfo[];
  selectedIndex: number;
}

/**
 * Interroga ViaggiaTreno API in tempo reale per ottenere tutti i treni regionali
 * effettivi in circolazione o programmati tra due stazioni per qualsiasi data/orario.
 */
export async function fetchLiveTrenitaliaTimetable(
  depCode: string,
  arrCode: string,
  targetDate: Date,
  targetTimeStr: string,
  direction: 'outbound' | 'return'
): Promise<LiveTrainInfo[]> {
  try {
    const isToday =
      targetDate.getDate() === new Date().getDate() &&
      targetDate.getMonth() === new Date().getMonth() &&
      targetDate.getFullYear() === new Date().getFullYear();

    const targetMins = parseTimeToMinutes(targetTimeStr);
    const targetDepMins =
      direction === 'outbound'
        ? Math.max(0, targetMins - 60)
        : targetMins;

    // Definisci le finestre temporali per coprire ampiamente il tragitto pendolare (~4 ore di treni)
    const depOffsets = [-100, -35, 35, 105];
    const arrOffsets = [-50, 15, 85, 155];

    const depTimes = depOffsets.map((off) => {
      const d = new Date(targetDate);
      const m = Math.max(0, Math.min(1439, targetDepMins + off));
      d.setHours(Math.floor(m / 60), m % 60, 0, 0);
      return d;
    });

    const arrTimes = arrOffsets.map((off) => {
      const d = new Date(targetDate);
      const m = Math.max(0, Math.min(1439, targetDepMins + off));
      d.setHours(Math.floor(m / 60), m % 60, 0, 0);
      return d;
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const depPromises = depTimes.map((d) =>
      fetch(`${VIAGGIATRENO_BASE_URL}/partenze/${depCode}/${encodeURIComponent(d.toString())}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    );

    const arrPromises = arrTimes.map((d) =>
      fetch(`${VIAGGIATRENO_BASE_URL}/arrivi/${arrCode}/${encodeURIComponent(d.toString())}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    );

    const [depLists, arrLists] = await Promise.all([
      Promise.all(depPromises),
      Promise.all(arrPromises),
    ]);

    clearTimeout(timeout);

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

    for (const [num, dep] of depMap) {
      const catRaw = (dep.categoriaDescrizione || dep.categoria || '').toUpperCase();
      // STRETTO: Solo treni Regionali o Regionali Veloci (escludi AV, Frecciarossa, Italo, Intercity)
      const isRegional =
        catRaw.includes('REG') ||
        catRaw.includes('RV') ||
        catRaw === 'R' ||
        catRaw.includes('REGIONALE');

      if (!isRegional) continue;

      const arr = arrMap.get(num);
      if (!arr) continue;

      const depPlanned = dep.compOrarioPartenza;
      const arrPlanned = arr.compOrarioArrivo;
      if (!depPlanned || !arrPlanned) continue;

      const [dh, dm] = depPlanned.split(':').map(Number);
      const [ah, am] = arrPlanned.split(':').map(Number);
      let dur = ah * 60 + am - (dh * 60 + dm);
      if (dur < 0) dur += 1440;

      // Durata ragionevole tra stazioni nella stessa direzione (tra 15 e 150 min)
      if (dur < 15 || dur > 150) continue;

      const delay = isToday && typeof dep.ritardo === 'number' ? dep.ritardo : 0;
      // Alla partenza NON si aggiunge il ritardo: l'orario di partenza da rispettare
      // rimane sempre quello programmato ufficiale.
      const depActual = depPlanned;
      let arrActual = arrPlanned;

      // Il ritardo si applica unicamente sull'arrivo effettivo a destinazione
      const cleanLiveArr = cleanViaggiaTrenoTime(arr.compOrarioEffettivoArrivo);
      if (cleanLiveArr) {
        arrActual = cleanLiveArr;
      } else if (delay !== 0) {
        arrActual = minutesToTime(ah * 60 + am + delay);
      }

      let statusDescription = 'In orario';
      if (isToday) {
        if (dep.nonPartito) {
          statusDescription = 'Non ancora partito';
        } else if (dep.provvedimento === 1 || dep.statoTreno === 'SOPPRESSO') {
          statusDescription = 'Soppresso';
        } else if (dep.provvedimento === 3 || dep.statoTreno === 'DEVIATO') {
          statusDescription = 'Deviato';
        } else if (delay > 0) {
          statusDescription = `Ritardo di ${delay} min`;
        } else if (delay < 0) {
          statusDescription = `Anticipo di ${Math.abs(delay)} min`;
        }
      } else {
        statusDescription = 'Programmato';
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

      trains.push({
        trainNumber,
        category: isFast ? 'RV' : 'REG',
        destination: dep.destinazione || '',
        originStationName: dep.origine || '',
        departureTimePlanned: depPlanned,
        departureTimeActual: depActual,
        departureMillis: dep.orarioPartenza || targetDate.getTime(),
        arrivalTimePlanned: arrPlanned,
        arrivalTimeActual: arrActual,
        platformPlanned: platformPlanned ? String(platformPlanned).trim() : undefined,
        platformActual: platformActual ? String(platformActual).trim() : undefined,
        delayMinutes: delay,
        statusDescription,
        isLive: true,
        durationMinutes: dur,
        isFast,
        alertMessage,
        capacityWarning,
        notPurchasable: isNotPurchasable,
      });
    }

    trains.sort(
      (a, b) =>
        parseTimeToMinutes(a.departureTimePlanned) -
        parseTimeToMinutes(b.departureTimePlanned)
    );

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
  } = options;

  const isOutbound = direction === 'outbound';
  const isTerminiArrival = arrivalStation.name.toUpperCase().includes('TERMINI');

  // 1. Interroga ViaggiaTreno in tempo reale per trovare i treni reali programmati/circolanti
  let allTrains: LiveTrainInfo[] = await fetchLiveTrenitaliaTimetable(
    departureStation.code,
    arrivalStation.code,
    targetDate,
    targetTimeStr,
    direction
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
        const depTime = isTerminiArrival && s.departureTimeTermini ? s.departureTimeTermini : s.departureTimeTiburtina;
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
            matched.departureTimeActual = matched.departureTimePlanned;
            if (live.platformActual) matched.platformActual = live.platformActual;
            if (live.platformPlanned) matched.platformPlanned = live.platformPlanned;

            if (matched.arrivalTimePlanned) {
              const arrMins = parseTimeToMinutes(matched.arrivalTimePlanned) + live.delayMinutes;
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
      // Se nessun treno arriva prima (es. prima mattina presto), prendi il primo treno della giornata
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

  // Sliding window ampia per le alternative da mostrare nell'interfaccia (fino a 8 treni)
  const sliceStart = Math.max(0, selectedIndex - 3);
  const sliceEnd = Math.min(allTrains.length, selectedIndex + 5);
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

export interface TrainStatusResult {
  statusType: 'scheduled' | 'running' | 'on_time' | 'delayed' | 'early' | 'cancelled' | 'diverted' | 'interrupted' | 'warning';
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  iconName: 'time-outline' | 'calendar-outline' | 'checkmark-circle-outline' | 'warning-outline' | 'flash-outline' | 'close-circle' | 'git-branch-outline' | 'alert-circle' | 'flag-outline';
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
  targetDate: Date = new Date()
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
      badgeLabel: 'Programmato',
      badgeColor: '#94a3b8',
      badgeBg: 'rgba(148, 163, 184, 0.12)',
      badgeBorder: 'rgba(148, 163, 184, 0.25)',
      iconName: 'calendar-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // 5. Se è oggi: verifica orario attuale rispetto alla corsa
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const actualDepMins = parseTimeToMinutes(
    train.departureTimeActual || train.departureTimePlanned || '00:00'
  );
  const actualArrMins = parseTimeToMinutes(
    train.arrivalTimeActual || train.arrivalTimePlanned || '00:00'
  );

  // Caso 5A: Treno deve ancora partire (orario attuale prima della partenza)
  if (nowMins < actualDepMins - 1) {
    return {
      statusType: 'scheduled',
      badgeLabel: 'Programmato',
      badgeColor: '#94a3b8',
      badgeBg: 'rgba(148, 163, 184, 0.12)',
      badgeBorder: 'rgba(148, 163, 184, 0.25)',
      iconName: 'time-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  // Caso 5B: Treno in viaggio (orario attuale tra partenza e arrivo)
  if (nowMins >= actualDepMins - 1 && (actualArrMins === 0 || nowMins <= actualArrMins + 3)) {
    if (train.delayMinutes > 0) {
      return {
        statusType: 'delayed',
        badgeLabel: `In viaggio • +${train.delayMinutes}m ritardo`,
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
        badgeLabel: `In viaggio • Anticipo ${Math.abs(train.delayMinutes)}m`,
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
        badgeLabel: 'In viaggio • In orario',
        badgeColor: '#34c759',
        badgeBg: 'rgba(52, 199, 89, 0.15)',
        badgeBorder: 'rgba(52, 199, 89, 0.3)',
        iconName: 'checkmark-circle-outline',
        alertMessage: train.alertMessage,
        capacityWarning: train.capacityWarning,
      };
    }
  }

  // Caso 5C: Treno arrivato a destinazione
  if (train.delayMinutes > 0) {
    return {
      statusType: 'delayed',
      badgeLabel: `Arrivato (+${train.delayMinutes}m)`,
      badgeColor: '#64748b',
      badgeBg: 'rgba(100, 116, 139, 0.15)',
      badgeBorder: 'rgba(100, 116, 139, 0.25)',
      iconName: 'flag-outline',
      alertMessage: train.alertMessage,
      capacityWarning: train.capacityWarning,
    };
  }

  return {
    statusType: 'on_time',
    badgeLabel: 'Arrivato • In orario',
    badgeColor: '#64748b',
    badgeBg: 'rgba(100, 116, 139, 0.15)',
    badgeBorder: 'rgba(100, 116, 139, 0.25)',
    iconName: 'flag-outline',
    alertMessage: train.alertMessage,
    capacityWarning: train.capacityWarning,
  };
}
