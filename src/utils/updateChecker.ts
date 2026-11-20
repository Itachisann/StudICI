import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert, ActionSheetIOS, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';

export const GITHUB_REPO = 'Itachisann/StudICI';
export const SIDESTORE_SOURCE_RAW_URL = 'https://raw.githubusercontent.com/Itachisann/StudICI/main/apps.json';
export const GITHUB_LATEST_RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
export const GITHUB_LATEST_IPA_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/StudICI.ipa`;

export const SIDESTORE_SCHEME_URL = `sidestore://source?url=${encodeURIComponent(SIDESTORE_SOURCE_RAW_URL)}`;
export const ALTSTORE_SCHEME_URL = `altstore://source?url=${encodeURIComponent(SIDESTORE_SOURCE_RAW_URL)}`;
export const LIVECONTAINER_SCHEME_URL = `livecontainer://install?url=${encodeURIComponent(GITHUB_LATEST_IPA_URL)}`;

export type UpdateType = 'major' | 'minor' | 'patch';

export interface AppUpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  htmlUrl: string;
  ipaUrl: string;
  publishedAt?: string;
  targetCommitish?: string;
  commitName?: string;
  updateType: UpdateType;
  isMajor: boolean;
}

// Versioni che sono state rilasciate come aggiornamenti bloccanti obbligatori.
// Qualsiasi versione installata precedente a una di queste riceverà l'aggiornamento come bloccante,
// anche se nel frattempo è uscita una versione successiva non bloccante.
export const KNOWN_BLOCKING_VERSIONS = ['1.8.4', '1.8.5', '1.8.7', '1.9.2', '1.9.5'];

/**
 * Verifica se le note o il titolo di una singola release indicano un aggiornamento bloccante
 */
export function isReleaseNotesBlocking(releaseNotes = '', releaseTitle = '', version = ''): boolean {
  const cleanV = version.replace(/^v/i, '').trim();
  if (KNOWN_BLOCKING_VERSIONS.includes(cleanV)) {
    return true;
  }

  const notesLower = `${releaseTitle} ${releaseNotes}`.toLowerCase();
  const isExplicitlyNonBlocking =
    notesLower.includes('non bloccante') ||
    notesLower.includes('non obbligatorio') ||
    cleanV === '1.8.6';

  if (isExplicitlyNonBlocking) {
    return false;
  }

  return (
    notesLower.includes('[major]') ||
    notesLower.includes('[breaking]') ||
    notesLower.includes('obbligatorio') ||
    notesLower.includes('aggiornamento obbligatorio') ||
    notesLower.includes('bloccante') ||
    notesLower.includes('aggiornamento bloccante') ||
    notesLower.includes('mandatory')
  );
}

/**
 * Distingue tra major update obbligatorio e minor/patch/fix opzionale,
 * tenendo conto anche di eventuali aggiornamenti bloccanti intermedi saltati dall'utente.
 */
export function detectUpdateType(
  latestVersion: string,
  currentVersion: string,
  releaseNotes = '',
  releaseTitle = '',
  missedReleases: { version: string; body?: string; name?: string }[] = []
): UpdateType {
  const cleanL = latestVersion.replace(/^v/i, '').trim();
  const cleanC = currentVersion.replace(/^v/i, '').trim();
  const lParts = cleanL.split('.').map((n) => parseInt(n, 10) || 0);
  const cParts = cleanC.split('.').map((n) => parseInt(n, 10) || 0);

  // 1. Se la major semver è aumentata (es. 2.0.0 vs 1.x.y)
  if ((lParts[0] ?? 0) > (cParts[0] ?? 0)) {
    return 'major';
  }

  // 2. Se esiste una versione bloccante nota successiva alla versione attuale dell'utente
  //    ed uguale o precedente all'ultima versione disponibile
  const missedKnownBlocking = KNOWN_BLOCKING_VERSIONS.some(
    (bv) => compareVersions(bv, cleanC) > 0 && compareVersions(cleanL, bv) >= 0
  );
  if (missedKnownBlocking) {
    return 'major';
  }

  // 3. Se l'ultima release stessa è bloccante
  if (isReleaseNotesBlocking(releaseNotes, releaseTitle, cleanL)) {
    return 'major';
  }

  // 4. Se l'utente ha saltato almeno una release intermedia che era bloccante
  //    (es. 1.8.7 bloccante seguita da 1.8.8 non bloccante, e l'utente è ancora alla 1.8.6)
  for (const rel of missedReleases) {
    if (
      compareVersions(rel.version, cleanC) > 0 &&
      compareVersions(cleanL, rel.version) >= 0 &&
      isReleaseNotesBlocking(rel.body || '', rel.name || '', rel.version)
    ) {
      return 'major';
    }
  }

  // Nuove feature / minor (es. 1.9 vs 1.8)
  if ((lParts[1] ?? 0) > (cParts[1] ?? 0)) {
    return 'minor';
  }

  // Bug fix / patch (es. 1.8.6 vs 1.8.5)
  return 'patch';
}

