import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
import { AppState, AppStateStatus, Platform } from "react-native";
import { SYNC_DB_URL } from "../config/syncConfig";
import { CommuterConfig } from "../types/commuter";
import { refreshAppleCalendarIfConfigured } from "./appleCalendar";
import {
  AttendanceRecord,
  getAttendanceRecords,
  getAttendanceTombstones,
  setAttendanceChangeListener,
  setAttendanceTombstones,
} from "./attendance";
import {
  DEFAULT_COMMUTER_CONFIG,
  getCommuterConfig,
  saveCommuterConfig,
  setCommuterChangeListener,
} from "./commuterStorage";

const CLOUD_SYNC_ID_KEY = "studici_cloud_sync_id";
const MASTER_SYNC_CODE_KEY = "studici_master_sync_code";
const PARENT_CODE_KEY = "studici_parent_sync_code";
const PARENT_DEVICE_ID_KEY = "studici_parent_device_id";
const PRE_ASSOCIATION_BACKUP_KEY = "studici_pre_association_backup";
const LAST_CLOUD_SYNC_KEY = "studici_last_cloud_sync";
const CLOUD_BACKUP_DATA_KEY = "studici_cloud_backup_data";
const ICLOUD_AUTO_SYNC_KEY = "studici_icloud_auto_sync_enabled";
const ICLOUD_BACKUP_FILENAME = "studici_icloud_sync.json";
const LOCAL_DEVICE_ID_KEY = "studici_local_device_instance_id";

const COURSE_MODIFIED_KEY = "studici_course_modified_at";
const COURSE_SNAPSHOT_KEY = "studici_course_snapshot";
const COMMUTER_MODIFIED_KEY = "studici_commuter_modified_at";
const COMMUTER_SNAPSHOT_KEY = "studici_commuter_snapshot";
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

export interface SyncDeviceInfo {
  id: string;
  name: string;
  model: string;
  platform: string;
  osVersion: string;
  pairedAt: number;
  lastActive: number;
  code?: string;
  role?: "master" | "slave";
  parentDeviceId?: string | null;
  parentCode?: string | null;
}

export interface PairedDevicesStatus {
  myDevice: SyncDeviceInfo;
  otherDevices: SyncDeviceInfo[];
  otherDevice: SyncDeviceInfo | null;
  isPaired: boolean;
  totalDevices: number;
  isSlave: boolean;
  masterCode: string | null;
}

export interface PreAssociationBackup {
  course: CourseData;
  attendance: AttendanceRecord[];
  tombstones: Record<string, number>;
  commuter: CommuterConfig;
  timestamp: number;
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
  commuter?: CommuterConfig;
}

export interface CourseData {
  url: string | null;
  name: string | null;
  className: string | null;
  defaultTabUrl: string | null;
}

interface RemoteDoc {
  updatedAt?: number;
  forwardToMaster?: string | null;
  masterId?: string | null;
  parentCode?: string | null;
  course?: Partial<CourseData>;
  courseModified?: number;
  cachedSchedule?: string;
  cachedTabs?: string;
  attendance?: AttendanceRecord[];
  tombstones?: Record<string, number>;
  commuter?: CommuterConfig;
  commuterModified?: number;
  devices?: Record<string, SyncDeviceInfo>;
  dissociatedDevices?: Record<string, number>;
}

export interface CloudSyncResult {
  success: boolean;
  message: string;
  updated: boolean;
  notPaired?: boolean;
  partnerName?: string;
}

/** Normalizza un codice digitato dall'utente (spazi, minuscole) */
export function normalizeSyncCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
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
  let digits = "";
  for (let i = 0; i < 4; i++) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const letter = letters[Math.floor(Math.random() * letters.length)];
  return `ST${digits}${letter}`;
}

export async function generateUniqueInitialSyncCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInitialSyncCode();
    try {
      const existing = await fetchRemote(candidate);
      if (
        !existing ||
        !existing.devices ||
        Object.keys(existing.devices).length === 0
      ) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return generateInitialSyncCode();
}

/**
 * Ottiene o genera il Codice Dispositivo univoco (personale del dispositivo, es. ST7412K).
 * Questo codice è permanente e non cambia mai, neanche quando il dispositivo è associato come slave.
 */
export async function getCloudSyncId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(CLOUD_SYNC_ID_KEY);
    if (!id || !isValidSyncCode(id) || id.startsWith("STUD-")) {
      id = await generateUniqueInitialSyncCode();
      await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, id);
    }
    return id.toUpperCase();
  } catch {
    return "ST1000A";
  }
}

/**
 * Ritorna il codice master se il dispositivo è associato come slave, altrimenti null.
 */
