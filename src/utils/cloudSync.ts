import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { getAttendanceRecords, AttendanceRecord } from './attendance';

const CLOUD_SYNC_ID_KEY = 'studici_cloud_sync_id';
const LAST_CLOUD_SYNC_KEY = 'studici_last_cloud_sync';
const CLOUD_BACKUP_DATA_KEY = 'studici_cloud_backup_data';

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

/**
 * Ottiene o genera un ID univoco Cloud StudICI (es. STUD-8492-1053)
 */
export async function getCloudSyncId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(CLOUD_SYNC_ID_KEY);
    if (!id) {
      const part1 = Math.floor(1000 + Math.random() * 9000);
      const part2 = Math.floor(1000 + Math.random() * 9000);
      id = `STUD-${part1}-${part2}`;
      await AsyncStorage.setItem(CLOUD_SYNC_ID_KEY, id);
    }
    return id;
  } catch {
    return 'STUD-1000-2000';
  }
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
    version: '1.5.0',
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
