import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommuterConfig } from '../types/commuter';

const COMMUTER_CONFIG_KEY = 'studici_commuter_config_v1';

export const DEFAULT_COMMUTER_CONFIG: CommuterConfig = {
  enabled: true,
  originAddress: 'Amelia',
  carLeg: {
    enabled: true,
    durationMinutes: 24,
    distanceKm: 17.2,
    parkingBufferMinutes: 7,
    stationAddress: 'Stazione Ferroviaria di Orte, Piazza XXV Aprile, Orte',
  },
  departureStation: {
    name: 'ORTE',
    code: 'S08209',
    shortName: 'Orte',
  },
  arrivalStation: {
    name: 'ROMA TIBURTINA',
    code: 'S08217',
    shortName: 'Roma Tiburtina',
  },
  transitLeg: {
    preferredMode: 'auto',
    durationMinutes: 20,
    lineSuggestion: 'Ottimizzazione automatica (Metro / Tram / Bus ATAC)',
  },
  bufferMinutes: 10,
  destinationType: 'auto',
  customDestinationName: 'Sede I3S - Via Ariosto 25',
  customDestinationAddress: 'Via Ariosto 25, 00185 Roma',
};

export async function getCommuterConfig(): Promise<CommuterConfig> {
  try {
    const raw = await AsyncStorage.getItem(COMMUTER_CONFIG_KEY);
    if (!raw) return DEFAULT_COMMUTER_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_COMMUTER_CONFIG,
      ...parsed,
      carLeg: {
        ...DEFAULT_COMMUTER_CONFIG.carLeg,
        ...(parsed.carLeg || {}),
      },
      departureStation: {
        ...DEFAULT_COMMUTER_CONFIG.departureStation,
        ...(parsed.departureStation || {}),
      },
      arrivalStation: {
        ...DEFAULT_COMMUTER_CONFIG.arrivalStation,
        ...(parsed.arrivalStation || {}),
      },
      transitLeg: {
        ...DEFAULT_COMMUTER_CONFIG.transitLeg,
        ...(parsed.transitLeg || {}),
      },
    };
  } catch {
    return DEFAULT_COMMUTER_CONFIG;
  }
}

export async function saveCommuterConfig(config: Partial<CommuterConfig>): Promise<CommuterConfig> {
  try {
    const current = await getCommuterConfig();
    const updated: CommuterConfig = {
      ...current,
      ...config,
      carLeg: {
        ...current.carLeg,
        ...(config.carLeg || {}),
      },
      departureStation: {
        ...current.departureStation,
        ...(config.departureStation || {}),
      },
      arrivalStation: {
        ...current.arrivalStation,
        ...(config.arrivalStation || {}),
      },
      transitLeg: {
        ...current.transitLeg,
        ...(config.transitLeg || {}),
      },
    };
    await AsyncStorage.setItem(COMMUTER_CONFIG_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return DEFAULT_COMMUTER_CONFIG;
  }
}
