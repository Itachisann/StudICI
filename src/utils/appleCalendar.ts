import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";
import { formatSapienzaAddress, resolveClassroom } from "./classroomLocations";
import { ScheduleData, fetchScheduleData } from "./scraper";
import { getManualEvents } from "./manualEvents";

export const DEFAULT_CALENDAR_TITLE = "StudICI - Lezioni Sapienza";
export const CALENDAR_NAME_KEY = "studici_calendar_custom_title";
export const CALENDAR_ID_KEY = "@studici_calendar_id";
export const CALENDAR_AUTO_SYNC_KEY = "studici_calendar_auto_sync_enabled";
export const CALENDAR_CONFIG_UPDATED_AT_KEY = "@studici_calendar_config_updated_at";
export const CALENDAR_SCHEDULE_HASH_KEY = "studici_calendar_schedule_hash";
export const CALENDAR_COLOR_KEY = "@studici_calendar_theme_color";
export const LAST_CALENDAR_SYNC_KEY = "studici_last_calendar_sync";

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
 * Restituisce il nome personalizzato del calendario (o quello di default).
 */
export async function getCalendarTitle(): Promise<string> {
  try {
    const val = await AsyncStorage.getItem(CALENDAR_NAME_KEY);
    return val && val.trim() ? val.trim() : DEFAULT_CALENDAR_TITLE;
  } catch {
    return DEFAULT_CALENDAR_TITLE;
  }
}

/**
 * Modifica il nome del calendario. Se il calendario è già presente su iOS/Android,
 * ne aggiorna il titolo direttamente nel servizio nativo di sistema senza duplicarlo.
 */
export async function setCalendarTitle(
  newTitle: string,
  updatedAt?: number,
): Promise<{ success: boolean; message: string }> {
  const trimmed = newTitle.trim();
  const titleToSave = trimmed || DEFAULT_CALENDAR_TITLE;
  const previousTitle = await getCalendarTitle();
  await AsyncStorage.setItem(CALENDAR_NAME_KEY, titleToSave);
  const ts = updatedAt || Date.now();
  await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
  notifyCalendarConfigChanged();

  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (isAvailable) {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status === "granted") {
        const calendars = await Calendar.getCalendarsAsync(
          Calendar.EntityTypes.EVENT,
        );
        const storedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
        let targetCal = storedId
          ? calendars.find((c) => c.id === storedId && c.allowsModifications)
          : null;

        if (!targetCal) {
          targetCal =
            calendars.find(
              (c) =>
                (c.name === "studici_lessons" ||
                  c.title === previousTitle ||
                  c.title === titleToSave ||
                  c.title === DEFAULT_CALENDAR_TITLE) &&
                c.allowsModifications,
            ) || null;
        }

        if (targetCal) {
          await AsyncStorage.setItem(CALENDAR_ID_KEY, targetCal.id);
          const needsUpdate: Partial<Calendar.Calendar> = {};
          if (targetCal.title !== titleToSave) {
            needsUpdate.title = titleToSave;
          }
          const themeColor = await AsyncStorage.getItem(CALENDAR_COLOR_KEY);
          if (
            themeColor &&
            targetCal.color?.toLowerCase() !== themeColor.toLowerCase()
          ) {
            needsUpdate.color = themeColor;
          }
          if (Object.keys(needsUpdate).length > 0) {
            await Calendar.updateCalendarAsync(targetCal.id, needsUpdate);
          }
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
export async function getCalendarAutoSync(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(CALENDAR_AUTO_SYNC_KEY);
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
  updatedAt?: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CALENDAR_AUTO_SYNC_KEY,
      enabled ? "true" : "false",
    );
    const ts = updatedAt || Date.now();
    await AsyncStorage.setItem(CALENDAR_CONFIG_UPDATED_AT_KEY, ts.toString());
    notifyCalendarConfigChanged();
  } catch {}
}

/**
 * Aggiorna il colore del calendario Apple per farlo combaciare sempre con il tema attivo dell'app.
 */
export async function updateAppleCalendarColor(color: string): Promise<void> {
  try {
    if (!color) return;
    await AsyncStorage.setItem(CALENDAR_COLOR_KEY, color);
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return;
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") return;

    const storedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
    const customTitle = await getCalendarTitle();
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const targetCal = storedId
      ? calendars.find((c) => c.id === storedId && c.allowsModifications)
      : calendars.find(
          (c) =>
            (c.title === customTitle ||
              c.name === "studici_lessons" ||
              c.title === DEFAULT_CALENDAR_TITLE) &&
            c.allowsModifications,
        );

    if (
      targetCal &&
      targetCal.color?.toLowerCase() !== color.toLowerCase()
    ) {
      await Calendar.updateCalendarAsync(targetCal.id, { color });
    }
  } catch (err) {
    console.warn("Impossibile aggiornare colore calendario al tema:", err);
  }
}

/**
 * Rimuove completamente il calendario StudICI e tutti i suoi eventi dal dispositivo.
 */
export async function deleteStudICICalendar(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, message: "Calendario non disponibile." };
    }
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      return { success: false, message: "Permessi calendario non concessi." };
    }

    const customTitle = await getCalendarTitle();
    const storedId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const matching = calendars.filter(
      (c) =>
        (c.id === storedId ||
          c.name === "studici_lessons" ||
          c.title === customTitle ||
          c.title === DEFAULT_CALENDAR_TITLE) &&
        c.allowsModifications,
    );

    if (matching.length === 0) {
      await AsyncStorage.removeItem(LAST_CALENDAR_SYNC_KEY);
      await AsyncStorage.removeItem(CALENDAR_SCHEDULE_HASH_KEY);
      await AsyncStorage.removeItem(CALENDAR_ID_KEY);
      return {
        success: true,
        message: "Nessun calendario StudICI trovato sul dispositivo.",
      };
    }

    for (const cal of matching) {
      try {
        await Calendar.deleteCalendarAsync(cal.id);
      } catch (delErr) {
        console.warn("Errore eliminazione calendario:", delErr);
      }
    }

    await AsyncStorage.removeItem(LAST_CALENDAR_SYNC_KEY);
    await AsyncStorage.removeItem(CALENDAR_SCHEDULE_HASH_KEY);
    await AsyncStorage.removeItem(CALENDAR_ID_KEY);

    return {
      success: true,
      message: "Calendario StudICI rimosso con successo da Apple Calendar.",
    };
  } catch (err: any) {
    return {
      success: false,
      message:
        err?.message || "Errore durante la rimozione del calendario nativo.",
    };
  }
}

