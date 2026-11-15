import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";
import { formatSapienzaAddress, resolveClassroom } from "./classroomLocations";
import { ScheduleData, ClassEvent, fetchScheduleData, getCachedScheduleData } from "./scraper";
import {
  getManualEvents,
  isManualEventActiveOnDate,
  manualEventToClassEvent,
} from "./manualEvents";
import {
  buildExcludedIdSet,
  getExcludedLessons,
  isLessonExcluded,
} from "./excludedLessons";
import { getCommuterConfig } from "./commuterStorage";
import {
  computeCommuterItinerary,
  getRomeStationName,
} from "./commuterOptimizer";
import {
  ALL_STATIONS,
  POPULAR_STATIONS,
  parseTimeToMinutes,
  resolvePlannedTrainPlatform,
} from "./trenitaliaApi";
import { resolveStationCalendarLocation, StationCalendarLocation } from "./drivingRouter";
import { StudICIAlarms, StructuredLocationEntry } from "../../modules/studici-alarms/src";
import { APP_THEMES, DEFAULT_THEME } from "../constants/theme";
import { CommuterConfig, CommuterItinerary, LiveTrainInfo, PreferredTrain } from "../types/commuter";
import {
  calendarDayIndexToJsDay,
  doesPreferredTrainMatchLiveTrain,
  extractCleanTrainNumber,
  extractTrainCategory,
  getAllPreferredTrains,
  getPreferredTrainsForDayDirection,
  jsDayToCalendarDayIndex,
  timeHHMMToMinutes,
} from "./preferredTrains";

async function attachStructuredLocationsIfSupported(
  entries: StructuredLocationEntry[],
): Promise<void> {
  if (
    Platform.OS !== "ios" ||
    entries.length === 0 ||
    typeof StudICIAlarms?.attachStructuredLocations !== "function"
  ) {
    return;
  }
  try {
    await StudICIAlarms.attachStructuredLocations(entries);
  } catch (err) {
    // Best-effort: fallback su indirizzo testuale già impostato su Calendar.createEventAsync
    console.warn("StudICI attachStructuredLocations warning:", err);
  }
}

export type CalendarType = "lessons" | "trains" | "trains_return";

export type CalendarAlertType =
  | "none"
  | "1h"
  | "event_time"
  | "train_departure"
  | "home_departure"
  | "custom";

export interface CalendarAlertOption {
  type: CalendarAlertType;
  label: string;
  description: string;
  iconName: string;
}

export const CALENDAR_LESSONS_ALERT_OPTIONS: CalendarAlertOption[] = [
  {
    type: "none",
    label: "Nessun avviso",
    description: "Nessun avviso per gli eventi",
    iconName: "notifications-off-outline",
  },
  {
    type: "1h",
    label: "1 ora prima",
    description: "Avviso 60 minuti prima dell'evento",
    iconName: "time-outline",
  },
  {
    type: "event_time",
    label: "All'ora dell'evento",
    description: "Avviso esattamente all'orario di inizio",
    iconName: "play-circle-outline",
  },
  {
    type: "train_departure",
    label: "Quando parte il treno",
    description: "Avviso all'orario di partenza del treno",
    iconName: "train-outline",
  },
  {
    type: "home_departure",
    label: "Quando devo partire da casa",
    description: "Avviso al momento calcolato di uscire di casa",
    iconName: "home-outline",
  },
  {
    type: "custom",
    label: "Personalizzato",
    description: "Minuti di anticipo a tua scelta",
    iconName: "options-outline",
  },
];

export const CALENDAR_TRAINS_ALERT_OPTIONS: CalendarAlertOption[] = [
  {
    type: "none",
    label: "Nessun avviso",
    description: "Nessun avviso per gli eventi",
    iconName: "notifications-off-outline",
  },
  {
    type: "1h",
    label: "1 ora prima",
    description: "Avviso 60 minuti prima dell'evento",
    iconName: "time-outline",
  },
  {
    type: "event_time",
    label: "All'ora dell'evento",
    description: "Avviso esattamente all'orario di inizio",
    iconName: "play-circle-outline",
  },
  {
    type: "home_departure",
    label: "Quando devo partire",
    description: "Avviso all'orario calcolato per partire",
    iconName: "navigate-outline",
  },
  {
    type: "custom",
    label: "Personalizzato",
    description: "Minuti di anticipo a tua scelta",
    iconName: "options-outline",
  },
];

export const CALENDAR_ALERT_OPTIONS: CalendarAlertOption[] = CALENDAR_LESSONS_ALERT_OPTIONS;

export const DEFAULT_LESSONS_CALENDAR_TITLE = "StudICI - Lezioni Sapienza";
export const DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE = "StudICI - Treni";
export const DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE = "StudICI - Treni andata";
export const DEFAULT_TRAIN_RETURN_CALENDAR_TITLE = "StudICI - Treni ritorno";
export const DEFAULT_TRAIN_CALENDAR_TITLE = DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE;
export const DEFAULT_CALENDAR_TITLE = DEFAULT_LESSONS_CALENDAR_TITLE;

// Chiavi Storage per Calendario Lezioni
export const CALENDAR_NAME_KEY = "studici_calendar_custom_title";
export const CALENDAR_ID_KEY = "@studici_calendar_id";
export const CALENDAR_AUTO_SYNC_KEY = "studici_calendar_auto_sync_enabled";
export const CALENDAR_LESSONS_ENABLED_KEY = "studici_calendar_lessons_enabled";
export const CALENDAR_LESSONS_ALERT_TYPE_KEY = "studici_calendar_lessons_alert_type";
export const CALENDAR_LESSONS_ALERT_CUSTOM_KEY = "studici_calendar_lessons_alert_custom";

// Chiavi Storage per Calendario Treni
export const TRAIN_CALENDAR_NAME_KEY = "studici_train_calendar_custom_title";
export const TRAIN_UNIFIED_CALENDAR_NAME_KEY = "studici_train_unified_calendar_custom_title";
export const TRAIN_OUTBOUND_CALENDAR_NAME_KEY = "studici_train_outbound_calendar_custom_title";
export const TRAIN_CALENDAR_ID_KEY = "@studici_train_calendar_id";
export const TRAIN_UNIFIED_CALENDAR_ID_KEY = "@studici_train_unified_calendar_id";
export const TRAIN_OUTBOUND_CALENDAR_ID_KEY = "@studici_train_outbound_calendar_id";
export const TRAIN_CALENDAR_AUTO_SYNC_KEY = "studici_train_calendar_auto_sync_enabled";
export const TRAIN_CALENDAR_ENABLED_KEY = "studici_train_calendar_enabled";
export const TRAIN_CALENDAR_ALERT_TYPE_KEY = "studici_train_calendar_alert_type";
export const TRAIN_CALENDAR_ALERT_CUSTOM_KEY = "studici_train_calendar_alert_custom";

// Chiavi Storage per Treni Ritorno
export const TRAIN_INCLUDE_RETURN_KEY = "studici_train_include_return";
export const TRAIN_SEPARATE_RETURN_KEY = "studici_train_separate_return";
export const TRAIN_RETURN_CALENDAR_NAME_KEY = "studici_train_return_calendar_custom_title";
export const TRAIN_RETURN_CALENDAR_ID_KEY = "@studici_train_return_calendar_id";

// Chiavi Globali
export const CALENDAR_CONFIG_UPDATED_AT_KEY = "@studici_calendar_config_updated_at";
export const CALENDAR_SCHEDULE_HASH_KEY = "studici_calendar_schedule_hash";
export const TRAIN_CALENDAR_SCHEDULE_HASH_KEY = "studici_train_calendar_schedule_hash";
export const TRAIN_CALENDAR_EVENTS_MAP_KEY = "studici_train_calendar_events_map";
export const CALENDAR_COLOR_KEY = "@studici_calendar_theme_color";
export const CALENDAR_LESSONS_CUSTOM_COLOR_KEY = "@studici_calendar_lessons_custom_color";
export const CALENDAR_TRAINS_CUSTOM_COLOR_KEY = "@studici_calendar_trains_custom_color";
export const CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY = "@studici_calendar_trains_return_custom_color";
export const CALENDAR_TRAIN_SHADE_MIGRATED_KEY = "@studici_calendar_train_shade_v1";
export const LAST_CALENDAR_SYNC_KEY = "studici_last_calendar_sync";
export const LAST_TRAIN_CALENDAR_SYNC_KEY = "studici_last_train_calendar_sync";

const THEME_CALENDAR_SHADE_MAP: Record<string, { trains: string; trainsReturn: string }> = {
  "#822433": { trains: "#e05666", trainsReturn: "#f07b88" }, // Rosso Sapienza
  "#1d4ed8": { trains: "#3b82f6", trainsReturn: "#60a5fa" }, // Blu Notte
  "#059669": { trains: "#10b981", trainsReturn: "#34d399" }, // Verde Smeraldo
  "#7c3aed": { trains: "#a855f7", trainsReturn: "#c084fc" }, // Viola Reale
  "#d97706": { trains: "#f59e0b", trainsReturn: "#fbbf24" }, // Arancio Caldo
  "#be185d": { trains: "#ec4899", trainsReturn: "#f472b6" }, // Rosa Rubino
  "#0284c7": { trains: "#0ea5e9", trainsReturn: "#38bdf8" }, // Ciano Oceano
};

