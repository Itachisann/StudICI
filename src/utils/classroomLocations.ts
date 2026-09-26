import { Linking, Platform } from 'react-native';

export interface BuildingInfo {
  code: string;
  name: string;
  address: string;
}

export const SAPIENZA_BUILDINGS: Record<string, BuildingInfo> = {
  RM002: { code: 'RM002', name: 'Edificio RM002', address: 'Via Antonio Scarpa 16, 00161 Roma' },
  RM004: { code: 'RM004', name: 'Edificio RM004', address: 'Via Antonio Scarpa 16, 00161 Roma' },
  RM006: { code: 'RM006', name: 'Edificio RM006', address: 'Via Antonio Scarpa 12, 00161 Roma' },
  RM014: { code: 'RM014', name: 'Edificio RM014', address: 'Via Antonio Scarpa 16, 00161 Roma' },
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

  // Normalizza nome aula
  const displayName = /^\d+$/.test(aula) ? `Aula ${aula}` : (aula.toLowerCase().startsWith('aula') ? aula : `Aula ${aula}`);

  // 2. Se non presente nella cella, cerca se il corso si tiene in un edificio specifico menzionato nel contesto
  if (!buildingCode && contextText) {
    const singleRm = contextText.match(/edificio\s+(RM\d{3})/i);
    if (singleRm) {
      buildingCode = singleRm[1].toUpperCase();
    }
  }

  // 3. Risolvi da SAPIENZA_BUILDINGS
  if (buildingCode && SAPIENZA_BUILDINGS[buildingCode]) {
    const b = SAPIENZA_BUILDINGS[buildingCode];
    return {
      displayName: displayName || `Edificio ${buildingCode}`,
      buildingName: b.name,
      buildingCode: b.code,
      address: b.address,
    };
  }

  // 4. Default: Sapienza Roma Città Universitaria
  return {
    displayName: displayName || cleanRoom || 'Aula Sapienza',
    buildingName: buildingCode ? `Edificio ${buildingCode}` : 'Sapienza Università di Roma',
    buildingCode: buildingCode || '',
    address: 'Piazzale Aldo Moro 5, 00185 Roma',
  };
}

/**
 * Apre la posizione in Apple Mappe o Google Maps
 */
export function openInMaps(classroom: ResolvedClassroom, provider: 'apple' | 'google') {
  const query = encodeURIComponent(`Sapienza Università di Roma, ${classroom.buildingCode ? classroom.buildingCode + ', ' : ''}${classroom.address}`);

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
