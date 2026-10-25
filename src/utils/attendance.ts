import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClassEvent } from './scraper';

const ATTENDANCE_STORAGE_KEY = 'studici_attendance_records';
const TOMBSTONES_KEY = 'studici_attendance_tombstones';

export async function getAttendanceStorageKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl'));
  return url ? `${ATTENDANCE_STORAGE_KEY}_${url}` : ATTENDANCE_STORAGE_KEY;
}

export async function getTombstonesStorageKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl'));
  return url ? `${TOMBSTONES_KEY}_${url}` : TOMBSTONES_KEY;
}

export interface AttendanceRecord {
  id: string; // `${date}_${subject}_${startTime}`
  date: string; // YYYY-MM-DD
  displayDate: string; // es. "2 Ottobre"
  dayIndex: number; // 0=LUN, 4=VEN
  dayName: string; // "Lunedì", etc.
  subject: string;
  startTime: string;
  endTime: string;
  room?: string;
  teacher?: string;
  duration: number; // in ore
  timestamp: number;
}

export interface SubjectAttendanceStat {
  subject: string;
  count: number;
  hours: number;
  lastDate: string;
}

export interface AttendanceStats {
  totalLessons: number;
  totalHours: number;
  subjectsCount: number;
  subjectStats: SubjectAttendanceStat[];
  recentRecords: AttendanceRecord[];
}

/**
 * Calcola la data (YYYY-MM-DD e formattata) per il giorno della settimana corrente (0=LUN ... 4=VEN).
 */
export function getDateForDayIndex(dayIndex: number): { dateStr: string; displayDate: string } {
  const now = new Date();
  const currentDay = now.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  // Distanza da lunedì (1):
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);

  const targetDate = new Date(monday);
  targetDate.setDate(monday.getDate() + dayIndex);

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const displayDate = `${targetDate.getDate()} ${months[targetDate.getMonth()]}`;

  return { dateStr, displayDate };
}

/**
 * Genera ID univoco per la presenza di una specifica lezione
 */
export function generateAttendanceId(dateStr: string, subject: string, startTime: string): string {
  const cleanSubject = subject.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTime = startTime.trim().replace(/[^0-9]/g, '');
  return `${dateStr}_${cleanSubject}_${cleanTime}`;
}

/**
 * Recupera l'elenco di tutte le presenze salvate per il corso specificato (o quello attivo)
 */
export async function getAttendanceRecords(courseUrl?: string): Promise<AttendanceRecord[]> {
  try {
    const key = await getAttendanceStorageKey(courseUrl);
    let raw = await AsyncStorage.getItem(key);

    // Se la chiave specifica per il corso non esiste ancora, controlla se c'è una migrazione
    // da effettuare dalla chiave globale legacy
    if (!raw && key !== ATTENDANCE_STORAGE_KEY) {
      const legacyRaw = await AsyncStorage.getItem(ATTENDANCE_STORAGE_KEY);
      if (legacyRaw) {
        try {
          const parsedLegacy = JSON.parse(legacyRaw);
          if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
            // Migra i dati nel nuovo storage associato a questo corso
            await AsyncStorage.setItem(key, legacyRaw);
            raw = legacyRaw;
          }
        } catch {}
      }
    }

    if (!raw) return [];
    const list: AttendanceRecord[] = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Errore lettura presenze:', err);
    return [];
  }
}

/**
 * Salva l'elenco delle presenze su AsyncStorage per il corso specificato (o quello attivo)
 */
export async function saveAttendanceList(records: AttendanceRecord[], courseUrl?: string): Promise<void> {
  const key = await getAttendanceStorageKey(courseUrl);
  await AsyncStorage.setItem(key, JSON.stringify(records));
  notifyLocalChange();
}

/** Callback invocato dopo ogni modifica locale alle presenze (usato dalla sync cloud). */
let localChangeListener: (() => void) | null = null;
export function setAttendanceChangeListener(cb: (() => void) | null): void {
  localChangeListener = cb;
}
function notifyLocalChange(): void {
  try {
    localChangeListener?.();
  } catch {}
}

