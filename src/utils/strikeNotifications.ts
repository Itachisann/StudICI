import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { StudICIAlarms } from '../../modules/studici-alarms/src';
import { CommuterConfig, StrikeAlertPreferences } from '../types/commuter';
import { DisruptionCategory, DisruptionEvent } from '../types/disruptions';
import { resolveActiveSchedule } from './alarmSync';
import {
  DEFAULT_STRIKE_ALERTS,
  getCommuterConfig,
  saveCommuterConfig,
} from './commuterStorage';
import {
  doesDisruptionOverlapMinutesForDate,
  formatDisruptionModalTimeWindow,
  formatTrainStrikeBannerSummary,
  getDisruptions,
  isTrainStrikeImpactingCommuter,
  isWalkDisruptionImpactingCommuter,
  parseDisruptionSchedule,
} from './disruptionsService';
import {
  buildExcludedIdSet,
  getExcludedLessons,
  isLessonExcluded,
  jsDayToScheduleDayIndex,
} from './excludedLessons';
import {
  getManualEvents,
  isManualEventActiveOnDate,
  ManualClassEvent,
  manualEventToClassEvent,
} from './manualEvents';
import { ClassEvent, ScheduleData } from './scraper';
import { parseTimeToMinutes } from './trenitaliaApi';

export const STRIKE_NOTIFICATION_PREFIX = 'studici_strike_';
const LEGACY_REMINDER_TAG_PREFIX = '[StudICI-Sciopero:';
const STRIKE_REMINDER_URL_BASE = 'studici://viaggio';
const STRIKE_CHANNEL_ID = 'strikes';
const STRIKE_STATE_KEY = 'studici_strike_reminders_state_v2';
const STRIKE_DISPATCH_LOG_KEY = 'studici_strike_notifications_log_v1';
const STRIKE_PERMISSION_ASKED_KEY = 'studici_strike_reminders_perm_asked_v2';
const LEGACY_NOTIFS_CLEANED_KEY = 'studici_strike_legacy_notifs_cleaned_v1';

const MAX_SCHEDULED_STRIKE_ITEMS = 40;
const MAX_DAYS_PER_STRIKE = 14;
const REMINDER_DUE_HOUR_LOCAL = 9;
const REMINDER_DUE_MINUTE_LOCAL = 0;
const STRIKE_REMINDER_PRIORITY_HIGH = 1;
const OFFSET_7D_MINUTES = -7 * 24 * 60;
const OFFSET_1D_MINUTES = -24 * 60;
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
  priority?: number;
  offsetsSignature?: string;
}

interface CommuteScheduleContext {
  tabUrl: string | null;
  schedule: ScheduleData | null;
  excludedSet: Set<string>;
  manualEvents: ManualClassEvent[];
  hasKnownSchedule: boolean;
}

interface AffectedStrikeCommuteDay {
  strikeKey: string;
  event: DisruptionEvent;
  commuteDateIso: string;
  firstLessonStartTime?: string;
  lastLessonEndTime?: string;
}

interface PlannedIosStrikeReminder {
  identifier: string;
  strikeKey: string;
  commuteDateIso: string;
  dueDateMs: number;
  title: string;
  notes: string;
  url: string;
  priority: number;
  alarmRelativeOffsetsMinutes: number[];
  offsetsSignature: string;
  strikeEventId: string;
  strikeCategory: DisruptionCategory;
}

interface PlannedAndroidStrikeNotification {
  identifier: string;
  leadDays: 7 | 1;
  strikeKey: string;
  fireAtMs: number;
  title: string;
  body: string;
  strikeEventId: string;
  commuteDateIso: string;
  strikeCategory: DisruptionCategory;
}

