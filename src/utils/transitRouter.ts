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
        mode: 'walk',
        durationMinutes: 8,
        inVehicleMinutes: 0,
        walkingMinutes: 8,
        transfersCount: 0,
        lineName: 'A Piedi (8 min - Zero mezzi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Uscita Ovest Stazione Tiburtina ➔ A piedi dritto su Via Tiburtina 205 (8 min, zero attese mezzi)'
            : 'A piedi da Via Tiburtina 205 alla Stazione Tiburtina (8 min)',
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
        lineName: 'Tram 14 / 5 Diretto',
        routeDescription: 'Tram 14 o 5 da Termini a fermata Tiburtina/Marrucini (~8 min) + 3 min a piedi',
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
        lineName: 'Metro B Diretta (Zero cambi)',
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
        lineName: 'Metro B Diretta',
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
        durationMinutes: 13,
        inVehicleMinutes: 9,
        walkingMinutes: 4,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Bus 492 / 310 o Tram 3L',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 o 310 da Tiburtina FS a Regina Elena/Università (4 fermate, ~9 min, zero cambi) + 4 min a piedi'
            : '4 min a piedi su Viale Regina Elena + Bus 492 o 310 diretto a Tiburtina FS (~9 min)',
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
        lineName: 'Bus 310 Diretto',
        routeDescription: 'Bus 310 da Termini a Regina Elena/Università (~8 min) + 4 min a piedi',
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
        durationMinutes: 14,
        inVehicleMinutes: 11,
        walkingMinutes: 3,
        transfersCount: 0, // DIRETTO ZERO CAMBI
        lineName: 'Bus 492 / 71 Diretto (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 o 71 da Tiburtina FS a fermata De Lollis/Verano (~11 min, zero cambi) + 3 min a piedi per Varco De Lollis'
            : 'Varco De Lollis + Bus 492 o 71 diretto a Tiburtina FS (~11 min)',
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
        lineName: 'Bus 310 / 492 Diretto',
        routeDescription: 'Bus 310 da Termini a De Lollis/Università (~8 min) + 3 min a piedi',
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
        durationMinutes: 22,
        inVehicleMinutes: 18,
        walkingMinutes: 4,
        transfersCount: 0, // DIRETTO SENZA CAMBI
        lineName: 'Bus 492 Diretto (Zero cambi)',
        routeDescription:
          direction === 'to_campus'
            ? 'Bus 492 da Tiburtina FS fino a fermata Manzoni/Merulana (~18 min a bordo, zero cambi) + 4 min a piedi per Via Ariosto 25'
            : '4 min a piedi per fermata Manzoni + Bus 492 diretto fino a Tiburtina FS (~18 min a bordo, zero cambi)',
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
        lineName: 'Metro A Diretta',
        routeDescription: 'Metro A da Termini a Manzoni (2 fermate, 3 min) + 4 min a piedi per Via Ariosto 25',
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
      mode: 'mix',
      durationMinutes: 20,
      inVehicleMinutes: 15,
      walkingMinutes: 5,
      transfersCount: 0,
      lineName: 'Bus 492 / Metro B',
      routeDescription:
        direction === 'to_campus'
          ? `Mezzi pubblici da Tiburtina verso ${classroom.address || 'Sapienza'}`
          : `Mezzi pubblici da ${classroom.address || 'Sapienza'} verso Stazione Tiburtina`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
    };
  } else {
    return {
      mode: 'mix',
      durationMinutes: 14,
      inVehicleMinutes: 10,
      walkingMinutes: 4,
      transfersCount: 0,
      lineName: 'Metro / Bus Diretto',
      routeDescription:
        direction === 'to_campus'
          ? `Mezzi pubblici da Termini verso ${classroom.address || 'Sapienza'}`
          : `Mezzi pubblici da ${classroom.address || 'Sapienza'} verso Stazione Termini`,
      stationOriginName: fromStationName,
      targetAddress: classroom.address || 'Roma',
    };
  }
}
