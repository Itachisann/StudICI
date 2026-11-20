import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClassEvent } from './scraper';

const EXCLUDED_LESSONS_PREFIX = 'studici_excluded_lessons_';
const EXCLUDED_TOMBSTONES_PREFIX = 'studici_excluded_tombstones_';

export interface ExcludedLessonRecord {
  id: string; // `${dayIndex}_${cleanSubject}_${cleanStart}_${cleanEnd}`
  dayIndex: number; // 0=LUN, 1=MAR, 2=MER, 3=GIO, 4=VEN, 5=SAB, 6=DOM
  subject: string;
  startTime: string;
  endTime: string;
  room?: string;
  teacher?: string;
  isManual?: boolean;
  manualId?: string;
  tabUrl?: string;
  timestamp: number;
}

const excludedListeners = new Set<() => void>();
const excludedMemoryCache = new Map<string, ExcludedLessonRecord[]>();

export function clearExcludedLessonsMemoryCache(): void {
  excludedMemoryCache.clear();
}

export function getCachedExcludedLessons(courseUrl?: string | null): ExcludedLessonRecord[] | null {
  const key = `${EXCLUDED_LESSONS_PREFIX}${courseUrl || 'default'}`;
  return excludedMemoryCache.get(key) ?? null;
}

export function subscribeToExcludedLessonsChanges(cb: () => void): () => void {
  excludedListeners.add(cb);
  return () => {
    excludedListeners.delete(cb);
  };
}

export function setExcludedLessonsChangeListener(cb: (() => void) | null): void {
  if (cb) {
    excludedListeners.add(cb);
  }
}

export function notifyExcludedLessonsChanged(): void {
  try {
    for (const listener of excludedListeners) {
      try {
        listener();
      } catch (e) {
        console.warn('Errore listener lezioni barrate:', e);
      }
    }
  } catch {}
}

/**
 * Converte il giorno JS (0=DOM, 1=LUN..6=SAB) nell'indice calendario (0=LUN..5=SAB, 6=DOM).
 */
