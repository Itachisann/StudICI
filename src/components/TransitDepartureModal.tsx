import { AppTheme, CARD_RADIUS } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import { MenuAction, MenuView } from "@expo/ui/community/menu";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import {
  calculateRealWalkMinutes,
  ensureContinuousTransitPolyline,
  getLineBadgeColor,
  getTransitModeIcon,
  haversineMeters,
  LatLngPoint,
  minsToHHMM,
  parseHHMMToMins,
  resolveOptimizedTransitPolyline,
  snapCoordinateToPolyline,
  TransitDepartureItem,
} from "../utils/transitBoardService";
import {
  getTransitRoadwayPolylineSync,
  resolvePedestrianRoadwayPolyline,
  resolveTransitRoadwayPolyline,
} from "../utils/transitRoadwayRouter";
import { NativeSheetModal, UNIFORM_MODAL_BG } from "./NativeSheetModal";

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeMenuAvailable = !isExpoGo && Platform.OS !== "web";
const isNativeIosGlass = Platform.OS === "ios" && !isExpoGo;

let CallstackLiquidGlass: any = null;
if (isNativeIosGlass) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CallstackLiquidGlass = require("@callstack/liquid-glass");
  } catch {
    CallstackLiquidGlass = null;
  }
}

// Sistema cromatico adattivo ad alto contrasto:
// - Tratti pedonali standard in blu intenso (#3b82f6, o ice-blue #93c5fd se una tratta bus/metro è già blu)
// - Tratti pedonali di cambio tra due mezzi in colore distinto ad alto contrasto (es. ambra/teal/fucsia)
// - Attesa in fermata senza spostamento a piedi in grigio-ardesia neutro
// - Arrivo finale a destinazione in smeraldo dedicato (#10b981 / #34d399, o coral se l'ultima tratta è verde)
const WALK_BLUE_PRIMARY = "#3b82f6";
const WALK_BLUE_TEXT_PRIMARY = "#60a5fa";
const WALK_BLUE_ALT = "#93c5fd";
const WALK_BLUE_TEXT_ALT = "#bfdbfe";

const TRANSFER_WALK_CANDIDATES: {
  stroke: string;
  text: string;
  icon: string;
}[] = [
  { stroke: "#f59e0b", text: "#fbbf24", icon: "#0f172a" },
  { stroke: "#14b8a6", text: "#2dd4bf", icon: "#0f172a" },
  { stroke: "#e879f9", text: "#f0abfc", icon: "#0f172a" },
  { stroke: "#84cc16", text: "#a3e635", icon: "#0f172a" },
  { stroke: "#fb7185", text: "#fda4af", icon: "#0f172a" },
];

const WAIT_RAIL_COLOR = "#64748b";
const WAIT_NODE_BG = "#334155";
const WAIT_NODE_BORDER = "#94a3b8";
const WAIT_TEXT_COLOR = "#cbd5e1";

const ARRIVAL_GREEN_BG = "#10b981";
const ARRIVAL_GREEN_TEXT = "#34d399";
const ARRIVAL_ALT_BG = "#f43f5e";
const ARRIVAL_ALT_TEXT = "#fb7185";

const LEG_CONTRAST_CANDIDATES = [
  "#e11d48",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#10b981",
  "#ea580c",
];

function clockDiffMins(startMins: number, endMins: number): number {
  if (startMins < 0 || endMins < 0) return 0;
  let diff = endMins - startMins;
  if (diff < -720) diff += 1440;
  return Math.max(0, diff);
}

function normalizeStopKey(name?: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function computePolylineLengthMeters(pts?: LatLngPoint[]): number {
  if (!pts || pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += haversineMeters(pts[i - 1], pts[i]);
  }
  return total;
}

function getCrowdingConfig(
  level: "low" | "medium" | "high" | undefined,
) {
  switch (level) {
    case "high":
      return {
        label: "Molto affollato • Vettura piena",
        shortLabel: "Molto affollato",
        color: "#ef4444",
        bg: "rgba(239, 68, 68, 0.14)",
        border: "rgba(239, 68, 68, 0.35)",
        icon: "people" as const,
      };
    case "medium":
      return {
        label: "Mediamente affollato • Posti in piedi",
        shortLabel: "Mediamente affollato",
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.14)",
        border: "rgba(245, 158, 11, 0.35)",
        icon: "people" as const,
      };
    case "low":
    default:
      return {
        label: "Poco affollato • Posti disponibili",
        shortLabel: "Poco affollato",
        color: "#10b981",
        bg: "rgba(16, 185, 129, 0.14)",
        border: "rgba(16, 185, 129, 0.35)",
        icon: "people-outline" as const,
      };
  }
}