/**
 * Genera un'impronta (fingerprint) per rilevare se l'orario o le lezioni manuali
 * sono variati rispetto all'ultima sincronizzazione.
 */
export function computeScheduleFingerprint(
  schedule: ScheduleData,
  manualEvents: any[],
  calendarTitle: string,
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
    return JSON.stringify({ t: calendarTitle, d: daysData, m: manualData });
  } catch {
    return "";
  }
}

/**
 * Sincronizza l'intero orario delle lezioni nel Calendario nativo di Apple / dispositivo.
 * Crea o aggiorna il calendario dedicato evitando qualsiasi duplicazione.
 */
export async function syncScheduleToAppleCalendar(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string,
  customTitleOverride?: string,
  calendarColor?: string,
): Promise<CalendarSyncResult> {
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        eventsCount: 0,
        message:
          "Il servizio Calendario non è disponibile su questo dispositivo.",
        error: "calendar_not_available",
      };
    }

    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== "granted") {
      return {
        success: false,
        eventsCount: 0,
        message:
          "Permesso calendario negato. Abilitalo nelle Impostazioni di sistema per sincronizzare.",
        error: "permission_denied",
      };
    }

    if (calendarColor) {
      await AsyncStorage.setItem(CALENDAR_COLOR_KEY, calendarColor);
    }
    const activeColor =
      calendarColor ||
      (await AsyncStorage.getItem(CALENDAR_COLOR_KEY)) ||
      "#822433";
    const activeTitle = customTitleOverride || (await getCalendarTitle());

    // 1. Cerca o riusa il calendario dedicato StudICI (evita duplicati e preserva la condivisione)
    const storedCalendarId = await AsyncStorage.getItem(CALENDAR_ID_KEY);
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );

    const isICloud = (c: Calendar.Calendar) =>
      Boolean(
        c.source &&
          (c.source.name?.toLowerCase().includes("icloud") ||
            c.source.type === Calendar.SourceType.CALDAV),
      );

    let existingCal: Calendar.Calendar | null = null;
    if (storedCalendarId) {
      existingCal =
        calendars.find(
          (c) => c.id === storedCalendarId && c.allowsModifications,
        ) || null;
    }

    if (!existingCal) {
      const matchingCalendars = calendars.filter(
        (c) =>
          (c.title === activeTitle ||
            c.name === "studici_lessons" ||
            c.title === DEFAULT_CALENDAR_TITLE) &&
          c.allowsModifications,
      );

      // Privilegia i calendari su iCloud (che supportano la condivisione nativa Apple tra utenti)
      matchingCalendars.sort((a, b) => {
        const aICloud = isICloud(a) ? 1 : 0;
        const bICloud = isICloud(b) ? 1 : 0;
        return bICloud - aICloud;
      });

      existingCal = matchingCalendars[0] || null;
    }

    let calendarId: string | null = null;
    let isDefaultCalendarFallback = false;

    if (existingCal) {
      calendarId = existingCal.id;
      await AsyncStorage.setItem(CALENDAR_ID_KEY, calendarId);

      // Aggiorna titolo e colore tema sul calendario esistente
      const needsUpdate: Partial<Calendar.Calendar> = {};
      if (existingCal.title !== activeTitle) {
        needsUpdate.title = activeTitle;
      }
      if (
        activeColor &&
        existingCal.color?.toLowerCase() !== activeColor.toLowerCase()
      ) {
        needsUpdate.color = activeColor;
      }
      if (Object.keys(needsUpdate).length > 0) {
        try {
          await Calendar.updateCalendarAsync(existingCal.id, needsUpdate);
        } catch (updateErr) {
          console.warn("Impossibile aggiornare titolo/colore calendario:", updateErr);
        }
      }

      // Rimuovi esclusivamente i vecchi eventi delle lezioni per sostituirli
      // con quelli aggiornati, preservando integralmente l'entità calendario e la sua condivisione
      try {
        const pastDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const oldEvents = await Calendar.getEventsAsync(
          [existingCal.id],
          pastDate,
          futureDate,
        );
        for (const evt of oldEvents) {
          try {
            await Calendar.deleteEventAsync(evt.id, { futureEvents: true });
          } catch {
            // ignora errore se già cancellato
          }
        }
      } catch (cleanErr) {
        console.warn("Errore pulizia vecchi orari calendario:", cleanErr);
      }
    }

    // 2. Se non esiste un calendario StudICI, tenta di crearlo testando le sorgenti disponibili
    if (!calendarId) {
      if (Platform.OS === "ios") {
        const defaultCal = await Calendar.getDefaultCalendarAsync();
        const candidateSources: Calendar.Source[] = [];

        // Priorità 1: iCloud (sorgente primaria che permette creazione calendari su iOS)
        const iCloudCal = calendars.find(
          (c) =>
            c.source &&
            (c.source.name?.toLowerCase().includes("icloud") ||
              c.source.type === Calendar.SourceType.CALDAV) &&
            c.allowsModifications,
        );
        if (iCloudCal?.source) candidateSources.push(iCloudCal.source);

        // Priorità 2: sorgente defaultCal
        if (defaultCal?.source) candidateSources.push(defaultCal.source);

        // Priorità 3: sorgente locale
        const localCal = calendars.find(
          (c) =>
            c.source &&
            (c.source.type === Calendar.SourceType.LOCAL ||
              c.source.name?.toLowerCase() === "default") &&
            c.allowsModifications,
        );
        if (localCal?.source) candidateSources.push(localCal.source);

        // Priorità 4: tutte le altre sorgenti modificabili
        for (const cal of calendars) {
          if (
            cal.source &&
            cal.allowsModifications &&
            !candidateSources.some((s) => s.id === cal.source.id)
          ) {
            candidateSources.push(cal.source);
          }
        }

        // Tenta la creazione su ciascuna sorgente candidata
        for (const src of candidateSources) {
          try {
            calendarId = await Calendar.createCalendarAsync({
              title: activeTitle,
              color: activeColor,
              entityType: Calendar.EntityTypes.EVENT,
              sourceId: src.id,
              source: src,
              name: "studici_lessons",
              ownerAccount: "personal",
              accessLevel: Calendar.CalendarAccessLevel.OWNER,
            });
            if (calendarId) break;
          } catch (createErr: any) {
            console.warn(
              `Creazione calendario su sorgente ${src.name} non supportata:`,
              createErr?.message,
            );
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
            title: activeTitle,
            color: activeColor,
            entityType: Calendar.EntityTypes.EVENT,
            source: { isLocalAccount: true, name: "StudICI", type: "LOCAL" },
            name: "studici_lessons",
            ownerAccount: "StudICI",
            accessLevel: Calendar.CalendarAccessLevel.OWNER,
          });
        } catch {
          const defaultCal = await Calendar.getDefaultCalendarAsync();
          calendarId = defaultCal.id;
          isDefaultCalendarFallback = true;
        }
      }

      if (calendarId && !isDefaultCalendarFallback) {
        await AsyncStorage.setItem(CALENDAR_ID_KEY, calendarId);
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

        const [startH, startM] = cls.startTime.split(":").map(Number);
        const [endH, endM] = cls.endTime.split(":").map(Number);

        if (isNaN(startH) || isNaN(endH)) continue;

        const startDate = new Date(now);
        startDate.setDate(now.getDate() + daysUntil);
        startDate.setHours(startH, startM || 0, 0, 0);

        const endDate = new Date(startDate);
        endDate.setHours(endH, endM || 0, 0, 0);

        const resolved = resolveClassroom(cls.room || "", cls.building || "");
        // Posizione: via/indirizzo per Apple Maps e indicazioni
        const locationAddress = resolved.address
          ? resolved.address
          : cls.address
            ? formatSapienzaAddress(cls.address, cls.building)
            : "Via Eudossiana 18, 00184 Roma";

        // Note: dettagli puliti senza dicitura "Generato da ICIStud"
        const notesParts = [
          cls.room ? `Aula: ${cls.room}` : "",
          cls.teacher ? `Docente: Prof. ${cls.teacher}` : "",
          `Corso: ${courseName}`,
          channelName ? `Canale: ${channelName}` : "",
          resolved.buildingName ? `Edificio: ${resolved.buildingName}` : "",
          resolved.campus ? `Campus: ${resolved.campus}` : "",
          "StudICI • Sapienza Università di Roma",
        ].filter(Boolean);

        // Titolo con materia, aula e docente
        const subjectUpper = cls.subject?.trim().toUpperCase() || "LEZIONE";
        const roomStr = cls.room ? ` (${cls.room})` : "";
        const profStr = cls.teacher ? ` - Prof. ${cls.teacher}` : "";
        const eventTitle = `${subjectUpper}${roomStr}${profStr}`;

        await Calendar.createEventAsync(calendarId, {
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
        });

        eventsCount++;
      }
    }

    // 3. Sincronizzazione delle lezioni manuali dell'utente per questo corso
    let manualList: any[] = [];
    try {
      const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
      manualList = await getManualEvents(storedDegreeUrl || undefined);

      for (const mEvent of manualList) {
        if (!mEvent.startTime || !mEvent.endTime) continue;

        const [startH, startM] = mEvent.startTime.split(":").map(Number);
        const [endH, endM] = mEvent.endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) continue;

        const targetDayOfWeek = mEvent.dayIndex + 1; // 1=LUN, 2=MAR...
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

        const notesParts = [
          mEvent.room ? `Aula: ${mEvent.room}` : "",
          mEvent.teacher ? `Docente: Prof. ${mEvent.teacher}` : "",
          `Corso: ${courseName}`,
          channelName ? `Canale: ${channelName}` : "",
          "Lezione inserita manualmente su StudICI",
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

        await Calendar.createEventAsync(calendarId, {
          title: eventTitle,
          startDate,
          endDate,
          location:
            mEvent.address || mEvent.room || "Sapienza Università di Roma",
          notes: notesParts.join("\n"),
          timeZone: "Europe/Rome",
          ...(recurrenceRule ? { recurrenceRule } : {}),
        });

        eventsCount++;
      }
    } catch (manualSyncErr) {
      console.warn(
        "Errore sincronizzazione lezioni manuali su Calendario:",
        manualSyncErr,
      );
    }

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_CALENDAR_SYNC_KEY, timestamp.toString());

    // Memorizza l'impronta attuale per evitare riscritture inutili
    const fingerprint = computeScheduleFingerprint(
      schedule,
      manualList,
      activeTitle,
    );
    await AsyncStorage.setItem(CALENDAR_SCHEDULE_HASH_KEY, fingerprint);

    const targetCalendarName = isDefaultCalendarFallback
      ? "tuo Calendario"
      : `Calendario Apple ('${activeTitle}')`;

    return {
      success: true,
      eventsCount,
      message: `Sincronizzazione completata: ${eventsCount} lezioni inserite nel ${targetCalendarName}!`,
    };
  } catch (err: any) {
    console.error("Errore sincronizzazione calendario Apple:", err);
    return {
      success: false,
      eventsCount: 0,
      message:
        err?.message ||
        "Si è verificato un errore durante la sincronizzazione con il calendario Apple.",
      error: String(err),
    };
  }
}

