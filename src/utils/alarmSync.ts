import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';
import { StudICIAlarms } from '../../modules/studici-alarms/src';
import { computeCommuterItinerary } from './commuterOptimizer';
import { getCommuterConfig, subscribeToCommuterChanges } from './commuterStorage';
import {
  getManualEvents,
  isManualEventActiveOnDate,
  manualEventToClassEvent,
  subscribeToManualEventsChanges,
} from './manualEvents';
import { ClassEvent, fetchScheduleData, getCachedTabs, ScheduleData } from './scraper';
import { minutesToTime, parseTimeToMinutes } from './trenitaliaApi';

const ALARM_SETTINGS_KEY = 'studici_alarm_settings_v1';
const ALARMS_SIGNATURE_KEY = 'studici_alarms_signature_v1';

/** Feature flag: impostato su false per nascondere le sveglie in v1.9.0 mantenendo il modulo nativo compilato */
export const ENABLE_COMMUTER_ALARMS = false;

export interface AlarmSettings {
  enabled: boolean;
  /** Minuti prima della partenza stimata dall'app (per il treno ideale della prima lezione) */
  minutesBeforeDeparture: number;
  lastUpdated: number | null;
}

export const DEFAULT_ALARM_SETTINGS: AlarmSettings = {
  enabled: false,
  minutesBeforeDeparture: 10,
  lastUpdated: null,
};

export interface DayAlarmPlan {
  /** 0 = Lunedì .. 4 = Venerdì */
  dayIdx: number;
  /** 2 = Lunedì .. 6 = Venerdì (convenzione Apple Calendar / AlarmKit) */
  weekdayNumber: number;
  dayName: string;
  shortDayName: string;
  hasLesson: boolean;
  firstLessonSubject?: string;
  firstLessonStartTime?: string;
  firstLessonRoom?: string;
  idealTrainNumber?: string;
  idealTrainTime?: string;
  estimatedDepartureTime?: string;
  alarmTime?: string;
  alarmHour?: number;
  alarmMinute?: number;
}

export interface AlarmSyncResult {
  success: boolean;
  alarmsCount: number;
  plans: DayAlarmPlan[];
  updated: boolean;
  engine: 'alarmkit' | 'usernotifications' | 'calendar';
  message: string;
}

const WEEKDAYS_META = [
  { dayIdx: 0, jsDay: 1, weekdayNumber: 2, dayName: 'Lunedì', shortDayName: 'LUN' },
  { dayIdx: 1, jsDay: 2, weekdayNumber: 3, dayName: 'Martedì', shortDayName: 'MAR' },
  { dayIdx: 2, jsDay: 3, weekdayNumber: 4, dayName: 'Mercoledì', shortDayName: 'MER' },
  { dayIdx: 3, jsDay: 4, weekdayNumber: 5, dayName: 'Giovedì', shortDayName: 'GIO' },
  { dayIdx: 4, jsDay: 5, weekdayNumber: 6, dayName: 'Venerdì', shortDayName: 'VEN' },
];

const alarmChangeListeners = new Set<(settings: AlarmSettings) => void>();

export function subscribeToAlarmChanges(
  cb: (settings: AlarmSettings) => void
): () => void {
  alarmChangeListeners.add(cb);
  return () => {
    alarmChangeListeners.delete(cb);
  };
}

function notifyAlarmChanges(settings: AlarmSettings) {
  for (const cb of alarmChangeListeners) {
    try {
      cb(settings);
    } catch {}
  }
}

export async function getAlarmSettings(): Promise<AlarmSettings> {
  try {
    const raw = await AsyncStorage.getItem(ALARM_SETTINGS_KEY);
    if (!raw) return DEFAULT_ALARM_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      minutesBeforeDeparture:
        typeof parsed.minutesBeforeDeparture === 'number' && !isNaN(parsed.minutesBeforeDeparture)
          ? Math.max(0, Math.min(180, Math.round(parsed.minutesBeforeDeparture)))
          : DEFAULT_ALARM_SETTINGS.minutesBeforeDeparture,
      lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : null,
    };
  } catch {
    return DEFAULT_ALARM_SETTINGS;
  }
}