function computeLegCrowdingLevel(
  mode: "bus" | "metro" | "tram" | "rail",
  depTimeStr?: string,
  fallbackLevel?: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  const hour = parseInt((depTimeStr || "").split(":")[0], 10);
  if (isNaN(hour)) return fallbackLevel || "low";
  const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  if (!isPeakHour) return "low";
  return mode === "metro" ? "high" : "medium";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = (hex || "").replace("#", "").trim();
  if (clean.length !== 6) return null;
  const num = parseInt(clean, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 999;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function renderWalkSolidBar(minutes: number, key: string, color: string) {
  const safeMinutes = Math.max(1, minutes);
  return (
    <View
      key={key}
      style={{
        flexGrow: safeMinutes,
        flexShrink: 1,
        flexBasis: 0,
        height: "100%",
        borderRadius: 2.25,
        backgroundColor: color,
      }}
    />
  );
}

function renderVerticalDashedRail(color: string, count: number = 3) {
  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: 3.5,
      }}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <View
          key={idx}
          style={{
            width: 2,
            height: 4.5,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

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

export const TransitDepartureModal: React.FC<TransitDepartureModalProps> = (
  props,
) => {
  if (!props.visible || !props.departure) return null;
  return (
    <TransitDepartureModalContent {...props} departure={props.departure} />
  );
};

interface TransitDepartureModalContentProps
  extends Omit<TransitDepartureModalProps, "departure"> {
  departure: TransitDepartureItem;
}

const TransitDepartureModalContent: React.FC<
  TransitDepartureModalContentProps
> = ({
  visible,
  departure,
  allDepartures,
  directLines,
  isLiveContext,
  theme,
  onClose,
  onSelectDeparture,
}) => {
  const [expandedDevByDepId, setExpandedDevByDepId] = useState<
    Record<string, boolean>
  >({});
  // Traccia pedonale calcolata con OSRM foot per il percorso dalla discesa alla destinazione
  const [osrmWalkAfterCoordsById, setOsrmWalkAfterCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});
  // Traccia pedonale calcolata con OSRM foot per il percorso dall'origine alla salita del mezzo
  const [osrmWalkBeforeCoordsById, setOsrmWalkBeforeCoordsById] = useState<
    Record<string, LatLngPoint[]>
  >({});
  // Traccia pedonale di interscambio tra due mezzi diversi (solo se le fermate non coincidono)
  const [osrmTransferWalkCoordsById, setOsrmTransferWalkCoordsById] = useState<
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
    if (
      departure?.initialOriginCoords?.lat &&
      departure?.initialOriginCoords?.lng
    ) {
      return departure.initialOriginCoords;
    }
    return fromCoords;
  }, [departure, fromCoords]);

  const rawToCoords = useMemo(() => {
    if (departure?.toStopCoords?.lat && departure?.toStopCoords?.lng) {
      return departure.toStopCoords;
    }
    return { lat: 41.903932, lng: 12.52033 };
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

    return ensureContinuousTransitPolyline(
      { latitude: fromCoords.lat, longitude: fromCoords.lng },
      { latitude: toCoords.lat, longitude: toCoords.lng },
      departure.intermediateStopCoords,
      departure.transitPolyline || [],
    );
  }, [departure, fromCoords, toCoords, roadwayTransitCoordsById]);

  const isMultiLeg = Boolean(
    departure && departure.legs && departure.legs.length > 1,
  );

  // Se ci sono più tratte (cambio), estraiamo o risolviamo la polilinea e il colore contrastante per ogni tratta
  const multiLegRoutes = useMemo(() => {
    if (!departure || !isMultiLeg || !departure.legs) return [];
    const usedColors: string[] = [];
    return departure.legs.map((leg, idx) => {
      const legKey = `${departure.id}_leg_${idx}`;
      const legRoadCoords = roadwayLegCoordsById[legKey];
      const legFrom = leg.fromStopCoords || fromCoords;
      const legTo = leg.toStopCoords || toCoords;
      let poly =
        legRoadCoords && legRoadCoords.length >= 2
          ? legRoadCoords
          : leg.polyline;
      if (!poly || poly.length < 2) {
        poly = resolveOptimizedTransitPolyline(
          leg.fromStop,
          leg.toStop,
          legFrom,
          legTo,
          [],
        );
      }
      const continuousPoly = ensureContinuousTransitPolyline(
        { latitude: legFrom.lat, longitude: legFrom.lng },
        { latitude: legTo.lat, longitude: legTo.lng },
        [],
        poly,
      );
      const rawColor = getLineBadgeColor(leg.line, leg.mode);
      let color = rawColor;
      if (idx > 0) {
        const tooCloseToUsed = usedColors.some(
          (u) => rgbDistance(color, u) < 120,
        );
        const tooCloseToWalkBlue =
          rgbDistance(color, WALK_BLUE_PRIMARY) < 120 ||
          rgbDistance(color, WALK_BLUE_ALT) < 120;
        if (tooCloseToUsed || tooCloseToWalkBlue) {
          const picked =
            LEG_CONTRAST_CANDIDATES.find(
              (cand) =>
                usedColors.every((u) => rgbDistance(cand, u) >= 120) &&
                rgbDistance(cand, WALK_BLUE_PRIMARY) >= 120 &&
                rgbDistance(cand, WALK_BLUE_ALT) >= 120,
            ) || LEG_CONTRAST_CANDIDATES[idx % LEG_CONTRAST_CANDIDATES.length];
          color = picked;
        }
      }
      usedColors.push(color);
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

  // 1. Risolve la traiettoria stradale reale del mezzo (solo al cambio corsa, mai in loop su snappedFrom/snappedTo)
  const departureId = departure.id;
  useEffect(() => {
    if (!visible || !departure) return;
    let cancelled = false;
    const depId = departure.id;

    if (departure.mode === "bus" || departure.mode === "tram") {
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
          setRoadwayTransitCoordsById((prev) =>
            prev[depId] === roadPts ? prev : { ...prev, [depId]: roadPts },
          );
        })
        .catch(() => {});
    }

    // Per viaggi con interscambio (multi-tratta), risolve il tracciato stradale di ogni singola tratta su gomma
    if (departure.legs && departure.legs.length > 1) {
      departure.legs.forEach((leg, idx) => {
        if (leg.mode === "bus" || leg.mode === "tram") {
          const lFrom = leg.fromStopCoords || fromCoords;
          const lTo = leg.toStopCoords || toCoords;
          const legKey = depId + "_leg_" + idx;
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
              setRoadwayLegCoordsById((prev) =>
                prev[legKey] === legPts ? prev : { ...prev, [legKey]: legPts },
              );
            })
            .catch(() => {});
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [visible, departureId, departure, fromCoords, toCoords]);

  // 2. Risolve i percorsi pedonali solo se non già presenti e validi sulla corsa,
  // usando chiavi primitive arrotondate (evita loop infiniti e doppie chiamate Valhalla/OSRM)
  const walkBeforeReqKey = `${originCoords.lat.toFixed(4)},${originCoords.lng.toFixed(4)}->${snappedFrom.latitude.toFixed(4)},${snappedFrom.longitude.toFixed(4)}`;
  const walkAfterReqKey = `${snappedTo.latitude.toFixed(4)},${snappedTo.longitude.toFixed(4)}->${finalCoords.lat.toFixed(4)},${finalCoords.lng.toFixed(4)}`;
  const transferWalksReqKey = useMemo(() => {
    if (!isMultiLeg || multiLegRoutes.length < 2) return "";
    const parts: string[] = [];
    for (let i = 0; i < multiLegRoutes.length - 1; i++) {
      const prevPoly = multiLegRoutes[i].polyline;
      const nextPoly = multiLegRoutes[i + 1].polyline;
      const curTo = prevPoly.length > 0 ? prevPoly[prevPoly.length - 1] : null;
      const nextFrom = nextPoly.length > 0 ? nextPoly[0] : null;
      if (curTo && nextFrom) {
        parts.push(
          `${curTo.latitude.toFixed(4)},${curTo.longitude.toFixed(4)}->${nextFrom.latitude.toFixed(4)},${nextFrom.longitude.toFixed(4)}`,
        );
      }
    }
    return parts.join("|");
  }, [isMultiLeg, multiLegRoutes]);

  useEffect(() => {
    if (!visible || !departure) return;
    let cancelled = false;
    const depId = departure.id;

    const origPt: LatLngPoint = {
      latitude: originCoords.lat,
      longitude: originCoords.lng,
    };
    const hasExistingWalkBefore = Boolean(
      departure.walkBeforePolyline &&
        departure.walkBeforePolyline.length >= 4 &&
        haversineMeters(origPt, departure.walkBeforePolyline[0]) < 60 &&
        haversineMeters(
          snappedFrom,
          departure.walkBeforePolyline[departure.walkBeforePolyline.length - 1],
        ) < 60,
    );

    const needWalkBefore =
      !hasExistingWalkBefore &&
      ((departure.walkBeforeMinutes ?? 0) > 0 ||
        haversineMeters(origPt, snappedFrom) > 25);

    if (needWalkBefore) {
      resolvePedestrianRoadwayPolyline(originCoords, snappedFrom)
        .then((mappedFoot) => {
          if (cancelled || !mappedFoot || mappedFoot.length < 2) return;
          setOsrmWalkBeforeCoordsById((prev) =>
            prev[depId] === mappedFoot
              ? prev
              : { ...prev, [depId]: mappedFoot },
          );
        })
        .catch(() => {});
    }

    const destPt: LatLngPoint = {
      latitude: finalCoords.lat,
      longitude: finalCoords.lng,
    };
    const hasExistingWalkAfter = Boolean(
      departure.walkAfterPolyline &&
        departure.walkAfterPolyline.length >= 4 &&
        haversineMeters(snappedTo, departure.walkAfterPolyline[0]) < 60 &&
        haversineMeters(
          destPt,
          departure.walkAfterPolyline[departure.walkAfterPolyline.length - 1],
        ) < 60,
    );

    const needWalkAfter =
      !hasExistingWalkAfter &&
      ((departure.walkAfterMinutes ?? 0) > 0 ||
        haversineMeters(snappedTo, destPt) > 25);

    if (needWalkAfter) {
      resolvePedestrianRoadwayPolyline(snappedTo, finalCoords)
        .then((mappedFoot) => {
          if (cancelled || !mappedFoot || mappedFoot.length < 2) return;
          setOsrmWalkAfterCoordsById((prev) =>
            prev[depId] === mappedFoot
              ? prev
              : { ...prev, [depId]: mappedFoot },
          );
        })
        .catch(() => {});
    }

    // Risolve anche i tratti pedonali di interscambio (solo quando le fermate di cambio non coincidono)
    if (isMultiLeg && multiLegRoutes.length > 1) {
      for (let i = 0; i < multiLegRoutes.length - 1; i++) {
        const curRoute = multiLegRoutes[i];
        const nextRoute = multiLegRoutes[i + 1];
        const curTo =
          curRoute.polyline.length > 0
            ? curRoute.polyline[curRoute.polyline.length - 1]
            : curRoute.leg.toStopCoords
              ? {
                  latitude: curRoute.leg.toStopCoords.lat,
                  longitude: curRoute.leg.toStopCoords.lng,
                }
              : null;
        const nextFrom =
          nextRoute.polyline.length > 0
            ? nextRoute.polyline[0]
            : nextRoute.leg.fromStopCoords
              ? {
                  latitude: nextRoute.leg.fromStopCoords.lat,
                  longitude: nextRoute.leg.fromStopCoords.lng,
                }
              : null;
        if (!curTo || !nextFrom) continue;

        const existingTw = departure.transferWalkPolylines?.[i];
        const directDist = haversineMeters(curTo, nextFrom);
        const existingDist = computePolylineLengthMeters(existingTw);
        const effectiveDist = Math.max(directDist, existingDist);
        const sameName =
          normalizeStopKey(curRoute.leg.toStop) !== "" &&
          normalizeStopKey(curRoute.leg.toStop) ===
            normalizeStopKey(nextRoute.leg.fromStop);
        const sameSurface =
          (curRoute.leg.mode === "bus" || curRoute.leg.mode === "tram") &&
          (nextRoute.leg.mode === "bus" || nextRoute.leg.mode === "tram");
        const isSameStop =
          effectiveDist <= 35 || (sameName && sameSurface && effectiveDist <= 60);
        if (isSameStop) continue;

        const hasDetailedExisting = Boolean(
          existingTw &&
            existingTw.length >= 4 &&
            haversineMeters(curTo, existingTw[0]) < 60 &&
            haversineMeters(nextFrom, existingTw[existingTw.length - 1]) < 60,
        );
        if (!hasDetailedExisting && directDist > 35) {
          const twKey = `${depId}_tw_${i}`;
          resolvePedestrianRoadwayPolyline(curTo, nextFrom)
            .then((mappedTw) => {
              if (cancelled || !mappedTw || mappedTw.length < 2) return;
              setOsrmTransferWalkCoordsById((prev) =>
                prev[twKey] === mappedTw ? prev : { ...prev, [twKey]: mappedTw },
              );
            })
            .catch(() => {});
        }
      }
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visible,
    departureId,
    walkBeforeReqKey,
    walkAfterReqKey,
    transferWalksReqKey,
  ]);

  const walkBeforeRouteCoords = useMemo<LatLngPoint[]>(() => {
    if (!departure) return [];
    const origPt: LatLngPoint = {
      latitude: originCoords.lat,
      longitude: originCoords.lng,
    };
    const distToBus = haversineMeters(origPt, snappedFrom);
    if (
      (typeof departure.walkBeforeMinutes === "number" &&
        departure.walkBeforeMinutes <= 0) ||
      ((departure.walkBeforeMinutes ?? 0) <= 0 && distToBus <= 45)
    ) {
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
      haversineMeters(
        snappedFrom,
        departure.walkBeforePolyline[departure.walkBeforePolyline.length - 1],
      ) < 120
    ) {
      return [
        origPt,
        ...departure.walkBeforePolyline.slice(1, -1),
        snappedFrom,
      ];
    }
    if (distToBus > 8) {
      return [origPt, snappedFrom];
    }
    return [];
  }, [departure, originCoords, snappedFrom, osrmWalkBeforeCoordsById]);

  const walkAfterRouteCoords = useMemo<LatLngPoint[]>(() => {
    if (!departure) return [];
    const destPt: LatLngPoint = {
      latitude: finalCoords.lat,
      longitude: finalCoords.lng,
    };
    const distFromBus = haversineMeters(snappedTo, destPt);
    if (
      (typeof departure.walkAfterMinutes === "number" &&
        departure.walkAfterMinutes <= 0) ||
      ((departure.walkAfterMinutes ?? 0) <= 0 && distFromBus <= 25)
    ) {
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
      haversineMeters(
        destPt,
        departure.walkAfterPolyline[departure.walkAfterPolyline.length - 1],
      ) < 120
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

  // Analisi di ciascun interscambio tra tratte consecutive:
  // distingue con precisione tra cambio alla stessa fermata (nessuna camminata) e cambio con percorso a piedi
  const transferSegments = useMemo(() => {
    if (!departure || !isMultiLeg || multiLegRoutes.length < 2) return [];
    const segments: {
      needsWalk: boolean;
      polyline: LatLngPoint[];
      directDistMeters: number;
      effectiveDistMeters: number;
      rawWalkMins: number;
    }[] = [];

    for (let i = 0; i < multiLegRoutes.length - 1; i++) {
      const curRoute = multiLegRoutes[i];
      const nextRoute = multiLegRoutes[i + 1];
      const curTo: LatLngPoint | null =
        curRoute.polyline.length > 0
          ? curRoute.polyline[curRoute.polyline.length - 1]
          : curRoute.leg.toStopCoords
            ? {
                latitude: curRoute.leg.toStopCoords.lat,
                longitude: curRoute.leg.toStopCoords.lng,
              }
            : null;
      const nextFrom: LatLngPoint | null =
        nextRoute.polyline.length > 0
          ? nextRoute.polyline[0]
          : nextRoute.leg.fromStopCoords
            ? {
                latitude: nextRoute.leg.fromStopCoords.lat,
                longitude: nextRoute.leg.fromStopCoords.lng,
              }
            : null;

      if (!curTo || !nextFrom) {
        segments.push({
          needsWalk: false,
          polyline: [],
          directDistMeters: 0,
          effectiveDistMeters: 0,
          rawWalkMins: 0,
        });
        continue;
      }

      const twKey = `${departure.id}_tw_${i}`;
      const osrmTw = osrmTransferWalkCoordsById[twKey];
      const rawExisting = departure.transferWalkPolylines?.[i];
      const basePoly =
        osrmTw && osrmTw.length >= 2
          ? osrmTw
          : rawExisting && rawExisting.length >= 2
            ? rawExisting
            : [];

      const directDistMeters = haversineMeters(curTo, nextFrom);
      const polyDistMeters = computePolylineLengthMeters(basePoly);
      const effectiveDistMeters = Math.max(directDistMeters, polyDistMeters);
      const sameStopName =
        normalizeStopKey(curRoute.leg.toStop) !== "" &&
        normalizeStopKey(curRoute.leg.toStop) ===
          normalizeStopKey(nextRoute.leg.fromStop);
      const sameSurfaceMode =
        (curRoute.leg.mode === "bus" || curRoute.leg.mode === "tram") &&
        (nextRoute.leg.mode === "bus" || nextRoute.leg.mode === "tram");

      // Se discesa e ripartenza coincidono fisicamente (<= 35m, o stessa fermata di superficie <= 60m),
      // non c'è nessuna camminata intermedia da disegnare o indicare.
      const needsWalk = !(
        effectiveDistMeters <= 35 ||
        (sameStopName && sameSurfaceMode && effectiveDistMeters <= 60)
      );

      if (!needsWalk) {
        segments.push({
          needsWalk: false,
          polyline: [],
          directDistMeters,
          effectiveDistMeters,
          rawWalkMins: 0,
        });
        continue;
      }

      const snappedPoly: LatLngPoint[] =
        basePoly.length >= 2
          ? [curTo, ...basePoly.slice(1, -1), nextFrom]
          : [curTo, nextFrom];
      const realWalkMins = Math.max(
        1,
        calculateRealWalkMinutes(curTo, nextFrom, snappedPoly).minutes,
      );

      segments.push({
        needsWalk: true,
        polyline: snappedPoly,
        directDistMeters,
        effectiveDistMeters,
        rawWalkMins: realWalkMins,
      });
    }

    return segments;
  }, [departure, isMultiLeg, multiLegRoutes, osrmTransferWalkCoordsById]);

  const transferWalks = useMemo<LatLngPoint[][]>(
    () =>
      transferSegments
        .filter((s) => s.needsWalk && s.polyline.length >= 2)
        .map((s) => s.polyline),
    [transferSegments],
  );

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
          allPts.push({
            latitude: ml.leg.fromStopCoords.lat,
            longitude: ml.leg.fromStopCoords.lng,
          });
        }
        if (ml.leg.toStopCoords) {
          allPts.push({
            latitude: ml.leg.toStopCoords.lat,
            longitude: ml.leg.toStopCoords.lng,
          });
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

  const getZoomBucket = (delta: number): 0 | 1 | 2 | 3 => {
    if (delta > 0.02) return 0;
    if (delta > 0.01) return 1;
    if (delta > 0.005) return 2;
    return 3;
  };
  const [zoomBucket, setZoomBucket] = useState<0 | 1 | 2 | 3 | null>(null);

  // Scaling proporzionale allo zoom per il tracciato a piedi:
  // aggiorna lo stato solo al cambio fascia di zoom (0 re-render durante il pan)
  const walkingStrokeProps = useMemo(() => {
    const bucket = zoomBucket ?? getZoomBucket(mapRegion.latitudeDelta ?? 0.012);
    const isIos = Platform.OS === "ios";
    if (bucket === 0) {
      return {
        strokeWidth: 2.2,
        lineDashPattern: isIos ? [2, 5] : [0.1, 6],
      };
    }
    if (bucket === 1) {
      return {
        strokeWidth: 2.8,
        lineDashPattern: isIos ? [3, 6] : [0.1, 7],
      };
    }
    if (bucket === 2) {
      return {
        strokeWidth: 3.4,
        lineDashPattern: isIos ? [3.5, 7] : [0.1, 9],
      };
    }
    return {
      strokeWidth: 4,
      lineDashPattern: isIos ? [4, 8] : [0.1, 11],
    };
  }, [zoomBucket, mapRegion.latitudeDelta]);

  const snappedIntermediateStops = useMemo(() => {
    if (!departure.intermediateStopCoords || departure.intermediateStopCoords.length === 0) {
      return [];
    }
    return departure.intermediateStopCoords.map((stop) => ({
      name: stop.name,
      snapped: snapCoordinateToPolyline(
        { latitude: stop.lat, longitude: stop.lng },
        transitRouteCoords,
      ),
    }));
  }, [departure.intermediateStopCoords, transitRouteCoords]);

  const isWeb = Platform.OS === "web";
  const lineColor = getLineBadgeColor(departure.line, departure.mode);
  const modeIcon = getTransitModeIcon(departure.mode, departure.line);
  const isMetro =
    departure.mode === "metro" ||
    departure.line.toLowerCase().includes("metro");

  const isDelayed =
    isLiveContext &&
    (departure.statusType === "delayed" || departure.delayMinutes > 1);

  const statusText = isDelayed
    ? departure.delayMinutes > 0
      ? `In ritardo (+${departure.delayMinutes} min)`
      : "In ritardo"
    : "In orario";

  const statusColor = isDelayed ? "#f59e0b" : "#10b981";
  const statusBg = isDelayed
    ? "rgba(245, 158, 11, 0.16)"
    : "rgba(16, 185, 129, 0.16)";
  const statusBorder = isDelayed
    ? "rgba(245, 158, 11, 0.4)"
    : "rgba(16, 185, 129, 0.4)";

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
    return Boolean(
      isInWindow && departure.isLive && departure.statusType !== "scheduled",
    );
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

  const activeAlerts = Array.from(
    new Set((departure.alerts || []).map((a) => a.trim()).filter(Boolean)),
  );

  const activeTransitColors =
    isMultiLeg && multiLegRoutes.length > 0
      ? multiLegRoutes.map((m) => m.color)
      : [lineColor];
  const hasBlueTransitConflict = activeTransitColors.some(
    (c) => rgbDistance(c, WALK_BLUE_PRIMARY) < 105,
  );
  const effectiveWalkColor = hasBlueTransitConflict
    ? WALK_BLUE_ALT
    : WALK_BLUE_PRIMARY;
  const effectiveWalkTextColor = hasBlueTransitConflict
    ? WALK_BLUE_TEXT_ALT
    : WALK_BLUE_TEXT_PRIMARY;
  const effectiveWalkMarkerIcon = hasBlueTransitConflict
    ? "#0f172a"
    : "#ffffff";
  const effectiveWalkHalo = hasBlueTransitConflict
    ? "rgba(147, 197, 253, 0.34)"
    : "rgba(59, 130, 246, 0.36)";

  // Colore dedicato ad alto contrasto per l'eventuale tratto a piedi al cambio,
  // distinto sia dal colore pedonale standard sia dai colori delle tratte dei mezzi
  const effectiveTransferWalk = (() => {
    const avoidColors = [effectiveWalkColor, ...activeTransitColors];
    const picked = TRANSFER_WALK_CANDIDATES.find((cand) =>
      avoidColors.every((u) => rgbDistance(cand.stroke, u) >= 110),
    );
    if (picked) return picked;
    let best = TRANSFER_WALK_CANDIDATES[0];
    let bestMinDist = -1;
    for (const cand of TRANSFER_WALK_CANDIDATES) {
      const minD = Math.min(
        ...avoidColors.map((u) => rgbDistance(cand.stroke, u)),
      );
      if (minD > bestMinDist) {
        bestMinDist = minD;
        best = cand;
      }
    }
    return best;
  })();

  const lastTransitColor =
    activeTransitColors[activeTransitColors.length - 1] || lineColor;
  const isLastLegGreen =
    rgbDistance(lastTransitColor, ARRIVAL_GREEN_BG) < 120 ||
    rgbDistance(lastTransitColor, "#059669") < 120;
  const effectiveArrivalBg = isLastLegGreen ? ARRIVAL_ALT_BG : ARRIVAL_GREEN_BG;
  const effectiveArrivalText = isLastLegGreen
    ? ARRIVAL_ALT_TEXT
    : ARRIVAL_GREEN_TEXT;
  const effectiveArrivalHalo = isLastLegGreen
    ? "rgba(244, 63, 94, 0.32)"
    : "rgba(16, 185, 129, 0.32)";

  const crowdingConfig = getCrowdingConfig(departure.crowdingLevel);

  const handleOpenStopNavigation = (
    provider: "apple" | "google",
    target: "from_stop" | "to_dest" = "from_stop",
  ) => {
    const coords =
      target === "to_dest" && (departure.walkAfterMinutes ?? 0) > 0
        ? finalCoords
        : fromCoords;
    const lat = coords.lat;
    const lng = coords.lng;

    if (provider === "apple" && Platform.OS === "ios") {
      const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
      Linking.openURL(appleUrl).catch(() => {});
      return;
    }

    const gmapsAppUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=walking`;
    const gmapsWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

    Linking.canOpenURL("comgooglemaps://")
      .then((supported) => {
        if (supported) {
          Linking.openURL(gmapsAppUrl);
        } else {
          Linking.openURL(gmapsWebUrl);
        }
      })
      .catch(() => Linking.openURL(gmapsWebUrl));
  };

  const mapNavMenuActions: MenuAction[] = [
    {
      id: "apple",
      title: "Apple Mappe",
      image: Platform.OS === "ios" ? "map.fill" : undefined,
      imageColor: "#38bdf8",
    },
    {
      id: "google",
      title: "Google Maps",
      image: Platform.OS === "ios" ? "location.fill" : undefined,
      imageColor: "#34d399",
    },
  ];

  const handleOpenMapAppSheet = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Apri percorso in",
          options: ["Apple Mappe", "Google Maps", "Annulla"],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            handleOpenStopNavigation("apple", "from_stop");
          } else if (buttonIndex === 1) {
            handleOpenStopNavigation("google", "from_stop");
          }
        },
      );
      return;
    }
    if (Platform.OS === "web") {
      handleOpenStopNavigation("google", "from_stop");
      return;
    }
    Alert.alert("Apri percorso in", undefined, [
      {
        text: "Google Maps",
        onPress: () => handleOpenStopNavigation("google", "from_stop"),
      },
      {
        text: "Apple Mappe",
        onPress: () => handleOpenStopNavigation("apple", "from_stop"),
      },
      { text: "Annulla", style: "cancel" },
    ]);
  };

  const handlePressRecommendedLine = (lineName: string) => {
    if (!onSelectDeparture) return;
    const match = allDepartures.find(
      (d) => d.line.toLowerCase() === lineName.toLowerCase(),
    );
    if (match) {
      onSelectDeparture(match);
    }
  };

  const walkBeforeMins =
    typeof departure.walkBeforeMinutes === "number" &&
    departure.walkBeforeMinutes >= 0
      ? departure.walkBeforeMinutes
      : calculateRealWalkMinutes(
          originCoords,
          snappedFrom,
          walkBeforeRouteCoords,
        ).minutes;

  const walkAfterMins =
    typeof departure.walkAfterMinutes === "number" &&
    departure.walkAfterMinutes >= 0
      ? departure.walkAfterMinutes
      : calculateRealWalkMinutes(toCoords, finalCoords, walkAfterRouteCoords)
          .minutes;

  const depMinsParsed = parseHHMMToMins(displayDepTime);

  // Modello cronologico normalizzato al minuto (HH:MM) per corse con cambio:
  // garantisce che somma delle tratte + attese/camminate al cambio === durata lista mezzi (salita -> ultima discesa)
  // e che somma di tutti gli step in "IL TUO VIAGGIO" === differenza esatta ARRIVO - PARTENZA.
  const multiLegJourney = useMemo(() => {
    if (!isMultiLeg || multiLegRoutes.length === 0) return null;

    const normalizedLegs: {
      route: (typeof multiLegRoutes)[number];
      boardMins: number;
      alightMins: number;
      boardTimeStr: string;
      alightTimeStr: string;
      durationMinutes: number;
    }[] = [];

    for (let i = 0; i < multiLegRoutes.length; i++) {
      const route = multiLegRoutes[i];
      const leg = route.leg;
      const rawBoardM = parseHHMMToMins(leg.departureTime || "");
      const rawAlightM = parseHHMMToMins(leg.arrivalTime || "");

      let boardM: number;
      let alightM: number;

      if (i === 0) {
        boardM = depMinsParsed >= 0 ? depMinsParsed : rawBoardM;
        const rawDur =
          rawBoardM >= 0 && rawAlightM >= 0
            ? Math.max(1, clockDiffMins(rawBoardM, rawAlightM))
            : Math.max(1, leg.durationMinutes || 1);
        if (rawBoardM >= 0 && rawAlightM >= 0 && boardM === rawBoardM) {
          alightM = rawAlightM;
        } else if (boardM >= 0) {
          alightM = (boardM + rawDur) % 1440;
        } else {
          alightM = rawAlightM;
        }
      } else {
        const prevAlightM = normalizedLegs[i - 1].alightMins;
        let candidateBoardM =
          rawBoardM >= 0
            ? rawBoardM
            : prevAlightM >= 0
              ? (prevAlightM + 2) % 1440
              : -1;
        const rawDur =
          rawBoardM >= 0 && rawAlightM >= 0
            ? Math.max(1, clockDiffMins(rawBoardM, rawAlightM))
            : Math.max(1, leg.durationMinutes || 1);
        let shiftedDueToOverlap = false;
        if (prevAlightM >= 0 && candidateBoardM >= 0) {
          let signedDelta = candidateBoardM - prevAlightM;
          if (signedDelta < -720) signedDelta += 1440;
          if (signedDelta > 720) signedDelta -= 1440;
          if (signedDelta < 0 && signedDelta > -60) {
            candidateBoardM = prevAlightM;
            shiftedDueToOverlap = true;
          }
        }
        boardM = candidateBoardM;
        alightM =
          !shiftedDueToOverlap && rawAlightM >= 0
            ? rawAlightM
            : boardM >= 0
              ? (boardM + rawDur) % 1440
              : -1;
      }

      const durMins =
        boardM >= 0 && alightM >= 0
          ? Math.max(1, clockDiffMins(boardM, alightM))
          : Math.max(1, leg.durationMinutes || 1);
      if (boardM >= 0 && alightM < 0) {
        alightM = (boardM + durMins) % 1440;
      }

      normalizedLegs.push({
        route,
        boardMins: boardM,
        alightMins: alightM,
        boardTimeStr: boardM >= 0 ? minsToHHMM(boardM) : leg.departureTime || "",
        alightTimeStr: alightM >= 0 ? minsToHHMM(alightM) : leg.arrivalTime || "",
        durationMinutes: durMins,
      });
    }

    const transfers = normalizedLegs.slice(0, -1).map((curLeg, idx) => {
      const nextLeg = normalizedLegs[idx + 1];
      const seg = transferSegments[idx];
      const rawGap =
        curLeg.alightMins >= 0 && nextLeg.boardMins >= 0
          ? clockDiffMins(curLeg.alightMins, nextLeg.boardMins)
          : 0;
      const gapMins = rawGap < 180 ? rawGap : 0;
      const needsWalk = Boolean(seg?.needsWalk && seg.polyline.length >= 2);
      const walkMins = needsWalk
        ? gapMins > 0
          ? Math.min(Math.max(1, seg.rawWalkMins), gapMins)
          : Math.max(1, seg.rawWalkMins)
        : 0;
      const waitMins = needsWalk ? Math.max(0, gapMins - walkMins) : gapMins;

      return {
        needsWalk,
        polyline: needsWalk ? seg.polyline : [],
        gapMins,
        walkMins,
        waitMins,
      };
    });

    const sumParts =
      normalizedLegs.reduce((acc, l) => acc + l.durationMinutes, 0) +
      transfers.reduce((acc, t) => acc + t.walkMins + t.waitMins, 0);
    const firstBoard = normalizedLegs[0]?.boardMins ?? -1;
    const lastAlight = normalizedLegs[normalizedLegs.length - 1]?.alightMins ?? -1;
    const clockSpan =
      firstBoard >= 0 && lastAlight >= 0
        ? clockDiffMins(firstBoard, lastAlight)
        : sumParts;
    const transitSpanMins = Math.max(1, clockSpan > 0 && clockSpan < 360 ? clockSpan : sumParts);

    return {
      legs: normalizedLegs,
      transfers,
      transitSpanMins,
      firstBoardMins: firstBoard,
      lastAlightMins: lastAlight,
      hasAnyTransferWalk: transfers.some(
        (t) => t.needsWalk && t.polyline.length >= 2,
      ),
    };
  }, [isMultiLeg, multiLegRoutes, depMinsParsed, transferSegments]);

  const inVehicleMins = multiLegJourney
    ? multiLegJourney.transitSpanMins
    : typeof departure.inVehicleMinutes === "number" &&
        departure.inVehicleMinutes > 0
      ? departure.inVehicleMinutes
      : Math.max(1, departure.durationMinutes - walkAfterMins);

  // Durata totale door-to-door ("IL TUO VIAGGIO": walkBefore + tratte & cambi/attese + walkAfter)
  const totalDoorToDoorMinutes = Math.max(
    1,
    walkBeforeMins + inVehicleMins + walkAfterMins,
  );

  const effectiveFirstBoardMins =
    multiLegJourney && multiLegJourney.firstBoardMins >= 0
      ? multiLegJourney.firstBoardMins
      : depMinsParsed;
  const effectiveLastAlightMins =
    multiLegJourney && multiLegJourney.lastAlightMins >= 0
      ? multiLegJourney.lastAlightMins
      : depMinsParsed >= 0
        ? (depMinsParsed + inVehicleMins) % 1440
        : -1;

  const leaveOriginTimeDisplay =
    effectiveFirstBoardMins >= 0
      ? minsToHHMM(effectiveFirstBoardMins - walkBeforeMins)
      : "";
  const alightingTimeDisplay =
    multiLegJourney && multiLegJourney.legs.length > 0
      ? multiLegJourney.legs[multiLegJourney.legs.length - 1].alightTimeStr
      : effectiveLastAlightMins >= 0
        ? minsToHHMM(effectiveLastAlightMins)
        : departure.alightingTime || departure.arrivalTime || "";
  const arrivalTimeDisplay =
    effectiveLastAlightMins >= 0
      ? minsToHHMM(effectiveLastAlightMins + walkAfterMins)
      : departure.arrivalTime || "";

  const hasStandardWalk =
    walkBeforeMins > 0 ||
    walkAfterMins > 0 ||
    walkBeforeRouteCoords.length >= 2 ||
    walkAfterRouteCoords.length >= 2;
  const hasAnyTransferWalk = Boolean(multiLegJourney?.hasAnyTransferWalk);

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title={`Dettaglio ${isMultiLeg || departure.line.toLowerCase().includes("metro") ? departure.line : `Linea ${departure.line}`}`}
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
                        backgroundColor: isActiveLine ? cColor : `${cColor}22`,
                        borderColor: isActiveLine ? "#ffffff" : `${cColor}88`,
                      },
                    ]}
                  >
                    <Ionicons
                      name={cIcon}
                      size={12}
                      color={isActiveLine ? "#ffffff" : cColor}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[styles.recLineChipText, { color: "#ffffff" }]}
                    >
                      {line}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Card Riepilogo Viaggio e Dettagli Corsa ── */}
        <View style={styles.heroCard}>
          {/* Banner Soluzione con Cambio */}
          {(!departure.isDirect ||
            (departure.legs && departure.legs.length > 1)) && (
            <View style={styles.heroTransferBanner}>
              <Ionicons
                name="git-branch-outline"
                size={13}
                color="#c084fc"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.heroTransferBannerText}>
                Soluzione con {departure.transfersCount || 1}{" "}
                {(departure.transfersCount || 1) === 1 ? "cambio" : "cambi"} (
                {inVehicleMins}m): {departure.transferSummary || "Metro + Bus"}
              </Text>
            </View>
          )}

          {/* Card Unificata: 1) Il tuo spostamento con barra e timeline verticale integrata  2) Corsa Mezzo con dettagli */}
          <View style={styles.heroScheduleStack}>
            {/* 1. Riquadro Principale: PARTI TU / ARRIVI TU + Barra proporzionale + Timeline verticale */}
            <View style={styles.heroJourneyCard}>
              <View style={styles.heroJourneyHeaderRow}>
                <View style={styles.heroScheduleTagRow}>
                  <Ionicons
                    name="walk"
                    size={12}
                    color={effectiveWalkTextColor}
                  />
                  <Text style={styles.heroScheduleTagText}>IL TUO VIAGGIO</Text>
                </View>

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
                    <Text
                      style={[styles.heroStatusText, { color: statusColor }]}
                    >
                      {statusText}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.heroTimesGrid}>
                <View style={styles.heroTimeBox}>
                  <Text style={styles.heroTimeLabel}>PARTENZA</Text>
                  <Text style={styles.heroUserTimeValue}>
                    {leaveOriginTimeDisplay || displayDepTime}
                  </Text>
                </View>

                <View style={styles.heroTimeArrowCol}>
                  <Text style={styles.heroUserSpanText}>
                    {totalDoorToDoorMinutes}m
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={15}
                    color={effectiveWalkTextColor}
                    style={{ marginTop: 1 }}
                  />
                </View>

                <View style={[styles.heroTimeBox, { alignItems: "flex-end" }]}>
                  <Text style={styles.heroTimeLabel}>ARRIVO</Text>
                  <Text style={styles.heroUserTimeValue}>
                    {arrivalTimeDisplay}
                  </Text>
                </View>
              </View>

              {/* Barra proporzionale continua: tratti a piedi standard, tratte sui mezzi, eventuale cambio a piedi e attese */}
              <View style={styles.heroSegmentBarTrack}>
                {walkBeforeMins > 0 &&
                  renderWalkSolidBar(
                    walkBeforeMins,
                    "seg-walk-before",
                    effectiveWalkColor,
                  )}
                {isMultiLeg && multiLegJourney && multiLegJourney.legs.length > 0
                  ? multiLegJourney.legs.map((legItem, mlIdx) => {
                      const transfer =
                        mlIdx < multiLegJourney.transfers.length
                          ? multiLegJourney.transfers[mlIdx]
                          : null;
                      return (
                        <React.Fragment key={`seg-leg-wrap-${mlIdx}`}>
                          <View
                            style={[
                              styles.heroSegmentSlice,
                              {
                                flexGrow: Math.max(1, legItem.durationMinutes),
                                flexShrink: 1,
                                flexBasis: 0,
                                backgroundColor: legItem.route.color,
                              },
                            ]}
                          />
                          {transfer &&
                            transfer.needsWalk &&
                            transfer.walkMins > 0 &&
                            renderWalkSolidBar(
                              transfer.walkMins,
                              `seg-walk-transfer-${mlIdx}`,
                              effectiveTransferWalk.stroke,
                            )}
                          {transfer &&
                            transfer.waitMins > 0 &&
                            renderWalkSolidBar(
                              transfer.waitMins,
                              `seg-wait-transfer-${mlIdx}`,
                              WAIT_RAIL_COLOR,
                            )}
                        </React.Fragment>
                      );
                    })
                  : (inVehicleMins > 0 ||
                      (walkBeforeMins === 0 && walkAfterMins === 0)) && (
                      <View
                        style={[
                          styles.heroSegmentSlice,
                          {
                            flexGrow: Math.max(1, inVehicleMins),
                            flexShrink: 1,
                            flexBasis: 0,
                            backgroundColor: lineColor,
                          },
                        ]}
                      />
                    )}
                {walkAfterMins > 0 &&
                  renderWalkSolidBar(
                    walkAfterMins,
                    "seg-walk-after",
                    effectiveWalkColor,
                  )}
              </View>

              {/* Timeline verticale unificata integrata direttamente in IL TUO VIAGGIO */}
              <View style={styles.integratedTimelineWrap}>
                {/* 1. Inizio camminata verso la fermata (se presente) */}
                {walkBeforeMins > 0 && (
                  <View style={styles.tlRow}>
                    <Text
                      style={[
                        styles.tlTimeCol,
                        { color: effectiveWalkTextColor },
                      ]}
                    >
                      {leaveOriginTimeDisplay || displayDepTime}
                    </Text>
                    <View style={styles.tlRailCol}>
                      <View style={styles.tlRailSpacerTop} />
                      <View
                        style={[
                          styles.tlWalkNode,
                          {
                            backgroundColor: effectiveWalkColor,
                            borderColor: effectiveWalkTextColor,
                          },
                        ]}
                      >
                        <Ionicons
                          name="walk"
                          size={10}
                          color={effectiveWalkMarkerIcon}
                        />
                      </View>
                      <View style={styles.tlRailGrow}>
                        {renderVerticalDashedRail(effectiveWalkColor, 1)}
                      </View>
                    </View>
                    <View style={[styles.tlBodyCol, { paddingBottom: 8 }]}>
                      <Text
                        style={[
                          styles.tlTitleText,
                          { color: effectiveWalkTextColor },
                        ]}
                      >
                        {walkBeforeMins} min a piedi
                      </Text>
                    </View>
                  </View>
                )}

                {/* 2. Tratte mezzi (multi-tratta o corsa diretta) */}
                {isMultiLeg && multiLegJourney && multiLegJourney.legs.length > 0 ? (
                  multiLegJourney.legs.map((legItem, lIdx) => {
                    const ml = legItem.route;
                    const isFirstLeg = lIdx === 0;
                    const isLastLeg = lIdx === multiLegJourney.legs.length - 1;
                    const legColor = ml.color;
                    const lIcon = getTransitModeIcon(ml.leg.mode, ml.leg.line);
                    const nextLegItem = !isLastLeg
                      ? multiLegJourney.legs[lIdx + 1]
                      : null;
                    const transfer = !isLastLeg
                      ? multiLegJourney.transfers[lIdx]
                      : null;
                    const prevTransfer =
                      lIdx > 0 ? multiLegJourney.transfers[lIdx - 1] : null;
                    const boardTimeStr = legItem.boardTimeStr;
                    const alightTimeStr = legItem.alightTimeStr;
                    const hasConnectorAbove = !isFirstLeg || walkBeforeMins > 0;
                    const aboveRailColor = isFirstLeg
                      ? effectiveWalkColor
                      : prevTransfer &&
                          prevTransfer.needsWalk &&
                          prevTransfer.waitMins === 0
                        ? effectiveTransferWalk.stroke
                        : WAIT_RAIL_COLOR;
                    const belowDiscesaRailColor = isLastLeg
                      ? effectiveWalkColor
                      : transfer?.needsWalk
                        ? effectiveTransferWalk.stroke
                        : WAIT_RAIL_COLOR;
                    const legStopsCount =
                      ml.leg.intermediateStopsCount ??
                      (ml.leg.intermediateStopNames
                        ? ml.leg.intermediateStopNames.length + 1
                        : 0);

                    return (
                      <React.Fragment key={`tl-leg-${lIdx}`}>
                        {/* Badge tratta + fermate affiancati alla linea verticale continua */}
                        <View style={styles.tlLegHeaderRow}>
                          <View style={styles.tlTimeEmpty} />
                          <View style={styles.tlRailCol}>
                            {hasConnectorAbove &&
                              renderVerticalDashedRail(aboveRailColor, 3)}
                          </View>
                          <View style={styles.tlLegBadgeGroup}>
                            <View
                              style={[
                                styles.unifiedLegBadge,
                                { backgroundColor: legColor },
                              ]}
                            >
                              <Ionicons
                                name={lIcon}
                                size={10}
                                color="#ffffff"
                                style={{ marginRight: 4 }}
                              />
                              <Text style={styles.unifiedLegBadgeText}>
                                {ml.leg.line} - {legItem.durationMinutes} min
                              </Text>
                            </View>
                            {legStopsCount > 0 && (
                              <View
                                style={[
                                  styles.heroMetaPill,
                                  {
                                    backgroundColor: `${legColor}24`,
                                    borderColor: `${legColor}55`,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name="git-commit-outline"
                                  size={10.5}
                                  color={legColor}
                                />
                                <Text
                                  style={[
                                    styles.heroMetaPillText,
                                    { color: "#f8fafc" },
                                  ]}
                                >
                                  {legStopsCount}{" "}
                                  {legStopsCount === 1 ? "fermata" : "fermate"}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Salita tratta */}
                        <View style={styles.tlRow}>
                          <Text style={[styles.tlTimeCol, { color: legColor }]}>
                            {boardTimeStr}
                          </Text>
                          <View style={styles.tlRailCol}>
                            {hasConnectorAbove ? (
                              <View style={{ height: 1.5 }} />
                            ) : (
                              <View style={styles.tlRailSpacerTop} />
                            )}
                            <View
                              style={[
                                styles.tlTransitDot,
                                {
                                  backgroundColor: legColor,
                                  borderColor: `${legColor}55`,
                                },
                              ]}
                            />
                            <View
                              style={[
                                styles.tlRailBottomGrow,
                                { backgroundColor: legColor },
                              ]}
                            />
                          </View>
                          <View style={styles.tlBodyCol}>
                            <Text style={styles.tlTitleText}>
                              {ml.leg.fromStop}
                            </Text>
                          </View>
                        </View>

                        {/* Fermate intermedie tratta */}
                        {ml.leg.intermediateStopNames?.map((sName, sIdx) => (
                          <View
                            key={`tl-m-${lIdx}-int-${sIdx}`}
                            style={styles.tlRow}
                          >
                            <View style={styles.tlTimeEmpty} />
                            <View style={styles.tlRailCol}>
                              <View
                                style={[
                                  styles.tlRailTopHalf,
                                  { backgroundColor: legColor },
                                ]}
                              />
                              <View
                                style={[
                                  styles.tlIntDot,
                                  { borderColor: legColor },
                                ]}
                              />
                              <View
                                style={[
                                  styles.tlRailBottomGrow,
                                  { backgroundColor: legColor },
                                ]}
                              />
                            </View>
                            <View style={styles.tlBodyIntCol}>
                              <Text style={styles.tlIntText}>{sName}</Text>
                            </View>
                          </View>
                        ))}

                        {/* Discesa tratta */}
                        <View style={styles.tlRow}>
                          <Text style={[styles.tlTimeCol, { color: legColor }]}>
                            {alightTimeStr}
                          </Text>
                          <View style={styles.tlRailCol}>
                            <View
                              style={[
                                styles.tlRailTopHalf,
                                { backgroundColor: legColor },
                              ]}
                            />
                            <View
                              style={[
                                styles.tlTransitDot,
                                {
                                  backgroundColor: legColor,
                                  borderColor: `${legColor}55`,
                                },
                              ]}
                            />
                            <View style={styles.tlRailGrow}>
                              {(!isLastLeg || walkAfterMins > 0) &&
                                renderVerticalDashedRail(
                                  belowDiscesaRailColor,
                                  !isLastLeg && nextLegItem ? 3 : 2,
                                )}
                            </View>
                          </View>
                          <View
                            style={[
                              styles.tlBodyCol,
                              isLastLeg && {
                                paddingBottom: walkAfterMins > 0 ? 15 : 0,
                              },
                            ]}
                          >
                            <Text style={styles.tlTitleText}>
                              {ml.leg.toStop}
                            </Text>
                            {!isLastLeg && nextLegItem && (
                              <Text style={styles.tlSubText}>
                                Cambio → prendi {nextLegItem.route.leg.line}
                              </Text>
                            )}
                          </View>
                        </View>

                        {/* Step interscambio: camminata con colore dedicato (se fermate diverse) e/o attesa alla fermata */}
                        {!isLastLeg && transfer && (
                          <>
                            {transfer.needsWalk && transfer.walkMins > 0 && (
                              <View style={styles.tlRow}>
                                <View style={styles.tlTimeEmpty} />
                                <View style={styles.tlRailCol}>
                                  <View style={{ height: 1 }} />
                                  <View
                                    style={[
                                      styles.tlWalkNode,
                                      {
                                        backgroundColor:
                                          effectiveTransferWalk.stroke,
                                        borderColor: effectiveTransferWalk.text,
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name="walk"
                                      size={10}
                                      color={effectiveTransferWalk.icon}
                                    />
                                  </View>
                                  <View style={styles.tlRailGrow}>
                                    {renderVerticalDashedRail(
                                      transfer.waitMins > 0
                                        ? WAIT_RAIL_COLOR
                                        : effectiveTransferWalk.stroke,
                                      1,
                                    )}
                                  </View>
                                </View>
                                <View
                                  style={[
                                    styles.tlBodyCol,
                                    { paddingBottom: 8 },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.tlTitleText,
                                      { color: effectiveTransferWalk.text },
                                    ]}
                                  >
                                    {transfer.walkMins} min a piedi
                                  </Text>
                                </View>
                              </View>
                            )}

                            {(transfer.waitMins > 0 || !transfer.needsWalk) && (
                              <View style={styles.tlRow}>
                                <View style={styles.tlTimeEmpty} />
                                <View style={styles.tlRailCol}>
                                  <View style={{ height: 1 }} />
                                  <View
                                    style={[
                                      styles.tlWalkNode,
                                      {
                                        backgroundColor: WAIT_NODE_BG,
                                        borderColor: WAIT_NODE_BORDER,
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name="time-outline"
                                      size={10}
                                      color="#ffffff"
                                    />
                                  </View>
                                  <View style={styles.tlRailGrow}>
                                    {renderVerticalDashedRail(
                                      WAIT_RAIL_COLOR,
                                      1,
                                    )}
                                  </View>
                                </View>
                                <View
                                  style={[
                                    styles.tlBodyCol,
                                    { paddingBottom: 8 },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.tlTitleText,
                                      { color: WAIT_TEXT_COLOR },
                                    ]}
                                  >
                                    {transfer.waitMins > 0
                                      ? `Attendi ${transfer.waitMins} min`
                                      : "Cambio immediato"}
                                  </Text>
                                </View>
                              </View>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <>
                    {/* Badge linea + fermate affiancato lungo la linea della timeline anche su corsa diretta */}
                    <View style={styles.tlLegHeaderRow}>
                      <View style={styles.tlTimeEmpty} />
                      <View style={styles.tlRailCol}>
                        {walkBeforeMins > 0 &&
                          renderVerticalDashedRail(effectiveWalkColor, 3)}
                      </View>
                      <View style={styles.tlLegBadgeGroup}>
                        <View
                          style={[
                            styles.unifiedLegBadge,
                            { backgroundColor: lineColor },
                          ]}
                        >
                          <Ionicons
                            name={modeIcon}
                            size={10}
                            color="#ffffff"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.unifiedLegBadgeText}>
                            {departure.line} - {inVehicleMins} min
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.heroMetaPill,
                            {
                              backgroundColor: `${lineColor}24`,
                              borderColor: `${lineColor}55`,
                            },
                          ]}
                        >
                          <Ionicons
                            name="git-commit-outline"
                            size={10.5}
                            color={lineColor}
                          />
                          <Text
                            style={[
                              styles.heroMetaPillText,
                              { color: "#f8fafc" },
                            ]}
                          >
                            {stopsCount}{" "}
                            {stopsCount === 1 ? "fermata" : "fermate"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Salita alla fermata */}
                    <View style={styles.tlRow}>
                      <Text
                        style={[
                          styles.tlTimeCol,
                          { color: isDelayed ? "#fb923c" : lineColor },
                        ]}
                      >
                        {displayDepTime}
                      </Text>
                      <View style={styles.tlRailCol}>
                        {walkBeforeMins > 0 ? (
                          <View style={{ height: 1.5 }} />
                        ) : (
                          <View style={styles.tlRailSpacerTop} />
                        )}
                        <View
                          style={[
                            styles.tlTransitDot,
                            {
                              backgroundColor: lineColor,
                              borderColor: `${lineColor}55`,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.tlRailBottomGrow,
                            { backgroundColor: lineColor },
                          ]}
                        />
                      </View>
                      <View style={styles.tlBodyCol}>
                        <Text style={styles.tlTitleText}>
                          {departure.fromStop}
                        </Text>
                      </View>
                    </View>

                    {/* Fermate intermedie lungo la corsa */}
                    {departure.intermediateStopNames?.map((sName, idx) => (
                      <View key={`tl-int-${idx}`} style={styles.tlRow}>
                        <View style={styles.tlTimeEmpty} />
                        <View style={styles.tlRailCol}>
                          <View
                            style={[
                              styles.tlRailTopHalf,
                              { backgroundColor: lineColor },
                            ]}
                          />
                          <View
                            style={[
                              styles.tlIntDot,
                              { borderColor: lineColor },
                            ]}
                          />
                          <View
                            style={[
                              styles.tlRailBottomGrow,
                              { backgroundColor: lineColor },
                            ]}
                          />
                        </View>
                        <View style={styles.tlBodyIntCol}>
                          <Text style={styles.tlIntText}>{sName}</Text>
                        </View>
                      </View>
                    ))}

                    {/* Discesa alla fermata */}
                    <View style={styles.tlRow}>
                      <Text style={[styles.tlTimeCol, { color: lineColor }]}>
                        {alightingTimeDisplay}
                      </Text>
                      <View style={styles.tlRailCol}>
                        <View
                          style={[
                            styles.tlRailTopHalf,
                            { backgroundColor: lineColor },
                          ]}
                        />
                        <View
                          style={[
                            styles.tlTransitDot,
                            {
                              backgroundColor: lineColor,
                              borderColor: `${lineColor}55`,
                            },
                          ]}
                        />
                        <View style={styles.tlRailGrow}>
                          {walkAfterMins > 0 &&
                            renderVerticalDashedRail(effectiveWalkColor, 2)}
                        </View>
                      </View>
                      <View
                        style={[
                          styles.tlBodyCol,
                          { paddingBottom: walkAfterMins > 0 ? 15 : 0 },
                        ]}
                      >
                        <Text style={styles.tlTitleText}>
                          {departure.toStop}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                {/* 3. Camminata finale verso destinazione (senza orario duplicato) + Arrivo */}
                {walkAfterMins > 0 && (
                  <>
                    <View style={styles.tlRow}>
                      <View style={styles.tlTimeEmpty} />
                      <View style={styles.tlRailCol}>
                        <View style={{ height: 1 }} />
                        <View
                          style={[
                            styles.tlWalkNode,
                            {
                              backgroundColor: effectiveWalkColor,
                              borderColor: effectiveWalkTextColor,
                            },
                          ]}
                        >
                          <Ionicons
                            name="walk"
                            size={10}
                            color={effectiveWalkMarkerIcon}
                          />
                        </View>
                        <View style={styles.tlRailGrow}>
                          {renderVerticalDashedRail(effectiveWalkColor, 2)}
                        </View>
                      </View>
                      <View style={[styles.tlBodyCol, { paddingBottom: 15 }]}>
                        <Text
                          style={[
                            styles.tlTitleText,
                            { color: effectiveWalkTextColor },
                          ]}
                        >
                          {walkAfterMins} min a piedi
                        </Text>
                      </View>
                    </View>

                    <View style={styles.tlRow}>
                      <Text
                        style={[
                          styles.tlTimeCol,
                          { color: effectiveArrivalText },
                        ]}
                      >
                        {arrivalTimeDisplay}
                      </Text>
                      <View style={styles.tlRailCol}>
                        <View style={{ height: 2.5 }} />
                        <View
                          style={[
                            styles.tlDestDot,
                            {
                              backgroundColor: effectiveArrivalBg,
                              borderColor: "#ffffff",
                            },
                          ]}
                        >
                          <Ionicons name="flag" size={9} color="#ffffff" />
                        </View>
                      </View>
                      <View style={[styles.tlBodyCol, { paddingBottom: 0 }]}>
                        <Text
                          style={[
                            styles.tlTitleText,
                            { color: effectiveArrivalText },
                          ]}
                        >
                          {departure.finalDestinationName || "Destinazione"}
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* 2. Riquadro/i Colorati Corsa Mezzo: 1 card per ciascun mezzo nelle tratte con cambio, oppure card singola per corsa diretta */}
            {isMultiLeg && multiLegJourney && multiLegJourney.legs.length > 0 ? (
              multiLegJourney.legs.map((legItem, legIdx) => {
                const ml = legItem.route;
                const legColor = ml.color;
                const legIcon = getTransitModeIcon(ml.leg.mode, ml.leg.line);
                const legCrowding = getCrowdingConfig(
                  computeLegCrowdingLevel(
                    ml.leg.mode,
                    legItem.boardTimeStr,
                    departure.crowdingLevel,
                  ),
                );
                const isLegDelayed =
                  legIdx === 0
                    ? isDelayed
                    : Boolean(
                        isLiveContext &&
                          ml.leg.isLive &&
                          (ml.leg.delayMinutes ?? 0) > 1,
                      );
                const legScheduledStr =
                  legIdx === 0
                    ? departure.scheduledTime
                    : ml.leg.scheduledDepartureTime;
                const showLegStrike = Boolean(
                  isLegDelayed &&
                    legScheduledStr &&
                    legItem.boardTimeStr &&
                    legScheduledStr !== legItem.boardTimeStr,
                );
                const legDirection =
                  ml.leg.headsign ||
                  (legIdx === 0 ? departure.headsign : "") ||
                  ml.leg.toStop;

                return (
                  <View
                    key={`vehicle-leg-card-${legIdx}`}
                    style={[
                      styles.heroVehicleStrip,
                      {
                        backgroundColor: `${legColor}18`,
                        borderColor: `${legColor}4D`,
                        borderLeftColor: legColor,
                      },
                    ]}
                  >
                    <View style={styles.heroVehicleHeaderRow}>
                      <View style={styles.heroVehicleHeaderLeft}>
                        <View
                          style={[
                            styles.heroVehicleLinePill,
                            { backgroundColor: legColor },
                          ]}
                        >
                          <Ionicons name={legIcon} size={11} color="#ffffff" />
                          <Text style={styles.heroVehicleLinePillText}>
                            {ml.leg.line}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.heroVehicleLegTag,
                            {
                              backgroundColor: `${legColor}22`,
                              borderColor: `${legColor}55`,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.heroVehicleLegTagText,
                              { color: "#e2e8f0" },
                            ]}
                          >
                            TRATTA {legIdx + 1}/{multiLegJourney.legs.length}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.heroCrowdingBadge,
                            {
                              backgroundColor: legCrowding.bg,
                              borderColor: legCrowding.border,
                            },
                          ]}
                        >
                          <Ionicons
                            name={legCrowding.icon}
                            size={11}
                            color={legCrowding.color}
                          />
                          <Text
                            style={[
                              styles.heroCrowdingBadgeText,
                              { color: legCrowding.color },
                            ]}
                          >
                            {legCrowding.shortLabel}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.heroVehicleTimesRow}>
                      <View style={styles.heroVehicleTimeItem}>
                        <Text style={styles.heroVehicleLabel}>PARTENZA</Text>
                        <View style={styles.heroTimeValueRow}>
                          <Text
                            style={[
                              styles.heroVehicleTimeValue,
                              isLegDelayed && { color: "#fb923c" },
                            ]}
                          >
                            {legItem.boardTimeStr}
                          </Text>
                          {showLegStrike && (
                            <Text style={styles.heroVehicleStrike}>
                              {legScheduledStr}
                            </Text>
                          )}
                        </View>
                      </View>

                      <View style={styles.heroVehicleArrowCol}>
                        <Text
                          style={[
                            styles.heroVehicleArrowDur,
                            { color: legColor },
                          ]}
                        >
                          {legItem.durationMinutes}m
                        </Text>
                        <Ionicons
                          name="arrow-forward"
                          size={13}
                          color={legColor}
                          style={{ marginTop: 1 }}
                        />
                      </View>

                      <View
                        style={[
                          styles.heroVehicleTimeItem,
                          { alignItems: "flex-end" },
                        ]}
                      >
                        <Text style={styles.heroVehicleLabel}>ARRIVO</Text>
                        <Text style={styles.heroVehicleTimeValue}>
                          {legItem.alightTimeStr}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.vehicleDetailsDivider,
                        { backgroundColor: `${legColor}33` },
                      ]}
                    />

                    <View style={styles.vehicleDetailBlock}>
                      <View
                        style={[
                          styles.vehicleDetailIconCircle,
                          { backgroundColor: `${legColor}22` },
                        ]}
                      >
                        <Ionicons
                          name="compass-outline"
                          size={14}
                          color={legColor}
                        />
                      </View>
                      <View style={styles.detailTextCol}>
                        <Text style={styles.detailFieldLabel}>DIREZIONE</Text>
                        <Text style={styles.detailFieldValue}>
                          {legDirection}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.vehicleDetailsDivider,
                        { backgroundColor: `${legColor}22` },
                      ]}
                    />

                    <View style={styles.vehicleDetailBlock}>
                      <View
                        style={[
                          styles.vehicleDetailIconCircle,
                          { backgroundColor: `${legColor}22` },
                        ]}
                      >
                        <Ionicons
                          name="location-outline"
                          size={14}
                          color={legColor}
                        />
                      </View>
                      <View style={styles.detailTextCol}>
                        <Text style={styles.detailFieldLabel}>
                          FERMATA DI PARTENZA
                        </Text>
                        <Text style={styles.detailFieldValue}>
                          {ml.leg.fromStop}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.vehicleDetailsDivider,
                        { backgroundColor: `${legColor}22` },
                      ]}
                    />

                    <View style={styles.vehicleDetailBlock}>
                      <View
                        style={[
                          styles.vehicleDetailIconCircle,
                          { backgroundColor: `${legColor}22` },
                        ]}
                      >
                        <Ionicons name="flag" size={13} color={legColor} />
                      </View>
                      <View style={styles.detailTextCol}>
                        <Text style={styles.detailFieldLabel}>
                          FERMATA DI DISCESA
                        </Text>
                        <Text style={styles.detailFieldValue}>
                          {ml.leg.toStop}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
            <View
              style={[
                styles.heroVehicleStrip,
                {
                  backgroundColor: `${lineColor}18`,
                  borderColor: `${lineColor}4D`,
                  borderLeftColor: lineColor,
                },
              ]}
            >
              <View style={styles.heroVehicleHeaderRow}>
                <View style={styles.heroVehicleHeaderLeft}>
                  <View
                    style={[
                      styles.heroVehicleLinePill,
                      { backgroundColor: lineColor },
                    ]}
                  >
                    <Ionicons name={modeIcon} size={11} color="#ffffff" />
                    <Text style={styles.heroVehicleLinePillText}>
                      {departure.line}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.heroCrowdingBadge,
                      {
                        backgroundColor: crowdingConfig.bg,
                        borderColor: crowdingConfig.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={crowdingConfig.icon}
                      size={11}
                      color={crowdingConfig.color}
                    />
                    <Text
                      style={[
                        styles.heroCrowdingBadgeText,
                        { color: crowdingConfig.color },
                      ]}
                    >
                      {crowdingConfig.shortLabel}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.heroVehicleTimesRow}>
                <View style={styles.heroVehicleTimeItem}>
                  <Text style={styles.heroVehicleLabel}>PARTENZA</Text>
                  <View style={styles.heroTimeValueRow}>
                    <Text
                      style={[
                        styles.heroVehicleTimeValue,
                        isDelayed && { color: "#fb923c" },
                      ]}
                    >
                      {displayDepTime}
                    </Text>
                    {showScheduledStrike && (
                      <Text style={styles.heroVehicleStrike}>
                        {departure.scheduledTime}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.heroVehicleArrowCol}>
                  <Text
                    style={[styles.heroVehicleArrowDur, { color: lineColor }]}
                  >
                    {inVehicleMins}m
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={13}
                    color={lineColor}
                    style={{ marginTop: 1 }}
                  />
                </View>

                <View
                  style={[
                    styles.heroVehicleTimeItem,
                    { alignItems: "flex-end" },
                  ]}
                >
                  <Text style={styles.heroVehicleLabel}>ARRIVO</Text>
                  <Text style={styles.heroVehicleTimeValue}>
                    {alightingTimeDisplay}
                  </Text>
                </View>
              </View>

              {/* Dettagli della corsa integrati direttamente nel riquadro Corsa Mezzo */}
              <View
                style={[
                  styles.vehicleDetailsDivider,
                  { backgroundColor: `${lineColor}33` },
                ]}
              />

              <View style={styles.vehicleDetailBlock}>
                <View
                  style={[
                    styles.vehicleDetailIconCircle,
                    { backgroundColor: `${lineColor}22` },
                  ]}
                >
                  <Ionicons
                    name="compass-outline"
                    size={14}
                    color={lineColor}
                  />
                </View>
                <View style={styles.detailTextCol}>
                  <Text style={styles.detailFieldLabel}>DIREZIONE</Text>
                  <Text style={styles.detailFieldValue}>
                    {departure.headsign}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.vehicleDetailsDivider,
                  { backgroundColor: `${lineColor}22` },
                ]}
              />

              <View style={styles.vehicleDetailBlock}>
                <View
                  style={[
                    styles.vehicleDetailIconCircle,
                    { backgroundColor: `${lineColor}22` },
                  ]}
                >
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={lineColor}
                  />
                </View>
                <View style={styles.detailTextCol}>
                  <Text style={styles.detailFieldLabel}>
                    FERMATA DI PARTENZA
                  </Text>
                  <Text style={styles.detailFieldValue}>
                    {departure.fromStop}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.vehicleDetailsDivider,
                  { backgroundColor: `${lineColor}22` },
                ]}
              />

              <View style={styles.vehicleDetailBlock}>
                <View
                  style={[
                    styles.vehicleDetailIconCircle,
                    { backgroundColor: `${lineColor}22` },
                  ]}
                >
                  <Ionicons name="flag" size={13} color={lineColor} />
                </View>
                <View style={styles.detailTextCol}>
                  <Text style={styles.detailFieldLabel}>
                    FERMATA DI DISCESA
                  </Text>
                  <Text style={styles.detailFieldValue}>
                    {departure.toStop}
                  </Text>
                </View>
              </View>
            </View>
            )}
          </View>
        </View>

        {/* ── Mappa Interattiva del Percorso (Mezzo a linea continua + Tratto a piedi a pallini) ── */}
        <View style={styles.mapSection}>
          <View style={styles.mapSectionHeader}>
            <Text style={[styles.sectionHeaderLabel, { marginBottom: 0 }]}>
              Mappa percorso
            </Text>
          </View>

          <View style={styles.mapCard}>
            {!isWeb ? (
              <MapView
                key={`transit-route-map-${departure.id}-${fromCoords.lat.toFixed(4)}-${toCoords.lat.toFixed(4)}`}
                style={styles.mapView}
                initialRegion={mapRegion}
                onRegionChangeComplete={(r) => {
                  const nextBucket = getZoomBucket(r.latitudeDelta);
                  setZoomBucket((prev) => (prev === nextBucket ? prev : nextBucket));
                }}
                scrollEnabled={true}
                zoomEnabled={true}
                pitchEnabled={false}
                rotateEnabled={false}
                showsUserLocation={true}
                userInterfaceStyle="dark"
              >
                {/* Tratto a piedi iniziale (blu ad alto contrasto tratteggiato) */}
                {walkBeforeRouteCoords.length >= 2 && (
                  <>
                    <Polyline
                      coordinates={walkBeforeRouteCoords}
                      strokeColor={effectiveWalkColor}
                      strokeWidth={walkingStrokeProps.strokeWidth}
                      lineCap="round"
                      lineJoin="round"
                      lineDashPattern={walkingStrokeProps.lineDashPattern}
                    />
                    <Marker
                      coordinate={walkBeforeRouteCoords[0]}
                      title="Punto di partenza"
                      description={`${walkBeforeMins} min a piedi fino alla fermata ${departure.fromStop}`}
                      tracksViewChanges={false}
                    >
                      <View style={styles.markerWrapper}>
                        <View
                          style={[
                            styles.markerHalo,
                            { backgroundColor: effectiveWalkHalo },
                          ]}
                        />
                        <View
                          style={[
                            styles.markerPin,
                            {
                              backgroundColor: effectiveWalkColor,
                              borderColor: "#0f172a",
                            },
                          ]}
                        >
                          <Ionicons
                            name="walk"
                            size={9}
                            color={effectiveWalkMarkerIcon}
                          />
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
                      const legPolyline =
                        ml.polyline.length >= 2
                          ? ml.polyline
                          : [
                              {
                                latitude: (ml.leg.fromStopCoords || fromCoords)
                                  .lat,
                                longitude: (ml.leg.fromStopCoords || fromCoords)
                                  .lng,
                              },
                              {
                                latitude: (ml.leg.toStopCoords || toCoords).lat,
                                longitude: (ml.leg.toStopCoords || toCoords)
                                  .lng,
                              },
                            ];
                      const legSnapFrom =
                        legPolyline[0] ||
                        snapCoordinateToPolyline(
                          ml.leg.fromStopCoords || fromCoords,
                          legPolyline,
                        );
                      const legSnapTo =
                        legPolyline[legPolyline.length - 1] ||
                        snapCoordinateToPolyline(
                          ml.leg.toStopCoords || toCoords,
                          legPolyline,
                        );

                      const legModel = multiLegJourney?.legs[mlIdx];
                      const curTransfer = !isLast
                        ? multiLegJourney?.transfers[mlIdx]
                        : null;
                      const prevTransfer =
                        mlIdx > 0 ? multiLegJourney?.transfers[mlIdx - 1] : null;
                      const showSeparateBoardingPin =
                        isFirst || Boolean(prevTransfer?.needsWalk);

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

                          {/* Marker di salita della tratta (omesso se la salita coincide con la fermata di discesa precedente) */}
                          {showSeparateBoardingPin && (
                            <Marker
                              coordinate={{
                                latitude: legSnapFrom.latitude,
                                longitude: legSnapFrom.longitude,
                              }}
                              title={
                                isFirst
                                  ? `Salita: ${ml.leg.fromStop}`
                                  : `Cambio: prendi ${ml.leg.line} a ${ml.leg.fromStop}`
                              }
                              description={
                                isFirst
                                  ? `Linea ${ml.leg.line} (${legModel?.boardTimeStr || displayDepTime}) • Dir. ${ml.leg.headsign || departure.headsign}`
                                  : `Linea ${ml.leg.line} (${legModel?.boardTimeStr || ""}) • Dir. ${ml.leg.headsign || ml.leg.toStop}`
                              }
                              tracksViewChanges={false}
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
                                    name={
                                      ml.leg.mode === "metro"
                                        ? "subway"
                                        : isFirst
                                          ? "bus"
                                          : "swap-horizontal"
                                    }
                                    size={9}
                                    color="#ffffff"
                                  />
                                </View>
                              </View>
                            </Marker>
                          )}

                          {/* Se non è l'ultima tratta, marker di discesa / cambio */}
                          {!isLast && (
                            <Marker
                              coordinate={{
                                latitude: legSnapTo.latitude,
                                longitude: legSnapTo.longitude,
                              }}
                              title={
                                curTransfer?.needsWalk
                                  ? `Discesa per cambio: ${ml.leg.toStop}`
                                  : `Cambio alla fermata: ${ml.leg.toStop}`
                              }
                              description={
                                curTransfer?.needsWalk
                                  ? `Scendi da ${ml.leg.line} e raggiungi a piedi ${multiLegRoutes[mlIdx + 1]?.leg.fromStop || "fermata successiva"}`
                                  : `Scendi da ${ml.leg.line} • ${curTransfer && curTransfer.waitMins > 0 ? `Attendi ${curTransfer.waitMins} min per` : "Prendi"} ${multiLegRoutes[mlIdx + 1]?.leg.line || "mezzo successivo"}`
                              }
                              tracksViewChanges={false}
                            >
                              <View style={styles.markerWrapper}>
                                <View
                                  style={[
                                    styles.markerHalo,
                                    { backgroundColor: `${ml.color}40` },
                                  ]}
                                />
                                <View
                                  style={[
                                    styles.markerPin,
                                    { backgroundColor: ml.color },
                                  ]}
                                >
                                  <Ionicons
                                    name={
                                      curTransfer?.needsWalk
                                        ? "git-branch"
                                        : "swap-horizontal"
                                    }
                                    size={9}
                                    color="#ffffff"
                                  />
                                </View>
                              </View>
                            </Marker>
                          )}

                          {/* Se è l'ultima tratta, bandierina di discesa agganciata col colore del mezzo */}
                          {isLast && (
                            <Marker
                              coordinate={{
                                latitude: legSnapTo.latitude,
                                longitude: legSnapTo.longitude,
                              }}
                              title={`Fermata di discesa finale: ${ml.leg.toStop}`}
                              description={`Arrivo mezzo ore ${alightingTimeDisplay}`}
                              tracksViewChanges={false}
                            >
                              <View style={styles.discesaFlagWrapper}>
                                <View
                                  style={[
                                    styles.discesaFlagHalo,
                                    { backgroundColor: `${ml.color}40` },
                                  ]}
                                />
                                <View
                                  style={[
                                    styles.discesaFlagPin,
                                    { backgroundColor: ml.color },
                                  ]}
                                >
                                  <Ionicons
                                    name="flag"
                                    size={8.5}
                                    color="#ffffff"
                                  />
                                </View>
                              </View>
                            </Marker>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Tratti a piedi di interscambio tra mezzi con fermate distinte (colore dedicato distinto dal pedonale standard) */}
                    {transferWalks.map((twCoords, twIdx) => {
                      if (twCoords.length < 2) return null;
                      return (
                        <Polyline
                          key={`transfer-walk-${twIdx}`}
                          coordinates={twCoords}
                          strokeColor={effectiveTransferWalk.stroke}
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
                    {snappedIntermediateStops.map(({ name, snapped }, idx) => (
                      <Marker
                        key={`map-int-stop-${idx}`}
                        coordinate={{
                          latitude: snapped.latitude,
                          longitude: snapped.longitude,
                        }}
                        title={name}
                        description={`Fermata intermedia (${departure.line})`}
                        anchor={{ x: 0.5, y: 0.5 }}
                        tracksViewChanges={false}
                      >
                        <View
                          style={[
                            styles.intermediateMapDot,
                            { borderColor: lineColor },
                          ]}
                        />
                      </Marker>
                    ))}

                    {/* Marker Fermata di Salita (agganciato alla linea) */}
                    <Marker
                      coordinate={{
                        latitude: snappedFrom.latitude,
                        longitude: snappedFrom.longitude,
                      }}
                      title={`Salita: ${departure.fromStop}`}
                      description={`Linea ${departure.line} (${displayDepTime}) • Dir. ${departure.headsign}`}
                      tracksViewChanges={false}
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
                            name={isMetro ? "subway" : "bus"}
                            size={9}
                            color="#ffffff"
                          />
                        </View>
                      </View>
                    </Marker>

                    {/* Marker Fermata di Discesa (bandierina agganciata alla linea con il colore del mezzo) */}
                    <Marker
                      coordinate={{
                        latitude: snappedTo.latitude,
                        longitude: snappedTo.longitude,
                      }}
                      title={`Dove scendi: ${departure.toStop}`}
                      description={`Arrivo mezzo ore ${alightingTimeDisplay}`}
                      tracksViewChanges={false}
                    >
                      <View style={styles.discesaFlagWrapper}>
                        <View
                          style={[
                            styles.discesaFlagHalo,
                            { backgroundColor: `${lineColor}40` },
                          ]}
                        />
                        <View
                          style={[
                            styles.discesaFlagPin,
                            { backgroundColor: lineColor },
                          ]}
                        >
                          <Ionicons name="flag" size={8.5} color="#ffffff" />
                        </View>
                      </View>
                    </Marker>
                  </>
                )}

                {/* Tratto a piedi dalla fermata di discesa alla destinazione finale (blu ad alto contrasto tratteggiato) */}
                {walkAfterRouteCoords.length >= 2 && (
                  <Polyline
                    coordinates={walkAfterRouteCoords}
                    strokeColor={effectiveWalkColor}
                    strokeWidth={walkingStrokeProps.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    lineDashPattern={walkingStrokeProps.lineDashPattern}
                  />
                )}

                {/* Marker Destinazione Finale (Aula / Stazione) con colore dedicato all'arrivo */}
                {walkAfterRouteCoords.length >= 2 && (
                  <Marker
                    coordinate={{
                      latitude: finalCoords.lat,
                      longitude: finalCoords.lng,
                    }}
                    title={departure.finalDestinationName || "Destinazione"}
                    description={`${walkAfterMins} min a piedi da ${departure.toStop} (arrivo ${arrivalTimeDisplay})`}
                    tracksViewChanges={false}
                  >
                    <View style={styles.markerWrapper}>
                      <View
                        style={[
                          styles.markerHalo,
                          { backgroundColor: effectiveArrivalHalo },
                        ]}
                      />
                      <View
                        style={[
                          styles.markerPin,
                          {
                            backgroundColor: effectiveArrivalBg,
                            borderColor: "#ffffff",
                          },
                        ]}
                      >
                        <Ionicons name="flag" size={9} color="#ffffff" />
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

            {/* Menu nativo flottante Liquid Glass dentro la mappa per aprire in Apple Mappe / Google Maps */}
            <View style={styles.mapGlassFloatingAnchor}>
              {isNativeIosGlass && CallstackLiquidGlass?.LiquidGlassView ? (
                <CallstackLiquidGlass.LiquidGlassView
                  effect="regular"
                  interactive={true}
                  colorScheme="dark"
                  tintColor="rgba(255, 255, 255, 0.14)"
                  style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
                  pointerEvents="none"
                />
              ) : Platform.OS === "ios" ? (
                <BlurView
                  intensity={42}
                  tint="dark"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 999,
                      overflow: "hidden",
                      backgroundColor: "rgba(15, 23, 42, 0.65)",
                      borderWidth: 1,
                      borderColor: "rgba(255, 255, 255, 0.18)",
                    },
                  ]}
                  pointerEvents="none"
                />
              ) : (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 999,
                      backgroundColor: "rgba(15, 23, 42, 0.86)",
                      borderWidth: 1,
                      borderColor: "rgba(255, 255, 255, 0.18)",
                    },
                  ]}
                  pointerEvents="none"
                />
              )}

              {isNativeMenuAvailable ? (
                <MenuView
                  title="Apri percorso in"
                  actions={mapNavMenuActions}
                  shouldOpenOnLongPress={false}
                  onPressAction={({ nativeEvent }) => {
                    const provider =
                      nativeEvent.event === "google" ? "google" : "apple";
                    handleOpenStopNavigation(provider, "from_stop");
                  }}
                >
                  <View style={styles.mapGlassPillContent}>
                    <Ionicons name="navigate" size={12} color="#ffffff" />
                    <Text style={styles.mapGlassPillText}>Apri in</Text>
                    <Ionicons
                      name="chevron-down"
                      size={11}
                      color="rgba(255, 255, 255, 0.82)"
                    />
                  </View>
                </MenuView>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={handleOpenMapAppSheet}
                  style={styles.mapGlassPillContent}
                >
                  <Ionicons name="navigate" size={12} color="#ffffff" />
                  <Text style={styles.mapGlassPillText}>Apri in</Text>
                  <Ionicons
                    name="chevron-down"
                    size={11}
                    color="rgba(255, 255, 255, 0.82)"
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Legenda Mappa: A piedi unificato (senza durata) + eventuale Cambio a piedi in colore dedicato + Tratte mezzi */}
          <View style={styles.mapLegendRow}>
            {hasStandardWalk && (
              <View style={styles.mapLegendItem}>
                <View style={styles.legendDotsRow}>
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveWalkColor },
                    ]}
                  />
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveWalkColor },
                    ]}
                  />
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveWalkColor },
                    ]}
                  />
                </View>
                <Text style={styles.mapLegendText}>A piedi</Text>
              </View>
            )}

            {hasAnyTransferWalk && (
              <View style={styles.mapLegendItem}>
                <View style={styles.legendDotsRow}>
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveTransferWalk.stroke },
                    ]}
                  />
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveTransferWalk.stroke },
                    ]}
                  />
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: effectiveTransferWalk.stroke },
                    ]}
                  />
                </View>
                <Text style={styles.mapLegendText}>Cambio a piedi</Text>
              </View>
            )}

            {isMultiLeg && multiLegJourney ? (
              multiLegJourney.legs.map((legItem, mlIdx) => (
                <View key={`legend-leg-${mlIdx}`} style={styles.mapLegendItem}>
                  <View
                    style={[
                      styles.legendSolidBar,
                      { backgroundColor: legItem.route.color },
                    ]}
                  />
                  <Text style={styles.mapLegendText}>
                    Tratta {legItem.route.leg.line} ({legItem.durationMinutes}{" "}
                    min)
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.mapLegendItem}>
                <View
                  style={[
                    styles.legendSolidBar,
                    { backgroundColor: lineColor },
                  ]}
                />
                <Text style={styles.mapLegendText}>
                  Tragitto {departure.line} ({inVehicleMins} min)
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Deviazioni e Avvisi sulla Linea ── */}
        {activeAlerts.length > 0 ? (
          (() => {
            const isDevExpanded = Boolean(expandedDevByDepId[departure.id]);
            const toggleDeviazioni = () =>
              setExpandedDevByDepId((prev) => ({
                ...prev,
                [departure.id]: !prev[departure.id],
              }));

            if (!isDevExpanded) {
              return (
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={toggleDeviazioni}
                  style={styles.deviazioneCollapsedBtn}
                >
                  <View style={styles.deviazioneCollapsedLeft}>
                    <Ionicons name="warning" size={14} color="#f59e0b" />
                    <Text style={styles.deviazioneCollapsedText}>
                      Deviazione attiva
                    </Text>
                    {activeAlerts.length > 1 && (
                      <View style={styles.deviazioneCountPill}>
                        <Text style={styles.deviazioneCountText}>
                          {activeAlerts.length}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Ionicons name="chevron-down" size={15} color="#fbbf24" />
                </TouchableOpacity>
              );
            }

            return (
              <View style={styles.deviazioniExpandedCard}>
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={toggleDeviazioni}
                  style={styles.deviazioniHeaderRow}
                >
                  <View style={styles.deviazioneCollapsedLeft}>
                    <Ionicons name="warning" size={14} color="#f59e0b" />
                    <Text style={styles.deviazioniHeaderTitle}>
                      DEVIAZIONI ATTUALI
                    </Text>
                  </View>
                  <Ionicons name="chevron-up" size={15} color="#fbbf24" />
                </TouchableOpacity>

                <View style={styles.deviazioniListWrap}>
                  {activeAlerts.map((alertText, idx) => (
                    <View
                      key={`deviazione-att-${idx}`}
                      style={[
                        styles.deviazioniItemRow,
                        idx > 0 && styles.deviazioniItemDivider,
                      ]}
                    >
                      <Text style={styles.deviazioniItemText}>{alertText}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()
        ) : (
          <View style={styles.alertRegularCompactRow}>
            <Ionicons
              name="checkmark-circle"
              size={14}
              color="#10b981"
              style={{ marginRight: 7 }}
            />
            <Text
              style={styles.alertRegularCompactText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Percorso regolare • Nessuna deviazione{" "}
              {isMultiLeg
                ? `sulle linee ${departure.line}`
                : `per la linea ${departure.line}`}
            </Text>
          </View>
        )}
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
    color: "#94a3b8",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  recommendedSection: {
    backgroundColor: "#161922",
    borderRadius: CARD_RADIUS.card,
    padding: 12,
    borderWidth: 1,
    borderColor: "#262b38",
  },
  recommendedChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  recLineChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  recLineChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  heroCard: {
    backgroundColor: "#161922",
    borderRadius: CARD_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: "#262b38",
  },
  heroTransferBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(168, 85, 247, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.35)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    marginTop: 4,
    marginBottom: 8,
  },
  heroTransferBannerText: {
    color: "#c084fc",
    fontSize: 11.5,
    fontWeight: "700",
  },
  heroStatusPill: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "700",
  },
  heroScheduleStack: {
    gap: 10,
  },
  heroJourneyCard: {
    backgroundColor: "#0e1017",
    borderRadius: CARD_RADIUS.cardInner,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#1e2330",
  },
  heroJourneyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  heroScheduleTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heroScheduleTagText: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.45,
  },
  heroMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  heroMetaPillText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  heroTimesGrid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroUserTimeValue: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroUserSpanText: {
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "700",
  },
  heroSegmentBarTrack: {
    flexDirection: "row",
    alignItems: "center",
    height: 4.5,
    borderRadius: 2.25,
    overflow: "hidden",
    gap: 1.5,
    marginTop: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  heroSegmentSlice: {
    height: "100%",
    borderRadius: 2.25,
  },
  integratedTimelineWrap: {
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#1e2330",
  },
  tlRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  tlLegHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  tlTimeCol: {
    width: 44,
    fontSize: 11.5,
    fontWeight: "800",
    paddingTop: 1,
    fontVariant: ["tabular-nums"],
  },
  tlTimeEmpty: {
    width: 44,
  },
  tlRailCol: {
    width: 22,
    alignItems: "center",
    marginRight: 6,
  },
  tlRailSpacerTop: {
    height: 3,
  },
  tlRailTopHalf: {
    width: 2.5,
    height: 5,
  },
  tlRailBottomGrow: {
    width: 2.5,
    flex: 1,
    minHeight: 12,
  },
  tlLegBadgeGroup: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 5,
    flex: 1,
  },
  tlRailGrow: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  tlWalkNode: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: WALK_BLUE_PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: WALK_BLUE_TEXT_PRIMARY,
  },
  tlTransitDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
  },
  tlIntDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#0e1017",
    borderWidth: 2,
  },
  tlDestDot: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: ARRIVAL_GREEN_BG,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  tlBodyCol: {
    flex: 1,
    paddingBottom: 10,
  },
  tlBodyIntCol: {
    flex: 1,
    paddingBottom: 6,
  },
  tlTitleText: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "700",
    lineHeight: 17,
  },
  tlSubText: {
    color: "#94a3b8",
    fontSize: 10.5,
    marginTop: 1,
  },
  tlIntText: {
    color: "#cbd5e1",
    fontSize: 11.5,
    lineHeight: 16,
  },
  vehicleDetailsDivider: {
    height: 1,
    marginVertical: 8,
  },
  vehicleDetailBlock: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  vehicleDetailIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  heroVehicleStrip: {
    borderRadius: CARD_RADIUS.cardInner,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderLeftWidth: 3.5,
  },
  heroVehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  heroVehicleHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  heroVehicleLinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  heroVehicleLinePillText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  heroVehicleLegTag: {
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  heroVehicleLegTagText: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.35,
  },
  heroCrowdingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  heroCrowdingBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  heroVehicleTimesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heroVehicleArrowCol: {
    alignItems: "center",
    paddingHorizontal: 8,
  },
  heroVehicleArrowDur: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  heroVehicleTimeItem: {
    flex: 1,
  },
  heroVehicleLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  heroVehicleTimeValue: {
    color: "#cbd5e1",
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  heroVehicleStrike: {
    color: "#64748b",
    fontSize: 10.5,
    fontWeight: "600",
    textDecorationLine: "line-through",
  },
  heroTimeBox: {
    flex: 1,
  },
  heroTimeLabel: {
    color: "#64748b",
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  heroTimeValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  heroTimeArrowCol: {
    alignItems: "center",
    paddingHorizontal: 10,
  },
  mapSection: {
    backgroundColor: "#161922",
    borderRadius: CARD_RADIUS.card,
    padding: 14,
    borderWidth: 1,
    borderColor: "#262b38",
  },
  mapSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  mapGlassFloatingAnchor: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 20,
    borderRadius: 999,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  mapGlassPillContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  mapGlassPillText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  mapCard: {
    height: 260,
    borderRadius: CARD_RADIUS.cardInner,
    overflow: "hidden",
    backgroundColor: "#0e1017",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    position: "relative",
    marginBottom: 10,
  },
  mapView: {
    ...StyleSheet.absoluteFill,
  },
  mapWebFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  mapWebFallbackText: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  intermediateMapDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#ffffff",
    borderWidth: 1,
  },
  mapLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 14,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  mapLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendSolidBar: {
    width: 18,
    height: 4,
    borderRadius: 2,
  },
  legendDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  legendDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#1d4ed8",
  },
  mapLegendText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600",
  },
  discesaFlagWrapper: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  discesaFlagHalo: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(168, 85, 247, 0.25)",
  },
  discesaFlagPin: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8b5cf6",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  markerWrapper: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  markerHalo: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  markerPin: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  detailTextCol: {
    flex: 1,
  },
  detailFieldLabel: {
    color: "#64748b",
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailFieldValue: {
    color: "#f8fafc",
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 19,
  },
  unifiedLegBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  unifiedLegBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  deviazioneCollapsedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  deviazioneCollapsedLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  deviazioneCollapsedText: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "700",
  },
  deviazioneCountPill: {
    backgroundColor: "rgba(245, 158, 11, 0.25)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  deviazioneCountText: {
    color: "#fbbf24",
    fontSize: 10.5,
    fontWeight: "800",
  },
  deviazioniExpandedCard: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: CARD_RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  deviazioniHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  deviazioniHeaderTitle: {
    color: "#f59e0b",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  deviazioniListWrap: {
    gap: 8,
  },
  deviazioniItemRow: {
    paddingTop: 2,
  },
  deviazioniItemDivider: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(245, 158, 11, 0.2)",
  },
  deviazioniItemText: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  alertRegularCompactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  alertRegularCompactText: {
    flex: 1,
    color: "#94a3b8",
    fontSize: 11.5,
    fontWeight: "500",
  },
});
