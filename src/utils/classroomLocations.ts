import { Linking } from 'react-native';

export interface BuildingInfo {
  code: string;
  name: string;
  address: string;
  campus: string;
  latitude: number;
  longitude: number;
}

export const SAPIENZA_BUILDINGS: Record<string, BuildingInfo> = {
  RM002: { code: 'RM002', name: 'Edificio RM002', address: 'Via Antonio Scarpa 16, 00161 Roma', campus: 'Plesso Scarpa', latitude: 41.90583, longitude: 12.51803 },
  RM004: { code: 'RM004', name: 'Edificio RM004', address: 'Via Antonio Scarpa 16, 00161 Roma', campus: 'Plesso Scarpa', latitude: 41.90583, longitude: 12.51803 },
  RM006: { code: 'RM006', name: 'Edificio RM006', address: 'Via Antonio Scarpa 14, 00161 Roma', campus: 'Plesso Scarpa', latitude: 41.90610, longitude: 12.51810 },
  RM014: { code: 'RM014', name: 'Edificio RM014', address: 'Via Antonio Scarpa 14, 00161 Roma', campus: 'Plesso Scarpa', latitude: 41.90610, longitude: 12.51810 },
  RM018: { code: 'RM018', name: 'Edificio RM018 (Castro Laurenziano)', address: 'Via del Castro Laurenziano 7a, 00161 Roma', campus: 'Campus Castro Laurenziano', latitude: 41.90561, longitude: 12.51786 },
  RM025: { code: 'RM025', name: 'Edificio RM025 (Tiburtina)', address: 'Via Tiburtina 205, 00185 Roma', campus: 'Polo Tiburtina', latitude: 41.89985, longitude: 12.51685 },
  RM031: { code: 'RM031', name: 'Edificio RM031 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM032: { code: 'RM032', name: 'Edificio RM032 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM033: { code: 'RM033', name: 'Edificio RM033 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM034: { code: 'RM034', name: 'Edificio RM034 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM035: { code: 'RM035', name: 'Edificio RM035 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM036: { code: 'RM036', name: 'Edificio RM036 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM037: { code: 'RM037', name: 'Edificio RM037 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM038: { code: 'RM038', name: 'Edificio RM038 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM039: { code: 'RM039', name: 'Edificio RM039 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma', campus: 'Sede Storica (S. Pietro in Vincoli)', latitude: 41.89324, longitude: 12.49362 },
  RM041: { code: 'RM041', name: 'Edificio RM041 (Mensa Sette Sale)', address: 'Via delle Sette Sale 29, 00184 Roma', campus: 'Sede Sette Sale', latitude: 41.89374, longitude: 12.49665 },
  RM049: { code: 'RM049', name: 'Palazzo Baleani', address: 'Corso Vittorio Emanuele II 244, 00186 Roma', campus: 'Palazzo Baleani', latitude: 41.89764, longitude: 12.46908 },
  RM076: { code: 'RM076', name: 'Edificio RM076', address: 'Via Salaria 851, 00138 Roma', campus: 'Polo Salaria', latitude: 41.97230, longitude: 12.50850 },
  RM089: { code: 'RM089', name: 'Facoltà di Architettura', address: 'Via Cesare Gianturco 2, 00196 Roma', campus: 'Polo Gianturco', latitude: 41.91420, longitude: 12.47460 },
  RM102: { code: 'RM102', name: 'Facoltà I3S (Ariosto)', address: 'Via Ariosto 25, 00185 Roma', campus: 'Polo Ariosto', latitude: 41.89068, longitude: 12.50399 },
  RM158: { code: 'RM158', name: 'Edificio RM158', address: 'Via Tiburtina 205, 00185 Roma', campus: 'Polo Tiburtina', latitude: 41.89985, longitude: 12.51685 },
};

export interface ResolvedClassroom {
  displayName: string;
  buildingName: string;
  buildingCode: string;
  address: string;
  campus?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Normalizza il nome visualizzato dell'aula garantendo il prefisso "Aula" e gli accenti corretti (es. lunedì)
 */
export function normalizeDisplayName(name: string): string {
  if (!name) return '';
  let clean = name.trim();
  if (!clean.toLowerCase().startsWith('aula')) {
    clean = `Aula ${clean}`;
  }
  // Accento corretto in italiano per i giorni della settimana
  clean = clean
    .replace(/\blunedi\b/gi, 'lunedì')
    .replace(/\bmartedi\b/gi, 'martedì')
    .replace(/\bmercoledi\b/gi, 'mercoledì')
    .replace(/\bgiovedi\b/gi, 'giovedì')
    .replace(/\bvenerdi\b/gi, 'venerdì');
  return clean;
}

/**
 * Chiave canonica per deduplicare aule indipendentemente da accenti, maiuscole/minuscole o prefisso "Aula"
 * Es: "Aula 15 (lunedì)" -> "15 (lunedi)"
 *     "Aula 15 (lunedi)" -> "15 (lunedi)"
 *     "15 (LUNEDI)"      -> "15 (lunedi)"
 */
export function getCanonicalRoomKey(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/^aula\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assicura che l'indirizzo abbia il CAP corretto per le sedi della Sapienza.
 * Tiburtina -> 00185
 * Scarpa / Castro Laurenziano -> 00161
 * Eudossiana / Sette Sale -> 00184
 * Salaria -> 00138
 * Ariosto -> 00185
 */
export function formatSapienzaAddress(rawAddress: string = '', buildingCode?: string): string {
  const code = (buildingCode || '').toUpperCase().match(/RM\d{3}/)?.[0];
  let addr = (rawAddress || '').trim();

  // Se abbiamo sia un indirizzo esplicito sia il codice edificio, verifichiamo se sono coerenti
  // (es. RM006 con "Scarpa 16" mantiene il civico 16; ma se addr è vuoto o appartiene a un altro plesso, usa l'indirizzo ufficiale dell'edificio)
  if (addr) {
    if (/tiburtina/i.test(addr) && (!code || code === 'RM025' || code === 'RM158')) {
      return 'Via Tiburtina 205, 00185 Roma';
    }
    if (/eudossiana/i.test(addr) && (!code || /^RM03[1-9]$/.test(code))) {
      return 'Via Eudossiana 18, 00184 Roma';
    }
    if (/sette sale/i.test(addr) && (!code || code === 'RM041')) {
      return 'Via delle Sette Sale 29, 00184 Roma';
    }
    if (/salaria/i.test(addr) && (!code || code === 'RM076')) {
      return 'Via Salaria 851, 00138 Roma';
    }
    if (/ariosto/i.test(addr) && (!code || code === 'RM102')) {
      return 'Via Ariosto 25, 00185 Roma';
    }
    if (/scarpa/i.test(addr) && (!code || code === 'RM002' || code === 'RM004' || code === 'RM006' || code === 'RM014')) {
      return addr.includes('16') ? 'Via Antonio Scarpa 16, 00161 Roma' : 'Via Antonio Scarpa 14, 00161 Roma';
    }
    if (/castro laurenziano/i.test(addr) && (!code || code === 'RM018')) {
      return 'Via del Castro Laurenziano 7a, 00161 Roma';
    }
  }

  if (code && SAPIENZA_BUILDINGS[code]) {
    return SAPIENZA_BUILDINGS[code].address;
  }

  if (/tiburtina/i.test(addr)) {
    return 'Via Tiburtina 205, 00185 Roma';
  }
  if (/eudossiana/i.test(addr)) {
    return 'Via Eudossiana 18, 00184 Roma';
  }
  if (/sette sale/i.test(addr)) {
    return 'Via delle Sette Sale 29, 00184 Roma';
  }
  if (/salaria/i.test(addr)) {
    return 'Via Salaria 851, 00138 Roma';
  }
  if (/ariosto/i.test(addr)) {
    return 'Via Ariosto 25, 00185 Roma';
  }
  if (/scarpa/i.test(addr)) {
    return addr.includes('16') ? 'Via Antonio Scarpa 16, 00161 Roma' : 'Via Antonio Scarpa 14, 00161 Roma';
  }
  if (/castro laurenziano/i.test(addr)) {
    return 'Via del Castro Laurenziano 7a, 00161 Roma';
  }
  if (addr && !addr.toLowerCase().includes('roma')) {
    return `${addr}, Roma`;
  }
  return addr;
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
    const canonRoom = getCanonicalRoomKey(cleanRoom);
    const escaped = canonRoom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normContext = contextText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const hasDayInQuery = /\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/i.test(canonRoom);
    // Se cerchiamo un'aula standard (es. "15"), non deve fare match con una riga specifica di un solo giorno (es. "15 (lunedi)")
    const dayNegativeLookahead = hasDayInQuery
      ? ''
      : '(?!\\s*\\([^)]*(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica))';
    const monthNegativeLookahead = '(?!\\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\\b)';

    const aulaRegex = new RegExp(
      `(?:AULA\\s+)?(?:\\b${escaped}\\b${dayNegativeLookahead}${monthNegativeLookahead}|\\b${escaped}\\s+e\\s+\\d+|\\d+\\s+e\\s+${escaped}\\b)[^\\n|]{0,45}?[|\\s]+(RM\\d{3})`,
      'i'
    );
    const match = normContext.match(aulaRegex);
    if (match) {
      buildingCode = match[1].toUpperCase();
    } else {
      // Eccezione aula 15 lunedì Tiburtina RM025
      if (canonRoom.includes('15') && (normContext.includes('tiburtina') || normContext.includes('rm025')) && canonRoom.includes('lunedi')) {
        buildingCode = 'RM025';
      } else {
        const singleRm = normContext.match(/edificio\s+(RM\d{3})/i);
        if (singleRm) {
          buildingCode = singleRm[1].toUpperCase();
        }
      }
    }
  }

  // Normalizza nome aula
  const displayName = normalizeDisplayName(aula);

  // 3. Risolvi da SAPIENZA_BUILDINGS se trovato buildingCode
  if (buildingCode && SAPIENZA_BUILDINGS[buildingCode]) {
    const b = SAPIENZA_BUILDINGS[buildingCode];
    return {
      displayName: displayName || `Edificio ${buildingCode}`,
      buildingName: b.name,
      buildingCode: b.code,
      address: b.address,
      campus: b.campus,
      latitude: b.latitude,
      longitude: b.longitude,
    };
  }

  // 4. Se aula è 15 o 16 (default ICI: RM006 Scarpa 14)
  if (cleanRoom === '15' || cleanRoom === '16' || cleanRoom.includes('15') || cleanRoom.includes('16')) {
    const b = SAPIENZA_BUILDINGS.RM006;
    return {
      displayName: displayName,
      buildingName: b.name,
      buildingCode: b.code,
      address: b.address,
      campus: b.campus,
      latitude: b.latitude,
      longitude: b.longitude,
    };
  }

  // 5. Se aula è 6 (default ICI: RM018 Castro Laurenziano 7a)
  if (cleanRoom === '6') {
    const b = SAPIENZA_BUILDINGS.RM018;
    return {
      displayName: 'Aula 6',
      buildingName: b.name,
      buildingCode: b.code,
      address: b.address,
      campus: b.campus,
      latitude: b.latitude,
      longitude: b.longitude,
    };
  }

  // 6. Default per le aule ICI (Castro Laurenziano)
  const defaultB = SAPIENZA_BUILDINGS.RM018;
  return {
    displayName: displayName || cleanRoom || 'Aula',
    buildingName: buildingCode ? `Edificio ${buildingCode}` : defaultB.name,
    buildingCode: buildingCode || 'RM018',
    address: defaultB.address,
    campus: defaultB.campus,
    latitude: defaultB.latitude,
    longitude: defaultB.longitude,
  };
}

/**
 * Apre la posizione in Apple Mappe o Google Maps con navigazione turn-by-turn
 */
export function openInMaps(classroom: ResolvedClassroom, provider: 'apple' | 'google') {
  const lat = classroom.latitude || 41.90561;
  const lng = classroom.longitude || 12.51786;

  if (provider === 'apple') {
    // Navigazione pedonale diretta su Apple Maps alle coordinate esatte dell'edificio
    // Omettiamo 'q' per evitare che il motore di Apple Maps geocodifichi su Piazzale Aldo Moro
    const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
    Linking.openURL(appleUrl).catch((err) => {
      console.warn('Errore apertura Apple Maps', err);
    });
  } else {
    // Navigazione pedonale diretta su Google Maps alle coordinate esatte dell'edificio
    const gmapsNativeUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=walking`;
    const gmapsWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

    Linking.canOpenURL('comgooglemaps://')
      .then((supported) => {
        if (supported) {
          Linking.openURL(gmapsNativeUrl);
        } else {
          Linking.openURL(gmapsWebUrl);
        }
      })
      .catch(() => {
        Linking.openURL(gmapsWebUrl).catch((err) => {
          console.warn('Errore apertura Google Maps', err);
        });
      });
  }
}
