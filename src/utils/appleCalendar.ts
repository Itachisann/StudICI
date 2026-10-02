import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScheduleData } from './scraper';

const LAST_CALENDAR_SYNC_KEY = 'studici_last_calendar_sync';

export interface CalendarSyncResult {
  success: boolean;
  eventsCount: number;
  message: string;
  error?: string;
}

export async function getLastCalendarSync(): Promise<number | null> {
  try {
    const val = await AsyncStorage.getItem(LAST_CALENDAR_SYNC_KEY);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Sincronizza l'intero orario delle lezioni nel Calendario nativo di Apple / dispositivo.
 * Crea un calendario dedicato 'StudICI - Lezioni Sapienza' con lezioni settimanali ricorrenti.
 */
export async function syncScheduleToAppleCalendar(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string
): Promise<CalendarSyncResult> {
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        eventsCount: 0,
        message: 'Il servizio Calendario non è disponibile su questo dispositivo.',
        error: 'calendar_not_available',
      };
    }

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      return {
        success: false,
        eventsCount: 0,
        message: 'Permesso calendario negato. Abilitalo nelle Impostazioni di sistema per sincronizzare.',
        error: 'permission_denied',
      };
    }

    // Cerca o ricrea il calendario dedicato StudICI
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existingCal = calendars.find(
      c => c.name === 'studici_lessons' || c.title === 'StudICI - Lezioni Sapienza'
    );

    if (existingCal) {
      try {
        await Calendar.deleteCalendarAsync(existingCal.id);
      } catch {
        // Se non riesce a cancellare il calendario, procediamo a crearne un altro o usarlo
      }
    }

    let calendarId: string;
    if (Platform.OS === 'ios') {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = await Calendar.createCalendarAsync({
        title: 'StudICI - Lezioni Sapienza',
        color: '#822433',
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: defaultCal.source.id,
        source: defaultCal.source,
        name: 'studici_lessons',
        ownerAccount: 'personal',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
    } else {
      calendarId = await Calendar.createCalendarAsync({
        title: 'StudICI - Lezioni Sapienza',
        color: '#822433',
        entityType: Calendar.EntityTypes.EVENT,
        source: { isLocalAccount: true, name: 'StudICI', type: 'LOCAL' },
        name: 'studici_lessons',
        ownerAccount: 'StudICI',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
    }

    let eventsCount = 0;
    const now = new Date();
    const currentDayOfWeek = now.getDay(); // 0=Dom, 1=Lun ... 6=Sab
    const semesterEndDate = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000); // 5 mesi

    for (let dayIdx = 0; dayIdx < schedule.days.length; dayIdx++) {
      const dayClasses = schedule.days[dayIdx] || [];
      const targetDayOfWeek = dayIdx + 1; // 1=LUN, 2=MAR ... 5=VEN

      let daysUntil = targetDayOfWeek - currentDayOfWeek;
      if (daysUntil < 0) daysUntil += 7;

      for (const cls of dayClasses) {
        if (!cls.startTime || !cls.endTime) continue;

        const [startH, startM] = cls.startTime.split(':').map(Number);
        const [endH, endM] = cls.endTime.split(':').map(Number);

        if (isNaN(startH) || isNaN(endH)) continue;

        const startDate = new Date(now);
        startDate.setDate(now.getDate() + daysUntil);
        startDate.setHours(startH, startM || 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setHours(endH, endM || 0, 0, 0);

        const locationStr = cls.room
          ? cls.building
            ? `${cls.room} (${cls.building})`
            : cls.room
          : '';

        const notesParts = [
          `Corso: ${courseName}`,
          channelName ? `Canale: ${channelName}` : '',
          cls.teacher ? `Docente: Prof. ${cls.teacher}` : '',
          'Sincronizzato automaticamente da StudICI (Sapienza)',
        ].filter(Boolean);

        const subjectUpper = cls.subject?.trim().toUpperCase() || 'LEZIONE';
        const eventTitle = cls.teacher
          ? `${subjectUpper} - Prof. ${cls.teacher}`
          : subjectUpper;

        await Calendar.createEventAsync(calendarId, {
          title: eventTitle,
          startDate,
          endDate,
          location: locationStr,
          notes: notesParts.join('\n'),
          timeZone: 'Europe/Rome',
          recurrenceRule: {
            frequency: Calendar.Frequency.WEEKLY,
            endDate: semesterEndDate,
          },
        });

        eventsCount++;
      }
    }

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_CALENDAR_SYNC_KEY, timestamp.toString());

    return {
      success: true,
      eventsCount,
      message: `Sincronizzazione completata: ${eventsCount} lezioni inserite nel Calendario Apple ('StudICI - Lezioni Sapienza')!`,
    };
  } catch (err: any) {
    console.error('Errore sincronizzazione calendario Apple:', err);
    return {
      success: false,
      eventsCount: 0,
      message: err?.message || 'Si è verificato un errore durante la sincronizzazione con il Calendario Apple.',
      error: String(err),
    };
  }
}