export async function saveAlarmSettings(
  partial: Partial<AlarmSettings>
): Promise<AlarmSettings> {
  const current = await getAlarmSettings();
  const next: AlarmSettings = {
    ...current,
    ...partial,
    minutesBeforeDeparture:
      typeof partial.minutesBeforeDeparture === 'number'
        ? Math.max(0, Math.min(180, Math.round(partial.minutesBeforeDeparture)))
        : current.minutesBeforeDeparture,
  };
  await AsyncStorage.setItem(ALARM_SETTINGS_KEY, JSON.stringify(next));
  notifyAlarmChanges(next);
  return next;
}

export function isNativeAlarmsModuleAvailable(): boolean {
  return Boolean(StudICIAlarms);
}

function getNextDateForWeekday(targetJsDay: number): {
  date: Date;
  dateStr: string;
  scheduledFutureDate: Date;
} {
  const now = new Date();
  const currentDay = now.getDay();
  let daysUntil = targetJsDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil, 4, 0, 0, 0);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');

  // Data futura dello stesso giorno della settimana (se oggi è il giorno corrente, usa +7 giorni)
  // per interrogare sempre e solo l'orario programmato ufficiale senza alcuna interferenza live
  const futureDaysUntil = daysUntil <= 0 ? daysUntil + 7 : daysUntil;
  const scheduledFutureDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + futureDaysUntil,
    4,
    0,
    0,
    0
  );

  return { date: target, dateStr: `${y}-${m}-${d}`, scheduledFutureDate };
}

async function resolveActiveSchedule(): Promise<{
  degreeUrl: string | null;
  tabUrl: string | null;
  schedule: ScheduleData | null;
}> {
  const degreeUrl = await AsyncStorage.getItem('selectedDegreeUrl');
  if (!degreeUrl) {
    return { degreeUrl: null, tabUrl: null, schedule: null };
  }

  let tabUrl =
    (await AsyncStorage.getItem(`defaultTabUrl_${degreeUrl}`)) ||
    (await AsyncStorage.getItem('defaultTabUrl'));

  // 1. Prova prima la cache locale istantanea v8 del corso
  try {
    const cachedRaw = await AsyncStorage.getItem(`allSchedules_v8_${degreeUrl}`);
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (parsed && parsed.schedules) {
        if (!tabUrl && Array.isArray(parsed.tabs) && parsed.tabs[0]?.url) {
          tabUrl = parsed.tabs[0].url;
        }
        if (tabUrl && parsed.schedules[tabUrl]) {
          return { degreeUrl, tabUrl, schedule: parsed.schedules[tabUrl] };
        }
        const firstAvailableKey = Object.keys(parsed.schedules)[0];
        if (firstAvailableKey) {
          return {
            degreeUrl,
            tabUrl: firstAvailableKey,
            schedule: parsed.schedules[firstAvailableKey],
          };
        }
      }
    }
  } catch {}

  // 2. Fallback: fetchScheduleData da rete/cache singola
  try {
    if (!tabUrl) {
      const tabs = await getCachedTabs(degreeUrl);
      if (tabs && tabs[0]?.url) tabUrl = tabs[0].url;
    }
    if (tabUrl) {
      const schedule = await fetchScheduleData(tabUrl, false);
      return { degreeUrl, tabUrl, schedule };
    }
  } catch {}

  return { degreeUrl, tabUrl: tabUrl || null, schedule: null };
}

/**
 * Calcola il piano settimanale delle sveglie (Lunedì – Venerdì) basato
 * sul treno ideale della prima lezione di ciascun giorno e sull'anticipo scelto.
 */
