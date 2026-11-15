import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { CommuterConfig, StrikeAlertPreferences } from '../types/commuter';
import { DisruptionCategory, DisruptionEvent } from '../types/disruptions';
import {
  DEFAULT_STRIKE_ALERTS,
  getCommuterConfig,
  saveCommuterConfig,
} from './commuterStorage';
import {
  formatTrainStrikeBannerSummary,
  getDisruptions,
  isTrainStrikeImpactingCommuter,
  isWalkDisruptionImpactingCommuter,
} from './disruptionsService';

export const STRIKE_NOTIFICATION_PREFIX = 'studici_strike_';
const REMINDER_TAG_PREFIX = '[StudICI-Sciopero:';
const STRIKE_CHANNEL_ID = 'strikes';
const STRIKE_STATE_KEY = 'studici_strike_reminders_state_v2';
const STRIKE_DISPATCH_LOG_KEY = 'studici_strike_notifications_log_v1';
const STRIKE_PERMISSION_ASKED_KEY = 'studici_strike_reminders_perm_asked_v2';
const LEGACY_NOTIFS_CLEANED_KEY = 'studici_strike_legacy_notifs_cleaned_v1';

const MAX_SCHEDULED_STRIKE_ITEMS = 40;
const NOTIFY_HOUR_LOCAL = 12;
const NOTIFY_MINUTE_LOCAL = 0;
const CATCHUP_DELAY_IOS_MS = 60_000;
const CATCHUP_DELAY_ANDROID_MS = 20_000;
const MIN_FUTURE_MARGIN_MS = 15_000;
const LOG_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;

export interface StrikeNotificationTapPayload {
  eventId?: string | null;
  strikeKey?: string | null;
  strikeDateIso?: string | null;
  category?: DisruptionCategory | null;
}

export interface StrikeNotificationsStatus {
  enabled: boolean;
  notify7DaysBefore: boolean;
  notify1DayBefore: boolean;
  permissionGranted: boolean;
  canAskAgain: boolean;
  scheduledCount: number;
  upcomingImpactingCount: number;
  backend: 'reminders' | 'notifications';
}

interface StoredReminderStateEntry {
  identifier: string;
  reminderId: string;
  fireAtMs: number;
  title: string;
  notes: string;
  strikeDateIso: string;
  strikeEventId: string;
}

interface PlannedStrikeAlert {
  identifier: string;
  leadDays: 7 | 1;
  strikeKey: string;
  fireAtMs: number;
  title: string;
  subtitle: string;
  body: string;
  notesWithTag: string;
  strikeEventId: string;
  strikeDateIso: string;
  strikeCategory: DisruptionCategory;
}

let handlerInitialized = false;
let syncQueue: Promise<unknown> = Promise.resolve();

const statusListeners = new Set<(status: StrikeNotificationsStatus) => void>();
const tapListeners = new Set<(payload: StrikeNotificationTapPayload) => void>();
let pendingTapPayload: StrikeNotificationTapPayload | null = null;

export function ensureStrikeNotificationHandler(): void {
  if (handlerInitialized) return;
  handlerInitialized = true;
  if (Platform.OS === 'ios') return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Ignora in ambienti privi di runtime nativo
  }
}

export function emitStrikeNotificationTap(payload: StrikeNotificationTapPayload): void {
  pendingTapPayload = payload;
  tapListeners.forEach((cb) => {
    try {
      cb(payload);
    } catch {}
  });
}

export function consumePendingStrikeNotificationTap(): StrikeNotificationTapPayload | null {
  const current = pendingTapPayload;
  pendingTapPayload = null;
  return current;
}

export function subscribeToStrikeNotificationTap(
  listener: (payload: StrikeNotificationTapPayload) => void,
): () => void {
  tapListeners.add(listener);
  return () => {
    tapListeners.delete(listener);
  };
}

export function subscribeToStrikeNotificationStatus(
  listener: (status: StrikeNotificationsStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function notifyStatusListeners(status: StrikeNotificationsStatus): void {
  statusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch {}
  });
}