/**
 * Confronta due stringhe di versione semver (es. "1.7.8" vs "1.7.7")
 * Ritorna:
 *  1 se v1 > v2
 * -1 se v1 < v2
 *  0 se v1 == v2
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, '').trim();
  const clean2 = v2.replace(/^v/i, '').trim();

  const parts1 = clean1.split('.').map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map((n) => parseInt(n, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

function extractReleaseVersion(release: any): string {
  const rawTag = release?.tag_name || release?.name || '';
  const versionMatch =
    rawTag.match(/v?(\d+\.\d+\.\d+)/i) ||
    (release?.name && String(release.name).match(/v?(\d+\.\d+\.\d+)/i));
  return versionMatch ? versionMatch[1] : String(rawTag).replace(/^v/i, '').trim();
}

const UPDATE_CHECK_CACHE_TTL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_STORAGE_KEY = '@studici_update_check_cache_v1';

interface PersistedUpdateMeta {
  etag?: string;
  latestVersion: string;
  currentVersion: string;
  data: AppUpdateInfo;
  checkedAt: number;
}

let cachedUpdateCheck: { timestamp: number; data: AppUpdateInfo } | null = null;
let persistedUpdateMeta: PersistedUpdateMeta | null | undefined = undefined;
let inFlightUpdateCheck: Promise<AppUpdateInfo> | null = null;

async function loadPersistedUpdateMeta(): Promise<PersistedUpdateMeta | null> {
  if (persistedUpdateMeta !== undefined) return persistedUpdateMeta;
  try {
    const raw = await AsyncStorage.getItem(UPDATE_CHECK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.data) {
        persistedUpdateMeta = parsed as PersistedUpdateMeta;
        return persistedUpdateMeta;
      }
    }
  } catch {
    // ignore storage errors
  }
  persistedUpdateMeta = null;
  return null;
}

/**
 * Controlla se è presente una nuova release su GitHub usando /releases/latest + ETag (304),
 * interrogando /releases?per_page=20 solo se esiste effettivamente un aggiornamento non ancora
 * classificato come major (per verificare eventuali release bloccanti intermedie saltate).
 */
