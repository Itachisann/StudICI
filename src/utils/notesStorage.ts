import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

export const NOTES_STORAGE_KEY = 'studici_app_notes_v1';
export const NOTES_TOMBSTONES_KEY = 'studici_app_notes_tombstones_v1';
export const NOTES_MODIFIED_KEY = 'studici_app_notes_modified_at_v1';

export type NoteTargetType = 'lesson' | 'day';

export interface AppNote {
  id: string;
  targetType: NoteTargetType;
  title?: string;
  content: string;
  lessonSubject?: string;
  lessonTime?: string;
  lessonRoom?: string;
  lessonTeacher?: string;
  dayIndex?: number; // 0 = Lun .. 6 = Dom
  dayName?: string; // Es. "Venerdì"
  dateStr?: string; // YYYY-MM-DD
  isCompleted?: boolean;
  createdAt: string;
  updatedAt: string;
  reminderEnabled: boolean;
  reminderDate?: string; // ISO String (es. 2026-11-06T08:30:00.000Z)
  notificationId?: string;
  appleReminderId?: string; // ID del promemoria nativo Apple nell'app Promemoria di iOS
}

const notesListeners = new Set<() => void>();

export function subscribeToNotesChanges(cb: () => void): () => void {
  notesListeners.add(cb);
  return () => {
    notesListeners.delete(cb);
  };
}

function notifyNotesChanged(): void {
  for (const cb of notesListeners) {
    try {
      cb();
    } catch (e) {
      console.warn('Errore listener note:', e);
    }
  }
}

export function generateNoteId(): string {
  return 'note_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export async function requestAppleRemindersPermissions(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return false;
    const { status } = await Calendar.getRemindersPermissionsAsync();
    if (status === 'granted') return true;
    const req = await Calendar.requestRemindersPermissionsAsync();
    return req.status === 'granted';
  } catch (err) {
    console.warn('Errore permessi Apple Reminders:', err);
    return false;
  }
}

export async function scheduleAppleReminder(note: AppNote): Promise<string | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  if (!note.reminderEnabled || !note.reminderDate) return undefined;

  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return undefined;

    const granted = await requestAppleRemindersPermissions();
    if (!granted) return undefined;

    const dueDate = new Date(note.reminderDate);
    if (isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now() - 60 * 1000) {
      return undefined;
    }

    // Inserimento nell'elenco di default di Apple Promemoria
    let targetCalId: string | null = null;
    try {
      const reminderCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
      if (reminderCalendars && reminderCalendars.length > 0) {
        const primary = reminderCalendars.find((c) => c.isPrimary);
        if (primary) {
          targetCalId = primary.id;
        } else {
          const defaultList = reminderCalendars.find(
            (c) =>
              c.title === 'Promemoria' ||
              c.name === 'Promemoria' ||
              c.title === 'Reminders' ||
              c.name === 'Reminders'
          );
          if (defaultList) {
            targetCalId = defaultList.id;
          }
        }
      }
    } catch {}

    const title = note.title?.trim()
      ? note.title.trim()
      : note.targetType === 'lesson'
      ? `Lezione: ${note.lessonSubject || 'Lezione'}`
      : 'Promemoria StudICI';

    let notesText = note.content || '';
    if (note.targetType === 'lesson') {
      const meta: string[] = [];
      if (note.lessonSubject) meta.push(note.lessonSubject);
      if (note.lessonTime) meta.push(note.lessonTime);
      if (note.lessonRoom) {
        meta.push(note.lessonRoom.toLowerCase().startsWith('aula') ? note.lessonRoom : `Aula ${note.lessonRoom}`);
      }
      notesText = `${meta.join(' • ')}${note.content ? `\n\n${note.content}` : ''}`;
    }

    // Se esiste già un promemoria nativo per questa nota, rimuovilo prima per evitare duplicati
    if (note.appleReminderId) {
      try {
        await Calendar.deleteReminderAsync(note.appleReminderId);
      } catch {}
    }

    const reminderId = await Calendar.createReminderAsync(targetCalId, {
      title,
      notes: notesText,
      startDate: dueDate,
      dueDate,
      alarms: [
        {
          absoluteDate: dueDate.toISOString(),
        },
      ],
      completed: Boolean(note.isCompleted),
    });

    return reminderId;
  } catch (err) {
    console.warn('Errore programmazione Apple Reminder:', err);
    return undefined;
  }
}

export async function deleteAppleReminder(appleReminderId?: string): Promise<void> {
  if (Platform.OS !== 'ios' || !appleReminderId) return;
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return;
    await Calendar.deleteReminderAsync(appleReminderId);
  } catch (err) {
    console.warn('Errore cancellazione Apple Reminder:', err);
  }
}