function normalizeHashPart(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fnv1aHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function computeStableStrikeKey(event: DisruptionEvent): string {
  const signature = [
    event.category,
    event.startDate,
    event.endDate,
    normalizeHashPart(event.scope),
    normalizeHashPart(event.affectedCompanies),
    normalizeHashPart(event.title),
  ].join('|');
  return `${event.category}_${event.startDate}_${fnv1aHashHex(signature)}`;
}

export function isStrikeEventImpactingRoute(
  event: DisruptionEvent,
  arrivalStationName?: string,
): boolean {
  if (event.category === 'sciopero_treni') {
    return isTrainStrikeImpactingCommuter(event);
  }
  if (event.category === 'sciopero_tpl') {
    return isWalkDisruptionImpactingCommuter(event, arrivalStationName);
  }
  return false;
}

function resolveAlertPrefs(config: CommuterConfig): StrikeAlertPreferences {
  return {
    notify7DaysBefore:
      config.strikeAlerts?.notify7DaysBefore ??
      DEFAULT_STRIKE_ALERTS.notify7DaysBefore,
    notify1DayBefore:
      config.strikeAlerts?.notify1DayBefore ??
      DEFAULT_STRIKE_ALERTS.notify1DayBefore,
  };
}

function parseIsoDateParts(iso: string): { year: number; month: number; day: number } | null {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function diffLocalCalendarDays(targetIso: string, refDate: Date): number | null {
  const parts = parseIsoDateParts(targetIso);
  if (!parts) return null;
  const targetMidnight = new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  const refMidnight = new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate(),
    0,
    0,
    0,
    0,
  );
  return Math.round((targetMidnight.getTime() - refMidnight.getTime()) / (24 * 60 * 60 * 1000));
}

function formatItalianStrikeDate(event: DisruptionEvent): string {
  if (event.formattedDateSpan && event.formattedDateSpan.trim()) {
    return event.formattedDateSpan.trim();
  }
  const parts = parseIsoDateParts(event.startDate);
  if (!parts) return event.startDate;
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

function buildAlertCopy(
  event: DisruptionEvent,
  leadDays: 7 | 1,
): { title: string; subtitle: string; body: string } {
  const isTrain = event.category === 'sciopero_treni';
  const dateLabel = formatItalianStrikeDate(event);

  const summaryRaw = isTrain
    ? formatTrainStrikeBannerSummary(event, event.startDate)
    : (event.timeWindow || event.scope || '').trim();
  const detailSuffix = summaryRaw ? ` • ${summaryRaw}` : '';

  if (isTrain) {
    return {
      title:
        leadDays === 7
          ? 'Sciopero treni tra 1 settimana'
          : 'Domani sciopero treni',
      subtitle: 'Impatta la tua tratta (Trenitalia / RFI)',
      body: `${dateLabel}${detailSuffix}. Controlla orari e corse garantite in StudICI.`,
    };
  }

  return {
    title:
      leadDays === 7
        ? 'Sciopero mezzi TPL tra 1 settimana'
        : 'Domani sciopero mezzi TPL',
    subtitle: 'Impatta il tuo percorso urbano',
    body: `${dateLabel}${detailSuffix}. Verifica il tragitto in StudICI.`,
  };
}

function buildStrikeAlertPlans(
  events: DisruptionEvent[],
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  nowMs: number,
  previousDispatchLog: Record<string, number>,
): {
  planned: PlannedStrikeAlert[];
  updatedDispatchLog: Record<string, number>;
  upcomingImpactingCount: number;
} {
  const arrivalStationName =
    config.arrivalStation?.shortName || config.arrivalStation?.name || undefined;

  const impactingStrikes = events.filter((ev) =>
    isStrikeEventImpactingRoute(ev, arrivalStationName),
  );

  const uniqueByKey = new Map<string, DisruptionEvent>();
  for (const ev of impactingStrikes) {
    const key = computeStableStrikeKey(ev);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, ev);
    }
  }

  const nowDate = new Date(nowMs);
  const todayIso = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  let upcomingImpactingCount = 0;

  const updatedDispatchLog: Record<string, number> = {};
  for (const [k, ts] of Object.entries(previousDispatchLog)) {
    if (typeof ts === 'number' && nowMs - ts < LOG_RETENTION_MS) {
      updatedDispatchLog[k] = ts;
    }
  }

  const catchupDelay =
    Platform.OS === 'ios' ? CATCHUP_DELAY_IOS_MS : CATCHUP_DELAY_ANDROID_MS;
  const planned: PlannedStrikeAlert[] = [];

  for (const [strikeKey, ev] of uniqueByKey.entries()) {
    if (!ev.endDate || ev.endDate >= todayIso) {
      upcomingImpactingCount += 1;
    }

    const parts = parseIsoDateParts(ev.startDate);
    if (!parts) continue;

    const daysUntilStart = diffLocalCalendarDays(ev.startDate, nowDate);
    const activeLeads: (7 | 1)[] = [];
    if (alertPrefs.notify7DaysBefore) activeLeads.push(7);
    if (alertPrefs.notify1DayBefore) activeLeads.push(1);

    for (const leadDays of activeLeads) {
      const targetLocalDate = new Date(
        parts.year,
        parts.month - 1,
        parts.day - leadDays,
        NOTIFY_HOUR_LOCAL,
        NOTIFY_MINUTE_LOCAL,
        0,
        0,
      );
      const nominalMs = targetLocalDate.getTime();
      const identifier = `${STRIKE_NOTIFICATION_PREFIX}${strikeKey}_${leadDays}d`;

      let fireAtMs: number | null = null;

      if (nominalMs > nowMs + MIN_FUTURE_MARGIN_MS) {
        fireAtMs = nominalMs;
      } else if (
        isSameLocalCalendarDay(nowDate, targetLocalDate) &&
        nowDate.getHours() < 22 &&
        !(leadDays === 7 && daysUntilStart !== null && daysUntilStart <= 1)
      ) {
        const existingLogTs = updatedDispatchLog[identifier];
        if (typeof existingLogTs === 'number') {
          if (existingLogTs > nowMs + 2_000) {
            fireAtMs = existingLogTs;
          }
        } else {
          fireAtMs = nowMs + catchupDelay;
          updatedDispatchLog[identifier] = fireAtMs;
        }
      }

      if (fireAtMs === null) continue;

      const copy = buildAlertCopy(ev, leadDays);
      const notesWithTag = `${copy.subtitle}\n${copy.body}\n\n${REMINDER_TAG_PREFIX}${identifier}]`;
      planned.push({
        identifier,
        leadDays,
        strikeKey,
        fireAtMs,
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        notesWithTag,
        strikeEventId: ev.id,
        strikeDateIso: ev.startDate,
        strikeCategory: ev.category,
      });
    }
  }

  planned.sort((a, b) => a.fireAtMs - b.fireAtMs);
  return {
    planned: planned.slice(0, MAX_SCHEDULED_STRIKE_ITEMS),
    updatedDispatchLog,
    upcomingImpactingCount,
  };
}

function extractStrikeIdentifierFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const escapedPrefix = REMINDER_TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = notes.match(new RegExp(`${escapedPrefix}([^\\]\\s]+)\\]`));
  return match ? match[1] : null;
}

async function readJsonStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function resolveIosTargetRemindersCalendar(): Promise<{
  targetCalendarId: string | null;
  writableCalendarIds: (string | null)[];
}> {
  try {
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.REMINDER,
    );
    const writable = calendars.filter((c) => c.allowsModifications && c.id);
    const primary =
      writable.find((c) => c.isPrimary) ||
      writable.find(
        (c) =>
          c.title === 'Promemoria' ||
          c.name === 'Promemoria' ||
          c.title === 'Reminders' ||
          c.name === 'Reminders',
      ) ||
      writable[0] ||
      null;

    const writableIds: (string | null)[] = writable.map((c) => c.id);
    if (writableIds.length === 0) writableIds.push(null);

    return {
      targetCalendarId: primary ? primary.id : null,
      writableCalendarIds: writableIds,
    };
  } catch {
    return { targetCalendarId: null, writableCalendarIds: [null] };
  }
}

async function fetchManagedIosReminders(
  writableCalendarIds: (string | null)[],
  storedState: Record<string, StoredReminderStateEntry>,
): Promise<Calendar.Reminder[]> {
  let allReminders: Calendar.Reminder[] = [];
  try {
    allReminders = await Calendar.getRemindersAsync(
      writableCalendarIds,
      null,
      null,
      null,
    );
  } catch {
    try {
      const startWin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endWin = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const [incomplete, completed] = await Promise.all([
        Calendar.getRemindersAsync(
          writableCalendarIds,
          Calendar.ReminderStatus.INCOMPLETE,
          startWin,
          endWin,
        ).catch(() => []),
        Calendar.getRemindersAsync(
          writableCalendarIds,
          Calendar.ReminderStatus.COMPLETED,
          startWin,
          endWin,
        ).catch(() => []),
      ]);
      allReminders = [...incomplete, ...completed];
    } catch {
      allReminders = [];
    }
  }

  // Fallback per eventuali ID salvati in stato locale ma non inclusi nella query globale
  const foundIds = new Set(allReminders.map((r) => r.id).filter(Boolean));
  for (const entry of Object.values(storedState)) {
    if (entry.reminderId && !foundIds.has(entry.reminderId)) {
      try {
        const single = await Calendar.getReminderAsync(entry.reminderId);
        if (single) {
          allReminders.push(single);
          if (single.id) foundIds.add(single.id);
        }
      } catch {}
    }
  }

  const managedIds = new Set(
    Object.values(storedState).map((e) => e.reminderId),
  );
  return allReminders.filter(
    (rem) =>
      Boolean(extractStrikeIdentifierFromNotes(rem.notes)) ||
      (rem.id ? managedIds.has(rem.id) : false),
  );
}