export async function getMasterSyncCode(): Promise<string | null> {
  try {
    const master = await AsyncStorage.getItem(MASTER_SYNC_CODE_KEY);
    return master && isValidSyncCode(master) ? master.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Verifica se questo dispositivo è attualmente uno slave collegato a un master.
 */
export async function isCurrentDeviceSlave(): Promise<boolean> {
  const master = await getMasterSyncCode();
  return Boolean(master);
}

/**
 * Ritorna il codice dello spazio di sincronizzazione attivo:
 * se slave ritorna il codice del master (gruppo), altrimenti il proprio codice.
 */
export async function getActiveSyncId(): Promise<string> {
  const master = await getMasterSyncCode();
  if (master) return master;
  return await getCloudSyncId();
}

/**
 * Permette di impostare un codice/nome personalizzato per questo dispositivo.
 */
export async function setCustomCloudSyncId(
  newId: string,
): Promise<{ success: boolean; message: string }> {
  const norm = normalizeSyncCode(newId);
  if (!isValidSyncCode(norm)) {
    return {
      success: false,
      message:
        "Il nome deve contenere tra 3 e 40 caratteri (lettere e numeri).",
    };
  }

  const currentId = await getCloudSyncId();
  if (norm === currentId) {
    return { success: true, message: "Nome già impostato." };
  }

  try {
    const existing = await fetchRemote(norm);
    if (existing && existing.devices) {
      const myDevice = await getLocalDeviceInfo();
      const otherDevices = Object.values(existing.devices).filter(
        (d) => d && d.id !== myDevice.id,
      );
      if (otherDevices.length > 0 && !existing.devices[myDevice.id]) {
        return {
          success: false,
          message: `Il nome "${norm}" è già in uso da un altro utente. Scegli un nome diverso o usa il campo "Collega" per unirti ad esso.`,
        };
      }
    }
  } catch {}

  await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, norm);
  await syncWithICloudStorage();
  return {
    success: true,
    message: `Codice aggiornato a "${norm}". Ora i tuoi dati sono salvati in questo spazio.`,
  };
}

export async function getLastCloudSync(): Promise<number | null> {
  try {
    const val = await AsyncStorage.getItem(LAST_CLOUD_SYNC_KEY);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Salva lo snapshot locale prima di associarsi come slave a un master.
 * Se lo slave si dissocia, questo stato viene interamente ripristinato.
 */
export async function savePreAssociationBackup(): Promise<void> {
  const existing = await AsyncStorage.getItem(PRE_ASSOCIATION_BACKUP_KEY);
  if (!existing) {
    const [course, attendance, tombstones, commuter] = await Promise.all([
      readLocalCourse(),
      getAttendanceRecords(),
      getAttendanceTombstones(),
      readLocalCommuter(),
    ]);
    const backup: PreAssociationBackup = {
      course,
      attendance,
      tombstones,
      commuter,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(
      PRE_ASSOCIATION_BACKUP_KEY,
      JSON.stringify(backup),
    );
  }
}

/**
 * Ripristina lo stato precedente all'associazione con il master:
 * perde tutti gli elementi ereditati dal master e ritorna a dove era prima (o a 0 se era vuoto).
 */
export async function restorePreAssociationBackup(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PRE_ASSOCIATION_BACKUP_KEY);
    if (raw) {
      const backup: PreAssociationBackup = JSON.parse(raw);
      if (backup.course) {
        await writeLocalCourse(backup.course);
      }
      if (Array.isArray(backup.attendance)) {
        await AsyncStorage.setItem(
          "studici_attendance_records",
          JSON.stringify(backup.attendance),
        );
      }
      if (backup.tombstones) {
        await setAttendanceTombstones(backup.tombstones);
      }
      if (backup.commuter) {
        await writeLocalCommuter(backup.commuter);
      }
      await AsyncStorage.removeItem(PRE_ASSOCIATION_BACKUP_KEY);
    } else {
      // Nessun elemento precedente: pulizia completa (parte da 0)
      await writeLocalCourse({
        url: null,
        name: null,
        className: null,
        defaultTabUrl: null,
      });
      await AsyncStorage.setItem("studici_attendance_records", JSON.stringify([]));
      await setAttendanceTombstones({});
      await writeLocalCommuter(DEFAULT_COMMUTER_CONFIG);
    }
    await AsyncStorage.removeItem(COURSE_SNAPSHOT_KEY);
    await AsyncStorage.setItem(COURSE_MODIFIED_KEY, "0");
    await AsyncStorage.removeItem(COMMUTER_SNAPSHOT_KEY);
    await AsyncStorage.setItem(COMMUTER_MODIFIED_KEY, "0");
  } catch (err) {
    console.warn("Errore ripristino stato pre-associazione:", err);
  }
}

export async function readLocalCommuter(): Promise<CommuterConfig> {
  return await getCommuterConfig();
}

export async function writeLocalCommuter(config: CommuterConfig): Promise<void> {
  await saveCommuterConfig(config);
}

/**
 * Esegue la sincronizzazione manuale Cloud: raccoglie corso, presenze e impostazioni di viaggio.
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
  const formattedDate = new Date(timestamp).toLocaleString("it-IT");

  const [url, name, className, defaultTabUrl, records, commuter] =
    await Promise.all([
      AsyncStorage.getItem("selectedDegreeUrl"),
      AsyncStorage.getItem("selectedDegreeName"),
      AsyncStorage.getItem("selectedDegreeClassName"),
      AsyncStorage.getItem("defaultTabUrl"),
      getAttendanceRecords(),
      readLocalCommuter(),
    ]);

  const payload: CloudBackupPayload = {
    syncId,
    version: "1.9.1",
    timestamp,
    formattedDate,
    course: {
      url,
      name,
      className,
      defaultTabUrl,
    },
    attendanceRecords: records,
    commuter,
  };

  const jsonStr = JSON.stringify(payload);
  await AsyncStorage.setItem(CLOUD_BACKUP_DATA_KEY, jsonStr);
  await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, timestamp.toString());

  try {
    const filePath = `${FileSystem.documentDirectory}${ICLOUD_BACKUP_FILENAME}`;
    await FileSystem.writeAsStringAsync(filePath, jsonStr);
  } catch {}

  const backupCode = `STUDICI_CLOUD:${btoa(unescape(encodeURIComponent(jsonStr)))}`;

  return {
    success: true,
    syncId,
    timestamp,
    message: `Sincronizzazione completata con successo! Salvate ${records.length} presenze, corso e impostazioni di viaggio.`,
    backupCode,
    payload,
  };
}

export async function copyCloudSyncCodeToClipboard(): Promise<string> {
  const res = await performCloudSync();
  await Clipboard.setStringAsync(res.backupCode);
  return res.backupCode;
}

export async function restoreFromCloudBackup(codeOrJson: string): Promise<{
  success: boolean;
  message: string;
  courseName?: string;
  recordsCount?: number;
}> {
  try {
    const clean = codeOrJson.trim();
    let jsonStr = "";

    if (clean.startsWith("STUDICI_CLOUD:")) {
      const b64 = clean.replace("STUDICI_CLOUD:", "").trim();
      jsonStr = decodeURIComponent(escape(atob(b64)));
    } else {
      jsonStr = clean;
    }

    const data: CloudBackupPayload = JSON.parse(jsonStr);
    if (!data || !data.course) {
      throw new Error("Formato di backup non valido.");
    }

    if (data.course.url) {
      await AsyncStorage.setItem("selectedDegreeUrl", data.course.url);
    }
    if (data.course.name) {
      await AsyncStorage.setItem("selectedDegreeName", data.course.name);
    }
    if (data.course.className) {
      await AsyncStorage.setItem(
        "selectedDegreeClassName",
        data.course.className,
      );
    }
    if (data.course.defaultTabUrl) {
      await AsyncStorage.setItem("defaultTabUrl", data.course.defaultTabUrl);
    }

    if (Array.isArray(data.attendanceRecords)) {
      await AsyncStorage.setItem(
        "studici_attendance_records",
        JSON.stringify(data.attendanceRecords),
      );
    }

    if (data.commuter) {
      await writeLocalCommuter(data.commuter);
    }

    const timestamp = Date.now();
    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, timestamp.toString());

    try {
      const filePath = `${FileSystem.documentDirectory}${ICLOUD_BACKUP_FILENAME}`;
      await FileSystem.writeAsStringAsync(filePath, jsonStr);
    } catch {}

    return {
      success: true,
      message: `Ripristino completato con successo: ${data.course.name || "Corso"}, ${data.attendanceRecords?.length || 0} presenze e impostazioni di viaggio ripristinate.`,
      courseName: data.course.name || undefined,
      recordsCount: data.attendanceRecords?.length || 0,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Codice o file di backup non valido.",
    };
  }
}

export async function getICloudAutoSyncEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ICLOUD_AUTO_SYNC_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

export async function setICloudAutoSyncEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(
      ICLOUD_AUTO_SYNC_KEY,
      enabled ? "true" : "false",
    );
  } catch (err) {
    console.error("Error saving auto sync setting:", err);
  }
}

export function isCloudConfigured(): boolean {
  return SYNC_DB_URL.trim().length > 0;
}

function remoteUrl(syncId: string): string {
  return `${SYNC_DB_URL.replace(/\/+$/, "")}/sync/${syncId}.json`;
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
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
        ? "Accesso al database negato: controlla le regole di Firebase."
        : `Errore server cloud (${res.status}).`,
    );
  }
  const json = await res.json();
  return json && typeof json === "object" ? (json as RemoteDoc) : null;
}

async function pushRemote(syncId: string, doc: RemoteDoc): Promise<void> {
  const res = await fetchWithTimeout(remoteUrl(syncId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    throw new Error(`Impossibile salvare sul cloud (${res.status}).`);
  }
}

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
  if (
    Device.deviceName &&
    Device.deviceName !== "iPhone" &&
    Device.deviceName !== "iPad"
  ) {
    return Device.deviceName;
  }
  if (Device.modelName) {
    return Device.modelName;
  }
  return Platform.OS === "ios"
    ? "iPhone"
    : Platform.OS === "android"
      ? "Dispositivo Android"
      : "Dispositivo";
}

export function ensureUniqueDeviceName(
  candidateName: string,
  existingDevices: SyncDeviceInfo[],
  myDeviceId: string,
): string {
  const otherNames = existingDevices
    .filter((d) => d && d.id !== myDeviceId)
    .map((d) => (d.name || "").trim().toLowerCase());

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
  const model =
    Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Dispositivo");
  const platform =
    Platform.OS === "ios"
      ? "iOS"
      : Platform.OS === "android"
        ? "Android"
        : "Web";
  const osVersion = Device.osVersion || "";
  const ownCode = await getCloudSyncId();
  const isSlave = await isCurrentDeviceSlave();

  return {
    id,
    name,
    model,
    platform,
    osVersion,
    code: ownCode,
    role: isSlave ? "slave" : "master",
    pairedAt: Date.now(),
    lastActive: Date.now(),
  };
}

export async function getPairedDevicesInfo(): Promise<PairedDevicesStatus> {
  const myDevice = await getLocalDeviceInfo();
  const isSlave = await isCurrentDeviceSlave();
  const masterCode = await getMasterSyncCode();
  const ownCode = await getCloudSyncId();

  if (!isCloudConfigured()) {
    return {
      myDevice: { ...myDevice, code: ownCode, role: isSlave ? "slave" : "master" },
      otherDevices: [],
      otherDevice: null,
      isPaired: false,
      totalDevices: 1,
      isSlave,
      masterCode,
    };
  }

  try {
    const activeSyncId = await getActiveSyncId();
    const remote = await fetchRemote(activeSyncId);
    if (!remote || !remote.devices) {
      return {
        myDevice: { ...myDevice, code: ownCode, role: isSlave ? "slave" : "master" },
        otherDevices: [],
        otherDevice: null,
        isPaired: false,
        totalDevices: 0,
        isSlave,
        masterCode,
      };
    }

    const devicesMap: Record<string, SyncDeviceInfo> =
      typeof remote.devices === "object" ? remote.devices : {};
    const registeredMy = devicesMap[myDevice.id] || {
      ...myDevice,
      code: ownCode,
      role: isSlave ? "slave" : "master",
    };

    const isCurrentDeviceRegistered = Boolean(devicesMap[myDevice.id]);
    const isDissociated = Boolean(
      remote.dissociatedDevices && remote.dissociatedDevices[myDevice.id],
    );

    const others: SyncDeviceInfo[] = Object.entries(devicesMap)
      .filter(
        ([k, d]) =>
          k !== myDevice.id && d && (d.id ? d.id !== myDevice.id : true),
      )
      .map(([k, d]) => ({
        ...d,
        id: d.id || k,
      }));
    const otherDevice = others.length > 0 ? others[0] : null;

    if (isDissociated || (!isCurrentDeviceRegistered && others.length > 0)) {
      setTimeout(() => {
        handleLocalDeviceWasKickedOut(myDevice).catch(() => {});
      }, 0);
      return {
        myDevice: registeredMy,
        otherDevices: [],
        otherDevice: null,
        isPaired: false,
        totalDevices: 1,
        isSlave: false,
        masterCode: null,
      };
    }

    return {
      myDevice: registeredMy,
      otherDevices: others,
      otherDevice,
      isPaired: others.length > 0,
      totalDevices: Object.keys(devicesMap).length,
      isSlave,
      masterCode,
    };
  } catch {
    return {
      myDevice: { ...myDevice, code: ownCode, role: isSlave ? "slave" : "master" },
      otherDevices: [],
      otherDevice: null,
      isPaired: false,
      totalDevices: 1,
      isSlave,
      masterCode,
    };
  }
}

export async function isDevicePaired(): Promise<boolean> {
  const status = await getPairedDevicesInfo();
  return status.isPaired;
}

let isKickingOut = false;

/**
 * Gestisce l'uscita forzata o la dissociazione di questo dispositivo dal gruppo.
 * Se era uno slave, ripristina lo stato a prima dell'associazione (perde tutti gli elementi ereditati).
 */
async function handleLocalDeviceWasKickedOut(
  myDevice: SyncDeviceInfo,
): Promise<void> {
  if (isKickingOut) return;
  isKickingOut = true;
  try {
    const isSlave = await isCurrentDeviceSlave();
    if (isSlave) {
      await restorePreAssociationBackup();
      await AsyncStorage.removeItem(MASTER_SYNC_CODE_KEY);
      await AsyncStorage.removeItem(PARENT_CODE_KEY);
      await AsyncStorage.removeItem(PARENT_DEVICE_ID_KEY);
    }
    await setICloudAutoSyncEnabled(false);
    lastKnownDevicesHash = "";
    lastKnownRemoteUpdatedAt = 0;

    const ownId = await getCloudSyncId();
    const freshMyDevice: SyncDeviceInfo = {
      ...myDevice,
      code: ownId,
      role: "master",
      parentDeviceId: null,
      parentCode: null,
      pairedAt: Date.now(),
      lastActive: Date.now(),
    };

    try {
      await pushRemote(ownId, {
        updatedAt: Date.now(),
        forwardToMaster: null,
        masterId: null,
        course: await readLocalCourse(),
        courseModified: Date.now(),
        attendance: await getAttendanceRecords(),
        tombstones: await getAttendanceTombstones(),
        commuter: await readLocalCommuter(),
        commuterModified: Date.now(),
        devices: {
          [myDevice.id]: freshMyDevice,
        },
        dissociatedDevices: {},
      });
    } catch {}

    await notifyLiveSyncListeners(true);
  } finally {
    isKickingOut = false;
  }
}

/**
 * Dissocia questo dispositivo o un altro dispositivo associato.
 * Se lo slave si dissocia dal master (o viene dissociato), perde tutti gli elementi ereditati
 * e torna allo stato in cui era rimasto prima di associarsi (oppure a 0).
 * Se lo slave ha a sua volta altri dispositivi collegati a catena, anche questi vengono dissociati.
 */
export async function dissociateDevice(
  targetDeviceId?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const activeSyncId = await getActiveSyncId();
    const myDevice = await getLocalDeviceInfo();
    const isSlave = await isCurrentDeviceSlave();
    const remote = await fetchRemote(activeSyncId);

    if (!remote || !remote.devices) {
      if (isSlave) {
        await handleLocalDeviceWasKickedOut(myDevice);
      }
      return {
        success: true,
        message: "Dispositivo dissociato con successo.",
      };
    }

    const devicesMap = { ...remote.devices };
    const updatedDissociated: Record<string, number> = {
      ...(remote.dissociatedDevices || {}),
    };

    const parentDeviceId = await AsyncStorage.getItem(PARENT_DEVICE_ID_KEY);

    // Caso A: l'utente sta dissociando il proprio master (o se stesso da slave)
    const isDissociatingMaster =
      isSlave &&
      (!targetDeviceId ||
        targetDeviceId === myDevice.id ||
        (parentDeviceId && targetDeviceId === parentDeviceId) ||
        devicesMap[targetDeviceId]?.role === "master");

    if (isDissociatingMaster) {
      // Effetto a catena: rimuove me stesso e tutti i dispositivi che discendono da me
      const descendantIds = new Set<string>([myDevice.id]);
      let added = true;
      while (added) {
        added = false;
        for (const d of Object.values(devicesMap)) {
          if (
            d &&
            d.parentDeviceId &&
            descendantIds.has(d.parentDeviceId) &&
            !descendantIds.has(d.id)
          ) {
            descendantIds.add(d.id);
            added = true;
          }
        }
      }

      for (const id of descendantIds) {
        delete devicesMap[id];
        updatedDissociated[id] = Date.now();
      }

      try {
        await pushRemote(activeSyncId, {
          ...remote,
          updatedAt: Date.now(),
          devices: devicesMap,
          dissociatedDevices: updatedDissociated,
        });
      } catch {}

      // Ripristina lo stato locale precedente all'associazione
      await handleLocalDeviceWasKickedOut(myDevice);

      return {
        success: true,
        message:
          "Dispositivo dissociato con successo dal master. Ripristinati i dati precedenti all'associazione.",
      };
    }

    // Caso B: l'utente sta dissociando un dispositivo specifico (targetDeviceId)
    if (targetDeviceId && targetDeviceId !== myDevice.id) {
      // Trova tutti i discendenti di questo targetDeviceId a catena
      const toRemoveIds = new Set<string>([targetDeviceId]);
      let added = true;
      while (added) {
        added = false;
        for (const d of Object.values(devicesMap)) {
          if (
            d &&
            d.parentDeviceId &&
            toRemoveIds.has(d.parentDeviceId) &&
            !toRemoveIds.has(d.id)
          ) {
            toRemoveIds.add(d.id);
            added = true;
          }
        }
      }

      for (const id of toRemoveIds) {
        delete devicesMap[id];
        updatedDissociated[id] = Date.now();
      }

      await pushRemote(activeSyncId, {
        ...remote,
        updatedAt: Date.now(),
        devices: devicesMap,
        dissociatedDevices: updatedDissociated,
      });

      await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
      lastKnownDevicesHash = Object.values(devicesMap)
        .filter(Boolean)
        .map((d) => `${d.id}:${d.name}:${d.lastActive}`)
        .sort()
        .join("|");
      lastKnownRemoteUpdatedAt = Date.now();

      await notifyLiveSyncListeners(true);
      return {
        success: true,
        message: "Dispositivo dissociato con successo.",
      };
    }

    // Caso C: dissociazione locale generica
    await handleLocalDeviceWasKickedOut(myDevice);
    return {
      success: true,
      message: "Dispositivo dissociato con successo.",
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Errore durante la dissociazione.",
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

export async function readLocalCourse(): Promise<CourseData> {
  const [url, name, className, defaultTabUrl] = await Promise.all([
    AsyncStorage.getItem("selectedDegreeUrl"),
    AsyncStorage.getItem("selectedDegreeName"),
    AsyncStorage.getItem("selectedDegreeClassName"),
    AsyncStorage.getItem("defaultTabUrl"),
  ]);
  return { url, name, className, defaultTabUrl };
}

export async function writeLocalCourse(c: CourseData): Promise<void> {
  const pairs: [string, string | null][] = [
    ["selectedDegreeUrl", c.url],
    ["selectedDegreeName", c.name],
    ["selectedDegreeClassName", c.className],
    ["defaultTabUrl", c.defaultTabUrl],
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
    .join("|");
}

let syncInFlight: Promise<CloudSyncResult> | null = null;

async function runSync(): Promise<CloudSyncResult> {
  if (!isCloudConfigured()) {
    return {
      success: false,
      updated: false,
      message: "Sincronizzazione cloud non configurata in questa build.",
    };
  }

  try {
    const activeSyncId = await getActiveSyncId();
    const ownId = await getCloudSyncId();
    const isSlave = await isCurrentDeviceSlave();
    const remote = await fetchRemote(activeSyncId);
    const myDevice = await getLocalDeviceInfo();

    // Verifica se questo dispositivo è stato dissociato o rimosso
    const isDissociated = Boolean(
      remote?.dissociatedDevices && remote.dissociatedDevices[myDevice.id],
    );
    const isAlreadyRegistered = Boolean(
      remote?.devices && remote.devices[myDevice.id],
    );
    const otherRegisteredCount = remote?.devices
      ? Object.keys(remote.devices).filter((k) => k !== myDevice.id).length
      : 0;

    if (isDissociated || (!isAlreadyRegistered && otherRegisteredCount > 0)) {
      await handleLocalDeviceWasKickedOut(myDevice);
      return {
        success: false,
        updated: true,
        notPaired: true,
        message:
          "Questo dispositivo è stato dissociato dal gruppo di sincronizzazione.",
      };
    }

    const devicesMap: Record<string, SyncDeviceInfo> =
      remote?.devices && typeof remote.devices === "object"
        ? { ...remote.devices }
        : {};

    const uniqueName = ensureUniqueDeviceName(
      myDevice.name,
      Object.values(devicesMap),
      myDevice.id,
    );

    devicesMap[myDevice.id] = {
      ...myDevice,
      name: uniqueName,
      code: ownId,
      role: isSlave ? "slave" : "master",
      parentDeviceId: devicesMap[myDevice.id]?.parentDeviceId || null,
      parentCode: devicesMap[myDevice.id]?.parentCode || null,
      pairedAt: devicesMap[myDevice.id]?.pairedAt || Date.now(),
      lastActive: Date.now(),
    };

    const otherDevices = Object.values(devicesMap).filter(
      (d) => d && d.id !== myDevice.id,
    );
    const otherDevice = otherDevices.length > 0 ? otherDevices[0] : null;
    const isPaired = otherDevice !== null;

    if (!isPaired) {
      const localCourse = await readLocalCourse();
      const localAtt = await getAttendanceRecords();
      const localTomb = await getAttendanceTombstones();
      const localCommuter = await readLocalCommuter();
      let localCachedSchedule: string | undefined = undefined;
      let localCachedTabs: string | undefined = undefined;
      if (localCourse.url) {
        try {
          localCachedSchedule = (await AsyncStorage.getItem(`allSchedules_v8_${localCourse.url}`)) || undefined;
          localCachedTabs = (await AsyncStorage.getItem(`tabsCache_${localCourse.url}`)) || undefined;
        } catch {}
      }
      await pushRemote(activeSyncId, {
        updatedAt: Date.now(),
        course: localCourse,
        courseModified: Date.now(),
        cachedSchedule: localCachedSchedule || remote?.cachedSchedule,
        cachedTabs: localCachedTabs || remote?.cachedTabs,
        attendance: localAtt,
        tombstones: localTomb,
        commuter: localCommuter,
        commuterModified: Date.now(),
        devices: devicesMap,
        dissociatedDevices: remote?.dissociatedDevices || {},
      });

      return {
        success: false,
        updated: false,
        notPaired: true,
        message:
          "Nessun dispositivo associato. La sincronizzazione si attiverà non appena colleghi un secondo dispositivo.",
      };
    }

    // 1. Sincronizzazione Corso (LWW)
    const localCourse = await readLocalCourse();
    const localSnap = await AsyncStorage.getItem(COURSE_SNAPSHOT_KEY);
    let localMod =
      parseInt((await AsyncStorage.getItem(COURSE_MODIFIED_KEY)) || "0", 10) ||
      0;
    if (JSON.stringify(localCourse) !== localSnap) {
      localMod = localCourse.url ? Date.now() : 0;
    }

    const remoteMod = remote?.courseModified || 0;
    const remoteCourse = normalizeCourse(remote?.course);
    let finalCourse = localCourse;
    let finalMod = localMod;
    let courseChanged = false;
    if (remoteCourse.url && remoteMod > localMod) {
      courseChanged =
        JSON.stringify(remoteCourse) !== JSON.stringify(localCourse);
      if (courseChanged) await writeLocalCourse(remoteCourse);
      finalCourse = remoteCourse;
      finalMod = remoteMod;
    }
    await AsyncStorage.setItem(
      COURSE_SNAPSHOT_KEY,
      JSON.stringify(finalCourse),
    );
    await AsyncStorage.setItem(COURSE_MODIFIED_KEY, String(finalMod));

    // 2. Sincronizzazione Presenze (Union con tombstones)
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
      if (!prev || (r.timestamp || 0) > (prev.timestamp || 0)) {
        byId.set(r.id, r);
      }
    }
    const merged = Array.from(byId.values())
      .filter(
        (r) => !(tombstones[r.id] && tombstones[r.id] >= (r.timestamp || 0)),
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const attChanged = idsKey(merged) !== idsKey(localAtt);
    if (attChanged) {
      await AsyncStorage.setItem(
        "studici_attendance_records",
        JSON.stringify(merged),
      );
    }
    await setAttendanceTombstones(tombstones);

    // 3. Sincronizzazione Impostazioni di Viaggio (LWW)
    const localCommuter = await readLocalCommuter();
    const localCommuterSnap = await AsyncStorage.getItem(COMMUTER_SNAPSHOT_KEY);
    let localCommuterMod =
      parseInt(
        (await AsyncStorage.getItem(COMMUTER_MODIFIED_KEY)) || "0",
        10,
      ) || 0;
    if (JSON.stringify(localCommuter) !== localCommuterSnap) {
      localCommuterMod = localCommuter.enabled ? Date.now() : 0;
    }

    const remoteCommuterMod = remote?.commuterModified || 0;
    const remoteCommuter = remote?.commuter;
    let finalCommuter = localCommuter;
    let finalCommuterMod = localCommuterMod;
    let commuterChanged = false;

    if (
      remoteCommuter &&
      remoteCommuter.enabled &&
      remoteCommuterMod > localCommuterMod
    ) {
      commuterChanged =
        JSON.stringify(remoteCommuter) !== JSON.stringify(localCommuter);
      if (commuterChanged) {
        await writeLocalCommuter(remoteCommuter);
      }
      finalCommuter = remoteCommuter;
      finalCommuterMod = remoteCommuterMod;
    }
    await AsyncStorage.setItem(
      COMMUTER_SNAPSHOT_KEY,
      JSON.stringify(finalCommuter),
    );
    await AsyncStorage.setItem(
      COMMUTER_MODIFIED_KEY,
      String(finalCommuterMod),
    );

    let activeCachedSchedule: string | undefined = undefined;
    let activeCachedTabs: string | undefined = undefined;
    if (finalCourse.url) {
      try {
        activeCachedSchedule = (await AsyncStorage.getItem(`allSchedules_v8_${finalCourse.url}`)) || undefined;
        activeCachedTabs = (await AsyncStorage.getItem(`tabsCache_${finalCourse.url}`)) || undefined;
      } catch {}
    }
    // Se lo slave non ha la cache ma il master l'ha salvata sul cloud, ereditiamola subito in locale!
    if (isSlave && finalCourse.url) {
      if (!activeCachedSchedule && remote?.cachedSchedule) {
        await AsyncStorage.setItem(`allSchedules_v8_${finalCourse.url}`, remote.cachedSchedule).catch(() => {});
        activeCachedSchedule = remote.cachedSchedule;
      }
      if (!activeCachedTabs && remote?.cachedTabs) {
        await AsyncStorage.setItem(`tabsCache_${finalCourse.url}`, remote.cachedTabs).catch(() => {});
        activeCachedTabs = remote.cachedTabs;
      }
    }

    // Pubblica al gruppo attivo
    await pushRemote(activeSyncId, {
      updatedAt: now,
      course: finalCourse,
      courseModified: finalMod,
      cachedSchedule: activeCachedSchedule || remote?.cachedSchedule,
      cachedTabs: activeCachedTabs || remote?.cachedTabs,
      attendance: merged,
      tombstones,
      commuter: finalCommuter,
      commuterModified: finalCommuterMod,
      devices: devicesMap,
      dissociatedDevices: remote?.dissociatedDevices || {},
    });

    // Se sono slave, mantieni aggiornato il mio spazio personale per consentire ad altri di associarsi a me
    if (isSlave) {
      try {
        await pushRemote(ownId, {
          updatedAt: now,
          forwardToMaster: activeSyncId,
          masterId: activeSyncId,
          devices: {
            [myDevice.id]: devicesMap[myDevice.id],
          },
        });
      } catch {}
    }

    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(now));
    const updated = attChanged || courseChanged || commuterChanged;
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
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      updated: false,
      message: aborted
        ? "Nessuna risposta dal cloud: controlla la connessione."
        : err?.message || "Errore durante la sincronizzazione cloud.",
    };
  }
}

export function syncWithICloudStorage(): Promise<CloudSyncResult> {
  if (!syncInFlight) {
    syncInFlight = runSync().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

/**
 * Collega questo dispositivo a un altro dispositivo tramite Codice.
 * Se il target fa già parte di un gruppo, il collegamento eredita tutto a catena.
 * Uno slave già associato non può collegarsi ad altri dispositivi prima di dissociarsi.
 */
export async function linkDeviceWithCode(
  rawCode: string,
): Promise<CloudSyncResult> {
  if (!isCloudConfigured()) {
    return {
      success: false,
      updated: false,
      message: "Sincronizzazione cloud non configurata in questa build.",
    };
  }

  const currentIsSlave = await isCurrentDeviceSlave();
  if (currentIsSlave) {
    return {
      success: false,
      updated: false,
      message:
        "Questo dispositivo è già associato come slave a un master. Per collegarti a un altro dispositivo devi prima dissociarti dal master attuale.",
    };
  }

  const code = normalizeSyncCode(rawCode);
  if (!isValidSyncCode(code)) {
    return {
      success: false,
      updated: false,
      message:
        "Codice non valido. Deve contenere da 3 a 40 caratteri alfanumerici.",
    };
  }

  const ownId = await getCloudSyncId();
  if (code === ownId) {
    return {
      success: false,
      updated: false,
      message: "Non puoi collegare questo dispositivo al suo stesso codice.",
    };
  }

  const myDevice = await getLocalDeviceInfo();

  try {
    const targetRemote = await fetchRemote(code);
    if (!targetRemote) {
      return {
        success: false,
        updated: false,
        message:
          "Codice non trovato. Esegui prima una sincronizzazione sul dispositivo master.",
      };
    }

    // Effetto a catena: se il target è a sua volta uno slave, reindirizza al root master!
    const rootMasterCode = targetRemote.forwardToMaster || code;
    const parentCode = code;

    const rootRemote =
      rootMasterCode === code
        ? targetRemote
        : (await fetchRemote(rootMasterCode)) || targetRemote;

    // Salva lo stato locale corrente prima dell'associazione (così se ci si dissocia si torna qui)
    await savePreAssociationBackup();

    const parentDevice = Object.values(rootRemote.devices || {}).find(
      (d) => d && (d.code === parentCode || d.id === parentCode),
    );
    const parentDeviceId = parentDevice?.id || null;

    await AsyncStorage.setItem(MASTER_SYNC_CODE_KEY, rootMasterCode);
    await AsyncStorage.setItem(PARENT_CODE_KEY, parentCode);
    if (parentDeviceId) {
      await AsyncStorage.setItem(PARENT_DEVICE_ID_KEY, parentDeviceId);
    }

    const existingDevices: SyncDeviceInfo[] =
      rootRemote.devices && typeof rootRemote.devices === "object"
        ? Object.values(rootRemote.devices).filter(Boolean)
        : [];

    const uniqueName = ensureUniqueDeviceName(
      myDevice.name,
      existingDevices,
      myDevice.id,
    );

    const updatedDissociated: Record<string, number> = {
      ...(rootRemote.dissociatedDevices || {}),
    };
    delete updatedDissociated[myDevice.id];

    const updatedDevices: Record<string, SyncDeviceInfo> = {
      ...(rootRemote.devices || {}),
      [myDevice.id]: {
        ...myDevice,
        name: uniqueName,
        code: ownId,
        role: "slave",
        parentDeviceId,
        parentCode,
        pairedAt: Date.now(),
        lastActive: Date.now(),
      },
    };

    // 1. Corso: adotta corso del master
    const remoteCourse = normalizeCourse(rootRemote.course);
    let finalCourse = await readLocalCourse();
    const finalCourseMod = Date.now();
    if (remoteCourse.url) {
      finalCourse = remoteCourse;
      await writeLocalCourse(remoteCourse);
      // Eredita immediatamente dati di orari e lezioni già elaborati dall'altro dispositivo
      if (rootRemote.cachedSchedule) {
        await AsyncStorage.setItem(
          `allSchedules_v8_${remoteCourse.url}`,
          rootRemote.cachedSchedule,
        ).catch(() => {});
      }
      if (rootRemote.cachedTabs) {
        await AsyncStorage.setItem(
          `tabsCache_${remoteCourse.url}`,
          rootRemote.cachedTabs,
        ).catch(() => {});
      }
    }
    await AsyncStorage.setItem(
      COURSE_SNAPSHOT_KEY,
      JSON.stringify(finalCourse),
    );
    await AsyncStorage.setItem(COURSE_MODIFIED_KEY, String(finalCourseMod));

    // 2. Presenze: unione
    const localAtt = await getAttendanceRecords();
    const remoteAtt: AttendanceRecord[] = Array.isArray(rootRemote.attendance)
      ? rootRemote.attendance
      : [];
    const localTomb = await getAttendanceTombstones();
    const remoteTomb = rootRemote.tombstones || {};
    const tombstones: Record<string, number> = { ...localTomb, ...remoteTomb };
    const byId = new Map<string, AttendanceRecord>();
    for (const r of [...remoteAtt, ...localAtt]) {
      const prev = byId.get(r.id);
      if (!prev || (r.timestamp || 0) > (prev.timestamp || 0)) {
        byId.set(r.id, r);
      }
    }
    const mergedAtt = Array.from(byId.values())
      .filter(
        (r) => !(tombstones[r.id] && tombstones[r.id] >= (r.timestamp || 0)),
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    await AsyncStorage.setItem(
      "studici_attendance_records",
      JSON.stringify(mergedAtt),
    );
    await setAttendanceTombstones(tombstones);

    // 3. Impostazioni Viaggio Pendolare: adotta impostazioni del master
    let finalCommuter = await readLocalCommuter();
    const finalCommuterMod = Date.now();
    if (rootRemote.commuter && rootRemote.commuter.enabled) {
      finalCommuter = rootRemote.commuter;
      await writeLocalCommuter(rootRemote.commuter);
    }
    await AsyncStorage.setItem(
      COMMUTER_SNAPSHOT_KEY,
      JSON.stringify(finalCommuter),
    );
    await AsyncStorage.setItem(
      COMMUTER_MODIFIED_KEY,
      String(finalCommuterMod),
    );

    // Salva nel gruppo master
    await pushRemote(rootMasterCode, {
      updatedAt: Date.now(),
      course: finalCourse,
      courseModified: finalCourseMod,
      attendance: mergedAtt,
      tombstones,
      commuter: finalCommuter,
      commuterModified: finalCommuterMod,
      devices: updatedDevices,
      dissociatedDevices: updatedDissociated,
    });

    // Aggiorna anche il proprio spazio personale con forwardToMaster
    try {
      await pushRemote(ownId, {
        updatedAt: Date.now(),
        forwardToMaster: rootMasterCode,
        masterId: rootMasterCode,
        parentCode,
        devices: {
          [myDevice.id]: updatedDevices[myDevice.id],
        },
      });
    } catch {}

    await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
    await setICloudAutoSyncEnabled(true);

    const otherDevices = Object.values(updatedDevices).filter(
      (d) => d.id !== myDevice.id,
    );
    const partner =
      otherDevices.find((d) => d.code === parentCode) || otherDevices[0];
    const partnerName = partner ? partner.name : "il master";

    await notifyLiveSyncListeners(true);

    return {
      success: true,
      updated: true,
      partnerName,
      message: `Dispositivo associato con successo a "${partnerName}"! Orari, presenze e impostazioni di viaggio sono sincronizzati.`,
    };
  } catch (err: any) {
    return {
      success: false,
      updated: false,
      message:
        err?.name === "AbortError"
          ? "Nessuna risposta dal cloud: controlla la connessione."
          : err?.message || "Impossibile associare il dispositivo.",
    };
  }
}

// Invio automatico dopo ogni modifica locale alle presenze o alle impostazioni di viaggio
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoPush() {
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
}

setAttendanceChangeListener(scheduleAutoPush);
setCommuterChangeListener(scheduleAutoPush);

// ─────────────────────────────────────────────────────────────────────────────
// Sincronizzazione Live in Tempo Reale
// ─────────────────────────────────────────────────────────────────────────────

let livePollTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownRemoteUpdatedAt = 0;
let lastKnownDevicesHash = "";
let isPollingInProgress = false;

export type LiveSyncCallback = (
  status: PairedDevicesStatus,
  updated: boolean,
) => void;
const liveSyncListeners = new Set<LiveSyncCallback>();

export async function notifyLiveSyncListeners(updated = false): Promise<void> {
  const currentStatus = await getPairedDevicesInfo();
  for (const cb of liveSyncListeners) {
    try {
      cb(currentStatus, updated);
    } catch {}
  }
}

export function subscribeToLiveSync(callback: LiveSyncCallback): () => void {
  liveSyncListeners.add(callback);
  startLiveSyncLoop();
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
    const activeSyncId = await getActiveSyncId();
    const remote = await fetchRemote(activeSyncId);
    if (!remote) return;

    const myDevice = await getLocalDeviceInfo();
    const isDissociated = Boolean(
      remote.dissociatedDevices && remote.dissociatedDevices[myDevice.id],
    );
    const isAlreadyRegistered = Boolean(
      remote.devices && remote.devices[myDevice.id],
    );
    const otherDevs = remote.devices
      ? Object.keys(remote.devices).filter((k) => k !== myDevice.id)
      : [];

    if (isDissociated || (!isAlreadyRegistered && otherDevs.length > 0)) {
      await handleLocalDeviceWasKickedOut(myDevice);
      return;
    }

    const devices = remote.devices || {};
    const devEntries = Object.values(devices).filter(
      Boolean,
    ) as SyncDeviceInfo[];
    const devHash = devEntries
      .map((d) => `${d.id}:${d.name}:${d.lastActive}`)
      .sort()
      .join("|");

    const remoteUpdated = remote.updatedAt || 0;
    const localLastSync = (await getLastCloudSync()) || 0;

    const hasNewDevices = devHash !== lastKnownDevicesHash;
    const hasNewData =
      remoteUpdated > Math.max(localLastSync, lastKnownRemoteUpdatedAt);

    if (hasNewDevices || hasNewData) {
      lastKnownDevicesHash = devHash;
      lastKnownRemoteUpdatedAt = remoteUpdated;

      const syncResult = await syncWithICloudStorage();
      await notifyLiveSyncListeners(syncResult.updated);

      if (syncResult.updated) {
        await refreshAppleCalendarIfConfigured();
      }
    }
  } catch {
  } finally {
    isPollingInProgress = false;
  }
}

export function startLiveSyncLoop(): void {
  if (livePollTimer) return;
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

AppState.addEventListener("change", (nextState: AppStateStatus) => {
  if (nextState === "active") {
    startLiveSyncLoop();
  } else {
    stopLiveSyncLoop();
  }
});

/**
 * Ripristina l'app dissociandola da tutti gli altri dispositivi,
 * eliminando il vecchio documento sul cloud Firebase, cancellando
 * lo storage locale e generando un nuovo codice univoco garantito.
 */
export async function resetAppCloudAndStorage(): Promise<string> {
  try {
    const ownId = await AsyncStorage.getItem(CLOUD_SYNC_ID_KEY);
    const activeSyncId = await getActiveSyncId().catch(() => null);

    // 1. Dissocia da master o dispositivi collegati a cascata
    try {
      if (activeSyncId) {
        await dissociateDevice();
      }
    } catch (e) {
      console.warn("Dissociation error during app reset:", e);
    }

    // 2. Elimina il documento remoto associato al vecchio codice sul cloud Firebase
    if (isCloudConfigured() && ownId) {
      try {
        await fetchWithTimeout(remoteUrl(ownId), { method: "DELETE" });
      } catch (e) {
        console.warn("Delete remote document error during app reset:", e);
      }
    }

    // 3. Svuota completamente la memoria locale
    await AsyncStorage.clear();

    // 4. Genera un codice univoco nuovo e pulito
    const newCode = await generateUniqueInitialSyncCode();
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, newCode);

    // 5. Genera un nuovo ID per l'istanza del dispositivo
    const newDevId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await AsyncStorage.setItem(LOCAL_DEVICE_ID_KEY, newDevId);

    return newCode;
  } catch (err) {
    console.error("Critical error in resetAppCloudAndStorage:", err);
    await AsyncStorage.clear();
    const fallbackCode = generateInitialSyncCode();
    await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, fallbackCode);
    return fallbackCode;
  }
}
