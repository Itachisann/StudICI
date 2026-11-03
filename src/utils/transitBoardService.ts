/**
 * Service per la Transit Board (Linee urbane, partenze programmate e in tempo reale)
 * Supporta Roma (ATAC / Metro / Tram / Cotral) e qualsiasi città o stazione in Italia (GTFS / GTFS-RT via Transitous MOTIS 2).
 */

import { ROME_STATION_COORDINATES } from './transitRouter';
import { resolveClassroom } from './classroomLocations';

export interface TransitDepartureItem {
  id: string;
  line: string; // es. "492", "71", "163", "Metro B", "VT801A"
  mode: 'bus' | 'metro' | 'tram' | 'rail';
  headsign: string; // es. "Staz.ne Metro Cipro (MA)" o "Laurentina"
  fromStop: string; // es. "Staz.ne Tiburtina (MB)"
  toStop: string; // es. "Tiburtina/Castro Laurenziano"
  scheduledTime: string; // "15:05"
  estimatedTime: string; // "15:08"
  delayMinutes: number; // 0, 3, etc.
  isLive: boolean; // true se da feed realtime GTFS-RT
  durationMinutes: number; // durata totale del tragitto con questa linea
  inVehicleMinutes: number;
  walkingMinutes: number;
  statusType: 'on_time' | 'delayed' | 'early' | 'scheduled' | 'cancelled';
  statusLabel: string; // "In orario", "+3m ritardo", "Programmata", "Cancellata"
  alerts?: string[]; // allerte su questa specifica linea (es. cantieri o deviazioni)
  isDirect: boolean; // vero se collega direttamente senza cambi
  transfersCount: number;
}

export interface TransitBoardResult {
  stationName: string;
  destinationName: string;
  directLines: string[]; // es. ["492", "71", "163", "448"]
  departures: TransitDepartureItem[];
  lastUpdated: string;
  isLiveSource: boolean; // true se da Transitous / GTFS-RT, false se fallback statico
  sourceNotice?: string;
}

// Coordinate stazioni note (fuori Roma o con nomi specifici)
const EXTRA_STATION_COORDS: Record<string, { lat: number; lng: number }> = {
  orte: { lat: 42.43753, lng: 12.4085 },
  'orte scalo': { lat: 42.43753, lng: 12.4085 },
  narni: { lat: 42.53148, lng: 12.51916 },
  'narni-amelia': { lat: 42.53148, lng: 12.51916 },
  terni: { lat: 42.57013, lng: 12.65122 },
  'civita castellana': { lat: 42.34658, lng: 12.45417 },
  'civita castellana-magliano': { lat: 42.34658, lng: 12.45417 },
  viterbo: { lat: 42.4231, lng: 12.1065 },
  'viterbo porta fiorentina': { lat: 42.4231, lng: 12.1065 },
  'viterbo porta romana': { lat: 42.4144, lng: 12.1105 },
  'milano centrale': { lat: 45.4859, lng: 9.2045 },
  'torino porta nuova': { lat: 45.0622, lng: 7.6784 },
  'bologna centrale': { lat: 44.5058, lng: 11.3431 },
  'firenze santa maria novella': { lat: 43.7765, lng: 11.248 },
  'napoli centrale': { lat: 40.8529, lng: 14.2723 },
};

/**
 * Risolve le coordinate geografiche di una stazione per nome
 */
export function resolveStationCoordinates(stationName: string): { lat: number; lng: number } {
  const norm = (stationName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. Controlla stazioni romane
  if (norm.includes('tiburtina')) return ROME_STATION_COORDINATES.tiburtina;
  if (norm.includes('termini')) return ROME_STATION_COORDINATES.termini;
  if (norm.includes('ostiense') || norm.includes('piramide')) return ROME_STATION_COORDINATES.ostiense;
  if (norm.includes('tuscolana')) return ROME_STATION_COORDINATES.tuscolana;
  if (norm.includes('trastevere')) return ROME_STATION_COORDINATES.trastevere;
  if (norm.includes('san pietro') || norm.includes('s. pietro')) return ROME_STATION_COORDINATES.san_pietro;
  if (norm.includes('valle aurelia')) return ROME_STATION_COORDINATES.valle_aurelia;
  if (norm.includes('prenestina')) return ROME_STATION_COORDINATES.prenestina;
  if (norm.includes('nomentana')) return ROME_STATION_COORDINATES.nomentana;

  // 2. Controlla stazioni extra
  for (const [key, coords] of Object.entries(EXTRA_STATION_COORDS)) {
    if (norm.includes(key)) {
      return coords;
    }
  }

  // Default su Roma Termini come fallback
  return ROME_STATION_COORDINATES.generic;
}

/**
 * Normalizza il tipo di mezzo da stringa GTFS/MOTIS
 */
function normalizeMode(modeStr?: string, routeType?: number): 'bus' | 'metro' | 'tram' | 'rail' {
  const m = (modeStr || '').toUpperCase();
  if (m === 'SUBWAY' || m === 'METRO' || routeType === 1) return 'metro';
  if (m === 'TRAM' || routeType === 0) return 'tram';
  if (m === 'RAIL' || m === 'REGIONAL_RAIL' || routeType === 2) return 'rail';
  return 'bus';
}

/**
 * Estrae l'orario HH:MM da una stringa ISO o timestamp
 */
function formatIsoToHHMM(isoStr?: string): string {
  if (!isoStr) return '--:--';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  } catch {
    return '--:--';
  }
}

