import { Linking } from 'react-native';

export interface BuildingInfo {
  code: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
}

/**
 * Dizionario degli edifici Sapienza con coordinate GPS verificate.
 * Le coordinate sono usate per aprire Apple Maps e Google Maps con precisione,
 * poiché i nomi degli edifici differiscono tra Apple Maps e Google Maps.
 */
export const SAPIENZA_BUILDINGS: Record<string, BuildingInfo> = {
  // ---- Castro Laurenziano / Scarpa area ----
  RM002: {
    code: 'RM002',
    name: 'Edificio RM002',
    address: 'Via Antonio Scarpa 16, 00161 Roma',
    lat: 41.9064,
    lon: 12.5176,
  },
  RM004: {
    code: 'RM004',
    name: 'Edificio RM004',
    address: 'Via Antonio Scarpa 16, 00161 Roma',
    lat: 41.9064,
    lon: 12.5176,
  },
  RM006: {
    code: 'RM006',
    name: 'Edificio RM006',
    address: 'Via Antonio Scarpa 14, 00161 Roma',
    lat: 41.9064,
    lon: 12.5176,
  },
  RM014: {
    code: 'RM014',
    name: 'Edificio RM014',
    address: 'Via Antonio Scarpa 14, 00161 Roma',
    lat: 41.9064,
    lon: 12.5176,
  },
  RM018: {
    code: 'RM018',
    name: 'Edificio RM018 (Castro Laurenziano)',
    address: 'Via del Castro Laurenziano 7a, 00161 Roma',
    lat: 41.9075,
    lon: 12.5175,
  },
  // ---- Tiburtina ----
  RM025: {
    code: 'RM025',
    name: 'Edificio RM025 (Tiburtina)',
    address: 'Via Tiburtina 205, 00185 Roma',
    lat: 41.8979,
    lon: 12.5186,
  },
  RM158: {
    code: 'RM158',
    name: 'Edificio RM158 (Tiburtina)',
    address: 'Via Tiburtina 205, 00185 Roma',
    lat: 41.8979,
    lon: 12.5186,
  },
  // ---- S. Pietro in Vincoli / Eudossiana ----
  RM031: {
    code: 'RM031',
    name: 'Edificio RM031 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM032: {
    code: 'RM032',
    name: 'Edificio RM032 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM033: {
    code: 'RM033',
    name: 'Edificio RM033 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM034: {
    code: 'RM034',
    name: 'Edificio RM034 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM035: {
    code: 'RM035',
    name: 'Edificio RM035 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM036: {
    code: 'RM036',
    name: 'Edificio RM036 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM037: {
    code: 'RM037',
    name: 'Edificio RM037 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM038: {
    code: 'RM038',
    name: 'Edificio RM038 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  RM039: {
    code: 'RM039',
    name: 'Edificio RM039 (S. Pietro in Vincoli)',
    address: 'Via Eudossiana 18, 00184 Roma',
    lat: 41.8932,
    lon: 12.4936,
  },
  // ---- Altre sedi ----
  RM041: {
    code: 'RM041',
    name: 'Edificio RM041 (Mensa Sette Sale)',
    address: 'Via delle Sette Sale 29, 00184 Roma',
    lat: 41.8922,
    lon: 12.4990,
  },
  RM049: {
    code: 'RM049',
    name: 'Palazzo Baleani',
    address: 'Corso Vittorio Emanuele II 244, 00186 Roma',
    lat: 41.8978,
    lon: 12.4710,
  },
  RM076: {
    code: 'RM076',
    name: 'Edificio RM076',
    address: 'Via Salaria 851, 00138 Roma',
    lat: 41.9616,
    lon: 12.5244,
  },
  RM089: {
    code: 'RM089',
    name: 'Facoltà di Architettura',
    address: 'Via Cesare Gianturco 2, 00196 Roma',
    lat: 41.9143,
    lon: 12.4700,
  },
  RM102: {
    code: 'RM102',
    name: 'Facoltà I3S (Ariosto)',
    address: 'Via Ariosto 25, 00185 Roma',
    lat: 41.8885,
    lon: 12.5034,
  },
};

export interface ResolvedClassroom {
  displayName: string;
  buildingName: string;
  buildingCode: string;
  address: string;
  lat?: number;
  lon?: number;
}

/**
 * Ricava con precisione l'edificio e l'indirizzo di un'aula dal testo dell'aula e dal contesto del foglio
 */
