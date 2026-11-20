import * as FileSystem from "expo-file-system/legacy";
import { SYNC_DB_URL } from "../config/syncConfig";

/** Dimensione massima sincronizzabile via cloud (Realtime Database, contenuto in base64 a blocchi) */
export const MAX_CLOUD_FILE_BYTES = 10 * 1024 * 1024;
/** Lunghezza di ogni blocco base64 (multiplo di 4) */
const CHUNK_CHARS = 512 * 1024;
const FILE_REQUEST_TIMEOUT_MS = 45000;
const MAX_CONCURRENT_CHUNKS = 3;

async function runChunkPool(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<void>
): Promise<void> {
  let nextIdx = 0;
  const workerCount = Math.min(Math.max(1, concurrency), count);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= count) break;
        await worker(idx);
      }
    })
  );
}

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

    // Per file <= 2 chunk (~750 KB): trasferimento unico su fileRootUrl (wire-compatible con /c0, /c1)
    if (total <= 2) {
      const payload: Record<string, string> = {};
      for (let i = 0; i < total; i++) {
        payload[`c${i}`] = b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
      }
      const res = await timedFetch(fileRootUrl(docId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Upload file fallito (${res.status})`);
      return total;
    }

    // Per file grandi: upload parallelo con concorrenza limitata (max 3 chunk)
    await runChunkPool(total, MAX_CONCURRENT_CHUNKS, async (i) => {
      const part = b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
      const res = await timedFetch(fileNodeUrl(docId, i), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(part),
      });
      if (!res.ok) throw new Error(`Upload blocco ${i} fallito (${res.status})`);
    });
    return total;
  } catch (err) {
    console.warn("Errore upload file su cloud:", err);
    // Pulizia eventuali chunk parziali orfani
    deleteCloudFile(docId).catch(() => {});
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
    const parts: string[] = new Array(chunks);

    if (chunks <= 2) {
      const res = await timedFetch(fileRootUrl(docId));
      if (!res.ok) throw new Error(`Download file fallito (${res.status})`);
      const obj = await res.json();
      if (!obj || typeof obj !== "object") {
        throw new Error("Payload file mancante");
      }
      for (let i = 0; i < chunks; i++) {
        const part = obj[`c${i}`];
        if (typeof part !== "string") throw new Error(`Blocco ${i} mancante`);
        parts[i] = part;
      }
    } else {
      await runChunkPool(chunks, MAX_CONCURRENT_CHUNKS, async (i) => {
        const res = await timedFetch(fileNodeUrl(docId, i));
        if (!res.ok) throw new Error(`Download blocco ${i} fallito (${res.status})`);
        const part = await res.json();
        if (typeof part !== "string") throw new Error(`Blocco ${i} mancante`);
        parts[i] = part;
      });
    }

    const b64 = parts.join("");
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
