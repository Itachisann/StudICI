import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { refreshAppleCalendarIfConfigured } from './appleCalendar';
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
const LOCAL_DEVICE_ID_KEY = 'studici_local_device_instance_id';

export interface SyncDeviceInfo {
  id: string;
  name: string;
  model: string;
  platform: string;
  osVersion: string;
  pairedAt: number;
  lastActive: number;
}

export interface PairedDevicesStatus {
  myDevice: SyncDeviceInfo;
  otherDevices: SyncDeviceInfo[];
  otherDevice: SyncDeviceInfo | null;
  isPaired: boolean;
  totalDevices: number;
}

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

/** Normalizza un codice digitato dall'utente (spazi, minuscole) */
export function normalizeSyncCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidSyncCode(code: string): boolean {
  const norm = normalizeSyncCode(code);
  return /^[A-Z0-9_-]{3,40}$/i.test(norm);
}

/**
 * Genera il codice iniziale nel formato richiesto:
 * ST + 4 NUMERI + 1 LETTERA (es. ST4928X).
 */
export function generateInitialSyncCode(): string {
  let digits = '';
  for (let i = 0; i < 4; i++) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter = letters[Math.floor(Math.random() * letters.length)];
  return `ST${digits}${letter}`;
}

export async function generateUniqueInitialSyncCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInitialSyncCode();
    try {
      const existing = await fetchRemote(candidate);
      if (!existing || !existing.devices || Object.keys(existing.devices).length === 0) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return generateInitialSyncCode();
}

/**
 * Ottiene o genera il Codice Dispositivo univoco (formato ST + 4 cifre + 1 lettera, es. ST7412K).
 */
export async function getCloudSyncId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(CLOUD_SYNC_ID_KEY);
    if (!id || !isValidSyncCode(id) || id.startsWith('STUD-')) {
      id = await generateUniqueInitialSyncCode();
      await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, id);
    }
    return id.toUpperCase();
  } catch {
    return 'ST1000A';
  }
}

/**
 * Permette di impostare un codice/nome personalizzato.
 * Include il controllo di non-conflittualità: non si possono inserire nomi già esistenti usati da altri.
 */
export async function setCustomCloudSyncId(
  newId: string
): Promise<{ success: boolean; message: string }> {
  const norm = normalizeSyncCode(newId);
  if (!isValidSyncCode(norm)) {
    return {
      success: false,
      message: 'Il nome deve contenere tra 3 e 40 caratteri (lettere e numeri).',
    };
  }

  const currentId = await getCloudSyncId();
  if (norm === currentId) {
    return { success: true, message: 'Nome già impostato.' };
  }

  // Non-conflittualità: verifica se il nome è già registrato sul cloud da altri dispositivi
  try {
    const existing = await fetchRemote(norm);
    if (existing && existing.devices) {
      const myDevice = await getLocalDeviceInfo();
      const otherDevices = Object.values(existing.devices).filter(
        (d) => d && d.id !== myDevice.id
      );
      if (otherDevices.length > 0 && !existing.devices[myDevice.id]) {
        return {
          success: false,
          message: `Il nome "${norm}" è già in uso da un altro utente. Scegli un nome diverso o usa il campo "Collega" per unirti ad esso.`,
        };
      }
    }
  } catch {
    // continua in assenza di rete o se non trovato
  }

  await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, norm);
  await syncWithICloudStorage();
  return {
    success: true,
    message: `Codice aggiornato a "${norm}". Ora i tuoi dati sono salvati in questo spazio.`,
  };
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
    version: '1.5.6',
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
  devices?: Record<string, SyncDeviceInfo>;
}