export function resolveClassroom(roomText: string, contextText: string = ''): ResolvedClassroom {
  const cleanRoom = roomText.replace(/^aula\s+/i, '').trim();
  let buildingCode = '';
  let aula = cleanRoom;

  // 1. Cerca il codice RM direttamente nel testo dell'aula (es. "RM031 aula 21")
  const rmMatch = cleanRoom.match(/(RM\d{3})/i);
  if (rmMatch) {
    buildingCode = rmMatch[1].toUpperCase();
    aula = cleanRoom.replace(/RM\d{3}/i, '').replace(/aula/i, '').trim();
  }

  // 2. Se non presente nella cella, cerca se il contesto contiene l'aula e un codice RM adiacente
  if (!buildingCode && contextText) {
    const escaped = cleanRoom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aulaRegex = new RegExp(`(?:AULA\\s+)?(?:${escaped}\\b|\\b${escaped}\\s+e\\s+\\d+|\\d+\\s+e\\s+${escaped}\\b)[^\\n|]*?[|\\s]+(RM\\d{3})`, 'i');
    const match = contextText.match(aulaRegex);
    if (match) {
      buildingCode = match[1].toUpperCase();
    } else {
      const singleRm = contextText.match(/edificio\s+(RM\d{3})/i);
      if (singleRm) {
        buildingCode = singleRm[1].toUpperCase();
      }
    }
  }

  // Normalizza nome aula
  const displayName = /^\d+$/.test(aula) ? `Aula ${aula}` : (aula.toLowerCase().startsWith('aula') ? aula : `Aula ${aula}`);

  // 3. Risolvi da SAPIENZA_BUILDINGS se trovato buildingCode
  if (buildingCode && SAPIENZA_BUILDINGS[buildingCode]) {
    const b = SAPIENZA_BUILDINGS[buildingCode];
    return {
      displayName: displayName || `Edificio ${buildingCode}`,
      buildingName: b.name,
      buildingCode: b.code,
      address: b.address,
      lat: b.lat,
      lon: b.lon,
    };
  }

  // 4. Se aula è 15 o 16 (default ICI: RM006 Scarpa 14)
  if (cleanRoom === '15' || cleanRoom === '16' || cleanRoom.includes('15') || cleanRoom.includes('16')) {
    const b = SAPIENZA_BUILDINGS['RM006'];
    return {
      displayName: displayName,
      buildingName: 'Edificio RM006',
      buildingCode: 'RM006',
      address: 'Via Antonio Scarpa 14, 00161 Roma',
      lat: b.lat,
      lon: b.lon,
    };
  }

  // 5. Se aula è 6 (default ICI: RM018 Castro Laurenziano 7a)
  if (cleanRoom === '6') {
    const b = SAPIENZA_BUILDINGS['RM018'];
    return {
      displayName: 'Aula 6',
      buildingName: 'Edificio RM018 (Castro Laurenziano)',
      buildingCode: 'RM018',
      address: 'Via del Castro Laurenziano 7a, 00161 Roma',
      lat: b.lat,
      lon: b.lon,
    };
  }

  // 6. Default per le aule ICI (Castro Laurenziano)
  const defaultBuilding = SAPIENZA_BUILDINGS['RM018'];
  return {
    displayName: displayName || cleanRoom || 'Aula',
    buildingName: buildingCode ? `Edificio ${buildingCode}` : 'Edificio RM018 (Castro Laurenziano)',
    buildingCode: buildingCode || 'RM018',
    address: 'Via del Castro Laurenziano 7a, 00161 Roma',
    lat: defaultBuilding.lat,
    lon: defaultBuilding.lon,
  };
}

/**
 * Recupera le coordinate GPS di un edificio dal suo codice RM (es. "Edificio RM018").
 * Restituisce null se non trovato.
 */
function getCoordsForBuilding(buildingNameOrCode: string): { lat: number; lon: number } | null {
  // Cerca codice RM nel nome (es. "Edificio RM018 (Castro Laurenziano)")
  const rmMatch = buildingNameOrCode.match(/(RM\d{3})/i);
  if (rmMatch) {
    const code = rmMatch[1].toUpperCase();
    const b = SAPIENZA_BUILDINGS[code];
    if (b) return { lat: b.lat, lon: b.lon };
  }
  return null;
}

/**
 * Apre la posizione in Apple Mappe o Google Maps usando coordinate GPS precise.
 * Non usa la ricerca testuale perché i nomi degli edifici Sapienza non vengono trovati
 * correttamente su Apple Maps. Le coordinate sono codificate nel dizionario SAPIENZA_BUILDINGS.
 */
export function openInMaps(classroom: ResolvedClassroom, provider: 'apple' | 'google') {
  // Usa le coordinate già risolte o tenta di ricavarle dal nome dell'edificio
  let lat = classroom.lat;
  let lon = classroom.lon;

  if (!lat || !lon) {
    const coords = getCoordsForBuilding(classroom.buildingName || classroom.buildingCode || '');
    if (coords) {
      lat = coords.lat;
      lon = coords.lon;
    }
  }

  const label = encodeURIComponent(classroom.buildingName || classroom.displayName);

  if (provider === 'apple') {
    let url: string;
    if (lat && lon) {
      // Modalità coordinate: più precisa e affidabile su Apple Maps
      url = `maps.apple.com/?ll=${lat},${lon}&q=${label}`;
    } else {
      // Fallback: testo senza prefisso "Sapienza" (causa fallimenti di ricerca)
      const query = encodeURIComponent(`${classroom.address}`);
      url = `maps.apple.com/?q=${query}`;
    }
    Linking.openURL(url).catch(err => {
      console.warn('Errore apertura Apple Maps', err);
    });
  } else {
    let url: string;
    if (lat && lon) {
      // Coordinate su Google Maps
      url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    } else {
      // Fallback senza prefisso "Sapienza"
      const query = encodeURIComponent(classroom.address);
      url = `https://www.google.com/maps/search/?api=1&query=${query}`;
    }
    Linking.openURL(url).catch(err => {
      console.warn('Errore apertura Google Maps', err);
    });
  }
}
