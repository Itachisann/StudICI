import { Linking } from 'react-native';

export interface BuildingInfo {
  code: string;
  name: string;
  address: string;
}

export const SAPIENZA_BUILDINGS: Record<string, BuildingInfo> = {
  RM002: { code: 'RM002', name: 'Edificio RM002', address: 'Via Antonio Scarpa 16, 00161 Roma' },
  RM004: { code: 'RM004', name: 'Edificio RM004', address: 'Via Antonio Scarpa 16, 00161 Roma' },
  RM006: { code: 'RM006', name: 'Edificio RM006', address: 'Via Antonio Scarpa 14, 00161 Roma' },
  RM014: { code: 'RM014', name: 'Edificio RM014', address: 'Via Antonio Scarpa 14, 00161 Roma' },
  RM018: { code: 'RM018', name: 'Edificio RM018 (Castro Laurenziano)', address: 'Via del Castro Laurenziano 7a, 00161 Roma' },
  RM025: { code: 'RM025', name: 'Edificio RM025 (Tiburtina)', address: 'Via Tiburtina 205, 00185 Roma' },
  RM031: { code: 'RM031', name: 'Edificio RM031 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM032: { code: 'RM032', name: 'Edificio RM032 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM033: { code: 'RM033', name: 'Edificio RM033 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM034: { code: 'RM034', name: 'Edificio RM034 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM035: { code: 'RM035', name: 'Edificio RM035 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM036: { code: 'RM036', name: 'Edificio RM036 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM037: { code: 'RM037', name: 'Edificio RM037 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM038: { code: 'RM038', name: 'Edificio RM038 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM039: { code: 'RM039', name: 'Edificio RM039 (S. Pietro in Vincoli)', address: 'Via Eudossiana 18, 00184 Roma' },
  RM041: { code: 'RM041', name: 'Edificio RM041 (Mensa Sette Sale)', address: 'Via delle Sette Sale 29, 00184 Roma' },
  RM049: { code: 'RM049', name: 'Palazzo Baleani', address: 'Corso Vittorio Emanuele II 244, 00186 Roma' },
  RM076: { code: 'RM076', name: 'Edificio RM076', address: 'Via Salaria 851, 00138 Roma' },
  RM089: { code: 'RM089', name: 'Facoltà di Architettura', address: 'Via Cesare Gianturco 2, 00196 Roma' },
  RM102: { code: 'RM102', name: 'Facoltà I3S (Ariosto)', address: 'Via Ariosto 25, 00185 Roma' },
  RM158: { code: 'RM158', name: 'Edificio RM158', address: 'Via Tiburtina 205, 00185 Roma' },
};

export interface ResolvedClassroom {
  displayName: string;
  buildingName: string;
  buildingCode: string;
  address: string;
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
  const code = (buildingCode || '').toUpperCase().match(/RM\d{3}/)?.[1];
  if (code && SAPIENZA_BUILDINGS[code]) {
    return SAPIENZA_BUILDINGS[code].address;
  }
  let addr = (rawAddress || '').trim();
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
    const aulaRegex = new RegExp(`(?:AULA\\s+)?(?:${escaped}\\b|\\b${escaped}\\s+e\\s+\\d+|\\d+\\s+e\\s+${escaped}\\b)[^\\n|]*?[|\\s]+(RM\\d{3})`, 'i');
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
    };
  }

  // 4. Se aula è 15 o 16 (default ICI: RM006 Scarpa 14)
  if (cleanRoom === '15' || cleanRoom === '16' || cleanRoom.includes('15') || cleanRoom.includes('16')) {
    return {
      displayName: displayName,
      buildingName: 'Edificio RM006',
      buildingCode: 'RM006',
      address: 'Via Antonio Scarpa 14, 00161 Roma',
    };
  }

  // 5. Se aula è 6 (default ICI: RM018 Castro Laurenziano 7a)
  if (cleanRoom === '6') {
    return {
      displayName: 'Aula 6',
      buildingName: 'Edificio RM018 (Castro Laurenziano)',
      buildingCode: 'RM018',
      address: 'Via del Castro Laurenziano 7a, 00161 Roma',
    };
  }

  // 6. Default per le aule ICI (Castro Laurenziano)
  return {
    displayName: displayName || cleanRoom || 'Aula',
    buildingName: buildingCode ? `Edificio ${buildingCode}` : 'Edificio RM018 (Castro Laurenziano)',
    buildingCode: buildingCode || 'RM018',
    address: 'Via del Castro Laurenziano 7a, 00161 Roma',
  };
}

/**
 * Apre la posizione in Apple Mappe o Google Maps
 */
export function openInMaps(classroom: ResolvedClassroom, provider: 'apple' | 'google') {
  // Cerca solo ed esclusivamente via, numero civico e città (senza aula o codici edificio) per precisione al 100%
  let cleanAddress = classroom.address || 'Piazzale Aldo Moro 5, 00185 Roma';
  cleanAddress = cleanAddress.replace(/^(?:Aula\s+[^,]+|Edificio\s+RM\d{3}|RM\d{3})[,\s-]*/i, '').trim();

  const query = encodeURIComponent(cleanAddress);

  if (provider === 'apple') {
    Linking.openURL(`http://maps.apple.com/?q=${query}`).catch(err => {
      console.warn('Errore apertura Apple Maps', err);
    });
  } else {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(err => {
      console.warn('Errore apertura Google Maps', err);
    });
  }
}
