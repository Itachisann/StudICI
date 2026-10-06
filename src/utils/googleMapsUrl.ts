import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

export interface MapsUrlOptions {
  origin?: string;
  destination: string;
  travelMode?: 'transit' | 'driving' | 'walking';
  targetDate?: string; // "YYYY-MM-DD"
  targetTime?: string; // "HH:MM"
  timeType?: 'arrive_by' | 'depart_at';
}

/**
 * Costruisce l'URL di Google Maps precompilato con:
 * - Origine e Destinazione
 * - Modalità di viaggio (transit, driving, walking)
 * - Data e Ora esatta (arrive by / depart at) tramite il protobuf data encoding e query parameters
 */
export function buildGoogleMapsUrl(options: MapsUrlOptions): {
  webUrl: string;
  appUrl: string;
} {
  const {
    origin,
    destination,
    travelMode = 'transit',
    targetDate,
    targetTime,
    timeType = 'arrive_by',
  } = options;

  let epochSeconds: number | null = null;
  if (targetDate && targetTime) {
    const [y, m, d] = targetDate.split('-').map(Number);
    const [hh, mm] = targetTime.split(':').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d) && !isNaN(hh) && !isNaN(mm)) {
      const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
      epochSeconds = Math.floor(dt.getTime() / 1000);
    }
  }

  const encOrigin = origin ? encodeURIComponent(origin) : '';
  const encDest = encodeURIComponent(destination);

  // travelMode data code: transit=!3e3, driving=!3e0, walking=!3e2
  const modeCode = travelMode === 'transit' ? '!3e3' : travelMode === 'walking' ? '!3e2' : '!3e0';
  const timeCode = epochSeconds
    ? (timeType === 'arrive_by'
        ? `!2m3!6e1!7e2!8j${epochSeconds}`
        : `!2m3!6e0!7e2!8j${epochSeconds}`)
    : '';

  const dataParam = timeCode || modeCode ? `data=${timeCode}${modeCode}` : '';

  let webUrl = `https://www.google.com/maps/dir/${encOrigin}/${encDest}/`;
  if (dataParam) webUrl += dataParam;

  const queryParts: string[] = [];
  if (targetDate) queryParts.push(`date=${encodeURIComponent(targetDate)}`);
  if (targetTime) queryParts.push(`time=${encodeURIComponent(targetTime)}`);
  if (timeType) queryParts.push(`ttype=${timeType === 'arrive_by' ? 'arr' : 'dep'}`);
  if (travelMode === 'transit') queryParts.push('dirflg=r');
  else if (travelMode === 'walking') queryParts.push('dirflg=w');
  else if (travelMode === 'driving') queryParts.push('dirflg=d');

  if (queryParts.length > 0) {
    webUrl += `?${queryParts.join('&')}`;
  }

  // Schema nativo iOS / Android app comgooglemaps://
  const gmapsMode = travelMode === 'transit' ? 'transit' : travelMode === 'walking' ? 'walking' : 'driving';
  const appUrl = origin
    ? `comgooglemaps://?saddr=${encOrigin}&daddr=${encDest}&directionsmode=${gmapsMode}`
    : `comgooglemaps://?daddr=${encDest}&directionsmode=${gmapsMode}`;

  return { webUrl, appUrl };
}

/**
 * Apre la pagina di Google Maps già precompilata con origine, destinazione,
 * mezzo di trasporto e soprattutto DATA e ORA esatta (arrive by / depart at) della lezione.
 * Usa il browser Safari in-app (SFSafariViewController) per garantire che Google Maps rispetti
 * l'orario di lezione invece di resettarlo a "Parti adesso / orario attuale".
 */
export async function openGoogleMaps(options: MapsUrlOptions): Promise<void> {
  const { webUrl, appUrl } = buildGoogleMapsUrl(options);

  try {
    await WebBrowser.openBrowserAsync(webUrl, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: '#822433',
      toolbarColor: '#16181d',
    });
  } catch {
    Linking.openURL(webUrl).catch(() => {
      Linking.openURL(appUrl);
    });
  }
}