/**
 * Verifica se un Apple Reminder associato esiste ancora sul dispositivo.
 * Restituisce l'oggetto Reminder se valido, altrimenti null se eliminato o inaccessibile.
 */
export async function getAppleReminderStatus(
  appleReminderId: string
): Promise<{ exists: boolean; completed: boolean }> {
  if (Platform.OS !== 'ios' || !appleReminderId) {
    return { exists: false, completed: false };
  }
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return { exists: false, completed: false };
    const granted = await requestAppleRemindersPermissions();
    if (!granted) return { exists: false, completed: false };

    const reminder = await Calendar.getReminderAsync(appleReminderId);
    if (!reminder) {
      return { exists: false, completed: false };
    }
    return { exists: true, completed: Boolean(reminder.completed) };
  } catch {
    return { exists: false, completed: false };
  }
}

/**
 * Sincronizzazione bidirezionale note ↔ Apple Reminders:
 * - Se un promemoria è stato eliminato dall'app nativa Apple Promemoria, disattiva il promemoria nella nota.
 * - Se è stato segnato come completato dall'app nativa, aggiorna lo stato di completamento in StudICI.
 */
export async function syncAppleRemindersWithNotes(): Promise<AppNote[]> {
  if (Platform.OS !== 'ios') return getNotes();
  try {
    const isAvailable = await Calendar.isAvailableAsync();
    if (!isAvailable) return getNotes();
    const granted = await requestAppleRemindersPermissions();
    if (!granted) return getNotes();

    const allNotes = await getNotes();
    let hasChanges = false;

    for (let i = 0; i < allNotes.length; i++) {
      const note = allNotes[i];
      if (note.appleReminderId) {
        try {
          const reminder = await Calendar.getReminderAsync(note.appleReminderId);
          if (!reminder) {
            note.reminderEnabled = false;
            note.reminderDate = undefined;
            note.appleReminderId = undefined;
            hasChanges = true;
          } else {
            if (Boolean(reminder.completed) !== Boolean(note.isCompleted)) {
              note.isCompleted = Boolean(reminder.completed);
              hasChanges = true;
            }
          }
        } catch {
          // L'ID del promemoria non esiste più in Apple Reminders (eliminato dall'utente)
          note.reminderEnabled = false;
          note.reminderDate = undefined;
          note.appleReminderId = undefined;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      await Promise.all([
        AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes)),
        AsyncStorage.setItem(NOTES_MODIFIED_KEY, String(Date.now())),
      ]);
      notifyNotesChanged();
    }

    return allNotes;
  } catch (err) {
    console.warn('Errore syncAppleRemindersWithNotes:', err);
    return getNotes();
  }
}

export async function getNotes(): Promise<AppNote[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.warn('Errore caricamento note:', err);
    return [];
  }
}

export async function getNotesTombstones(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_TOMBSTONES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setNotesTombstones(
  tombstones: Record<string, number>
): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_TOMBSTONES_KEY, JSON.stringify(tombstones));
  } catch {}
}

export async function getNotesModifiedAt(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_MODIFIED_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function setAllNotes(
  notes: AppNote[],
  tombstones?: Record<string, number>,
  modifiedAt?: number,
  silent: boolean = false
): Promise<void> {
  const now = modifiedAt || Date.now();
  const ops: Promise<void>[] = [
    AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes)),
    AsyncStorage.setItem(NOTES_MODIFIED_KEY, String(now)),
  ];
  if (tombstones) {
    ops.push(AsyncStorage.setItem(NOTES_TOMBSTONES_KEY, JSON.stringify(tombstones)));
  }
  await Promise.all(ops);
  if (!silent) {
    notifyNotesChanged();
  }
}

const DAYS_LIST = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

