import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { NativeSheetModal, UNIFORM_MODAL_BG } from './NativeSheetModal';
import {
  resolveTransitRoadwayPolyline,
  getTransitRoadwayPolylineSync,
  resolvePedestrianRoadwayPolyline,
} from '../utils/transitRoadwayRouter';
import {
  calculateRealWalkMinutes,
  haversineMeters,
  getLineBadgeColor,
  getTransitModeIcon,
  LatLngPoint,
  minsToHHMM,
  parseHHMMToMins,
  snapCoordinateToPolyline,
  resolveOptimizedTransitPolyline,
  ensureContinuousTransitPolyline,
  TIBURTINA_INBOUND_FROM_CASTRO,
  TIBURTINA_INBOUND_FROM_VERANO,
  TIBURTINA_INBOUND_FROM_SAN_LORENZO,
  TIBURTINA_OUTBOUND_TO_CASTRO,
  TIBURTINA_OUTBOUND_TO_VERANO,
  TIBURTINA_OUTBOUND_TO_SAN_LORENZO,
  TransitDepartureItem,
} from '../utils/transitBoardService';
import { AppTheme } from '@/constants/theme';

export interface TransitDepartureModalProps {
  visible: boolean;
  departure: TransitDepartureItem | null;
  allDepartures: TransitDepartureItem[];
  directLines: string[];
  isLiveContext: boolean;
  theme: AppTheme;
  onClose: () => void;
  onSelectDeparture?: (dep: TransitDepartureItem) => void;
}

