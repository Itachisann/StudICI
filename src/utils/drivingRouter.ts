/**
 * Modulo per il calcolo automatico dei tempi e distanze di guida (Google Maps / OSRM / Geocoding)
 * per il tragitto casa ➔ stazione del pendolare.
 */

export interface DrivingEstimate {
  durationMinutes: number;
  distanceKm: number;
  isCalculated: boolean;
  routeSummary: string;
}

// Coordinate geografiche pre-calcolate dei principali comuni e stazioni pendolari per Lazio/Umbria
// Garantisce calcolo istantaneo anche offline o in assenza di connessione.
const KNOWN_COORDINATES: Record<string, { lat: number; lon: number; name: string }> = {
  // Comuni
  amelia: { lat: 42.5535, lon: 12.4168, name: 'Amelia' },
  narni: { lat: 42.5186, lon: 12.5142, name: 'Narni' },
  terni: { lat: 42.5639, lon: 12.6433, name: 'Terni' },
  orte: { lat: 42.4590, lon: 12.3850, name: 'Orte' },
  viterbo: { lat: 42.4174, lon: 12.1047, name: 'Viterbo' },
  'civita castellana': { lat: 42.2965, lon: 12.4132, name: 'Civita Castellana' },
  'fara sabina': { lat: 42.2096, lon: 12.7303, name: 'Fara Sabina' },
  monterotondo: { lat: 42.0531, lon: 12.6186, name: 'Monterotondo' },
  orvieto: { lat: 42.7183, lon: 12.1121, name: 'Orvieto' },
  rieti: { lat: 42.4042, lon: 12.8624, name: 'Rieti' },
  'poggio mirteto': { lat: 42.2662, lon: 12.6853, name: 'Poggio Mirteto' },
  attigliano: { lat: 42.5167, lon: 12.2967, name: 'Attigliano' },
  giove: { lat: 42.5113, lon: 12.3325, name: 'Giove' },
  'magliano sabina': { lat: 42.3601, lon: 12.4812, name: 'Magliano Sabina' },
  alviano: { lat: 42.5898, lon: 12.2963, name: 'Alviano' },
  guardea: { lat: 42.6225, lon: 12.2994, name: 'Guardea' },
  montecastrilli: { lat: 42.6508, lon: 12.4862, name: 'Montecastrilli' },
  'avigliano umbro': { lat: 42.6536, lon: 12.4278, name: 'Avigliano Umbro' },
  stroncone: { lat: 42.4983, lon: 12.6617, name: 'Stroncone' },

  // Stazioni Ferroviarie
  'stazione orte': { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte' },
  'stazione di orte': { lat: 42.4405, lon: 12.4083, name: 'Stazione di Orte' },
  'stazione narni-amelia': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia' },
  'stazione narni': { lat: 42.5280, lon: 12.5340, name: 'Stazione di Narni-Amelia' },
  'stazione terni': { lat: 42.5680, lon: 12.6460, name: 'Stazione di Terni' },
  'stazione civita castellana': { lat: 42.3020, lon: 12.4200, name: 'Stazione Civita Castellana' },
  'stazione orvieto': { lat: 42.7240, lon: 12.1280, name: 'Stazione di Orvieto' },
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
 * Risolve le coordinate geografiche di un indirizzo/città (prima dal dizionario locale, poi via Nominatim)
 */
async function resolveCoordinates(query: string): Promise<{ lat: number; lon: number } | null> {
  const clean = normalizeKey(query);
  if (!clean) return null;

  // 1. Cerca nel database locale
  for (const [k, coords] of Object.entries(KNOWN_COORDINATES)) {
    if (clean.includes(k) || k.includes(clean)) {
      return { lat: coords.lat, lon: coords.lon };
    }
  }

  // 2. Geocoding dinamico via Nominatim con timeout breve
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query + ', Italia'
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
        };
      }
    }
  } catch {}

  return null;
}

/**
 * Calcola automaticamente il tempo stimato di guida e la distanza tra l'indirizzo di partenza
 * e la stazione ferroviaria. Interroga il motore di routing OSRM (Google Maps compatible)
 * con fallback immediato su modello matematico stradale.
 */
export async function calculateDrivingEstimate(
  originAddress: string,
  stationName: string
): Promise<DrivingEstimate> {
  const origin = originAddress.trim() || 'Amelia';
  const station = stationName.trim() || 'Orte';

  // Casi speciali comuni pre-calcolati (velocità istantanea)
  const normOrigin = normalizeKey(origin);
  const normStation = normalizeKey(station);

  if (normOrigin.includes('amelia') && normStation.includes('orte')) {
    return {
      durationMinutes: 24,
      distanceKm: 17.2,
      isCalculated: true,
      routeSummary: 'SP8 / SS204 (17.2 km, ~24 min)',
    };
  }

  if (normOrigin.includes('narni') && normStation.includes('narni')) {
    return {
      durationMinutes: 8,
      distanceKm: 5.5,
      isCalculated: true,
      routeSummary: 'Via Flaminia Ternana (~8 min)',
    };
  }

  if (normOrigin.includes('terni') && normStation.includes('terni')) {
    return {
      durationMinutes: 6,
      distanceKm: 2.8,
      isCalculated: true,
      routeSummary: 'Centro città ➔ Stazione FS (~6 min)',
    };
  }

  try {
    const [coordsOrigin, coordsStation] = await Promise.all([
      resolveCoordinates(origin),
      resolveCoordinates(`Stazione di ${station}`),
    ]);

    if (coordsOrigin && coordsStation) {
      // 1. Prova routing OSRM preciso
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsOrigin.lon},${coordsOrigin.lat};${coordsStation.lon},${coordsStation.lat}?overview=false`;
        const res = await fetch(osrmUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const json = await res.json();
          if (json?.routes && json.routes[0]) {
            const sec = json.routes[0].duration;
            const dist = json.routes[0].distance;
            const mins = Math.max(5, Math.round(sec / 60));
            const km = +(dist / 1000).toFixed(1);

            return {
              durationMinutes: mins,
              distanceKm: km,
              isCalculated: true,
              routeSummary: `Percorso stradale: ${km} km (~${mins} min)`,
            };
          }
        }
      } catch {}

      // 2. Modello matematico stradale (tortuosità 1.35x, velocità media 42 km/h)
      const directKm = haversineDistanceKm(
        coordsOrigin.lat,
        coordsOrigin.lon,
        coordsStation.lat,
        coordsStation.lon
      );
      const roadKm = +(directKm * 1.35).toFixed(1);
      const estMinutes = Math.max(5, Math.round((roadKm / 42) * 60));

      return {
        durationMinutes: estMinutes,
        distanceKm: roadKm,
        isCalculated: true,
        routeSummary: `Distanza stimata: ${roadKm} km (~${estMinutes} min)`,
      };
    }
  } catch {}

  // Default fallback conservativo
  return {
    durationMinutes: 25,
    distanceKm: 18.0,
    isCalculated: false,
    routeSummary: 'Stima standard: ~25 min',
  };
}
