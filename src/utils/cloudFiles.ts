import * as FileSystem from "expo-file-system/legacy";
import { SYNC_DB_URL } from "../config/syncConfig";

/** Dimensione massima sincronizzabile via cloud (Realtime Database, contenuto in base64 a blocchi) */
export const MAX_CLOUD_FILE_BYTES = 10 * 1024 * 1024;
/** Lunghezza di ogni blocco base64 (multiplo di 4) */
const CHUNK_CHARS = 512 * 1024;
const FILE_REQUEST_TIMEOUT_MS = 45000;

function fileNodeUrl(docId: string, chunkIdx: number): string {
  return `${SYNC_DB_URL.replace(/\/+$/, "")}/sync/studici_file_${docId}/c${chunkIdx}.json`;
}

function fileRootUrl(docId: string): string {
  return `${SYNC_DB_URL.replace(/\/+$/, "")}/sync/studici_file_${docId}.json`;
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isCloudFileStorageAvailable(): boolean {
  return SYNC_DB_URL.trim().length > 0;
}

/**
 * Carica un file locale sul cloud suddividendolo in blocchi base64.
 * Ritorna il numero di blocchi caricati, oppure null se non caricabile.
 */
export async function uploadFileToCloud(
  docId: string,
  localUri: string
): Promise<number | null> {
  if (!isCloudFileStorageAvailable()) return null;
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) return null;
    if ((info as any).size && (info as any).size > MAX_CLOUD_FILE_BYTES) return null;

    const b64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const total = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
    for (let i = 0; i < total; i++) {
      const part = b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
      const res = await timedFetch(fileNodeUrl(docId, i), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(part),
      });
      if (!res.ok) throw new Error(`Upload blocco ${i} fallito (${res.status})`);
    }
    return total;
  } catch (err) {
    console.warn("Errore upload file su cloud:", err);
    return null;
  }
}

/** Scarica un file dal cloud e lo scrive in `destUri`. Ritorna true se riuscito. */
export async function downloadFileFromCloud(
  docId: string,
  chunks: number,
  destUri: string
): Promise<boolean> {
  if (!isCloudFileStorageAvailable() || chunks <= 0) return false;
  try {
    let b64 = "";
    for (let i = 0; i < chunks; i++) {
      const res = await timedFetch(fileNodeUrl(docId, i));
      if (!res.ok) throw new Error(`Download blocco ${i} fallito (${res.status})`);
      const part = await res.json();
      if (typeof part !== "string") throw new Error(`Blocco ${i} mancante`);
      b64 += part;
    }
    await FileSystem.writeAsStringAsync(destUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return true;
  } catch (err) {
    console.warn("Errore download file dal cloud:", err);
    return false;
  }
}

export async function deleteCloudFile(docId: string): Promise<void> {
  if (!isCloudFileStorageAvailable()) return;
  try {
    await timedFetch(fileRootUrl(docId), { method: "DELETE" });
  } catch {}
}
