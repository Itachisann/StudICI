import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateLessonDuration } from './attendance';
import { ClassEvent } from './scraper';

export type ManualEventRepetition = 'semester' | 'custom_date' | 'single';

export interface ManualClassEvent {
  id: string;
  courseUrl: string;
  subject: string;
  teacher?: string;
  room?: string;
  building?: string;
  address?: string;
  dayIndex: number; // 0=LUN, 1=MAR, 2=MER, 3=GIO, 4=VEN, 5=SAB, 6=DOM
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  duration?: number;
  repetitionType: ManualEventRepetition;
  startDate: string; // "YYYY-MM-DD"
  repeatUntilDate?: string; // "YYYY-MM-DD" (se custom_date o semester)
  createdAt: number;
  updatedAt?: number;
}

const MANUAL_EVENTS_PREFIX = 'studici_manual_events_';
const MANUAL_TOMBSTONES_PREFIX = 'studici_manual_tombstones_';

let manualChangeListener: (() => void) | null = null;

export function setManualEventsChangeListener(cb: (() => void) | null): void {
  manualChangeListener = cb;
}

function notifyManualChange(): void {
  try {
    manualChangeListener?.();
  } catch {}
}

/**
 * Calcola la data stimata di fine semestre universitario a Sapienza:
 * - Se ci troviamo nel I semestre (Settembre - Febbraio): fine ~ 28 Febbraio.
 * - Se ci troviamo nel II semestre (Marzo - Luglio): fine ~ 31 Luglio.
 * - Agosto: fine ~ 28 Febbraio dell'anno successivo.
 */
export function getDefaultSemesterEndDate(fromDate: Date = new Date()): string {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth(); // 0 = Jan, 1 = Feb, ..., 11 = Dec

  let endYear = year;
  let endMonth = 1; // Feb (0-indexed)
  let endDay = 28;

  if (month >= 8) {
    // Settembre - Dicembre -> finisce a fine Febbraio dell'anno dopo
    endYear = year + 1;
    endMonth = 1;
    endDay = 28;
  } else if (month <= 1) {
    // Gennaio - Febbraio -> finisce a fine Febbraio dell'anno in corso
    endYear = year;
    endMonth = 1;
    endDay = 28;
  } else if (month >= 2 && month <= 6) {
    // Marzo - Luglio -> finisce a fine Luglio dell'anno in corso
    endYear = year;
    endMonth = 6;
    endDay = 31;
  } else {
    // Agosto -> finisce a fine Febbraio dell'anno dopo
    endYear = year + 1;
    endMonth = 1;
    endDay = 28;
  }

  const mm = String(endMonth + 1).padStart(2, '0');
  const dd = String(endDay).padStart(2, '0');
  return `${endYear}-${mm}-${dd}`;
}

/**
 * Risolve la chiave di storage per gli orari manuali del corso specificato (o attivo).
 */
export async function getManualEventsKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
  return `${MANUAL_EVENTS_PREFIX}${url}`;
}

export async function getManualTombstonesKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
  return `${MANUAL_TOMBSTONES_PREFIX}${url}`;
}

/**
 * Recupera l'elenco degli orari manuali per un dato corso (o quello attivo).
 */
export async function getManualEvents(courseUrl?: string): Promise<ManualClassEvent[]> {
  try {
    const key = await getManualEventsKey(courseUrl);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const list: ManualClassEvent[] = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Errore lettura lezioni manuali:', err);
    return [];
  }
}

/**
 * Salva l'elenco degli orari manuali per un dato corso (o quello attivo).
 */
export async function saveManualEvents(
  events: ManualClassEvent[],
  courseUrl?: string
): Promise<void> {
  try {
    const key = await getManualEventsKey(courseUrl);
    await AsyncStorage.setItem(key, JSON.stringify(events));
    notifyManualChange();
  } catch (err) {
    console.error('Errore salvataggio lezioni manuali:', err);
  }
}

