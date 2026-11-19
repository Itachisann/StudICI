import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { StudICIAlarms } from "../../modules/studici-alarms/src";
import { CommuterConfig, StrikeAlertPreferences } from "../types/commuter";
import { DisruptionCategory, DisruptionEvent } from "../types/disruptions";
import { resolveActiveSchedule } from "./alarmSync";
import {
  DEFAULT_STRIKE_ALERTS,
  getCommuterConfig,
  saveCommuterConfig,
} from "./commuterStorage";
import {
  doesDisruptionOverlapMinutesForDate,
  formatDisruptionModalTimeWindow,
  formatTrainStrikeBannerSummary,
  getDisruptions,
  isTrainStrikeImpactingCommuter,
  isWalkDisruptionImpactingCommuter,
  parseDisruptionSchedule,
} from "./disruptionsService";
import {
  buildExcludedIdSet,
  getExcludedLessons,
  isLessonExcluded,
  jsDayToScheduleDayIndex,
} from "./excludedLessons";
import {
  getManualEvents,
  isManualEventActiveOnDate,
  ManualClassEvent,
  manualEventToClassEvent,
} from "./manualEvents";
import { ClassEvent, ScheduleData } from "./scraper";
import { parseTimeToMinutes } from "./trenitaliaApi";
import {
  ensureManagedStrikeCalendar,
  getManagedStrikeCalendarsSnapshot,
  markStrikesCalendarSynced,
} from "./appleCalendar";

export const STRIKE_NOTIFICATION_PREFIX = "studici_strike_";
const LEGACY_REMINDER_TAG_PREFIX = "[StudICI-Sciopero:";
const STRIKE_EVENT_URL_BASE = "studici://viaggio";
const STRIKE_CHANNEL_ID = "strikes";

const LEGACY_REMINDER_STATE_KEY = "studici_strike_reminders_state_v2";
const LEGACY_REMINDERS_CLEANED_KEY =
  "studici_strike_legacy_reminders_cleaned_v1";
const STRIKE_STATE_KEY = "studici_strike_calendar_state_v3";
const STRIKE_DISPATCH_LOG_KEY = "studici_strike_notifications_log_v1";
const STRIKE_PERMISSION_ASKED_KEY = "studici_strike_calendar_perm_asked_v3";
const LEGACY_NOTIFS_CLEANED_KEY = "studici_strike_legacy_notifs_cleaned_v1";

const MAX_SCHEDULED_STRIKE_ITEMS = 40;
const MAX_DAYS_PER_STRIKE = 14;
const REMINDER_DUE_HOUR_LOCAL = 9;
const REMINDER_DUE_MINUTE_LOCAL = 0;
// Su Apple Calendar per eventi tutto il giorno (startDate 00:00 locale):
// -9540 min = -6 giorni e 15 ore (7 giorni prima alle 09:00)
// -900 min  = -15 ore (1 giorno prima alle 09:00)
// +540 min  = +9 ore (09:00 del giorno stesso dell'evento, avviso predefinito se già oggi o dopo le 09:00 della vigilia)
const OFFSET_CALENDAR_7D_MINUTES = -(6 * 24 + 15) * 60;
const OFFSET_CALENDAR_1D_MINUTES = -15 * 60;
const OFFSET_CALENDAR_SAME_DAY_MINUTES = 9 * 60;
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
  backend: "calendar" | "notifications";
}

interface StoredStrikeStateEntry {
  identifier: string;
  eventId: string;
  calendarId?: string;
  fireAtMs: number;
  title: string;
  notes: string;
  strikeDateIso: string;
  strikeEventId: string;
  offsetsSignature?: string;
}

interface LegacyStoredReminderStateEntry {
  identifier: string;
  reminderId: string;
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

interface PlannedIosStrikeCalendarEvent {
  identifier: string;
  strikeKey: string;
  commuteDateIso: string;
  startDateMs: number;
  endDateMs: number;
  title: string;
  location: string;
  notes: string;
  url: string;
  alarmRelativeOffsetsMinutes: number[];
  offsetsSignature: string;
  strikeEventId: string;
  strikeCategory: DisruptionCategory;
}

interface PlannedAndroidStrikeNotification {
  identifier: string;
  leadDays: 7 | 1 | 0;
  strikeKey: string;
  fireAtMs: number;
  title: string;
  body: string;
  strikeEventId: string;
  commuteDateIso: string;
  strikeCategory: DisruptionCategory;
}

interface ManagedIosCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  location: string;
  notes: string;
  url: string;
  allDay: boolean;
  startDateMs: number;
  endDateMs: number;
  alarmOffsetsMinutes: number[];
}

let handlerInitialized = false;
let syncQueue: Promise<unknown> = Promise.resolve();

const statusListeners = new Set<(status: StrikeNotificationsStatus) => void>();
const tapListeners = new Set<(payload: StrikeNotificationTapPayload) => void>();
let pendingTapPayload: StrikeNotificationTapPayload | null = null;

export function ensureStrikeNotificationHandler(): void {
  if (handlerInitialized) return;
  handlerInitialized = true;
  if (Platform.OS === "ios") return;
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

export function emitStrikeNotificationTap(
  payload: StrikeNotificationTapPayload,
): void {
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
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
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
  ].join("|");
  return `${event.category}_${event.startDate}_${fnv1aHashHex(signature)}`;
}

