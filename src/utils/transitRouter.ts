import { ResolvedClassroom } from './classroomLocations';

export interface TransitSolution {
  mode: 'bus' | 'metro' | 'walk' | 'mix';
  durationMinutes: number;
  transfersCount: number; // 0 = diretto senza cambi, 1 = un cambio
  lineName: string; // es. "Bus 492 Diretto", "Metro B Diretta", "Metro B + Metro A"
  routeDescription: string;
  stationOriginName: string;
  targetAddress: string;
  walkingMinutes: number;
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
        mode: 'walk',
        durationMinutes: 8,
        transfersCount: 0,
        lineName: 'A Piedi (8 min)',
        routeDescription:
          direction === 'to_campus'
            ? 'Uscita Ovest Stazione Tiburtina ➔ A piedi dritto su Via Tiburtina 205 (8 min, zero mezzi)'
            : 'A piedi da Via Tiburtina 205 alla Stazione Tiburtina (8 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Tiburtina 205, Roma',
        walkingMinutes: 8,
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
        durationMinutes: 15,
        transfersCount: 0, // DIRETTA ZERO CAMBI
        lineName: 'Metro B Diretta (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Metro B da Tiburtina a fermata Cavour (4 fermate, ~8 min, zero cambi) + 6 min a piedi su Scalinata dei Borgia'
            : '6 min a piedi da Via Eudossiana a fermata Cavour + Metro B diretta fino a Tiburtina FS (~8 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Eudossiana 18, Roma',
        walkingMinutes: 6,
      };
    } else {
      return {
        mode: 'metro',
        durationMinutes: 9,
        transfersCount: 0,
        lineName: 'Metro B Diretta',
        routeDescription: 'Metro B da Termini a Cavour (1 fermata, 2 min) + 6 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Eudossiana 18, Roma',
        walkingMinutes: 6,
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
        durationMinutes: 14,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Bus 492 / 310 Diretto (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 o 310 da Tiburtina FS a Regina Elena/Università (4 fermate, ~9 min, zero cambi) + 4 min a piedi'
            : '4 min a piedi su Viale Regina Elena + Bus 492 o 310 diretto a Tiburtina FS (~9 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via del Castro Laurenziano 7a, Roma',
        walkingMinutes: 4,
      };
    } else {
      return {
        mode: 'bus',
        durationMinutes: 13,
        transfersCount: 0,
        lineName: 'Bus 310 Diretto',
        routeDescription: 'Bus 310 da Termini a Regina Elena/Università (~9 min) + 4 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via del Castro Laurenziano 7a, Roma',
        walkingMinutes: 4,
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
        durationMinutes: 15,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Bus 492 / 71 Diretto (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 o 71 da Tiburtina FS a fermata De Lollis/Verano (~11 min, zero cambi) + 3 min a piedi per Varco De Lollis'
            : 'Varco De Lollis + Bus 492 o 71 diretto a Tiburtina FS (~11 min)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Piazzale Aldo Moro 5, Roma',
        walkingMinutes: 3,
      };
    } else {
      return {
        mode: 'bus',
        durationMinutes: 12,
        transfersCount: 0,
        lineName: 'Bus 310 Diretto',
        routeDescription: 'Bus 310 da Termini a De Lollis/Università (~9 min) + 3 min a piedi',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Piazzale Aldo Moro 5, Roma',
        walkingMinutes: 3,
      };
    }
  }

  // 5. Polo Ariosto (RM102 - Via Ariosto 25 - Sede I3S)
  if (bCode === 'RM102' || addr.includes('ariosto')) {
    if (isTiburtina) {
      return {
        mode: 'bus',
        durationMinutes: 22,
        transfersCount: 0, // DIRETTO SENZA CAMBI
        lineName: 'Bus 492 Diretto (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 da Tiburtina FS fino a fermata Manzoni/Merulana (~18 min, zero cambi) + 3 min a piedi per Via Ariosto 25'
            : '3 min a piedi per fermata Manzoni + Bus 492 diretto fino a Tiburtina FS (~18 min, zero cambi)',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Ariosto 25, Roma',
        walkingMinutes: 4,
      };
    } else {
      return {
        mode: 'metro',
        durationMinutes: 8,
        transfersCount: 0,
        lineName: 'Metro A Diretta',
        routeDescription: 'Metro A da Termini a Manzoni (2 fermate, 3 min) + 3 min a piedi per Via Ariosto 25',
        stationOriginName: fromStationName,
        targetAddress: classroom.address || 'Via Ariosto 25, Roma',
        walkingMinutes: 4,
      };
    }
  }

  // Fallback generico verso centro/Sapienza
  if (isTiburtina) {
    return {
      mode: 'mix',
      durationMinutes: 20,
      transfersCount: 0,
      lineName: 'Bus 492 / Metro B',
      routeDescription:
        direction === 'to_campus'
          ? `Mezzi pubblici da Tiburtina verso ${classroom.address || 'Sapienza'}`
          : `Mezzi pubblici da ${classroom.address || 'Sapienza'} verso Stazione Tiburtina`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
      walkingMinutes: 5,
    };
  } else {
    return {
      mode: 'mix',
      durationMinutes: 15,
      transfersCount: 0,
      lineName: 'Metro / Bus Diretto',
      routeDescription:
        direction === 'to_campus'
          ? `Mezzi pubblici da Termini verso ${classroom.address || 'Sapienza'}`
          : `Mezzi pubblici da ${classroom.address || 'Sapienza'} verso Stazione Termini`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
      walkingMinutes: 5,
    };
  }
}
