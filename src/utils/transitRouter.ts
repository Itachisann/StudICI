import { ResolvedClassroom } from './classroomLocations';

export interface TransitSolution {
  mode: 'bus' | 'metro' | 'tram' | 'walk' | 'mix';
  durationMinutes: number;
  inVehicleMinutes: number;
  walkingMinutes: number;
  transfersCount: number; // 0 = diretto senza cambi, 1 = un cambio
  lineName: string; // es. "Pullman 448 / 492 Diretto", "Metro B Diretta", "Bus 649 Diretto"
  routeDescription: string;
  stationOriginName: string;
  targetAddress: string;
}

type RomeStationType =
  | 'tiburtina'
  | 'termini'
  | 'ostiense'
  | 'tuscolana'
  | 'trastevere'
  | 'san_pietro'
  | 'valle_aurelia'
  | 'prenestina'
  | 'nomentana'
  | 'generic';

type CampusType =
  | 'polo_tiburtina'
  | 'castro_laurenziano_scarpa'
  | 'citta_universitaria'
  | 'polo_ariosto'
  | 'san_pietro_vincoli'
  | 'polo_salaria'
  | 'polo_gianturco'
  | 'palazzo_baleani'
  | 'custom_generic';

/**
 * Identifica la stazione ferroviaria di arrivo a Roma
 */
