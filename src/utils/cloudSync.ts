import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getAttendanceRecords,
  AttendanceRecord,
  getAttendanceTombstones,
  setAttendanceTombstones,
  setAttendanceChangeListener,
} from './attendance';
import { SYNC_DB_URL } from '../config/syncConfig';

const CLOUD_SYNC_ID_KEY = 'studici_cloud_sync_id';
const LAST_CLOUD_SYNC_KEY = 'studici_last_cloud_sync';
const CLOUD_BACKUP_DATA_KEY = 'studici_cloud_backup_data';
const ICLOUD_AUTO_SYNC_KEY = 'studici_icloud_auto_sync_enabled';
const ICLOUD_BACKUP_FILENAME = 'studici_icloud_sync.json';

export interface CloudBackupPayload {
  syncId: string;
  version: string;
  timestamp: number;
  formattedDate: string;
  course: {
    url: string | null;
    name: string | null;
    className: string | null;
    defaultTabUrl: string | null;
  };
  attendanceRecords: AttendanceRecord[];
}

const SYNC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChunk(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SYNC_ALPHABET[Math.floor(Math.random() * SYNC_ALPHABET.length)];
  }
  return out;
}

/** Normalizza un codice digitato dall'utente (spazi, minuscole) */
export function normalizeSyncCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidSyncCode(code: string): boolean {
  const norm = normalizeSyncCode(code);
  return /^[A-Z0-9_-]{3,40}$/i.test(norm);
}

/**
 * Ottiene o genera il Codice Dispositivo univoco (es. STUD-K7M2-9QXA-4TPB).
 * 12 caratteri casuali: non indovinabile, funge da "chiave" del tuo spazio cloud.
 */
