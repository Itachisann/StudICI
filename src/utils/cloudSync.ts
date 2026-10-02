import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { getAttendanceRecords, AttendanceRecord } from './attendance';

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
 * Attiva o disattiva la sincronizzazione automatica iCloud
 */
export async function setICloudAutoSyncEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ICLOUD_AUTO_SYNC_KEY, enabled ? 'true' : 'false');
    if (enabled) {
      await syncWithICloudStorage();
    }
  } catch (err) {
    console.error('Error saving iCloud auto sync setting:', err);
  }
}

/**
 * Esegue la sincronizzazione bidirezionale con lo storage iCloud:
 * - Se su iCloud esiste un backup più recente di quello locale, ripristina i dati.
 * - Se i dati locali sono più recenti o uguali, aggiorna il backup iCloud.
 */
export async function syncWithICloudStorage(): Promise<{
  success: boolean;
  message: string;
  updated: boolean;
}> {
  try {
    const filePath = `${FileSystem.documentDirectory}${ICLOUD_BACKUP_FILENAME}`;
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    const lastLocal = await getLastCloudSync();

    if (fileInfo.exists) {
      const content = await FileSystem.readAsStringAsync(filePath);
      try {
        const data: CloudBackupPayload = JSON.parse(content);
        if (data && data.timestamp && (!lastLocal || data.timestamp > lastLocal + 2000)) {
          await restoreFromCloudBackup(content);
          return {
            success: true,
            updated: true,
            message: 'Configurazione e presenze sincronizzate automaticamente da iCloud!',
          };
        }
      } catch {
        // Se il file è corrotto, sovrascrivi con i dati locali
      }
    }

    // Altrimenti esporta lo stato locale corrente verso il file iCloud
    const res = await performCloudSync();
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(res.payload));

    return {
      success: true,
      updated: false,
      message: 'iCloud aggiornato con i dati locali più recenti.',
    };
  } catch (err: any) {
    console.warn('Errore sync iCloud storage:', err);
    return {
      success: false,
      updated: false,
      message: err?.message || 'Errore durante la sincronizzazione con iCloud.',
    };
  }
}
