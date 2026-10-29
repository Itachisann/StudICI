import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

export type SavedItemType = "link" | "file" | "note";

export interface SavedDocument {
  id: string;
  type: SavedItemType;
  title: string;
  url?: string;
  fileName?: string;
  fileUri?: string;
  fileSize?: number;
  mimeType?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export const SAVED_DOCUMENTS_KEY = "studici_saved_documents";
export const SAVED_DOCUMENTS_TOMBSTONES_KEY = "studici_saved_documents_tombstones";
export const SAVED_DOCUMENTS_MODIFIED_KEY = "studici_saved_documents_modified_at";

const savedDocumentsListeners = new Set<() => void>();

export function subscribeToSavedDocumentsChanges(cb: () => void): () => void {
  savedDocumentsListeners.add(cb);
  return () => {
    savedDocumentsListeners.delete(cb);
  };
}

export function notifySavedDocumentsChanged(): void {
  for (const listener of savedDocumentsListeners) {
    try {
      listener();
    } catch {}
  }
}

export async function getSavedDocuments(): Promise<SavedDocument[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_DOCUMENTS_KEY);
    if (!raw) return [];
    const list: any[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    // Normalizza e garantisce retrocompatibilità con elementi creati come link
    const normalized: SavedDocument[] = list.map((item) => {
      const type: SavedItemType = item.type || (item.fileName ? "file" : item.url ? "link" : "note");
      return {
        id: String(item.id),
        type,
        title: item.title || "Senza titolo",
        url: item.url || undefined,
        fileName: item.fileName || undefined,
        fileUri: item.fileUri || undefined,
        fileSize: item.fileSize || undefined,
        mimeType: item.mimeType || undefined,
        note: item.note || undefined,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      };
    });

    return normalized.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

export async function getSavedDocumentsTombstones(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_DOCUMENTS_TOMBSTONES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setSavedDocumentsTombstones(
  tombstones: Record<string, number>
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SAVED_DOCUMENTS_TOMBSTONES_KEY,
      JSON.stringify(tombstones)
    );
  } catch {}
}

export async function persistPickedFile(
  sourceUri: string,
  fileName: string
): Promise<string> {
  try {
    const docsDir = `${FileSystem.documentDirectory}saved_docs/`;
    const dirInfo = await FileSystem.getInfoAsync(docsDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(docsDir, { intermediates: true });
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destUri = `${docsDir}${Date.now()}_${safeName}`;
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    return destUri;
  } catch (err) {
    console.warn("Errore salvataggio permanente file:", err);
    return sourceUri;
  }
}

export async function saveSavedDocument(
  doc: {
    id?: string;
    type: SavedItemType;
    title: string;
    url?: string;
    fileName?: string;
    fileUri?: string;
    fileSize?: number;
    mimeType?: string;
    note?: string;
  },
  silent: boolean = false
): Promise<SavedDocument> {
  const current = await getSavedDocuments();
  const now = Date.now();
  let updatedDoc: SavedDocument;

  let normalizedUrl = doc.url ? doc.url.trim() : undefined;
  if (normalizedUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  if (doc.id) {
    const existingIdx = current.findIndex((d) => d.id === doc.id);
    if (existingIdx >= 0) {
      updatedDoc = {
        ...current[existingIdx],
        type: doc.type,
        title: doc.title.trim(),
        url: normalizedUrl,
        fileName: doc.fileName?.trim() || undefined,
        fileUri: doc.fileUri || current[existingIdx].fileUri,
        fileSize: doc.fileSize !== undefined ? doc.fileSize : current[existingIdx].fileSize,
        mimeType: doc.mimeType || current[existingIdx].mimeType,
        note: doc.note?.trim() || undefined,
        updatedAt: now,
      };
      current[existingIdx] = updatedDoc;
    } else {
      updatedDoc = {
        id: doc.id,
        type: doc.type,
        title: doc.title.trim(),
        url: normalizedUrl,
        fileName: doc.fileName?.trim() || undefined,
        fileUri: doc.fileUri,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        note: doc.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      current.unshift(updatedDoc);
    }
  } else {
    updatedDoc = {
      id: `doc_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type: doc.type,
      title: doc.title.trim(),
      url: normalizedUrl,
      fileName: doc.fileName?.trim() || undefined,
      fileUri: doc.fileUri,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      note: doc.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    current.unshift(updatedDoc);
  }

  await Promise.all([
    AsyncStorage.setItem(SAVED_DOCUMENTS_KEY, JSON.stringify(current)),
    AsyncStorage.setItem(SAVED_DOCUMENTS_MODIFIED_KEY, String(now)),
  ]);

  if (!silent) {
    notifySavedDocumentsChanged();
  }

  return updatedDoc;
}

export async function saveSavedDocumentsBatch(
  newItems: {
    type: SavedItemType;
    title: string;
    url?: string;
    fileName?: string;
    fileUri?: string;
    fileSize?: number;
    mimeType?: string;
    note?: string;
  }[],
  silent: boolean = false
): Promise<SavedDocument[]> {
  if (newItems.length === 0) return [];
  const current = await getSavedDocuments();
  const now = Date.now();
  const createdList: SavedDocument[] = [];

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    let normalizedUrl = item.url ? item.url.trim() : undefined;
    if (normalizedUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    const created: SavedDocument = {
      id: `doc_${now + i}_${Math.random().toString(36).substring(2, 7)}`,
      type: item.type,
      title: item.title.trim(),
      url: normalizedUrl,
      fileName: item.fileName?.trim() || undefined,
      fileUri: item.fileUri,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      note: item.note?.trim() || undefined,
      createdAt: now + i,
      updatedAt: now + i,
    };
    createdList.push(created);
    current.unshift(created);
  }

  await Promise.all([
    AsyncStorage.setItem(SAVED_DOCUMENTS_KEY, JSON.stringify(current)),
    AsyncStorage.setItem(SAVED_DOCUMENTS_MODIFIED_KEY, String(now)),
  ]);

  if (!silent) {
    notifySavedDocumentsChanged();
  }

  return createdList;
}

export async function deleteSavedDocument(
  id: string,
  silent: boolean = false
): Promise<void> {
  const current = await getSavedDocuments();
  const tombstones = await getSavedDocumentsTombstones();
  const now = Date.now();

  const toDelete = current.find((d) => d.id === id);
  if (toDelete?.fileUri) {
    FileSystem.deleteAsync(toDelete.fileUri, { idempotent: true }).catch(() => {});
  }

  const filtered = current.filter((d) => d.id !== id);
  tombstones[id] = now;

  await Promise.all([
    AsyncStorage.setItem(SAVED_DOCUMENTS_KEY, JSON.stringify(filtered)),
    AsyncStorage.setItem(
      SAVED_DOCUMENTS_TOMBSTONES_KEY,
      JSON.stringify(tombstones)
    ),
    AsyncStorage.setItem(SAVED_DOCUMENTS_MODIFIED_KEY, String(now)),
  ]);

  if (!silent) {
    notifySavedDocumentsChanged();
  }
}

export async function setAllSavedDocuments(
  docs: SavedDocument[],
  tombstones?: Record<string, number>,
  modifiedAt?: number,
  silent: boolean = false
): Promise<void> {
  const now = modifiedAt || Date.now();
  const ops: Promise<void>[] = [
    AsyncStorage.setItem(SAVED_DOCUMENTS_KEY, JSON.stringify(docs)),
    AsyncStorage.setItem(SAVED_DOCUMENTS_MODIFIED_KEY, String(now)),
  ];
  if (tombstones) {
    ops.push(
      AsyncStorage.setItem(
        SAVED_DOCUMENTS_TOMBSTONES_KEY,
        JSON.stringify(tombstones)
      )
    );
  }
  await Promise.all(ops);
  if (!silent) {
    notifySavedDocumentsChanged();
  }
}
