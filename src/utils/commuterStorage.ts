import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommuterConfig } from '../types/commuter';
import { normalizeStationInfo } from './trenitaliaApi';
import { getStationNavigationQuery } from './drivingRouter';

const COMMUTER_CONFIG_KEY = 'studici_commuter_config_v1';

export const DEFAULT_COMMUTER_CONFIG: CommuterConfig = {
  enabled: false,
  originAddress: '',
  carLeg: {
    enabled: false,
    durationMinutes: 15,
    distanceKm: 6.2,
    parkingBufferMinutes: 5,
    stationAddress: getStationNavigationQuery('Roma Tiburtina'),
  },
  departureStation: {
    name: 'ROMA TIBURTINA',
    code: 'S08217',
    shortName: 'Roma Tiburtina',
  },
  arrivalStation: {
    name: 'ROMA TERMINI',
    code: 'S08409',
    shortName: 'Roma Termini',
  },
  transitLeg: {
    preferredMode: 'auto',
    durationMinutes: 15,
    lineSuggestion: 'Metro / Tram / Bus ATAC / A piedi',
  },
  bufferMinutes: 10,
  destinationType: 'auto',
  customDestinationName: 'Città Universitaria Sapienza',
  customDestinationAddress: 'Piazzale Aldo Moro 5, 00185 Roma',
};

export async function getCommuterConfig(): Promise<CommuterConfig> {
  try {
    const raw = await AsyncStorage.getItem(COMMUTER_CONFIG_KEY);
    if (!raw) return DEFAULT_COMMUTER_CONFIG;
    const parsed = JSON.parse(raw);
    const depNormalized = normalizeStationInfo({
      ...DEFAULT_COMMUTER_CONFIG.departureStation,
      ...(parsed.departureStation || {}),
    });
    const arrNormalized = normalizeStationInfo({
      ...DEFAULT_COMMUTER_CONFIG.arrivalStation,
      ...(parsed.arrivalStation || {}),
    });
    return {
      ...DEFAULT_COMMUTER_CONFIG,
      ...parsed,
      carLeg: {
        ...DEFAULT_COMMUTER_CONFIG.carLeg,
        ...(parsed.carLeg || {}),
        stationAddress: getStationNavigationQuery(depNormalized.shortName || depNormalized.name),
      },
      departureStation: depNormalized,
      arrivalStation: arrNormalized,
      transitLeg: {
        ...DEFAULT_COMMUTER_CONFIG.transitLeg,
        ...(parsed.transitLeg || {}),
      },
    };
  } catch {
    return DEFAULT_COMMUTER_CONFIG;
  }
}

export type CommuterChangeListener = (config: CommuterConfig) => void;
let commuterChangeListener: CommuterChangeListener | null = null;

export function setCommuterChangeListener(
  listener: CommuterChangeListener | null,
): void {
  commuterChangeListener = listener;
}

export async function saveCommuterConfig(
  config: Partial<CommuterConfig>,
): Promise<CommuterConfig> {
  try {
    const current = await getCommuterConfig();
    const depNormalized = normalizeStationInfo({
      ...current.departureStation,
      ...(config.departureStation || {}),
    });
    const arrNormalized = normalizeStationInfo({
      ...current.arrivalStation,
      ...(config.arrivalStation || {}),
    });
    const updated: CommuterConfig = {
      ...current,
      ...config,
      carLeg: {
        ...current.carLeg,
        ...(config.carLeg || {}),
        stationAddress: getStationNavigationQuery(
          depNormalized.shortName || depNormalized.name,
        ),
      },
      departureStation: depNormalized,
      arrivalStation: arrNormalized,
      transitLeg: {
        ...current.transitLeg,
        ...(config.transitLeg || {}),
      },
    };
    await AsyncStorage.setItem(COMMUTER_CONFIG_KEY, JSON.stringify(updated));
    if (commuterChangeListener) {
      try {
        commuterChangeListener(updated);
      } catch {}
    }
    return updated;
  } catch {
    return DEFAULT_COMMUTER_CONFIG;
  }
}