export async function computeWeeklyAlarmPlans(
  minutesBeforeDeparture?: number
): Promise<DayAlarmPlan[]> {
  const settings = await getAlarmSettings();
  const offsetMins =
    typeof minutesBeforeDeparture === 'number'
      ? Math.max(0, Math.round(minutesBeforeDeparture))
      : settings.minutesBeforeDeparture;

  const [{ degreeUrl, tabUrl, schedule }, commuterConfig] = await Promise.all([
    resolveActiveSchedule(),
    getCommuterConfig(),
  ]);

  const manualEvents = degreeUrl ? await getManualEvents(degreeUrl) : [];

  const plans = await Promise.all(
    WEEKDAYS_META.map(async (meta): Promise<DayAlarmPlan> => {
      const { dateStr, scheduledFutureDate } = getNextDateForWeekday(meta.jsDay);

      // Lezioni ufficiali del giorno
      const officialClasses: ClassEvent[] =
        schedule?.days && Array.isArray(schedule.days[meta.dayIdx])
          ? [...schedule.days[meta.dayIdx]]
          : [];

      // Lezioni manuali attive in questo giorno per il canale corrente
      const manualForDay: ClassEvent[] = manualEvents
        .filter((m) => {
          if (m.dayIndex !== meta.dayIdx) return false;
          if (m.tabUrl && tabUrl && m.tabUrl !== tabUrl) return false;
          return isManualEventActiveOnDate(m, dateStr);
        })
        .map(manualEventToClassEvent);

      const allDayClasses = [...officialClasses, ...manualForDay].filter(
        (c) => Boolean(c && c.startTime)
      );

      if (allDayClasses.length === 0) {
        return {
          dayIdx: meta.dayIdx,
          weekdayNumber: meta.weekdayNumber,
          dayName: meta.dayName,
          shortDayName: meta.shortDayName,
          hasLesson: false,
        };
      }

      // Ordina per orario di inizio e seleziona la PRIMA lezione del giorno
      allDayClasses.sort(
        (a, b) =>
          parseTimeToMinutes(a.startTime || '08:30') -
          parseTimeToMinutes(b.startTime || '08:30')
      );
      const firstLesson = allDayClasses[0];

      try {
        // Calcola l'itinerario sul treno ideale (selectedTrainOffset: 0) per la prima lezione
        // usando SEMPRE l'orario programmato ufficiale (scheduledFutureDate + ignoreCurrentTime: true)
        const itinerary = await computeCommuterItinerary({
          config: commuterConfig,
          scheduleData: schedule,
          direction: 'outbound',
          targetDate: scheduledFutureDate,
          selectedClass: firstLesson,
          selectedTrainOffset: 0,
          ignoreCurrentTime: true,
        });

        const estimatedDepStr = itinerary.departureTime || '07:00';
        const depMins = parseTimeToMinutes(estimatedDepStr);
        const alarmTotalMins = (((depMins - offsetMins) % 1440) + 1440) % 1440;
        const alarmHour = Math.floor(alarmTotalMins / 60);
        const alarmMinute = alarmTotalMins % 60;
        const alarmTime = minutesToTime(alarmTotalMins);

        return {
          dayIdx: meta.dayIdx,
          weekdayNumber: meta.weekdayNumber,
          dayName: meta.dayName,
          shortDayName: meta.shortDayName,
          hasLesson: true,
          firstLessonSubject: firstLesson.subject,
          firstLessonStartTime: firstLesson.startTime,
          firstLessonRoom: firstLesson.room,
          idealTrainNumber: itinerary.liveTrain?.trainNumber,
          idealTrainTime: itinerary.liveTrain?.departureTimePlanned,
          estimatedDepartureTime: estimatedDepStr,
          alarmTime,
          alarmHour,
          alarmMinute,
        };
      } catch {
        // Fallback diretto sull'inizio della prima lezione se il calcolo itinerario fallisce
        const startMins = parseTimeToMinutes(firstLesson.startTime || '08:30');
        const fallbackDepMins = Math.max(0, startMins - 90);
        const alarmTotalMins = (((fallbackDepMins - offsetMins) % 1440) + 1440) % 1440;
        return {
          dayIdx: meta.dayIdx,
          weekdayNumber: meta.weekdayNumber,
          dayName: meta.dayName,
          shortDayName: meta.shortDayName,
          hasLesson: true,
          firstLessonSubject: firstLesson.subject,
          firstLessonStartTime: firstLesson.startTime,
          firstLessonRoom: firstLesson.room,
          estimatedDepartureTime: minutesToTime(fallbackDepMins),
          alarmTime: minutesToTime(alarmTotalMins),
          alarmHour: Math.floor(alarmTotalMins / 60),
          alarmMinute: alarmTotalMins % 60,
        };
      }
    })
  );

  return plans;
}

