import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CommuterConfig,
  StrikeAlertPreferences,
  TrainPreferences,
} from '../types/commuter';
import { normalizeStationInfo } from './trenitaliaApi';
import { getStationNavigationQuery } from './drivingRouter';
import { deduplicatePreferredTrainsMap } from './preferredTrains';

const COMMUTER_CONFIG_KEY = 'studici_commuter_config_v1';

export const DEFAULT_TRAIN_PREFERENCES: Required<TrainPreferences> = {
  preferredTrains: {},
  smartReturnEnabled: true,
  maxEarlyLeaveMinutes: 15,
  minReturnGainMinutes: 25,
};

export const DEFAULT_STRIKE_ALERTS: StrikeAlertPreferences = {
  notify7DaysBefore: true,
  notify1DayBefore: true,
};

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
  includeIntercity: false,
  trainPreferences: { ...DEFAULT_TRAIN_PREFERENCES },
  strikeAlerts: { ...DEFAULT_STRIKE_ALERTS },
};

let commuterStorageQueue: Promise<unknown> = Promise.resolve();
let commuterConfigMemoryCache: CommuterConfig | null = null;

export function clearCommuterMemoryCache(): void {
  commuterConfigMemoryCache = null;
}

async function readCommuterConfigFromStorage(): Promise<CommuterConfig> {
  if (commuterConfigMemoryCache) {
    return commuterConfigMemoryCache;
  }
  try {
    const raw = await AsyncStorage.getItem(COMMUTER_CONFIG_KEY);
    if (!raw) {
      commuterConfigMemoryCache = DEFAULT_COMMUTER_CONFIG;
      return DEFAULT_COMMUTER_CONFIG;
    }
    const parsed = JSON.parse(raw);
    const depNormalized = normalizeStationInfo({
      ...DEFAULT_COMMUTER_CONFIG.departureStation,
      ...(parsed.departureStation || {}),
    });
    const arrNormalized = normalizeStationInfo({
      ...DEFAULT_COMMUTER_CONFIG.arrivalStation,
      ...(parsed.arrivalStation || {}),
    });
    const resolved: CommuterConfig = {
      ...DEFAULT_COMMUTER_CONFIG,
      ...parsed,
      includeIntercity: Boolean(parsed.includeIntercity),
      trainPreferences: {
        ...DEFAULT_TRAIN_PREFERENCES,
        ...(parsed.trainPreferences || {}),
        preferredTrains: deduplicatePreferredTrainsMap(parsed.trainPreferences?.preferredTrains),
      },
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
      strikeAlerts: {
        ...DEFAULT_STRIKE_ALERTS,
        ...(parsed.strikeAlerts || {}),
      },
    };
    commuterConfigMemoryCache = resolved;
    return resolved;
  } catch {
    return DEFAULT_COMMUTER_CONFIG;
  }
}

export async function getCommuterConfig(): Promise<CommuterConfig> {
  try {
    await commuterStorageQueue;
  } catch {}
  return readCommuterConfigFromStorage();
}

export type CommuterChangeListener = (config: CommuterConfig) => void;
const commuterChangeListeners = new Set<CommuterChangeListener>();

export function subscribeToCommuterChanges(
  listener: CommuterChangeListener,
): () => void {
  commuterChangeListeners.add(listener);
  return () => {
    commuterChangeListeners.delete(listener);
  };
}

export function setCommuterChangeListener(
  listener: CommuterChangeListener | null,
): void {
  if (listener) {
    commuterChangeListeners.add(listener);
  }
}

export async function saveCommuterConfig(
  config: Partial<CommuterConfig>,
): Promise<CommuterConfig> {
  const task = commuterStorageQueue
    .catch(() => {})
    .then(async () => {
      try {
        const current = await readCommuterConfigFromStorage();
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
          trainPreferences: {
            ...DEFAULT_TRAIN_PREFERENCES,
            ...(current.trainPreferences || {}),
            ...(config.trainPreferences || {}),
            preferredTrains: deduplicatePreferredTrainsMap(
              config.trainPreferences?.preferredTrains ?? current.trainPreferences?.preferredTrains
            ),
          },
          strikeAlerts: {
            ...DEFAULT_STRIKE_ALERTS,
            ...(current.strikeAlerts || {}),
            ...(config.strikeAlerts || {}),
          },
        };
        commuterConfigMemoryCache = updated;
        await AsyncStorage.setItem(COMMUTER_CONFIG_KEY, JSON.stringify(updated));
        for (const listener of commuterChangeListeners) {
          try {
            listener(updated);
          } catch {}
        }
        return updated;
      } catch {
        return DEFAULT_COMMUTER_CONFIG;
      }
    });
  commuterStorageQueue = task;
  return task;
}

