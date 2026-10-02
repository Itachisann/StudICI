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

    // 1. Cerca o riusa il calendario dedicato StudICI (evita cancellazione totale per non triggerare restrizioni account)
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existingCal = calendars.find(
      c => (c.name === 'studici_lessons' || c.title === 'StudICI - Lezioni Sapienza') && c.allowsModifications
    );

    let calendarId: string | null = null;
    let isDefaultCalendarFallback = false;

    if (existingCal) {
      calendarId = existingCal.id;
      // Rimuovi vecchi eventi delle lezioni per evitare duplicati senza cancellare il calendario
      try {
        const pastDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const futureDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
        const oldEvents = await Calendar.getEventsAsync([existingCal.id], pastDate, futureDate);
        for (const evt of oldEvents) {
          if (evt.notes?.includes('StudICI') || evt.notes?.includes('Sapienza')) {
            try {
              await Calendar.deleteEventAsync(evt.id, { futureEvents: true });
            } catch {
              // ignora errore su singolo evento
            }
          }
        }
      } catch {
        // ignora
      }
    }

    // 2. Se non esiste un calendario StudICI, tenta di crearlo testando le sorgenti disponibili
    if (!calendarId) {
      if (Platform.OS === 'ios') {
        const defaultCal = await Calendar.getDefaultCalendarAsync();
        const candidateSources: Calendar.Source[] = [];

        // Priorità 1: iCloud (sorgente primaria che permette creazione calendari su iOS)
        const iCloudCal = calendars.find(
          c => c.source && (c.source.name?.toLowerCase().includes('icloud') || c.source.type === Calendar.SourceType.CALDAV) && c.allowsModifications
        );
        if (iCloudCal?.source) candidateSources.push(iCloudCal.source);

        // Priorità 2: sorgente defaultCal
        if (defaultCal?.source) candidateSources.push(defaultCal.source);

        // Priorità 3: sorgente locale
        const localCal = calendars.find(
          c => c.source && (c.source.type === Calendar.SourceType.LOCAL || c.source.name?.toLowerCase() === 'default') && c.allowsModifications
        );
        if (localCal?.source) candidateSources.push(localCal.source);

        // Priorità 4: tutte le altre sorgenti modificabili
        for (const cal of calendars) {
          if (cal.source && cal.allowsModifications && !candidateSources.some(s => s.id === cal.source.id)) {
            candidateSources.push(cal.source);
          }
        }

        // Tenta la creazione su ciascuna sorgente candidata
        for (const src of candidateSources) {
          try {
            calendarId = await Calendar.createCalendarAsync({
              title: 'StudICI - Lezioni Sapienza',
              color: '#822433',
              entityType: Calendar.EntityTypes.EVENT,
              sourceId: src.id,
              source: src,
              name: 'studici_lessons',
              ownerAccount: 'personal',
              accessLevel: Calendar.CalendarAccessLevel.OWNER,
            });
            if (calendarId) break;
          } catch (createErr: any) {
            console.warn(`Creazione calendario su sorgente ${src.name} non supportata:`, createErr?.message);
          }
        }

        // 3. Fallback sicuro: se l'account/dispositivo non consente creazione di nuovi calendari,
        // inserisci direttamente nel calendario predefinito dell'utente
        if (!calendarId) {
          calendarId = defaultCal.id;
          isDefaultCalendarFallback = true;
        }
      } else {
        // Android
        try {
          calendarId = await Calendar.createCalendarAsync({
            title: 'StudICI - Lezioni Sapienza',
            color: '#822433',
            entityType: Calendar.EntityTypes.EVENT,
            source: { isLocalAccount: true, name: 'StudICI', type: 'LOCAL' },
            name: 'studici_lessons',
            ownerAccount: 'StudICI',
            accessLevel: Calendar.CalendarAccessLevel.OWNER,
          });
        } catch {
          const defaultCal = await Calendar.getDefaultCalendarAsync();
          calendarId = defaultCal.id;
          isDefaultCalendarFallback = true;
        }
      }
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

    const targetCalendarName = isDefaultCalendarFallback
      ? 'tuo Calendario'
      : "Calendario Apple ('StudICI - Lezioni Sapienza')";

    return {
      success: true,
      eventsCount,
      message: `Sincronizzazione completata: ${eventsCount} lezioni inserite nel ${targetCalendarName}!`,
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