export async function saveNote(
  noteData: Omit<AppNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<AppNote> {
  const allNotes = await getNotes();
  const nowIso = new Date().toISOString();

  let computedDayIndex = noteData.dayIndex;
  const dateStr = noteData.dateStr || nowIso.split('T')[0];
  if (typeof computedDayIndex !== 'number' && dateStr) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      computedDayIndex = (dt.getDay() + 6) % 7;
    } catch {}
  }
  const dayName = noteData.dayName || (typeof computedDayIndex === 'number' && DAYS_LIST[computedDayIndex] ? DAYS_LIST[computedDayIndex] : undefined);

  const enrichedData = {
    ...noteData,
    dayIndex: computedDayIndex,
    dayName,
    dateStr,
  };

  let finalNote: AppNote;
  if (noteData.id) {
    const existingIndex = allNotes.findIndex((n) => n.id === noteData.id);
    if (existingIndex >= 0) {
      const existing = allNotes[existingIndex];
      // Se c'era un promemoria Apple e l'orario o lo switch è cambiato, cancellalo prima
      if (existing.appleReminderId && (!noteData.reminderEnabled || existing.reminderDate !== noteData.reminderDate)) {
        await deleteAppleReminder(existing.appleReminderId);
      }
      finalNote = {
        ...existing,
        ...enrichedData,
        id: existing.id,
        updatedAt: nowIso,
      };
      // Programma promemoria nativo Apple se attivo
      if (finalNote.reminderEnabled && finalNote.reminderDate) {
        finalNote.appleReminderId = await scheduleAppleReminder(finalNote);
      } else {
        finalNote.appleReminderId = undefined;
      }
      allNotes[existingIndex] = finalNote;
    } else {
      finalNote = {
        ...enrichedData,
        id: noteData.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (finalNote.reminderEnabled && finalNote.reminderDate) {
        finalNote.appleReminderId = await scheduleAppleReminder(finalNote);
      }
      allNotes.unshift(finalNote);
    }
  } else {
    finalNote = {
      ...enrichedData,
      id: generateNoteId(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (finalNote.reminderEnabled && finalNote.reminderDate) {
      finalNote.appleReminderId = await scheduleAppleReminder(finalNote);
    }
    allNotes.unshift(finalNote);
  }

  await Promise.all([
    AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes)),
    AsyncStorage.setItem(NOTES_MODIFIED_KEY, String(Date.now())),
  ]);
  notifyNotesChanged();
  return finalNote;
}

export async function deleteNote(noteId: string): Promise<boolean> {
  try {
    const allNotes = await getNotes();
    const target = allNotes.find((n) => n.id === noteId);
    if (target?.appleReminderId) {
      await deleteAppleReminder(target.appleReminderId);
    }
    const filtered = allNotes.filter((n) => n.id !== noteId);
    const tombstones = await getNotesTombstones();
    const now = Date.now();
    tombstones[noteId] = now;

    await Promise.all([
      AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(filtered)),
      AsyncStorage.setItem(NOTES_TOMBSTONES_KEY, JSON.stringify(tombstones)),
      AsyncStorage.setItem(NOTES_MODIFIED_KEY, String(now)),
    ]);
    notifyNotesChanged();
    return true;
  } catch (err) {
    console.warn('Errore eliminazione nota:', err);
    return false;
  }
}

export async function toggleNoteCompleted(noteId: string): Promise<boolean> {
  try {
    const allNotes = await getNotes();
    const index = allNotes.findIndex((n) => n.id === noteId);
    if (index === -1) return false;
    allNotes[index].isCompleted = !allNotes[index].isCompleted;
    allNotes[index].updatedAt = new Date().toISOString();
    const target = allNotes[index];

    if (Platform.OS === 'ios' && target.appleReminderId) {
      try {
        await Calendar.updateReminderAsync(target.appleReminderId, {
          completed: target.isCompleted,
          completionDate: target.isCompleted ? new Date() : undefined,
        });
      } catch (calErr) {
        console.warn('Errore aggiornamento completamento Apple Reminder:', calErr);
      }
    }

    await Promise.all([
      AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes)),
      AsyncStorage.setItem(NOTES_MODIFIED_KEY, String(Date.now())),
    ]);
    notifyNotesChanged();
    return true;
  } catch (err) {
    console.warn('Errore toggle completamento nota:', err);
    return false;
  }
}

export function filterNotesForLesson(
  notes: AppNote[],
  subject: string,
  startTime?: string,
  dateStr?: string,
  dayIndex?: number
): AppNote[] {
  const normSubject = subject.trim().toLowerCase();
  return notes.filter((n) => {
    if (n.targetType !== 'lesson') return false;
    if (!n.lessonSubject) return false;
    const matchSubj = n.lessonSubject.trim().toLowerCase() === normSubject;
    if (!matchSubj) return false;

    // Se entrambi hanno il dayIndex specificato e sono diversi, non corrisponde
    if (typeof n.dayIndex === 'number' && typeof dayIndex === 'number' && n.dayIndex !== dayIndex) {
      return false;
    }

    // Se entrambi hanno dateStr specificato e sono diversi, non corrisponde
    if (n.dateStr && dateStr && n.dateStr !== dateStr) {
      return false;
    }

    // Se c'è filtro su orario e la nota specifica un orario
    if (startTime && n.lessonTime) {
      const cleanStart = startTime.trim();
      if (!n.lessonTime.includes(cleanStart)) {
        return false;
      }
    }

    return true;
  });
}

export function filterNotesForDay(
  notes: AppNote[],
  dayIndex: number,
  dateStr?: string
): AppNote[] {
  return notes.filter((n) => {
    if (n.targetType === 'day') {
      if (n.dateStr && dateStr && n.dateStr === dateStr) return true;
      if (typeof n.dayIndex === 'number' && n.dayIndex === dayIndex) return true;
    }
    return false;
  });
}