async function purgeLegacyIosStrikeNotificationsOnce(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const cleaned = await AsyncStorage.getItem(LEGACY_NOTIFS_CLEANED_KEY);
    if (cleaned === 'true') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(
      () => [],
    );
    const strikeItems = scheduled.filter((req) =>
      req.identifier.startsWith(STRIKE_NOTIFICATION_PREFIX),
    );
    await Promise.all(
      strikeItems.map((req) =>
        Notifications.cancelScheduledNotificationAsync(req.identifier).catch(
          () => {},
        ),
      ),
    );
    await AsyncStorage.setItem(LEGACY_NOTIFS_CLEANED_KEY, 'true');
  } catch {}
}

async function clearAllIosStrikeReminders(
  storedState: Record<string, StoredReminderStateEntry>,
): Promise<void> {
  try {
    const avail = await Calendar.isAvailableAsync();
    if (!avail) return;
    const perm = await Calendar.getRemindersPermissionsAsync();
    if (perm.status !== 'granted') return;

    const { writableCalendarIds } = await resolveIosTargetRemindersCalendar();
    const managed = await fetchManagedIosReminders(
      writableCalendarIds,
      storedState,
    );
    for (const rem of managed) {
      if (rem.id && !rem.completed) {
        await Calendar.deleteReminderAsync(rem.id).catch(() => {});
      }
    }
  } catch {}
  await AsyncStorage.removeItem(STRIKE_STATE_KEY).catch(() => {});
}

