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
  updateType: UpdateType;
  isMajor: boolean;
}

/**
 * Distingue tra major update obbligatorio e minor/patch/fix opzionale
 */
export function detectUpdateType(
  latestVersion: string,
  currentVersion: string,
  releaseNotes = '',
  releaseTitle = ''
): UpdateType {
  const cleanL = latestVersion.replace(/^v/i, '').trim();
  const cleanC = currentVersion.replace(/^v/i, '').trim();
  const lParts = cleanL.split('.').map((n) => parseInt(n, 10) || 0);
  const cParts = cleanC.split('.').map((n) => parseInt(n, 10) || 0);

  const notesLower = `${releaseTitle} ${releaseNotes}`.toLowerCase();
  const isExplicitlyNonBlocking =
    notesLower.includes('non bloccante') ||
    notesLower.includes('non obbligatorio') ||
    cleanL === '1.8.6';
  const hasMajorTag =
    !isExplicitlyNonBlocking &&
    (notesLower.includes('[major]') ||
      notesLower.includes('[breaking]') ||
      notesLower.includes('obbligatorio') ||
      notesLower.includes('aggiornamento obbligatorio') ||
      notesLower.includes('bloccante') ||
      notesLower.includes('aggiornamento bloccante') ||
      notesLower.includes('mandatory'));

  // Se c'è il tag di aggiornamento obbligatorio/bloccante, major superiore o versione 1.8.4 / 1.8.5
  if (hasMajorTag || (lParts[0] ?? 0) > (cParts[0] ?? 0) || cleanL === '1.8.4' || cleanL === '1.8.5') {
    return 'major';
  }

  // Nuove feature / minor (es. 1.9 vs 1.8)
  if ((lParts[1] ?? 0) > (cParts[1] ?? 0)) {
    return 'minor';
  }

  // Bug fix / patch (es. 1.8.3 vs 1.8.2)
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

/**
 * Controlla se è presente una nuova release su GitHub
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  const currentVersion = Constants.expoConfig?.version || '1.7.7';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'StudICI-App',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
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
    }

    const release = await response.json();
    const rawTag = release.tag_name || release.name || '';
    const versionMatch = rawTag.match(/v?(\d+\.\d+\.\d+)/i) || (release.name && release.name.match(/v?(\d+\.\d+\.\d+)/i));
    const latestVersion = versionMatch ? versionMatch[1] : rawTag.replace(/^v/i, '');

    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // Trova l'asset IPA se presente tra gli asset caricati
    let ipaUrl = GITHUB_LATEST_IPA_URL;
    if (Array.isArray(release.assets)) {
      const ipaAsset = release.assets.find((a: any) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.ipa'));
      if (ipaAsset?.browser_download_url) {
        ipaUrl = ipaAsset.browser_download_url;
      }
    }

    const releaseTitle = release.name || `StudICI v${latestVersion}`;
    const releaseNotes = release.body || '';
    const targetCommitish = release.target_commitish || release.tag_name || `v${latestVersion}`;
    const updateType = detectUpdateType(latestVersion, currentVersion, releaseNotes, releaseTitle);
    const isMajor = hasUpdate && updateType === 'major';

    return {
      hasUpdate,
      latestVersion,
      currentVersion,
      releaseTitle,
      releaseNotes,
      htmlUrl: release.html_url || GITHUB_LATEST_RELEASE_URL,
      ipaUrl,
      publishedAt: release.published_at,
      targetCommitish,
      updateType,
      isMajor,
    };
  } catch {
    return {
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
  }
}

/**
 * Apre SideStore aggiungendo automaticamente la sorgente
 */
export async function openInSideStore(): Promise<void> {
  const supported = await Linking.canOpenURL('sidestore://').catch(() => false);
  if (supported) {
    Linking.openURL(SIDESTORE_SCHEME_URL);
  } else {
    // Prova AltStore come alternativa
    const altSupported = await Linking.canOpenURL('altstore://').catch(() => false);
    if (altSupported) {
      Linking.openURL(ALTSTORE_SCHEME_URL);
    } else {
      await Clipboard.setStringAsync(SIDESTORE_SOURCE_RAW_URL);
      Alert.alert(
        'Sorgente SideStore Copiata',
        'SideStore non è stato aperto direttamente, ma l\'URL della sorgente è stato copiato negli appunti:\n\n' +
          SIDESTORE_SOURCE_RAW_URL +
          '\n\nIncolla questo link nella scheda "Sources" di SideStore o AltStore per aggiornare con un tap.',
        [
          { text: 'OK' },
          { text: 'Apri Release Web', onPress: () => Linking.openURL(GITHUB_LATEST_RELEASE_URL) },
        ]
      );
    }
  }
}

/**
 * Apre LiveContainer per installare direttamente l'IPA
 */
export async function openInLiveContainer(): Promise<void> {
  const supported = await Linking.canOpenURL('livecontainer://').catch(() => false);
  if (supported) {
    Linking.openURL(LIVECONTAINER_SCHEME_URL);
  } else {
    await Clipboard.setStringAsync(GITHUB_LATEST_IPA_URL);
    Alert.alert(
      'LiveContainer Link Copiato',
      'L\'URL per scaricare l\'IPA di StudICI è stato copiato negli appunti:\n\n' +
        GITHUB_LATEST_IPA_URL +
        '\n\nPuoi incollare il link in LiveContainer o Safari per installare la nuova versione.',
      [
        { text: 'OK' },
        { text: 'Scarica da Safari', onPress: () => Linking.openURL(GITHUB_LATEST_RELEASE_URL) },
      ]
    );
  }
}

/**
 * Mostra il menu completo di aggiornamento in stile nativo iOS / ActionSheet
 */
export function presentUpdateActionSheet(updateInfo: AppUpdateInfo): void {
  const title = `Aggiornamento StudICI v${updateInfo.latestVersion}`;
  const message = `Versione attuale: v${updateInfo.currentVersion}\nScegli la modalità di installazione:`;

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [
          'Annulla',
          '⚡ Aggiorna con SideStore (1-tap)',
          '📦 Installa con LiveContainer',
          '🌐 Scarica IPA da GitHub Release',
          '📋 Copia URL Sorgente SideStore',
          '📋 Copia Link Diretto IPA',
        ],
        cancelButtonIndex: 0,
      },
      async (buttonIndex) => {
        if (buttonIndex === 1) {
          openInSideStore();
        } else if (buttonIndex === 2) {
          openInLiveContainer();
        } else if (buttonIndex === 3) {
          Linking.openURL(updateInfo.htmlUrl || GITHUB_LATEST_RELEASE_URL);
        } else if (buttonIndex === 4) {
          await Clipboard.setStringAsync(SIDESTORE_SOURCE_RAW_URL);
          Alert.alert('Copiato', 'URL Sorgente SideStore copiato negli appunti!');
        } else if (buttonIndex === 5) {
          await Clipboard.setStringAsync(updateInfo.ipaUrl || GITHUB_LATEST_IPA_URL);
          Alert.alert('Copiato', 'Link diretto al file IPA copiato negli appunti!');
        }
      }
    );
  } else {
    Alert.alert(
      title,
      message,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Apri Release GitHub', onPress: () => Linking.openURL(updateInfo.htmlUrl || GITHUB_LATEST_RELEASE_URL) },
        { text: 'SideStore / LiveContainer', onPress: () => openInSideStore() },
      ]
    );
  }
}