interface ManagedIosReminder {
  id: string;
  title: string;
  notes: string;
  url: string;
  completed: boolean;
  priority?: number;
  dueDateMs?: number;
  alarmOffsetsMinutes?: number[];
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

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatItalianIsoDate(iso: string): string {
  const parts = parseIsoDateParts(iso);
  if (!parts) return iso;
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

function enumerateStrikeIsoDates(startIso: string, endIso: string): string[] {
  const startParts = parseIsoDateParts(startIso);
  if (!startParts) return [];
  const endParts = parseIsoDateParts(endIso) || startParts;
  const startDt = new Date(startParts.year, startParts.month - 1, startParts.day, 12, 0, 0);
  const endDt = new Date(endParts.year, endParts.month - 1, endParts.day, 12, 0, 0);
  const safeEnd = endDt >= startDt ? endDt : startDt;

  const dates: string[] = [];
  const cursor = new Date(startDt);
  for (let i = 0; i < MAX_DAYS_PER_STRIKE && cursor <= safeEnd; i++) {
    dates.push(formatLocalIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

function parseNormalizedClockMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const normalized = timeStr.trim().replace('.', ':');
  if (!normalized.includes(':')) return null;
  const mins = parseTimeToMinutes(normalized);
  return Number.isFinite(mins) && mins >= 0 ? mins : null;
}

function buildStrikeTitle(category: DisruptionCategory): string {
  return category === 'sciopero_treni' ? 'Sciopero treni' : 'Sciopero mezzi TPL';
}

function stripSquareBracketMetadata(text: string): string {
  return text.replace(/\s*\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function buildReminderNotes(
  event: DisruptionEvent,
  commuteDateIso: string,
  firstLessonStartTime?: string,
  lastLessonEndTime?: string,
): string {
  const isTrain = event.category === 'sciopero_treni';
  const summaryRaw = isTrain
    ? formatTrainStrikeBannerSummary(event, commuteDateIso)
    : formatDisruptionModalTimeWindow(event);
  const summary = stripSquareBracketMetadata(summaryRaw || '');
  const dateLabel = formatItalianIsoDate(commuteDateIso);
  const lessonSpan =
    firstLessonStartTime && lastLessonEndTime
      ? ` (lezioni ${firstLessonStartTime} - ${lastLessonEndTime})`
      : '';

  if (isTrain) {
    const line1 = summary
      ? `Impatta la tua tratta ferroviaria del ${dateLabel}${lessonSpan}: ${summary}.`
      : `Impatta la tua tratta ferroviaria del ${dateLabel}${lessonSpan}.`;
    return `${line1}\nControlla orari e corse garantite in StudICI.`;
  }

  const line1 = summary
    ? `Impatta il tuo percorso urbano del ${dateLabel}${lessonSpan}: ${summary}.`
    : `Impatta il tuo percorso urbano del ${dateLabel}${lessonSpan}.`;
  return `${line1}\nVerifica il tragitto in StudICI.`;
}

async function loadCommuteScheduleContext(): Promise<CommuteScheduleContext> {
  const { degreeUrl, tabUrl, schedule } = await resolveActiveSchedule().catch(() => ({
    degreeUrl: null,
    tabUrl: null,
    schedule: null,
  }));

  const [excludedRecords, manualEvents] = await Promise.all([
    getExcludedLessons(degreeUrl || undefined).catch(() => []),
    getManualEvents(degreeUrl || undefined).catch(() => []),
  ]);

  const excludedSet = buildExcludedIdSet(excludedRecords);
  const hasScheduleDays = Boolean(
    schedule &&
      Array.isArray(schedule.days) &&
      schedule.days.some((d) => Array.isArray(d) && d.length > 0),
  );

  return {
    tabUrl,
    schedule,
    excludedSet,
    manualEvents,
    hasKnownSchedule: hasScheduleDays || manualEvents.length > 0,
  };
}

/**
 * Determina i soli giorni di calendario dello sciopero in cui il pendolare
 * ha effettivamente lezioni attive (non escluse) la cui tratta andata/ritorno
 * si sovrappone alla fascia oraria dello sciopero.
 */
function buildAffectedStrikeCommuteDays(
  events: DisruptionEvent[],
  config: CommuterConfig,
  ctx: CommuteScheduleContext,
  todayIso: string,
): {
  affectedDays: AffectedStrikeCommuteDay[];
  upcomingImpactingCount: number;
} {
  if (!config.enabled) {
    return { affectedDays: [], upcomingImpactingCount: 0 };
  }

  const arrivalStationName =
    config.arrivalStation?.shortName || config.arrivalStation?.name || undefined;

  const uniqueByKey = new Map<string, DisruptionEvent>();
  for (const ev of events) {
    if (!isStrikeEventImpactingRoute(ev, arrivalStationName)) continue;
    const key = computeStableStrikeKey(ev);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, ev);
    }
  }

  const affectedDays: AffectedStrikeCommuteDay[] = [];
  const impactingStrikeKeys = new Set<string>();

  for (const [strikeKey, ev] of uniqueByKey.entries()) {
    const parsedSchedule = parseDisruptionSchedule(ev);
    const candidateDates = enumerateStrikeIsoDates(
      parsedSchedule.startDateIso,
      parsedSchedule.endDateIso,
    );
    const isTrain = ev.category === 'sciopero_treni';
    const fallbackDurationMins = isTrain ? undefined : 180;

    for (const dateIso of candidateDates) {
      if (dateIso < todayIso) continue;

      const parts = parseIsoDateParts(dateIso);
      if (!parts) continue;
      const localNoon = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
      const dayIndex = jsDayToScheduleDayIndex(localNoon.getDay());

      let commuteLegs: { startMins: number; endMins: number }[] = [];
      let firstLessonStartTime: string | undefined;
      let lastLessonEndTime: string | undefined;

      if (ctx.hasKnownSchedule) {
        const officialClasses: ClassEvent[] = (
          ctx.schedule?.days?.[dayIndex] || []
        ).filter((c) => Boolean(c && c.startTime) && !isLessonExcluded(dayIndex, c, ctx.excludedSet));

        const manualClasses: ClassEvent[] = ctx.manualEvents
          .filter((m) => {
            if (m.tabUrl && ctx.tabUrl && m.tabUrl !== ctx.tabUrl) return false;
            return isManualEventActiveOnDate(m, dateIso);
          })
          .map(manualEventToClassEvent)
          .filter((c) => Boolean(c && c.startTime) && !isLessonExcluded(dayIndex, c, ctx.excludedSet));

        const activeClasses = [...officialClasses, ...manualClasses];
        if (activeClasses.length === 0) {
          continue;
        }

        const parsedClasses = activeClasses
          .map((c) => {
            const s = parseNormalizedClockMinutes(c.startTime);
            if (s === null) return null;
            const eRaw = parseNormalizedClockMinutes(c.endTime);
            const e = eRaw !== null && eRaw > s ? eRaw : Math.min(1440, s + 120);
            return {
              startMins: s,
              endMins: e,
              startLabel: (c.startTime || '').trim().replace('.', ':'),
              endLabel: (c.endTime || '').trim().replace('.', ':'),
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (parsedClasses.length === 0) {
          continue;
        }

        let earliest = parsedClasses[0];
        let latest = parsedClasses[0];
        for (const item of parsedClasses) {
          if (item.startMins < earliest.startMins) earliest = item;
          if (item.endMins > latest.endMins) latest = item;
        }

        firstLessonStartTime = earliest.startLabel;
        lastLessonEndTime = latest.endLabel || earliest.startLabel;

        if (isTrain) {
          commuteLegs = [
            { startMins: Math.max(0, earliest.startMins - 150), endMins: earliest.startMins },
            { startMins: latest.endMins, endMins: Math.min(1440, latest.endMins + 120) },
          ];
        } else {
          commuteLegs = [
            { startMins: Math.max(0, earliest.startMins - 75), endMins: earliest.startMins },
            { startMins: latest.endMins, endMins: Math.min(1440, latest.endMins + 90) },
          ];
        }
      } else {
        // Fallback prudenziale Lun-Ven se la cache orario non è ancora stata scaricata
        if (dayIndex > 4) continue;
        commuteLegs = isTrain
          ? [
              { startMins: 390, endMins: 570 }, // 06:30 - 09:30
              { startMins: 780, endMins: 1170 }, // 13:00 - 19:30
            ]
          : [
              { startMins: 450, endMins: 570 },
              { startMins: 780, endMins: 1140 },
            ];
      }

      const overlaps = commuteLegs.some((leg) =>
        doesDisruptionOverlapMinutesForDate(
          ev,
          dateIso,
          leg.startMins,
          leg.endMins,
          fallbackDurationMins,
        ),
      );

      if (!overlaps) continue;

      impactingStrikeKeys.add(strikeKey);
      affectedDays.push({
        strikeKey,
        event: ev,
        commuteDateIso: dateIso,
        firstLessonStartTime,
        lastLessonEndTime,
      });
    }
  }

  affectedDays.sort((a, b) => a.commuteDateIso.localeCompare(b.commuteDateIso));
  return {
    affectedDays: affectedDays.slice(0, MAX_SCHEDULED_STRIKE_ITEMS),
    upcomingImpactingCount: impactingStrikeKeys.size,
  };
}

function buildReminderRelativeOffsetsMinutes(
  dueDateMs: number,
  alertPrefs: StrikeAlertPreferences,
  nowMs: number,
): number[] {
  const is7dUpcoming = dueDateMs - 7 * 24 * 60 * 60 * 1000 > nowMs - 60_000;
  const is1dUpcoming = dueDateMs - 24 * 60 * 60 * 1000 > nowMs - 60_000;

  // Se i -7 giorni sono ancora futuri e l'opzione è attiva, usa -7g;
  // se i -7 giorni sono già passati, vale solo il -1g (se attivo e futuro).
  if (alertPrefs.notify7DaysBefore && is7dUpcoming) {
    return [OFFSET_7D_MINUTES];
  }

  if (alertPrefs.notify1DayBefore && is1dUpcoming) {
    return [OFFSET_1D_MINUTES];
  }

  return [];
}

function computeOffsetsSignature(offsets: number[]): string {
  return [...offsets].sort((a, b) => a - b).join(',');
}

function buildIosStrikeReminderPlans(
  events: DisruptionEvent[],
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  ctx: CommuteScheduleContext,
  nowMs: number,
): {
  planned: PlannedIosStrikeReminder[];
  upcomingImpactingCount: number;
} {
  const todayIso = formatLocalIsoDate(new Date(nowMs));
  const { affectedDays, upcomingImpactingCount } = buildAffectedStrikeCommuteDays(
    events,
    config,
    ctx,
    todayIso,
  );

  const planned: PlannedIosStrikeReminder[] = [];
  for (const day of affectedDays) {
    const parts = parseIsoDateParts(day.commuteDateIso);
    if (!parts) continue;
    const dueDateMs = new Date(
      parts.year,
      parts.month - 1,
      parts.day,
      REMINDER_DUE_HOUR_LOCAL,
      REMINDER_DUE_MINUTE_LOCAL,
      0,
      0,
    ).getTime();

    const identifier = `${STRIKE_NOTIFICATION_PREFIX}${day.strikeKey}_${day.commuteDateIso}`;
    const url = `${STRIKE_REMINDER_URL_BASE}?strikeAlert=${encodeURIComponent(identifier)}`;
    const offsets = buildReminderRelativeOffsetsMinutes(dueDateMs, alertPrefs, nowMs);

    planned.push({
      identifier,
      strikeKey: day.strikeKey,
      commuteDateIso: day.commuteDateIso,
      dueDateMs,
      title: buildStrikeTitle(day.event.category),
      notes: buildReminderNotes(
        day.event,
        day.commuteDateIso,
        day.firstLessonStartTime,
        day.lastLessonEndTime,
      ),
      url,
      priority: STRIKE_REMINDER_PRIORITY_HIGH,
      alarmRelativeOffsetsMinutes: offsets,
      offsetsSignature: computeOffsetsSignature(offsets),
      strikeEventId: day.event.id,
      strikeCategory: day.event.category,
    });
  }

  planned.sort((a, b) => a.dueDateMs - b.dueDateMs);
  return {
    planned: planned.slice(0, MAX_SCHEDULED_STRIKE_ITEMS),
    upcomingImpactingCount,
  };
}

function buildAndroidStrikeAlertPlans(
  events: DisruptionEvent[],
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  ctx: CommuteScheduleContext,
  nowMs: number,
  previousDispatchLog: Record<string, number>,
): {
  planned: PlannedAndroidStrikeNotification[];
  updatedDispatchLog: Record<string, number>;
  upcomingImpactingCount: number;
} {
  const nowDate = new Date(nowMs);
  const todayIso = formatLocalIsoDate(nowDate);
  const { affectedDays, upcomingImpactingCount } = buildAffectedStrikeCommuteDays(
    events,
    config,
    ctx,
    todayIso,
  );

  const updatedDispatchLog: Record<string, number> = {};
  for (const [k, ts] of Object.entries(previousDispatchLog)) {
    if (typeof ts === 'number' && nowMs - ts < LOG_RETENTION_MS) {
      updatedDispatchLog[k] = ts;
    }
  }

  const activeLeads: (7 | 1)[] = [];
  if (alertPrefs.notify7DaysBefore) activeLeads.push(7);
  if (alertPrefs.notify1DayBefore) activeLeads.push(1);

  const planned: PlannedAndroidStrikeNotification[] = [];
  for (const day of affectedDays) {
    const parts = parseIsoDateParts(day.commuteDateIso);
    if (!parts) continue;
    const daysUntilCommute = diffLocalCalendarDays(day.commuteDateIso, nowDate);
    const title = buildStrikeTitle(day.event.category);
    const notesBody = buildReminderNotes(
      day.event,
      day.commuteDateIso,
      day.firstLessonStartTime,
      day.lastLessonEndTime,
    );

    for (const leadDays of activeLeads) {
      const targetLocalDate = new Date(
        parts.year,
        parts.month - 1,
        parts.day - leadDays,
        REMINDER_DUE_HOUR_LOCAL,
        REMINDER_DUE_MINUTE_LOCAL,
        0,
        0,
      );
      const nominalMs = targetLocalDate.getTime();
      const identifier = `${STRIKE_NOTIFICATION_PREFIX}${day.strikeKey}_${day.commuteDateIso}_${leadDays}d`;

      let fireAtMs: number | null = null;
      if (nominalMs > nowMs + MIN_FUTURE_MARGIN_MS) {
        fireAtMs = nominalMs;
      } else if (
        isSameLocalCalendarDay(nowDate, targetLocalDate) &&
        nowDate.getHours() < 22 &&
        !(leadDays === 7 && daysUntilCommute !== null && daysUntilCommute <= 1)
      ) {
        const existingLogTs = updatedDispatchLog[identifier];
        if (typeof existingLogTs === 'number') {
          if (existingLogTs > nowMs + 2_000) {
            fireAtMs = existingLogTs;
          }
        } else {
          fireAtMs = nowMs + CATCHUP_DELAY_ANDROID_MS;
          updatedDispatchLog[identifier] = fireAtMs;
        }
      }

      if (fireAtMs === null) continue;
      planned.push({
        identifier,
        leadDays,
        strikeKey: day.strikeKey,
        fireAtMs,
        title,
        body: notesBody,
        strikeEventId: day.event.id,
        commuteDateIso: day.commuteDateIso,
        strikeCategory: day.event.category,
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

function extractStrikeIdentifierFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]strikeAlert=([^&]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function extractLegacyStrikeIdentifierFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const escapedPrefix = LEGACY_REMINDER_TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function isManagedReminderCandidate(
  url: string | undefined,
  notes: string | undefined,
  id: string | undefined,
  managedIds: Set<string>,
): boolean {
  return (
    Boolean(extractStrikeIdentifierFromUrl(url)) ||
    Boolean(extractLegacyStrikeIdentifierFromNotes(notes)) ||
    (id ? managedIds.has(id) : false)
  );
}

async function fetchManagedIosReminders(
  writableCalendarIds: (string | null)[],
  storedState: Record<string, StoredReminderStateEntry>,
): Promise<ManagedIosReminder[]> {
  const managedIds = new Set(Object.values(storedState).map((e) => e.reminderId));

  if (typeof StudICIAlarms?.getStrikeReminders === 'function') {
    try {
      const nativeList = await StudICIAlarms.getStrikeReminders();
      return nativeList
        .filter((rem) =>
          isManagedReminderCandidate(rem.url, rem.notes, rem.id, managedIds),
        )
        .map((rem) => ({
          id: rem.id,
          title: rem.title,
          notes: rem.notes,
          url: rem.url,
          completed: rem.completed,
          priority: rem.priority,
          dueDateMs: rem.dueDateMs,
          alarmOffsetsMinutes: rem.alarmOffsetsMinutes,
        }));
    } catch {
      // Fallback a expo-calendar in caso di errore nativo
    }
  }

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

  return allReminders
    .filter((rem) =>
      isManagedReminderCandidate(rem.url, rem.notes, rem.id, managedIds),
    )
    .map((rem) => ({
      id: rem.id || '',
      title: rem.title || '',
      notes: rem.notes || '',
      url: rem.url || '',
      completed: Boolean(rem.completed),
      dueDateMs: rem.dueDate ? new Date(rem.dueDate).getTime() : undefined,
      alarmOffsetsMinutes: Array.isArray(rem.alarms)
        ? rem.alarms
            .map((a) => {
              if (typeof a.relativeOffset === 'number' && Math.round(a.relativeOffset) < 0) {
                return Math.round(a.relativeOffset);
              }
              if (a.absoluteDate && rem.dueDate) {
                const diffMin = Math.round(
                  (new Date(a.absoluteDate).getTime() - new Date(rem.dueDate).getTime()) /
                    60_000,
                );
                if (diffMin < -1) return diffMin;
              }
              return null;
            })
            .filter((n): n is number => n !== null)
            .sort((a, b) => a - b)
        : undefined,
    }))
    .filter((rem) => Boolean(rem.id));
}

async function deleteIosReminderById(reminderId: string): Promise<void> {
  if (!reminderId) return;
  if (typeof StudICIAlarms?.deleteStrikeReminder === 'function') {
    const ok = await StudICIAlarms.deleteStrikeReminder(reminderId).catch(() => false);
    if (ok) return;
  }
  await Calendar.deleteReminderAsync(reminderId).catch(() => {});
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
        await deleteIosReminderById(rem.id);
      }
    }
  } catch {}
  await AsyncStorage.removeItem(STRIKE_STATE_KEY).catch(() => {});
}

function isIosReminderUnchanged(
  existing: ManagedIosReminder | undefined,
  prevStored: StoredReminderStateEntry | undefined,
  plan: PlannedIosStrikeReminder,
): boolean {
  if (!existing?.id) return false;
  if (existing.title !== plan.title) return false;
  if ((existing.notes || '') !== plan.notes) return false;
  if ((existing.url || '') !== plan.url) return false;

  const dueMatches =
    (typeof existing.dueDateMs === 'number' &&
      Number.isFinite(existing.dueDateMs) &&
      Math.abs(existing.dueDateMs - plan.dueDateMs) <= 60_000) ||
    (Boolean(prevStored) && Math.abs(prevStored!.fireAtMs - plan.dueDateMs) <= 60_000);
  if (!dueMatches) return false;

  const nativePriorityAvailable = typeof existing.priority === 'number';
  if (nativePriorityAvailable && existing.priority !== plan.priority) {
    return false;
  }

  if (Array.isArray(existing.alarmOffsetsMinutes)) {
    const existingSig = computeOffsetsSignature(existing.alarmOffsetsMinutes);
    if (existingSig !== plan.offsetsSignature) {
      return false;
    }
  } else if (prevStored?.offsetsSignature !== plan.offsetsSignature) {
    return false;
  }

  return true;
}

async function syncIosStrikeReminders(
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  events: DisruptionEvent[],
  ctx: CommuteScheduleContext,
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

  const { planned, upcomingImpactingCount } = buildIosStrikeReminderPlans(
    events,
    config,
    alertPrefs,
    ctx,
    Date.now(),
  );

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

  const existingByIdentifier = new Map<string, ManagedIosReminder[]>();
  const completedIdentifiers = new Set<string>();

  for (const rem of managedReminders) {
    let identifier =
      extractStrikeIdentifierFromUrl(rem.url) ||
      extractLegacyStrikeIdentifierFromNotes(rem.notes);
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

  const desiredMap = new Map<string, PlannedIosStrikeReminder>();
  for (const item of planned) {
    desiredMap.set(item.identifier, item);
  }

  // Elimina promemoria obsoleti (inclusi i vecchi taggati con [...] o giorni non pendolari)
  for (const [identifier, bucket] of existingByIdentifier.entries()) {
    if (!desiredMap.has(identifier)) {
      for (const rem of bucket) {
        if (rem.id) {
          await deleteIosReminderById(rem.id);
        }
      }
      existingByIdentifier.delete(identifier);
    }
  }

  const timeZoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextState: Record<string, StoredReminderStateEntry> = {};
  let scheduledCount = 0;

  for (const item of planned) {
    if (completedIdentifiers.has(item.identifier)) {
      continue;
    }

    const bucket = existingByIdentifier.get(item.identifier) || [];
    const primaryExisting = bucket[0];
    for (let i = 1; i < bucket.length; i++) {
      const dup = bucket[i];
      if (dup?.id) {
        await deleteIosReminderById(dup.id);
      }
    }

    const prevStored = storedState[item.identifier];
    if (isIosReminderUnchanged(primaryExisting, prevStored, item) && primaryExisting?.id) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        reminderId: primaryExisting.id,
        fireAtMs: item.dueDateMs,
        title: item.title,
        notes: item.notes,
        strikeDateIso: item.commuteDateIso,
        strikeEventId: item.strikeEventId,
        priority: item.priority,
        offsetsSignature: item.offsetsSignature,
      };
      scheduledCount += 1;
      continue;
    }

    let finalReminderId: string | null = null;

    if (typeof StudICIAlarms?.upsertStrikeReminder === 'function') {
      try {
        finalReminderId = await StudICIAlarms.upsertStrikeReminder({
          existingId: primaryExisting?.id,
          calendarId: targetCalendarId || '',
          title: item.title,
          notes: item.notes,
          url: item.url,
          dueDateMs: item.dueDateMs,
          timeZoneId,
          priority: item.priority,
          alarmRelativeOffsetsMinutes: item.alarmRelativeOffsetsMinutes,
        });
      } catch (err) {
        console.warn('[StrikeReminders] Errore upsert nativo promemoria:', err);
      }
    }

    if (!finalReminderId) {
      const dueDate = new Date(item.dueDateMs);
      const fallbackAlarms: Calendar.Alarm[] = [
        { absoluteDate: dueDate.toISOString() },
        ...item.alarmRelativeOffsetsMinutes
          .filter((offsetMin) => offsetMin < 0)
          .map((offsetMin) => ({ relativeOffset: offsetMin })),
      ];
      const baseReminderPayload: Calendar.Reminder = {
        title: item.title,
        notes: item.notes,
        startDate: dueDate,
        dueDate,
        allDay: false,
        url: item.url,
        completed: false,
      };

      if (primaryExisting?.id) {
        await Calendar.deleteReminderAsync(primaryExisting.id).catch(() => {});
      }

      try {
        finalReminderId = await Calendar.createReminderAsync(
          targetCalendarId,
          baseReminderPayload,
        );
        if (finalReminderId) {
          await Calendar.updateReminderAsync(finalReminderId, {
            title: item.title,
            notes: item.notes,
            url: item.url,
            alarms: fallbackAlarms,
          });
        }
      } catch (err) {
        console.warn('[StrikeReminders] Errore creazione promemoria:', err);
      }
    }

    if (finalReminderId) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        reminderId: finalReminderId,
        fireAtMs: item.dueDateMs,
        title: item.title,
        notes: item.notes,
        strikeDateIso: item.commuteDateIso,
        strikeEventId: item.strikeEventId,
        priority: item.priority,
        offsetsSignature: item.offsetsSignature,
      };
      scheduledCount += 1;
    }
  }

  await AsyncStorage.setItem(STRIKE_STATE_KEY, JSON.stringify(nextState)).catch(
    () => {},
  );

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
  ctx: CommuteScheduleContext,
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
    buildAndroidStrikeAlertPlans(
      events,
      config,
      alertPrefs,
      ctx,
      Date.now(),
      dispatchLog,
    );

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
            strikeStartDate: item.commuteDateIso,
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
        strikeDateIso: item.commuteDateIso,
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
  const [config, events, ctx] = await Promise.all([
    getCommuterConfig(),
    disruptionsInput ? Promise.resolve(disruptionsInput) : getDisruptions(),
    loadCommuteScheduleContext(),
  ]);
  const prefs = resolveAlertPrefs(config);
  const todayIso = formatLocalIsoDate(new Date());
  const { upcomingImpactingCount } = buildAffectedStrikeCommuteDays(
    events,
    config,
    ctx,
    todayIso,
  );

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
  const [config, events, ctx] = await Promise.all([
    getCommuterConfig(),
    disruptionsInput ? Promise.resolve(disruptionsInput) : getDisruptions(),
    loadCommuteScheduleContext(),
  ]);
  const alertPrefs = resolveAlertPrefs(config);

  const status =
    Platform.OS === 'ios'
      ? await syncIosStrikeReminders(config, alertPrefs, events, ctx, options)
      : await syncAndroidStrikeNotifications(config, alertPrefs, events, ctx, options);

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