export function jsDayToScheduleDayIndex(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function normalizeExcludedSubject(subject?: string): string {
  return (subject || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeExcludedTime(time?: string): string {
  return (time || '').trim().replace(/[^0-9]/g, '');
}

/**
 * Genera l'ID canonico per uno specifico blocco lezione settimanale (giorno + orario + materia).
 */
export function generateExcludedLessonId(
  dayIndex: number,
  subject: string,
  startTime: string,
  endTime: string = ''
): string {
  const cleanSubject = normalizeExcludedSubject(subject);
  const cleanStart = normalizeExcludedTime(startTime);
  const cleanEnd = normalizeExcludedTime(endTime);
  return `${dayIndex}_${cleanSubject}_${cleanStart}_${cleanEnd}`;
}

export async function getExcludedLessonsKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
  return `${EXCLUDED_LESSONS_PREFIX}${url}`;
}

export async function getExcludedTombstonesKey(courseUrl?: string): Promise<string> {
  const url = courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
  return `${EXCLUDED_TOMBSTONES_PREFIX}${url}`;
}

export async function getExcludedLessons(
  courseUrl?: string
): Promise<ExcludedLessonRecord[]> {
  try {
    const key = await getExcludedLessonsKey(courseUrl);
    const cached = excludedMemoryCache.get(key);
    if (cached) return cached;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      excludedMemoryCache.set(key, []);
      return [];
    }
    const list: ExcludedLessonRecord[] = JSON.parse(raw);
    const resolved = Array.isArray(list) ? list : [];
    excludedMemoryCache.set(key, resolved);
    return resolved;
  } catch (err) {
    console.error('Errore lettura lezioni barrate:', err);
    return [];
  }
}

export async function saveExcludedLessonsList(
  records: ExcludedLessonRecord[],
  courseUrl?: string,
  silent = false
): Promise<void> {
  try {
    const key = await getExcludedLessonsKey(courseUrl);
    excludedMemoryCache.set(key, records);
    await AsyncStorage.setItem(key, JSON.stringify(records));
    if (!silent) {
      notifyExcludedLessonsChanged();
    }
  } catch (err) {
    console.error('Errore salvataggio lezioni barrate:', err);
  }
}

export async function getExcludedLessonsTombstones(
  courseUrl?: string
): Promise<Record<string, number>> {
  try {
    const key = await getExcludedTombstonesKey(courseUrl);
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setExcludedLessonsTombstones(
  tombstones: Record<string, number>,
  courseUrl?: string
): Promise<void> {
  try {
    const key = await getExcludedTombstonesKey(courseUrl);
    await AsyncStorage.setItem(key, JSON.stringify(tombstones));
  } catch {}
}

async function addExcludedTombstone(id: string, courseUrl?: string): Promise<void> {
  const t = await getExcludedLessonsTombstones(courseUrl);
  t[id] = Date.now();
  await setExcludedLessonsTombstones(t, courseUrl);
}

export async function clearExcludedTombstone(id: string, courseUrl?: string): Promise<void> {
  const t = await getExcludedLessonsTombstones(courseUrl);
  if (t[id]) {
    delete t[id];
    await setExcludedLessonsTombstones(t, courseUrl);
  }
}

export function buildExcludedIdSet(records?: ExcludedLessonRecord[] | null): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(records)) return set;
  for (const r of records) {
    if (!r) continue;
    set.add(
      r.id || generateExcludedLessonId(r.dayIndex, r.subject, r.startTime, r.endTime)
    );
  }
  return set;
}

export function isLessonExcluded(
  dayIndex: number,
  cls: Pick<ClassEvent, 'subject' | 'startTime' | 'endTime'>,
  excludedSet?: Set<string> | null
): boolean {
  if (!excludedSet || excludedSet.size === 0 || !cls) return false;
  const id = generateExcludedLessonId(
    dayIndex,
    cls.subject || '',
    cls.startTime || '',
    cls.endTime || ''
  );
  if (excludedSet.has(id)) return true;
  // Compatibilita' in caso di record senza endTime
  if (cls.endTime) {
    const idNoEnd = generateExcludedLessonId(
      dayIndex,
      cls.subject || '',
      cls.startTime || '',
      ''
    );
    if (excludedSet.has(idNoEnd)) return true;
  }
  return false;
}

/**
 * Attiva o rimuove lo stato "barrata" per uno specifico blocco lezione.
 */
export async function toggleExcludedLesson(
  dayIndex: number,
  cls: ClassEvent,
  courseUrl?: string,
  tabUrl?: string
): Promise<{ isExcluded: boolean; records: ExcludedLessonRecord[] }> {
  const activeCourse =
    courseUrl || (await AsyncStorage.getItem('selectedDegreeUrl')) || 'default';
  const id = generateExcludedLessonId(
    dayIndex,
    cls.subject || '',
    cls.startTime || '',
    cls.endTime || ''
  );
  const current = await getExcludedLessons(activeCourse);
  const existingIdx = current.findIndex((r) => r.id === id);

  if (existingIdx >= 0) {
    const next = current.filter((r) => r.id !== id);
    await addExcludedTombstone(id, activeCourse);
    await saveExcludedLessonsList(next, activeCourse);
    return { isExcluded: false, records: next };
  }

  const newRecord: ExcludedLessonRecord = {
    id,
    dayIndex,
    subject: cls.subject || '',
    startTime: cls.startTime || '',
    endTime: cls.endTime || '',
    room: cls.room,
    teacher: cls.teacher,
    isManual: Boolean(cls.isManual),
    manualId: cls.manualId,
    tabUrl,
    timestamp: Date.now(),
  };

  await clearExcludedTombstone(id, activeCourse);
  const next = [newRecord, ...current];
  await saveExcludedLessonsList(next, activeCourse);
  return { isExcluded: true, records: next };
}

export async function getAllExcludedLessonsAcrossCourses(): Promise<
  Record<string, ExcludedLessonRecord[]>
> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const targetKeys = keys.filter((k) => k.startsWith(EXCLUDED_LESSONS_PREFIX));
    const result: Record<string, ExcludedLessonRecord[]> = {};
    if (targetKeys.length > 0) {
      const pairs = await AsyncStorage.multiGet(targetKeys);
      for (const [key, val] of pairs) {
        if (!val) continue;
        const courseUrl = key.replace(EXCLUDED_LESSONS_PREFIX, '');
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            result[courseUrl] = parsed;
          }
        } catch {}
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveAllExcludedLessonsAcrossCourses(
  map: Record<string, ExcludedLessonRecord[]>,
  silent = false
): Promise<void> {
  if (!map) return;
  try {
    const pairs: [string, string][] = Object.entries(map).map(([courseUrl, records]) => [
      `${EXCLUDED_LESSONS_PREFIX}${courseUrl}`,
      JSON.stringify(records),
    ]);
    if (pairs.length > 0) {
      for (const [courseUrl, records] of Object.entries(map)) {
        excludedMemoryCache.set(`${EXCLUDED_LESSONS_PREFIX}${courseUrl}`, records);
      }
      await AsyncStorage.multiSet(pairs);
      if (!silent) {
        notifyExcludedLessonsChanged();
      }
    }
  } catch (err) {
    console.error('Errore salvataggio lezioni barrate multi-corso:', err);
  }
}