export async function checkForAppUpdate(forceRefresh = false): Promise<AppUpdateInfo> {
  if (!forceRefresh && cachedUpdateCheck && Date.now() - cachedUpdateCheck.timestamp < UPDATE_CHECK_CACHE_TTL_MS) {
    return cachedUpdateCheck.data;
  }
  if (!forceRefresh && inFlightUpdateCheck) {
    return inFlightUpdateCheck;
  }

  const runCheck = async (): Promise<AppUpdateInfo> => {
    const currentVersion = Constants.expoConfig?.version || '1.7.7';

    const emptyResult: AppUpdateInfo = {
      hasUpdate: false,
      latestVersion: currentVersion,
      currentVersion,
      releaseTitle: '',
      releaseNotes: '',
      htmlUrl: GITHUB_LATEST_RELEASE_URL,
      ipaUrl: GITHUB_LATEST_IPA_URL,
      updateType: 'patch',
      isMajor: false,
    };

    try {
      const persisted = await loadPersistedUpdateMeta();
      const canUseEtag = Boolean(
        persisted?.etag && persisted.currentVersion === currentVersion && persisted.data
      );

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'StudICI-App',
      };
      if (canUseEtag && persisted?.etag) {
        headers['If-None-Match'] = persisted.etag;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Endpoint leggero (~2 KB) invece di /releases?per_page=20 (~60 KB) + validazione condizionale ETag (304)
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      if (response.status === 304 && persisted?.data) {
        cachedUpdateCheck = { timestamp: Date.now(), data: persisted.data };
        return persisted.data;
      }

      if (!response.ok) {
        return persisted?.currentVersion === currentVersion && persisted.data
          ? persisted.data
          : emptyResult;
      }

      const release = await response.json();
      if (!release || typeof release !== 'object') {
        return emptyResult;
      }

      const latestVersion = extractReleaseVersion(release);
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

      // Trova l'asset IPA se presente tra gli asset caricati dell'ultima release
      let ipaUrl = GITHUB_LATEST_IPA_URL;
      if (Array.isArray(release.assets)) {
        const ipaAsset = release.assets.find(
          (a: any) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.ipa')
        );
        if (ipaAsset?.browser_download_url) {
          ipaUrl = ipaAsset.browser_download_url;
        }
      }

      const releaseTitle = release.name || `StudICI v${latestVersion}`;
      const releaseNotes = release.body || '';
      const targetCommitish = release.target_commitish || release.tag_name || `v${latestVersion}`;

      let updateType = detectUpdateType(
        latestVersion,
        currentVersion,
        releaseNotes,
        releaseTitle,
        []
      );

      // Controlla le release intermedie SOLO se esiste un aggiornamento e non è già risultato bloccante/major
      if (hasUpdate && updateType !== 'major') {
        try {
          const listCtrl = new AbortController();
          const listTimeout = setTimeout(() => listCtrl.abort(), 6000);
          const listRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`,
            {
              signal: listCtrl.signal,
              headers: {
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'StudICI-App',
              },
            }
          );
          clearTimeout(listTimeout);
          if (listRes.ok) {
            const releasesData = await listRes.json();
            const releasesList = Array.isArray(releasesData)
              ? releasesData.filter((r: any) => !r?.draft && !r?.prerelease)
              : [];
            const missedReleases = releasesList
              .map((r: any) => ({
                version: extractReleaseVersion(r),
                body: r?.body || '',
                name: r?.name || '',
              }))
              .filter(
                (r) =>
                  Boolean(r.version) &&
                  compareVersions(r.version, currentVersion) > 0 &&
                  compareVersions(latestVersion, r.version) >= 0
              );
            updateType = detectUpdateType(
              latestVersion,
              currentVersion,
              releaseNotes,
              releaseTitle,
              missedReleases
            );
          }
        } catch {
          // Best-effort per release intermedie
        }
      }

      const isMajor = hasUpdate && updateType === 'major';

      const result: AppUpdateInfo = {
        hasUpdate,
        latestVersion,
        currentVersion,
        releaseTitle,
        releaseNotes,
        htmlUrl: release.html_url || GITHUB_LATEST_RELEASE_URL,
        ipaUrl,
        publishedAt: release.published_at,
        targetCommitish,
        commitName: releaseTitle || `v${latestVersion}`,
        updateType,
        isMajor,
      };
      cachedUpdateCheck = { timestamp: Date.now(), data: result };

      const etag = response.headers.get('etag') || response.headers.get('ETag') || undefined;
      const metaToSave: PersistedUpdateMeta = {
        etag,
        latestVersion,
        currentVersion,
        data: result,
        checkedAt: Date.now(),
      };
      persistedUpdateMeta = metaToSave;
      AsyncStorage.setItem(UPDATE_CHECK_STORAGE_KEY, JSON.stringify(metaToSave)).catch(() => {});

      return result;
    } catch {
      return emptyResult;
    }
  };

  if (forceRefresh) {
    return runCheck();
  }

  inFlightUpdateCheck = runCheck().finally(() => {
    inFlightUpdateCheck = null;
  });
  return inFlightUpdateCheck;
}


/**
 * Mostra il menu di aggiornamento con download diretto, copia sorgente e changelog
 */
export function presentUpdateActionSheet(updateInfo: AppUpdateInfo): void {
  const title = `Aggiornamento StudICI v${updateInfo.latestVersion}`;
  const message = `Versione attuale: v${updateInfo.currentVersion}`;

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [
          'Annulla',
          'Download',
          'Copia URL sorgente',
          'Consulta Changelog',
        ],
        cancelButtonIndex: 0,
      },
      async (buttonIndex) => {
        if (buttonIndex === 1) {
          Linking.openURL(updateInfo.ipaUrl || GITHUB_LATEST_IPA_URL);
        } else if (buttonIndex === 2) {
          await Clipboard.setStringAsync(SIDESTORE_SOURCE_RAW_URL);
          Alert.alert('Copiato', 'URL sorgente copiato negli appunti.');
        } else if (buttonIndex === 3) {
          Linking.openURL(updateInfo.htmlUrl || GITHUB_LATEST_RELEASE_URL);
        }
      }
    );
  } else {
    Alert.alert(
      title,
      message,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Download', onPress: () => Linking.openURL(updateInfo.ipaUrl || GITHUB_LATEST_IPA_URL) },
        {
          text: 'Copia URL sorgente',
          onPress: async () => {
            await Clipboard.setStringAsync(SIDESTORE_SOURCE_RAW_URL);
            Alert.alert('Copiato', 'URL sorgente copiato negli appunti.');
          },
        },
        { text: 'Consulta Changelog', onPress: () => Linking.openURL(updateInfo.htmlUrl || GITHUB_LATEST_RELEASE_URL) },
      ]
    );
  }
}