export const TransitDepartureModal: React.FC<TransitDepartureModalProps> = ({
  visible,
  departure,
  allDepartures,
  directLines,
  isLiveContext,
  theme,
  onClose,
  onSelectDeparture,
}) => {
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>(
    {}
  );
  const [isDetourExpanded, setIsDetourExpanded] = useState<boolean>(false);
  // Traccia pedonale calcolata con OSRM foot per il percorso dalla discesa alla destinazione
  const [osrmWalkAfterCoordsById, setOsrmWalkAfterCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});
  // Traccia pedonale calcolata con OSRM foot per il percorso dall'origine alla salita del mezzo
  const [osrmWalkBeforeCoordsById, setOsrmWalkBeforeCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});
  // Traccia del mezzo calcolata con OSRM driving multi-stop ad alta precisione lungo la viabilita stradale
  const [roadwayTransitCoordsById, setRoadwayTransitCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});
  const [roadwayLegCoordsById, setRoadwayLegCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});

  const fromCoords = useMemo(() => {
    if (departure?.fromStopCoords?.lat && departure?.fromStopCoords?.lng) {
      return departure.fromStopCoords;
    }
    return { lat: 41.9102, lng: 12.5302 };
  }, [departure]);

  const originCoords = useMemo(() => {
    if (departure?.initialOriginCoords?.lat && departure?.initialOriginCoords?.lng) {
      return departure.initialOriginCoords;
    }
    return fromCoords;
  }, [departure, fromCoords]);

  const rawToCoords = useMemo(() => {
    if (departure?.toStopCoords?.lat && departure?.toStopCoords?.lng) {
      return departure.toStopCoords;
    }
    return { lat: 41.903932, lng: 12.520330 };
  }, [departure]);

  const toCoords = useMemo(() => {
    return rawToCoords;
  }, [rawToCoords]);

  const finalCoords = useMemo(() => {
    if (departure?.finalDestCoords?.lat && departure?.finalDestCoords?.lng) {
      return departure.finalDestCoords;
    }
    return toCoords;
  }, [departure, toCoords]);

  const transitRouteCoords = useMemo<LatLngPoint[]>(() => {
    if (!departure) return [];
    const roadCoords = roadwayTransitCoordsById[departure.id];
    if (roadCoords && roadCoords.length >= 2) {
      return roadCoords;
    }
    if (departure.transitPolyline && departure.transitPolyline.length >= 8) {
      return departure.transitPolyline;
    }
    const syncRoad = getTransitRoadwayPolylineSync({
      id: departure.id,
      line: departure.line,
      mode: departure.mode,
      fromCoords,
      toCoords,
      fromName: departure.fromStop,
      toName: departure.toStop,
      intermediateStops: departure.intermediateStopCoords,
      alerts: departure.alerts,
      existingPolyline: departure.transitPolyline,
    });
    if (syncRoad && syncRoad.length >= 8) {
      return syncRoad;
    }
    if (departure.transitPolyline && departure.transitPolyline.length >= 2) {
      return departure.transitPolyline;
    }
    const isSanLorenzo =
      (departure.fromStop || '').toLowerCase().includes('san lorenzo') ||
      (departure.toStop || '').toLowerCase().includes('san lorenzo') ||
      fromCoords.lat < 41.9015 ||
      toCoords.lat < 41.9015;
    const isVerano =
      (departure.fromStop || '').toLowerCase().includes('verano') ||
      (departure.toStop || '').toLowerCase().includes('verano') ||
      fromCoords.lat < 41.9036 ||
      toCoords.lat < 41.9036;
    const isHeadingNorthEast =
      toCoords.lat > fromCoords.lat + 0.0005 ||
      (departure.toStop || '').toLowerCase().includes('tiburtina') ||
      departure.id.includes('-ret');
    let basePoly: LatLngPoint[] = [];
    if (isHeadingNorthEast) {
      basePoly = isSanLorenzo
        ? TIBURTINA_INBOUND_FROM_SAN_LORENZO
        : isVerano
        ? TIBURTINA_INBOUND_FROM_VERANO
        : TIBURTINA_INBOUND_FROM_CASTRO;
    } else {
      basePoly = isSanLorenzo
        ? TIBURTINA_OUTBOUND_TO_SAN_LORENZO
        : isVerano
        ? TIBURTINA_OUTBOUND_TO_VERANO
        : TIBURTINA_OUTBOUND_TO_CASTRO;
    }

    return ensureContinuousTransitPolyline(
      { latitude: fromCoords.lat, longitude: fromCoords.lng },
      { latitude: toCoords.lat, longitude: toCoords.lng },
      departure.intermediateStopCoords,
      basePoly
    );
  }, [departure, fromCoords, toCoords, roadwayTransitCoordsById]);

  const isMultiLeg = Boolean(departure && departure.legs && departure.legs.length > 1);

  // Se ci sono più tratte (cambio), estraiamo o risolviamo la polilinea e il colore contrastante per ogni tratta
  const multiLegRoutes = useMemo(() => {
    if (!departure || !isMultiLeg || !departure.legs) return [];
    return departure.legs.map((leg, idx) => {
      const legKey = `${departure.id}_leg_${idx}`;
      const legRoadCoords = roadwayLegCoordsById[legKey];
      const legFrom = leg.fromStopCoords || fromCoords;
      const legTo = leg.toStopCoords || toCoords;
      let poly = legRoadCoords && legRoadCoords.length >= 2 ? legRoadCoords : leg.polyline;
      if (!poly || poly.length < 2) {
        poly = resolveOptimizedTransitPolyline(
          leg.fromStop,
          leg.toStop,
          legFrom,
          legTo,
          []
        );
      }
      const continuousPoly = ensureContinuousTransitPolyline(
        { latitude: legFrom.lat, longitude: legFrom.lng },
        { latitude: legTo.lat, longitude: legTo.lng },
        [],
        poly
      );
      const rawColor = getLineBadgeColor(leg.line, leg.mode);
      let color = rawColor;
      if (idx === 1 && departure.legs!.length > 1) {
        const prevColor = getLineBadgeColor(departure.legs![0].line, departure.legs![0].mode);
        if (color === prevColor || color === '#0d9488' || color === '#14b8a6') {
          color = '#e11d48'; // Colore rose contrastante per la 2a tratta
        }
      } else if (idx === 2) {
        color = '#d97706'; // Ambra contrastante per la 3a tratta
      }
      return {
        leg,
        polyline: continuousPoly,
        color,
      };
    });
  }, [departure, isMultiLeg, fromCoords, toCoords, roadwayLegCoordsById]);

  // Aggancio matematico dei marker di salita e discesa sulla polilinea del percorso:
  // Se la corsa è con cambio (multi-tratta), il punto di partenza è l'inizio della prima tratta
  // e il punto di discesa finale è la fine dell'ultima tratta (dove si scende definitivamente).
  // Se è diretta, coincidono con il primo e l'ultimo punto della polilinea del mezzo.
  const snappedFrom = useMemo(() => {
    if (isMultiLeg && multiLegRoutes.length > 0) {
      const firstLegPoly = multiLegRoutes[0].polyline;
      if (firstLegPoly.length >= 2) {
        return firstLegPoly[0];
      }
      const firstLeg = multiLegRoutes[0].leg;
      const lFrom = firstLeg.fromStopCoords || fromCoords;
      return { latitude: lFrom.lat, longitude: lFrom.lng };
    }
    if (transitRouteCoords.length >= 2) {
      return transitRouteCoords[0];
    }
    return snapCoordinateToPolyline(fromCoords, transitRouteCoords, 250);
  }, [isMultiLeg, multiLegRoutes, fromCoords, transitRouteCoords]);

  const snappedTo = useMemo(() => {
    if (isMultiLeg && multiLegRoutes.length > 0) {
      const lastLegPoly = multiLegRoutes[multiLegRoutes.length - 1].polyline;
      if (lastLegPoly.length >= 2) {
        return lastLegPoly[lastLegPoly.length - 1];
      }
      const lastLeg = multiLegRoutes[multiLegRoutes.length - 1].leg;
      const lTo = lastLeg.toStopCoords || toCoords;
      return { latitude: lTo.lat, longitude: lTo.lng };
    }
    if (transitRouteCoords.length >= 2) {
      return transitRouteCoords[transitRouteCoords.length - 1];
    }
    return snapCoordinateToPolyline(toCoords, transitRouteCoords, 250);
  }, [isMultiLeg, multiLegRoutes, toCoords, transitRouteCoords]);

  // Calcola il percorso pedonale reale (Valhalla pedestrian / OSRM foot) garantendo assoluta continuità
  // tra i punti esatti di salita (snappedFrom) e discesa (snappedTo) e le posizioni di partenza e arrivo
  useEffect(() => {
    if (!visible || !departure) return;
    let cancelled = false;
    const depId = departure.id;

    const needWalkBefore =
      (departure.walkBeforeMinutes ?? 0) > 0 ||
      (originCoords &&
        haversineMeters(
          { latitude: originCoords.lat, longitude: originCoords.lng },
          snappedFrom
        ) > 25);

    if (needWalkBefore && originCoords) {
      resolvePedestrianRoadwayPolyline(originCoords, snappedFrom)
        .then((mappedFoot) => {
          if (cancelled || !mappedFoot || mappedFoot.length < 2) return;
          setOsrmWalkBeforeCoordsById((prev) => ({
            ...prev,
            [depId]: mappedFoot,
          }));
        })
        .catch(() => {});
    }

    const needWalkAfter =
      (departure.walkAfterMinutes ?? 0) > 0 ||
      haversineMeters(
        snappedTo,
        { latitude: finalCoords.lat, longitude: finalCoords.lng }
      ) > 25;

    if (needWalkAfter) {
      resolvePedestrianRoadwayPolyline(snappedTo, finalCoords)
        .then((mappedFoot) => {
          if (cancelled || !mappedFoot || mappedFoot.length < 2) return;
          setOsrmWalkAfterCoordsById((prev) => ({
            ...prev,
            [depId]: mappedFoot,
          }));
        })
        .catch(() => {});
    }

    // Risolve la traiettoria stradale reale per autobus e tram via motore di routing stradale multi-stop
    if (departure.mode === 'bus' || departure.mode === 'tram') {
      resolveTransitRoadwayPolyline({
        id: depId,
        line: departure.line,
        mode: departure.mode,
        fromCoords,
        toCoords,
        fromName: departure.fromStop,
        toName: departure.toStop,
        intermediateStops: departure.intermediateStopCoords,
        alerts: departure.alerts,
        existingPolyline: departure.transitPolyline,
      })
        .then((roadPts) => {
          if (cancelled || !roadPts || roadPts.length < 2) return;
          setRoadwayTransitCoordsById((prev) => ({
            ...prev,
            [depId]: roadPts,
          }));
        })
        .catch(() => {});
    }

    // Per viaggi con interscambio (multi-tratta), risolve il tracciato stradale di ogni singola tratta su gomma
    if (departure.legs && departure.legs.length > 1) {
      departure.legs.forEach((leg, idx) => {
        if (leg.mode === 'bus' || leg.mode === 'tram') {
          const lFrom = leg.fromStopCoords || fromCoords;
          const lTo = leg.toStopCoords || toCoords;
          const legKey = depId + '_leg_' + idx;
          resolveTransitRoadwayPolyline({
            id: legKey,
            line: leg.line,
            mode: leg.mode,
            fromCoords: lFrom,
            toCoords: lTo,
            fromName: leg.fromStop,
            toName: leg.toStop,
            alerts: departure.alerts,
            existingPolyline: leg.polyline,
          })
            .then((legPts) => {
              if (cancelled || !legPts || legPts.length < 2) return;
              setRoadwayLegCoordsById((prev) => ({
                ...prev,
                [legKey]: legPts,
              }));
            })
            .catch(() => {});
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [visible, departure, toCoords, finalCoords, fromCoords, originCoords, snappedFrom, snappedTo]);

  const walkBeforeRouteCoords = useMemo<LatLngPoint[]>(() => {
    if (!departure) return [];
    const origPt: LatLngPoint = { latitude: originCoords.lat, longitude: originCoords.lng };
    const distToBus = haversineMeters(origPt, snappedFrom);
    if ((departure.walkBeforeMinutes ?? 0) <= 0 && distToBus <= 25) {
      return [];
    }

    const osrmBefore = osrmWalkBeforeCoordsById[departure.id];
    if (osrmBefore && osrmBefore.length >= 2) {
      return [origPt, ...osrmBefore.slice(1, -1), snappedFrom];
    }
    if (
      departure.walkBeforePolyline &&
      departure.walkBeforePolyline.length >= 2 &&
      haversineMeters(origPt, departure.walkBeforePolyline[0]) < 120 &&
      haversineMeters(snappedFrom, departure.walkBeforePolyline[departure.walkBeforePolyline.length - 1]) < 120
    ) {
      return [origPt, ...departure.walkBeforePolyline.slice(1, -1), snappedFrom];
    }
    if (distToBus > 20) {
      return [origPt, snappedFrom];
    }
    return [];
  }, [departure, originCoords, snappedFrom, osrmWalkBeforeCoordsById]);

  const walkAfterRouteCoords = useMemo<LatLngPoint[]>(() => {
    if (!departure) return [];
    const destPt: LatLngPoint = { latitude: finalCoords.lat, longitude: finalCoords.lng };
    const distFromBus = haversineMeters(snappedTo, destPt);
    if ((departure.walkAfterMinutes ?? 0) <= 0 && distFromBus <= 25) {
      return [];
    }

    let coords: LatLngPoint[] = [];

    const osrmWalkAfter = osrmWalkAfterCoordsById[departure.id];
    if (osrmWalkAfter && osrmWalkAfter.length >= 2) {
      coords = osrmWalkAfter;
    } else if (
      departure.walkAfterPolyline &&
      departure.walkAfterPolyline.length >= 2 &&
      haversineMeters(snappedTo, departure.walkAfterPolyline[0]) < 120 &&
      haversineMeters(destPt, departure.walkAfterPolyline[departure.walkAfterPolyline.length - 1]) < 120
    ) {
      coords = departure.walkAfterPolyline;
    }

    if (coords.length >= 2) {
      // Garantisce continuità matematica assoluta:
      // Il primo punto coincide esattamente con la fermata di discesa (snappedTo),
      // e l'ultimo punto coincide esattamente con la destinazione finale (destPt)
      return [snappedTo, ...coords.slice(1, -1), destPt];
    }

    if (distFromBus > 20) {
      return [snappedTo, destPt];
    }
    return [];
  }, [departure, finalCoords, osrmWalkAfterCoordsById, snappedTo]);

  // Tratti a piedi di interscambio tra un mezzo e l'altro
  const transferWalks = useMemo<LatLngPoint[][]>(() => {
    if (!departure || !isMultiLeg || !multiLegRoutes.length) return [];
    if (departure.transferWalkPolylines && departure.transferWalkPolylines.length > 0) {
      return departure.transferWalkPolylines.map((tw, idx) => {
        if (tw.length >= 2 && multiLegRoutes[idx] && multiLegRoutes[idx + 1]) {
          const res = [...tw];
          const prevPoly = multiLegRoutes[idx].polyline;
          const nextPoly = multiLegRoutes[idx + 1].polyline;
          if (prevPoly.length > 0) res[0] = prevPoly[prevPoly.length - 1];
          if (nextPoly.length > 0) res[res.length - 1] = nextPoly[0];
          return res;
        }
        return tw;
      });
    }
    const walks: LatLngPoint[][] = [];
    for (let i = 0; i < multiLegRoutes.length - 1; i++) {
      const prevPoly = multiLegRoutes[i].polyline;
      const nextPoly = multiLegRoutes[i + 1].polyline;
      const curTo = prevPoly.length > 0 ? prevPoly[prevPoly.length - 1] : null;
      const nextFrom = nextPoly.length > 0 ? nextPoly[0] : null;
      if (curTo && nextFrom) {
        const dist = Math.abs(curTo.latitude - nextFrom.latitude) + Math.abs(curTo.longitude - nextFrom.longitude);
        if (dist > 0.00005) {
          walks.push([curTo, nextFrom]);
        }
      }
    }
    return walks;
  }, [departure, isMultiLeg, multiLegRoutes]);

  const mapRegion = useMemo(() => {
    const allPts: LatLngPoint[] = [
      ...transitRouteCoords,
      ...walkAfterRouteCoords,
      ...walkBeforeRouteCoords,
      { latitude: fromCoords.lat, longitude: fromCoords.lng },
      { latitude: toCoords.lat, longitude: toCoords.lng },
    ];
    if (isMultiLeg) {
      for (const ml of multiLegRoutes) {
        allPts.push(...ml.polyline);
        if (ml.leg.fromStopCoords) {
          allPts.push({ latitude: ml.leg.fromStopCoords.lat, longitude: ml.leg.fromStopCoords.lng });
        }
        if (ml.leg.toStopCoords) {
          allPts.push({ latitude: ml.leg.toStopCoords.lat, longitude: ml.leg.toStopCoords.lng });
        }
      }
      for (const tw of transferWalks) {
        allPts.push(...tw);
      }
    }
    if (walkAfterRouteCoords.length > 0) {
      allPts.push({ latitude: finalCoords.lat, longitude: finalCoords.lng });
    }
    if (allPts.length === 0) {
      return {
        latitude: fromCoords.lat,
        longitude: fromCoords.lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      };
    }
    let minLat = allPts[0].latitude;
    let maxLat = allPts[0].latitude;
    let minLng = allPts[0].longitude;
    let maxLng = allPts[0].longitude;
    for (const p of allPts) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = Math.max(0.0055, (maxLat - minLat) * 1.48);
    const lngDelta = Math.max(0.0055, (maxLng - minLng) * 1.48);
    return {
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [
    transitRouteCoords,
    walkAfterRouteCoords,
    walkBeforeRouteCoords,
    fromCoords,
    toCoords,
    finalCoords,
    isMultiLeg,
    multiLegRoutes,
    transferWalks,
  ]);

  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  // Scaling proporzionale allo zoom per il tracciato a piedi:
  // evita che i pallini risultino spropositati quando la mappa è vista da lontano
  const walkingStrokeProps = useMemo(() => {
    const delta = currentRegion?.latitudeDelta ?? mapRegion.latitudeDelta ?? 0.012;
    const isIos = Platform.OS === 'ios';
    if (delta > 0.02) {
      return {
        strokeWidth: 2.2,
        lineDashPattern: isIos ? [2, 5] : [0.1, 6],
      };
    }
    if (delta > 0.01) {
      return {
        strokeWidth: 2.8,
        lineDashPattern: isIos ? [3, 6] : [0.1, 7],
      };
    }
    if (delta > 0.005) {
      return {
        strokeWidth: 3.4,
        lineDashPattern: isIos ? [3.5, 7] : [0.1, 9],
      };
    }
    return {
      strokeWidth: 4,
      lineDashPattern: isIos ? [4, 8] : [0.1, 11],
    };
  }, [currentRegion?.latitudeDelta, mapRegion.latitudeDelta]);

  if (!departure) return null;

  const isWeb = Platform.OS === 'web';
  const lineColor = getLineBadgeColor(departure.line, departure.mode);
  const modeIcon = getTransitModeIcon(departure.mode, departure.line);
  const isMetro =
    departure.mode === 'metro' || departure.line.toLowerCase().includes('metro');
  const isTram =
    departure.mode === 'tram' || departure.line.toLowerCase().includes('tram');

  const isRail =
    departure.mode === 'rail' ||
    departure.line.toLowerCase().includes('treno') ||
    departure.line.toLowerCase().includes('rv') ||
    departure.line.toLowerCase().includes('reg');

  const transportTypeLabel = isMetro
    ? 'Metropolitana'
    : isTram
      ? 'Linea Tramviaria'
      : isRail
        ? 'Treno Regionale'
        : departure.operator?.toLowerCase().includes('cotral')
          ? 'Pullman Extraurbano'
          : 'Autobus Urbano';

  const isDelayed =
    isLiveContext &&
    (departure.statusType === 'delayed' || departure.delayMinutes > 1);

  const statusText = isDelayed
    ? departure.delayMinutes > 0
      ? `In ritardo (+${departure.delayMinutes} min)`
      : 'In ritardo'
    : 'In orario';

  const statusColor = isDelayed ? '#f59e0b' : '#10b981';
  const statusBg = isDelayed
    ? 'rgba(245, 158, 11, 0.16)'
    : 'rgba(16, 185, 129, 0.16)';
  const statusBorder = isDelayed
    ? 'rgba(245, 158, 11, 0.4)'
    : 'rgba(16, 185, 129, 0.4)';

  // Lo stato live della singola corsa nel modale è attivo solo se il giorno corrente è oggi (isLiveContext)
  // e la specifica corsa rientra nella fascia temporale in corso ed è tracciata in tempo reale
  const isDepartureLiveActive = (() => {
    if (!isLiveContext || !departure) return false;
    const now = new Date();
    const currentNowMins = now.getHours() * 60 + now.getMinutes();
    const rawTimeStr = departure.estimatedTime || departure.scheduledTime;
    const depMins = parseHHMMToMins(rawTimeStr);
    if (depMins < 0) return false;
    let diff = depMins - currentNowMins;
    if (diff < -720) diff += 1440;
    if (diff > 720) diff -= 1440;
    const isInWindow = diff >= -3 && diff <= 50;
    return Boolean(isInWindow && departure.isLive && departure.statusType !== 'scheduled');
  })();

  const displayDepTime = isDepartureLiveActive
    ? departure.estimatedTime || departure.scheduledTime
    : departure.scheduledTime;

  const showScheduledStrike =
    isDelayed &&
    departure.scheduledTime &&
    departure.estimatedTime &&
    departure.scheduledTime !== departure.estimatedTime;

  const stopsCount = departure.intermediateStopsCount || (isMetro ? 3 : 5);

  const isTiburtinaCorridor =
    (departure.fromStop || '').toLowerCase().includes('tiburtina') ||
    (departure.toStop || '').toLowerCase().includes('tiburtina') ||
    (departure.toStop || '').toLowerCase().includes('castro') ||
    (departure.toStop || '').toLowerCase().includes('verano');

  const detourAlert = (departure.alerts || []).find(
    (a) =>
      a.toLowerCase().includes('devia') ||
      a.toLowerCase().includes('cantiere') ||
      a.toLowerCase().includes('lavori') ||
      a.toLowerCase().includes('tramvia') ||
      a.toLowerCase().includes('tranvia') ||
      a.toLowerCase().includes('corsie laterali')
  );

  const isDetourActive =
    Boolean(detourAlert) ||
    (isTiburtinaCorridor &&
      ['71', '163', '448', '492', '545', 'c3'].some((l) =>
        departure.line.toLowerCase().includes(l)
      ));

  const detourNoticeText =
    detourAlert ||
    (departure.line === '71'
      ? 'Linea 71: percorso deviato su corsie laterali di Via Tiburtina e nodo Verano per cantieri della nuova tranvia.'
      : 'Cantiere nuova tranvia Verano-Tiburtina: transito su corsie laterali della viabilità ordinaria anziché sulla sede centrale; fermate attive su banchina laterale.');

  const crowdingConfig = (() => {
    switch (departure.crowdingLevel) {
      case 'high':
        return {
          label: 'Molto affollato • Vettura piena',
          color: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.14)',
          border: 'rgba(239, 68, 68, 0.35)',
          icon: 'people' as const,
        };
      case 'medium':
        return {
          label: 'Mediamente affollato • Posti in piedi',
          color: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.14)',
          border: 'rgba(245, 158, 11, 0.35)',
          icon: 'people' as const,
        };
      case 'low':
      default:
        return {
          label: 'Poco affollato • Posti disponibili',
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.14)',
          border: 'rgba(16, 185, 129, 0.35)',
          icon: 'people-outline' as const,
        };
    }
  })();

  const handleOpenStopNavigation = (
    provider: 'apple' | 'google',
    target: 'from_stop' | 'to_dest' = 'from_stop'
  ) => {
    const coords =
      target === 'to_dest' && (departure.walkAfterMinutes ?? 0) > 0
        ? finalCoords
        : fromCoords;
    const lat = coords.lat;
    const lng = coords.lng;

    if (provider === 'apple' && Platform.OS === 'ios') {
      const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
      Linking.openURL(appleUrl).catch(() => {});
      return;
    }

    const gmapsAppUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=walking`;
    const gmapsWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

    Linking.canOpenURL('comgooglemaps://')
      .then((supported) => {
        if (supported) {
          Linking.openURL(gmapsAppUrl);
        } else {
          Linking.openURL(gmapsWebUrl);
        }
      })
      .catch(() => Linking.openURL(gmapsWebUrl));
  };

  const handlePressRecommendedLine = (lineName: string) => {
    if (!onSelectDeparture) return;
    const match = allDepartures.find(
      (d) => d.line.toLowerCase() === lineName.toLowerCase()
    );
    if (match) {
      onSelectDeparture(match);
    }
  };

  const walkBeforeMins = departure.walkBeforeMinutes ?? 0;
  const inVehicleMins = departure.inVehicleMinutes ?? 0;

  const realWalkAfter = calculateRealWalkMinutes(
    toCoords,
    finalCoords,
    walkAfterRouteCoords
  );

  const walkAfterMins =
    typeof departure.walkAfterMinutes === 'number' &&
    departure.walkAfterMinutes > 0 &&
    Math.abs(departure.walkAfterMinutes - realWalkAfter.minutes) <= 1
      ? departure.walkAfterMinutes
      : realWalkAfter.minutes;

  // Durata totale door-to-door comprensiva di camminata prima di salire, tragitto e camminata finale
  const totalDoorToDoorMinutes = Math.max(
    1,
    walkBeforeMins + inVehicleMins + walkAfterMins
  );

  // Scomposizione esplicita del tempo di viaggio (es. "2m a piedi + 6m tragitto + 5m a piedi")
  const durationFormulaParts: string[] = [];
  if (walkBeforeMins > 0) {
    durationFormulaParts.push(`${walkBeforeMins}m a piedi`);
  }
  durationFormulaParts.push(`${inVehicleMins}m tragitto`);
  if (walkAfterMins > 0) {
    durationFormulaParts.push(`${walkAfterMins}m a piedi`);
  }
  const durationBreakdownFormula = durationFormulaParts.join(' + ');

  const depMinsParsed = parseHHMMToMins(displayDepTime);
  const arrivalTimeDisplay =
    depMinsParsed >= 0
      ? minsToHHMM(depMinsParsed + inVehicleMins + walkAfterMins)
      : departure.arrivalTime || '';

  const alightingTimeDisplay =
    depMinsParsed >= 0 && typeof departure.inVehicleMinutes === 'number'
      ? minsToHHMM(depMinsParsed + departure.inVehicleMinutes)
      : departure.alightingTime || arrivalTimeDisplay;

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title={`Dettaglio ${departure.line.toLowerCase().includes('metro') ? departure.line : `Linea ${departure.line}`}`}
      backgroundColor={UNIFORM_MODAL_BG}
      sheetAllowedDetents={[0.88, 1.0]}
      sheetInitialDetentIndex={0}
    >
      <ScrollView
        style={styles.scrollRoot}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Sezione "Linee consigliate" con colori specifici preservati ── */}
        {directLines.length > 0 && (
          <View style={styles.recommendedSection}>
            <Text style={styles.sectionHeaderLabel}>LINEE CONSIGLIATE</Text>
            <View style={styles.recommendedChipsWrap}>
              {directLines.map((line) => {
                const cColor = getLineBadgeColor(line);
                const cIcon = getTransitModeIcon(undefined, line);
                const isActiveLine =
                  line.toLowerCase() === departure.line.toLowerCase();

                return (
                  <TouchableOpacity
                    key={`modal-rec-line-${line}`}
                    activeOpacity={0.75}
                    onPress={() => handlePressRecommendedLine(line)}
                    style={[
                      styles.recLineChip,
                      {
                        backgroundColor: isActiveLine
                          ? cColor
                          : `${cColor}22`,
                        borderColor: isActiveLine ? '#ffffff' : `${cColor}88`,
                      },
                    ]}
                  >
                    <Ionicons
                      name={cIcon}
                      size={12}
                      color={isActiveLine ? '#ffffff' : cColor}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.recLineChipText,
                        { color: '#ffffff' },
                      ]}
                    >
                      {line}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Intestazione Corsa: Linea, Operatore, Orario e Stato ("In orario" / "In ritardo" solo in Live) ── */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroLineGroup}>
              <View style={[styles.heroLineBadge, { backgroundColor: lineColor }]}>
                <Ionicons
                  name={modeIcon}
                  size={16}
                  color="#ffffff"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.heroLineBadgeText}>{departure.line}</Text>
              </View>
              <View>
                <Text style={styles.heroTransportType}>{transportTypeLabel}</Text>
                <Text style={styles.heroOperatorText}>
                  {departure.operator || (isMetro ? 'ATAC Metro Roma' : 'ATAC Roma')}
                </Text>
              </View>
            </View>

            {/* Badge Stato ("In orario" / "In ritardo"): mostrato solo per corse in tempo reale nella fascia attiva */}
            {isDepartureLiveActive && (
              <View
                style={[
                  styles.heroStatusPill,
                  {
                    backgroundColor: statusBg,
                    borderColor: statusBorder,
                  },
                ]}
              >
                <View
                  style={[
                    styles.heroStatusDot,
                    { backgroundColor: statusColor },
                  ]}
                />
                <Text style={[styles.heroStatusText, { color: statusColor }]}>
                  {statusText}
                </Text>
              </View>
            )}
          </View>

          {/* Banner Soluzione con Cambio */}
          {(!departure.isDirect || (departure.legs && departure.legs.length > 1)) && (
            <View style={styles.heroTransferBanner}>
              <Ionicons
                name="git-branch-outline"
                size={13}
                color="#c084fc"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.heroTransferBannerText}>
                Soluzione con {departure.transfersCount || 1} cambio: {departure.transferSummary || 'Metro + Bus'}
              </Text>
            </View>
          )}

          {/* Fascia Orario di Partenza e Arrivo */}
          <View style={styles.heroTimesGrid}>
            <View style={styles.heroTimeBox}>
              <Text style={styles.heroTimeLabel}>PARTENZA</Text>
              <View style={styles.heroTimeValueRow}>
                <Text
                  style={[
                    styles.heroTimeValue,
                    isDelayed && { color: '#fb923c' },
                  ]}
                >
                  {displayDepTime}
                </Text>
                {showScheduledStrike && (
                  <Text style={styles.heroTimeStrike}>
                    {departure.scheduledTime}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.heroTimeArrowCol}>
              <View style={styles.heroDurationPill}>
                <Ionicons
                  name="time-outline"
                  size={11}
                  color="#94a3b8"
                  style={{ marginRight: 3 }}
                />
                <Text style={styles.heroTimeArrowSub}>
                  {totalDoorToDoorMinutes}m
                </Text>
              </View>
              <Ionicons
                name="arrow-forward"
                size={14}
                color="#64748b"
                style={{ marginTop: 3 }}
              />
            </View>

            <View style={[styles.heroTimeBox, { alignItems: 'flex-end' }]}>
              <Text style={styles.heroTimeLabel}>ARRIVO</Text>
              <Text style={styles.heroTimeValue}>{arrivalTimeDisplay}</Text>
            </View>
          </View>
        </View>

        {/* ── Mappa Interattiva del Percorso (Mezzo a linea continua + Tratto a piedi a pallini) ── */}
        <View style={styles.mapSection}>
          <View style={styles.mapSectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHeaderLabel}>Mappa percorso</Text>
              <Text style={styles.mapStopSubtitle}>
                Scendi a: {departure.toStop}
                {walkAfterMins > 0
                  ? ` • poi ${walkAfterMins} min a piedi`
                  : ''}
              </Text>
            </View>
          </View>

          {/* Banner Deviazione Cantieri / Lavori in corso (espandibile, default 3 righe) */}
          {isDetourActive && (
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => setIsDetourExpanded(!isDetourExpanded)}
              style={styles.detourBannerBox}
            >
              <Ionicons
                name="construct"
                size={14}
                color="#f59e0b"
                style={{ marginRight: 8, marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.detourHeaderRow}>
                  <Text style={styles.detourBannerTitle}>DEVIAZIONE CANTIERE ATTIVA</Text>
                  <Ionicons
                    name={isDetourExpanded ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color="#f59e0b"
                  />
                </View>
                <Text
                  style={styles.detourBannerText}
                  numberOfLines={isDetourExpanded ? undefined : 3}
                >
                  {detourNoticeText}
                </Text>
                <Text style={styles.detourExpandPrompt}>
                  {isDetourExpanded ? 'Mostra meno' : 'Tocca per leggere tutto'}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.mapCard}>
            {!isWeb ? (
              <MapView
                key={`transit-route-map-${departure.id}-${fromCoords.lat.toFixed(4)}-${toCoords.lat.toFixed(4)}`}
                style={styles.mapView}
                initialRegion={mapRegion}
                onRegionChangeComplete={(r) => setCurrentRegion(r)}
                scrollEnabled={true}
                zoomEnabled={true}
                pitchEnabled={false}
                rotateEnabled={false}
                showsUserLocation={true}
                userInterfaceStyle="dark"
              >
                {/* Tratto a piedi iniziale (linea puntinata a cerchi ciano con scaling proporzionale) */}
                {walkBeforeRouteCoords.length >= 2 && (
                  <>
                    <Polyline
                      coordinates={walkBeforeRouteCoords}
                      strokeColor="#06b6d4"
                      strokeWidth={walkingStrokeProps.strokeWidth}
                      lineCap="round"
                      lineJoin="round"
                      lineDashPattern={walkingStrokeProps.lineDashPattern}
                    />
                    <Marker
                      coordinate={walkBeforeRouteCoords[0]}
                      title="Punto di partenza"
                      description={`${walkBeforeMins} min a piedi fino alla fermata ${departure.fromStop}`}
                    >
                      <View style={styles.markerWrapper}>
                        <View
                          style={[
                            styles.markerHalo,
                            { backgroundColor: 'rgba(6, 182, 212, 0.35)' },
                          ]}
                        />
                        <View
                          style={[
                            styles.markerPin,
                            { backgroundColor: '#0891b2' },
                          ]}
                        >
                          <Ionicons name="walk" size={9} color="#ffffff" />
                        </View>
                      </View>
                    </Marker>
                  </>
                )}

                {/* ── Tracciati e Marker: Gestione Unificata Multi-Tratta (con Cambio) o Corsa Diretta ── */}
                {isMultiLeg ? (
                  <>
                    {/* Tratte multiple del viaggio con cambio: ognuna con proprio colore e fermate */}
                    {multiLegRoutes.map((ml, mlIdx) => {
                      const isFirst = mlIdx === 0;
                      const isLast = mlIdx === multiLegRoutes.length - 1;
                      const legPolyline = ml.polyline.length >= 2 ? ml.polyline : [
                        { latitude: (ml.leg.fromStopCoords || fromCoords).lat, longitude: (ml.leg.fromStopCoords || fromCoords).lng },
                        { latitude: (ml.leg.toStopCoords || toCoords).lat, longitude: (ml.leg.toStopCoords || toCoords).lng },
                      ];
                      const legSnapFrom = legPolyline[0] || snapCoordinateToPolyline(ml.leg.fromStopCoords || fromCoords, legPolyline);
                      const legSnapTo = legPolyline[legPolyline.length - 1] || snapCoordinateToPolyline(ml.leg.toStopCoords || toCoords, legPolyline);

                      return (
                        <React.Fragment key={`multi-leg-${mlIdx}`}>
                          {/* Percorso del mezzo per questa tratta */}
                          {legPolyline.length >= 2 && (
                            <>
                              <Polyline
                                coordinates={legPolyline}
                                strokeColor="rgba(15, 23, 42, 0.85)"
                                strokeWidth={7.5}
                                lineCap="round"
                                lineJoin="round"
                              />
                              <Polyline
                                coordinates={legPolyline}
                                strokeColor={ml.color}
                                strokeWidth={4.5}
                                lineCap="round"
                                lineJoin="round"
                              />
                            </>
                          )}

                          {/* Marker di salita della tratta (agganciato matematicamente alla linea) */}
                          <Marker
                            coordinate={{
                              latitude: legSnapFrom.latitude,
                              longitude: legSnapFrom.longitude,
                            }}
                            title={isFirst ? `Salita: ${ml.leg.fromStop}` : `Cambio: prendi ${ml.leg.line} a ${ml.leg.fromStop}`}
                            description={
                              isFirst
                                ? `Linea ${ml.leg.line} (${displayDepTime}) • Dir. ${ml.leg.headsign || departure.headsign}`
                                : `Direzione ${ml.leg.headsign || 'corsa'}`
                            }
                          >
                            <View style={styles.markerWrapper}>
                              <View
                                style={[
                                  styles.markerHalo,
                                  { backgroundColor: `${ml.color}44` },
                                ]}
                              />
                              <View
                                style={[
                                  styles.markerPin,
                                  { backgroundColor: ml.color },
                                ]}
                              >
                                <Ionicons
                                  name={ml.leg.mode === 'metro' ? 'subway' : isFirst ? 'bus' : 'swap-horizontal'}
                                  size={9}
                                  color="#ffffff"
                                />
                              </View>
                            </View>
                          </Marker>

                          {/* Se non è l'ultima tratta, marker di discesa per cambio (con colore della nuova tratta) */}
                          {!isLast && (() => {
                            const nextLegColor = multiLegRoutes[mlIdx + 1]?.color || '#a855f7';
                            return (
                              <Marker
                                coordinate={{
                                  latitude: legSnapTo.latitude,
                                  longitude: legSnapTo.longitude,
                                }}
                                title={`Discesa per cambio: ${ml.leg.toStop}`}
                                description={`Scendi da ${ml.leg.line} per prendere ${multiLegRoutes[mlIdx + 1]?.leg.line || 'mezzo successivo'}`}
                              >
                                <View style={styles.markerWrapper}>
                                  <View
                                    style={[
                                      styles.markerHalo,
                                      { backgroundColor: `${nextLegColor}35` },
                                    ]}
                                  />
                                  <View
                                    style={[
                                      styles.markerPin,
                                      { backgroundColor: nextLegColor },
                                    ]}
                                  >
                                    <Ionicons name="git-branch" size={9} color="#ffffff" />
                                  </View>
                                </View>
                              </Marker>
                            );
                          })()}

                          {/* Se è l'ultima tratta, bandierina viola di discesa (drasticamente ridotta e agganciata) */}
                          {isLast && (
                            <Marker
                              coordinate={{
                                latitude: legSnapTo.latitude,
                                longitude: legSnapTo.longitude,
                              }}
                              title={`Fermata di discesa finale: ${ml.leg.toStop}`}
                              description={`Arrivo mezzo ore ${alightingTimeDisplay}`}
                            >
                              <View style={styles.discesaFlagWrapper}>
                                <View style={styles.discesaFlagHalo} />
                                <View style={styles.discesaFlagPin}>
                                  <Ionicons name="flag" size={8.5} color="#ffffff" />
                                </View>
                              </View>
                            </Marker>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Tratti a piedi di interscambio tra le tratte (ambra dorato scalato) */}
                    {transferWalks.map((twCoords, twIdx) => {
                      if (twCoords.length < 2) return null;
                      return (
                        <Polyline
                          key={`transfer-walk-${twIdx}`}
                          coordinates={twCoords}
                          strokeColor="#f59e0b"
                          strokeWidth={walkingStrokeProps.strokeWidth}
                          lineCap="round"
                          lineJoin="round"
                          lineDashPattern={walkingStrokeProps.lineDashPattern}
                        />
                      );
                    })}
                  </>
                ) : (
                  <>
                    {/* Corsa Diretta: Bordo stradale di contrasto + Percorso del mezzo */}
                    {transitRouteCoords.length >= 2 && (
                      <>
                        <Polyline
                          coordinates={transitRouteCoords}
                          strokeColor="rgba(15, 23, 42, 0.85)"
                          strokeWidth={7.5}
                          lineCap="round"
                          lineJoin="round"
                        />
                        <Polyline
                          coordinates={transitRouteCoords}
                          strokeColor={lineColor}
                          strokeWidth={4.5}
                          lineCap="round"
                          lineJoin="round"
                        />
                      </>
                    )}

                    {/* Fermate intermedie lungo la linea (pallini ridotti a 5x5 e agganciati alla linea) */}
                    {departure.intermediateStopCoords?.map((stop, idx) => {
                      const snapped = snapCoordinateToPolyline(
                        { latitude: stop.lat, longitude: stop.lng },
                        transitRouteCoords
                      );
                      return (
                        <Marker
                          key={`map-int-stop-${idx}`}
                          coordinate={{
                            latitude: snapped.latitude,
                            longitude: snapped.longitude,
                          }}
                          title={stop.name}
                          description={`Fermata intermedia (${departure.line})`}
                          anchor={{ x: 0.5, y: 0.5 }}
                        >
                          <View
                            style={[
                              styles.intermediateMapDot,
                              { borderColor: lineColor },
                            ]}
                          />
                        </Marker>
                      );
                    })}

                    {/* Marker Fermata di Salita (agganciato alla linea) */}
                    <Marker
                      coordinate={{
                        latitude: snappedFrom.latitude,
                        longitude: snappedFrom.longitude,
                      }}
                      title={`Salita: ${departure.fromStop}`}
                      description={`Linea ${departure.line} (${displayDepTime}) • Dir. ${departure.headsign}`}
                    >
                      <View style={styles.markerWrapper}>
                        <View
                          style={[
                            styles.markerHalo,
                            { backgroundColor: `${lineColor}44` },
                          ]}
                        />
                        <View
                          style={[
                            styles.markerPin,
                            { backgroundColor: lineColor },
                          ]}
                        >
                          <Ionicons
                            name={isMetro ? 'subway' : 'bus'}
                            size={9}
                            color="#ffffff"
                          />
                        </View>
                      </View>
                    </Marker>

                    {/* Marker Fermata di Discesa (bandierina viola drasticamente ridotta e agganciata alla linea) */}
                    <Marker
                      coordinate={{
                        latitude: snappedTo.latitude,
                        longitude: snappedTo.longitude,
                      }}
                      title={`Dove scendi: ${departure.toStop}`}
                      description={`Arrivo mezzo ore ${alightingTimeDisplay}`}
                    >
                      <View style={styles.discesaFlagWrapper}>
                        <View style={styles.discesaFlagHalo} />
                        <View style={styles.discesaFlagPin}>
                          <Ionicons name="flag" size={8.5} color="#ffffff" />
                        </View>
                      </View>
                    </Marker>
                  </>
                )}

                {/* Tratto a piedi dalla fermata di discesa alla destinazione finale (blu indaco scalato) */}
                {walkAfterRouteCoords.length >= 2 && (
                  <Polyline
                    coordinates={walkAfterRouteCoords}
                    strokeColor="#3b82f6"
                    strokeWidth={walkingStrokeProps.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    lineDashPattern={walkingStrokeProps.lineDashPattern}
                  />
                )}

                {/* Marker Destinazione Finale (Aula / Stazione) raggiunta a piedi */}
                {walkAfterRouteCoords.length >= 2 && (
                  <Marker
                    coordinate={{
                      latitude: finalCoords.lat,
                      longitude: finalCoords.lng,
                    }}
                    title={departure.finalDestinationName || 'Destinazione'}
                    description={`${walkAfterMins} min a piedi da ${departure.toStop} (arrivo ${arrivalTimeDisplay})`}
                  >
                    <View style={styles.markerWrapper}>
                      <View
                        style={[
                          styles.markerHalo,
                          { backgroundColor: 'rgba(59, 130, 246, 0.35)' },
                        ]}
                      />
                      <View
                        style={[
                          styles.markerPin,
                          { backgroundColor: '#2563eb' },
                        ]}
                      >
                        <Ionicons name="walk" size={9} color="#ffffff" />
                      </View>
                    </View>
                  </Marker>
                )}
              </MapView>
            ) : (
              <View style={styles.mapWebFallback}>
                <Ionicons name="map-outline" size={34} color="#94a3b8" />
                <Text style={styles.mapWebFallbackText}>
                  {departure.fromStop} → {departure.toStop}
                </Text>
              </View>
            )}

            {/* Pillola Flottante Percorso */}
            <View style={styles.mapTopBadge}>
              <Ionicons
                name={isMetro ? 'subway' : isMultiLeg ? 'git-branch' : 'bus'}
                size={12}
                color="#ffffff"
                style={{ marginRight: 5 }}
              />
              <Text style={styles.mapTopBadgeText}>
                {isMultiLeg
                  ? `Viaggio con ${departure.transfersCount || 1} cambio`
                  : `Linea ${departure.line} • ${stopsCount} fermate`}
              </Text>
            </View>
          </View>

          {/* Legenda Mappa: Tratto a piedi salita + Percorso mezzi (multi o singolo) + Tratto a piedi discesa */}
          <View style={styles.mapLegendRow}>
            {walkBeforeMins > 0 && (
              <View style={styles.mapLegendItem}>
                <View style={styles.legendDotsRow}>
                  <View style={[styles.legendDot, { backgroundColor: '#06b6d4' }]} />
                  <View style={[styles.legendDot, { backgroundColor: '#06b6d4' }]} />
                  <View style={[styles.legendDot, { backgroundColor: '#06b6d4' }]} />
                </View>
                <Text style={styles.mapLegendText}>
                  A piedi alla salita ({walkBeforeMins} min)
                </Text>
              </View>
            )}

            {isMultiLeg ? (
              multiLegRoutes.map((ml, mlIdx) => (
                <React.Fragment key={`legend-leg-${mlIdx}`}>
                  <View style={styles.mapLegendItem}>
                    <View
                      style={[styles.legendSolidBar, { backgroundColor: ml.color }]}
                    />
                    <Text style={styles.mapLegendText}>
                      Tratta {ml.leg.line} ({ml.leg.durationMinutes} min)
                    </Text>
                  </View>
                  {mlIdx < multiLegRoutes.length - 1 && (
                    <View style={styles.mapLegendItem}>
                      <View style={styles.legendDotsRow}>
                        <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                        <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                        <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                      </View>
                      <Text style={styles.mapLegendText}>
                        A piedi al cambio
                      </Text>
                    </View>
                  )}
                </React.Fragment>
              ))
            ) : (
              <View style={styles.mapLegendItem}>
                <View
                  style={[styles.legendSolidBar, { backgroundColor: lineColor }]}
                />
                <Text style={styles.mapLegendText}>
                  Tragitto {departure.line} ({inVehicleMins} min)
                </Text>
              </View>
            )}

            {walkAfterMins > 0 && (
              <View style={styles.mapLegendItem}>
                <View style={styles.legendDotsRow}>
                  <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
                  <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
                  <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
                </View>
                <Text style={styles.mapLegendText}>
                  A piedi a destinazione ({walkAfterMins} min)
                </Text>
              </View>
            )}
          </View>

          {/* Pulsanti Rapidi per Raggiungere la Fermata a Piedi */}
          <View style={styles.navButtonsRow}>
            <TouchableOpacity
              style={[
                styles.navBtn,
                { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
              activeOpacity={0.8}
              onPress={() => handleOpenStopNavigation('apple', 'from_stop')}
            >
              <Ionicons
                name="walk"
                size={16}
                color="#ffffff"
                style={{ marginRight: 6 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.navBtnTitle}>Apple Mappe</Text>
                <Text style={styles.navBtnSub}>Vai alla fermata di salita</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.navBtn, styles.navBtnGoogle]}
              activeOpacity={0.8}
              onPress={() => handleOpenStopNavigation('google', 'from_stop')}
            >
              <Ionicons
                name="navigate-circle-outline"
                size={17}
                color="#38bdf8"
                style={{ marginRight: 6 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.navBtnTitle}>Google Maps</Text>
                <Text style={styles.navBtnSub}>Vai alla fermata di salita</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Dettagli della corsa (Blocco Unificato) ── */}
        <View style={styles.detailsSectionCard}>
          <Text style={styles.sectionHeaderLabel}>
            Dettagli della corsa
          </Text>

          {/* Durata Totale e Numero di Fermate in cima al blocco */}
          <View style={[styles.metricsRow, { marginBottom: 12 }]}>
            {/* Durata Totale */}
            <View style={styles.metricBox}>
              <View style={styles.metricTopRow}>
                <Ionicons name="time-outline" size={15} color="#38bdf8" />
                <Text style={styles.metricBoxTitle}>DURATA TOTALE</Text>
              </View>
              <Text style={styles.metricMainValue}>
                {totalDoorToDoorMinutes} min
              </Text>
              <Text style={styles.metricSubValue}>
                {durationBreakdownFormula}
              </Text>
            </View>

            {/* Numero di Fermate */}
            <View style={styles.metricBox}>
              <View style={styles.metricTopRow}>
                <Ionicons name="git-commit-outline" size={15} color="#a855f7" />
                <Text style={styles.metricBoxTitle}>FERMATE</Text>
              </View>
              <Text style={styles.metricMainValue}>{stopsCount} fermate</Text>
              <Text style={styles.metricSubValue}>
                {departure.isDirect
                  ? 'Tragitto diretto senza cambi'
                  : `${departure.transfersCount} cambio/i lungo il percorso`}
              </Text>
            </View>
          </View>

          {/* Campo Direzione */}
          <View style={styles.detailItemBlock}>
            <View style={styles.detailIconCircle}>
              <Ionicons name="compass-outline" size={16} color="#60a5fa" />
            </View>
            <View style={styles.detailTextCol}>
              <Text style={styles.detailFieldLabel}>DIREZIONE</Text>
              <Text style={styles.detailFieldValue}>{departure.headsign}</Text>
            </View>
          </View>

          <View style={styles.detailDivider} />

          {/* Campo Fermata di Partenza (prima di Tappe del viaggio) */}
          <View style={styles.detailItemBlock}>
            <View
              style={[
                styles.detailIconCircle,
                { backgroundColor: 'rgba(16, 185, 129, 0.14)' },
              ]}
            >
              <Ionicons name="location-outline" size={16} color="#10b981" />
            </View>
            <View style={styles.detailTextCol}>
              <Text style={styles.detailFieldLabel}>
                FERMATA DI PARTENZA (SALITA • ORE {displayDepTime})
              </Text>
              <Text style={styles.detailFieldValue}>{departure.fromStop}</Text>
              {(departure.walkBeforeMinutes ?? 0) > 0 && (
                <Text style={{ fontSize: 11.5, color: '#38bdf8', marginTop: 2, fontWeight: '500' }}>
                  {departure.walkBeforeMinutes} min a piedi per raggiungere la fermata
                </Text>
              )}
            </View>
          </View>

          <View style={styles.detailDivider} />

          {/* Campo Fermata di Discesa (prima di Tappe del viaggio) */}
          <View style={styles.detailItemBlock}>
            <View
              style={[
                styles.detailIconCircle,
                { backgroundColor: 'rgba(168, 85, 247, 0.16)' },
              ]}
            >
              <Ionicons name="flag" size={15} color="#c084fc" />
            </View>
            <View style={styles.detailTextCol}>
              <Text style={[styles.detailFieldLabel, { color: '#c084fc' }]}>
                FERMATA DI DISCESA (DISCESA • ORE {alightingTimeDisplay})
              </Text>
              <Text style={styles.detailFieldValue}>{departure.toStop}</Text>
            </View>
          </View>

          {/* Timeline Unificata e Graficamente Completa della Corsa */}
          <View style={[styles.stopsTimelineBox, { marginTop: 10, marginBottom: 8 }]}>
            <Text style={styles.stopsTimelineTitle}>
              {departure.legs && departure.legs.length > 1
                ? `ITINERARIO CON ${departure.transfersCount || 1} CAMBIO`
                : `TAPPE DEL VIAGGIO (${departure.intermediateStopNames ? departure.intermediateStopNames.length + 1 : 1} FERMATE)`}
            </Text>
            <View style={styles.stopsList}>
              {/* 1. Camminata a piedi prima di salire sul mezzo (se presente) */}
              {(departure.walkBeforeMinutes ?? 0) > 0 && (
                <View style={styles.stopTimelineItem}>
                  <View style={styles.stopIconWrap}>
                    <Ionicons name="walk" size={15} color="#38bdf8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#38bdf8' }]}>
                      {departure.walkBeforeMinutes} min a piedi fino alla fermata
                    </Text>
                    <Text style={styles.stopTimelineSubText}>
                      Raggiungi la fermata di salita: {departure.fromStop}
                    </Text>
                  </View>
                </View>
              )}

              {/* 2. Soluzione con Cambio vs Corsa Diretta */}
              {departure.legs && departure.legs.length > 1 ? (
                departure.legs.map((leg, lIdx) => {
                  const isFirstLeg = lIdx === 0;
                  const isLastLeg = lIdx === departure.legs!.length - 1;
                  const lColor = getLineBadgeColor(leg.line, leg.mode);
                  const lIcon = getTransitModeIcon(leg.mode, leg.line);
                  const nextLeg = !isLastLeg ? departure.legs![lIdx + 1] : null;
                  const nextLegColor = nextLeg ? getLineBadgeColor(nextLeg.line, nextLeg.mode) : '#c084fc';

                  return (
                    <View key={`unified-leg-${lIdx}`} style={styles.unifiedLegBlock}>
                      {/* Intestazione della singola tratta */}
                      <View style={styles.unifiedLegHeader}>
                        <View style={[styles.unifiedLegBadge, { backgroundColor: lColor }]}>
                          <Ionicons name={lIcon} size={11} color="#ffffff" style={{ marginRight: 4 }} />
                          <Text style={styles.unifiedLegBadgeText}>{leg.line}</Text>
                        </View>
                        <Text style={styles.unifiedLegHeaderText}>
                          Tratta {lIdx + 1} • {leg.durationMinutes} min ({leg.mode === 'metro' ? 'Metro' : 'Bus'})
                        </Text>
                      </View>

                      {/* Salita Tratta: verde per la prima salita, lColor per le successive */}
                      <View style={styles.stopTimelineItem}>
                        <View
                          style={[
                            styles.stopDot,
                            {
                              backgroundColor: isFirstLeg ? '#10b981' : lColor,
                              borderColor: isFirstLeg ? 'rgba(16, 185, 129, 0.4)' : `${lColor}55`,
                              borderWidth: 2,
                            },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#ffffff' }]}>
                            {leg.fromStop}
                          </Text>
                          <Text style={styles.stopTimelineSubText}>
                            Salita{leg.departureTime ? ` • Ore ${leg.departureTime}` : ''}
                            {leg.headsign ? ` • Dir. ${leg.headsign}` : ''}
                          </Text>
                        </View>
                      </View>

                      {/* Fermate intermedie di questa tratta */}
                      {leg.intermediateStopNames && leg.intermediateStopNames.map((sName, sIdx) => (
                        <View key={`leg-${lIdx}-stop-${sIdx}`} style={styles.stopTimelineItem}>
                          <View style={styles.stopDotIntermediate} />
                          <Text style={styles.stopTimelineText}>{sName}</Text>
                        </View>
                      ))}

                      {/* Discesa Tratta / Interscambio: pallino del colore della NUOVA tratta se c'è cambio, altrimenti viola */}
                      <View style={styles.stopTimelineItem}>
                        <View
                          style={[
                            styles.stopDot,
                            {
                              backgroundColor: isLastLeg ? '#c084fc' : nextLegColor,
                              borderColor: isLastLeg ? 'rgba(192, 132, 252, 0.4)' : `${nextLegColor}55`,
                              borderWidth: 2,
                            },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#ffffff' }]}>
                            {leg.toStop}
                          </Text>
                          <Text style={styles.stopTimelineSubText}>
                            {isLastLeg
                              ? `Fermata di discesa (dove scendi) • Ore ${alightingTimeDisplay}`
                              : `Fermata di scambio${leg.arrivalTime ? ` • Arrivo ore ${leg.arrivalTime}` : ''}`}
                          </Text>
                        </View>
                      </View>

                      {/* Box di cambio tra tratte consecutive (con il colore della NUOVA tratta) */}
                      {!isLastLeg && nextLeg && (
                        <View
                          style={[
                            styles.interchangeNoticeBox,
                            {
                              borderColor: `${nextLegColor}44`,
                              backgroundColor: `${nextLegColor}14`,
                            },
                          ]}
                        >
                          <Ionicons name="git-branch-outline" size={13} color={nextLegColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.interchangeNoticeText, { color: nextLegColor }]}>
                            Cambio a {leg.toStop} → prendi {nextLeg.line} ({nextLeg.mode === 'metro' ? 'Metro' : 'Bus'})
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })
              ) : (
                /* Corsa Diretta */
                <>
                  {/* Salita (Fermata di Partenza) - PALLINO VERDE */}
                  <View style={styles.stopTimelineItem}>
                    <View
                      style={[
                        styles.stopDot,
                        {
                          backgroundColor: '#10b981',
                          borderColor: 'rgba(16, 185, 129, 0.4)',
                          borderWidth: 2,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#ffffff' }]}>
                        {departure.fromStop} (Salita • Ore {displayDepTime})
                      </Text>
                      {departure.headsign ? (
                        <Text style={styles.stopTimelineSubText}>Direzione {departure.headsign}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Fermate Intermedie - PALLINI GRIGI */}
                  {departure.intermediateStopNames && departure.intermediateStopNames.map((sName, idx) => (
                    <View key={`int-stop-${idx}`} style={styles.stopTimelineItem}>
                      <View style={styles.stopDotIntermediate} />
                      <Text style={styles.stopTimelineText}>{sName}</Text>
                    </View>
                  ))}

                  {/* Discesa (Fermata dove scendi) - PALLINO VIOLA */}
                  <View style={styles.stopTimelineItem}>
                    <View
                      style={[
                        styles.stopDot,
                        {
                          backgroundColor: '#c084fc',
                          borderColor: 'rgba(192, 132, 252, 0.4)',
                          borderWidth: 2,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#ffffff' }]}>
                        {departure.toStop} (Dove scendi • Ore {alightingTimeDisplay})
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* 3. Conclusione a piedi dopo la discesa (+min a piedi a destinazione) */}
              {walkAfterMins > 0 && (
                <View style={styles.stopTimelineItem}>
                  <View style={styles.stopIconWrap}>
                    <Ionicons name="walk" size={15} color="#38bdf8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stopTimelineText, { fontWeight: '700', color: '#7dd3fc' }]}>
                      +{walkAfterMins} min a piedi → {departure.finalDestinationName || 'Destinazione'}
                    </Text>
                    <Text style={styles.stopTimelineSubText}>
                      Arrivo a destinazione alle ore {arrivalTimeDisplay}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Quanto è pieno (Affollamento) */}
          <View
            style={[
              styles.crowdingBanner,
              {
                backgroundColor: crowdingConfig.bg,
                borderColor: crowdingConfig.border,
                marginTop: 12,
              },
            ]}
          >
            <Ionicons
              name={crowdingConfig.icon}
              size={18}
              color={crowdingConfig.color}
              style={{ marginRight: 10 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.crowdingLabel}>STATO AFFOLLAMENTO MEZZO</Text>
              <Text
                style={[styles.crowdingValue, { color: crowdingConfig.color }]}
              >
                {crowdingConfig.label}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Eventuali Deviazioni / Avvisi sulla Linea (Accorciati di default ed espandibili al tocco) ── */}
        <View style={styles.alertsCard}>
          <Text style={styles.sectionHeaderLabel}>
            EVENTUALI DEVIAZIONI O AVVISI SULLA LINEA
          </Text>
          {departure.alerts && departure.alerts.length > 0 ? (
            departure.alerts.map((alertText, idx) => {
              const alertKey = `${departure.id}_${idx}`;
              const isAlertExpanded = Boolean(expandedAlerts[alertKey]);
              const isExpandable = alertText.length > 90;

              return (
                <TouchableOpacity
                  key={`modal-alert-${idx}`}
                  activeOpacity={0.8}
                  onPress={() =>
                    setExpandedAlerts((prev) => ({
                      ...prev,
                      [alertKey]: !prev[alertKey],
                    }))
                  }
                  style={styles.alertActiveBox}
                >
                  <Ionicons
                    name="warning"
                    size={16}
                    color="#f59e0b"
                    style={{ marginRight: 8, marginTop: 1 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={styles.alertActiveText}
                      numberOfLines={isAlertExpanded ? undefined : 2}
                      ellipsizeMode="tail"
                    >
                      {alertText}
                    </Text>
                    {isExpandable && (
                      <View style={styles.alertExpandRow}>
                        <Text style={styles.alertExpandText}>
                          {isAlertExpanded ? 'Mostra meno' : 'Mostra tutto'}
                        </Text>
                        <Ionicons
                          name={isAlertExpanded ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color="#fbbf24"
                          style={{ marginLeft: 3 }}
                        />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.alertNoneBox}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color="#10b981"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.alertNoneText}>
                Percorso regolare • Nessuna deviazione o modifica di percorso segnalata per la linea {departure.line}.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </NativeSheetModal>
  );
};

const styles = StyleSheet.create({
  scrollRoot: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 115,
    gap: 14,
  },
  sectionHeaderLabel: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  recommendedSection: {
    backgroundColor: '#161922',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  recommendedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recLineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  recLineChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: '#161922',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  heroLineGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroLineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  heroLineBadgeText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  heroTransportType: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  heroOperatorText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  heroTransferBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    marginTop: 4,
    marginBottom: 8,
  },
  heroTransferBannerText: {
    color: '#c084fc',
    fontSize: 11.5,
    fontWeight: '700',
  },
  heroStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  heroStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  heroStatusText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  heroTimesGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0e1017',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e2330',
  },
  heroTimeBox: {
    flex: 1,
  },
  heroTimeLabel: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  heroTimeValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  heroTimeValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  heroTimeStrike: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  heroTimeArrowCol: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  heroDurationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroTimeArrowSub: {
    color: '#cbd5e1',
    fontSize: 10.5,
    fontWeight: '600',
  },
  mapSection: {
    backgroundColor: '#161922',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  mapSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mapStopSubtitle: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  mapCard: {
    height: 215,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0e1017',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    position: 'relative',
    marginBottom: 10,
  },
  mapView: {
    ...StyleSheet.absoluteFill,
  },
  mapWebFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapWebFallbackText: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  intermediateMapDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
  },
  mapLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  mapLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSolidBar: {
    width: 18,
    height: 4,
    borderRadius: 2,
  },
  legendDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1d4ed8',
  },
  mapLegendText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  discesaFlagWrapper: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discesaFlagHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
  },
  discesaFlagPin: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8b5cf6',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  markerWrapper: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHalo: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  markerPin: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  mapTopBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  mapTopBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  navButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  navBtnGoogle: {
    backgroundColor: '#1e2433',
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  navBtnTitle: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  navBtnSub: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  detailsSectionCard: {
    backgroundColor: '#161922',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  detailItemBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  detailIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  detailTextCol: {
    flex: 1,
  },
  detailFieldLabel: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailFieldValue: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
  },
  detailDivider: {
    height: 1,
    backgroundColor: '#222736',
    marginVertical: 6,
  },
  metricsCard: {
    backgroundColor: '#161922',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#0e1017',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: '#1e2330',
  },
  metricTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  metricBoxTitle: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  metricMainValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  metricSubValue: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 3,
    lineHeight: 14,
  },
  stopsTimelineBox: {
    backgroundColor: '#0e1017',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e2330',
    marginBottom: 12,
  },
  stopsTimelineTitle: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stopsList: {
    gap: 6,
  },
  stopTimelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stopDotIntermediate: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#64748b',
    marginLeft: 2,
    marginRight: 2,
  },
  stopTimelineText: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 17,
  },
  stopTimelineSubText: {
    color: '#64748b',
    fontSize: 10.5,
    marginTop: 1,
  },
  stopIconWrap: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedLegBlock: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    padding: 10,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    gap: 6,
  },
  unifiedLegHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  unifiedLegBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  unifiedLegBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  unifiedLegHeaderText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  interchangeNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.28)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    marginTop: 4,
    marginBottom: 2,
    marginLeft: 12,
  },
  interchangeNoticeText: {
    color: '#d8b4fe',
    fontSize: 11,
    fontWeight: '700',
  },
  crowdingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  crowdingLabel: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  crowdingValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  alertsCard: {
    backgroundColor: '#161922',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262b38',
  },
  alertActiveBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    marginTop: 4,
  },
  alertActiveText: {
    color: '#fde68a',
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 18,
  },
  alertExpandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  alertExpandText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
  },
  alertNoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  alertNoneText: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
  detourBannerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  detourHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  detourBannerTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#f59e0b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  detourBannerText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#fde68a',
    fontWeight: '500',
  },
  detourExpandPrompt: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#f59e0b',
    marginTop: 4,
  },
  heroBreakdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
    justifyContent: 'center',
  },
  heroBreakdownText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  legendTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 12,
  },
  legendTotalText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  legendTotalValue: {
    color: '#f8fafc',
    fontWeight: '700',
  },
});