async function clearCalendarFallbackAlarms(): Promise<void> {
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return;
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const matching = calendars.filter(
      (c) =>
        (c.name === 'studici_alarms' || c.title === 'StudICI - Sveglie') &&
        c.allowsModifications
    );
    for (const cal of matching) {
      try {
        await Calendar.deleteCalendarAsync(cal.id);
      } catch {}
    }
  } catch {}
}

async function syncCalendarFallbackAlarms(activePlans: DayAlarmPlan[]): Promise<boolean> {
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return false;
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') return false;

    await clearCalendarFallbackAlarms();
    if (activePlans.length === 0) return true;

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    let calendarId: string | null = null;

    if (Platform.OS === 'ios') {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      const candidateSources: Calendar.Source[] = [];
      const iCloudCal = calendars.find(
        (c) =>
          c.source &&
          (c.source.name?.toLowerCase().includes('icloud') ||
            c.source.type === Calendar.SourceType.CALDAV) &&
          c.allowsModifications
      );
      if (iCloudCal?.source) candidateSources.push(iCloudCal.source);
      if (defaultCal?.source) candidateSources.push(defaultCal.source);
      for (const src of candidateSources) {
        try {
          calendarId = await Calendar.createCalendarAsync({
            title: 'StudICI - Sveglie',
            color: '#ef4444',
            entityType: Calendar.EntityTypes.EVENT,
            sourceId: src.id,
            source: src,
            name: 'studici_alarms',
            ownerAccount: 'personal',
            accessLevel: Calendar.CalendarAccessLevel.OWNER,
          });
          if (calendarId) break;
        } catch {}
      }
      if (!calendarId) calendarId = defaultCal.id;
    } else {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal.id;
    }

    if (!calendarId) return false;

    const semesterEndDate = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000);

    for (const plan of activePlans) {
      if (plan.alarmHour === undefined || plan.alarmMinute === undefined) continue;
      const { date: startDate } = getNextDateForWeekday(plan.dayIdx + 1);
      startDate.setHours(plan.alarmHour, plan.alarmMinute, 0, 0);
      const endDate = new Date(startDate.getTime() + 15 * 60 * 1000);

      const trainDesc = plan.idealTrainNumber
        ? ` • Treno ${plan.idealTrainNumber} (${plan.idealTrainTime})`
        : '';

      await Calendar.createEventAsync(calendarId, {
        title: `⏰ Sveglia StudICI (${plan.alarmTime}) • ${plan.firstLessonSubject || 'Lezione'}`,
        startDate,
        endDate,
        notes: `Partenza stimata: ${plan.estimatedDepartureTime}${trainDesc}\nPrima lezione: ${plan.firstLessonSubject} alle ${plan.firstLessonStartTime}`,
        timeZone: 'Europe/Rome',
        alarms: [{ relativeOffset: 0 }, { relativeOffset: -5 }],
        recurrenceRule: {
          frequency: Calendar.Frequency.WEEKLY,
          endDate: semesterEndDate,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function cancelAllNativeAlarms(): Promise<void> {
  try {
    if (StudICIAlarms) {
      await StudICIAlarms.cancelAllAlarms();
    }
  } catch {}
  await clearCalendarFallbackAlarms();
  await AsyncStorage.removeItem(ALARMS_SIGNATURE_KEY);
}

/**
 * Crea o aggiorna le sveglie native (tante quanti sono i giorni con lezione).
 * Se `force` è false, aggiorna le sveglie solo se rileva variazioni negli orari o nelle impostazioni.
 */
export async function syncNativeAlarms(options?: {
  force?: boolean;
  settingsOverride?: AlarmSettings;
  tintColor?: string;
}): Promise<AlarmSyncResult> {
  const settings = options?.settingsOverride || (await getAlarmSettings());

  if (!settings.enabled) {
    await cancelAllNativeAlarms();
    return {
      success: true,
      alarmsCount: 0,
      plans: [],
      updated: true,
      engine: 'alarmkit',
      message: 'Sveglie automatiche disattivate.',
    };
  }

  const plans = await computeWeeklyAlarmPlans(settings.minutesBeforeDeparture);
  const activePlans = plans.filter(
    (p) => p.hasLesson && p.alarmHour !== undefined && p.alarmMinute !== undefined
  );

  const signature = JSON.stringify({
    mins: settings.minutesBeforeDeparture,
    items: activePlans.map(
      (p) =>
        `${p.dayIdx}:${p.alarmTime}:${p.estimatedDepartureTime}:${p.idealTrainNumber || ''}:${p.firstLessonSubject || ''}:${p.firstLessonStartTime || ''}`
    ),
  });

  const previousSignature = await AsyncStorage.getItem(ALARMS_SIGNATURE_KEY);
  if (!options?.force && previousSignature === signature) {
    return {
      success: true,
      alarmsCount: activePlans.length,
      plans,
      updated: false,
      engine: StudICIAlarms ? 'alarmkit' : 'calendar',
      message: 'Sveglie già allineate con gli orari attuali.',
    };
  }

  let usedEngine: 'alarmkit' | 'usernotifications' | 'calendar' = 'alarmkit';
  const tintHex = options?.tintColor || '#822433';

  if (StudICIAlarms) {
    const authorized = await StudICIAlarms.requestAuthorization();
    if (!authorized) {
      return {
        success: false,
        alarmsCount: 0,
        plans,
        updated: false,
        engine: 'alarmkit',
        message:
          'Permesso per le sveglie negato. Abilita Sveglie e Notifiche nelle Impostazioni di iOS.',
      };
    }

    await StudICIAlarms.cancelAllAlarms();
    await clearCalendarFallbackAlarms();

    for (const plan of activePlans) {
      const title = `Sveglia • ${plan.dayName}`;
      const trainPart = plan.idealTrainNumber
        ? ` • Treno ${plan.idealTrainNumber} (${plan.idealTrainTime})`
        : '';
      const subtitle = `Partenza ${plan.estimatedDepartureTime}${trainPart} • ${plan.firstLessonSubject || 'Prima lezione'}`;

      const res = await StudICIAlarms.scheduleWeeklyAlarm(
        plan.weekdayNumber,
        plan.alarmHour!,
        plan.alarmMinute!,
        title,
        subtitle,
        tintHex
      );
      if (res?.engine) {
        usedEngine = res.engine;
      }
    }
  } else {
    // Fallback se il binario DevClient in uso non include ancora il modulo nativo StudICIAlarms
    const calOk = await syncCalendarFallbackAlarms(activePlans);
    if (!calOk) {
      return {
        success: false,
        alarmsCount: 0,
        plans,
        updated: false,
        engine: 'calendar',
        message:
          'Permesso necessario per programmare gli avvisi sveglia sul dispositivo.',
      };
    }
    usedEngine = 'calendar';
  }

  const nowTs = Date.now();
  await AsyncStorage.setItem(ALARMS_SIGNATURE_KEY, signature);
  await saveAlarmSettings({ ...settings, lastUpdated: nowTs });

  return {
    success: true,
    alarmsCount: activePlans.length,
    plans,
    updated: true,
    engine: usedEngine,
    message:
      activePlans.length > 0
        ? `Impostate ${activePlans.length} sveglie native (${settings.minutesBeforeDeparture} min prima della partenza stimata).`
        : 'Nessuna lezione trovata nei giorni feriali.',
  };
}

let backgroundSyncInFlight: Promise<void> | null = null;

/**
 * Controlla silenziosamente in background se ci sono variazioni di orari, treni o lezioni
 * e aggiorna automaticamente le sveglie native quando l'utente entra nell'app.
 */
export function refreshCommuterAlarmsInBackground(force = false): Promise<void> {
  if (!ENABLE_COMMUTER_ALARMS) {
    return Promise.resolve();
  }
  if (!backgroundSyncInFlight) {
    backgroundSyncInFlight = (async () => {
      try {
        const settings = await getAlarmSettings();
        if (!settings.enabled) return;
        await syncNativeAlarms({ force });
      } catch (err) {
        console.warn('Errore aggiornamento sveglie in background:', err);
      } finally {
        backgroundSyncInFlight = null;
      }
    })();
  }
  return backgroundSyncInFlight;
}

if (ENABLE_COMMUTER_ALARMS) {
  // Aggiorna automaticamente le sveglie in background al variare di lezioni manuali o impostazioni viaggio
  subscribeToManualEventsChanges(() => {
    refreshCommuterAlarmsInBackground(true).catch(() => {});
  });

  subscribeToCommuterChanges(() => {
    refreshCommuterAlarmsInBackground(true).catch(() => {});
  });
}