export function isStrikeEventImpactingRoute(
  event: DisruptionEvent,
  arrivalStationName?: string,
): boolean {
  if (event.category === "sciopero_treni") {
    return isTrainStrikeImpactingCommuter(event);
  }
  if (
    event.category === "sciopero_tpl" ||
    event.category === "manifestazione"
  ) {
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

function parseIsoDateParts(
  iso: string,
): { year: number; month: number; day: number } | null {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return { year, month, day };
}

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatItalianIsoDate(iso: string): string {
  const parts = parseIsoDateParts(iso);
  if (!parts) return iso;
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
}

function enumerateStrikeIsoDates(startIso: string, endIso: string): string[] {
  const startParts = parseIsoDateParts(startIso);
  if (!startParts) return [];
  const endParts = parseIsoDateParts(endIso) || startParts;
  const startDt = new Date(
    startParts.year,
    startParts.month - 1,
    startParts.day,
    12,
    0,
    0,
  );
  const endDt = new Date(
    endParts.year,
    endParts.month - 1,
    endParts.day,
    12,
    0,
    0,
  );
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

function diffLocalCalendarDays(
  targetIso: string,
  refDate: Date,
): number | null {
  const parts = parseIsoDateParts(targetIso);
  if (!parts) return null;
  const targetMidnight = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    0,
    0,
    0,
    0,
  );
  const refMidnight = new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate(),
    0,
    0,
    0,
    0,
  );
  return Math.round(
    (targetMidnight.getTime() - refMidnight.getTime()) / (24 * 60 * 60 * 1000),
  );
}

function parseNormalizedClockMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const normalized = timeStr.trim().replace(".", ":");
  if (!normalized.includes(":")) return null;
  const mins = parseTimeToMinutes(normalized);
  return Number.isFinite(mins) && mins >= 0 ? mins : null;
}

function buildStrikeTitle(event: DisruptionEvent): string {
  if (event.category === "sciopero_treni") {
    return "Sciopero treni";
  }
  if (event.category === "sciopero_tpl") {
    return "Sciopero mezzi";
  }
  if (event.category === "manifestazione") {
    const clean = stripSquareBracketMetadata(event.title || "")
      .split(",")[0]
      .replace(
        /^(luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica)\s+/i,
        "",
      )
      .trim();
    if (!clean) return "Manifestazione";
    const condensed =
      clean.length > 52 ? `${clean.slice(0, 49).trim()}…` : clean;
    return /^manifestazi/i.test(condensed)
      ? condensed.charAt(0).toUpperCase() + condensed.slice(1)
      : `Manifestazione: ${condensed}`;
  }
  return "Avviso mobilità";
}

