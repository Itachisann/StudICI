import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClassEvent } from './scraper';

const ATTENDANCE_STORAGE_KEY = 'studici_attendance_records';

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
 * Recupera l'elenco di tutte le presenze salvate
 */
export async function getAttendanceRecords(): Promise<AttendanceRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (!raw) return [];
    const list: AttendanceRecord[] = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Errore lettura presenze:', err);
    return [];
  }
}

/**
 * Salva l'elenco delle presenze su AsyncStorage
 */
async function saveAttendanceList(records: AttendanceRecord[]): Promise<void> {
  await AsyncStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(records));
  notifyLocalChange();
}

const TOMBSTONES_KEY = 'studici_attendance_tombstones';

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

/** Elenco presenze eliminate (id → timestamp eliminazione), necessario per propagare le cancellazioni tra dispositivi */
export async function getAttendanceTombstones(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(TOMBSTONES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setAttendanceTombstones(t: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(TOMBSTONES_KEY, JSON.stringify(t));
}

async function addTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const t = await getAttendanceTombstones();
  const now = Date.now();
  for (const id of ids) t[id] = now;
  await setAttendanceTombstones(t);
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
  cls: ClassEvent
): Promise<{ added: boolean; records: AttendanceRecord[] }> {
  const { dateStr, displayDate } = getDateForDayIndex(dayIndex);
  const id = generateAttendanceId(dateStr, cls.subject, cls.startTime);
  const currentRecords = await getAttendanceRecords();

  const existingIndex = currentRecords.findIndex(r => r.id === id);

  if (existingIndex >= 0) {
    // Rimuovi presenza
    currentRecords.splice(existingIndex, 1);
    await addTombstones([id]);
    await saveAttendanceList(currentRecords);
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
    await saveAttendanceList(updated);
    return { added: true, records: updated };
  }
}

/**
 * Segna o rimuove la presenza per tutte le lezioni di un giorno
 */
export async function toggleDayAttendance(
  dayIndex: number,
  dayName: string,
  classes: ClassEvent[]
): Promise<{ added: boolean; count: number; records: AttendanceRecord[] }> {
  if (!classes || classes.length === 0) {
    const list = await getAttendanceRecords();
    return { added: false, count: 0, records: list };
  }

  const { dateStr, displayDate } = getDateForDayIndex(dayIndex);
  const currentRecords = await getAttendanceRecords();

  // Verifica quante lezioni di questo giorno sono già presenti
  const idsForDay = classes.map(c => generateAttendanceId(dateStr, c.subject, c.startTime));
  const allAttended = idsForDay.every(id => currentRecords.some(r => r.id === id));

  let updatedList: AttendanceRecord[];
  let added = false;
  let count = 0;

  if (allAttended) {
    // Rimuovi tutte le presenze di questo giorno
    updatedList = currentRecords.filter(r => !idsForDay.includes(r.id));
    await addTombstones(idsForDay);
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

  await saveAttendanceList(updatedList);
  return { added, count, records: updatedList };
}

/**
 * Elimina una specifica presenza per ID
 */
export async function deleteAttendanceRecord(id: string): Promise<AttendanceRecord[]> {
  const currentRecords = await getAttendanceRecords();
  const filtered = currentRecords.filter(r => r.id !== id);
  await addTombstones([id]);
  await saveAttendanceList(filtered);
  return filtered;
}

/**
 * Resetta l'intero registro presenze
 */
export async function clearAllAttendance(): Promise<void> {
  const current = await getAttendanceRecords();
  await addTombstones(current.map(r => r.id));
  await AsyncStorage.removeItem(ATTENDANCE_STORAGE_KEY);
  notifyLocalChange();
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