async function syncIosStrikeReminders(
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  events: DisruptionEvent[],
  options?: { promptIfNeeded?: boolean },
): Promise<StrikeNotificationsStatus> {
  await purgeLegacyIosStrikeNotificationsOnce();

  const storedState = await readJsonStorage<
    Record<string, StoredReminderStateEntry>
  >(STRIKE_STATE_KEY, {});
  const isAnyAlertEnabled =
    alertPrefs.notify7DaysBefore || alertPrefs.notify1DayBefore;

  const isAvail = await Calendar.isAvailableAsync().catch(() => false);
  let perm = isAvail
    ? await Calendar.getRemindersPermissionsAsync().catch(() => ({
        granted: false,
        canAskAgain: true,
        status: 'undetermined' as const,
      }))
    : { granted: false, canAskAgain: false, status: 'denied' as const };

  if (!config.enabled || !isAnyAlertEnabled) {
    await clearAllIosStrikeReminders(storedState);
    return {
      enabled: isAnyAlertEnabled,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: perm.status === 'granted',
      canAskAgain: perm.canAskAgain ?? true,
      scheduledCount: 0,
      upcomingImpactingCount: 0,
      backend: 'reminders',
    };
  }

  const dispatchLog = await readJsonStorage<Record<string, number>>(
    STRIKE_DISPATCH_LOG_KEY,
    {},
  );
  const { planned, updatedDispatchLog, upcomingImpactingCount } =
    buildStrikeAlertPlans(events, config, alertPrefs, Date.now(), dispatchLog);

  if (isAvail && perm.status !== 'granted' && perm.canAskAgain) {
    const alreadyAsked = await AsyncStorage.getItem(STRIKE_PERMISSION_ASKED_KEY);
    const shouldPrompt =
      Boolean(options?.promptIfNeeded) ||
      (planned.length > 0 && alreadyAsked !== 'true');
    if (shouldPrompt) {
      await AsyncStorage.setItem(STRIKE_PERMISSION_ASKED_KEY, 'true');
      try {
        perm = await Calendar.requestRemindersPermissionsAsync();
      } catch {}
    }
  }

  if (!isAvail || perm.status !== 'granted') {
    return {
      enabled: true,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: false,
      canAskAgain: perm.canAskAgain ?? false,
      scheduledCount: 0,
      upcomingImpactingCount,
      backend: 'reminders',
    };
  }

  const { targetCalendarId, writableCalendarIds } =
    await resolveIosTargetRemindersCalendar();
  const managedReminders = await fetchManagedIosReminders(
    writableCalendarIds,
    storedState,
  );

  // Indicizza i promemoria esistenti per identificatore logico
  const existingByIdentifier = new Map<string, Calendar.Reminder[]>();
  const completedIdentifiers = new Set<string>();

  for (const rem of managedReminders) {
    const extracted = extractStrikeIdentifierFromNotes(rem.notes);
    let identifier = extracted;
    if (!identifier && rem.id) {
      const storedMatch = Object.values(storedState).find(
        (s) => s.reminderId === rem.id,
      );
      if (storedMatch) identifier = storedMatch.identifier;
    }
    if (!identifier) continue;

    if (rem.completed) {
      completedIdentifiers.add(identifier);
      continue;
    }
    const bucket = existingByIdentifier.get(identifier) || [];
    bucket.push(rem);
    existingByIdentifier.set(identifier, bucket);
  }

  const desiredMap = new Map<string, PlannedStrikeAlert>();
  for (const item of planned) {
    desiredMap.set(item.identifier, item);
  }

  // Elimina promemoria obsoleti, disattivati dalle impostazioni (-7 o -1) o non più nel feed
  for (const [identifier, bucket] of existingByIdentifier.entries()) {
    if (!desiredMap.has(identifier)) {
      for (const rem of bucket) {
        if (rem.id) {
          await Calendar.deleteReminderAsync(rem.id).catch(() => {});
        }
      }
      existingByIdentifier.delete(identifier);
    }
  }

  const nextState: Record<string, StoredReminderStateEntry> = {};
  let scheduledCount = 0;

  for (const item of planned) {
    if (completedIdentifiers.has(item.identifier)) {
      // Rispetta il promemoria già segnato come completato dall'utente in Apple Promemoria
      continue;
    }

    const bucket = existingByIdentifier.get(item.identifier) || [];
    const primaryExisting = bucket[0];
    // Rimuove eventuali duplicati extra con lo stesso identificatore
    for (let i = 1; i < bucket.length; i++) {
      const dup = bucket[i];
      if (dup?.id) {
        await Calendar.deleteReminderAsync(dup.id).catch(() => {});
      }
    }

    const dueDate = new Date(item.fireAtMs);
    const existingDueMs = primaryExisting?.dueDate
      ? new Date(primaryExisting.dueDate).getTime()
      : NaN;
    const prevStored = storedState[item.identifier];

    const isUnchanged =
      Boolean(primaryExisting?.id) &&
      primaryExisting?.title === item.title &&
      (primaryExisting?.notes || '') === item.notesWithTag &&
      ((Number.isFinite(existingDueMs) &&
        Math.abs(existingDueMs - item.fireAtMs) <= 60_000) ||
        (Boolean(prevStored) &&
          Math.abs(prevStored.fireAtMs - item.fireAtMs) <= 60_000));

    if (isUnchanged && primaryExisting?.id) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        reminderId: primaryExisting.id,
        fireAtMs: item.fireAtMs,
        title: item.title,
        notes: item.notesWithTag,
        strikeDateIso: item.strikeDateIso,
        strikeEventId: item.strikeEventId,
      };
      scheduledCount += 1;
      continue;
    }

    const reminderPayload: Calendar.Reminder = {
      title: item.title,
      notes: item.notesWithTag,
      startDate: dueDate,
      dueDate,
      allDay: false,
      alarms: [{ absoluteDate: dueDate.toISOString() }],
      url: 'studici://viaggio',
      completed: false,
    };

    let finalReminderId: string | null = null;
    if (primaryExisting?.id) {
      try {
        await Calendar.updateReminderAsync(primaryExisting.id, reminderPayload);
        finalReminderId = primaryExisting.id;
      } catch {
        await Calendar.deleteReminderAsync(primaryExisting.id).catch(() => {});
      }
    }

    if (!finalReminderId) {
      try {
        finalReminderId = await Calendar.createReminderAsync(
          targetCalendarId,
          reminderPayload,
        );
      } catch (err) {
        console.warn('[StrikeReminders] Errore creazione promemoria:', err);
      }
    }

    if (finalReminderId) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        reminderId: finalReminderId,
        fireAtMs: item.fireAtMs,
        title: item.title,
        notes: item.notesWithTag,
        strikeDateIso: item.strikeDateIso,
        strikeEventId: item.strikeEventId,
      };
      scheduledCount += 1;
    }
  }

  await Promise.all([
    AsyncStorage.setItem(STRIKE_STATE_KEY, JSON.stringify(nextState)).catch(
      () => {},
    ),
    AsyncStorage.setItem(
      STRIKE_DISPATCH_LOG_KEY,
      JSON.stringify(updatedDispatchLog),
    ).catch(() => {}),
  ]);

  return {
    enabled: true,
    notify7DaysBefore: alertPrefs.notify7DaysBefore,
    notify1DayBefore: alertPrefs.notify1DayBefore,
    permissionGranted: true,
    canAskAgain: perm.canAskAgain ?? true,
    scheduledCount,
    upcomingImpactingCount,
    backend: 'reminders',
  };
}

