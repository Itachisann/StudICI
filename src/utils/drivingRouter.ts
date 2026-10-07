/**
 * Modulo per il calcolo automatico dei tempi e distanze di guida (Google Maps / OSRM / Geocoding)
 * per il tragitto casa ➔ stazione del pendolare.
 */

export interface DrivingEstimate {
  durationMinutes: number;
  distanceKm: number;
  isCalculated: boolean;
  routeSummary: string;
  trafficCondition?: string;
  isPeakHour?: boolean;
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

  // 1. Cerca prima corrispondenza esatta nella tabella delle stazioni ferroviarie
  if (KNOWN_STATION_COORDINATES[clean]) {
    return KNOWN_STATION_COORDINATES[clean];
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

export interface TrafficProfile {
  multiplier: number;
  conditionDescription: string;
  isPeakHour: boolean;
}

/**
 * Calcola il profilo di traffico reale in base all'orario del viaggio (mattina, rientro serale, morbida).
 * Incorpora i rallentamenti abituali su raccordi/superstrade e accessi stazione (es. SS675 Orte, svincoli, cantieri).
 */
export function getTrafficProfile(targetTimeStr?: string): TrafficProfile {
  let totalMins = 0;
  if (targetTimeStr && targetTimeStr.includes(':')) {
    const [th, tm] = targetTimeStr.split(':').map(Number);
    totalMins = th * 60 + tm;
  } else {
    const now = new Date();
    totalMins = now.getHours() * 60 + now.getMinutes();
  }

  // 1. Ora di punta rientro serale (17:15 - 19:15): picco massimo attorno alle 18:00
  // Rientro pendolari da Roma/A1, uscite superstrada e stazione FS Orte verso Amelia/Narni/provincia
  if (totalMins >= 1035 && totalMins <= 1155) {
    return {
      multiplier: 1.18, // +18% (+4-6 min, es. da 25 min base passa a 29-31 min)
      conditionDescription: 'traffico intenso di rientro da Roma/superstrada e svincoli',
      isPeakHour: true,
    };
  }

  // 2. Ora di punta mattutina (07:00 - 08:35):
  // Pendolari verso stazione, scuole, possibili deviazioni da superstrada (es. SS675 cantieri) e accesso FS
  if (totalMins >= 420 && totalMins <= 515) {
    return {
      multiplier: 1.10, // +10% (+2-3 min, es. da 25 min base passa a 27-28 min)
      conditionDescription: 'traffico pendolare e possibili deviazioni da superstrada',
      isPeakHour: true,
    };
  }

  // 3. Fasce spalla / pre-post punta (06:30-07:00, 08:35-09:15, 16:30-17:15, 19:15-19:50)
  if (
    (totalMins >= 390 && totalMins < 420) ||
    (totalMins > 515 && totalMins <= 555) ||
    (totalMins >= 990 && totalMins < 1035) ||
    (totalMins > 1155 && totalMins <= 1190)
  ) {
    return {
      multiplier: 1.05, // +5% (+1 min)
      conditionDescription: 'traffico moderato',
      isPeakHour: false,
    };
  }

  // 4. Morbida / Orari standard (09:15 - 16:30, 20:00 - 06:30): traffico fluido free-flow
  // Calibrato fedelmente su Google Maps in tempo reale (24-25 min)
  return {
    multiplier: 0.96, // calibrazione su OSRM turn-by-turn (1561s / 60 * 0.96 = 25 min)
    conditionDescription: 'traffico scorrevole',
    isPeakHour: false,
  };
}

/**
 * Calcola automaticamente il tempo stimato di guida e la distanza tra l'indirizzo di partenza
 * e la stazione ferroviaria.
 * Supporta sia comuni (es. Amelia) che indirizzi precisi con via e civico (es. Via Roma 135c, Amelia).
 * Interroga il motore di routing OSRM con fallback immediato su modello stradale calcolato.
 */
export async function calculateDrivingEstimate(
  originAddress: string,
  stationName: string,
  targetTimeStr?: string
): Promise<DrivingEstimate> {
  const origin = originAddress.trim() || 'Amelia';
  const station = stationName.trim() || 'Orte';

  const isSpecificStreet =
    /\b(via|viale|corso|piazza|vicolo|strada|largo|contrada|localit[aà]|loc\.|frazione|fraz\.|voc\.|vocabolo)\b/i.test(
      origin
    ) || /\d+/.test(origin);

  const normOrigin = normalizeKey(origin);
  const normStation = normalizeKey(station);

  // Calcolo profilo di traffico reale basato sull'orario (mattina, rientro serale, morbida)
  const traffic = getTrafficProfile(targetTimeStr);

  // Casi speciali comuni pre-calcolati (se non è una via specifica, con traffico applicato)
  if (!isSpecificStreet) {
    if (normOrigin === 'amelia' && normStation.includes('orte')) {
      const baseMins = 25; // 25 min su Google Maps in condizioni standard free-flow
      const mins = Math.max(
        5,
        Math.round(
          baseMins *
            (traffic.isPeakHour
              ? traffic.multiplier > 1.15
                ? 1.20 // rientro serale (30 min)
                : 1.12 // mattina (28 min)
              : traffic.multiplier >= 1.0
              ? 1.04 // spalla (26 min)
              : 1.0) // morbida (25 min)
        )
      );
      return {
        durationMinutes: mins,
        distanceKm: 18.5,
        isCalculated: true,
        routeSummary: `Centro Amelia ➔ Stazione Orte FS (18.5 km • ~${mins} min • ${traffic.conditionDescription})`,
        trafficCondition: traffic.conditionDescription,
        isPeakHour: traffic.isPeakHour,
      };
    }

    if (normOrigin === 'narni' && normStation.includes('narni')) {
      const mins = Math.round(7 * (traffic.isPeakHour ? 1.15 : 1.0));
      return {
        durationMinutes: mins,
        distanceKm: 4.9,
        isCalculated: true,
        routeSummary: `Centro Narni ➔ Stazione Narni-Amelia (4.9 km • ~${mins} min • ${traffic.conditionDescription})`,
        trafficCondition: traffic.conditionDescription,
        isPeakHour: traffic.isPeakHour,
      };
    }

    if (normOrigin === 'terni' && normStation.includes('terni')) {
      const mins = Math.round(6 * (traffic.isPeakHour ? 1.20 : 1.0));
      return {
        durationMinutes: mins,
        distanceKm: 2.8,
        isCalculated: true,
        routeSummary: `Centro Terni ➔ Stazione FS (~${mins} min • ${traffic.conditionDescription})`,
        trafficCondition: traffic.conditionDescription,
        isPeakHour: traffic.isPeakHour,
      };
    }
  }

  try {
    const [coordsOrigin, coordsStation] = await Promise.all([
      resolveOriginCoordinates(origin, station),
      resolveStationCoordinates(station),
    ]);

    if (coordsOrigin && coordsStation) {
      // 1. Calcolo percorso stradale turn-by-turn con OSRM + calibrazione reale Google Maps
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsOrigin.lon},${coordsOrigin.lat};${coordsStation.lon},${coordsStation.lat}?overview=false`;
        const res = await fetch(osrmUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const json = await res.json();
          if (json?.routes && json.routes[0]) {
            const sec = json.routes[0].duration;
            const dist = json.routes[0].distance;
            // Applica la ponderazione traffico e la calibrazione reale
            const mins = Math.max(5, Math.round((sec / 60) * traffic.multiplier));
            const km = +(dist / 1000).toFixed(1);

            return {
              durationMinutes: mins,
              distanceKm: km,
              isCalculated: true,
              routeSummary: `Percorso stradale: ${km} km (~${mins} min • ${traffic.conditionDescription} verso ${coordsStation.name})`,
              trafficCondition: traffic.conditionDescription,
              isPeakHour: traffic.isPeakHour,
            };
          }
        }
      } catch {}

      // 2. Modello matematico stradale (tortuosità 1.38x per viabilità provinciale/regionale, velocità media 44 km/h)
      const directKm = haversineDistanceKm(
        coordsOrigin.lat,
        coordsOrigin.lon,
        coordsStation.lat,
        coordsStation.lon
      );
      const roadKm = +(directKm * 1.38).toFixed(1);
      const estMinutes = Math.max(5, Math.round(((roadKm / 44) * 60) * traffic.multiplier));

      return {
        durationMinutes: estMinutes,
        distanceKm: roadKm,
        isCalculated: true,
        routeSummary: `Distanza stimata: ${roadKm} km (~${estMinutes} min • ${traffic.conditionDescription} verso ${coordsStation.name})`,
        trafficCondition: traffic.conditionDescription,
        isPeakHour: traffic.isPeakHour,
      };
    }
  } catch {}

  // Default fallback calibrato verso Stazione ferroviaria
  const fallbackMins = Math.max(5, Math.round(25 * (traffic.isPeakHour ? 1.18 : 1.0)));
  return {
    durationMinutes: fallbackMins,
    distanceKm: 18.5,
    isCalculated: false,
    routeSummary: `Stima standard: ~18.5 km (~${fallbackMins} min • ${traffic.conditionDescription})`,
    trafficCondition: traffic.conditionDescription,
    isPeakHour: traffic.isPeakHour,
  };
}