export function normalizeCalendarHex(color?: string | null): string | null {
  if (!color || typeof color !== "string") return null;
  const trimmed = color.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  if (/^#[0-9a-f]{8}$/.test(trimmed)) {
    return trimmed.endsWith("ff") ? trimmed.slice(0, 7) : trimmed;
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
  if (rgbMatch) {
    const toHex = (n: string) =>
      Math.min(255, Math.max(0, Number.parseInt(n, 10) || 0))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }
  return null;
}

const APP_THEME_STORAGE_KEY = "app_theme_color_id";

async function resolveThemePrimaryHex(
  themePrimaryFallback?: string,
): Promise<string> {
  const defaultHex = normalizeCalendarHex(DEFAULT_THEME.primary) || "#822433";
  try {
    const [storedThemeId, storedCalendarColor] = await Promise.all([
      AsyncStorage.getItem(APP_THEME_STORAGE_KEY),
      AsyncStorage.getItem(CALENDAR_COLOR_KEY),
    ]);
    const fromThemeId =
      storedThemeId && APP_THEMES[storedThemeId]
        ? normalizeCalendarHex(APP_THEMES[storedThemeId].primary)
        : null;
    const fromCalendarKey = normalizeCalendarHex(storedCalendarColor);
    const fromFallback = normalizeCalendarHex(themePrimaryFallback);

    // Se ThemeContext non si è ancora idratato al mount, passa DEFAULT_THEME.primary (#822433):
    // in quel caso diamo priorità al tema reale salvato in AsyncStorage.
    if (
      fromFallback &&
      (!fromThemeId || fromFallback === fromThemeId || fromFallback !== defaultHex)
    ) {
      return fromFallback;
    }
    return fromThemeId || fromCalendarKey || fromFallback || defaultHex;
  } catch {
    return normalizeCalendarHex(themePrimaryFallback) || defaultHex;
  }
}

async function getFreshCalendarsSafe(): Promise<Calendar.Calendar[]> {
  const [expoResult, nativeResult] = await Promise.allSettled([
    Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT),
    Platform.OS === "ios" &&
    typeof StudICIAlarms?.getFreshEventCalendars === "function"
      ? StudICIAlarms.getFreshEventCalendars()
      : Promise.resolve(null),
  ]);

  const expoCalendars: Calendar.Calendar[] =
    expoResult.status === "fulfilled" && Array.isArray(expoResult.value)
      ? expoResult.value
      : [];
  const freshNative =
    nativeResult.status === "fulfilled" && Array.isArray(nativeResult.value)
      ? nativeResult.value
      : null;

  if (!freshNative || freshNative.length === 0) {
    return expoCalendars;
  }

  const freshById = new Map(freshNative.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const merged: Calendar.Calendar[] = expoCalendars.map((cal) => {
    seenIds.add(cal.id);
    const fresh = freshById.get(cal.id);
    if (!fresh) return cal;
    return {
      ...cal,
      title: fresh.title || cal.title,
      color:
        normalizeCalendarHex(fresh.color) ||
        normalizeCalendarHex(cal.color) ||
        cal.color,
      allowsModifications: fresh.allowsModifications,
    };
  });

  for (const fresh of freshNative) {
    if (seenIds.has(fresh.id)) continue;
    merged.push({
      id: fresh.id,
      title: fresh.title,
      color: normalizeCalendarHex(fresh.color) || DEFAULT_THEME.primary,
      allowsModifications: fresh.allowsModifications,
      entityType: Calendar.EntityTypes.EVENT,
      source: {
        id: fresh.source?.id || "",
        name: fresh.source?.name || "",
        type: fresh.source?.type || "local",
      },
      allowedAvailabilities: [],
    } as Calendar.Calendar);
  }

  return merged;
}

async function updateCalendarMetadataSafe(
  cal: Calendar.Calendar,
  updates: { title?: string; color?: string },
): Promise<boolean> {
  const nextTitle = updates.title?.trim() || cal.title;
  const normalizedUpdateColor = updates.color
    ? normalizeCalendarHex(updates.color)
    : null;
  const currentNormColor = normalizeCalendarHex(cal.color);

  if (
    Platform.OS === "ios" &&
    typeof StudICIAlarms?.updateEventCalendarMetadata === "function"
  ) {
    try {
      const updatedNatively = await StudICIAlarms.updateEventCalendarMetadata(
        cal.id,
        updates.title !== undefined ? nextTitle : null,
        normalizedUpdateColor,
      );
      if (updatedNatively) {
        return true;
      }
    } catch {}
  }

  try {
    const storedThemeColor = await AsyncStorage.getItem(CALENDAR_COLOR_KEY).catch(
      () => null,
    );
    const fallbackSafeColor =
      normalizedUpdateColor ||
      currentNormColor ||
      normalizeCalendarHex(storedThemeColor) ||
      normalizeCalendarHex(DEFAULT_THEME.primary) ||
      "#822433";

    const fullPayload: Partial<Calendar.Calendar> = {
      ...cal,
      title: nextTitle,
      color: fallbackSafeColor,
      allowsModifications: cal.allowsModifications ?? true,
      allowedAvailabilities: Array.isArray(cal.allowedAvailabilities)
        ? cal.allowedAvailabilities
        : [],
    };
    await Calendar.updateCalendarAsync(cal.id, fullPayload);
    return true;
  } catch (err) {
    console.warn("Errore aggiornamento metadati calendario:", err);
    return false;
  }
}

function blendHexTowardWhite(hex: string, factor: number): string {
  const clean = normalizeCalendarHex(hex);
  if (!clean || !/^#[0-9a-f]{6}$/.test(clean)) return hex;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  const mix = (c: number) =>
    Math.min(255, Math.max(0, Math.round(c + (255 - c) * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

/**
 * Restituisce il colore di default derivato dal tema per lo specifico calendario:
 * - Lezioni: colore primario del tema
 * - Treni (unificato/andata): tonalità più vivida dello stesso colore tema
 * - Treni ritorno (se separato): terza tonalità più chiara dello stesso colore tema
 */
export function getThemeCalendarDefaultColor(
  type: CalendarType,
  themePrimaryColor: string = "#822433",
): string {
  const normPrimary = normalizeCalendarHex(themePrimaryColor) || "#822433";
  if (type === "lessons") return normPrimary;
  const preset = THEME_CALENDAR_SHADE_MAP[normPrimary];
  if (preset) {
    return type === "trains_return" ? preset.trainsReturn : preset.trains;
  }
  return blendHexTowardWhite(normPrimary, type === "trains_return" ? 0.42 : 0.25);
}

function getCustomColorStorageKey(type: CalendarType): string {
  if (type === "trains") return CALENDAR_TRAINS_CUSTOM_COLOR_KEY;
  if (type === "trains_return") return CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY;
  return CALENDAR_LESSONS_CUSTOM_COLOR_KEY;
}

export async function getCalendarColor(
  type: CalendarType = "lessons",
  themePrimaryFallback?: string,
): Promise<string> {
  try {
    const custom = await AsyncStorage.getItem(getCustomColorStorageKey(type));
    const normCustom = normalizeCalendarHex(custom);
    if (normCustom) return normCustom;
    const basePrimary = await resolveThemePrimaryHex(themePrimaryFallback);
    return getThemeCalendarDefaultColor(type, basePrimary);
  } catch {
    return getThemeCalendarDefaultColor(
      type,
      normalizeCalendarHex(themePrimaryFallback) || "#822433",
    );
  }
}

export async function hasCustomCalendarColor(
  type: CalendarType = "lessons",
): Promise<boolean> {
  try {
    const custom = await AsyncStorage.getItem(getCustomColorStorageKey(type));
    return Boolean(normalizeCalendarHex(custom));
  } catch {
    return false;
  }
}

type CalendarConfigListener = () => void;
const calendarConfigListeners = new Set<CalendarConfigListener>();

export function subscribeToCalendarConfigChanges(cb: CalendarConfigListener): () => void {
  calendarConfigListeners.add(cb);
  return () => {
    calendarConfigListeners.delete(cb);
  };
}

export function notifyCalendarConfigChanged(): void {
  calendarConfigListeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.warn("Errore listener calendar config:", e);
    }
  });
}

export async function getCalendarConfigUpdatedAt(): Promise<number> {
  try {
    const val = await AsyncStorage.getItem(CALENDAR_CONFIG_UPDATED_AT_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

export interface AppleCalendarRefreshOptions {
  calendarColor?: string;
  schedule?: ScheduleData | null;
  onlySlotKeys?: string[];
  precomputedItineraries?: Record<string, CommuterItinerary>;
}

export interface AppleCalendarSyncOptions {
  prefetchedCalendars?: Calendar.Calendar[];
  skipPullExternal?: boolean;
  onlySlotKeys?: string[];
  precomputedItineraries?: Record<string, CommuterItinerary>;
  forceFullSync?: boolean;
}

// Mutex in-memory per prevenire corse critiche e duplicazioni concorrenti di eventi/calendari
let isCalendarSyncInProgress = false;
let pendingCalendarRefresh = false;
let pendingCalendarRefreshColor: string | undefined = undefined;
let pendingCalendarRefreshSchedule: ScheduleData | null | undefined = undefined;
let pendingCalendarRefreshSlotKeys: Set<string> | null = null;
let pendingCalendarForceAllSlots = false;
let pendingCalendarPrecomputed: Record<string, CommuterItinerary> | undefined = undefined;

function mergePendingRefreshOptions(opts: AppleCalendarRefreshOptions) {
  pendingCalendarRefresh = true;
  if (opts.calendarColor) pendingCalendarRefreshColor = opts.calendarColor;
  if (opts.schedule && opts.schedule.days?.length) {
    pendingCalendarRefreshSchedule = opts.schedule;
  }
  if (opts.onlySlotKeys && opts.onlySlotKeys.length > 0 && !pendingCalendarForceAllSlots) {
    if (!pendingCalendarRefreshSlotKeys) pendingCalendarRefreshSlotKeys = new Set();
    for (const k of opts.onlySlotKeys) {
      pendingCalendarRefreshSlotKeys.add(k);
      let matchedUntagged = false;
      if (opts.precomputedItineraries) {
        for (const [preKey, preItin] of Object.entries(opts.precomputedItineraries)) {
          if (preKey === k || preKey.startsWith(`${k}:`)) {
            if (!pendingCalendarPrecomputed) pendingCalendarPrecomputed = {};
            pendingCalendarPrecomputed[preKey] = preItin;
            if (preKey === k) matchedUntagged = true;
          }
        }
      }
      if (!matchedUntagged && pendingCalendarPrecomputed) {
        delete pendingCalendarPrecomputed[k];
      }
    }
  } else {
    pendingCalendarForceAllSlots = true;
    pendingCalendarRefreshSlotKeys = null;
    if (opts.precomputedItineraries) {
      pendingCalendarPrecomputed = {
        ...(pendingCalendarPrecomputed || {}),
        ...opts.precomputedItineraries,
      };
    } else {
      pendingCalendarPrecomputed = undefined;
    }
  }
}

function releaseCalendarSyncLock() {
  isCalendarSyncInProgress = false;
  if (pendingCalendarRefresh) {
    pendingCalendarRefresh = false;
    const nextColor = pendingCalendarRefreshColor;
    const nextSchedule = pendingCalendarRefreshSchedule;
    const nextSlotKeys =
      !pendingCalendarForceAllSlots && pendingCalendarRefreshSlotKeys?.size
        ? Array.from(pendingCalendarRefreshSlotKeys)
        : undefined;
    const nextPrecomputed = pendingCalendarPrecomputed;
    pendingCalendarRefreshColor = undefined;
    pendingCalendarRefreshSchedule = undefined;
    pendingCalendarRefreshSlotKeys = null;
    pendingCalendarForceAllSlots = false;
    pendingCalendarPrecomputed = undefined;
    setTimeout(() => {
      refreshAppleCalendarIfConfigured({
        calendarColor: nextColor,
        schedule: nextSchedule,
        onlySlotKeys: nextSlotKeys,
        precomputedItineraries: nextPrecomputed,
      }).catch(() => {});
    }, 50);
  }
}

export function isCalendarSyncActive(): boolean {
  return isCalendarSyncInProgress;
}

export interface CalendarSyncResult {
  success: boolean;
  eventsCount: number;
  message: string;
  error?: string;
}

export interface CalendarAlertConfig {
  alertType: CalendarAlertType;
  customMinutes: number;
}

/**
 * Calcola l'offset relativo degli avvisi nativi del calendario (in minuti negativi prima dell'inizio).
 */
export function computeAlarmOffsets(options: {
  alertType: CalendarAlertType;
  customMinutes?: number;
  eventStartTimeMinutes: number;
  referenceTimeMinutes?: number | null;
}): { relativeOffset: number }[] {
  const { alertType, customMinutes = 15, eventStartTimeMinutes, referenceTimeMinutes } = options;

  if (alertType === "none") {
    return [];
  }
  if (alertType === "1h") {
    return [{ relativeOffset: -60 }];
  }
  if (alertType === "event_time") {
    return [{ relativeOffset: 0 }];
  }
  if (alertType === "custom") {
    const mins = Math.max(1, Math.round(customMinutes || 15));
    return [{ relativeOffset: -mins }];
  }
  if (alertType === "train_departure" || alertType === "home_departure") {
    if (typeof referenceTimeMinutes === "number" && !isNaN(referenceTimeMinutes)) {
      const diff = eventStartTimeMinutes - referenceTimeMinutes;
      if (diff > 0) {
        return [{ relativeOffset: -diff }];
      } else if (diff === 0) {
        return [{ relativeOffset: 0 }];
      }
    }
    // Fallback naturale se la reference time non è disponibile
    return alertType === "train_departure" ? [{ relativeOffset: 0 }] : [{ relativeOffset: -60 }];
  }

  return [];
}

/**
 * Pulisce ed evita la duplicazione di prefissi categoria nei treni (es. "RV RV 4153" -> "RV 4153").
 */
export function formatTrainLabel(category?: string, trainNumber?: string): string {
  const cat = (category || "").trim();
  let num = (trainNumber || "").trim();

  if (!num) return cat || "Treno";

  // Rimuove eventuali doppie ripetizioni consecutive (es. "RV RV 4153" -> "RV 4153", "REG REG" -> "REG")
  num = num.replace(/\b([A-Za-z]{2,4})\s+\1\b/gi, "$1");

  const upperNum = num.toUpperCase();
  const upperCat = cat.toUpperCase();

  if (upperCat && upperNum.startsWith(upperCat)) {
    return num;
  }

  const firstToken = upperNum.split(/\s+/)[0];
  if (["RV", "REG", "IC", "EC", "EN", "FA", "FR", "FB", "EXP"].includes(firstToken)) {
    return num;
  }

  if (!cat) return num;
  return `${cat} ${num}`.trim();
}

/**
 * Restituisce l'ultimo timestamp di sincronizzazione per il calendario specificato.
 */
export async function getLastCalendarSync(
  type: CalendarType = "lessons",
): Promise<number | null> {
  try {
    const key = type === "trains" ? LAST_TRAIN_CALENDAR_SYNC_KEY : LAST_CALENDAR_SYNC_KEY;
    const val = await AsyncStorage.getItem(key);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Restituisce se un dato calendario è abilitato dall'utente.
 */
export async function getCalendarEnabled(
  type: CalendarType = "lessons",
): Promise<boolean> {
  try {
    const key = type === "trains" ? TRAIN_CALENDAR_ENABLED_KEY : CALENDAR_LESSONS_ENABLED_KEY;
    const val = await AsyncStorage.getItem(key);
    // Di default Lezioni è abilitato (true), Treni è abilitato (true)
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

/**
 * Imposta lo stato di abilitazione del calendario.
 */
export async function setCalendarEnabled(
  enabled: boolean,
  type: CalendarType = "lessons",
  updatedAt?: number,
): Promise<void> {
  try {
    const key = type === "trains" ? TRAIN_CALENDAR_ENABLED_KEY : CALENDAR_LESSONS_ENABLED_KEY;
    await AsyncStorage.setItem(key, enabled ? "true" : "false");
    const ts = updatedAt || Date.now();
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

/**
 * Restituisce se includere o meno i treni del ritorno nel calendario.
 */
export async function getTrainIncludeReturn(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(TRAIN_INCLUDE_RETURN_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

/**
 * Imposta se includere i treni di ritorno nel calendario.
 */
export async function setTrainIncludeReturn(
  enabled: boolean,
  updatedAt?: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAIN_INCLUDE_RETURN_KEY, enabled ? "true" : "false");
    const ts = updatedAt || Date.now();
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

/**
 * Restituisce se inserire i treni di ritorno in un calendario separato da quello di andata.
 */
export async function getTrainSeparateReturn(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(TRAIN_SEPARATE_RETURN_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Imposta se inserire i treni di ritorno in un calendario separato da quello di andata.
 */
export async function setTrainSeparateReturn(
  separate: boolean,
  updatedAt?: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAIN_SEPARATE_RETURN_KEY, separate ? "true" : "false");
    const ts = updatedAt || Date.now();
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

/**
 * Restituisce il nome personalizzato del calendario (o quello di default).
 */
export async function getCalendarTitle(
  type: CalendarType = "lessons",
  isSeparateParam?: boolean,
): Promise<string> {
  try {
    let key = CALENDAR_NAME_KEY;
    let defaultTitle = DEFAULT_LESSONS_CALENDAR_TITLE;
    if (type === "trains") {
      const isSeparate =
        isSeparateParam !== undefined
          ? isSeparateParam
          : await getTrainSeparateReturn();
      if (isSeparate) {
        key = TRAIN_OUTBOUND_CALENDAR_NAME_KEY;
        defaultTitle = DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE;
      } else {
        key = TRAIN_UNIFIED_CALENDAR_NAME_KEY;
        defaultTitle = DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE;
      }
      let val = await AsyncStorage.getItem(key);
      if (!val) {
        val = await AsyncStorage.getItem(TRAIN_CALENDAR_NAME_KEY);
      }
      if (
        val &&
        (val.trim() === "StudICI - Treni & Viaggio" ||
          val.trim() === "StudICI - Treni Ritorno" ||
          (isSeparate && val.trim() === DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE) ||
          (!isSeparate && val.trim() === DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE))
      ) {
        return defaultTitle;
      }
      return val && val.trim() ? val.trim() : defaultTitle;
    } else if (type === "trains_return") {
      key = TRAIN_RETURN_CALENDAR_NAME_KEY;
      defaultTitle = DEFAULT_TRAIN_RETURN_CALENDAR_TITLE;
      const val = await AsyncStorage.getItem(key);
      if (val && val.trim() === "StudICI - Treni Ritorno") {
        return defaultTitle;
      }
      return val && val.trim() ? val.trim() : defaultTitle;
    }

    const val = await AsyncStorage.getItem(key);
    return val && val.trim() ? val.trim() : defaultTitle;
  } catch {
    if (type === "trains") {
      return isSeparateParam
        ? DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE
        : DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE;
    }
    if (type === "trains_return") return DEFAULT_TRAIN_RETURN_CALENDAR_TITLE;
    return DEFAULT_LESSONS_CALENDAR_TITLE;
  }
}

/**
 * Modifica il nome del calendario e ne aggiorna il titolo direttamente nel servizio nativo di sistema.
 */
export async function setCalendarTitle(
  newTitle: string,
  typeOrUpdatedAt: CalendarType | number = "lessons",
  updatedAt?: number,
  isSeparateParam?: boolean,
): Promise<{ success: boolean; message: string }> {
  const type: CalendarType =
    typeof typeOrUpdatedAt === "string" ? typeOrUpdatedAt : "lessons";
  const ts: number =
    typeof typeOrUpdatedAt === "number" ? typeOrUpdatedAt : (updatedAt || Date.now());

  let defaultTitle = DEFAULT_LESSONS_CALENDAR_TITLE;
  let key = CALENDAR_NAME_KEY;
  let idKey = CALENDAR_ID_KEY;
  let internalName = "studici_lessons";

  if (type === "trains") {
    const isSeparate =
      isSeparateParam !== undefined
        ? isSeparateParam
        : await getTrainSeparateReturn();
    if (isSeparate) {
      defaultTitle = DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE;
      key = TRAIN_OUTBOUND_CALENDAR_NAME_KEY;
      idKey = TRAIN_OUTBOUND_CALENDAR_ID_KEY;
      internalName = "studici_trains_outbound";
    } else {
      defaultTitle = DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE;
      key = TRAIN_UNIFIED_CALENDAR_NAME_KEY;
      idKey = TRAIN_UNIFIED_CALENDAR_ID_KEY;
      internalName = "studici_trains_unified";
    }
  } else if (type === "trains_return") {
    defaultTitle = DEFAULT_TRAIN_RETURN_CALENDAR_TITLE;
    key = TRAIN_RETURN_CALENDAR_NAME_KEY;
    idKey = TRAIN_RETURN_CALENDAR_ID_KEY;
    internalName = "studici_trains_return";
  }

  const trimmed = newTitle.trim();
  const titleToSave = trimmed || defaultTitle;
  const previousTitle = await getCalendarTitle(type, isSeparateParam);

  await AsyncStorage.setItem(key, titleToSave);
  if (type === "trains") {
    await AsyncStorage.setItem(TRAIN_CALENDAR_NAME_KEY, titleToSave);
  }
  await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
  notifyCalendarConfigChanged();

  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (isAvailable) {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status === "granted") {
        const calendars = await getFreshCalendarsSafe();
        const isSeparate =
          isSeparateParam !== undefined
            ? isSeparateParam
            : await getTrainSeparateReturn();

        let targetCal = await findManagedAppleCalendar(calendars, type, isSeparate);
        if (!targetCal) {
          targetCal =
            calendars.find(
              (c) =>
                (c.name === internalName ||
                  c.title === previousTitle ||
                  c.title === titleToSave ||
                  c.title === defaultTitle ||
                  c.title === DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE ||
                  c.title === DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE ||
                  c.title === DEFAULT_TRAIN_RETURN_CALENDAR_TITLE ||
                  c.title === "StudICI - Treni & Viaggio" ||
                  c.title === "StudICI - Treni Ritorno") &&
                c.allowsModifications,
            ) || null;
        }

        if (targetCal) {
          await AsyncStorage.setItem(idKey, targetCal.id);
          const effectiveColor = await getCalendarColor(type);
          await updateCalendarMetadataSafe(targetCal, {
            title: titleToSave,
            color: effectiveColor,
          });
        }
      }
    }
  } catch (err) {
    console.warn("Errore aggiornamento titolo calendario su dispositivo:", err);
  }

  return {
    success: true,
    message: `Nome calendario aggiornato in "${titleToSave}".`,
  };
}

/**
 * Restituisce lo stato dell'aggiornamento automatico del calendario all'avvio.
 */
export async function getCalendarAutoSync(
  type: CalendarType = "lessons",
): Promise<boolean> {
  try {
    const key = type === "trains" ? TRAIN_CALENDAR_AUTO_SYNC_KEY : CALENDAR_AUTO_SYNC_KEY;
    const val = await AsyncStorage.getItem(key);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Imposta l'aggiornamento automatico del calendario.
 */
export async function setCalendarAutoSync(
  enabled: boolean,
  typeOrUpdatedAt: CalendarType | number = "lessons",
  updatedAt?: number,
): Promise<void> {
  const type: CalendarType =
    typeof typeOrUpdatedAt === "string" ? typeOrUpdatedAt : "lessons";
  const ts: number =
    typeof typeOrUpdatedAt === "number" ? typeOrUpdatedAt : (updatedAt || Date.now());

  try {
    const key = type === "trains" ? TRAIN_CALENDAR_AUTO_SYNC_KEY : CALENDAR_AUTO_SYNC_KEY;
    await AsyncStorage.setItem(key, enabled ? "true" : "false");
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

/**
 * Restituisce la configurazione degli avvisi nativi per il tipo di calendario indicato.
 */
export async function getCalendarAlertConfig(
  type: CalendarType = "lessons",
): Promise<CalendarAlertConfig> {
  try {
    const typeKey =
      type === "trains"
        ? TRAIN_CALENDAR_ALERT_TYPE_KEY
        : CALENDAR_LESSONS_ALERT_TYPE_KEY;
    const customKey =
      type === "trains"
        ? TRAIN_CALENDAR_ALERT_CUSTOM_KEY
        : CALENDAR_LESSONS_ALERT_CUSTOM_KEY;

    const [savedType, savedCustom] = await Promise.all([
      AsyncStorage.getItem(typeKey),
      AsyncStorage.getItem(customKey),
    ]);

    const validTypes: CalendarAlertType[] = [
      "none",
      "1h",
      "event_time",
      "train_departure",
      "home_departure",
      "custom",
    ];

    const alertType: CalendarAlertType =
      savedType && validTypes.includes(savedType as CalendarAlertType)
        ? (savedType as CalendarAlertType)
        : "none";

    const customMinutes = savedCustom ? parseInt(savedCustom, 10) || 15 : 15;

    return { alertType, customMinutes };
  } catch {
    return { alertType: "none", customMinutes: 15 };
  }
}

/**
 * Salva la configurazione degli avvisi per il calendario specificato.
 */
export async function setCalendarAlertConfig(
  type: CalendarType,
  config: CalendarAlertConfig,
  updatedAt?: number,
): Promise<void> {
  try {
    const typeKey =
      type === "trains"
        ? TRAIN_CALENDAR_ALERT_TYPE_KEY
        : CALENDAR_LESSONS_ALERT_TYPE_KEY;
    const customKey =
      type === "trains"
        ? TRAIN_CALENDAR_ALERT_CUSTOM_KEY
        : CALENDAR_LESSONS_ALERT_CUSTOM_KEY;

    await Promise.all([
      AsyncStorage.setItem(typeKey, config.alertType),
      AsyncStorage.setItem(customKey, Math.max(1, Math.round(config.customMinutes || 15)).toString()),
    ]);

    const ts = updatedAt || Date.now();
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

async function findManagedAppleCalendar(
  calendars: Calendar.Calendar[],
  type: CalendarType,
  isSeparateParam?: boolean,
): Promise<Calendar.Calendar | null> {
  const isSeparate =
    isSeparateParam !== undefined ? isSeparateParam : await getTrainSeparateReturn();

  let idKey = CALENDAR_ID_KEY;
  let fallbackIdKey: string | null = null;
  let internalNames = ["studici_lessons"];
  let defaultTitles = [DEFAULT_LESSONS_CALENDAR_TITLE];

  if (type === "trains") {
    idKey = isSeparate ? TRAIN_OUTBOUND_CALENDAR_ID_KEY : TRAIN_UNIFIED_CALENDAR_ID_KEY;
    fallbackIdKey = TRAIN_CALENDAR_ID_KEY;
    internalNames = isSeparate
      ? ["studici_trains_outbound", "studici_trains"]
      : ["studici_trains_unified", "studici_trains"];
    defaultTitles = isSeparate
      ? [DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE, "StudICI - Treni & Viaggio"]
      : [DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE, "StudICI - Treni & Viaggio"];
  } else if (type === "trains_return") {
    idKey = TRAIN_RETURN_CALENDAR_ID_KEY;
    internalNames = ["studici_trains_return"];
    defaultTitles = [DEFAULT_TRAIN_RETURN_CALENDAR_TITLE, "StudICI - Treni Ritorno"];
  }

  const [storedId, fallbackId, savedTitle] = await Promise.all([
    AsyncStorage.getItem(idKey),
    fallbackIdKey ? AsyncStorage.getItem(fallbackIdKey) : Promise.resolve(null),
    getCalendarTitle(type, isSeparate),
  ]);

  const candidateIds = [storedId, fallbackId].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  for (const cid of candidateIds) {
    const byId = calendars.find((c) => c.id === cid && c.allowsModifications);
    if (byId) return byId;
  }

  const isICloudCal = (c: Calendar.Calendar) =>
    Boolean(
      c.source &&
        (c.source.name?.toLowerCase().includes("icloud") ||
          c.source.type === Calendar.SourceType.CALDAV),
    );

  const byInternalName = calendars
    .filter((c) => c.allowsModifications && c.name && internalNames.includes(c.name))
    .sort((a, b) => (isICloudCal(b) ? 1 : 0) - (isICloudCal(a) ? 1 : 0))[0];
  if (byInternalName) return byInternalName;

  const trimmedSaved = savedTitle?.trim();
  const candidateTitles = new Set(
    [trimmedSaved, ...defaultTitles].map((t) => t?.trim()).filter(Boolean),
  );
  const byTitleMatches = calendars.filter(
    (c) =>
      c.allowsModifications &&
      c.title &&
      candidateTitles.has(c.title.trim()),
  );
  if (byTitleMatches.length > 0) {
    byTitleMatches.sort((a, b) => {
      const aExactSaved = a.title?.trim() === trimmedSaved ? 2 : 0;
      const bExactSaved = b.title?.trim() === trimmedSaved ? 2 : 0;
      if (aExactSaved !== bExactSaved) return bExactSaved - aExactSaved;
      return (isICloudCal(b) ? 1 : 0) - (isICloudCal(a) ? 1 : 0);
    });
    return byTitleMatches[0];
  }

  return null;
}

async function patchSavedFingerprintTitle(
  hashKey: string,
  field: "t" | "retTitle",
  newTitle: string,
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(hashKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed[field] !== newTitle) {
      parsed[field] = newTitle;
      await AsyncStorage.setItem(hashKey, JSON.stringify(parsed));
    }
  } catch {}
}

/**
 * Legge eventuali modifiche fatte dall'utente direttamente nell'app Calendario Apple
 * (titolo o colore dei calendari gestiti da StudICI) e allinea i dati locali dell'app.
 */
async function _pullExternalChangesInternal(
  calendars: Calendar.Calendar[],
  themePrimaryFallback?: string,
  options?: { detectExternalDeletion?: boolean },
): Promise<{ updated: boolean }> {
  let updated = false;
  if (!calendars || calendars.length === 0) {
    return { updated: false };
  }
  const detectExternalDeletion = options?.detectExternalDeletion ?? true;
  try {
    const [separateReturn, basePrimary, migratedTrainShade] = await Promise.all([
      getTrainSeparateReturn(),
      resolveThemePrimaryHex(themePrimaryFallback),
      AsyncStorage.getItem(CALENDAR_TRAIN_SHADE_MIGRATED_KEY),
    ]);

    const activeTypes: CalendarType[] = separateReturn
      ? ["lessons", "trains", "trains_return"]
      : ["lessons", "trains"];

    for (const type of activeTypes) {
      const idKey =
        type === "lessons"
          ? CALENDAR_ID_KEY
          : type === "trains_return"
            ? TRAIN_RETURN_CALENDAR_ID_KEY
            : separateReturn
              ? TRAIN_OUTBOUND_CALENDAR_ID_KEY
              : TRAIN_UNIFIED_CALENDAR_ID_KEY;

      const cal = await findManagedAppleCalendar(calendars, type, separateReturn);
      if (!cal) {
        if (detectExternalDeletion) {
          if (type === "lessons") {
            const [storedId, lastSync] = await Promise.all([
              AsyncStorage.getItem(CALENDAR_ID_KEY),
              AsyncStorage.getItem(LAST_CALENDAR_SYNC_KEY),
            ]);
            if (storedId || lastSync) {
              await AsyncStorage.multiRemove([
                CALENDAR_ID_KEY,
                CALENDAR_SCHEDULE_HASH_KEY,
                LAST_CALENDAR_SYNC_KEY,
                CALENDAR_LESSONS_CUSTOM_COLOR_KEY,
              ]);
              await setCalendarEnabled(false, "lessons");
              await setCalendarAutoSync(false, "lessons");
              updated = true;
            }
          } else if (type === "trains" && !separateReturn) {
            const [storedUnifiedId, storedLegacyId, lastTrainSync] = await Promise.all([
              AsyncStorage.getItem(TRAIN_UNIFIED_CALENDAR_ID_KEY),
              AsyncStorage.getItem(TRAIN_CALENDAR_ID_KEY),
              AsyncStorage.getItem(LAST_TRAIN_CALENDAR_SYNC_KEY),
            ]);
            if (storedUnifiedId || storedLegacyId || lastTrainSync) {
              await AsyncStorage.multiRemove([
                TRAIN_UNIFIED_CALENDAR_ID_KEY,
                TRAIN_CALENDAR_ID_KEY,
                TRAIN_CALENDAR_SCHEDULE_HASH_KEY,
                TRAIN_CALENDAR_EVENTS_MAP_KEY,
                LAST_TRAIN_CALENDAR_SYNC_KEY,
                CALENDAR_TRAINS_CUSTOM_COLOR_KEY,
              ]);
              await setCalendarEnabled(false, "trains");
              await setCalendarAutoSync(false, "trains");
              updated = true;
            }
          } else if (separateReturn && (type === "trains" || type === "trains_return")) {
            // Calendari treni separati: se eliminati su Apple Calendar restano abilitati e si ricreano alla prossima sync
            const storedId = await AsyncStorage.getItem(idKey);
            if (storedId) {
              const keysToClear =
                type === "trains"
                  ? [idKey, TRAIN_CALENDAR_ID_KEY, TRAIN_CALENDAR_SCHEDULE_HASH_KEY]
                  : [idKey, TRAIN_CALENDAR_SCHEDULE_HASH_KEY];
              await AsyncStorage.multiRemove(keysToClear);
            }
          }
        }
        continue;
      }

      await AsyncStorage.setItem(idKey, cal.id);

      // 1. Allinea eventuale rinomina fatta da Apple Calendar
      const calTitle = cal.title?.trim();
      const savedTitle = await getCalendarTitle(type, separateReturn);
      if (calTitle && calTitle !== savedTitle) {
        if (type === "lessons") {
          await AsyncStorage.setItem(CALENDAR_NAME_KEY, calTitle);
          await patchSavedFingerprintTitle(CALENDAR_SCHEDULE_HASH_KEY, "t", calTitle);
        } else if (type === "trains") {
          const trainTitleKey = separateReturn
            ? TRAIN_OUTBOUND_CALENDAR_NAME_KEY
            : TRAIN_UNIFIED_CALENDAR_NAME_KEY;
          await AsyncStorage.setItem(trainTitleKey, calTitle);
          await AsyncStorage.setItem(TRAIN_CALENDAR_NAME_KEY, calTitle);
          await patchSavedFingerprintTitle(TRAIN_CALENDAR_SCHEDULE_HASH_KEY, "t", calTitle);
        } else {
          await AsyncStorage.setItem(TRAIN_RETURN_CALENDAR_NAME_KEY, calTitle);
          await patchSavedFingerprintTitle(
            TRAIN_CALENDAR_SCHEDULE_HASH_KEY,
            "retTitle",
            calTitle,
          );
        }
        updated = true;
      }

      // 2. Allinea eventuale cambio colore fatto da Apple Calendar
      const calColor = normalizeCalendarHex(cal.color);
      if (calColor) {
        const customKey = getCustomColorStorageKey(type);
        const savedCustom = normalizeCalendarHex(await AsyncStorage.getItem(customKey));
        const themeDefaultForType = getThemeCalendarDefaultColor(type, basePrimary);

        // Migrazione una-tantum dei vecchi calendari treni che usavano theme.primary identico alle lezioni
        if (
          (type === "trains" || type === "trains_return") &&
          !migratedTrainShade &&
          !savedCustom &&
          calColor === basePrimary &&
          themeDefaultForType !== basePrimary
        ) {
          await updateCalendarMetadataSafe(cal, {
            color: themeDefaultForType,
          });
          continue;
        }

        const expectedColor = savedCustom || themeDefaultForType;
        if (calColor !== expectedColor) {
          if (calColor === themeDefaultForType) {
            await AsyncStorage.removeItem(customKey);
          } else {
            await AsyncStorage.setItem(customKey, calColor);
          }
          updated = true;
        }
      }
    }

    if (!migratedTrainShade) {
      await AsyncStorage.setItem(CALENDAR_TRAIN_SHADE_MIGRATED_KEY, "1");
    }

    if (updated) {
      await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, Date.now().toString());
      notifyCalendarConfigChanged();
    }
  } catch (err) {
    console.warn("Errore lettura modifiche esterne Apple Calendar:", err);
  }
  return { updated };
}

let inFlightExternalPullPromise: Promise<{ updated: boolean }> | null = null;

export async function pullExternalAppleCalendarChanges(
  themePrimaryFallback?: string,
): Promise<{ updated: boolean }> {
  if (inFlightExternalPullPromise) {
    return inFlightExternalPullPromise;
  }

  let currentPromise!: Promise<{ updated: boolean }>;
  const runPull = async (): Promise<{ updated: boolean }> => {
    try {
      let waitedMs = 0;
      while (isCalendarSyncInProgress && waitedMs < 3000) {
        await new Promise((r) => setTimeout(r, 100));
        waitedMs += 100;
      }
      if (isCalendarSyncInProgress) {
        return { updated: false };
      }

      const isAvailable = await Calendar.isAvailableAsync();
      if (!isAvailable) return { updated: false };
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status !== "granted") return { updated: false };
      const calendars = await getFreshCalendarsSafe();
      return await _pullExternalChangesInternal(calendars, themePrimaryFallback);
    } catch {
      return { updated: false };
    } finally {
      if (inFlightExternalPullPromise === currentPromise) {
        inFlightExternalPullPromise = null;
      }
    }
  };

  currentPromise = runPull();
  inFlightExternalPullPromise = currentPromise;
  return currentPromise;
}

export async function resetCalendarColorToTheme(
  type: CalendarType,
  themePrimaryColor?: string,
): Promise<string> {
  const basePrimary = await resolveThemePrimaryHex(themePrimaryColor);
  const targetColor = getThemeCalendarDefaultColor(type, basePrimary);
  await AsyncStorage.removeItem(getCustomColorStorageKey(type));

  try {
    const isAvailable = await Calendar.isAvailableAsync();
    const { status } = isAvailable
      ? await Calendar.getCalendarPermissionsAsync()
      : { status: "denied" };
    if (isAvailable && status === "granted") {
      const calendars = await getFreshCalendarsSafe();
      const cal = await findManagedAppleCalendar(calendars, type);
      if (cal && normalizeCalendarHex(cal.color) !== normalizeCalendarHex(targetColor)) {
        await updateCalendarMetadataSafe(cal, {
          color: targetColor,
        });
      }
    }
  } catch (err) {
    console.warn("Errore ripristino colore tema calendario:", err);
  }

  await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, Date.now().toString());
  notifyCalendarConfigChanged();
  return targetColor;
}

/**
 * Aggiorna il colore dei calendari Apple StudICI per farli combaciare con il tema attivo
 * (usando il colore primario per Lezioni e tonalità coordinate dello stesso tema per Treni).
 */
export async function updateAppleCalendarColor(
  color: string,
  forceResetCustom: boolean = false,
): Promise<void> {
  try {
    if (!color) return;
    const normPrimary = normalizeCalendarHex(color) || color;
    await AsyncStorage.setItem(CALENDAR_COLOR_KEY, normPrimary);
    await AsyncStorage.setItem(CALENDAR_TRAIN_SHADE_MIGRATED_KEY, "1");

    if (forceResetCustom) {
      await Promise.all([
        AsyncStorage.removeItem(CALENDAR_LESSONS_CUSTOM_COLOR_KEY),
        AsyncStorage.removeItem(CALENDAR_TRAINS_CUSTOM_COLOR_KEY),
        AsyncStorage.removeItem(CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY),
      ]);
    }

    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      if (forceResetCustom) notifyCalendarConfigChanged();
      return;
    }
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      if (forceResetCustom) notifyCalendarConfigChanged();
      return;
    }

    const calendars = await getFreshCalendarsSafe();
    const separateReturn = await getTrainSeparateReturn();

    const targets: { type: CalendarType; color: string }[] = [
      {
        type: "lessons",
        color: forceResetCustom
          ? getThemeCalendarDefaultColor("lessons", normPrimary)
          : await getCalendarColor("lessons", normPrimary),
      },
      {
        type: "trains",
        color: forceResetCustom
          ? getThemeCalendarDefaultColor("trains", normPrimary)
          : await getCalendarColor("trains", normPrimary),
      },
    ];
    if (separateReturn) {
      targets.push({
        type: "trains_return",
        color: forceResetCustom
          ? getThemeCalendarDefaultColor("trains_return", normPrimary)
          : await getCalendarColor("trains_return", normPrimary),
      });
    }

    for (const t of targets) {
      const cal = await findManagedAppleCalendar(calendars, t.type, separateReturn);
      if (
        cal &&
        normalizeCalendarHex(cal.color) !== normalizeCalendarHex(t.color)
      ) {
        await updateCalendarMetadataSafe(cal, {
          color: t.color,
        });
      }
    }

    if (forceResetCustom) {
      notifyCalendarConfigChanged();
    }
  } catch (err) {
    console.warn("Impossibile aggiornare colore calendari al tema:", err);
  }
}

/**
 * Rimuove dal dispositivo il calendario indicato (o entrambi se 'all').
 */
export async function deleteStudICICalendar(
  target: "lessons" | "trains" | "trains_return" | "all" = "all",
): Promise<{ success: boolean; message: string }> {
  const isOuter = !isCalendarSyncInProgress;
  if (isOuter) isCalendarSyncInProgress = true;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, message: "Calendario non disponibile." };
    }
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      return { success: false, message: "Permessi calendario non concessi." };
    }

    const calendars = await getFreshCalendarsSafe();

    const deleteLessons = target === "lessons" || target === "all";
    const deleteTrains = target === "trains" || target === "all";
    const deleteTrainsReturnOnly = target === "trains_return";

    if (deleteLessons) {
      const storedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
      const title = await getCalendarTitle("lessons");
      const matching = calendars.filter(
        (c) =>
          c.allowsModifications &&
          (c.id === storedId ||
            c.name === "studici_lessons" ||
            c.title === title ||
            c.title === DEFAULT_LESSONS_CALENDAR_TITLE),
      );
      for (const cal of matching) {
        try {
          await Calendar.deleteCalendarAsync(cal.id);
        } catch {}
      }
      await AsyncStorage.removeItem(LAST_CALENDAR_SYNC_KEY);
      await AsyncStorage.removeItem(CALENDAR_SCHEDULE_HASH_KEY);
      await AsyncStorage.removeItem(CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(CALENDAR_LESSONS_CUSTOM_COLOR_KEY);
    }

    if (deleteTrains) {
      const [
        storedId,
        storedUnifiedId,
        storedOutboundId,
        storedReturnId,
        unifiedTitle,
        outboundTitle,
        returnTitle,
      ] = await Promise.all([
        AsyncStorage.getItem(TRAIN_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_UNIFIED_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_OUTBOUND_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_RETURN_CALENDAR_ID_KEY),
        getCalendarTitle("trains", false),
        getCalendarTitle("trains", true),
        getCalendarTitle("trains_return"),
      ]);

      const matching = calendars.filter(
        (c) =>
          c.allowsModifications &&
          (c.id === storedId ||
            c.id === storedUnifiedId ||
            c.id === storedOutboundId ||
            c.id === storedReturnId ||
            c.name === "studici_trains" ||
            c.name === "studici_trains_unified" ||
            c.name === "studici_trains_outbound" ||
            c.name === "studici_trains_return" ||
            c.title === unifiedTitle ||
            c.title === outboundTitle ||
            c.title === returnTitle ||
            c.title === DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE ||
            c.title === DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE ||
            c.title === DEFAULT_TRAIN_RETURN_CALENDAR_TITLE ||
            c.title === DEFAULT_TRAIN_CALENDAR_TITLE ||
            c.title === "StudICI - Treni & Viaggio" ||
            c.title === "StudICI - Treni Ritorno"),
      );
      for (const cal of matching) {
        try {
          await Calendar.deleteCalendarAsync(cal.id);
        } catch {}
      }
      await AsyncStorage.removeItem(LAST_TRAIN_CALENDAR_SYNC_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_SCHEDULE_HASH_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_EVENTS_MAP_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_UNIFIED_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_OUTBOUND_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_RETURN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(CALENDAR_TRAINS_CUSTOM_COLOR_KEY);
      await AsyncStorage.removeItem(CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY);
    }

    if (deleteTrainsReturnOnly) {
      const storedReturnId = await AsyncStorage.getItem(TRAIN_RETURN_CALENDAR_ID_KEY);
      const returnTitle = await getCalendarTitle("trains_return");
      const matchingReturn = calendars.filter(
        (c) =>
          c.allowsModifications &&
          (c.id === storedReturnId ||
            c.name === "studici_trains_return" ||
            c.title === returnTitle ||
            c.title === DEFAULT_TRAIN_RETURN_CALENDAR_TITLE ||
            c.title === "StudICI - Treni Ritorno"),
      );
      for (const cal of matchingReturn) {
        try {
          await Calendar.deleteCalendarAsync(cal.id);
        } catch {}
      }
      await AsyncStorage.removeItem(TRAIN_RETURN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY);

      return {
        success: true,
        message: "Il calendario dei treni di ritorno è stato rimosso con successo da Apple Calendar.",
      };
    }

    const label =
      target === "all"
        ? "I calendari StudICI (Lezioni e Treni) sono stati rimossi"
        : target === "lessons"
          ? "Il calendario Lezioni è stato rimosso"
          : "I calendari dei treni sono stati rimossi";

    return {
      success: true,
      message: `${label} con successo da Apple Calendar.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Errore durante la rimozione del calendario nativo.",
    };
  } finally {
    if (isOuter) releaseCalendarSyncLock();
  }
}

/**
 * Genera un'impronta (fingerprint) per rilevare se l'orario o le lezioni manuali
 * sono variati rispetto all'ultima sincronizzazione del calendario lezioni.
 */
export function computeScheduleFingerprint(
  schedule: ScheduleData,
  manualEvents: any[],
  calendarTitle: string,
  alertType?: string,
  customMinutes?: number,
  excludedIds?: string[],
): string {
  try {
    const daysData = (schedule?.days || []).map((day) =>
      (day || []).map(
        (c) =>
          `${c.subject || ""}|${c.room || ""}|${c.teacher || ""}|${c.startTime || ""}|${c.endTime || ""}`,
      ),
    );
    const manualData = (manualEvents || []).map(
      (m) =>
        `${m.id || ""}|${m.subject || ""}|${m.room || ""}|${m.teacher || ""}|${m.startTime || ""}|${m.endTime || ""}|${m.dayIndex}|${m.repetitionType || ""}|${m.repeatUntilDate || ""}`,
    );
    return JSON.stringify({
      v: 2,
      t: calendarTitle,
      alt: alertType || "none",
      cm: customMinutes || 15,
      d: daysData,
      m: manualData,
      ex: (excludedIds || []).slice().sort(),
    });
  } catch {
    return "";
  }
}

/**
 * Genera un'impronta (fingerprint) per rilevare se i treni o la configurazione pendolare
 * sono variati rispetto all'ultima sincronizzazione del calendario treni.
 */
const TRAIN_FINGERPRINT_VERSION = 9;

export function computeTrainFingerprint(
  schedule: ScheduleData,
  manualEvents: any[],
  commuterConfig: CommuterConfig | null,
  calendarTitle: string,
  alertType?: string,
  customMinutes?: number,
  includeReturn?: boolean,
  separateReturn?: boolean,
  returnCalendarTitle?: string,
  excludedIds?: string[],
): string {
  try {
    const tp = commuterConfig?.trainPreferences;
    const normalizedPrefs = getAllPreferredTrains(tp);
    return JSON.stringify({
      v: TRAIN_FINGERPRINT_VERSION,
      t: calendarTitle,
      dep: commuterConfig?.departureStation?.code,
      arr: commuterConfig?.arrivalStation?.code,
      car: commuterConfig?.carLeg?.durationMinutes,
      buf: commuterConfig?.bufferMinutes,
      tm: commuterConfig?.transitLeg?.preferredMode || "auto",
      ic: Boolean(commuterConfig?.includeIntercity),
      pt: normalizedPrefs.map((p) => p.id),
      sr: tp?.smartReturnEnabled ?? true,
      mel: tp?.maxEarlyLeaveMinutes ?? 15,
      mrg: tp?.minReturnGainMinutes ?? 25,
      alt: alertType || "none",
      cm: customMinutes || 15,
      incRet: includeReturn ?? true,
      sepRet: separateReturn ?? false,
      retTitle: returnCalendarTitle || "",
      days: (schedule?.days || []).map((d) => (d || []).map((c) => `${c.startTime}-${c.endTime}`)),
      man: (manualEvents || []).map((m) => `${m.dayIndex}:${m.startTime}-${m.endTime}`),
      ex: (excludedIds || []).slice().sort(),
    });
  } catch {
    return "";
  }
}

/**
 * Confronta il fingerprint salvato con quello corrente: se è cambiata esclusivamente
 * la mappa dei treni preferiti (`pt`), restituisce il set di slot (`${dayIdx}_${direction}`)
 * effettivamente interessati dalla modifica (evitando il ricalcolo dell'intera settimana).
 */
function detectOnlyPreferredSlotsChanged(
  savedFpRaw: string | null,
  currentFpRaw: string,
): Set<string> | null {
  if (!savedFpRaw || !currentFpRaw) return null;
  try {
    const savedObj = JSON.parse(savedFpRaw);
    const currObj = JSON.parse(currentFpRaw);
    if (
      !savedObj ||
      !currObj ||
      savedObj.v !== TRAIN_FINGERPRINT_VERSION ||
      currObj.v !== TRAIN_FINGERPRINT_VERSION
    ) {
      return null;
    }

    const savedNoPt = { ...savedObj, pt: undefined };
    const currNoPt = { ...currObj, pt: undefined };
    if (JSON.stringify(savedNoPt) !== JSON.stringify(currNoPt)) {
      return null;
    }

    const oldPt = new Set<string>(Array.isArray(savedObj.pt) ? savedObj.pt : []);
    const newPt = new Set<string>(Array.isArray(currObj.pt) ? currObj.pt : []);
    const dirty = new Set<string>();

    const parsePtSlot = (entry: string): string | null => {
      const m = /^(outbound|return)_([0-6])_/.exec(entry);
      if (!m) return null;
      const jsDay = parseInt(m[2], 10);
      const dayIdx = jsDayToCalendarDayIndex(jsDay);
      return `${dayIdx}_${m[1]}`;
    };

    for (const item of oldPt) {
      if (!newPt.has(item)) {
        const slot = parsePtSlot(item);
        if (!slot) return null;
        dirty.add(slot);
      }
    }
    for (const item of newPt) {
      if (!oldPt.has(item)) {
        const slot = parsePtSlot(item);
        if (!slot) return null;
        dirty.add(slot);
      }
    }

    return dirty;
  } catch {
    return null;
  }
}

/**
 * Helper interno per trovare o creare un calendario su iOS/Android privileggiando iCloud.
 */
async function getOrCreateNativeCalendar(options: {
  idStorageKey: string;
  name: string;
  activeTitle: string;
  activeColor: string;
  defaultTitle: string;
  previousTitle?: string;
  fallbackIdStorageKeys?: string[];
  skipClearEvents?: boolean;
  prefetchedCalendars?: Calendar.Calendar[];
}): Promise<{ calendarId: string; isDefaultFallback: boolean }> {
  const {
    idStorageKey,
    name,
    activeTitle,
    activeColor,
    defaultTitle,
    previousTitle,
    fallbackIdStorageKeys,
    skipClearEvents = false,
    prefetchedCalendars,
  } = options;
  let storedId = await AsyncStorage.getItem(idStorageKey);
  const fallbackIds: string[] = [];
  if (fallbackIdStorageKeys && fallbackIdStorageKeys.length > 0) {
    for (const fbKey of fallbackIdStorageKeys) {
      const fbVal = await AsyncStorage.getItem(fbKey);
      if (fbVal) {
        fallbackIds.push(fbVal);
        if (!storedId) storedId = fbVal;
      }
    }
  }
  const calendars = prefetchedCalendars || (await getFreshCalendarsSafe());

  const isICloud = (c: Calendar.Calendar) =>
    Boolean(
      c.source &&
        (c.source.name?.toLowerCase().includes("icloud") ||
          c.source.type === Calendar.SourceType.CALDAV),
    );

  let existingCal: Calendar.Calendar | null = null;
  const allMatching = calendars.filter(
    (c) =>
      c.allowsModifications &&
      (c.id === storedId ||
        fallbackIds.includes(c.id) ||
        c.name === name ||
        c.title === activeTitle ||
        c.title === defaultTitle ||
        (previousTitle && c.title === previousTitle)),
  );

  allMatching.sort((a, b) => {
    const aStored = a.id === storedId ? 3 : fallbackIds.includes(a.id) ? 2 : 0;
    const bStored = b.id === storedId ? 3 : fallbackIds.includes(b.id) ? 2 : 0;
    if (aStored !== bStored) return bStored - aStored;

    const aName = a.name === name ? 1 : 0;
    const bName = b.name === name ? 1 : 0;
    if (aName !== bName) return bName - aName;

    const aICloud = isICloud(a) ? 1 : 0;
    const bICloud = isICloud(b) ? 1 : 0;
    return bICloud - aICloud;
  });

  existingCal = allMatching[0] || null;

  // Elimina subito tutti i calendari orfani o duplicati rimasti su iOS con lo stesso nome o titolo
  if (allMatching.length > 1) {
    const orphans = allMatching.slice(1);
    for (const orphan of orphans) {
      try {
        await Calendar.deleteCalendarAsync(orphan.id);
      } catch (delErr) {
        console.warn("Impossibile eliminare calendario orfano duplicato:", orphan.id, delErr);
      }
    }
  }

  if (existingCal) {
    const calendarId = existingCal.id;
    await AsyncStorage.setItem(idStorageKey, calendarId);

    const needsTitle = Boolean(activeTitle && existingCal.title !== activeTitle);
    const normExistingColor = normalizeCalendarHex(existingCal.color);
    const normActiveColor = normalizeCalendarHex(activeColor);
    const needsColor = Boolean(
      normActiveColor && normExistingColor !== normActiveColor,
    );
    if (needsTitle || needsColor) {
      await updateCalendarMetadataSafe(existingCal, {
        title: needsTitle ? activeTitle : undefined,
        color: needsColor ? normActiveColor || activeColor : undefined,
      });
    }

    // Pulisci vecchi eventi del calendario per aggiornarli puliti senza duplicati (saltato in modalità diff incrementale)
    if (!skipClearEvents) {
      try {
        const pastDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const oldEvents = await Calendar.getEventsAsync([calendarId], pastDate, futureDate);

        // Deduplica gli ID univoci delle serie ricorrenti per evitare di chiamare deleteEventAsync
        // centinaia di volte sullo stesso ID
        const seenIds = new Set<string>();
        const uniqueEvents = oldEvents.filter((evt) => {
          if (!evt.id || seenIds.has(evt.id)) return false;
          seenIds.add(evt.id);
          return true;
        });

        const CHUNK_SIZE = 6;
        for (let i = 0; i < uniqueEvents.length; i += CHUNK_SIZE) {
          const chunk = uniqueEvents.slice(i, i + CHUNK_SIZE);
          await Promise.all(
            chunk.map((evt) =>
              Calendar.deleteEventAsync(evt.id, { futureEvents: true }).catch(() => {})
            )
          );
        }
      } catch (cleanErr) {
        console.warn("Errore pulizia vecchi eventi:", cleanErr);
      }
    }

    return { calendarId, isDefaultFallback: false };
  }

  // Creazione nuovo calendario
  let calendarId: string | null = null;
  let isDefaultFallback = false;

  if (Platform.OS === "ios") {
    const defaultCal = await Calendar.getDefaultCalendarAsync();
    const candidateSources: Calendar.Source[] = [];

    const iCloudCal = calendars.find(
      (c) =>
        c.source &&
        (c.source.name?.toLowerCase().includes("icloud") ||
          c.source.type === Calendar.SourceType.CALDAV) &&
        c.allowsModifications,
    );
    if (iCloudCal?.source) candidateSources.push(iCloudCal.source);
    if (defaultCal?.source) candidateSources.push(defaultCal.source);

    const localCal = calendars.find(
      (c) =>
        c.source &&
        (c.source.type === Calendar.SourceType.LOCAL ||
          c.source.name?.toLowerCase() === "default") &&
        c.allowsModifications,
    );
    if (localCal?.source) candidateSources.push(localCal.source);

    for (const cal of calendars) {
      if (
        cal.source &&
        cal.allowsModifications &&
        !candidateSources.some((s) => s.id === cal.source.id)
      ) {
        candidateSources.push(cal.source);
      }
    }

    for (const src of candidateSources) {
      try {
        calendarId = await Calendar.createCalendarAsync({
          title: activeTitle,
          color: activeColor,
          entityType: Calendar.EntityTypes.EVENT,
          sourceId: src.id,
          source: src,
          name,
          ownerAccount: "personal",
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        });
        if (calendarId) break;
      } catch {}
    }

    if (!calendarId) {
      calendarId = defaultCal.id;
      isDefaultFallback = true;
    }
  } else {
    // Android
    try {
      calendarId = await Calendar.createCalendarAsync({
        title: activeTitle,
        color: activeColor,
        entityType: Calendar.EntityTypes.EVENT,
        source: { isLocalAccount: true, name: "StudICI", type: "LOCAL" },
        name,
        ownerAccount: "StudICI",
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
    } catch {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal.id;
      isDefaultFallback = true;
    }
  }

  if (calendarId && !isDefaultFallback) {
    await AsyncStorage.setItem(idStorageKey, calendarId);
  }

  return { calendarId, isDefaultFallback };
}

/**
 * Sincronizza l'intero orario delle lezioni nel Calendario nativo di Apple.
 */
export async function syncScheduleToAppleCalendar(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string,
  customTitleOverride?: string,
  calendarColor?: string,
  syncOptions?: {
    prefetchedCalendars?: Calendar.Calendar[];
    skipPullExternal?: boolean;
    outOutboundItineraries?: Record<string, CommuterItinerary>;
  },
): Promise<CalendarSyncResult> {
  const isOuter = !isCalendarSyncInProgress;
  if (isOuter) isCalendarSyncInProgress = true;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        eventsCount: 0,
        message: "Il servizio Calendario non è disponibile su questo dispositivo.",
        error: "calendar_not_available",
      };
    }

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      return {
        success: false,
        eventsCount: 0,
        message: "Permesso calendario negato. Abilitalo nelle Impostazioni di sistema.",
        error: "permission_denied",
      };
    }

    if (calendarColor) {
      await AsyncStorage.setItem(
        CALENDAR_COLOR_KEY,
        normalizeCalendarHex(calendarColor) || calendarColor,
      );
    }
    const preCalendars =
      syncOptions?.prefetchedCalendars ||
      (await getFreshCalendarsSafe().catch(() => [] as Calendar.Calendar[]));
    if (!syncOptions?.skipPullExternal && preCalendars.length > 0) {
      try {
        await _pullExternalChangesInternal(preCalendars, calendarColor, {
          detectExternalDeletion: false,
        });
      } catch {}
    }

    const activeColor = await getCalendarColor("lessons", calendarColor);
    const activeTitle = customTitleOverride || (await getCalendarTitle("lessons"));

    const { calendarId, isDefaultFallback } = await getOrCreateNativeCalendar({
      idStorageKey: CALENDAR_ID_KEY,
      name: "studici_lessons",
      activeTitle,
      activeColor,
      defaultTitle: DEFAULT_LESSONS_CALENDAR_TITLE,
      skipClearEvents: true,
      prefetchedCalendars: preCalendars.length > 0 ? preCalendars : undefined,
    });

    // Raccogli gli ID dei vecchi eventi PRIMA della creazione per eliminarli solo dopo il completamento
    let oldLessonEventIds: string[] = [];
    if (!isDefaultFallback) {
      try {
        const pastDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const oldEvents = await Calendar.getEventsAsync([calendarId], pastDate, futureDate);
        const seen = new Set<string>();
        for (const evt of oldEvents) {
          if (evt.id && !seen.has(evt.id)) {
            seen.add(evt.id);
            oldLessonEventIds.push(evt.id);
          }
        }
      } catch {}
    }

    const alertConfig = await getCalendarAlertConfig("lessons");
    const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
    const excludedRecords = await getExcludedLessons(storedDegreeUrl || undefined);
    const excludedSet = buildExcludedIdSet(excludedRecords);
    const excludedIds = Array.from(excludedSet).sort();

    // Pre-calcolo delle partenze treno/casa se l'utente ha impostato l'avviso su treno o casa
    const weekdayCommuteMap = new Map<
      number,
      { trainDepTime?: string; homeDepTime?: string }
    >();

    if (
      alertConfig.alertType === "train_departure" ||
      alertConfig.alertType === "home_departure"
    ) {
      try {
        const commuterConfig = await getCommuterConfig();
        if (
          commuterConfig &&
          commuterConfig.enabled &&
          commuterConfig.departureStation?.name
        ) {
          const nowRef = new Date();
          const curDayOfWeek = nowRef.getDay();
          await Promise.all(
            [0, 1, 2, 3, 4].map(async (d) => {
              const dayClasses = (schedule.days?.[d] || []).filter(
                (c) => !isLessonExcluded(d, c, excludedSet),
              );
              if (dayClasses.length === 0) return;
              const sortedClasses = [...dayClasses]
                .filter((c) => Boolean(c && c.startTime))
                .sort(
                  (a, b) =>
                    parseTimeToMinutes(a.startTime || "08:30") -
                    parseTimeToMinutes(b.startTime || "08:30"),
                );
              const firstClass = sortedClasses[0] || dayClasses[0];
              const targetDayOfWeek = d + 1;
              let daysUntil = targetDayOfWeek - curDayOfWeek;
              if (daysUntil < 0) daysUntil += 7;
              // Per interrogare l'orario programmato ufficiale senza interferenze live del giorno corrente,
              // se il giorno coincide con oggi (daysUntil === 0), interroga la settimana prossima (+7 giorni)
              const queryDaysUntil = daysUntil <= 0 ? daysUntil + 7 : daysUntil;
              const targetDate = new Date(
                nowRef.getFullYear(),
                nowRef.getMonth(),
                nowRef.getDate() + queryDaysUntil,
              );
              const [cH, cM] = (firstClass?.startTime || "08:30").split(":").map(Number);
              targetDate.setHours(cH || 8, cM || 30, 0, 0);

              const dayJs = calendarDayIndexToJsDay(d);
              const outboundPrefs = getPreferredTrainsForDayDirection(
                commuterConfig,
                "outbound",
                dayJs,
              );
              const itin = await computeCommuterItinerary({
                config: commuterConfig,
                scheduleData: schedule,
                direction: "outbound",
                targetDate,
                selectedClass: firstClass,
                selectedTrainOffset: 0,
                forcedPreferredTrain:
                  outboundPrefs.length === 1 ? outboundPrefs[0] : undefined,
                ignoreCurrentTime: true,
                fastCalendarMode: true,
                excludedLessonIds: excludedSet,
              });

              if (itin) {
                weekdayCommuteMap.set(d, {
                  trainDepTime: itin.liveTrain?.departureTimePlanned,
                  homeDepTime: itin.departureTime,
                });
                if (syncOptions?.outOutboundItineraries && itin.liveTrain) {
                  if (
                    outboundPrefs.length === 1 &&
                    doesPreferredTrainMatchLiveTrain(outboundPrefs[0], itin.liveTrain)
                  ) {
                    syncOptions.outOutboundItineraries[
                      `${d}_outbound:${outboundPrefs[0].id}`
                    ] = itin;
                  } else if (outboundPrefs.length === 0) {
                    syncOptions.outOutboundItineraries[`${d}_outbound`] = itin;
                  }
                }
              }
            }),
          );
        }
      } catch (commuteErr) {
        console.warn("Errore precalcolo tempi pendolare per avvisi lezioni:", commuteErr);
      }
    }

    let eventsCount = 0;
    const eventsToCreate: {
      details: NonNullable<Parameters<typeof Calendar.createEventAsync>[1]>;
      latitude?: number;
      longitude?: number;
    }[] = [];
    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const semesterEndDate = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000);

    for (let dayIdx = 0; dayIdx < (schedule.days || []).length; dayIdx++) {
      const dayClasses = schedule.days[dayIdx] || [];
      const targetDayOfWeek = dayIdx + 1;

      let daysUntil = targetDayOfWeek - currentDayOfWeek;
      if (daysUntil < 0) daysUntil += 7;

      const commuteInfo = weekdayCommuteMap.get(dayIdx);

      for (const cls of dayClasses) {
        if (!cls.startTime || !cls.endTime) continue;
        if (isLessonExcluded(dayIdx, cls, excludedSet)) continue;

        const [startH, startM] = cls.startTime.split(":").map(Number);
        const [endH, endM] = cls.endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) continue;

        const startDate = new Date(now);
        startDate.setDate(now.getDate() + daysUntil);
        startDate.setHours(startH, startM || 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setHours(endH, endM || 0, 0, 0);

        const resolved = resolveClassroom(cls.room || "", cls.building || "");
        const locationAddress = resolved.address
          ? resolved.address
          : cls.address
            ? formatSapienzaAddress(cls.address, cls.building)
            : "Via Eudossiana 18, 00184 Roma";

        const notesParts = [
          cls.room ? `Aula: ${cls.room}` : "",
          cls.teacher ? `Docente: Prof. ${cls.teacher}` : "",
          `Corso: ${courseName}`,
          channelName ? `Canale: ${channelName}` : "",
          resolved.buildingName ? `Edificio: ${resolved.buildingName}` : "",
          "StudICI • Sapienza Università di Roma",
        ].filter(Boolean);

        const subjectUpper = cls.subject?.trim().toUpperCase() || "LEZIONE";
        const roomStr = cls.room ? ` (${cls.room})` : "";
        const profStr = cls.teacher ? ` - Prof. ${cls.teacher}` : "";
        const eventTitle = `${subjectUpper}${roomStr}${profStr}`;

        const eventStartMins = startH * 60 + (startM || 0);
        const alarms = computeAlarmOffsets({
          alertType: alertConfig.alertType,
          customMinutes: alertConfig.customMinutes,
          eventStartTimeMinutes: eventStartMins,
          referenceTimeMinutes:
            alertConfig.alertType === "train_departure"
              ? commuteInfo?.trainDepTime
                ? parseTimeToMinutes(commuteInfo.trainDepTime)
                : undefined
              : commuteInfo?.homeDepTime
                ? parseTimeToMinutes(commuteInfo.homeDepTime)
                : undefined,
        });

        eventsToCreate.push({
          details: {
            title: eventTitle,
            startDate,
            endDate,
            location: locationAddress,
            notes: notesParts.join("\n"),
            timeZone: "Europe/Rome",
            recurrenceRule: {
              frequency: Calendar.Frequency.WEEKLY,
              endDate: semesterEndDate,
            },
            alarms,
          },
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        });
      }
    }

    // Lezioni manuali
    let manualList: any[] = [];
    try {
      manualList = await getManualEvents(storedDegreeUrl || undefined);

      for (const mEvent of manualList) {
        if (!mEvent.startTime || !mEvent.endTime) continue;
        if (isLessonExcluded(mEvent.dayIndex, mEvent, excludedSet)) continue;

        const [startH, startM] = mEvent.startTime.split(":").map(Number);
        const [endH, endM] = mEvent.endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) continue;

        const targetDayOfWeek = mEvent.dayIndex + 1;
        let daysUntil = targetDayOfWeek - currentDayOfWeek;
        if (daysUntil < 0) daysUntil += 7;

        let startDate = new Date(now);
        if (mEvent.repetitionType === "single" && mEvent.startDate) {
          const [sY, sM, sD] = mEvent.startDate.split("-").map(Number);
          if (!isNaN(sY) && !isNaN(sM) && !isNaN(sD)) {
            startDate = new Date(sY, sM - 1, sD);
          }
        } else {
          startDate.setDate(now.getDate() + daysUntil);
        }
        startDate.setHours(startH, startM || 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setHours(endH, endM || 0, 0, 0);

        const subjectUpper = mEvent.subject?.trim().toUpperCase() || "LEZIONE";
        const roomStr = mEvent.room ? ` (${mEvent.room})` : "";
        const profStr = mEvent.teacher ? ` - Prof. ${mEvent.teacher}` : "";
        const eventTitle = `${subjectUpper}${roomStr}${profStr}`;

        const manualContext = [
          mEvent.building ? `edificio ${mEvent.building}` : "",
          mEvent.address || "",
        ]
          .filter(Boolean)
          .join(" ");
        const resolvedManual = resolveClassroom(mEvent.room || "", manualContext);
        const manualHasRmCode = /RM\d{3}/i.test(
          `${mEvent.room || ""} ${mEvent.building || ""}`,
        );
        const manualBuildingName =
          mEvent.building && !manualHasRmCode
            ? mEvent.building.trim()
            : mEvent.room || mEvent.building
              ? resolvedManual.buildingName
              : "";

        const notesParts = [
          mEvent.room ? `Aula: ${mEvent.room}` : "",
          mEvent.teacher ? `Docente: Prof. ${mEvent.teacher}` : "",
          `Corso: ${courseName}`,
          channelName ? `Canale: ${channelName}` : "",
          manualBuildingName ? `Edificio: ${manualBuildingName}` : "",
          "StudICI • Sapienza Università di Roma",
        ].filter(Boolean);

        let recurrenceRule: Calendar.RecurrenceRule | undefined;
        if (mEvent.repetitionType === "semester") {
          recurrenceRule = {
            frequency: Calendar.Frequency.WEEKLY,
            endDate: semesterEndDate,
          };
        } else if (
          mEvent.repetitionType === "custom_date" &&
          mEvent.repeatUntilDate
        ) {
          const [eY, eM, eD] = mEvent.repeatUntilDate.split("-").map(Number);
          const untilDate = new Date(eY, eM - 1, eD, 23, 59, 59);
          recurrenceRule = {
            frequency: Calendar.Frequency.WEEKLY,
            endDate: untilDate,
          };
        }

        const commuteInfo = weekdayCommuteMap.get(mEvent.dayIndex);
        const eventStartMins = startH * 60 + (startM || 0);
        const alarms = computeAlarmOffsets({
          alertType: alertConfig.alertType,
          customMinutes: alertConfig.customMinutes,
          eventStartTimeMinutes: eventStartMins,
          referenceTimeMinutes:
            alertConfig.alertType === "train_departure"
              ? commuteInfo?.trainDepTime
                ? parseTimeToMinutes(commuteInfo.trainDepTime)
                : undefined
              : commuteInfo?.homeDepTime
                ? parseTimeToMinutes(commuteInfo.homeDepTime)
                : undefined,
        });

        eventsToCreate.push({
          details: {
            title: eventTitle,
            startDate,
            endDate,
            location:
              mEvent.address ||
              resolvedManual.address ||
              mEvent.room ||
              "Sapienza Università di Roma",
            notes: notesParts.join("\n"),
            timeZone: "Europe/Rome",
            ...(recurrenceRule ? { recurrenceRule } : {}),
            alarms,
          },
          ...(!mEvent.address &&
          resolvedManual.latitude != null &&
          resolvedManual.longitude != null
            ? {
                latitude: resolvedManual.latitude,
                longitude: resolvedManual.longitude,
              }
            : {}),
        });
      }
    } catch (manualSyncErr) {
      console.warn("Errore sincronizzazione lezioni manuali su Calendario:", manualSyncErr);
    }

    if (eventsToCreate.length > 0) {
      const CREATE_CHUNK_SIZE = 6;
      const lessonStructuredEntries: StructuredLocationEntry[] = [];
      for (let i = 0; i < eventsToCreate.length; i += CREATE_CHUNK_SIZE) {
        const chunk = eventsToCreate.slice(i, i + CREATE_CHUNK_SIZE);
        const createdIds = await Promise.all(
          chunk.map((item) => Calendar.createEventAsync(calendarId, item.details)),
        );
        chunk.forEach((item, idx) => {
          const createdId = createdIds[idx];
          const hasCoords = item.latitude != null && item.longitude != null;
          const locText = item.details.location?.trim() || "";
          if (createdId && (hasCoords || locText.length > 0)) {
            lessonStructuredEntries.push({
              eventId: createdId,
              title: locText,
              latitude: item.latitude ?? 0,
              longitude: item.longitude ?? 0,
            });
          }
        });
        eventsCount += chunk.length;
      }
      await attachStructuredLocationsIfSupported(lessonStructuredEntries);
    }

    // Elimina i vecchi eventi solo dopo aver creato con successo quelli nuovi (evita calendari vuoti in caso di interruzione)
    if (oldLessonEventIds.length > 0) {
      const CHUNK_SIZE = 6;
      for (let i = 0; i < oldLessonEventIds.length; i += CHUNK_SIZE) {
        const chunk = oldLessonEventIds.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map((id) =>
            Calendar.deleteEventAsync(id, { futureEvents: true }).catch(() => {}),
          ),
        );
      }
    }

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_CALENDAR_SYNC_KEY, timestamp.toString());

    const fingerprint = computeScheduleFingerprint(
      schedule,
      manualList,
      activeTitle,
      alertConfig.alertType,
      alertConfig.customMinutes,
      excludedIds,
    );
    await AsyncStorage.setItem(CALENDAR_SCHEDULE_HASH_KEY, fingerprint);

    const targetCalendarName = isDefaultFallback
      ? "tuo Calendario"
      : `Calendario Apple ('${activeTitle}')`;

    return {
      success: true,
      eventsCount,
      message: `Sincronizzazione completata: ${eventsCount} lezioni inserite nel ${targetCalendarName}!`,
    };
  } catch (err: any) {
    console.error("Errore sincronizzazione calendario lezioni:", err);
    return {
      success: false,
      eventsCount: 0,
      message:
        err?.message || "Si è verificato un errore durante la sincronizzazione delle lezioni.",
      error: String(err),
    };
  } finally {
    if (isOuter) releaseCalendarSyncLock();
  }
}

/**
 * Sincronizza i treni pendolari (andata e ritorno per ciascun giorno di lezione)
 * nel Calendario Treni dedicato su Apple Calendar.
 */
export async function syncTrainsToAppleCalendar(
  schedule: ScheduleData,
  customTitleOverride?: string,
  calendarColor?: string,
  syncOptions?: AppleCalendarSyncOptions,
): Promise<CalendarSyncResult> {
  const isOuter = !isCalendarSyncInProgress;
  if (isOuter) isCalendarSyncInProgress = true;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        eventsCount: 0,
        message: "Il servizio Calendario non è disponibile su questo dispositivo.",
        error: "calendar_not_available",
      };
    }

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      return {
        success: false,
        eventsCount: 0,
        message: "Permesso calendario negato. Abilitalo nelle Impostazioni di sistema.",
        error: "permission_denied",
      };
    }

    const commuterConfig = await getCommuterConfig();
    if (
      !commuterConfig ||
      !commuterConfig.departureStation?.name ||
      !commuterConfig.arrivalStation?.name
    ) {
      return {
        success: false,
        eventsCount: 0,
        message:
          "Per sincronizzare il calendario dei treni, seleziona le stazioni di partenza e arrivo nella schermata Viaggio.",
        error: "commuter_not_configured",
      };
    }

    if (calendarColor) {
      await AsyncStorage.setItem(
        CALENDAR_COLOR_KEY,
        normalizeCalendarHex(calendarColor) || calendarColor,
      );
    }
    await AsyncStorage.setItem(CALENDAR_TRAIN_SHADE_MIGRATED_KEY, "1");
    const preCalendars =
      syncOptions?.prefetchedCalendars ||
      (await getFreshCalendarsSafe().catch(() => [] as Calendar.Calendar[]));
    if (!syncOptions?.skipPullExternal && preCalendars.length > 0) {
      try {
        await _pullExternalChangesInternal(preCalendars, calendarColor, {
          detectExternalDeletion: false,
        });
      } catch {}
    }

    const activeColor = await getCalendarColor("trains", calendarColor);
    const returnActiveColor = await getCalendarColor("trains_return", calendarColor);
    const separateReturn = await getTrainSeparateReturn();
    const activeTitle = customTitleOverride || (await getCalendarTitle("trains", separateReturn));

    let calendarId: string;
    let isDefaultFallback: boolean;

    if (separateReturn) {
      const resOutbound = await getOrCreateNativeCalendar({
        idStorageKey: TRAIN_OUTBOUND_CALENDAR_ID_KEY,
        fallbackIdStorageKeys: [TRAIN_CALENDAR_ID_KEY],
        name: "studici_trains_outbound",
        activeTitle,
        activeColor,
        defaultTitle: DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE,
        skipClearEvents: true,
        prefetchedCalendars: preCalendars.length > 0 ? preCalendars : undefined,
      });
      calendarId = resOutbound.calendarId;
      isDefaultFallback = resOutbound.isDefaultFallback;
    } else {
      const resUnified = await getOrCreateNativeCalendar({
        idStorageKey: TRAIN_UNIFIED_CALENDAR_ID_KEY,
        fallbackIdStorageKeys: [TRAIN_CALENDAR_ID_KEY],
        name: "studici_trains_unified",
        activeTitle,
        activeColor,
        defaultTitle: DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE,
        skipClearEvents: true,
        prefetchedCalendars: preCalendars.length > 0 ? preCalendars : undefined,
      });
      calendarId = resUnified.calendarId;
      isDefaultFallback = resUnified.isDefaultFallback;
    }

    let returnCalendarId: string | null = null;
    let returnIsDefaultFallback = false;
    let returnActiveTitle = "";
    if (separateReturn) {
      returnActiveTitle = await getCalendarTitle("trains_return");
      const resReturn = await getOrCreateNativeCalendar({
        idStorageKey: TRAIN_RETURN_CALENDAR_ID_KEY,
        name: "studici_trains_return",
        activeTitle: returnActiveTitle,
        activeColor: returnActiveColor,
        defaultTitle: DEFAULT_TRAIN_RETURN_CALENDAR_TITLE,
        skipClearEvents: true,
        prefetchedCalendars: preCalendars.length > 0 ? preCalendars : undefined,
      });
      returnCalendarId = resReturn.calendarId;
      returnIsDefaultFallback = resReturn.isDefaultFallback;
    } else {
      // Se usiamo il calendario unificato, eliminiamo interamente l'eventuale vecchio calendario di ritorno da iOS
      try {
        const oldReturnId = await AsyncStorage.getItem(TRAIN_RETURN_CALENDAR_ID_KEY);
        if (oldReturnId) {
          try {
            await Calendar.deleteCalendarAsync(oldReturnId);
          } catch {}
          await AsyncStorage.removeItem(TRAIN_RETURN_CALENDAR_ID_KEY);
          await AsyncStorage.removeItem(CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY);
        }
      } catch (cleanReturnErr) {
        console.warn("Errore pulizia vecchio calendario treni ritorno:", cleanReturnErr);
      }
    }

    const alertConfig = await getCalendarAlertConfig("trains");

    let manualList: any[] = [];
    let activeTabUrl: string | null = null;
    let excludedSet = new Set<string>();
    let excludedIds: string[] = [];
    try {
      const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
      const [mList, excludedRecords] = await Promise.all([
        getManualEvents(storedDegreeUrl || undefined),
        getExcludedLessons(storedDegreeUrl || undefined),
      ]);
      manualList = mList;
      excludedSet = buildExcludedIdSet(excludedRecords);
      excludedIds = Array.from(excludedSet).sort();
      activeTabUrl =
        (storedDegreeUrl ? await AsyncStorage.getItem(`defaultTabUrl_${storedDegreeUrl}`) : null) ||
        (await AsyncStorage.getItem("defaultTabUrl"));
    } catch {}

    let eventsCount = 0;
    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const semesterEndDate = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000);

    type TrackedTrainEvent = { eventId: string; calendarId: string; signature: string };
    let prevMap: Record<string, TrackedTrainEvent> = {};
    let rawSavedFp: string | null = null;
    try {
      const fpPairs = await AsyncStorage.multiGet([
        TRAIN_CALENDAR_SCHEDULE_HASH_KEY,
        TRAIN_CALENDAR_EVENTS_MAP_KEY,
      ]);
      rawSavedFp = fpPairs[0]?.[1] || null;
      const rawMap = fpPairs[1]?.[1];
      if (rawMap) {
        const parsed = JSON.parse(rawMap);
        if (parsed && typeof parsed === "object") prevMap = parsed;
      }
    } catch {}

    const managedCalIds = Array.from(
      new Set([calendarId, ...(returnCalendarId ? [returnCalendarId] : [])]),
    );
    const pastDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const existingEvents = await Calendar.getEventsAsync(
      managedCalIds,
      pastDate,
      futureDate,
    ).catch(() => [] as Calendar.Event[]);

    const existingEventIds = new Set<string>();
    for (const evt of existingEvents) {
      if (evt.id) existingEventIds.add(evt.id);
    }

    const trainFingerprint = computeTrainFingerprint(
      schedule,
      manualList,
      commuterConfig,
      activeTitle,
      alertConfig.alertType,
      alertConfig.customMinutes,
      true,
      separateReturn,
      returnActiveTitle,
      excludedIds,
    );

    let dirtySlotKeys: Set<string> | null = null;
    if (!syncOptions?.forceFullSync && Object.keys(prevMap).length > 0) {
      const ptDiff = detectOnlyPreferredSlotsChanged(rawSavedFp, trainFingerprint);
      if (ptDiff !== null) {
        dirtySlotKeys = new Set(ptDiff);
        if (syncOptions?.onlySlotKeys) {
          for (const k of syncOptions.onlySlotKeys) dirtySlotKeys.add(k);
        }
      } else if (syncOptions?.onlySlotKeys?.length && rawSavedFp === trainFingerprint) {
        dirtySlotKeys = new Set(syncOptions.onlySlotKeys);
      }
    }

    const depStationName =
      commuterConfig.departureStation.shortName || commuterConfig.departureStation.name;
    const arrStationName =
      commuterConfig.arrivalStation.shortName || commuterConfig.arrivalStation.name;

    type ComputedSlotItin = {
      dir: "outbound" | "return";
      slotKey: string;
      itin: CommuterItinerary;
    };

    const targetCalForReturn =
      separateReturn && returnCalendarId ? returnCalendarId : calendarId;

    const getGroupKey = (slotKey: string) => slotKey.split(":")[0];

    const dayResults = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map(async (dayIdx) => {
        const targetJsDay = calendarDayIndexToJsDay(dayIdx); // 1=LUN..5=VEN, 6=SAB, 0=DOM
        let daysUntil = targetJsDay - currentDayOfWeek;
        if (daysUntil < 0) daysUntil += 7;

        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + daysUntil);

        const queryDaysUntil = daysUntil <= 0 ? daysUntil + 7 : daysUntil;
        const queryBaseDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + queryDaysUntil,
        );
        const qY = queryBaseDate.getFullYear();
        const qM = String(queryBaseDate.getMonth() + 1).padStart(2, "0");
        const qD = String(queryBaseDate.getDate()).padStart(2, "0");
        const queryDateStr = `${qY}-${qM}-${qD}`;

        const officialClasses: ClassEvent[] = (schedule.days && schedule.days[dayIdx]) || [];
        const manualClasses: ClassEvent[] = manualList
          .filter((m) => {
            if (m.dayIndex !== dayIdx) return false;
            if (m.tabUrl && activeTabUrl && m.tabUrl !== activeTabUrl) return false;
            return isManualEventActiveOnDate(m, queryDateStr);
          })
          .map(manualEventToClassEvent);
        const allClasses = [...officialClasses, ...manualClasses].filter(
          (c) => Boolean(c && c.startTime) && !isLessonExcluded(dayIdx, c, excludedSet),
        );

        const dayOutboundPrefs = getPreferredTrainsForDayDirection(
          commuterConfig,
          "outbound",
          targetJsDay,
        );
        const dayReturnPrefs = getPreferredTrainsForDayDirection(
          commuterConfig,
          "return",
          targetJsDay,
        );

        if (
          allClasses.length === 0 &&
          dayOutboundPrefs.length === 0 &&
          dayReturnPrefs.length === 0
        ) {
          return null;
        }

        allClasses.sort(
          (a, b) =>
            parseTimeToMinutes(a.startTime || "08:30") -
            parseTimeToMinutes(b.startTime || "08:30"),
        );

        const firstLesson = allClasses[0];
        const byEndClasses = [...allClasses].sort(
          (a, b) =>
            parseTimeToMinutes(a.endTime || a.startTime || "16:00") -
            parseTimeToMinutes(b.endTime || b.startTime || "16:00"),
        );
        const lastLesson = byEndClasses[byEndClasses.length - 1];

        const pickContextClassForPref = (
          dir: "outbound" | "return",
          pref: PreferredTrain,
        ): ClassEvent | undefined => {
          if (allClasses.length === 0) return undefined;
          const targetRefMins =
            dir === "outbound"
              ? parseTimeToMinutes(pref.arrivalTime || pref.departureTime)
              : parseTimeToMinutes(pref.departureTime);
          let best = dir === "outbound" ? firstLesson : lastLesson;
          let bestScore = Number.POSITIVE_INFINITY;
          for (const cls of allClasses) {
            const clsMins =
              dir === "outbound"
                ? parseTimeToMinutes(cls.startTime || "08:30")
                : parseTimeToMinutes(cls.endTime || cls.startTime || "16:00");
            const diff =
              dir === "return"
                ? targetRefMins >= clsMins
                  ? targetRefMins - clsMins
                  : clsMins - targetRefMins + 30
                : clsMins >= targetRefMins
                  ? clsMins - targetRefMins
                  : targetRefMins - clsMins + 30;
            if (diff < bestScore) {
              bestScore = diff;
              best = cls;
            }
          }
          return best;
        };

        const formatMinutesHHMM = (totalMins: number): string => {
          const norm = ((Math.round(totalMins) % 1440) + 1440) % 1440;
          const hh = String(Math.floor(norm / 60)).padStart(2, "0");
          const mm = String(norm % 60).padStart(2, "0");
          return `${hh}:${mm}`;
        };

        const buildFallbackItineraryForPref = (
          dir: "outbound" | "return",
          pref: PreferredTrain,
          prefQueryDate: Date,
          baselineItin?: CommuterItinerary | null,
        ): CommuterItinerary | null => {
          const depMins = timeHHMMToMinutes(pref.departureTime);
          const arrMins = timeHHMMToMinutes(pref.arrivalTime);
          if (depMins < 0 || arrMins < 0) return null;
          const trainDurMins = Math.max(
            1,
            arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins,
          );
          const cleanNum = extractCleanTrainNumber(pref.trainNumber, pref.label);
          const category =
            pref.category || extractTrainCategory(pref.trainNumber, pref.label) || "REG";
          const formattedTrainNum = cleanNum
            ? `${category} ${cleanNum}`
            : pref.label || pref.departureTime;
          const fromStation = dir === "outbound" ? depStationName : arrStationName;
          const toStation = dir === "outbound" ? arrStationName : depStationName;
          const toStationMins = commuterConfig.carLeg?.enabled
            ? (commuterConfig.carLeg.durationMinutes || 15) +
              (commuterConfig.carLeg.parkingBufferMinutes ?? 5)
            : 10;
          const homeDepStr =
            dir === "outbound"
              ? formatMinutesHHMM(depMins - toStationMins)
              : pref.departureTime;

          const fallbackTrain: LiveTrainInfo = {
            trainNumber: formattedTrainNum,
            category,
            destination: toStation,
            originStationName: fromStation,
            originStationCode:
              dir === "outbound"
                ? commuterConfig.departureStation.code
                : commuterConfig.arrivalStation.code,
            departureTimePlanned: pref.departureTime,
            departureTimeActual: pref.departureTime,
            departureMillis: prefQueryDate.getTime(),
            arrivalTimePlanned: pref.arrivalTime,
            arrivalTimeActual: pref.arrivalTime,
            delayMinutes: 0,
            statusDescription: "Programmato",
            isLive: false,
            durationMinutes: trainDurMins,
            isFast: category === "RV" || category === "IC",
          };

          return {
            direction: dir,
            targetDate: queryDateStr,
            targetLecture: baselineItin?.targetLecture,
            departureTime: homeDepStr,
            arrivalTime: baselineItin?.arrivalTime || pref.arrivalTime || pref.departureTime,
            totalDurationMinutes: toStationMins + trainDurMins,
            legs: baselineItin?.legs || [],
            liveTrain: fallbackTrain,
            statusBadge: { text: "Programmato", color: "#888888" },
            summaryMessage: "",
          };
        };

        const computeDirectionSlots = async (
          dir: "outbound" | "return",
          dirPrefs: PreferredTrain[],
        ): Promise<{
          computed: ComputedSlotItin[];
          preserved: { slotKey: string; entry: TrackedTrainEvent }[];
          failedGroup: boolean;
          expectedSlotKeys: string[];
        }> => {
          const groupKey = `${dayIdx}_${dir}`;
          const targetCal = dir === "return" ? targetCalForReturn : calendarId;

          const expectedSlotKeys =
            dirPrefs.length > 0
              ? dirPrefs.map((p) => `${groupKey}:${p.id}`)
              : allClasses.length > 0
                ? [groupKey]
                : [];

          if (expectedSlotKeys.length === 0) {
            return { computed: [], preserved: [], failedGroup: false, expectedSlotKeys: [] };
          }

          const expectedSet = new Set(expectedSlotKeys);
          const prevGroupEntries = Object.entries(prevMap).filter(
            ([k]) => getGroupKey(k) === groupKey,
          );

          const canPreserve = Boolean(
            dirtySlotKeys &&
              !dirtySlotKeys.has(groupKey) &&
              prevGroupEntries.length === expectedSlotKeys.length &&
              prevGroupEntries.every(
                ([k, entry]) =>
                  expectedSet.has(k) &&
                  entry.calendarId === targetCal &&
                  existingEventIds.has(entry.eventId),
              ),
          );

          if (canPreserve) {
            return {
              computed: [],
              preserved: prevGroupEntries.map(([slotKey, entry]) => ({ slotKey, entry })),
              failedGroup: false,
              expectedSlotKeys,
            };
          }

          if (dirPrefs.length > 0) {
            let failed = false;
            const results = await Promise.all(
              dirPrefs.map(async (pref): Promise<ComputedSlotItin | null> => {
                const slotKey = `${groupKey}:${pref.id}`;
                const pre = syncOptions?.precomputedItineraries?.[slotKey];
                if (pre?.liveTrain && doesPreferredTrainMatchLiveTrain(pref, pre.liveTrain)) {
                  return { dir, slotKey, itin: pre };
                }

                const prefQueryDate = new Date(queryBaseDate);
                const [pH, pM] = (pref.departureTime || "08:30").split(":").map(Number);
                prefQueryDate.setHours(
                  Number.isFinite(pH) ? pH : dir === "outbound" ? 8 : 16,
                  Number.isFinite(pM) ? pM : 0,
                  0,
                  0,
                );
                const contextClass = pickContextClassForPref(dir, pref);
                const prefConfig =
                  pref.category === "IC" && !commuterConfig.includeIntercity
                    ? { ...commuterConfig, includeIntercity: true }
                    : commuterConfig;

                try {
                  let itin = await computeCommuterItinerary({
                    config: prefConfig,
                    scheduleData: schedule,
                    manualEvents: manualList,
                    direction: dir,
                    targetDate: prefQueryDate,
                    selectedClass: contextClass ?? null,
                    selectedTrainOffset: 0,
                    forcedPreferredTrain: pref,
                    ignoreCurrentTime: true,
                    fastCalendarMode: true,
                    excludedLessonIds: excludedSet,
                  });
                  if (
                    !itin?.liveTrain ||
                    !doesPreferredTrainMatchLiveTrain(pref, itin.liveTrain)
                  ) {
                    const liveRetryItin = await computeCommuterItinerary({
                      config: prefConfig,
                      scheduleData: schedule,
                      manualEvents: manualList,
                      direction: dir,
                      targetDate: prefQueryDate,
                      selectedClass: contextClass ?? null,
                      selectedTrainOffset: 0,
                      forcedPreferredTrain: pref,
                      ignoreCurrentTime: true,
                      fastCalendarMode: false,
                      excludedLessonIds: excludedSet,
                    }).catch(() => null);
                    if (
                      liveRetryItin?.liveTrain &&
                      doesPreferredTrainMatchLiveTrain(pref, liveRetryItin.liveTrain)
                    ) {
                      itin = liveRetryItin;
                    }
                  }
                  if (itin?.liveTrain && doesPreferredTrainMatchLiveTrain(pref, itin.liveTrain)) {
                    return { dir, slotKey, itin };
                  }
                  const syntheticItin = buildFallbackItineraryForPref(
                    dir,
                    pref,
                    prefQueryDate,
                    itin,
                  );
                  if (syntheticItin?.liveTrain) {
                    return { dir, slotKey, itin: syntheticItin };
                  }
                  failed = true;
                  return null;
                } catch (err) {
                  const syntheticItin = buildFallbackItineraryForPref(dir, pref, prefQueryDate);
                  if (syntheticItin?.liveTrain) {
                    return { dir, slotKey, itin: syntheticItin };
                  }
                  failed = true;
                  console.warn(
                    `Errore generazione treno preferito (${dir}, ${pref.departureTime}) per calendario:`,
                    err,
                  );
                  return null;
                }
              }),
            );
            return {
              computed: results.filter((r): r is ComputedSlotItin => Boolean(r)),
              preserved: [],
              failedGroup: failed,
              expectedSlotKeys,
            };
          }

          // Nessuna preferenza salvata per questa direzione: generazione automatica standard
          const preAuto = syncOptions?.precomputedItineraries?.[groupKey];
          if (preAuto?.liveTrain) {
            return {
              computed: [{ dir, slotKey: groupKey, itin: preAuto }],
              preserved: [],
              failedGroup: false,
              expectedSlotKeys,
            };
          }

          const lesson = dir === "outbound" ? firstLesson : lastLesson;
          const timeStr =
            dir === "outbound"
              ? lesson?.startTime || "08:30"
              : lesson?.endTime || lesson?.startTime || "16:00";
          const autoQueryDate = new Date(queryBaseDate);
          const [qH, qM] = timeStr.split(":").map(Number);
          autoQueryDate.setHours(
            Number.isFinite(qH) ? qH : dir === "outbound" ? 8 : 16,
            Number.isFinite(qM) ? qM : 0,
            0,
            0,
          );

          try {
            const itin = await computeCommuterItinerary({
              config: commuterConfig,
              scheduleData: schedule,
              manualEvents: manualList,
              direction: dir,
              targetDate: autoQueryDate,
              selectedClass: lesson,
              selectedTrainOffset: 0,
              ignoreCurrentTime: true,
              fastCalendarMode: true,
              excludedLessonIds: excludedSet,
            });
            if (itin?.liveTrain) {
              return {
                computed: [{ dir, slotKey: groupKey, itin }],
                preserved: [],
                failedGroup: false,
                expectedSlotKeys,
              };
            }
            return { computed: [], preserved: [], failedGroup: true, expectedSlotKeys };
          } catch (err) {
            console.warn(`Errore generazione treno ${dir} per calendario:`, err);
            return { computed: [], preserved: [], failedGroup: true, expectedSlotKeys };
          }
        };

        const [outboundRes, returnRes] = await Promise.all([
          computeDirectionSlots("outbound", dayOutboundPrefs),
          computeDirectionSlots("return", dayReturnPrefs),
        ]);

        return {
          dayIdx,
          targetDate,
          queryBaseDate,
          outbounds: outboundRes.computed,
          returns: returnRes.computed,
          preserved: [...outboundRes.preserved, ...returnRes.preserved],
          expectedSlotKeys: [...outboundRes.expectedSlotKeys, ...returnRes.expectedSlotKeys],
          failedGroupKeys: [
            ...(outboundRes.failedGroup ? [`${dayIdx}_outbound`] : []),
            ...(returnRes.failedGroup ? [`${dayIdx}_return`] : []),
          ],
        };
      }),
    );

    // Risoluzione mirata del binario programmato SOLO per i treni effettivamente selezionati
    const stationCatalog = [...POPULAR_STATIONS, ...ALL_STATIONS];
    const resolveRomeCode = (romeName: string): string => {
      const target = romeName.trim().toUpperCase();
      const found = stationCatalog.find(
        (s) =>
          s.name.trim().toUpperCase() === target ||
          (s.shortName || "").trim().toUpperCase() === target,
      );
      return found?.code || commuterConfig.arrivalStation.code;
    };

    const platformTasks: (() => Promise<void>)[] = [];
    for (const dayRes of dayResults) {
      if (!dayRes) continue;
      for (const item of dayRes.outbounds) {
        const t = item.itin.liveTrain;
        if (!t) continue;
        const depTime = t.departureTimePlanned || t.departureTimeActual;
        if (depTime && !(t.platformPlanned || t.platformActual)) {
          platformTasks.push(async () => {
            const plat = await resolvePlannedTrainPlatform({
              trainNumber: t.trainNumber,
              departureStationCode: commuterConfig.departureStation.code,
              departureTimeStr: depTime,
              queryDate: dayRes.queryBaseDate,
            });
            if (plat) t.platformPlanned = plat;
          });
        }
      }
      for (const item of dayRes.returns) {
        const t = item.itin.liveTrain;
        if (!t) continue;
        const depTime = t.departureTimePlanned || t.departureTimeActual;
        if (depTime && !(t.platformPlanned || t.platformActual)) {
          const depCode = resolveRomeCode(
            getRomeStationName(commuterConfig, t, "return"),
          );
          platformTasks.push(async () => {
            const plat = await resolvePlannedTrainPlatform({
              trainNumber: t.trainNumber,
              departureStationCode: depCode,
              departureTimeStr: depTime,
              queryDate: dayRes.queryBaseDate,
            });
            if (plat) t.platformPlanned = plat;
          });
        }
      }
    }
    if (platformTasks.length > 0) {
      let taskIdx = 0;
      const workerCount = Math.min(8, platformTasks.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (taskIdx < platformTasks.length) {
            const current = taskIdx++;
            await platformTasks[current]();
          }
        }),
      );
    }

    // Risoluzione dinamica parallela degli indirizzi postali reali e coordinate delle stazioni (una volta per stazione)
    const stationCalLocMap = new Map<string, StationCalendarLocation>();
    const stationQueries = new Map<
      string,
      { name: string; shortName?: string; code?: string }
    >();
    const queueStationQuery = (name: string, shortName?: string, code?: string) => {
      const k = name.trim().toUpperCase();
      if (k && !stationQueries.has(k)) {
        stationQueries.set(k, { name, shortName, code });
      }
    };
    queueStationQuery(
      depStationName,
      commuterConfig.departureStation.shortName,
      commuterConfig.departureStation.code,
    );
    queueStationQuery(
      arrStationName,
      commuterConfig.arrivalStation.shortName,
      commuterConfig.arrivalStation.code,
    );
    for (const dayRes of dayResults) {
      if (!dayRes) continue;
      for (const item of dayRes.returns) {
        if (!item.itin.liveTrain) continue;
        const retRomeName = getRomeStationName(
          commuterConfig,
          item.itin.liveTrain,
          "return",
        );
        if (retRomeName) {
          queueStationQuery(retRomeName, retRomeName, resolveRomeCode(retRomeName));
        }
      }
    }
    await Promise.all(
      Array.from(stationQueries.entries()).map(async ([k, st]) => {
        const loc = await resolveStationCalendarLocation(st);
        stationCalLocMap.set(k, loc);
      }),
    );

    type DesiredTrainSlot = {
      slotKey: string;
      targetCalId: string;
      signature: string;
      dedupSignature: string;
      details: NonNullable<Parameters<typeof Calendar.createEventAsync>[1]>;
      latitude?: number;
      longitude?: number;
    };

    const buildTrainCalendarSlot = (
      dayIdx: number,
      targetDate: Date,
      item: ComputedSlotItin,
    ): DesiredTrainSlot | null => {
      const t = item.itin.liveTrain;
      if (!t) return null;
      const depTime = t.departureTimePlanned || t.departureTimeActual;
      const arrTime = t.arrivalTimePlanned || t.arrivalTimeActual;
      if (!depTime || !arrTime) return null;

      const [depH, depM] = depTime.split(":").map(Number);
      const [arrH, arrM] = arrTime.split(":").map(Number);
      if (isNaN(depH) || isNaN(depM) || isNaN(arrH) || isNaN(arrM)) return null;

      const depMins = depH * 60 + depM;
      const arrMins = arrH * 60 + arrM;
      const trainDurationMins =
        t.durationMinutes && t.durationMinutes > 0
          ? t.durationMinutes
          : arrMins >= depMins
            ? arrMins - depMins
            : arrMins + 1440 - depMins;

      const startDate = new Date(targetDate);
      startDate.setHours(depH, depM, 0, 0);
      const endDate = new Date(startDate.getTime() + trainDurationMins * 60 * 1000);

      const isReturn = item.dir === "return";
      const fromStation = isReturn
        ? getRomeStationName(commuterConfig, t, "return") || arrStationName
        : depStationName;
      const toStation = isReturn ? depStationName : arrStationName;
      const depLoc = isReturn
        ? stationCalLocMap.get(fromStation.trim().toUpperCase()) ||
          stationCalLocMap.get(arrStationName.trim().toUpperCase())
        : stationCalLocMap.get(depStationName.trim().toUpperCase());

      const trainLabel = formatTrainLabel(t.category, t.trainNumber);
      const rawPlatform = (t.platformPlanned || t.platformActual || "").trim();
      const platform = rawPlatform.replace(/^(?:bin\.?|binario)\s*/i, "").trim();
      const platformSuffix = platform ? ` (Bin. ${platform})` : "";
      const eventTitle = `${trainLabel} • ${fromStation} → ${toStation}${platformSuffix}`;

      const notesParts = [
        `Treno: ${trainLabel}`,
        `Stazione: ${depLoc?.title || `Stazione ${fromStation}`}`,
        `Tratta: ${fromStation} → ${toStation}`,
        platform ? `Binario: ${platform}` : "",
        `Tempo di percorrenza: ${trainDurationMins} min`,
        !isReturn && item.itin.departureTime
          ? `Partenza consigliata da casa: ${item.itin.departureTime}`
          : "",
        "StudICI • Treni",
      ].filter(Boolean);

      const eventStartMins = depH * 60 + depM;
      const refDepMins = item.itin.departureTime
        ? parseTimeToMinutes(item.itin.departureTime)
        : undefined;

      const alarms = computeAlarmOffsets({
        alertType: alertConfig.alertType,
        customMinutes: alertConfig.customMinutes,
        eventStartTimeMinutes: eventStartMins,
        referenceTimeMinutes: refDepMins,
      });

      const targetCal = isReturn ? targetCalForReturn : calendarId;
      const notes = notesParts.join("\n");
      const stationTitle = depLoc?.title?.trim() || "";
      const stationAddr = depLoc?.address?.trim() || "";
      const location =
        stationTitle &&
        stationAddr &&
        !stationAddr.toLowerCase().includes(stationTitle.toLowerCase())
          ? `${stationTitle}, ${stationAddr}`
          : stationAddr || `Stazione di ${fromStation}, Italia`;
      const details: Parameters<typeof Calendar.createEventAsync>[1] = {
        title: eventTitle,
        startDate,
        endDate,
        location,
        notes,
        timeZone: "Europe/Rome",
        recurrenceRule: {
          frequency: Calendar.Frequency.WEEKLY,
          endDate: semesterEndDate,
        },
        alarms,
      };
      const signature = JSON.stringify({
        cal: targetCal,
        t: eventTitle,
        d: dayIdx,
        s: eventStartMins,
        dur: trainDurationMins,
        loc: location,
        lat: depLoc?.latitude ?? null,
        lng: depLoc?.longitude ?? null,
        locV: 2,
        n: notes,
        al: alarms,
      });

      return {
        slotKey: item.slotKey,
        targetCalId: targetCal,
        signature,
        dedupSignature: `${targetCal}|${dayIdx}|${eventStartMins}|${trainLabel}`,
        details,
        latitude: depLoc?.latitude,
        longitude: depLoc?.longitude,
      };
    };

    const desiredSlots: DesiredTrainSlot[] = [];
    const seenDesiredEvents = new Set<string>();
    const preservedSlots: { slotKey: string; entry: TrackedTrainEvent }[] = [];
    const expectedAllSlotKeys = new Set<string>();
    const failedGroupKeys = new Set<string>();

    for (const dayRes of dayResults) {
      if (!dayRes) continue;
      for (const pSlot of dayRes.preserved) {
        preservedSlots.push(pSlot);
      }
      for (const ek of dayRes.expectedSlotKeys) {
        expectedAllSlotKeys.add(ek);
      }
      for (const fg of dayRes.failedGroupKeys) {
        failedGroupKeys.add(fg);
      }
      for (const item of [...dayRes.outbounds, ...dayRes.returns]) {
        const slot = buildTrainCalendarSlot(dayRes.dayIdx, dayRes.targetDate, item);
        if (slot && !seenDesiredEvents.has(slot.dedupSignature)) {
          seenDesiredEvents.add(slot.dedupSignature);
          desiredSlots.push(slot);
        }
      }
    }

    // Sincronizzazione differenziale: mantiene invariati gli eventi non modificati ed elimina/ricrea solo i singoli eventi cambiati
    const nextMap: Record<string, TrackedTrainEvent> = {};
    const idsToDelete = new Set<string>();
    const keptEventIds = new Set<string>();
    const slotsToCreate: DesiredTrainSlot[] = [];

    const desiredKeys = new Set<string>();
    for (const pSlot of preservedSlots) {
      desiredKeys.add(pSlot.slotKey);
      nextMap[pSlot.slotKey] = pSlot.entry;
      if (pSlot.entry.eventId) keptEventIds.add(pSlot.entry.eventId);
    }
    for (const slot of desiredSlots) {
      desiredKeys.add(slot.slotKey);
      const prev = prevMap[slot.slotKey];
      if (
        prev &&
        existingEventIds.has(prev.eventId) &&
        prev.calendarId === slot.targetCalId &&
        prev.signature === slot.signature
      ) {
        nextMap[slot.slotKey] = prev;
        keptEventIds.add(prev.eventId);
      } else {
        if (prev?.eventId && existingEventIds.has(prev.eventId)) {
          idsToDelete.add(prev.eventId);
        }
        slotsToCreate.push(slot);
      }
    }

    // Eventi presenti in precedenza ma non più previsti: preserva solo quelli ancora attesi con errore transitorio
    for (const [oldKey, oldEntry] of Object.entries(prevMap)) {
      if (
        expectedAllSlotKeys.has(oldKey) &&
        failedGroupKeys.has(getGroupKey(oldKey))
      ) {
        if (oldEntry?.eventId && existingEventIds.has(oldEntry.eventId)) {
          nextMap[oldKey] = oldEntry;
          keptEventIds.add(oldEntry.eventId);
        }
        continue;
      }
      if (!desiredKeys.has(oldKey) && oldEntry?.eventId && existingEventIds.has(oldEntry.eventId)) {
        idsToDelete.add(oldEntry.eventId);
      }
    }

    // Rimuove qualsiasi evento residuo o disallineato (es. vecchi treni standard sostituiti o UUID rigenerati da iCloud)
    const dedicatedCalIds = new Set<string>();
    if (!isDefaultFallback) dedicatedCalIds.add(calendarId);
    if (returnCalendarId && !returnIsDefaultFallback) {
      dedicatedCalIds.add(returnCalendarId);
    }
    for (const evt of existingEvents) {
      if (!evt.id || keptEventIds.has(evt.id)) continue;
      const inDedicatedCal = evt.calendarId
        ? dedicatedCalIds.has(evt.calendarId)
        : !isDefaultFallback;
      const hasStudiciTrainNotes =
        typeof evt.notes === "string" && evt.notes.includes("StudICI • Treni");
      if (inDedicatedCal || hasStudiciTrainNotes) {
        idsToDelete.add(evt.id);
      }
    }

    const deleteList = Array.from(idsToDelete);
    const CHUNK_SIZE = 6;
    for (let i = 0; i < deleteList.length; i += CHUNK_SIZE) {
      const chunk = deleteList.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map((id) =>
          Calendar.deleteEventAsync(id, { futureEvents: true }).catch(() => {}),
        ),
      );
    }

    if (slotsToCreate.length > 0) {
      const trainStructuredEntries: StructuredLocationEntry[] = [];
      await Promise.all(
        slotsToCreate.map(async (slot) => {
          const newId = await Calendar.createEventAsync(slot.targetCalId, slot.details);
          nextMap[slot.slotKey] = {
            eventId: newId,
            calendarId: slot.targetCalId,
            signature: slot.signature,
          };
          const hasCoords = slot.latitude != null && slot.longitude != null;
          const locText = slot.details.location?.trim() || "";
          if (newId && (hasCoords || locText.length > 0)) {
            trainStructuredEntries.push({
              eventId: newId,
              title: locText,
              latitude: slot.latitude ?? 0,
              longitude: slot.longitude ?? 0,
            });
          }
        }),
      );
      await attachStructuredLocationsIfSupported(trainStructuredEntries);
    }

    await AsyncStorage.setItem(TRAIN_CALENDAR_EVENTS_MAP_KEY, JSON.stringify(nextMap));
    eventsCount = desiredSlots.length + preservedSlots.length;

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_TRAIN_CALENDAR_SYNC_KEY, timestamp.toString());
    await AsyncStorage.setItem(TRAIN_CALENDAR_SCHEDULE_HASH_KEY, trainFingerprint);

    const targetCalendarName = isDefaultFallback
      ? "tuo Calendario"
      : separateReturn && returnCalendarId
        ? `Calendari Treni ('${activeTitle}' e '${returnActiveTitle}')`
        : `Calendario Treni ('${activeTitle}')`;

    return {
      success: true,
      eventsCount,
      message: `Sincronizzazione completata: ${eventsCount} treni inseriti nel ${targetCalendarName}!`,
    };
  } catch (err: any) {
    console.error("Errore sincronizzazione calendario treni:", err);
    return {
      success: false,
      eventsCount: 0,
      message:
        err?.message || "Si è verificato un errore durante la sincronizzazione dei treni.",
      error: String(err),
    };
  } finally {
    if (isOuter) releaseCalendarSyncLock();
  }
}

/**
 * Sincronizza contemporaneamente i calendari abilitati (Lezioni, Treni o entrambi).
 */
export async function syncDualCalendarsToAppleCalendar(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string,
  calendarColor?: string,
): Promise<{
  success: boolean;
  lessonsResult?: CalendarSyncResult;
  trainsResult?: CalendarSyncResult;
  message: string;
}> {
  if (isCalendarSyncInProgress) {
    return {
      success: false,
      message: "Una sincronizzazione del calendario è già in corso. Attendi qualche istante.",
    };
  }
  isCalendarSyncInProgress = true;
  try {
    const [lessonsEnabled, trainsEnabled] = await Promise.all([
      getCalendarEnabled("lessons"),
      getCalendarEnabled("trains"),
    ]);

    if (!lessonsEnabled && !trainsEnabled) {
      return {
        success: false,
        message: "Entrambi i calendari sono disattivati nelle impostazioni.",
      };
    }

    let sharedCalendars: Calendar.Calendar[] | undefined;
    try {
      const fetched = await getFreshCalendarsSafe();
      if (fetched.length > 0) {
        sharedCalendars = fetched;
        await _pullExternalChangesInternal(sharedCalendars, calendarColor, {
          detectExternalDeletion: false,
        });
      }
    } catch {}

    const sharedOutboundItineraries: Record<string, CommuterItinerary> = {};
    let lessonsResult: CalendarSyncResult | undefined;
    let trainsResult: CalendarSyncResult | undefined;

    if (lessonsEnabled) {
      lessonsResult = await syncScheduleToAppleCalendar(
        schedule,
        courseName,
        channelName,
        undefined,
        calendarColor,
        {
          prefetchedCalendars: sharedCalendars,
          skipPullExternal: Boolean(sharedCalendars),
          outOutboundItineraries: sharedOutboundItineraries,
        },
      );
    }

    if (trainsEnabled) {
      trainsResult = await syncTrainsToAppleCalendar(
        schedule,
        undefined,
        calendarColor,
        {
          prefetchedCalendars: sharedCalendars,
          skipPullExternal: Boolean(sharedCalendars),
          precomputedItineraries:
            Object.keys(sharedOutboundItineraries).length > 0
              ? sharedOutboundItineraries
              : undefined,
          forceFullSync: true,
        },
      );
    }

    const success = Boolean(
      (!lessonsEnabled || lessonsResult?.success) &&
        (!trainsEnabled || trainsResult?.success),
    );

    const parts: string[] = [];
    if (lessonsResult?.success && lessonsResult.eventsCount > 0) {
      parts.push(`${lessonsResult.eventsCount} lezioni`);
    }
    if (trainsResult?.success && trainsResult.eventsCount > 0) {
      parts.push(`${trainsResult.eventsCount} treni`);
    }

    let message = "";
    if (parts.length > 0) {
      let base = `Sincronizzazione completata: ${parts.join(" e ")} inseriti con successo nel Calendario Apple!`;
      if (trainsEnabled && !trainsResult?.success) {
        base += `\n\n(Treni non sincronizzati: ${trainsResult?.message || "errore"})`;
      }
      if (lessonsEnabled && !lessonsResult?.success) {
        base += `\n\n(Lezioni non sincronizzate: ${lessonsResult?.message || "errore"})`;
      }
      message = base;
    } else if (!success) {
      message =
        lessonsResult?.message ||
        trainsResult?.message ||
        "Errore durante la sincronizzazione dei calendari.";
    } else {
      message = "Nessun evento da inserire nei calendari.";
    }

    return { success, lessonsResult, trainsResult, message };
  } finally {
    releaseCalendarSyncLock();
  }
}

/**
 * Gestisce il cambio di modalità tra "Stesso calendario" e "Calendario separato" per i treni:
 * Rimuove interamente da iOS i calendari della modalità opposta (anche se rinominati con titolo personalizzato)
 * e, se i treni erano già sincronizzati o l'auto-sync è attivo, rigenera subito i nuovi calendari.
 */
export async function switchTrainCalendarMode(
  separate: boolean,
  calendarColor?: string,
): Promise<{ success: boolean; message: string }> {
  if (isCalendarSyncInProgress) {
    return {
      success: false,
      message: "Una sincronizzazione del calendario è già in corso. Riprova tra poco.",
    };
  }
  isCalendarSyncInProgress = true;
  try {
    await setTrainSeparateReturn(separate);

    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return { success: true, message: "Modalità salvata." };
    }
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      return { success: true, message: "Modalità salvata." };
    }

    const calendars = await getFreshCalendarsSafe();

    if (separate) {
      // Passaggio a CALENDARIO SEPARATO: dobbiamo eliminare il calendario UNIFICATO da iOS
      const [storedUnifiedId, legacyId, unifiedTitle] = await Promise.all([
        AsyncStorage.getItem(TRAIN_UNIFIED_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_CALENDAR_ID_KEY),
        getCalendarTitle("trains", false),
      ]);

      const toDelete = calendars.filter(
        (c) =>
          c.allowsModifications &&
          (c.id === storedUnifiedId ||
            c.id === legacyId ||
            c.name === "studici_trains_unified" ||
            c.name === "studici_trains" ||
            c.title === unifiedTitle ||
            c.title === DEFAULT_TRAIN_UNIFIED_CALENDAR_TITLE ||
            c.title === "StudICI - Treni & Viaggio"),
      );

      for (const cal of toDelete) {
        try {
          await Calendar.deleteCalendarAsync(cal.id);
        } catch {}
      }

      await AsyncStorage.removeItem(TRAIN_UNIFIED_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_SCHEDULE_HASH_KEY);
    } else {
      // Passaggio a STESSO CALENDARIO (UNIFICATO): dobbiamo eliminare i calendari SEPARATI (Andata e Ritorno) da iOS
      const [
        storedOutboundId,
        storedReturnId,
        legacyId,
        outboundTitle,
        returnTitle,
      ] = await Promise.all([
        AsyncStorage.getItem(TRAIN_OUTBOUND_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_RETURN_CALENDAR_ID_KEY),
        AsyncStorage.getItem(TRAIN_CALENDAR_ID_KEY),
        getCalendarTitle("trains", true),
        getCalendarTitle("trains_return"),
      ]);

      const toDelete = calendars.filter(
        (c) =>
          c.allowsModifications &&
          (c.id === storedOutboundId ||
            c.id === storedReturnId ||
            c.id === legacyId ||
            c.name === "studici_trains_outbound" ||
            c.name === "studici_trains_return" ||
            c.name === "studici_trains" ||
            c.title === outboundTitle ||
            c.title === returnTitle ||
            c.title === DEFAULT_TRAIN_OUTBOUND_CALENDAR_TITLE ||
            c.title === DEFAULT_TRAIN_RETURN_CALENDAR_TITLE ||
            c.title === "StudICI - Treni Ritorno"),
      );

      for (const cal of toDelete) {
        try {
          await Calendar.deleteCalendarAsync(cal.id);
        } catch {}
      }

      await AsyncStorage.removeItem(TRAIN_OUTBOUND_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_RETURN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(CALENDAR_TRAINS_RETURN_CUSTOM_COLOR_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_ID_KEY);
      await AsyncStorage.removeItem(TRAIN_CALENDAR_SCHEDULE_HASH_KEY);
    }

    // Se i treni erano già sincronizzati in precedenza o l'auto-sync è attivo, rigenera subito i nuovi calendari
    const [trainsEnabled, lastSync, trainsAuto] = await Promise.all([
      getCalendarEnabled("trains"),
      getLastCalendarSync("trains"),
      getCalendarAutoSync("trains"),
    ]);

    if (trainsEnabled && (lastSync !== null || trainsAuto)) {
      const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
      const storedDefaultTab =
        (storedDegreeUrl ? await AsyncStorage.getItem(`defaultTabUrl_${storedDegreeUrl}`) : null) ||
        (await AsyncStorage.getItem("defaultTabUrl"));
      if (storedDefaultTab) {
        try {
          const schedule =
            (await getCachedScheduleData(storedDefaultTab, storedDegreeUrl)) ||
            (await fetchScheduleData(storedDefaultTab));
          if (schedule && schedule.days && schedule.days.length > 0) {
            await syncTrainsToAppleCalendar(
              schedule,
              undefined,
              calendarColor,
              { forceFullSync: true },
            );
          }
        } catch (syncErr) {
          console.warn("Errore rigenerazione treni dopo cambio modalità:", syncErr);
        }
      }
    }

    return {
      success: true,
      message: separate
        ? "Impostato calendario separato: il vecchio calendario unificato è stato rimosso da iOS."
        : "Impostato calendario unificato: i vecchi calendari separati sono stati rimossi da iOS.",
    };
  } catch (err: any) {
    console.error("Errore durante switchTrainCalendarMode:", err);
    return {
      success: false,
      message: err?.message || "Errore durante il cambio modalità calendario.",
    };
  } finally {
    releaseCalendarSyncLock();
  }
}

/**
 * Verifica se l'aggiornamento automatico è abilitato e sincronizza i calendari se necessario.
 */
export async function triggerCalendarAutoSyncIfNeeded(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string,
  calendarColor?: string,
  syncHints?: {
    onlySlotKeys?: string[];
    precomputedItineraries?: Record<string, CommuterItinerary>;
  },
): Promise<boolean> {
  if (isCalendarSyncInProgress) return false;
  isCalendarSyncInProgress = true;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return false;

    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") return false;

    const calendars = await getFreshCalendarsSafe();
    await _pullExternalChangesInternal(calendars, calendarColor);

    const [lessonsAuto, trainsAuto, lessonsEnabled, trainsEnabled] =
      await Promise.all([
        getCalendarAutoSync("lessons"),
        getCalendarAutoSync("trains"),
        getCalendarEnabled("lessons"),
        getCalendarEnabled("trains"),
      ]);
    const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
    const [manualList, excludedRecords] = await Promise.all([
      getManualEvents(storedDegreeUrl || undefined),
      getExcludedLessons(storedDegreeUrl || undefined),
    ]);
    const excludedIds = Array.from(buildExcludedIdSet(excludedRecords)).sort();
    let anyUpdated = false;
    const sharedOutboundItineraries: Record<string, CommuterItinerary> = {
      ...(syncHints?.precomputedItineraries || {}),
    };

    // 1. Auto-sync Lezioni
    if (lessonsAuto && lessonsEnabled) {
      try {
        const activeTitle = await getCalendarTitle("lessons");
        const alertConfig = await getCalendarAlertConfig("lessons");
        const storedLessonsId = await AsyncStorage.getItem(CALENDAR_ID_KEY);

        const currentFingerprint = computeScheduleFingerprint(
          schedule,
          manualList,
          activeTitle,
          alertConfig.alertType,
          alertConfig.customMinutes,
          excludedIds,
        );
        const savedFingerprint = await AsyncStorage.getItem(
          CALENDAR_SCHEDULE_HASH_KEY,
        );

        const calendarExists = calendars.some(
          (c) =>
            c.allowsModifications &&
            (c.id === storedLessonsId ||
              c.name === "studici_lessons" ||
              c.title === activeTitle),
        );

        if (!calendarExists || !savedFingerprint || savedFingerprint !== currentFingerprint) {
          const res = await syncScheduleToAppleCalendar(
            schedule,
            courseName,
            channelName,
            activeTitle,
            calendarColor,
            {
              prefetchedCalendars: calendars,
              skipPullExternal: true,
              outOutboundItineraries: sharedOutboundItineraries,
            },
          );
          if (res.success) anyUpdated = true;
        }
      } catch (err) {
        console.warn("Errore auto-sync lezioni:", err);
      }
    }

    // 2. Auto-sync Treni
    if (trainsAuto && trainsEnabled) {
      try {
        const separateReturn = await getTrainSeparateReturn();
        const activeTitle = await getCalendarTitle("trains", separateReturn);
        const alertConfig = await getCalendarAlertConfig("trains");
        const returnTitle = await getCalendarTitle("trains_return");
        const commuterConfig = await getCommuterConfig();

        const storedTrainsId = separateReturn
          ? await AsyncStorage.getItem(TRAIN_OUTBOUND_CALENDAR_ID_KEY)
          : await AsyncStorage.getItem(TRAIN_UNIFIED_CALENDAR_ID_KEY);
        const legacyTrainsId = await AsyncStorage.getItem(TRAIN_CALENDAR_ID_KEY);

        const currentFingerprint = computeTrainFingerprint(
          schedule,
          manualList,
          commuterConfig,
          activeTitle,
          alertConfig.alertType,
          alertConfig.customMinutes,
          true,
          separateReturn,
          returnTitle,
          excludedIds,
        );
        const savedFingerprint = await AsyncStorage.getItem(
          TRAIN_CALENDAR_SCHEDULE_HASH_KEY,
        );

        const calendarExists = calendars.some(
          (c) =>
            c.allowsModifications &&
            (c.id === storedTrainsId ||
              c.id === legacyTrainsId ||
              c.name === (separateReturn ? "studici_trains_outbound" : "studici_trains_unified") ||
              c.name === "studici_trains" ||
              c.title === activeTitle),
        );

        if (!calendarExists || !savedFingerprint || savedFingerprint !== currentFingerprint) {
          const res = await syncTrainsToAppleCalendar(
            schedule,
            activeTitle,
            calendarColor,
            {
              prefetchedCalendars: calendars,
              skipPullExternal: true,
              onlySlotKeys: syncHints?.onlySlotKeys,
              precomputedItineraries:
                Object.keys(sharedOutboundItineraries).length > 0
                  ? sharedOutboundItineraries
                  : undefined,
            },
          );
          if (res.success) anyUpdated = true;
        }
      } catch (err) {
        console.warn("Errore auto-sync treni:", err);
      }
    }

    return anyUpdated;
  } catch (err) {
    console.warn("Errore durante auto-sync calendario all'avvio:", err);
    return false;
  } finally {
    releaseCalendarSyncLock();
  }
}

/**
 * Rinfresca il Calendario Apple in background se configurato.
 */
export async function refreshAppleCalendarIfConfigured(
  colorOrOptions?: string | AppleCalendarRefreshOptions,
): Promise<boolean> {
  const opts: AppleCalendarRefreshOptions =
    typeof colorOrOptions === "string"
      ? { calendarColor: colorOrOptions }
      : colorOrOptions || {};
  const calendarColor = opts.calendarColor;

  if (isCalendarSyncInProgress) {
    mergePendingRefreshOptions(opts);
    return false;
  }
  try {
    const [lessonsAuto, trainsAuto] = await Promise.all([
      getCalendarAutoSync("lessons"),
      getCalendarAutoSync("trains"),
    ]);

    if (!lessonsAuto && !trainsAuto) return false;

    const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
    if (!storedDegreeUrl) return false;

    const [degreeName, defaultTabUrl] = await Promise.all([
      AsyncStorage.getItem("selectedDegreeName"),
      (async () => {
        const forDeg = await AsyncStorage.getItem(`defaultTabUrl_${storedDegreeUrl}`);
        if (forDeg) return forDeg;
        return await AsyncStorage.getItem("defaultTabUrl");
      })(),
    ]);

    if (!defaultTabUrl) return false;

    const channelName =
      (await AsyncStorage.getItem(`defaultTabLabel_${storedDegreeUrl}`)) ||
      (await AsyncStorage.getItem("defaultTabLabel")) ||
      undefined;

    const schedule =
      (opts.schedule && opts.schedule.days?.length ? opts.schedule : null) ||
      (await getCachedScheduleData(defaultTabUrl, storedDegreeUrl)) ||
      (await fetchScheduleData(defaultTabUrl));
    if (!schedule || !schedule.days || schedule.days.length === 0) return false;

    const cleanDegree = degreeName
      ? degreeName.replace(/^Corso di Laurea (Magistrale )?in\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim()
      : "Corso di Laurea";

    return await triggerCalendarAutoSyncIfNeeded(
      schedule,
      cleanDegree,
      channelName,
      calendarColor,
      {
        onlySlotKeys: opts.onlySlotKeys,
        precomputedItineraries: opts.precomputedItineraries,
      },
    );
  } catch (err) {
    console.warn("Errore auto-aggiornamento calendario Apple:", err);
    return false;
  }
}