function isAndroidNotificationPermissionGranted(
  settings: Notifications.NotificationPermissionsStatus,
): boolean {
  return settings.granted;
}

async function syncAndroidStrikeNotifications(
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  events: DisruptionEvent[],
  options?: { promptIfNeeded?: boolean },
): Promise<StrikeNotificationsStatus> {
  ensureStrikeNotificationHandler();

  const isAnyAlertEnabled =
    alertPrefs.notify7DaysBefore || alertPrefs.notify1DayBefore;
  const initialPerms = await Notifications.getPermissionsAsync().catch(() => ({
    granted: false,
    canAskAgain: true,
    status: Notifications.PermissionStatus.UNDETERMINED,
    expires: 'never' as const,
  }));

  if (!config.enabled || !isAnyAlertEnabled) {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((req) => req.identifier.startsWith(STRIKE_NOTIFICATION_PREFIX))
          .map((req) =>
            Notifications.cancelScheduledNotificationAsync(req.identifier).catch(
              () => {},
            ),
          ),
      );
    } catch {}
    await AsyncStorage.removeItem(STRIKE_STATE_KEY).catch(() => {});
    return {
      enabled: isAnyAlertEnabled,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: isAndroidNotificationPermissionGranted(initialPerms),
      canAskAgain: initialPerms.canAskAgain ?? true,
      scheduledCount: 0,
      upcomingImpactingCount: 0,
      backend: 'notifications',
    };
  }

  const dispatchLog = await readJsonStorage<Record<string, number>>(
    STRIKE_DISPATCH_LOG_KEY,
    {},
  );
  const { planned, updatedDispatchLog, upcomingImpactingCount } =
    buildStrikeAlertPlans(events, config, alertPrefs, Date.now(), dispatchLog);

  let currentPerms = initialPerms;
  let granted = isAndroidNotificationPermissionGranted(currentPerms);
  if (!granted && currentPerms.canAskAgain) {
    const alreadyAsked = await AsyncStorage.getItem(STRIKE_PERMISSION_ASKED_KEY);
    if (options?.promptIfNeeded || (planned.length > 0 && alreadyAsked !== 'true')) {
      await AsyncStorage.setItem(STRIKE_PERMISSION_ASKED_KEY, 'true');
      currentPerms = await Notifications.requestPermissionsAsync().catch(
        () => initialPerms,
      );
      granted = isAndroidNotificationPermissionGranted(currentPerms);
    }
  }

  if (!granted) {
    return {
      enabled: true,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: false,
      canAskAgain: currentPerms.canAskAgain ?? false,
      scheduledCount: 0,
      upcomingImpactingCount,
      backend: 'notifications',
    };
  }

  await Notifications.setNotificationChannelAsync(STRIKE_CHANNEL_ID, {
    name: 'Avvisi scioperi',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 200, 250],
    lightColor: '#EF4444',
  }).catch(() => {});

  const [existingAll, storedState] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    readJsonStorage<Record<string, StoredReminderStateEntry>>(
      STRIKE_STATE_KEY,
      {},
    ),
  ]);

  const existingIds = new Set(
    existingAll
      .map((i) => i.identifier)
      .filter((id) => id.startsWith(STRIKE_NOTIFICATION_PREFIX)),
  );
  const desiredMap = new Map(planned.map((p) => [p.identifier, p]));

  for (const id of existingIds) {
    if (!desiredMap.has(id)) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }

  const nextState: Record<string, StoredReminderStateEntry> = {};
  let scheduledCount = 0;

  for (const item of planned) {
    const prev = storedState[item.identifier];
    if (
      existingIds.has(item.identifier) &&
      prev &&
      prev.title === item.title &&
      prev.notes === item.body &&
      Math.abs(prev.fireAtMs - item.fireAtMs) <= 60_000
    ) {
      nextState[item.identifier] = prev;
      scheduledCount += 1;
      continue;
    }

    if (existingIds.has(item.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier).catch(
        () => {},
      );
    }

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: item.identifier,
        content: {
          title: item.title,
          body: item.body,
          sound: 'default',
          color: '#EF4444',
          priority: Notifications.AndroidNotificationPriority.HIGH,
          data: {
            type: 'strike_alert',
            leadDays: item.leadDays,
            strikeKey: item.strikeKey,
            strikeEventId: item.strikeEventId,
            strikeStartDate: item.strikeDateIso,
            strikeCategory: item.strikeCategory,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: item.fireAtMs,
          channelId: STRIKE_CHANNEL_ID,
        },
      });
      nextState[item.identifier] = {
        identifier: item.identifier,
        reminderId: item.identifier,
        fireAtMs: item.fireAtMs,
        title: item.title,
        notes: item.body,
        strikeDateIso: item.strikeDateIso,
        strikeEventId: item.strikeEventId,
      };
      scheduledCount += 1;
    } catch {}
  }

  await Promise.all([
    AsyncStorage.setItem(STRIKE_STATE_KEY, JSON.stringify(nextState)).catch(
      () => {},
    ),
    AsyncStorage.setItem(
      STRIKE_DISPATCH_LOG_KEY,
      JSON.stringify(updatedDispatchLog),
    ).catch(() => {}),
  ]);

  return {
    enabled: true,
    notify7DaysBefore: alertPrefs.notify7DaysBefore,
    notify1DayBefore: alertPrefs.notify1DayBefore,
    permissionGranted: true,
    canAskAgain: currentPerms.canAskAgain ?? true,
    scheduledCount,
    upcomingImpactingCount,
    backend: 'notifications',
  };
}