function identifyRomeStation(name: string): RomeStationType {
  const norm = (name || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (norm.includes('TIBURTINA')) return 'tiburtina';
  if (norm.includes('TERMINI')) return 'termini';
  if (norm.includes('OSTIENSE') || norm.includes('PIRAMIDE')) return 'ostiense';
  if (norm.includes('TUSCOLANA') || norm.includes('PONTE LUNGO')) return 'tuscolana';
  if (norm.includes('TRASTEVERE')) return 'trastevere';
  if (norm.includes('SAN PIETRO') || norm.includes('S. PIETRO') || norm.includes('S.PIETRO')) return 'san_pietro';
  if (norm.includes('VALLE AURELIA') || norm.includes('AURELIA')) return 'valle_aurelia';
  if (norm.includes('PRENESTINA')) return 'prenestina';
  if (norm.includes('NOMENTANA')) return 'nomentana';
  return 'generic';
}

/**
 * Identifica il campus o la sede universitaria di destinazione
 */
function identifyCampus(classroom: ResolvedClassroom): CampusType {
  const bCode = (classroom.buildingCode || '').toUpperCase();
  const addr = (classroom.address || '').toLowerCase();
  const dName = (classroom.displayName || '').toLowerCase();

  // 1. Polo Tiburtina (RM025, RM158 - Via Tiburtina 205)
  if (bCode === 'RM025' || bCode === 'RM158' || addr.includes('tiburtina 205') || dName.includes('tiburtina 205')) {
    return 'polo_tiburtina';
  }

  // 2. San Pietro in Vincoli & Sette Sale (RM031-RM039, RM041 - Via Eudossiana 18)
  if (
    bCode.startsWith('RM03') ||
    bCode === 'RM041' ||
    addr.includes('eudossiana') ||
    addr.includes('vincoli') ||
    addr.includes('sette sale')
  ) {
    return 'san_pietro_vincoli';
  }

  // 3. Campus Castro Laurenziano & Plesso Scarpa (RM018, RM002, RM004, RM006, RM014)
  if (
    bCode === 'RM018' ||
    bCode === 'RM002' ||
    bCode === 'RM004' ||
    bCode === 'RM006' ||
    bCode === 'RM014' ||
    addr.includes('laurenziano') ||
    addr.includes('scarpa')
  ) {
    return 'castro_laurenziano_scarpa';
  }

  // 4. Città Universitaria (Piazzale Aldo Moro 5)
  if (
    bCode.startsWith('CU') ||
    addr.includes('aldo moro') ||
    addr.includes('citta universitaria') ||
    addr.includes('città universitaria') ||
    addr.includes('de lollis') ||
    addr.includes('verano')
  ) {
    return 'citta_universitaria';
  }

  // 5. Polo Ariosto (RM102 - Via Ariosto 25 - Sede I3S)
  if (bCode === 'RM102' || addr.includes('ariosto')) {
    return 'polo_ariosto';
  }

  // 6. Polo Salaria (RM076 - Via Salaria 851)
  if (bCode === 'RM076' || addr.includes('salaria')) {
    return 'polo_salaria';
  }

  // 7. Polo Gianturco (RM089 - Via Cesare Gianturco 2)
  if (bCode === 'RM089' || addr.includes('gianturco')) {
    return 'polo_gianturco';
  }

  // 8. Palazzo Baleani (RM049 - Corso Vittorio Emanuele II 244)
  if (bCode === 'RM049' || addr.includes('baleani') || addr.includes('vittorio emanuele 244')) {
    return 'palazzo_baleani';
  }

  return 'custom_generic';
}

/**
 * Calcola la migliore soluzione di trasporto pubblico urbano (Metro / Pullman / Tram ATAC)
 * per collegare QUALUNQUE stazione ferroviaria di Roma con QUALUNQUE sede di lezione Sapienza o indirizzo.
 * Privilegia sempre i collegamenti DIRETTI a ZERO CAMBI.
 */
export function getOptimalRomeTransit(options: {
  fromStationCode: string;
  fromStationName: string;
  classroom: ResolvedClassroom;
  direction?: 'to_campus' | 'to_station';
}): TransitSolution {
  const { fromStationName, classroom, direction = 'to_campus' } = options;
  const stationType = identifyRomeStation(fromStationName);
  const campusType = identifyCampus(classroom);
  const targetAddr = classroom.address || 'Roma';
  const cName = classroom.displayName || 'Aula';

  // =========================================================================
  // 1. STAZIONE ROMA TIBURTINA
  // =========================================================================
  if (stationType === 'tiburtina') {
    switch (campusType) {
      case 'polo_tiburtina':
        return {
          mode: 'bus',
          durationMinutes: 7,
          inVehicleMinutes: 4,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Pullman 448 / 492 / 71 / 163 (o a piedi 8 min)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina FS (corsia bus) • Pullman 448, 492, 71 o 163 (direzione Verano / Portonaccio) • Fermata di discesa: Tiburtina/Marrucini (~4 min a bordo) + 2 min a piedi (150m) fino a Via Tiburtina 205 (oppure 8 min a piedi dritto dalla stazione).'
              : 'Partenza: Via Tiburtina 205 • 2 min a piedi per fermata Tiburtina/Marrucini • Pullman 448, 492, 71 o 163 (direzione Stazione Tiburtina FS, ~4 min a bordo, oppure 8 min a piedi).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'castro_laurenziano_scarpa':
        return {
          mode: 'bus',
          durationMinutes: 11,
          inVehicleMinutes: 7,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Pullman 448 / 492 / 71 / 163 (o Metro B)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina FS (piazzale bus) • Pullman 448, 492, 71 o 163 (direzione Verano / Castro Laurenziano) • Fermata di discesa: Tiburtina/Castro Laurenziano (~7 min a bordo) + 4 min a piedi (300m) fino all\'aula. In alternativa: Metro B (direzione Laurentina) fino a Policlinico (~4 min) + 7 min a piedi.'
              : 'Partenza: Via Castro Laurenziano • 4 min a piedi per fermata Tiburtina/Castro Laurenziano • Pullman 448, 492, 71 o 163 (direzione Stazione Tiburtina FS, ~7 min a bordo). In alternativa: Metro B da Policlinico fino a Tiburtina FS (~4 min).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'citta_universitaria':
        return {
          mode: 'bus',
          durationMinutes: 12,
          inVehicleMinutes: 9,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Pullman 448 / 492 / 71 / 163 (o Tram 3 / 19)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina FS • Pullman 448, 492, 71 o 163 (direzione Verano / Piazzale Aldo Moro) • Fermata di discesa: Verano o De Lollis/Tirso (~8 min a bordo) + 3 min a piedi per l\'ingresso di Città Universitaria. In alternativa: Tram 3 o 19 da Scalo San Lorenzo.'
              : 'Partenza: Città Universitaria (Varco De Lollis o Verano) • Pullman 448, 492, 71 o 163 (direzione Stazione Tiburtina FS, ~8 min a bordo). In alternativa: Tram 3 o 19.',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_ariosto':
        return {
          mode: 'bus',
          durationMinutes: 19,
          inVehicleMinutes: 16,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Bus 649 Diretto (o Metro B + Metro A)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina FS (Piazzale bus) • Bus 649 (direzione Largo Don Orione) • Fermata di discesa: Conte Verde/Manzoni (~16 min a bordo) + 2 min a piedi (180m) per Via Ariosto 25 (zero cambi). In alternativa: Metro B fino a Termini + Metro A fino a Manzoni.'
              : 'Partenza: Via Ariosto 25 • 2 min a piedi per fermata Conte Verde/Manzoni • Bus 649 (direzione Stazione Tiburtina FS, ~16 min a bordo). In alternativa: Metro A da Manzoni a Termini + Metro B fino a Tiburtina.',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'san_pietro_vincoli':
        return {
          mode: 'metro',
          durationMinutes: 14,
          inVehicleMinutes: 8,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Metro B Diretta (Fermata Cavour - Zero cambi)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina (Metropolitana) • Metro B (direzione Laurentina) • Fermata di discesa: Cavour (4 fermate, ~8 min a bordo, zero cambi) + 6 min a piedi su Scalinata dei Borgia fino a Via Eudossiana 18.'
              : 'Partenza: Via Eudossiana 18 • 6 min a piedi per fermata Cavour • Metro B (direzione Rebibbia/Jonio) diretta fino a Stazione Tiburtina (~8 min a bordo).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_salaria':
        return {
          mode: 'bus',
          durationMinutes: 19,
          inVehicleMinutes: 16,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Bus 135 Diretto',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Tiburtina FS • Bus 135 (direzione Salaria/Piombino) • Fermata di discesa: Salaria/Grottazzolina (~16 min a bordo) + 3 min a piedi fino a Via Salaria 851.'
              : 'Partenza: Via Salaria 851 • 3 min a piedi per fermata Salaria/Grottazzolina • Bus 135 (direzione Stazione Tiburtina FS, ~16 min a bordo).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_gianturco':
        return {
          mode: 'mix',
          durationMinutes: 18,
          inVehicleMinutes: 14,
          walkingMinutes: 4,
          transfersCount: 1,
          lineName: 'Metro B + Metro A (Fermata Flaminio)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro B da Tiburtina a Termini (3 fermate) + cambio rapido Metro A fino a Flaminio (4 fermate) + 4 min a piedi'
              : 'Metro A da Flaminio a Termini + Metro B fino a Tiburtina FS',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'palazzo_baleani':
        return {
          mode: 'bus',
          durationMinutes: 24,
          inVehicleMinutes: 20,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Bus 492 Diretto (Largo Argentina)',
          routeDescription:
            direction === 'to_campus'
              ? 'Bus 492 da Tiburtina FS fino a Largo di Torre Argentina / Corso Vittorio (~20 min, zero cambi) + 3 min a piedi'
              : 'Bus 492 da Corso Vittorio diretto fino a Stazione Tiburtina FS',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'bus',
          durationMinutes: 14,
          inVehicleMinutes: 10,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Pullman 448 / 492 / 71 (o Metro B)',
          routeDescription:
            direction === 'to_campus'
              ? `Pullman 448, 492 o 71 da Stazione Tiburtina verso le sedi universitarie Sapienza (${cName}), oppure Metro B`
              : `Pullman 448, 492 o 71 verso Stazione Tiburtina, oppure Metro B`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 2. STAZIONE ROMA TERMINI
  // =========================================================================
  if (stationType === 'termini') {
    switch (campusType) {
      case 'polo_tiburtina':
        return {
          mode: 'tram',
          durationMinutes: 11,
          inVehicleMinutes: 8,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Tram 14 / 5 o Bus 71 / 492',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 14, 5 o Bus 71 da Termini a fermata Tiburtina/Marrucini (~8 min) + 3 min a piedi'
              : '3 min a piedi per fermata Tiburtina/Marrucini + Tram 14 o 5 diretto a Termini (~8 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'castro_laurenziano_scarpa':
        return {
          mode: 'bus',
          durationMinutes: 12,
          inVehicleMinutes: 8,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Pullman 310 / 492 Diretto (o Metro B Policlinico)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Termini (Piazza dei Cinquecento) • Pullman 310 o 492 (direzione Vescovio/Staz. Tiburtina) • Fermata di discesa: Regina Elena/Università (~8 min a bordo) + 4 min a piedi (350m) per Via Castro Laurenziano. In alternativa: Metro B (direzione Rebibbia) fino a Policlinico (2 fermate, ~3 min) + 7 min a piedi.'
              : 'Partenza: Via Castro Laurenziano • 4 min a piedi per fermata Regina Elena/Università • Pullman 310 o 492 (direzione Termini, ~8 min a bordo). In alternativa: Metro B da Policlinico fino a Termini (2 fermate, ~3 min).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'citta_universitaria':
        return {
          mode: 'bus',
          durationMinutes: 11,
          inVehicleMinutes: 8,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Pullman 310 / 492 / 71 Diretto',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Termini (Piazzale Cinquecento) • Pullman 310, 492 o 71 (direzione De Lollis / Verano) • Fermata di discesa: De Lollis/Università (~8 min a bordo) + 3 min a piedi per Città Universitaria.'
              : 'Partenza: Città Universitaria (Varco De Lollis) • Pullman 310, 492 o 71 (direzione Termini, ~8 min a bordo).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_ariosto':
        return {
          mode: 'metro',
          durationMinutes: 7,
          inVehicleMinutes: 3,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Fermata Manzoni)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Termini (Metropolitana Linea A) • Metro A (direzione Anagnina) • Fermata di discesa: Manzoni (2 fermate, ~3 min a bordo, zero cambi) + 3 min a piedi (200m) per Via Ariosto 25.'
              : 'Partenza: Via Ariosto 25 • 3 min a piedi per stazione Metro A Manzoni • Metro A (direzione Battistini) diretta fino a Termini (~3 min a bordo).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'san_pietro_vincoli':
        return {
          mode: 'metro',
          durationMinutes: 8,
          inVehicleMinutes: 2,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Metro B Diretta (Fermata Cavour - Zero cambi)',
          routeDescription:
            direction === 'to_campus'
              ? 'Partenza: Stazione Roma Termini (Metropolitana Linea B) • Metro B (direzione Laurentina) • Fermata di discesa: Cavour (1 fermata, ~2 min a bordo) + 6 min a piedi su Scalinata dei Borgia fino a Via Eudossiana 18.'
              : 'Partenza: Via Eudossiana 18 • 6 min a piedi per fermata Cavour • Metro B (direzione Rebibbia/Jonio) diretta fino a Termini (1 fermata, ~2 min).',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_gianturco':
        return {
          mode: 'metro',
          durationMinutes: 10,
          inVehicleMinutes: 6,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Fermata Flaminio)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A da Termini a fermata Flaminio (4 fermate, 6 min) + 4 min a piedi per Via Gianturco'
              : '4 min a piedi per stazione Flaminio + Metro A diretta a Termini (6 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'palazzo_baleani':
        return {
          mode: 'bus',
          durationMinutes: 14,
          inVehicleMinutes: 12,
          walkingMinutes: 2,
          transfersCount: 0,
          lineName: 'Bus 64 / 40 Espresso Diretto (Chiesa Nuova)',
          routeDescription:
            direction === 'to_campus'
              ? 'Bus 64 o 40 Espresso da Termini fino a fermata Chiesa Nuova (~12 min) + 2 min a piedi per Corso Vittorio 244'
              : 'Bus 64 o 40 da Chiesa Nuova verso Termini (~12 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'metro',
          durationMinutes: 12,
          inVehicleMinutes: 8,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro A / Metro B da Stazione Termini',
          routeDescription:
            direction === 'to_campus'
              ? `Collegamenti diretti Metro A, Metro B o bus da Stazione Termini verso ${targetAddr}`
              : `Collegamenti verso Stazione Termini`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 3. STAZIONE ROMA OSTIENSE (Accesso Metro B Piramide)
  // =========================================================================
  if (stationType === 'ostiense') {
    switch (campusType) {
      case 'san_pietro_vincoli':
        return {
          mode: 'metro',
          durationMinutes: 12,
          inVehicleMinutes: 6,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Metro B Diretta (Fermata Piramide ➔ Cavour)',
          routeDescription:
            direction === 'to_campus'
              ? 'Sottopasso Ostiense FS ➔ Metro B Piramide diretta fino a Cavour (3 fermate, ~6 min, zero cambi) + 6 min a piedi'
              : '6 min a piedi per Cavour + Metro B diretta fino a Piramide/Ostiense FS (~6 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'castro_laurenziano_scarpa':
        return {
          mode: 'metro',
          durationMinutes: 16,
          inVehicleMinutes: 12,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro B Diretta (Piramide ➔ Policlinico)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro B da Piramide diretta fino a Policlinico (6 fermate, ~12 min, zero cambi) + 4 min a piedi'
              : '4 min a piedi per Policlinico + Metro B diretta fino a Piramide/Ostiense FS (~12 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_tiburtina':
        return {
          mode: 'metro',
          durationMinutes: 20,
          inVehicleMinutes: 16,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro B Diretta (Piramide ➔ Tiburtina)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro B da Piramide diretta fino a Tiburtina FS (8 fermate, ~16 min, zero cambi) + 4 min a piedi'
              : '4 min a piedi + Metro B diretta da Tiburtina fino a Piramide/Ostiense FS (~16 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'citta_universitaria':
        return {
          mode: 'mix',
          durationMinutes: 18,
          inVehicleMinutes: 14,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro B (Castro Pretorio / Policlinico) o Tram 3',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro B da Piramide fino a Castro Pretorio o Policlinico (~12 min) + 5 min a piedi, oppure Tram 3 diretto da Porta San Paolo fino a Verano'
              : 'Tram 3 da Verano diretto verso Piramide/Ostiense, oppure Metro B da Policlinico',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_ariosto':
        return {
          mode: 'tram',
          durationMinutes: 19,
          inVehicleMinutes: 16,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Tram 3 Diretto (Porta San Paolo ➔ Manzoni)',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 3 diretto da Porta San Paolo/Piramide fino a fermata Manzoni (~16 min, zero cambi) + 3 min a piedi per Via Ariosto 25, oppure Metro B fino a Termini + Metro A'
              : '3 min a piedi per fermata Manzoni + Tram 3 diretto fino a Piramide/Ostiense FS (~16 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'palazzo_baleani':
        return {
          mode: 'bus',
          durationMinutes: 17,
          inVehicleMinutes: 14,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Bus 30 / 280 Diretto (Lungotevere)',
          routeDescription:
            direction === 'to_campus'
              ? 'Bus 30 o 280 da Ostiense/Piramide lungo il Tevere fino a Ponte Vittorio (~14 min, zero cambi) + 3 min a piedi'
              : 'Bus 30 o 280 da Corso Vittorio verso Ostiense FS (~14 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'metro',
          durationMinutes: 16,
          inVehicleMinutes: 12,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro B Diretta da Stazione Piramide',
          routeDescription:
            direction === 'to_campus'
              ? `Metro B da fermata Piramide verso ${targetAddr}`
              : `Metro B verso Piramide/Ostiense FS`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 4. STAZIONE ROMA TUSCOLANA (Accesso Metro A Ponte Lungo a 400m / 5 min)
  // =========================================================================
  if (stationType === 'tuscolana') {
    switch (campusType) {
      case 'polo_ariosto':
        return {
          mode: 'metro',
          durationMinutes: 13,
          inVehicleMinutes: 5,
          walkingMinutes: 8,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Ponte Lungo ➔ Manzoni)',
          routeDescription:
            direction === 'to_campus'
              ? '5 min a piedi dal sottopasso FS a Metro A Ponte Lungo + Metro A diretta fino a Manzoni (solo 3 fermate, ~5 min, zero cambi) + 3 min a piedi per Via Ariosto 25'
              : '3 min a piedi per stazione Manzoni + Metro A diretta fino a Ponte Lungo (5 min) + 5 min a piedi per Stazione Tuscolana',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_gianturco':
        return {
          mode: 'metro',
          durationMinutes: 22,
          inVehicleMinutes: 14,
          walkingMinutes: 8,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Ponte Lungo ➔ Flaminio)',
          routeDescription:
            direction === 'to_campus'
              ? '5 min a piedi per Metro A Ponte Lungo + Metro A diretta fino a Flaminio (9 fermate, ~14 min, zero cambi) + 4 min a piedi per Via Gianturco'
              : '4 min a piedi per Flaminio + Metro A diretta a Ponte Lungo + 5 min per Tuscolana FS',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_tiburtina':
        return {
          mode: 'mix',
          durationMinutes: 12,
          inVehicleMinutes: 6,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Treno Metropolitano FL1 Diretto (Tuscolana ➔ Tiburtina)',
          routeDescription:
            direction === 'to_campus'
              ? 'Treno FL1/FL3 diretto da Tuscolana a Tiburtina FS (solo 6 min, zero cambi) + 4 min a piedi per Via Tiburtina 205'
              : '4 min a piedi per Tiburtina FS + treno FL1 diretto per Stazione Tuscolana (6 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'castro_laurenziano_scarpa':
      case 'citta_universitaria':
        return {
          mode: 'mix',
          durationMinutes: 19,
          inVehicleMinutes: 12,
          walkingMinutes: 7,
          transfersCount: 1,
          lineName: 'Metro A (Ponte Lungo) + Metro B (Termini ➔ Policlinico)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A da Ponte Lungo a Termini (5 fermate) + cambio rapido Metro B fino a Policlinico (2 fermate) + 4 min a piedi'
              : 'Metro B da Policlinico a Termini + Metro A fino a Ponte Lungo + 5 min per Stazione Tuscolana',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'san_pietro_vincoli':
        return {
          mode: 'mix',
          durationMinutes: 17,
          inVehicleMinutes: 9,
          walkingMinutes: 8,
          transfersCount: 1,
          lineName: 'Metro A (Ponte Lungo) + Metro B (Termini ➔ Cavour)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A da Ponte Lungo a Termini (5 fermate) + cambio Metro B fino a Cavour (1 fermata) + 6 min a piedi'
              : '6 min a piedi per Cavour + Metro B per Termini + Metro A per Ponte Lungo + 5 min a piedi',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'metro',
          durationMinutes: 16,
          inVehicleMinutes: 10,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Metro A da Stazione Ponte Lungo',
          routeDescription:
            direction === 'to_campus'
              ? `5 min a piedi dal sottopasso FS a Metro A Ponte Lungo verso ${targetAddr}`
              : `Metro A fino a Ponte Lungo + 5 min a piedi per Stazione Tuscolana`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 5. STAZIONE ROMA TRASTEVERE
  // =========================================================================
  if (stationType === 'trastevere') {
    switch (campusType) {
      case 'castro_laurenziano_scarpa':
      case 'citta_universitaria':
        return {
          mode: 'tram',
          durationMinutes: 28,
          inVehicleMinutes: 25,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Tram 3 Diretto (Trastevere ➔ Università/Regina Elena)',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 3 diretto da Stazione Trastevere attraverso Piramide, Manzoni e San Lorenzo fino alla fermata Università (~25 min panoramico, zero cambi) oppure FL1 per Ostiense + Metro B'
              : 'Tram 3 diretto da fermata Università/Regina Elena fino a Stazione Trastevere (~25 min, zero cambi)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_ariosto':
        return {
          mode: 'tram',
          durationMinutes: 22,
          inVehicleMinutes: 19,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Tram 3 Diretto (Trastevere ➔ Manzoni)',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 3 diretto da Stazione Trastevere fino a fermata Manzoni (~19 min, zero cambi) + 3 min a piedi per Via Ariosto 25'
              : '3 min a piedi per fermata Manzoni + Tram 3 diretto fino a Stazione Trastevere (~19 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'palazzo_baleani':
        return {
          mode: 'tram',
          durationMinutes: 15,
          inVehicleMinutes: 12,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Tram 8 Diretto (Arenula/Cairoli)',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 8 da Stazione Trastevere fino al capolinea Arenula/Cairoli (~12 min, zero cambi) + 3 min a piedi per Corso Vittorio 244'
              : '3 min a piedi per Arenula/Cairoli + Tram 8 diretto fino a Stazione Trastevere (~12 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'san_pietro_vincoli':
        return {
          mode: 'tram',
          durationMinutes: 21,
          inVehicleMinutes: 15,
          walkingMinutes: 6,
          transfersCount: 0,
          lineName: 'Tram 3 Diretto (Fermata Colosseo)',
          routeDescription:
            direction === 'to_campus'
              ? 'Tram 3 da Trastevere fino a fermata Colosseo (~15 min, zero cambi) + 6 min a piedi su Via San Pietro in Vincoli'
              : '6 min a piedi per Colosseo + Tram 3 diretto fino a Stazione Trastevere (~15 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'tram',
          durationMinutes: 20,
          inVehicleMinutes: 16,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Tram 3 / Tram 8 da Stazione Trastevere',
          routeDescription:
            direction === 'to_campus'
              ? `Tram 3 o Tram 8 da Stazione Trastevere verso ${targetAddr}`
              : `Collegamenti tram verso Stazione Trastevere`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 6. STAZIONE ROMA SAN PIETRO
  // =========================================================================
  if (stationType === 'san_pietro') {
    switch (campusType) {
      case 'palazzo_baleani':
        return {
          mode: 'bus',
          durationMinutes: 10,
          inVehicleMinutes: 8,
          walkingMinutes: 2,
          transfersCount: 0,
          lineName: 'Bus 64 / 40 Espresso Diretto (Chiesa Nuova)',
          routeDescription:
            direction === 'to_campus'
              ? 'Bus 64 o 40 Espresso da San Pietro fino a fermata Chiesa Nuova (~8 min, zero cambi) + 2 min a piedi'
              : 'Bus 64 o 40 da Chiesa Nuova diretto a Stazione San Pietro (~8 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_gianturco':
        return {
          mode: 'mix',
          durationMinutes: 15,
          inVehicleMinutes: 10,
          walkingMinutes: 5,
          transfersCount: 1,
          lineName: 'Treno FL3/FL5 ➔ Metro A (Flaminio)',
          routeDescription:
            direction === 'to_campus'
              ? 'Treno FL3/FL5 fino a Valle Aurelia (3 min) + Metro A diretta fino a Flaminio (4 fermate, ~7 min) + 4 min a piedi'
              : 'Metro A da Flaminio a Valle Aurelia + treno per San Pietro',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'bus',
          durationMinutes: 22,
          inVehicleMinutes: 18,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Bus 64 Diretto (verso Centro / Termini)',
          routeDescription:
            direction === 'to_campus'
              ? `Bus 64 da Stazione San Pietro attraverso il centro verso ${targetAddr}`
              : `Bus 64 verso Stazione San Pietro`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 7. STAZIONE ROMA VALLE AURELIA
  // =========================================================================
  if (stationType === 'valle_aurelia') {
    switch (campusType) {
      case 'polo_gianturco':
        return {
          mode: 'metro',
          durationMinutes: 11,
          inVehicleMinutes: 7,
          walkingMinutes: 4,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Valle Aurelia ➔ Flaminio)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A diretta da Valle Aurelia fino a Flaminio (4 fermate, ~7 min, zero cambi) + 4 min a piedi per Via Gianturco'
              : '4 min a piedi per Flaminio + Metro A diretta fino a Valle Aurelia (~7 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'polo_ariosto':
        return {
          mode: 'metro',
          durationMinutes: 19,
          inVehicleMinutes: 16,
          walkingMinutes: 3,
          transfersCount: 0,
          lineName: 'Metro A Diretta (Valle Aurelia ➔ Manzoni)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A diretta da Valle Aurelia fino a Manzoni (10 fermate, ~16 min, zero cambi) + 3 min a piedi per Via Ariosto 25'
              : '3 min a piedi per Manzoni + Metro A diretta fino a Valle Aurelia (~16 min)',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      case 'san_pietro_vincoli':
        return {
          mode: 'mix',
          durationMinutes: 20,
          inVehicleMinutes: 14,
          walkingMinutes: 6,
          transfersCount: 1,
          lineName: 'Metro A (Termini) + Metro B (Cavour)',
          routeDescription:
            direction === 'to_campus'
              ? 'Metro A da Valle Aurelia a Termini (8 fermate, ~12 min) + cambio rapido Metro B fino a Cavour (1 fermata) + 6 min a piedi'
              : 'Metro B da Cavour a Termini + Metro A fino a Valle Aurelia',
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };

      default:
        return {
          mode: 'metro',
          durationMinutes: 20,
          inVehicleMinutes: 15,
          walkingMinutes: 5,
          transfersCount: 0,
          lineName: 'Metro A Diretta da Stazione Valle Aurelia',
          routeDescription:
            direction === 'to_campus'
              ? `Metro A diretta da Valle Aurelia verso ${targetAddr}`
              : `Metro A verso Valle Aurelia`,
          stationOriginName: fromStationName,
          targetAddress: targetAddr,
        };
    }
  }

  // =========================================================================
  // 8. STAZIONE ROMA PRENESTINA
  // =========================================================================
  if (stationType === 'prenestina') {
    return {
      mode: 'tram',
      durationMinutes: 14,
      inVehicleMinutes: 10,
      walkingMinutes: 4,
      transfersCount: 0,
      lineName: 'Tram 14 / Tram 5 Diretto (Via Prenestina)',
      routeDescription:
        direction === 'to_campus'
          ? `Tram 14 o Tram 5 diretto da Via Prenestina verso Porta Maggiore, San Lorenzo e ${targetAddr}`
          : `Tram 14 o 5 verso Stazione Prenestina`,
      stationOriginName: fromStationName,
      targetAddress: targetAddr,
    };
  }

  // =========================================================================
  // 9. STAZIONE ROMA NOMENTANA
  // =========================================================================
  if (stationType === 'nomentana') {
    return {
      mode: 'bus',
      durationMinutes: 16,
      inVehicleMinutes: 12,
      walkingMinutes: 4,
      transfersCount: 0,
      lineName: 'Bus 60 / 90 Express o Metro B1 Libia',
      routeDescription:
        direction === 'to_campus'
          ? `Bus 60/90 Express su Via Nomentana oppure Metro B1 Libia verso ${targetAddr}`
          : `Collegamenti verso Stazione Nomentana`,
      stationOriginName: fromStationName,
      targetAddress: targetAddr,
    };
  }

  // =========================================================================
  // 10. ALTRE STAZIONI O FALLBACK GENERICO (Valido universalmente per qualunque stazione)
  // =========================================================================
  return {
    mode: 'mix',
    durationMinutes: 18,
    inVehicleMinutes: 14,
    walkingMinutes: 4,
    transfersCount: 0,
    lineName: `Mezzi Urbani ATAC verso ${cName}`,
    routeDescription:
      direction === 'to_campus'
        ? `Collegamenti integrati Metro e bus ATAC da ${fromStationName} verso ${targetAddr}`
        : `Collegamenti verso ${fromStationName}`,
    stationOriginName: fromStationName,
    targetAddress: targetAddr,
  };
}