export interface CloudSyncResult {
  success: boolean;
  message: string;
  updated: boolean;
  notPaired?: boolean;
  partnerName?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Dispositivo locale & Gestione Associazione (Pairing)
// ─────────────────────────────────────────────────────────────────────────────

export async function getLocalDeviceId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(LOCAL_DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await AsyncStorage.setItem(LOCAL_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev_${Date.now().toString(36)}`;
  }
}

export function getFriendlyDeviceName(): string {
  if (Device.deviceName && Device.deviceName !== 'iPhone' && Device.deviceName !== 'iPad') {
    return Device.deviceName;
  }
  if (Device.modelName) {
    return Device.modelName;
  }
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Dispositivo Android' : 'Dispositivo';
}

/**
 * Garantisce la non-conflittualità dei nomi dei dispositivi all'interno dello stesso gruppo.
 * Se esiste già un dispositivo con lo stesso nome, aggiunge un suffisso progressivo (es. "iPhone (2)").
 */
export function ensureUniqueDeviceName(
  candidateName: string,
  existingDevices: SyncDeviceInfo[],
  myDeviceId: string
): string {
  const otherNames = existingDevices
    .filter((d) => d && d.id !== myDeviceId)
    .map((d) => (d.name || '').trim().toLowerCase());

  let name = candidateName.trim();
  if (!otherNames.includes(name.toLowerCase())) {
    return name;
  }

  let counter = 2;
  while (otherNames.includes(`${name.toLowerCase()} (${counter})`)) {
    counter++;
  }
  return `${name} (${counter})`;
}

export async function getLocalDeviceInfo(): Promise<SyncDeviceInfo> {
  const id = await getLocalDeviceId();
  const name = getFriendlyDeviceName();
  const model = Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Dispositivo');
  const platform = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web';
  const osVersion = Device.osVersion || '';
  return {
    id,
    name,
    model,
    platform,
    osVersion,
    pairedAt: Date.now(),
    lastActive: Date.now(),
  };
}

export async function getPairedDevicesInfo(): Promise<PairedDevicesStatus> {
  const myDevice = await getLocalDeviceInfo();
  if (!isCloudConfigured()) {
    return { myDevice, otherDevices: [], otherDevice: null, isPaired: false, totalDevices: 1 };
  }
  try {
    const syncId = await getCloudSyncId();
    const remote = await fetchRemote(syncId);
    if (!remote || !remote.devices) {
      return { myDevice, otherDevices: [], otherDevice: null, isPaired: false, totalDevices: 0 };
    }
    const devicesMap: Record<string, SyncDeviceInfo> =
      typeof remote.devices === 'object' ? remote.devices : {};
    const registeredMy = devicesMap[myDevice.id] || myDevice;
    const others = Object.values(devicesMap).filter((d) => d && d.id !== myDevice.id);
    const otherDevice = others.length > 0 ? others[0] : null;

    return {
      myDevice: registeredMy,
      otherDevices: others,
      otherDevice,
      isPaired: others.length > 0,
      totalDevices: Object.keys(devicesMap).length,
    };
  } catch {
    return { myDevice, otherDevices: [], otherDevice: null, isPaired: false, totalDevices: 1 };
  }
}

export async function isDevicePaired(): Promise<boolean> {
  const status = await getPairedDevicesInfo();
  return status.isPaired;
}

/**
 * Dissocia questo dispositivo o un altro dispositivo associato.
 * Interrompe la sincronizzazione con il dispositivo specificato o resetta questo dispositivo.
 */
export async function dissociateDevice(targetDeviceId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const syncId = await getCloudSyncId();
    const myDevice = await getLocalDeviceInfo();
    const remote = await fetchRemote(syncId);

    if (remote && remote.devices) {
      const updatedDevices = { ...remote.devices };

      // Se rimuoviamo nello specifico l'altro dispositivo
      if (targetDeviceId && targetDeviceId !== myDevice.id) {
        delete updatedDevices[targetDeviceId];
        await pushRemote(syncId, {
          ...remote,
          updatedAt: Date.now(),
          devices: updatedDevices,
        });
        const remaining = Object.values(updatedDevices).filter((d) => d && d.id !== myDevice.id);
        await notifyLiveSyncListeners(true);
        return {
          success: true,
          message:
            remaining.length > 0
              ? 'Dispositivo associato rimosso con successo. La sincronizzazione rimane attiva con gli altri dispositivi.'
              : 'Dispositivo associato rimosso con successo. La sincronizzazione è ora disattivata.',
        };
      }

      // Altrimenti stiamo dissociando questo dispositivo
      delete updatedDevices[myDevice.id];
      await pushRemote(syncId, {
        ...remote,
        updatedAt: Date.now(),
        devices: updatedDevices,
      });
    }

    // Genera un nuovo ID (formato ST+4 cifre+lettera) per questo dispositivo per scollegarlo
    const newId = await generateUniqueInitialSyncCode();
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, newId);

    // Registra questo dispositivo nel suo nuovo spazio privato non associato
    await pushRemote(newId, {
      updatedAt: Date.now(),
      course: await readLocalCourse(),
      courseModified: Date.now(),
      attendance: await getAttendanceRecords(),
      tombstones: await getAttendanceTombstones(),
      devices: {
        [myDevice.id]: {
          ...myDevice,
          pairedAt: Date.now(),
          lastActive: Date.now(),
        },
      },
    });

    await notifyLiveSyncListeners(true);
    return {
      success: true,
      message: 'Dispositivo dissociato con successo. La sincronizzazione è ora disattivata.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Errore durante la dissociazione.',
    };
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
    const myDevice = await getLocalDeviceInfo();

    // Mappa dispositivi registrati nel cloud
    const devicesMap: Record<string, SyncDeviceInfo> =
      remote?.devices && typeof remote.devices === 'object'
        ? { ...remote.devices }
        : {};

    // Aggiorna lo stato e l'attività di questo dispositivo con nome non in conflitto
    const uniqueName = ensureUniqueDeviceName(
      myDevice.name,
      Object.values(devicesMap),
      myDevice.id
    );
    devicesMap[myDevice.id] = {
      ...myDevice,
      name: uniqueName,
      pairedAt: devicesMap[myDevice.id]?.pairedAt || Date.now(),
      lastActive: Date.now(),
    };

    // Verifica se c'è un altro dispositivo associato
    const otherDevices = Object.values(devicesMap).filter((d) => d && d.id !== myDevice.id);
    const otherDevice = otherDevices.length > 0 ? otherDevices[0] : null;
    const isPaired = otherDevice !== null;

    // Regola fondamentale: la sincronizzazione tra dispositivi può avvenire SOLO se due dispositivi sono associati
    if (!isPaired) {
      // Salva lo snapshot iniziale e la registrazione di questo dispositivo sul cloud
      // affinché il secondo dispositivo possa collegarsi e associarsi
      const localCourse = await readLocalCourse();
      const localAtt = await getAttendanceRecords();
      const localTomb = await getAttendanceTombstones();
      await pushRemote(syncId, {
        updatedAt: Date.now(),
        course: localCourse,
        courseModified: Date.now(),
        attendance: localAtt,
        tombstones: localTomb,
        devices: devicesMap,
      });

      return {
        success: false,
        updated: false,
        notPaired: true,
        message: 'Nessun dispositivo associato. La sincronizzazione si attiverà non appena colleghi un secondo dispositivo con AirDrop o Codice.',
      };
    }

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

    // ── Pubblica sempre devicesMap aggiornato e dati unificati ──
    await pushRemote(syncId, {
      updatedAt: now,
      course: finalCourse,
      courseModified: finalMod,
      attendance: merged,
      tombstones,
      devices: devicesMap,
    });

    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(now));
    const updated = attChanged || courseChanged;
    return {
      success: true,
      updated,
      notPaired: false,
      partnerName: otherDevice.name,
      message: updated
        ? `Dati sincronizzati con ${otherDevice.name}!`
        : `Tutto già sincronizzato con ${otherDevice.name}.`,
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

  const myDevice = await getLocalDeviceInfo();
  const previousId = await getCloudSyncId();

  try {
    const remote = await fetchRemote(code);
    if (!remote) {
      return {
        success: false,
        updated: false,
        message: 'Codice non trovato. Esegui prima una sincronizzazione o condividi da un dispositivo attivo.',
      };
    }

    const existingDevices: SyncDeviceInfo[] =
      remote.devices && typeof remote.devices === 'object'
        ? Object.values(remote.devices).filter(Boolean)
        : [];

    const otherDevices = existingDevices.filter((d) => d.id !== myDevice.id);

    const uniqueName = ensureUniqueDeviceName(
      myDevice.name,
      existingDevices,
      myDevice.id
    );

    const updatedDevices: Record<string, SyncDeviceInfo> = {
      ...(remote.devices || {}),
      [myDevice.id]: {
        ...myDevice,
        name: uniqueName,
        pairedAt: Date.now(),
        lastActive: Date.now(),
      },
    };

    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, code);

    // Merge corso
    const localCourse = await readLocalCourse();
    const remoteCourse = normalizeCourse(remote.course);
    let finalCourse = localCourse;
    let finalMod = Date.now();
    if (remoteCourse.url) {
      finalCourse = remoteCourse;
      await writeLocalCourse(remoteCourse);
    }
    await AsyncStorage.setItem(COURSE_SNAPSHOT_KEY, JSON.stringify(finalCourse));
    await AsyncStorage.setItem(COURSE_MODIFIED_KEY, String(finalMod));

    // Merge presenze
    const localAtt = await getAttendanceRecords();
    const remoteAtt: AttendanceRecord[] = Array.isArray(remote.attendance) ? remote.attendance : [];
    const localTomb = await getAttendanceTombstones();
    const remoteTomb = remote.tombstones || {};

    const tombstones: Record<string, number> = { ...localTomb, ...remoteTomb };
    const byId = new Map<string, AttendanceRecord>();
    for (const r of [...remoteAtt, ...localAtt]) {
      const prev = byId.get(r.id);
      if (!prev || (r.timestamp || 0) > (prev.timestamp || 0)) byId.set(r.id, r);
    }
    const merged = Array.from(byId.values())
      .filter((r) => !(tombstones[r.id] && tombstones[r.id] >= (r.timestamp || 0)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    await AsyncStorage.setItem('studici_attendance_records', JSON.stringify(merged));
    await setAttendanceTombstones(tombstones);

    await pushRemote(code, {
      updatedAt: Date.now(),
      course: finalCourse,
      courseModified: finalMod,
      attendance: merged,
      tombstones,
      devices: updatedDevices,
    });

    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));

    const partner = otherDevices[0];
    const partnerName = partner ? partner.name : "gli altri dispositivi";
    const displayMsg = otherDevices.length > 1
      ? `Dispositivo associato con successo al gruppo (${otherDevices.length + 1} dispositivi)! La sincronizzazione è ora attiva tra tutti i dispositivi.`
      : partner
      ? `Dispositivo associato con successo a "${partner.name}"! La sincronizzazione è ora attiva tra i dispositivi.`
      : `Dispositivo associato con successo! Sincronizzazione attiva.`;

    await notifyLiveSyncListeners(true);

    return {
      success: true,
      updated: true,
      partnerName,
      message: displayMsg,
    };
  } catch (err: any) {
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, previousId);
    return {
      success: false,
      updated: false,
      message:
        err?.name === 'AbortError'
          ? 'Nessuna risposta dal cloud: controlla la connessione.'
          : err?.message || 'Impossibile associare il dispositivo.',
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
        const paired = await isDevicePaired();
        if (paired) {
          const res = await syncWithICloudStorage();
          await notifyLiveSyncListeners(res.updated);
        }
      }
    } catch {}
  }, 1500);
});

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione Live in Tempo Reale
// ─────────────────────────────────────────────────────────────────────────────

let livePollTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownRemoteUpdatedAt = 0;
let lastKnownDevicesHash = '';
let isPollingInProgress = false;

export type LiveSyncCallback = (status: PairedDevicesStatus, updated: boolean) => void;
const liveSyncListeners = new Set<LiveSyncCallback>();

/**
 * Notifica manualmente o automaticamente tutti i listener live registrati.
 */
export async function notifyLiveSyncListeners(updated = false): Promise<void> {
  const currentStatus = await getPairedDevicesInfo();
  for (const cb of liveSyncListeners) {
    try {
      cb(currentStatus, updated);
    } catch {}
  }
}

/**
 * Registra un ascoltatore live per aggiornamenti in tempo reale (dispositivi associati, presenze, corsi).
 * Restituisce una funzione di pulizia (unsubscribe).
 */
export function subscribeToLiveSync(callback: LiveSyncCallback): () => void {
  liveSyncListeners.add(callback);
  startLiveSyncLoop();
  // Notifica subito lo stato corrente
  getPairedDevicesInfo().then((status) => {
    try {
      callback(status, false);
    } catch {}
  });
  return () => {
    liveSyncListeners.delete(callback);
    if (liveSyncListeners.size === 0) {
      stopLiveSyncLoop();
    }
  };
}

async function checkRemoteLiveChanges(): Promise<void> {
  if (isPollingInProgress || !isCloudConfigured()) return;
  isPollingInProgress = true;
  try {
    const syncId = await getCloudSyncId();
    const remote = await fetchRemote(syncId);
    if (!remote) return;

    const devices = remote.devices || {};
    const devEntries = Object.values(devices).filter(Boolean) as SyncDeviceInfo[];
    const devHash = devEntries
      .map((d) => `${d.id}:${d.name}:${d.lastActive}`)
      .sort()
      .join('|');

    const remoteUpdated = remote.updatedAt || 0;
    const localLastSync = (await getLastCloudSync()) || 0;

    const hasNewDevices = devHash !== lastKnownDevicesHash;
    const hasNewData = remoteUpdated > Math.max(localLastSync, lastKnownRemoteUpdatedAt);

    if (hasNewDevices || hasNewData) {
      lastKnownDevicesHash = devHash;
      lastKnownRemoteUpdatedAt = remoteUpdated;

      // Esegui la sincronizzazione locale e unisci i dati
      const syncResult = await syncWithICloudStorage();
      await notifyLiveSyncListeners(syncResult.updated);

      // Se il corso o orario è cambiato e il calendario apple era attivo, aggiorna anche il calendario apple in live!
      if (syncResult.updated) {
        await refreshAppleCalendarIfConfigured();
      }
    }
  } catch {
    // Non interrompere il ciclo per errori di rete momentanei
  } finally {
    isPollingInProgress = false;
  }
}

export function startLiveSyncLoop(): void {
  if (livePollTimer) return;
  // Polling a intervallo rapido (2.5s) per aggiornamento live
  livePollTimer = setInterval(() => {
    checkRemoteLiveChanges();
  }, 2500);
  checkRemoteLiveChanges();
}

export function stopLiveSyncLoop(): void {
  if (livePollTimer) {
    clearInterval(livePollTimer);
    livePollTimer = null;
  }
}

// Gestione Foreground / Background con AppState
AppState.addEventListener('change', (nextState: AppStateStatus) => {
  if (nextState === 'active') {
    startLiveSyncLoop();
  } else {
    stopLiveSyncLoop();
  }
});