export async function getManualEventsTombstones(
  courseUrl?: string
): Promise<Record<string, number>> {
  try {
    const key = await getManualTombstonesKey(courseUrl);
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setManualEventsTombstones(
  t: Record<string, number>,
  courseUrl?: string
): Promise<void> {
  try {
    const key = await getManualTombstonesKey(courseUrl);
    await AsyncStorage.setItem(key, JSON.stringify(t));
  } catch {}
}

async function addManualTombstones(ids: string[], courseUrl?: string): Promise<void> {
  if (ids.length === 0) return;
  const t = await getManualEventsTombstones(courseUrl);
  const now = Date.now();
  for (const id of ids) t[id] = now;
  await setManualEventsTombstones(t, courseUrl);
}

/**
 * Aggiunge un nuovo orario manuale.
 */
export async function addManualEvent(
  data: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'> & { courseUrl?: string },
  courseUrl?: string
): Promise<ManualClassEvent> {
  const activeCourse = courseUrl || data.courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || '';
  const now = Date.now();
  const id = `manual_${now}_${Math.random().toString(36).substring(2, 8)}`;
  
  const newEvent: ManualClassEvent = {
    ...data,
    id,
    courseUrl: activeCourse,
    createdAt: now,
    updatedAt: now,
  };

  const list = await getManualEvents(activeCourse);
  const updated = [newEvent, ...list];
  await saveManualEvents(updated, activeCourse);
  return newEvent;
}

/**
 * Aggiorna un orario manuale esistente.
 */
export async function updateManualEvent(
  event: ManualClassEvent,
  courseUrl?: string
): Promise<void> {
  const activeCourse = courseUrl || event.courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || '';
  const list = await getManualEvents(activeCourse);
  const updated = list.map(item => (item.id === event.id ? { ...event, updatedAt: Date.now() } : item));
  await saveManualEvents(updated, activeCourse);
}

/**
 * Elimina un orario manuale per ID.
 */
export async function deleteManualEvent(id: string, courseUrl?: string): Promise<void> {
  const activeCourse = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || '';
  const list = await getManualEvents(activeCourse);
  const filtered = list.filter(item => item.id !== id);
  await addManualTombstones([id], activeCourse);
  await saveManualEvents(filtered, activeCourse);
}

/**
 * Verifica se un orario manuale è attivo per una specifica data (YYYY-MM-DD).
 */
export function isManualEventActiveOnDate(event: ManualClassEvent, dateStr: string): boolean {
  if (!event) return false;

  if (event.repetitionType === 'single') {
    return event.startDate === dateStr;
  }

  if (event.repetitionType === 'custom_date') {
    if (dateStr < event.startDate) return false;
    if (event.repeatUntilDate && dateStr > event.repeatUntilDate) return false;
    return true;
  }

  if (event.repetitionType === 'semester') {
    if (dateStr < event.startDate) return false;
    const semesterEnd = event.repeatUntilDate || getDefaultSemesterEndDate(new Date(event.startDate));
    if (dateStr > semesterEnd) return false;
    return true;
  }

  return true;
}

/**
 * Converte un ManualClassEvent in un ClassEvent utilizzabile dal layout e card dell'app.
 */
export function manualEventToClassEvent(event: ManualClassEvent): ClassEvent {
  const duration = event.duration && event.duration > 0
    ? event.duration
    : calculateLessonDuration(event.startTime, event.endTime);

  return {
    subject: event.subject,
    teacher: event.teacher || '',
    room: event.room || '',
    building: event.building,
    address: event.address,
    startTime: event.startTime,
    endTime: event.endTime,
    duration,
    isManual: true,
    manualId: event.id,
    repetitionType: event.repetitionType,
    repeatUntilDate: event.repeatUntilDate,
  };
}

/**
 * Recupera tutte le lezioni manuali di tutte le facoltà (usato per backup e sync cloud).
 */
export async function getAllManualEventsAcrossCourses(): Promise<Record<string, ManualClassEvent[]>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const manualKeys = keys.filter(k => k.startsWith(MANUAL_EVENTS_PREFIX));
    if (manualKeys.length === 0) return {};

    const pairs = await AsyncStorage.multiGet(manualKeys);
    const result: Record<string, ManualClassEvent[]> = {};

    for (const [key, value] of pairs) {
      if (value) {
        const courseUrl = key.replace(MANUAL_EVENTS_PREFIX, '');
        try {
          result[courseUrl] = JSON.parse(value);
        } catch {}
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Salva lezioni manuali multi-corso (usato per ripristino backup e cloud sync).
 */
export async function saveAllManualEventsAcrossCourses(
  map: Record<string, ManualClassEvent[]>
): Promise<void> {
  if (!map) return;
  try {
    const pairs: [string, string][] = Object.entries(map).map(([courseUrl, events]) => [
      `${MANUAL_EVENTS_PREFIX}${courseUrl}`,
      JSON.stringify(events),
    ]);
    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
      notifyManualChange();
    }
  } catch (err) {
    console.error('Errore ripristino lezioni manuali multi-corso:', err);
  }
}