/**
 * Costruisce una data ISO standard per l'interrogazione dell'API
 */
function buildQueryIsoTime(targetDate?: string, targetTime?: string): string {
  try {
    const now = new Date();
    if (targetTime === 'now' || (!targetDate && !targetTime)) {
      return now.toISOString();
    }

    let y = now.getFullYear();
    let m = now.getMonth();
    let d = now.getDate();

    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      const parts = targetDate.split('-').map(Number);
      y = parts[0];
      m = parts[1] - 1;
      d = parts[2];
    }

    let hh = now.getHours();
    let mm = now.getMinutes();

    if (targetTime && /^\d{1,2}:\d{2}$/.test(targetTime)) {
      const parts = targetTime.split(':').map(Number);
      hh = parts[0];
      mm = parts[1];
    }

    const qDate = new Date(y, m, d, hh, mm, 0);
    return qDate.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Fallback locale rapido per Roma Tiburtina / Termini / stazioni principali Sapienza
 */
function getStaticFallbackDepartures(
  stationName: string,
  destName: string,
  targetTime?: string
): TransitBoardResult {
  const normSt = (stationName || '').toLowerCase();
  const baseTimeStr = targetTime || `${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const [bh, bm] = baseTimeStr.split(':').map(Number);
  const baseTotalMins = (isNaN(bh) ? 14 : bh) * 60 + (isNaN(bm) ? 0 : bm);

  const formatOffset = (offsetMins: number) => {
    const tot = (baseTotalMins + offsetMins) % 1440;
    const h = String(Math.floor(tot / 60)).padStart(2, '0');
    const m = String(tot % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  let directLines: string[] = ['492', '71', '163', '448'];
  let departures: TransitDepartureItem[] = [];

  if (normSt.includes('tiburtina')) {
    directLines = ['492', '71', '163', '448', 'Metro B'];
    departures = [
      {
        id: 'fb-492-1',
        line: '492',
        mode: 'bus',
        headsign: 'Staz.ne Metro Cipro (MA)',
        fromStop: 'Stazione Tiburtina FS (Piazzale Bus)',
        toStop: 'Tiburtina / Castro Laurenziano',
        scheduledTime: formatOffset(3),
        estimatedTime: formatOffset(3),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 14,
        inVehicleMinutes: 8,
        walkingMinutes: 6,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-71-1',
        line: '71',
        mode: 'bus',
        headsign: 'San Silvestro (Direzione Centro / Sapienza)',
        fromStop: 'Stazione Tiburtina FS (Corsia Ovest)',
        toStop: 'Tiburtina / Marrucini (Verano)',
        scheduledTime: formatOffset(7),
        estimatedTime: formatOffset(7),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 12,
        inVehicleMinutes: 7,
        walkingMinutes: 5,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-163-1',
        line: '163',
        mode: 'bus',
        headsign: 'Verano (Piazzale del Verano)',
        fromStop: 'Stazione Tiburtina FS',
        toStop: 'De Lollis / Verano',
        scheduledTime: formatOffset(11),
        estimatedTime: formatOffset(11),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 13,
        inVehicleMinutes: 8,
        walkingMinutes: 5,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-mb-1',
        line: 'Metro B',
        mode: 'metro',
        headsign: 'Laurentina',
        fromStop: 'Stazione Tiburtina (Banchina Metro)',
        toStop: 'Policlinico / Castro Pretorio',
        scheduledTime: formatOffset(4),
        estimatedTime: formatOffset(4),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 11,
        inVehicleMinutes: 4,
        walkingMinutes: 7,
        statusType: 'scheduled',
        statusLabel: 'Programmata (Frequenza 4-6 min)',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-448-1',
        line: '448',
        mode: 'bus',
        headsign: 'Balsamo Crivelli',
        fromStop: 'Stazione Tiburtina FS',
        toStop: 'Verano / De Lollis',
        scheduledTime: formatOffset(15),
        estimatedTime: formatOffset(15),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 12,
        inVehicleMinutes: 7,
        walkingMinutes: 5,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
    ];
  } else if (normSt.includes('termini')) {
    directLines = ['Tram 14', 'Tram 5', 'Bus 71', 'Bus 492', 'Metro B'];
    departures = [
      {
        id: 'fb-term-tram-1',
        line: 'Tram 14',
        mode: 'tram',
        headsign: 'Togliatti (via Prenestina / Scalo S. Lorenzo)',
        fromStop: 'Termini (Piazza dei Cinquecento)',
        toStop: 'Scalo San Lorenzo / Reti',
        scheduledTime: formatOffset(3),
        estimatedTime: formatOffset(3),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 11,
        inVehicleMinutes: 7,
        walkingMinutes: 4,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-term-71-1',
        line: '71',
        mode: 'bus',
        headsign: 'Staz.ne Tiburtina (MB)',
        fromStop: 'Termini (Largo di Villa Peretti)',
        toStop: 'Tiburtina / Marrucini',
        scheduledTime: formatOffset(6),
        estimatedTime: formatOffset(6),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 12,
        inVehicleMinutes: 8,
        walkingMinutes: 4,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
      {
        id: 'fb-term-mb-1',
        line: 'Metro B',
        mode: 'metro',
        headsign: 'Rebibbia / Jonio',
        fromStop: 'Termini (Banchina Metro B)',
        toStop: 'Policlinico',
        scheduledTime: formatOffset(4),
        estimatedTime: formatOffset(4),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 11,
        inVehicleMinutes: 4,
        walkingMinutes: 7,
        statusType: 'scheduled',
        statusLabel: 'Programmata (Frequenza 4-6 min)',
        isDirect: true,
        transfersCount: 0,
      },
    ];
  } else {
    // Generico per altre stazioni (Orte, Viterbo, ecc.)
    directLines = ['Bus Locale', 'Cotral / TPL'];
    departures = [
      {
        id: 'fb-gen-1',
        line: 'TPL Urbano',
        mode: 'bus',
        headsign: destName || 'Centro / Destinazione',
        fromStop: `${stationName} (Fermata Bus FS)`,
        toStop: destName || 'Fermata Target',
        scheduledTime: formatOffset(10),
        estimatedTime: formatOffset(10),
        delayMinutes: 0,
        isLive: false,
        durationMinutes: 15,
        inVehicleMinutes: 10,
        walkingMinutes: 5,
        statusType: 'scheduled',
        statusLabel: 'Programmata',
        isDirect: true,
        transfersCount: 0,
      },
    ];
  }

  return {
    stationName,
    destinationName: destName,
    directLines,
    departures,
    lastUpdated: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    isLiveSource: false,
    sourceNotice: 'Orario programmato standard (in attesa di segnale live)',
  };
}

/**
 * Interroga il motore Transitous / GTFS-RT per ottenere le linee passanti e i prossimi passaggi
 * sia programmati che con previsione in tempo reale.
 */
export async function getStationTransitBoard(options: {
  stationName: string;
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  targetName?: string;
  targetDate?: string;
  targetTime?: string;
  direction?: 'to_campus' | 'to_station';
  signal?: AbortSignal;
}): Promise<TransitBoardResult> {
  const {
    stationName,
    stationCoords: providedStCoords,
    targetCoords: providedTgCoords,
    targetName = 'Destinazione',
    targetDate,
    targetTime,
    direction = 'to_campus',
    signal,
  } = options;

  // Risolve coordinate stazione
  const stCoords = providedStCoords || resolveStationCoordinates(stationName);

  // Risolve coordinate destinazione
  let tgCoords = providedTgCoords;
  if (!tgCoords && targetName) {
    const rc = resolveClassroom(targetName);
    if (rc.latitude && rc.longitude) {
      tgCoords = { lat: rc.latitude, lng: rc.longitude };
    }
  }
  if (!tgCoords) {
    tgCoords = { lat: 41.90382, lng: 12.51685 }; // Sapienza CU default
  }

  // Se direzione è ritorno (verso stazione FS), inverti origine e destinazione
  const originLat = direction === 'to_station' ? tgCoords.lat : stCoords.lat;
  const originLng = direction === 'to_station' ? tgCoords.lng : stCoords.lng;
  const destLat = direction === 'to_station' ? stCoords.lat : tgCoords.lat;
  const destLng = direction === 'to_station' ? stCoords.lng : tgCoords.lng;

  const queryIso = buildQueryIsoTime(targetDate, targetTime);
  const planUrl = `https://api.transitous.org/api/v5/plan?fromPlace=${originLat.toFixed(5)},${originLng.toFixed(5)}&toPlace=${destLat.toFixed(5)},${destLng.toFixed(5)}&time=${encodeURIComponent(queryIso)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const onExternalAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onExternalAbort);
    }

    const res = await fetch(planUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'StudICI/1.0 (studici.app; open transit departures)',
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    if (!res.ok) {
      throw new Error(`Transitous API response status ${res.status}`);
    }

    const data = await res.json();
    const itineraries: any[] = Array.isArray(data?.itineraries) ? data.itineraries : [];

    if (itineraries.length === 0) {
      return getStaticFallbackDepartures(stationName, targetName, targetTime);
    }

    const departures: TransitDepartureItem[] = [];
    const directLinesSet = new Set<string>();
    const seenTripIds = new Set<string>();

    for (const [itinIdx, it] of itineraries.entries()) {
      const legs: any[] = Array.isArray(it.legs) ? it.legs : [];
      const transitLegs = legs.filter((l) => l.mode !== 'WALK');

      if (transitLegs.length === 0) continue;

      // Prendiamo la linea principale dell'itinerario (primo mezzo di scambio o mezzo diretto)
      const primaryLeg = transitLegs[0];
      const lineShort = (primaryLeg.routeShortName || primaryLeg.displayName || primaryLeg.route || '').trim();
      if (!lineShort) continue;

      const tripKey = `${lineShort}_${primaryLeg.startTime}_${primaryLeg.headsign}`;
      if (seenTripIds.has(tripKey)) continue;
      seenTripIds.add(tripKey);

      const isDirect = transitLegs.length === 1;
      if (isDirect) {
        directLinesSet.add(lineShort);
      }

      const mode = normalizeMode(primaryLeg.mode, primaryLeg.routeType);
      const schedDep = formatIsoToHHMM(primaryLeg.scheduledStartTime || primaryLeg.startTime);
      const estDep = formatIsoToHHMM(primaryLeg.startTime);

      const delaySec = typeof primaryLeg.departureDelay === 'number' ? primaryLeg.departureDelay : 0;
      const delayMins = Math.round(delaySec / 60);
      const isLive = primaryLeg.realTime === true || primaryLeg.departureTimestampReason === 'REALTIME';

      let statusType: TransitDepartureItem['statusType'] = 'scheduled';
      let statusLabel = 'Programmata';

      if (primaryLeg.cancelled) {
        statusType = 'cancelled';
        statusLabel = 'Cancellata';
      } else if (isLive) {
        if (delayMins > 1) {
          statusType = 'delayed';
          statusLabel = `+${delayMins}m ritardo`;
        } else if (delayMins < -1) {
          statusType = 'early';
          statusLabel = `${delayMins}m anticipo`;
        } else {
          statusType = 'on_time';
          statusLabel = 'In orario';
        }
      }

      // Estrai alert specifici su questa linea
      const alertMsgs: string[] = [];
      if (Array.isArray(primaryLeg.alerts)) {
        for (const al of primaryLeg.alerts) {
          const title = (al.headerText || al.descriptionText || '').trim();
          if (title && !alertMsgs.includes(title)) {
            alertMsgs.push(title);
          }
        }
      }

      const totalDurationMins = Math.max(1, Math.round((it.duration || primaryLeg.duration || 600) / 60));
      const inVehicleMins = Math.max(1, Math.round((primaryLeg.duration || 420) / 60));
      const walkMins = Math.max(0, totalDurationMins - inVehicleMins);

      departures.push({
        id: `transitous-${itinIdx}-${tripKey}`,
        line: lineShort,
        mode,
        headsign: primaryLeg.headsign || targetName,
        fromStop: primaryLeg.from?.name || stationName,
        toStop: primaryLeg.to?.name || targetName,
        scheduledTime: schedDep,
        estimatedTime: estDep,
        delayMinutes: delayMins,
        isLive,
        durationMinutes: totalDurationMins,
        inVehicleMinutes: inVehicleMins,
        walkingMinutes: walkMins,
        statusType,
        statusLabel,
        alerts: alertMsgs.length > 0 ? alertMsgs : undefined,
        isDirect,
        transfersCount: transitLegs.length - 1,
      });
    }

    if (departures.length === 0) {
      return getStaticFallbackDepartures(stationName, targetName, targetTime);
    }

    // Ordina partenze per orario stimato
    departures.sort((a, b) => a.estimatedTime.localeCompare(b.estimatedTime));

    const directLines = Array.from(directLinesSet);
    if (directLines.length === 0) {
      // Se non ce ne sono di dirette esclusive, aggiungi le prime 3 linee passanti
      departures.slice(0, 3).forEach((d) => {
        if (!directLines.includes(d.line)) directLines.push(d.line);
      });
    }

    const hasAnyLive = departures.some((d) => d.isLive);

    return {
      stationName,
      destinationName: targetName,
      directLines,
      departures,
      lastUpdated: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isLiveSource: true,
      sourceNotice: hasAnyLive
        ? 'Dati in tempo reale satellitare attivi (GTFS-RT)'
        : 'Orari programmati da orario ufficiale GTFS',
    };
  } catch {
    // Fallback sicuro offline o errore di rete
    return getStaticFallbackDepartures(stationName, targetName, targetTime);
  }
}
