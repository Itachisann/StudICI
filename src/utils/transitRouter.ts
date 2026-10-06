import { ResolvedClassroom } from './classroomLocations';

export interface TransitSolution {
  mode: 'bus' | 'metro' | 'tram' | 'walk' | 'mix';
  durationMinutes: number;
  inVehicleMinutes: number;
  walkingMinutes: number;
  transfersCount: number; // 0 = diretto senza cambi, 1 = un cambio
  lineName: string; // es. "Bus 492 Diretto", "Metro B Diretta", "Tram 14 / 5 Diretto"
  routeDescription: string;
  stationOriginName: string;
  targetAddress: string;
}

/**
 * Calcola la migliore soluzione di trasporto pubblico da Roma Tiburtina o Termini
 * verso la sede della lezione Sapienza, privilegiando le linee DIRETTE (zero cambi).
 */
export function getOptimalRomeTransit(options: {
  fromStationCode: string; // es. 'S08217' (Tiburtina) o 'S08409' (Termini)
  fromStationName: string;
  classroom: ResolvedClassroom;
  direction?: 'to_campus' | 'to_station';
}): TransitSolution {
  const { fromStationName, classroom, direction = 'to_campus' } = options;
  const bCode = (classroom.buildingCode || '').toUpperCase();
  const addr = (classroom.address || '').toLowerCase();
  const isTiburtina = fromStationName.toUpperCase().includes('TIBURTINA');

  // 1. Polo Tiburtina (RM025, RM158 - Via Tiburtina 205)
  if (bCode === 'RM025' || bCode === 'RM158' || addr.includes('tiburtina 205')) {
    if (isTiburtina) {
      return {
        mode: 'bus',
        durationMinutes: 7,
        inVehicleMinutes: 4,
        walkingMinutes: 3,
        transfersCount: 0,
        lineName: 'Pullman 448 / 492 / 71 / 163 (o a piedi 8 min)',
        routeDescription:
          direction === 'to_campus'
            ? 'Pullman 448, 492, 71 o 163 da Stazione Tiburtina fino a fermata Tiburtina/Marrucini o Verano (~4 min), oppure 8 min a piedi dritto su Via Tiburtina 205'
            : 'Pullman 448, 492, 71 o 163 da fermata Tiburtina/Marrucini verso Stazione Tiburtina (~4 min), oppure 8 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Tiburtina 205, Roma',
      };
    } else {
      return {
        mode: 'tram',
        durationMinutes: 11,
        inVehicleMinutes: 8,
        walkingMinutes: 3,
        transfersCount: 0,
        lineName: 'Tram 14 / 5 o Bus 71 / 492',
        routeDescription: 'Tram 14, 5 o Bus 71 da Termini a fermata Tiburtina/Marrucini (~8 min) + 3 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Tiburtina 205, Roma',
      };
    }
  }

  // 2. Polo San Pietro in Vincoli (RM031-RM039, Via Eudossiana 18)
  if (
    bCode.startsWith('RM03') ||
    bCode === 'RM041' ||
    addr.includes('eudossiana') ||
    addr.includes('vincoli')
  ) {
    if (isTiburtina) {
      return {
        mode: 'metro',
        durationMinutes: 14,
        inVehicleMinutes: 8,
        walkingMinutes: 6,
        transfersCount: 0, // DIRETTA ZERO CAMBI
        lineName: 'Metro B Diretta (Fermata Cavour - Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Metro B da Tiburtina a Cavour (4 fermate, ~8 min, zero cambi) + 6 min a piedi su Scalinata dei Borgia'
            : '6 min a piedi da Via Eudossiana a fermata Cavour + Metro B diretta fino a Tiburtina FS (~8 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Eudossiana 18, Roma',
      };
    } else {
      return {
        mode: 'metro',
        durationMinutes: 8,
        inVehicleMinutes: 2,
        walkingMinutes: 6,
        transfersCount: 0,
        lineName: 'Metro B Diretta (o Bus 75)',
        routeDescription: 'Metro B da Termini a Cavour (1 fermata, 2 min) + 6 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Eudossiana 18, Roma',
      };
    }
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
    if (isTiburtina) {
      return {
        mode: 'bus',
        durationMinutes: 11,
        inVehicleMinutes: 7,
        walkingMinutes: 4,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Pullman 448 / 492 / 71 / 163 / 310 (o Metro B)',
        routeDescription:
          direction === 'to_campus'
            ? 'Pullman 448, 492, 71 o 163 da Tiburtina FS fino a fermata Tiburtina/Castro Laurenziano o Verano (~7 min) + 3 min a piedi, oppure Metro B fino a Policlinico'
            : '3 min a piedi + Pullman 448, 492, 71 o 163 fino a Stazione Tiburtina FS (~7 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via del Castro Laurenziano 7a, Roma',
      };
    } else {
      return {
        mode: 'bus',
        durationMinutes: 12,
        inVehicleMinutes: 8,
        walkingMinutes: 4,
        transfersCount: 0,
        lineName: 'Pullman 310 / 492 Diretto (o Metro B Policlinico)',
        routeDescription: 'Pullman 310 o 492 da Termini a Regina Elena/Università (~8 min) + 4 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via del Castro Laurenziano 7a, Roma',
      };
    }
  }

  // 4. Città Universitaria (Piazzale Aldo Moro 5)
  if (
    addr.includes('aldo moro') ||
    addr.includes('città universitaria') ||
    addr.includes('de lollis') ||
    bCode.startsWith('CU')
  ) {
    if (isTiburtina) {
      return {
        mode: 'bus',
        durationMinutes: 12,
        inVehicleMinutes: 9,
        walkingMinutes: 3,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Pullman 448 / 492 / 71 / 163 (o Tram 3 / 19)',
        routeDescription:
          direction === 'to_campus'
            ? 'Pullman 448, 492 o 71 da Tiburtina FS fino a fermata Verano o De Lollis (~8-9 min) all\'ingresso del Campus Sapienza'
            : 'Varco De Lollis o Verano + Pullman 448, 492 o 71 diretto a Tiburtina FS (~8 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Piazzale Aldo Moro 5, Roma',
      };
    } else {
      return {
        mode: 'bus',
        durationMinutes: 11,
        inVehicleMinutes: 8,
        walkingMinutes: 3,
        transfersCount: 0,
        lineName: 'Pullman 310 / 492 / 71 Diretto',
        routeDescription: 'Pullman 310 o 492 da Termini a De Lollis/Università (~8 min) + 3 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Piazzale Aldo Moro 5, Roma',
      };
    }
  }

  // 5. Polo Ariosto (RM102 - Via Ariosto 25 - Sede I3S)
  if (bCode === 'RM102' || addr.includes('ariosto')) {
    if (isTiburtina) {
      return {
        mode: 'bus',
        durationMinutes: 19,
        inVehicleMinutes: 16,
        walkingMinutes: 3,
        transfersCount: 0, // DIRETTO SENZA CAMBI
        lineName: 'Bus 649 Diretto (Fermata Conte Verde/Manzoni)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 649 da Tiburtina FS fino alla fermata Conte Verde/Manzoni (a soli 180m da Via Ariosto 25, zero cambi), oppure Metro B fino a Termini + Metro A fino a Manzoni'
            : '3 min a piedi per fermata Conte Verde/Manzoni + Bus 649 diretto fino a Tiburtina FS (~16 min), oppure Metro A da stazione Manzoni',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Ariosto 25, Roma',
      };
    } else {
      return {
        mode: 'metro',
        durationMinutes: 7,
        inVehicleMinutes: 3,
        walkingMinutes: 4,
        transfersCount: 0,
        lineName: 'Metro A Diretta (Fermata Manzoni)',
        routeDescription:
          direction === 'to_campus'
            ? 'Metro A da Termini a fermata Manzoni (2 fermate, 3 min) + 3 min a piedi per Via Ariosto 25 (oppure Bus diretti 714, 360, 649, 16)'
            : '3 min a piedi per stazione Metro A Manzoni + Metro A diretta fino a Termini (3 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Ariosto 25, Roma',
      };
    }
  }

  // 6. Polo Salaria (RM076 - Via Salaria 851)
  if (bCode === 'RM076' || addr.includes('salaria')) {
    return {
      mode: 'bus',
      durationMinutes: 19,
      inVehicleMinutes: 16,
      walkingMinutes: 3,
      transfersCount: 0,
      lineName: 'Bus 135 Diretto',
      routeDescription:
        direction === 'to_campus'
          ? 'Bus 135 da Tiburtina FS fino a Salaria/Grottazzolina (~16 min) + 3 min a piedi'
          : '3 min a piedi per Salaria/Grottazzolina + Bus 135 diretto a Tiburtina FS (~16 min)',
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Via Salaria 851, Roma',
    };
  }

  // Fallback generico verso centro/Sapienza
  if (isTiburtina) {
    return {
      mode: 'bus',
      durationMinutes: 12,
      inVehicleMinutes: 8,
      walkingMinutes: 4,
      transfersCount: 0,
      lineName: 'Pullman 448 / 492 / 71 (o Metro B)',
      routeDescription:
        direction === 'to_campus'
          ? `Pullman 448, 492 o 71 da Stazione Tiburtina verso le sedi universitarie Sapienza (${classroom.displayName || classroom.address || 'Campus'}), oppure Metro B`
          : `Pullman 448, 492 o 71 verso Stazione Tiburtina, oppure Metro B`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
    };
  } else {
    return {
      mode: 'mix',
      durationMinutes: 12,
      inVehicleMinutes: 8,
      walkingMinutes: 4,
      transfersCount: 0,
      lineName: `Mezzi Urbani ATAC verso ${classroom.displayName || 'Aula'}`,
      routeDescription:
        direction === 'to_campus'
          ? `Collegamenti bus e metro da Stazione Termini verso ${classroom.address || 'la sede di lezione'}`
          : `Collegamenti bus e metro verso Stazione Termini`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
    };
  }
}