function stripSquareBracketMetadata(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatClockMinutes(mins: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(mins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDurationLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) {
    return `${hours} ${hours === 1 ? "ora" : "ore"}`;
  }
  if (hours === 0) {
    return `${mins} min`;
  }
  return `${hours} ${hours === 1 ? "ora" : "ore"} e ${mins} min`;
}

function resolveStrikeDurationLabel(event: DisruptionEvent): string {
  const sched = parseDisruptionSchedule(event);
  if (typeof sched.durationHours === "number" && sched.durationHours > 0) {
    return `${sched.durationHours} ${sched.durationHours === 1 ? "ora" : "ore"}`;
  }

  const startParts = parseIsoDateParts(sched.startDateIso);
  const endParts = parseIsoDateParts(sched.endDateIso);

  if (
    sched.hasExplicitRange &&
    sched.endHour !== undefined &&
    startParts &&
    endParts
  ) {
    const startMs = new Date(
      startParts.year,
      startParts.month - 1,
      startParts.day,
      sched.startHour,
      sched.startMinute,
      0,
      0,
    ).getTime();
    const endMs = new Date(
      endParts.year,
      endParts.month - 1,
      endParts.day,
      sched.endHour,
      sched.endMinute || 0,
      0,
      0,
    ).getTime();
    const diffMins = Math.round((endMs - startMs) / 60_000);
    if (diffMins > 0) {
      return formatDurationLabel(diffMins);
    }
  }

  if (sched.isFullDay && startParts && endParts) {
    const sMid = new Date(
      startParts.year,
      startParts.month - 1,
      startParts.day,
      12,
      0,
      0,
    ).getTime();
    const eMid = new Date(
      endParts.year,
      endParts.month - 1,
      endParts.day,
      12,
      0,
      0,
    ).getTime();
    const days = Math.max(
      1,
      Math.round((eMid - sMid) / (24 * 60 * 60 * 1000)) + 1,
    );
    return days === 1
      ? "Intera giornata (24 ore)"
      : `${days} giorni (intera prestazione)`;
  }

  return "";
}

function buildStrikeCalendarLocation(
  event: DisruptionEvent,
  config: CommuterConfig,
): string {
  const dep =
    config.departureStation?.shortName || config.departureStation?.name || "";
  const arr =
    config.arrivalStation?.shortName || config.arrivalStation?.name || "";
  if (event.category === "sciopero_treni") {
    if (dep && arr) return `${dep} ↔ ${arr}`;
    if (dep || arr) return dep || arr;
  } else if (
    event.category === "manifestazione" &&
    event.affectedAreas &&
    event.affectedAreas.length > 0
  ) {
    return `Roma (${event.affectedAreas.slice(0, 3).join(", ")})`;
  } else if (arr) {
    return `Roma (${arr} / Università)`;
  }
  return "Roma";
}

function buildStrikeCalendarNotes(event: DisruptionEvent): string {
  const isTrain = event.category === "sciopero_treni";
  const isManifestazione = event.category === "manifestazione";
  const sched = parseDisruptionSchedule(event);

  const timeWindowRaw =
    formatDisruptionModalTimeWindow(event) || event.timeWindow || "";
  const timeWindowClean = stripSquareBracketMetadata(timeWindowRaw);
  const durationLabel = resolveStrikeDurationLabel(event);

  const lines: string[] = [];

  if (isManifestazione && event.title?.trim()) {
    lines.push(`Evento: ${stripSquareBracketMetadata(event.title)}`);
  }

  if (durationLabel) {
    lines.push(`Durata: ${durationLabel}`);
  }
  if (timeWindowClean) {
    lines.push(`Orari: ${timeWindowClean}`);
  } else if (sched.hasStartTimeOnly) {
    lines.push(
      `Orario inizio: dalle ${formatClockMinutes(sched.startHour * 60 + sched.startMinute)}`,
    );
  } else {
    lines.push("Orari: Intera giornata (00:00 - 24:00)");
  }

  if (event.affectedAreas && event.affectedAreas.length > 0) {
    lines.push(`Zone: ${event.affectedAreas.join(", ")}`);
  }
  if (event.scope?.trim()) {
    lines.push(`Ambito: ${stripSquareBracketMetadata(event.scope)}`);
  }
  if (event.affectedCompanies?.trim()) {
    lines.push(
      `Settore: ${stripSquareBracketMetadata(event.affectedCompanies)}`,
    );
  }
  const extraModalita = stripSquareBracketMetadata(event.notes || "");
  if (
    extraModalita &&
    extraModalita.toLowerCase() !== timeWindowClean.toLowerCase()
  ) {
    lines.push(`Dettagli: ${extraModalita}`);
  }
  if (event.sourceName) {
    lines.push(`Fonte: ${event.sourceName}`);
  }

  lines.push(
    isTrain
      ? "Controlla orari e corse in StudICI."
      : "Verifica il tragitto e i mezzi alternativi in StudICI.",
  );

  return lines.join("\n");
}

function buildReminderNotes(
  event: DisruptionEvent,
  commuteDateIso: string,
  firstLessonStartTime?: string,
  lastLessonEndTime?: string,
): string {
  const isTrain = event.category === "sciopero_treni";
  const isManifestazione = event.category === "manifestazione";
  const summaryRaw = isTrain
    ? formatTrainStrikeBannerSummary(event, commuteDateIso)
    : formatDisruptionModalTimeWindow(event);
  const summary = stripSquareBracketMetadata(summaryRaw || "");
  const dateLabel = formatItalianIsoDate(commuteDateIso);
  const lessonSpan =
    firstLessonStartTime && lastLessonEndTime
      ? ` (lezioni ${firstLessonStartTime} - ${lastLessonEndTime})`
      : "";

  if (isTrain) {
    const line1 = summary
      ? `Impatta la tua tratta ferroviaria del ${dateLabel}${lessonSpan}: ${summary}.`
      : `Impatta la tua tratta ferroviaria del ${dateLabel}${lessonSpan}.`;
    return `${line1}\nControlla orari e corse garantite in StudICI.`;
  }

  const prefix = isManifestazione
    ? `Manifestazione sul percorso urbano del ${dateLabel}${lessonSpan}`
    : `Impatta il tuo percorso urbano del ${dateLabel}${lessonSpan}`;
  const line1 = summary ? `${prefix}: ${summary}.` : `${prefix}.`;
  return `${line1}\nVerifica il tragitto in StudICI.`;
}

async function loadCommuteScheduleContext(): Promise<CommuteScheduleContext> {
  const { degreeUrl, tabUrl, schedule } = await resolveActiveSchedule().catch(
    () => ({
      degreeUrl: null,
      tabUrl: null,
      schedule: null,
    }),
  );

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
    config.arrivalStation?.shortName ||
    config.arrivalStation?.name ||
    undefined;

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
    const isTrain = ev.category === "sciopero_treni";
    const fallbackDurationMins = isTrain ? undefined : 180;

    for (const dateIso of candidateDates) {
      if (dateIso < todayIso) continue;

      const parts = parseIsoDateParts(dateIso);
      if (!parts) continue;
      const localNoon = new Date(
        parts.year,
        parts.month - 1,
        parts.day,
        12,
        0,
        0,
      );
      const dayIndex = jsDayToScheduleDayIndex(localNoon.getDay());

      let commuteLegs: { startMins: number; endMins: number }[] = [];
      let firstLessonStartTime: string | undefined;
      let lastLessonEndTime: string | undefined;

      if (ctx.hasKnownSchedule) {
        const officialClasses: ClassEvent[] = (
          ctx.schedule?.days?.[dayIndex] || []
        ).filter(
          (c) =>
            Boolean(c && c.startTime) &&
            !isLessonExcluded(dayIndex, c, ctx.excludedSet),
        );

        const manualClasses: ClassEvent[] = ctx.manualEvents
          .filter((m) => {
            if (m.tabUrl && ctx.tabUrl && m.tabUrl !== ctx.tabUrl) return false;
            if (m.dayIndex !== dayIndex) return false;
            return isManualEventActiveOnDate(m, dateIso);
          })
          .map(manualEventToClassEvent)
          .filter(
            (c) =>
              Boolean(c && c.startTime) &&
              !isLessonExcluded(dayIndex, c, ctx.excludedSet),
          );

        const activeClasses = [...officialClasses, ...manualClasses];
        if (activeClasses.length === 0) {
          continue;
        }

        const parsedClasses = activeClasses
          .map((c) => {
            const s = parseNormalizedClockMinutes(c.startTime);
            if (s === null) return null;
            const eRaw = parseNormalizedClockMinutes(c.endTime);
            const e =
              eRaw !== null && eRaw > s ? eRaw : Math.min(1440, s + 120);
            return {
              startMins: s,
              endMins: e,
              startLabel: (c.startTime || "").trim().replace(".", ":"),
              endLabel: (c.endTime || "").trim().replace(".", ":"),
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
            {
              startMins: Math.max(0, earliest.startMins - 150),
              endMins: earliest.startMins,
            },
            {
              startMins: latest.endMins,
              endMins: Math.min(1440, latest.endMins + 120),
            },
          ];
        } else {
          commuteLegs = [
            {
              startMins: Math.max(0, earliest.startMins - 75),
              endMins: earliest.startMins,
            },
            {
              startMins: latest.endMins,
              endMins: Math.min(1440, latest.endMins + 90),
            },
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

function buildCalendarRelativeOffsetsMinutes(
  year: number,
  month: number,
  day: number,
  alertPrefs: StrikeAlertPreferences,
  nowMs: number,
): number[] {
  const offsets: number[] = [];
  const isAnyAlertEnabled =
    alertPrefs.notify7DaysBefore || alertPrefs.notify1DayBefore;

  if (alertPrefs.notify7DaysBefore) {
    const alert7dMs = new Date(
      year,
      month - 1,
      day - 7,
      REMINDER_DUE_HOUR_LOCAL,
      REMINDER_DUE_MINUTE_LOCAL,
      0,
      0,
    ).getTime();
    if (alert7dMs > nowMs - 60_000) {
      offsets.push(OFFSET_CALENDAR_7D_MINUTES);
    }
  }

  if (alertPrefs.notify1DayBefore) {
    const alert1dMs = new Date(
      year,
      month - 1,
      day - 1,
      REMINDER_DUE_HOUR_LOCAL,
      REMINDER_DUE_MINUTE_LOCAL,
      0,
      0,
    ).getTime();
    if (alert1dMs > nowMs - 60_000) {
      offsets.push(OFFSET_CALENDAR_1D_MINUTES);
    }
  }

  // Se l'evento viene inserito il giorno stesso (oggi) o dopo le 09:00 della vigilia
  // e nessun avviso anticipato cade più nel futuro, imposta l'avviso predefinito alle 09:00 del giorno dell'evento.
  if (isAnyAlertEnabled && offsets.length === 0) {
    offsets.push(OFFSET_CALENDAR_SAME_DAY_MINUTES);
  }

  return offsets;
}

function computeOffsetsSignature(offsets: number[]): string {
  return [...offsets].sort((a, b) => a - b).join(",");
}

function buildIosStrikeCalendarPlans(
  events: DisruptionEvent[],
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  ctx: CommuteScheduleContext,
  nowMs: number,
): {
  planned: PlannedIosStrikeCalendarEvent[];
  upcomingImpactingCount: number;
} {
  const todayIso = formatLocalIsoDate(new Date(nowMs));
  const { affectedDays, upcomingImpactingCount } =
    buildAffectedStrikeCommuteDays(events, config, ctx, todayIso);

  const planned: PlannedIosStrikeCalendarEvent[] = [];
  for (const day of affectedDays) {
    const parts = parseIsoDateParts(day.commuteDateIso);
    if (!parts) continue;

    const startDateMs = new Date(
      parts.year,
      parts.month - 1,
      parts.day,
      0,
      0,
      0,
      0,
    ).getTime();
    const endDateMs = new Date(
      parts.year,
      parts.month - 1,
      parts.day,
      23,
      59,
      59,
      0,
    ).getTime();

    const identifier = `${STRIKE_NOTIFICATION_PREFIX}${day.strikeKey}_${day.commuteDateIso}`;
    const url = `${STRIKE_EVENT_URL_BASE}?strikeAlert=${encodeURIComponent(identifier)}`;
    const offsets = buildCalendarRelativeOffsetsMinutes(
      parts.year,
      parts.month,
      parts.day,
      alertPrefs,
      nowMs,
    );

    planned.push({
      identifier,
      strikeKey: day.strikeKey,
      commuteDateIso: day.commuteDateIso,
      startDateMs,
      endDateMs,
      title: buildStrikeTitle(day.event),
      location: buildStrikeCalendarLocation(day.event, config),
      notes: buildStrikeCalendarNotes(day.event),
      url,
      alarmRelativeOffsetsMinutes: offsets,
      offsetsSignature: computeOffsetsSignature(offsets),
      strikeEventId: day.event.id,
      strikeCategory: day.event.category,
    });
  }

  planned.sort((a, b) => a.startDateMs - b.startDateMs);
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
  const { affectedDays, upcomingImpactingCount } =
    buildAffectedStrikeCommuteDays(events, config, ctx, todayIso);

  const updatedDispatchLog: Record<string, number> = {};
  for (const [k, ts] of Object.entries(previousDispatchLog)) {
    if (typeof ts === "number" && nowMs - ts < LOG_RETENTION_MS) {
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
    const title = buildStrikeTitle(day.event);
    const notesBody = buildReminderNotes(
      day.event,
      day.commuteDateIso,
      day.firstLessonStartTime,
      day.lastLessonEndTime,
    );

    let scheduledAnyForDay = false;
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
        if (typeof existingLogTs === "number") {
          if (existingLogTs > nowMs + 2_000) {
            fireAtMs = existingLogTs;
          }
        } else {
          fireAtMs = nowMs + CATCHUP_DELAY_ANDROID_MS;
          updatedDispatchLog[identifier] = fireAtMs;
        }
      }

      if (fireAtMs === null) continue;
      scheduledAnyForDay = true;
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

    // Se l'evento è oggi stesso e nessuno degli anticipi ha potuto schedulare una notifica futura,
    // schedula l'avviso predefinito alle 09:00 del giorno stesso (o catch-up immediato se dopo le 09:00).
    if (!scheduledAnyForDay && daysUntilCommute === 0 && activeLeads.length > 0) {
      const sameDayTargetMs = new Date(
        parts.year,
        parts.month - 1,
        parts.day,
        REMINDER_DUE_HOUR_LOCAL,
        REMINDER_DUE_MINUTE_LOCAL,
        0,
        0,
      ).getTime();
      const identifier = `${STRIKE_NOTIFICATION_PREFIX}${day.strikeKey}_${day.commuteDateIso}_0d`;
      let fireAtMs: number | null = null;
      if (sameDayTargetMs > nowMs + MIN_FUTURE_MARGIN_MS) {
        fireAtMs = sameDayTargetMs;
      } else if (nowDate.getHours() < 22) {
        const existingLogTs = updatedDispatchLog[identifier];
        if (typeof existingLogTs === "number") {
          if (existingLogTs > nowMs + 2_000) {
            fireAtMs = existingLogTs;
          }
        } else {
          fireAtMs = nowMs + CATCHUP_DELAY_ANDROID_MS;
          updatedDispatchLog[identifier] = fireAtMs;
        }
      }
      if (fireAtMs !== null) {
        planned.push({
          identifier,
          leadDays: 0,
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

function extractLegacyStrikeIdentifierFromNotes(
  notes?: string | null,
): string | null {
  if (!notes) return null;
  const escapedPrefix = LEGACY_REMINDER_TAG_PREFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
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

function isManagedStrikeCandidate(
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

function normalizeCalendarEventAlarms(ev: Calendar.Event): number[] {
  if (!Array.isArray(ev.alarms)) return [];
  const startMs = ev.startDate ? new Date(ev.startDate).getTime() : NaN;
  const offsets: number[] = [];

  for (const a of ev.alarms) {
    if (
      typeof a.relativeOffset === "number" &&
      Number.isFinite(a.relativeOffset)
    ) {
      offsets.push(Math.round(a.relativeOffset));
      continue;
    }
    if (a.absoluteDate && Number.isFinite(startMs)) {
      const diffMin = Math.round(
        (new Date(a.absoluteDate).getTime() - startMs) / 60_000,
      );
      if (Number.isFinite(diffMin)) {
        offsets.push(diffMin);
      }
    }
  }

  return offsets.sort((a, b) => a - b);
}

function toManagedCalendarEvent(
  ev: Calendar.Event,
): ManagedIosCalendarEvent | null {
  if (!ev.id) return null;
  const startMs = ev.startDate ? new Date(ev.startDate).getTime() : 0;
  const endMs = ev.endDate ? new Date(ev.endDate).getTime() : startMs;
  return {
    id: ev.id,
    calendarId: ev.calendarId || "",
    title: ev.title || "",
    location: ev.location || "",
    notes: ev.notes || "",
    url: ev.url || "",
    allDay: Boolean(ev.allDay),
    startDateMs: Number.isFinite(startMs) ? startMs : 0,
    endDateMs: Number.isFinite(endMs) ? endMs : 0,
    alarmOffsetsMinutes: normalizeCalendarEventAlarms(ev),
  };
}

async function fetchManagedIosStrikeEvents(
  candidateCalendarIds: string[],
  storedState: Record<string, StoredStrikeStateEntry>,
): Promise<ManagedIosCalendarEvent[]> {
  const managedIds = new Set(Object.values(storedState).map((e) => e.eventId));
  const searchCalIds = Array.from(
    new Set(
      [
        ...candidateCalendarIds,
        ...Object.values(storedState).map((e) => e.calendarId || ""),
      ].filter(Boolean),
    ),
  );

  let rawEvents: Calendar.Event[] = [];
  if (searchCalIds.length > 0) {
    try {
      const startWin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endWin = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      rawEvents = await Calendar.getEventsAsync(searchCalIds, startWin, endWin);
    } catch {
      rawEvents = [];
    }
  }

  const foundIds = new Set(rawEvents.map((e) => e.id).filter(Boolean));
  for (const entry of Object.values(storedState)) {
    if (entry.eventId && !foundIds.has(entry.eventId)) {
      try {
        const single = await Calendar.getEventAsync(entry.eventId);
        if (single) {
          rawEvents.push(single);
          if (single.id) foundIds.add(single.id);
        }
      } catch {}
    }
  }

  const dedupedById = new Map<string, ManagedIosCalendarEvent>();
  for (const ev of rawEvents) {
    if (!isManagedStrikeCandidate(ev.url, ev.notes, ev.id, managedIds)) {
      continue;
    }
    const mapped = toManagedCalendarEvent(ev);
    if (mapped && !dedupedById.has(mapped.id)) {
      dedupedById.set(mapped.id, mapped);
    }
  }

  return Array.from(dedupedById.values());
}

async function deleteIosCalendarEventById(eventId: string): Promise<void> {
  if (!eventId) return;
  await Calendar.deleteEventAsync(eventId, { futureEvents: false }).catch(
    () => {},
  );
}

async function purgeLegacyIosStrikeRemindersOnce(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const cleaned = await AsyncStorage.getItem(LEGACY_REMINDERS_CLEANED_KEY);
    if (cleaned === "true") return;

    const remPerm = await Calendar.getRemindersPermissionsAsync().catch(
      () => null,
    );
    if (remPerm?.status === "granted") {
      const legacyStored = await readJsonStorage<
        Record<string, LegacyStoredReminderStateEntry>
      >(LEGACY_REMINDER_STATE_KEY, {});
      const legacyIds = new Set(
        Object.values(legacyStored)
          .map((e) => e.reminderId)
          .filter(Boolean),
      );

      if (typeof StudICIAlarms?.getStrikeReminders === "function") {
        try {
          const nativeRems = await StudICIAlarms.getStrikeReminders();
          for (const rem of nativeRems) {
            if (
              rem.id &&
              !rem.completed &&
              isManagedStrikeCandidate(rem.url, rem.notes, rem.id, legacyIds)
            ) {
              if (typeof StudICIAlarms?.deleteStrikeReminder === "function") {
                await StudICIAlarms.deleteStrikeReminder(rem.id).catch(
                  () => {},
                );
              }
            }
          }
        } catch {}
      } else {
        try {
          const remCals = await Calendar.getCalendarsAsync(
            Calendar.EntityTypes.REMINDER,
          );
          const remCalIds = remCals
            .filter((c) => c.allowsModifications && c.id)
            .map((c) => c.id);
          if (remCalIds.length > 0) {
            const rems = await Calendar.getRemindersAsync(
              remCalIds,
              Calendar.ReminderStatus.INCOMPLETE,
              null,
              null,
            ).catch(() => []);
            for (const rem of rems) {
              if (
                rem.id &&
                isManagedStrikeCandidate(rem.url, rem.notes, rem.id, legacyIds)
              ) {
                await Calendar.deleteReminderAsync(rem.id).catch(() => {});
              }
            }
          }
        } catch {}
      }
    }

    await AsyncStorage.removeItem(LEGACY_REMINDER_STATE_KEY).catch(() => {});
    await AsyncStorage.setItem(LEGACY_REMINDERS_CLEANED_KEY, "true").catch(
      () => {},
    );
  } catch {}
}

async function purgeLegacyIosStrikeNotificationsOnce(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const cleaned = await AsyncStorage.getItem(LEGACY_NOTIFS_CLEANED_KEY);
    if (cleaned === "true") return;
    const scheduled =
      await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
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
    await AsyncStorage.setItem(LEGACY_NOTIFS_CLEANED_KEY, "true");
  } catch {}
}

async function clearAllIosStrikeCalendarEvents(
  storedState: Record<string, StoredStrikeStateEntry>,
): Promise<void> {
  try {
    const avail = await Calendar.isAvailableAsync();
    if (!avail) return;
    const perm = await Calendar.getCalendarPermissionsAsync();
    if (perm.status !== "granted") return;

    const {
      targetCalendarId: existingCalendarId,
      writableCalendarIds: writableIds,
    } = await getManagedStrikeCalendarsSnapshot();

    const searchIds = Array.from(
      new Set(
        [
          existingCalendarId || "",
          ...Object.values(storedState).map((e) => e.calendarId || ""),
        ].filter((id) => Boolean(id) && writableIds.includes(id)),
      ),
    );

    if (searchIds.length === 0 && Object.keys(storedState).length === 0) {
      await AsyncStorage.removeItem(STRIKE_STATE_KEY).catch(() => {});
      return;
    }

    const managed = await fetchManagedIosStrikeEvents(searchIds, storedState);
    for (const ev of managed) {
      await deleteIosCalendarEventById(ev.id);
    }
  } catch {}
  await AsyncStorage.removeItem(STRIKE_STATE_KEY).catch(() => {});
}

function isIosCalendarEventUnchanged(
  existing: ManagedIosCalendarEvent | undefined,
  prevStored: StoredStrikeStateEntry | undefined,
  targetCalendarId: string,
  plan: PlannedIosStrikeCalendarEvent,
): boolean {
  if (!existing?.id) return false;
  if (
    targetCalendarId &&
    existing.calendarId &&
    existing.calendarId !== targetCalendarId
  ) {
    return false;
  }
  if (!existing.allDay) return false;
  if (existing.title !== plan.title) return false;
  if ((existing.location || "") !== plan.location) return false;
  if ((existing.notes || "").trim() !== plan.notes.trim()) return false;
  if (extractStrikeIdentifierFromUrl(existing.url) !== plan.identifier) {
    return false;
  }

  const startIsoMatches =
    existing.startDateMs > 0 &&
    formatLocalIsoDate(new Date(existing.startDateMs)) === plan.commuteDateIso;
  const durationSingleDay =
    existing.endDateMs >= existing.startDateMs &&
    existing.endDateMs - existing.startDateMs <= 25 * 60 * 60 * 1000;
  if (!startIsoMatches || !durationSingleDay) return false;

  const existingSig = computeOffsetsSignature(existing.alarmOffsetsMinutes);
  if (existingSig !== plan.offsetsSignature) {
    return false;
  }

  if (prevStored && prevStored.offsetsSignature !== plan.offsetsSignature) {
    return false;
  }

  return true;
}

async function syncIosStrikeCalendarEvents(
  config: CommuterConfig,
  alertPrefs: StrikeAlertPreferences,
  events: DisruptionEvent[],
  ctx: CommuteScheduleContext,
  options?: { promptIfNeeded?: boolean },
): Promise<StrikeNotificationsStatus> {
  await Promise.all([
    purgeLegacyIosStrikeNotificationsOnce(),
    purgeLegacyIosStrikeRemindersOnce(),
  ]);

  const storedState = await readJsonStorage<
    Record<string, StoredStrikeStateEntry>
  >(STRIKE_STATE_KEY, {});
  const isAnyAlertEnabled =
    alertPrefs.notify7DaysBefore || alertPrefs.notify1DayBefore;

  const isAvail = await Calendar.isAvailableAsync().catch(() => false);
  let perm = isAvail
    ? await Calendar.getCalendarPermissionsAsync().catch(() => ({
        granted: false,
        canAskAgain: true,
        status: "undetermined" as const,
      }))
    : { granted: false, canAskAgain: false, status: "denied" as const };

  if (!config.enabled || !isAnyAlertEnabled) {
    await clearAllIosStrikeCalendarEvents(storedState);
    return {
      enabled: isAnyAlertEnabled,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: perm.status === "granted",
      canAskAgain: perm.canAskAgain ?? true,
      scheduledCount: 0,
      upcomingImpactingCount: 0,
      backend: "calendar",
    };
  }

  const { planned, upcomingImpactingCount } = buildIosStrikeCalendarPlans(
    events,
    config,
    alertPrefs,
    ctx,
    Date.now(),
  );

  if (isAvail && perm.status !== "granted" && perm.canAskAgain) {
    const alreadyAsked = await AsyncStorage.getItem(
      STRIKE_PERMISSION_ASKED_KEY,
    );
    const shouldPrompt =
      Boolean(options?.promptIfNeeded) ||
      (planned.length > 0 && alreadyAsked !== "true");
    if (shouldPrompt) {
      await AsyncStorage.setItem(STRIKE_PERMISSION_ASKED_KEY, "true");
      try {
        perm = await Calendar.requestCalendarPermissionsAsync();
      } catch {}
    }
  }

  if (!isAvail || perm.status !== "granted") {
    return {
      enabled: true,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: false,
      canAskAgain: perm.canAskAgain ?? false,
      scheduledCount: 0,
      upcomingImpactingCount,
      backend: "calendar",
    };
  }

  const { targetCalendarId, writableCalendarIds } =
    await ensureManagedStrikeCalendar();
  if (!targetCalendarId) {
    return {
      enabled: true,
      notify7DaysBefore: alertPrefs.notify7DaysBefore,
      notify1DayBefore: alertPrefs.notify1DayBefore,
      permissionGranted: true,
      canAskAgain: perm.canAskAgain ?? true,
      scheduledCount: 0,
      upcomingImpactingCount,
      backend: "calendar",
    };
  }

  const scanCalendarIds = Array.from(
    new Set(
      [
        targetCalendarId,
        ...Object.values(storedState).map((e) => e.calendarId || ""),
      ].filter((id) => Boolean(id) && writableCalendarIds.includes(id)),
    ),
  );
  const managedEvents = await fetchManagedIosStrikeEvents(
    scanCalendarIds,
    storedState,
  );

  const existingByIdentifier = new Map<string, ManagedIosCalendarEvent[]>();
  for (const ev of managedEvents) {
    let identifier =
      extractStrikeIdentifierFromUrl(ev.url) ||
      extractLegacyStrikeIdentifierFromNotes(ev.notes);
    if (!identifier && ev.id) {
      const storedMatch = Object.values(storedState).find(
        (s) => s.eventId === ev.id,
      );
      if (storedMatch) identifier = storedMatch.identifier;
    }
    if (!identifier) continue;

    const bucket = existingByIdentifier.get(identifier) || [];
    bucket.push(ev);
    existingByIdentifier.set(identifier, bucket);
  }

  const desiredMap = new Map<string, PlannedIosStrikeCalendarEvent>();
  for (const item of planned) {
    desiredMap.set(item.identifier, item);
  }

  // Elimina eventi obsoleti (es. sciopero terminato/rimosso o giorno senza lezioni attive)
  for (const [identifier, bucket] of existingByIdentifier.entries()) {
    if (!desiredMap.has(identifier)) {
      for (const ev of bucket) {
        if (ev.id) {
          await deleteIosCalendarEventById(ev.id);
        }
      }
      existingByIdentifier.delete(identifier);
    }
  }

  const timeZoneId =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
  const nextState: Record<string, StoredStrikeStateEntry> = {};
  let scheduledCount = 0;

  for (const item of planned) {
    const bucket = existingByIdentifier.get(item.identifier) || [];
    const primaryExisting = bucket[0];
    for (let i = 1; i < bucket.length; i++) {
      const dup = bucket[i];
      if (dup?.id) {
        await deleteIosCalendarEventById(dup.id);
      }
    }

    const prevStored = storedState[item.identifier];
    if (
      isIosCalendarEventUnchanged(
        primaryExisting,
        prevStored,
        targetCalendarId,
        item,
      ) &&
      primaryExisting?.id
    ) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        eventId: primaryExisting.id,
        calendarId: targetCalendarId,
        fireAtMs: item.startDateMs,
        title: item.title,
        notes: item.notes,
        strikeDateIso: item.commuteDateIso,
        strikeEventId: item.strikeEventId,
        offsetsSignature: item.offsetsSignature,
      };
      scheduledCount += 1;
      continue;
    }

    const eventDetails: Partial<Calendar.Event> = {
      calendarId: targetCalendarId,
      title: item.title,
      startDate: new Date(item.startDateMs),
      endDate: new Date(item.endDateMs),
      allDay: true,
      timeZone: timeZoneId,
      location: item.location,
      notes: item.notes,
      url: item.url,
      availability: Calendar.Availability.FREE,
      alarms: item.alarmRelativeOffsetsMinutes.map((relativeOffset) => ({
        relativeOffset,
      })),
    };

    let finalEventId: string | null = null;
    if (primaryExisting?.id) {
      try {
        finalEventId = await Calendar.updateEventAsync(
          primaryExisting.id,
          eventDetails,
        );
      } catch {
        await deleteIosCalendarEventById(primaryExisting.id);
        finalEventId = null;
      }
    }

    if (!finalEventId) {
      try {
        finalEventId = await Calendar.createEventAsync(
          targetCalendarId,
          eventDetails,
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
        console.warn("[StrikeCalendar] Errore creazione evento sciopero:", err);
      }
    }

    if (finalEventId) {
      nextState[item.identifier] = {
        identifier: item.identifier,
        eventId: finalEventId,
        calendarId: targetCalendarId,
        fireAtMs: item.startDateMs,
        title: item.title,
        notes: item.notes,
        strikeDateIso: item.commuteDateIso,
        strikeEventId: item.strikeEventId,
        offsetsSignature: item.offsetsSignature,
      };
      scheduledCount += 1;
    }
  }

  await AsyncStorage.setItem(STRIKE_STATE_KEY, JSON.stringify(nextState)).catch(
    () => {},
  );
  await markStrikesCalendarSynced();

  return {
    enabled: true,
    notify7DaysBefore: alertPrefs.notify7DaysBefore,
    notify1DayBefore: alertPrefs.notify1DayBefore,
    permissionGranted: true,
    canAskAgain: perm.canAskAgain ?? true,
    scheduledCount,
    upcomingImpactingCount,
    backend: "calendar",
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
    expires: "never" as const,
  }));

  if (!config.enabled || !isAnyAlertEnabled) {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((req) =>
            req.identifier.startsWith(STRIKE_NOTIFICATION_PREFIX),
          )
          .map((req) =>
            Notifications.cancelScheduledNotificationAsync(
              req.identifier,
            ).catch(() => {}),
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
      backend: "notifications",
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
    const alreadyAsked = await AsyncStorage.getItem(
      STRIKE_PERMISSION_ASKED_KEY,
    );
    if (
      options?.promptIfNeeded ||
      (planned.length > 0 && alreadyAsked !== "true")
    ) {
      await AsyncStorage.setItem(STRIKE_PERMISSION_ASKED_KEY, "true");
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
      backend: "notifications",
    };
  }

  await Notifications.setNotificationChannelAsync(STRIKE_CHANNEL_ID, {
    name: "Avvisi scioperi",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 200, 250],
    lightColor: "#EF4444",
  }).catch(() => {});

  const [existingAll, storedState] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    readJsonStorage<Record<string, StoredStrikeStateEntry>>(
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

  const nextState: Record<string, StoredStrikeStateEntry> = {};
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
      await Notifications.cancelScheduledNotificationAsync(
        item.identifier,
      ).catch(() => {});
    }

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: item.identifier,
        content: {
          title: item.title,
          body: item.body,
          sound: "default",
          color: "#EF4444",
          priority: Notifications.AndroidNotificationPriority.HIGH,
          data: {
            type: "strike_alert",
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
        eventId: item.identifier,
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
    backend: "notifications",
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

  if (Platform.OS === "ios") {
    const isAvail = await Calendar.isAvailableAsync().catch(() => false);
    const perm = isAvail
      ? await Calendar.getCalendarPermissionsAsync().catch(() => ({
          granted: false,
          canAskAgain: true,
          status: "undetermined" as const,
        }))
      : { granted: false, canAskAgain: false, status: "denied" as const };
    const storedState = await readJsonStorage<
      Record<string, StoredStrikeStateEntry>
    >(STRIKE_STATE_KEY, {});
    let scheduledCount = Object.keys(storedState).length;
    if (isAvail && perm.status === "granted") {
      const {
        targetCalendarId: existingCalendarId,
        writableCalendarIds: writableIds,
      } = await getManagedStrikeCalendarsSnapshot();
      const searchIds = Array.from(
        new Set(
          [
            existingCalendarId || "",
            ...Object.values(storedState).map((e) => e.calendarId || ""),
          ].filter((id) => Boolean(id) && writableIds.includes(id)),
        ),
      );
      const managed = await fetchManagedIosStrikeEvents(searchIds, storedState);
      scheduledCount = managed.length;
    }
    return {
      enabled: prefs.notify7DaysBefore || prefs.notify1DayBefore,
      notify7DaysBefore: prefs.notify7DaysBefore,
      notify1DayBefore: prefs.notify1DayBefore,
      permissionGranted: perm.status === "granted",
      canAskAgain: perm.canAskAgain ?? true,
      scheduledCount,
      upcomingImpactingCount,
      backend: "calendar",
    };
  }

  const perm = await Notifications.getPermissionsAsync().catch(() => ({
    granted: false,
    canAskAgain: true,
    status: Notifications.PermissionStatus.UNDETERMINED,
    expires: "never" as const,
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
    backend: "notifications",
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
    Platform.OS === "ios"
      ? await syncIosStrikeCalendarEvents(
          config,
          alertPrefs,
          events,
          ctx,
          options,
        )
      : await syncAndroidStrikeNotifications(
          config,
          alertPrefs,
          events,
          ctx,
          options,
        );

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