/**
 * Verifica se l'aggiornamento automatico è abilitato e se l'orario o le lezioni manuali
 * sono variati rispetto all'ultima sincronizzazione. Se variati, aggiorna silenziosamente.
 */
export async function triggerCalendarAutoSyncIfNeeded(
  schedule: ScheduleData,
  courseName: string,
  channelName?: string,
  calendarColor?: string,
): Promise<boolean> {
  try {
    const isAutoSync = await getCalendarAutoSync();
    if (!isAutoSync) return false;

    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return false;

    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") return false;

    const activeTitle = await getCalendarTitle();
    const storedDegreeUrl = await AsyncStorage.getItem("selectedDegreeUrl");
    const manualList = await getManualEvents(storedDegreeUrl || undefined);

    const currentFingerprint = computeScheduleFingerprint(
      schedule,
      manualList,
      activeTitle,
    );
    const savedFingerprint = await AsyncStorage.getItem(
      CALENDAR_SCHEDULE_HASH_KEY,
    );

    if (savedFingerprint && savedFingerprint === currentFingerprint) {
      // Nessun cambiamento rilevato, nessuna operazione necessaria
      return false;
    }

    const res = await syncScheduleToAppleCalendar(
      schedule,
      courseName,
      channelName,
      activeTitle,
      calendarColor,
    );
    return res.success;
  } catch (err) {
    console.warn("Errore durante auto-sync calendario all'avvio:", err);
    return false;
  }
}

/**
 * Rinfresca il Calendario Apple in background se è configurato o se è abilitato l'auto-sync.
 * Viene invocato durante le sincronizzazioni live o ad ogni avvio.
 */
export async function refreshAppleCalendarIfConfigured(
  calendarColor?: string,
): Promise<boolean> {
  try {
    const isAutoSync = await getCalendarAutoSync();
    // Se la sincronizzazione automatica non è attiva, non deve mai sincronizzare in background!
    if (!isAutoSync) return false;

    const [degreeUrl, degreeName, defaultTabUrl] = await Promise.all([
      AsyncStorage.getItem("selectedDegreeUrl"),
      AsyncStorage.getItem("selectedDegreeName"),
      AsyncStorage.getItem("defaultTabUrl"),
    ]);

    if (!degreeUrl || !defaultTabUrl) return false;

    const schedule = await fetchScheduleData(defaultTabUrl);
    if (!schedule || !schedule.days || schedule.days.length === 0) return false;

    return await triggerCalendarAutoSyncIfNeeded(
      schedule,
      degreeName || "Corso di Laurea",
      undefined,
      calendarColor,
    );
  } catch (err) {
    console.warn("Errore auto-aggiornamento calendario Apple:", err);
    return false;
  }
}