export async function getCloudSyncId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(CLOUD_SYNC_ID_KEY);
    if (!id || !isValidSyncCode(id)) {
      // Genera (o migra dal vecchio formato STUD-1234-5678, troppo corto e non sicuro)
      id = `STUD-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
      await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, id);
    }
    return id;
  } catch {
    return 'STUD-0000-0000-0000';
  }
}

/**
 * Permette di impostare un codice personalizzato (es. nickname o matricola)
 */
export async function setCustomCloudSyncId(newId: string): Promise<boolean> {
  const norm = normalizeSyncCode(newId);
  if (!isValidSyncCode(norm)) return false;
  await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, norm);
  await syncWithICloudStorage();
  return true;
}


/**
 * Ritorna il timestamp dell'ultima sincronizzazione cloud (in ms)
 */
export async function getLastCloudSync(): Promise<number | null> {
  try {
    const val = await AsyncStorage.getItem(LAST_CLOUD_SYNC_KEY);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Esegue la sincronizzazione Cloud:
 * Raccoglie i dati attuali (corso, canale, presenze), genera il payload cifrato/codificato e aggiorna il timestamp.
 */
export async function performCloudSync(): Promise<{
  success: boolean;
  syncId: string;
  timestamp: number;
  message: string;
  backupCode: string;
  payload: CloudBackupPayload;
}> {
  const syncId = await getCloudSyncId();
  const timestamp = Date.now();
  const formattedDate = new Date(timestamp).toLocaleString('it-IT');

  const [url, name, className, defaultTabUrl, records] = await Promise.all([
    AsyncStorage.getItem('selectedDegreeUrl'),
    AsyncStorage.getItem('selectedDegreeName'),
    AsyncStorage.getItem('selectedDegreeClassName'),
    AsyncStorage.getItem('defaultTabUrl'),
    getAttendanceRecords(),
  ]);

  const payload: CloudBackupPayload = {
    syncId,
    version: '1.5.3',
    timestamp,
    formattedDate,
    course: {
      url,
      name,
      className,
      defaultTabUrl,
    },
    attendanceRecords: records,
  };

  const jsonStr = JSON.stringify(payload);
  await AsyncStorage.setItem(CLOUD_BACKUP_DATA_KEY, jsonStr);
  await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, timestamp.toString());

  try {
    const filePath = `${FileSystem.documentDirectory}${ICLOUD_BACKUP_FILENAME}`;
    await FileSystem.writeAsStringAsync(filePath, jsonStr);
  } catch {
    // Non interrompere se il filesystem è temporaneamente occupato
  }

  // Codice compatto di ripristino cloud per passaggio rapido tra dispositivi
  const backupCode = `STUDICI_CLOUD:${btoa(unescape(encodeURIComponent(jsonStr)))}`;

  return {
    success: true,
    syncId,
    timestamp,
    message: `Sincronizzazione Cloud completata con successo! Salvate ${records.length} presenze e configurazione corso.`,
    backupCode,
    payload,
  };
}

/**
 * Copia il codice di sincronizzazione cloud negli appunti per trasferirlo su un altro dispositivo
 */
export async function copyCloudSyncCodeToClipboard(): Promise<string> {
  const res = await performCloudSync();
  await Clipboard.setStringAsync(res.backupCode);
  return res.backupCode;
}

/**
 * Ripristina i dati da un codice di sincronizzazione o payload JSON
 */
export async function restoreFromCloudBackup(codeOrJson: string): Promise<{
  success: boolean;
  message: string;
  courseName?: string;
  recordsCount?: number;
}> {
  try {
    let clean = codeOrJson.trim();
    let jsonStr = '';

    if (clean.startsWith('STUDICI_CLOUD:')) {
      const b64 = clean.replace('STUDICI_CLOUD:', '').trim();
      jsonStr = decodeURIComponent(escape(atob(b64)));
    } else {
      jsonStr = clean;
    }

    const data: CloudBackupPayload = JSON.parse(jsonStr);

    if (!data || !data.course) {
      throw new Error('Formato di backup non valido.');
    }

    if (data.course.url) {
      await AsyncStorage.setItem('selectedDegreeUrl', data.course.url);
    }
    if (data.course.name) {
      await AsyncStorage.setItem('selectedDegreeName', data.course.name);
    }
    if (data.course.className) {
      await AsyncStorage.setItem('selectedDegreeClassName', data.course.className);
    }
    if (data.course.defaultTabUrl) {
      await AsyncStorage.setItem('defaultTabUrl', data.course.defaultTabUrl);
    }

    if (Array.isArray(data.attendanceRecords)) {
      await AsyncStorage.setItem('studici_attendance_records', JSON.stringify(data.attendanceRecords));
    }

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, timestamp.toString());

    try {
      const filePath = `${FileSystem.documentDirectory}${ICLOUD_BACKUP_FILENAME}`;
      await FileSystem.writeAsStringAsync(filePath, jsonStr);
    } catch {
      // Non bloccare
    }

    return {
      success: true,
      message: `Ripristino completato con successo: ${data.course.name || 'Corso'} e ${data.attendanceRecords?.length || 0} presenze ripristinate.`,
      courseName: data.course.name || undefined,
      recordsCount: data.attendanceRecords?.length || 0,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Codice o file di backup non valido.',
    };
  }
}

/**
 * Verifica se la sincronizzazione automatica iCloud è abilitata
 */
export async function getICloudAutoSyncEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ICLOUD_AUTO_SYNC_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Attiva o disattiva la sincronizzazione automatica tra dispositivi
 */
export async function setICloudAutoSyncEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ICLOUD_AUTO_SYNC_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.error('Error saving auto sync setting:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione reale tra dispositivi (Firebase Realtime Database via REST)
// ─────────────────────────────────────────────────────────────────────────────

const COURSE_MODIFIED_KEY = 'studici_course_modified_at';
const COURSE_SNAPSHOT_KEY = 'studici_course_snapshot';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface CourseData {
  url: string | null;
  name: string | null;
  className: string | null;
  defaultTabUrl: string | null;
}

interface RemoteDoc {
  updatedAt?: number;
  course?: Partial<CourseData>;
  courseModified?: number;
  attendance?: AttendanceRecord[];
  tombstones?: Record<string, number>;
}

export interface CloudSyncResult {
  success: boolean;
  message: string;
  updated: boolean;
}

/** True se il backend cloud è stato configurato in src/config/syncConfig.ts */
export function isCloudConfigured(): boolean {
  return SYNC_DB_URL.trim().length > 0;
}

function remoteUrl(syncId: string): string {
  return `${SYNC_DB_URL.replace(/\/+$/, '')}/sync/${syncId}.json`;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemote(syncId: string): Promise<RemoteDoc | null> {
  const res = await fetchWithTimeout(remoteUrl(syncId));
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Accesso al database negato: controlla le regole di Firebase (vedi README).'
        : `Errore server cloud (${res.status}).`
    );
  }
  const json = await res.json();
  return json && typeof json === 'object' ? (json as RemoteDoc) : null;
}

async function pushRemote(syncId: string, doc: RemoteDoc): Promise<void> {
  const res = await fetchWithTimeout(remoteUrl(syncId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    throw new Error(`Impossibile salvare sul cloud (${res.status}).`);
  }
}

function normalizeCourse(c?: Partial<CourseData> | null): CourseData {
  return {
    url: c?.url ?? null,
    name: c?.name ?? null,
    className: c?.className ?? null,
    defaultTabUrl: c?.defaultTabUrl ?? null,
  };
}

async function readLocalCourse(): Promise<CourseData> {
  const [url, name, className, defaultTabUrl] = await Promise.all([
    AsyncStorage.getItem('selectedDegreeUrl'),
    AsyncStorage.getItem('selectedDegreeName'),
    AsyncStorage.getItem('selectedDegreeClassName'),
    AsyncStorage.getItem('defaultTabUrl'),
  ]);
  return { url, name, className, defaultTabUrl };
}

async function writeLocalCourse(c: CourseData): Promise<void> {
  const pairs: [string, string | null][] = [
    ['selectedDegreeUrl', c.url],
    ['selectedDegreeName', c.name],
    ['selectedDegreeClassName', c.className],
    ['defaultTabUrl', c.defaultTabUrl],
  ];
  for (const [key, val] of pairs) {
    if (val) await AsyncStorage.setItem(key, val);
    else await AsyncStorage.removeItem(key);
  }
}

function idsKey(list: AttendanceRecord[]): string {
  return list
    .map((r) => `${r.id}:${r.timestamp}`)
    .sort()
    .join('|');
}

let syncInFlight: Promise<CloudSyncResult> | null = null;

async function runSync(): Promise<CloudSyncResult> {
  if (!isCloudConfigured()) {
    return {
      success: false,
      updated: false,
      message: 'Sincronizzazione cloud non configurata in questa build.',
    };
  }

  try {
    const syncId = await getCloudSyncId();
    const remote = await fetchRemote(syncId);

    // ── Corso / canale predefinito: vince la modifica più recente ──
    const localCourse = await readLocalCourse();
    const localSnap = await AsyncStorage.getItem(COURSE_SNAPSHOT_KEY);
    let localMod = parseInt((await AsyncStorage.getItem(COURSE_MODIFIED_KEY)) || '0', 10) || 0;
    if (JSON.stringify(localCourse) !== localSnap) {
      localMod = localCourse.url ? Date.now() : 0;
    }

    const remoteMod = remote?.courseModified || 0;
    const remoteCourse = normalizeCourse(remote?.course);
    let finalCourse = localCourse;
    let finalMod = localMod;
    let courseChanged = false;
    if (remoteCourse.url && remoteMod > localMod) {
      courseChanged = JSON.stringify(remoteCourse) !== JSON.stringify(localCourse);
      if (courseChanged) await writeLocalCourse(remoteCourse);
      finalCourse = remoteCourse;
      finalMod = remoteMod;
    }
    await AsyncStorage.setItem(COURSE_SNAPSHOT_KEY, JSON.stringify(finalCourse));
    await AsyncStorage.setItem(COURSE_MODIFIED_KEY, String(finalMod));

    // ── Presenze: unione per ID con tombstone per le cancellazioni ──
    const localAtt = await getAttendanceRecords();
    const remoteAtt: AttendanceRecord[] = Array.isArray(remote?.attendance)
      ? remote!.attendance!.filter(Boolean)
      : [];
    const localTomb = await getAttendanceTombstones();
    const remoteTomb = remote?.tombstones || {};

    const now = Date.now();
    const tombstones: Record<string, number> = {};
    for (const src of [localTomb, remoteTomb]) {
      for (const [id, ts] of Object.entries(src)) {
        if (now - ts > TOMBSTONE_TTL_MS) continue;
        tombstones[id] = Math.max(tombstones[id] || 0, ts);
      }
    }

    const byId = new Map<string, AttendanceRecord>();
    for (const r of [...remoteAtt, ...localAtt]) {
      const prev = byId.get(r.id);
      if (!prev || (r.timestamp || 0) > (prev.timestamp || 0)) byId.set(r.id, r);
    }
    const merged = Array.from(byId.values())
      .filter((r) => !(tombstones[r.id] && tombstones[r.id] >= (r.timestamp || 0)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const attChanged = idsKey(merged) !== idsKey(localAtt);
    if (attChanged) {
      await AsyncStorage.setItem('studici_attendance_records', JSON.stringify(merged));
    }
    await setAttendanceTombstones(tombstones);

    // ── Pubblica sul cloud solo se qualcosa è cambiato ──
    const needPush =
      !remote ||
      idsKey(remoteAtt) !== idsKey(merged) ||
      Object.keys(remoteTomb).length !== Object.keys(tombstones).length ||
      remoteMod !== finalMod ||
      JSON.stringify(remoteCourse) !== JSON.stringify(finalCourse);

    if (needPush) {
      await pushRemote(syncId, {
        updatedAt: now,
        course: finalCourse,
        courseModified: finalMod,
        attendance: merged,
        tombstones,
      });
    }

    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(now));
    const updated = attChanged || courseChanged;
    return {
      success: true,
      updated,
      message: updated
        ? 'Dati sincronizzati dagli altri tuoi dispositivi!'
        : needPush
          ? 'Cloud aggiornato con i dati di questo dispositivo.'
          : 'Tutto già sincronizzato.',
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      success: false,
      updated: false,
      message: aborted
        ? 'Nessuna risposta dal cloud: controlla la connessione.'
        : err?.message || 'Errore durante la sincronizzazione cloud.',
    };
  }
}

/**
 * Sincronizzazione bidirezionale con il cloud (merge di corso, canale e presenze).
 * Nome storico mantenuto per compatibilità con le schermate esistenti.
 */
export function syncWithICloudStorage(): Promise<CloudSyncResult> {
  if (!syncInFlight) {
    syncInFlight = runSync().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

/**
 * Collega questo dispositivo a uno spazio cloud esistente tramite Codice Dispositivo
 * (generato su un altro dispositivo) e scarica subito i dati.
 */
export async function linkDeviceWithCode(rawCode: string): Promise<CloudSyncResult> {
  if (!isCloudConfigured()) {
    return {
      success: false,
      updated: false,
      message: 'Sincronizzazione cloud non configurata in questa build.',
    };
  }
  const code = normalizeSyncCode(rawCode);
  if (!isValidSyncCode(code)) {
    return {
      success: false,
      updated: false,
      message: 'Codice non valido. Deve contenere da 3 a 40 caratteri alfanumerici.',
    };
  }
  const previousId = await getCloudSyncId();
  try {
    const remote = await fetchRemote(code);
    if (!remote) {
      return {
        success: false,
        updated: false,
        message: 'Codice non trovato. Esegui prima una sincronizzazione sull\'altro dispositivo.',
      };
    }
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, code);
    const res = await syncWithICloudStorage();
    if (!res.success) {
      await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, previousId);
      return res;
    }
    return {
      success: true,
      updated: true,
      message: 'Dispositivo collegato! Dati sincronizzati.',
    };
  } catch (err: any) {
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, previousId);
    return {
      success: false,
      updated: false,
      message:
        err?.name === 'AbortError'
          ? 'Nessuna risposta dal cloud: controlla la connessione.'
          : err?.message || 'Impossibile collegare il dispositivo.',
    };
  }
}

// Invio automatico (con debounce) dopo ogni modifica locale alle presenze
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;
setAttendanceChangeListener(() => {
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    autoPushTimer = null;
    try {
      if ((await getICloudAutoSyncEnabled()) && isCloudConfigured()) {
        await syncWithICloudStorage();
      }
    } catch {}
  }, 1500);
});