export async function getStrikeNotificationsEnabled(): Promise<boolean> {
  const config = await getCommuterConfig();
  const prefs = resolveAlertPrefs(config);
  return prefs.notify7DaysBefore || prefs.notify1DayBefore;
}

export async function setStrikeAlertPreferences(
  nextPrefs: Partial<StrikeAlertPreferences>,
): Promise<StrikeNotificationsStatus> {
  const current = await getCommuterConfig();
  const merged: StrikeAlertPreferences = {
    ...resolveAlertPrefs(current),
    ...nextPrefs,
  };
  await saveCommuterConfig({ strikeAlerts: merged });
  return syncStrikeNotifications(undefined, {
    promptIfNeeded: merged.notify7DaysBefore || merged.notify1DayBefore,
  });
}

export async function setStrikeNotificationsEnabled(
  enabled: boolean,
): Promise<StrikeNotificationsStatus> {
  return setStrikeAlertPreferences({
    notify7DaysBefore: enabled,
    notify1DayBefore: enabled,
  });
}

export async function getStrikeNotificationsStatus(
  disruptionsInput?: DisruptionEvent[],
): Promise<StrikeNotificationsStatus> {
  const [config, events] = await Promise.all([
    getCommuterConfig(),
    disruptionsInput ? Promise.resolve(disruptionsInput) : getDisruptions(),
  ]);
  const prefs = resolveAlertPrefs(config);
  const arrivalStationName =
    config.arrivalStation?.shortName || config.arrivalStation?.name || undefined;
  const upcomingImpactingCount = config.enabled
    ? events.filter((ev) => isStrikeEventImpactingRoute(ev, arrivalStationName))
        .length
    : 0;

  if (Platform.OS === 'ios') {
    const isAvail = await Calendar.isAvailableAsync().catch(() => false);
    const perm = isAvail
      ? await Calendar.getRemindersPermissionsAsync().catch(() => ({
          granted: false,
          canAskAgain: true,
          status: 'undetermined' as const,
        }))
      : { granted: false, canAskAgain: false, status: 'denied' as const };
    const storedState = await readJsonStorage<
      Record<string, StoredReminderStateEntry>
    >(STRIKE_STATE_KEY, {});
    let scheduledCount = Object.keys(storedState).length;
    if (isAvail && perm.status === 'granted') {
      const { writableCalendarIds } = await resolveIosTargetRemindersCalendar();
      const managed = await fetchManagedIosReminders(
        writableCalendarIds,
        storedState,
      );
      scheduledCount = managed.filter((r) => !r.completed).length;
    }
    return {
      enabled: prefs.notify7DaysBefore || prefs.notify1DayBefore,
      notify7DaysBefore: prefs.notify7DaysBefore,
      notify1DayBefore: prefs.notify1DayBefore,
      permissionGranted: perm.status === 'granted',
      canAskAgain: perm.canAskAgain ?? true,
      scheduledCount,
      upcomingImpactingCount,
      backend: 'reminders',
    };
  }

  const perm = await Notifications.getPermissionsAsync().catch(() => ({
    granted: false,
    canAskAgain: true,
    status: Notifications.PermissionStatus.UNDETERMINED,
    expires: 'never' as const,
  }));
  let scheduledCount = 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    scheduledCount = all.filter((req) =>
      req.identifier.startsWith(STRIKE_NOTIFICATION_PREFIX),
    ).length;
  } catch {}
  return {
    enabled: prefs.notify7DaysBefore || prefs.notify1DayBefore,
    notify7DaysBefore: prefs.notify7DaysBefore,
    notify1DayBefore: prefs.notify1DayBefore,
    permissionGranted: isAndroidNotificationPermissionGranted(perm),
    canAskAgain: perm.canAskAgain ?? true,
    scheduledCount,
    upcomingImpactingCount,
    backend: 'notifications',
  };
}

async function runSyncStrikeNotifications(
  disruptionsInput?: DisruptionEvent[],
  options?: { promptIfNeeded?: boolean },
): Promise<StrikeNotificationsStatus> {
  const [config, events] = await Promise.all([
    getCommuterConfig(),
    disruptionsInput ? Promise.resolve(disruptionsInput) : getDisruptions(),
  ]);
  const alertPrefs = resolveAlertPrefs(config);

  const status =
    Platform.OS === 'ios'
      ? await syncIosStrikeReminders(config, alertPrefs, events, options)
      : await syncAndroidStrikeNotifications(config, alertPrefs, events, options);

  notifyStatusListeners(status);
  return status;
}

export function syncStrikeNotifications(
  disruptionsInput?: DisruptionEvent[],
  options?: { promptIfNeeded?: boolean },
): Promise<StrikeNotificationsStatus> {
  const next = syncQueue
    .catch(() => {})
    .then(() => runSyncStrikeNotifications(disruptionsInput, options));
  syncQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
