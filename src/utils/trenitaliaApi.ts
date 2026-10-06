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

      results.push({
        trainNumber: raw.compNumeroTreno || `Treno ${raw.numeroTreno}`,
        category: raw.categoriaDescrizione || raw.categoria || 'REG',
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
 * Database orari programmati per pendolari (Orte <-> Roma e linee regionali collegate)
 * Utilizzato per calcolare con precisione i viaggi programmati in anticipo
 * quando le partenze live di ViaggiaTreno non coprono ancora l'orario richiesto.
 */
interface ScheduledTrainEntry {
  trainNumber: string;
  category: string;
  departureTime: string; // "07:05"
  arrivalTime: string;   // "07:50"
  durationMinutes: number;
  platformPlanned: string;
  destination: string;
}

const SCHEDULED_ORTE_TO_ROMA: ScheduledTrainEntry[] = [
  { trainNumber: 'RV 4151', category: 'RV', departureTime: '06:05', arrivalTime: '06:50', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4501', category: 'REG', departureTime: '06:22', arrivalTime: '07:14', durationMinutes: 52, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4153', category: 'RV', departureTime: '06:40', arrivalTime: '07:25', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4155', category: 'RV', departureTime: '07:05', arrivalTime: '07:50', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4503', category: 'REG', departureTime: '07:18', arrivalTime: '08:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4157', category: 'RV', departureTime: '07:45', arrivalTime: '08:30', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4505', category: 'REG', departureTime: '08:15', arrivalTime: '09:05', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4159', category: 'RV', departureTime: '08:45', arrivalTime: '09:30', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4507', category: 'REG', departureTime: '09:18', arrivalTime: '10:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4161', category: 'RV', departureTime: '10:15', arrivalTime: '11:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4509', category: 'REG', departureTime: '11:15', arrivalTime: '12:05', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4163', category: 'RV', departureTime: '12:16', arrivalTime: '13:07', durationMinutes: 51, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4511', category: 'REG', departureTime: '13:18', arrivalTime: '14:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4165', category: 'RV', departureTime: '14:15', arrivalTime: '15:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4513', category: 'REG', departureTime: '15:18', arrivalTime: '16:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4167', category: 'RV', departureTime: '16:15', arrivalTime: '17:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4515', category: 'REG', departureTime: '17:18', arrivalTime: '18:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4169', category: 'RV', departureTime: '18:15', arrivalTime: '19:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'RV 4171', category: 'RV', departureTime: '19:15', arrivalTime: '20:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
  { trainNumber: 'REG 4517', category: 'REG', departureTime: '20:18', arrivalTime: '21:08', durationMinutes: 50, platformPlanned: '2', destination: 'ROMA TIBURTINA' },
  { trainNumber: 'RV 4173', category: 'RV', departureTime: '21:15', arrivalTime: '22:00', durationMinutes: 45, platformPlanned: '3', destination: 'ROMA TERMINI' },
];

const SCHEDULED_ROMA_TO_ORTE: ScheduledTrainEntry[] = [
  { trainNumber: 'REG 4500', category: 'REG', departureTime: '06:12', arrivalTime: '07:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4150', category: 'RV', departureTime: '07:02', arrivalTime: '07:47', durationMinutes: 45, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4502', category: 'REG', departureTime: '08:12', arrivalTime: '09:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4152', category: 'RV', departureTime: '09:02', arrivalTime: '09:47', durationMinutes: 45, platformPlanned: '5', destination: 'ANCONA' },
  { trainNumber: 'REG 4504', category: 'REG', departureTime: '10:12', arrivalTime: '11:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4154', category: 'RV', departureTime: '11:02', arrivalTime: '11:47', durationMinutes: 45, platformPlanned: '5', destination: 'PERUGIA' },
  { trainNumber: 'REG 4506', category: 'REG', departureTime: '12:12', arrivalTime: '13:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4156', category: 'RV', departureTime: '13:02', arrivalTime: '13:47', durationMinutes: 45, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4508', category: 'REG', departureTime: '14:12', arrivalTime: '15:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4158', category: 'RV', departureTime: '15:02', arrivalTime: '15:47', durationMinutes: 45, platformPlanned: '5', destination: 'ANCONA' },
  { trainNumber: 'REG 4510', category: 'REG', departureTime: '16:12', arrivalTime: '17:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4160', category: 'RV', departureTime: '17:02', arrivalTime: '17:47', durationMinutes: 45, platformPlanned: '5', destination: 'PERUGIA' },
  { trainNumber: 'REG 4512', category: 'REG', departureTime: '17:35', arrivalTime: '18:28', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4162', category: 'RV', departureTime: '18:02', arrivalTime: '18:47', durationMinutes: 45, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4514', category: 'REG', departureTime: '18:35', arrivalTime: '19:28', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4164', category: 'RV', departureTime: '19:02', arrivalTime: '19:47', durationMinutes: 45, platformPlanned: '5', destination: 'FOLIGNO' },
  { trainNumber: 'REG 4516', category: 'REG', departureTime: '19:35', arrivalTime: '20:28', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4166', category: 'RV', departureTime: '20:02', arrivalTime: '20:47', durationMinutes: 45, platformPlanned: '5', destination: 'TERNI' },
  { trainNumber: 'REG 4518', category: 'REG', departureTime: '20:42', arrivalTime: '21:35', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
  { trainNumber: 'RV 4168', category: 'RV', departureTime: '21:02', arrivalTime: '21:47', durationMinutes: 45, platformPlanned: '5', destination: 'FIRENZE SMN' },
  { trainNumber: 'REG 4520', category: 'REG', departureTime: '22:12', arrivalTime: '23:05', durationMinutes: 53, platformPlanned: '1', destination: 'ORTE' },
];

/**
 * Trova il miglior treno per il tragitto pendolare in base a stazione e orario richiesto
 */
export async function findOptimalCommuterTrain(options: {
  direction: 'outbound' | 'return';
  departureStation: StationInfo;
  arrivalStation: StationInfo;
  targetTimeStr: string; // "08:00" per andata (arrivo prima di questo orario) o "17:30" per ritorno (partenza dopo questo orario)
  targetDate?: Date;
}): Promise<LiveTrainInfo> {
  const { direction, departureStation, arrivalStation, targetTimeStr, targetDate = new Date() } = options;
  const isOutbound = direction === 'outbound';

  // 1. Prova prima a recuperare le partenze live se siamo nella finestra di oggi
  const isToday =
    targetDate.getDate() === new Date().getDate() &&
    targetDate.getMonth() === new Date().getMonth();

  if (isToday) {
    const liveList = await getLiveStationDepartures(departureStation.code, targetDate);

    // Filtra treni che vanno verso la destinazione
    const candidateLive = liveList.filter((t) => {
      const dest = t.destination.toUpperCase();
      if (isOutbound) {
        return (
          dest.includes('ROMA') ||
          dest.includes('TERMINI') ||
          dest.includes('TIBURTINA') ||
          dest.includes('FIUMICINO') ||
          dest.includes('OSTIENSE')
        );
      } else {
        return (
          dest.includes(arrivalStation.name) ||
          dest.includes('ORTE') ||
          dest.includes('FIRENZE') ||
          dest.includes('ANCONA') ||
          dest.includes('PERUGIA') ||
          dest.includes('TERNI') ||
          dest.includes('FOLIGNO') ||
          dest.includes('CHIUSI')
        );
      }
    });

    if (candidateLive.length > 0) {
      // Per l'andata, cerchiamo il treno più vicino che parte in tempo
      const targetMins = parseTimeToMinutes(targetTimeStr);
      let bestLive = candidateLive[0];

      if (isOutbound) {
        // Vogliamo arrivare prima di targetTimeStr (stimiamo ~45-50 min di viaggio)
        const candidatesBefore = candidateLive.filter((t) => {
          const depMins = parseTimeToMinutes(t.departureTimeActual || t.departureTimePlanned);
          return depMins + 48 <= targetMins;
        });
        if (candidatesBefore.length > 0) {
          // Prendi quello più tardo possibile ma ancora in tempo!
          bestLive = candidatesBefore.sort(
            (a, b) =>
              parseTimeToMinutes(b.departureTimeActual || b.departureTimePlanned) -
              parseTimeToMinutes(a.departureTimeActual || a.departureTimePlanned)
          )[0];
        }
      } else {
        // Ritorno: vogliamo partire DOPO l'orario di fine lezione + tragitto stazione
        const candidatesAfter = candidateLive.filter((t) => {
          const depMins = parseTimeToMinutes(t.departureTimeActual || t.departureTimePlanned);
          return depMins >= targetMins;
        });
        if (candidatesAfter.length > 0) {
          // Prendi il primo disponibile dopo l'orario
          bestLive = candidatesAfter.sort(
            (a, b) =>
              parseTimeToMinutes(a.departureTimeActual || a.departureTimePlanned) -
              parseTimeToMinutes(b.departureTimeActual || b.departureTimePlanned)
          )[0];
        }
      }

      // Stima orario arrivo se non già presente
      const depMins = parseTimeToMinutes(bestLive.departureTimeActual || bestLive.departureTimePlanned);
      const arrMins = depMins + 48;
      bestLive.arrivalTimePlanned = minutesToTime(depMins + 48 - bestLive.delayMinutes);
      bestLive.arrivalTimeActual = minutesToTime(arrMins);

      return bestLive;
    }
  }

  // 2. Fallback su orario programmato
  const db = isOutbound ? SCHEDULED_ORTE_TO_ROMA : SCHEDULED_ROMA_TO_ORTE;
  const targetMins = parseTimeToMinutes(targetTimeStr);

  let chosenEntry: ScheduledTrainEntry = db[0];

  if (isOutbound) {
    // Cerchiamo il treno che arriva prima di targetMins
    const inTime = db.filter((t) => parseTimeToMinutes(t.arrivalTime) <= targetMins);
    if (inTime.length > 0) {
      // Prendi l'ultimo in tempo (massimizza il riposo/tempo di partenza)
      chosenEntry = inTime[inTime.length - 1];
    } else {
      // Prendi il primissimo del mattino
      chosenEntry = db[0];
    }
  } else {
    // Ritorno: primo treno che parte dopo targetMins
    const afterTime = db.filter((t) => parseTimeToMinutes(t.departureTime) >= targetMins);
    if (afterTime.length > 0) {
      chosenEntry = afterTime[0];
    } else {
      chosenEntry = db[db.length - 1];
    }
  }

  return {
    trainNumber: chosenEntry.trainNumber,
    category: chosenEntry.category,
    destination: chosenEntry.destination,
    originStationName: departureStation.name,
    departureTimePlanned: chosenEntry.departureTime,
    departureTimeActual: chosenEntry.departureTime,
    departureMillis: Date.now(),
    arrivalTimePlanned: chosenEntry.arrivalTime,
    arrivalTimeActual: chosenEntry.arrivalTime,
    platformPlanned: chosenEntry.platformPlanned,
    platformActual: chosenEntry.platformPlanned,
    delayMinutes: 0,
    statusDescription: 'Orario programmato',
    isLive: false,
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
