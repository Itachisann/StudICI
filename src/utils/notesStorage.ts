import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const NOTES_STORAGE_KEY = 'studici_app_notes_v1';

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
  dateStr?: string; // YYYY-MM-DD
  isCompleted?: boolean;
  createdAt: string;
  updatedAt: string;
  reminderEnabled: boolean;
  reminderDate?: string; // ISO String (es. 2026-11-06T08:30:00.000Z)
  notificationId?: string;
}

// Inizializzazione sicura di expo-notifications
// Evita crash a runtime su Dev Client o ambienti dove il modulo nativo non è ancora compilato
let NotificationsModule: typeof import('expo-notifications') | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NotificationsModule = require('expo-notifications');
    if (NotificationsModule?.setNotificationHandler) {
      NotificationsModule.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    }
  } catch {
    NotificationsModule = null;
  }
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

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web' || !NotificationsModule?.getPermissionsAsync) return false;
  try {
    const { status: existingStatus } = await NotificationsModule.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted' && NotificationsModule.requestPermissionsAsync) {
      const { status } = await NotificationsModule.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch (err) {
    console.warn('Errore richiesta permessi notifiche:', err);
    return false;
  }
}

export async function scheduleNoteNotification(
  note: AppNote
): Promise<string | undefined> {
  if (Platform.OS === 'web' || !NotificationsModule?.scheduleNotificationAsync) return undefined;
  if (!note.reminderEnabled || !note.reminderDate) return undefined;

  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return undefined;

    const triggerDate = new Date(note.reminderDate);
    if (triggerDate.getTime() <= Date.now()) {
      // Data già nel passato, non programmare
      return undefined;
    }

    const title = note.title?.trim()
      ? `Promemoria: ${note.title.trim()}`
      : note.targetType === 'lesson'
      ? `Promemoria Lezione: ${note.lessonSubject || 'Lezione'}`
      : 'Promemoria Appunto';

    let body = note.content;
    if (note.targetType === 'lesson' && (note.lessonRoom || note.lessonTime)) {
      const details: string[] = [];
      if (note.lessonRoom) details.push(`Aula: ${note.lessonRoom}`);
      if (note.lessonTime) details.push(`Orario: ${note.lessonTime}`);
      body = `${details.join(' • ')}\n${note.content}`;
    }

    const triggerType = NotificationsModule.SchedulableTriggerInputTypes?.DATE || 'date';

    const notificationId = await NotificationsModule.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { noteId: note.id },
      },
      trigger: {
        type: triggerType,
        date: triggerDate,
      } as any,
    });

    return notificationId;
  } catch (err) {
    console.warn('Errore durante la programmazione della notifica nota:', err);
    return undefined;
  }
}

export async function cancelNoteNotification(notificationId?: string): Promise<void> {
  if (Platform.OS === 'web' || !NotificationsModule?.cancelScheduledNotificationAsync || !notificationId) return;
  try {
    await NotificationsModule.cancelScheduledNotificationAsync(notificationId);
  } catch (err) {
    console.warn('Errore cancellazione notifica nota:', err);
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

export async function saveNote(
  noteData: Omit<AppNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<AppNote> {
  const allNotes = await getNotes();
  const nowIso = new Date().toISOString();

  let finalNote: AppNote;
  if (noteData.id) {
    const existingIndex = allNotes.findIndex((n) => n.id === noteData.id);
    if (existingIndex >= 0) {
      const existing = allNotes[existingIndex];
      // Se c'era una notifica programmata e l'orario o lo switch è cambiato, cancellala prima
      if (existing.notificationId && (!noteData.reminderEnabled || existing.reminderDate !== noteData.reminderDate)) {
        await cancelNoteNotification(existing.notificationId);
      }
      finalNote = {
        ...existing,
        ...noteData,
        id: existing.id,
        updatedAt: nowIso,
      };
      // Riprogramma notifica se attiva
      if (finalNote.reminderEnabled && finalNote.reminderDate) {
        finalNote.notificationId = await scheduleNoteNotification(finalNote);
      } else {
        finalNote.notificationId = undefined;
      }
      allNotes[existingIndex] = finalNote;
    } else {
      finalNote = {
        ...noteData,
        id: noteData.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (finalNote.reminderEnabled && finalNote.reminderDate) {
        finalNote.notificationId = await scheduleNoteNotification(finalNote);
      }
      allNotes.unshift(finalNote);
    }
  } else {
    finalNote = {
      ...noteData,
      id: generateNoteId(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (finalNote.reminderEnabled && finalNote.reminderDate) {
      finalNote.notificationId = await scheduleNoteNotification(finalNote);
    }
    allNotes.unshift(finalNote);
  }

  await AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes));
  notifyNotesChanged();
  return finalNote;
}

export async function deleteNote(noteId: string): Promise<boolean> {
  try {
    const allNotes = await getNotes();
    const target = allNotes.find((n) => n.id === noteId);
    if (target?.notificationId) {
      await cancelNoteNotification(target.notificationId);
    }
    const filtered = allNotes.filter((n) => n.id !== noteId);
    await AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(filtered));
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
    await AsyncStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes));
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
    // Se c'è dateStr specifico, abbina
    if (n.dateStr && dateStr && n.dateStr === dateStr) return true;
    // Se c'è dayIndex, abbina
    if (typeof n.dayIndex === 'number' && typeof dayIndex === 'number' && n.dayIndex === dayIndex) {
      return true;
    }
    // Match su orario se presente
    if (n.lessonTime && startTime && n.lessonTime.includes(startTime)) return true;
    return matchSubj;
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