/** Elenco presenze eliminate (id → timestamp eliminazione) per il corso specificato o attivo */
export async function getAttendanceTombstones(courseUrl?: string): Promise<Record<string, number>> {
  try {
    const key = await getTombstonesStorageKey(courseUrl);
    let raw = await AsyncStorage.getItem(key);
    if (!raw && key !== TOMBSTONES_KEY) {
      const legacyRaw = await AsyncStorage.getItem(TOMBSTONES_KEY);
      if (legacyRaw) {
        await AsyncStorage.setItem(key, legacyRaw);
        raw = legacyRaw;
      }
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setAttendanceTombstones(t: Record<string, number>, courseUrl?: string): Promise<void> {
  const key = await getTombstonesStorageKey(courseUrl);
  await AsyncStorage.setItem(key, JSON.stringify(t));
}

async function addTombstones(ids: string[], courseUrl?: string): Promise<void> {
  if (ids.length === 0) return;
  const t = await getAttendanceTombstones(courseUrl);
  const now = Date.now();
  for (const id of ids) t[id] = now;
  await setAttendanceTombstones(t, courseUrl);
}

/**
 * Calcola la durata in ore di una lezione (default da startTime a endTime o cls.duration)
 */
export function calculateLessonDuration(startTime: string, endTime: string, defaultDuration?: number): number {
  if (defaultDuration && defaultDuration > 0) return defaultDuration;
  try {
    const [sH, sM] = startTime.split(':').map(Number);
    const [eH, eM] = endTime.split(':').map(Number);
    if (!isNaN(sH) && !isNaN(eH)) {
      const diffMinutes = (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0));
      return Math.max(1, Math.round(diffMinutes / 60));
    }
  } catch {}
  return 2;
}

/**
 * Segna o rimuove la presenza per una singola lezione (Toggle)
 */
export async function toggleAttendance(
  dayIndex: number,
  dayName: string,
  cls: ClassEvent,
  courseUrl?: string
): Promise<{ added: boolean; records: AttendanceRecord[] }> {
  const { dateStr, displayDate } = getDateForDayIndex(dayIndex);
  const id = generateAttendanceId(dateStr, cls.subject, cls.startTime);
  const currentRecords = await getAttendanceRecords(courseUrl);

  const existingIndex = currentRecords.findIndex(r => r.id === id);

  if (existingIndex >= 0) {
    // Rimuovi presenza
    currentRecords.splice(existingIndex, 1);
    await addTombstones([id], courseUrl);
    await saveAttendanceList(currentRecords, courseUrl);
    return { added: false, records: currentRecords };
  } else {
    // Aggiungi presenza
    const duration = calculateLessonDuration(cls.startTime, cls.endTime, cls.duration);
    const newRecord: AttendanceRecord = {
      id,
      date: dateStr,
      displayDate,
      dayIndex,
      dayName,
      subject: cls.subject,
      startTime: cls.startTime,
      endTime: cls.endTime,
      room: cls.room,
      teacher: cls.teacher,
      duration,
      timestamp: Date.now(),
    };
    const updated = [newRecord, ...currentRecords];
    await saveAttendanceList(updated, courseUrl);
    return { added: true, records: updated };
  }
}

/**
 * Segna o rimuove la presenza per tutte le lezioni di un giorno
 */
export async function toggleDayAttendance(
  dayIndex: number,
  dayName: string,
  classes: ClassEvent[],
  courseUrl?: string
): Promise<{ added: boolean; count: number; records: AttendanceRecord[] }> {
  if (!classes || classes.length === 0) {
    const list = await getAttendanceRecords(courseUrl);
    return { added: false, count: 0, records: list };
  }

  const { dateStr, displayDate } = getDateForDayIndex(dayIndex);
  const currentRecords = await getAttendanceRecords(courseUrl);

  // Verifica quante lezioni di questo giorno sono già presenti
  const idsForDay = classes.map(c => generateAttendanceId(dateStr, c.subject, c.startTime));
  const allAttended = idsForDay.every(id => currentRecords.some(r => r.id === id));

  let updatedList: AttendanceRecord[];
  let added = false;
  let count = 0;

  if (allAttended) {
    // Rimuovi tutte le presenze di questo giorno
    updatedList = currentRecords.filter(r => !idsForDay.includes(r.id));
    await addTombstones(idsForDay, courseUrl);
    added = false;
    count = idsForDay.length;
  } else {
    // Aggiungi tutte le lezioni mancanti
    const existingIds = new Set(currentRecords.map(r => r.id));
    const toAdd: AttendanceRecord[] = [];

    for (const cls of classes) {
      const id = generateAttendanceId(dateStr, cls.subject, cls.startTime);
      if (!existingIds.has(id)) {
        const duration = calculateLessonDuration(cls.startTime, cls.endTime, cls.duration);
        toAdd.push({
          id,
          date: dateStr,
          displayDate,
          dayIndex,
          dayName,
          subject: cls.subject,
          startTime: cls.startTime,
          endTime: cls.endTime,
          room: cls.room,
          teacher: cls.teacher,
          duration,
          timestamp: Date.now(),
        });
      }
    }
    updatedList = [...toAdd, ...currentRecords];
    added = true;
    count = toAdd.length;
  }

  await saveAttendanceList(updatedList, courseUrl);
  return { added, count, records: updatedList };
}

/**
 * Elimina una specifica presenza per ID
 */
export async function deleteAttendanceRecord(id: string, courseUrl?: string): Promise<AttendanceRecord[]> {
  const currentRecords = await getAttendanceRecords(courseUrl);
  const filtered = currentRecords.filter(r => r.id !== id);
  await addTombstones([id], courseUrl);
  await saveAttendanceList(filtered, courseUrl);
  return filtered;
}

/**
 * Resetta l'intero registro presenze
 */
export async function clearAllAttendance(courseUrl?: string): Promise<void> {
  const current = await getAttendanceRecords(courseUrl);
  await addTombstones(current.map(r => r.id), courseUrl);
  const key = await getAttendanceStorageKey(courseUrl);
  await AsyncStorage.removeItem(key);
  notifyLocalChange();
}

/**
 * Recupera tutte le presenze di tutte le facoltà (usato per backup e cloud sync multi-corso).
 */
export async function getAllAttendanceAcrossCourses(): Promise<Record<string, AttendanceRecord[]>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const attKeys = keys.filter(k => k.startsWith(`${ATTENDANCE_STORAGE_KEY}_`));
    const result: Record<string, AttendanceRecord[]> = {};

    if (attKeys.length > 0) {
      const pairs = await AsyncStorage.multiGet(attKeys);
      for (const [key, val] of pairs) {
        if (val) {
          const courseUrl = key.replace(`${ATTENDANCE_STORAGE_KEY}_`, '');
          try {
            result[courseUrl] = JSON.parse(val);
          } catch {}
        }
      }
    }

    // Se esiste la chiave legacy globale non ancora migrata
    const legacy = await AsyncStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (legacy && Object.keys(result).length === 0) {
      try {
        const activeUrl = (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
        result[activeUrl] = JSON.parse(legacy);
      } catch {}
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * Salva presenze multi-corso (usato per ripristino backup e cloud sync).
 */
export async function saveAllAttendanceAcrossCourses(
  map: Record<string, AttendanceRecord[]>
): Promise<void> {
  if (!map) return;
  try {
    const pairs: [string, string][] = Object.entries(map).map(([courseUrl, records]) => [
      `${ATTENDANCE_STORAGE_KEY}_${courseUrl}`,
      JSON.stringify(records),
    ]);
    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
      notifyLocalChange();
    }
  } catch (err) {
    console.error('Errore ripristino presenze multi-corso:', err);
  }
}

/**
 * Calcola statistiche aggregate per la schermata Profilo
 */
export function getAttendanceStats(records: AttendanceRecord[]): AttendanceStats {
  let totalHours = 0;
  const map: Record<string, { count: number; hours: number; lastDate: string }> = {};

  // Ordina dal più recente
  const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);

  for (const r of sorted) {
    const dur = r.duration || 2;
    totalHours += dur;

    const sub = r.subject.trim().toUpperCase();
    if (!map[sub]) {
      map[sub] = { count: 0, hours: 0, lastDate: r.displayDate || r.date };
    }
    map[sub].count += 1;
    map[sub].hours += dur;
  }

  const subjectStats: SubjectAttendanceStat[] = Object.keys(map).map(sub => ({
    subject: sub,
    count: map[sub].count,
    hours: map[sub].hours,
    lastDate: map[sub].lastDate,
  })).sort((a, b) => b.hours - a.hours);

  return {
    totalLessons: records.length,
    totalHours,
    subjectsCount: subjectStats.length,
    subjectStats,
    recentRecords: sorted.slice(0, 10),
  };
}
