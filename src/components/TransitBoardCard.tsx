import { AppTheme, CARD_RADIUS } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  clearRecentTransitDepartures,
  findMatchingDepartureInBoard,
  getLineBadgeColor,
  getRecentTransitDepartures,
  getStationTransitBoard,
  getTransitModeIcon,
  minsToHHMM,
  parseHHMMToMins,
  RecentTransitEntry,
  recordRecentTransitDeparture,
  TransitBoardResult,
  TransitDepartureItem,
} from "../utils/transitBoardService";
import { TransitDepartureModal } from "./TransitDepartureModal";

export interface OptimalTransitTimingUpdate {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  walkBeforeMinutes?: number;
  inVehicleMinutes?: number;
  walkAfterMinutes?: number;
  busDepartureTime?: string;
  busAlightingTime?: string;
  coincidenceAvailableFromTime?: string;
  firstAvailableDepartureTime?: string;
  line: string;
  directLines?: string[];
  lastUsefulDeparture?: TransitDepartureItem;
  isLiveContext?: boolean;
}

function getDepartureTransitSpanMinutes(dep: TransitDepartureItem): number {
  if (dep.legs && dep.legs.length > 1) {
    const firstDepM = parseHHMMToMins(
      dep.legs[0]?.departureTime || dep.estimatedTime || dep.scheduledTime,
    );
    const lastArrM = parseHHMMToMins(
      dep.legs[dep.legs.length - 1]?.arrivalTime || dep.alightingTime,
    );
    if (firstDepM >= 0 && lastArrM >= 0) {
      let diff = lastArrM - firstDepM;
      if (diff < -720) diff += 1440;
      if (diff > 0 && diff < 360) return diff;
    }
  }
  return typeof dep.inVehicleMinutes === "number" && dep.inVehicleMinutes > 0
    ? dep.inVehicleMinutes
    : Math.max(1, dep.durationMinutes - (dep.walkAfterMinutes || 0));
}

function toOptimalTimingUpdate(
  board: TransitBoardResult,
  useLive: boolean,
  visibleLines?: string[],
  minDepartureTime?: string,
  visibleDepartures?: TransitDepartureItem[],
): OptimalTransitTimingUpdate | null {
  const opt = board.optimalDeparture || board.departures[0];
  if (!opt) return null;
  const busDepTime = opt.estimatedTime || opt.scheduledTime;
  const walkBefore = Math.max(0, opt.walkBeforeMinutes || 0);
  const walkAfter = Math.max(0, opt.walkAfterMinutes || 0);
  const inVehicle =
    typeof opt.inVehicleMinutes === "number" && opt.inVehicleMinutes > 0
      ? opt.inVehicleMinutes
      : Math.max(1, opt.durationMinutes - walkAfter);
  const busDepMins = parseHHMMToMins(busDepTime);
  const userStartTime =
    busDepMins >= 0 && walkBefore > 0
      ? minsToHHMM(busDepMins - walkBefore)
      : busDepTime;
  const busAlightTime =
    busDepMins >= 0
      ? minsToHHMM(busDepMins + inVehicle)
      : opt.alightingTime || opt.arrivalTime;
  const totalDoorToDoor =
    typeof opt.totalDoorToDoorMinutes === "number" &&
    opt.totalDoorToDoorMinutes > 0
      ? opt.totalDoorToDoorMinutes
      : walkBefore + inVehicle + walkAfter;

  const listForFirst =
    visibleDepartures && visibleDepartures.length > 0
      ? visibleDepartures
      : board.departures;
  let earliestBusMins = busDepMins >= 0 ? busDepMins : Infinity;
  let earliestUserLeaveMins =
    busDepMins >= 0 ? Math.max(0, busDepMins - walkBefore) : Infinity;
  let firstAvailDepStr = busDepTime;

  for (const dep of listForFirst) {
    const dStr = dep.estimatedTime || dep.scheduledTime;
    const dM = parseHHMMToMins(dStr);
    if (dM < 0) continue;
    const dWalkBefore = Math.max(0, dep.walkBeforeMinutes || 0);
    const dLeaveM = Math.max(0, dM - dWalkBefore);
    if (dM < earliestBusMins) {
      earliestBusMins = dM;
      firstAvailDepStr = dStr;
    }
    if (dLeaveM < earliestUserLeaveMins) {
      earliestUserLeaveMins = dLeaveM;
    }
  }

  const minDepAnchorMins = minDepartureTime
    ? parseHHMMToMins(minDepartureTime)
    : -1;
  const windowAnchorMins =
    minDepAnchorMins >= 0
      ? Math.min(
          minDepAnchorMins,
          Number.isFinite(earliestUserLeaveMins)
            ? earliestUserLeaveMins
            : minDepAnchorMins,
        )
      : Number.isFinite(earliestUserLeaveMins)
        ? earliestUserLeaveMins
        : busDepMins;
  const coincidenceAvailableFromTime =
    windowAnchorMins >= 0 ? minsToHHMM(windowAnchorMins) : userStartTime;

  return {
    startTime: userStartTime,
    endTime: opt.arrivalTime,
    durationMinutes: totalDoorToDoor,
    walkBeforeMinutes: walkBefore,
    inVehicleMinutes: inVehicle,
    walkAfterMinutes: walkAfter,
    busDepartureTime: busDepTime,
    busAlightingTime: busAlightTime,
    coincidenceAvailableFromTime,
    firstAvailableDepartureTime: firstAvailDepStr,
    line: opt.line,
    directLines:
      visibleLines && visibleLines.length > 0
        ? visibleLines
        : board.directLines,
    lastUsefulDeparture: board.lastUsefulDeparture,
    isLiveContext: useLive,
  };
}

function getHalfHourDepartures(
  departures: TransitDepartureItem[],
): TransitDepartureItem[] {
  if (departures.length === 0) return [];
  const firstDep = departures[0];
  const baseMins = parseHHMMToMins(
    firstDep.estimatedTime || firstDep.scheduledTime,
  );
  if (baseMins < 0) return departures.slice(0, 5);

  return departures.filter((d) => {
    const dMins = parseHHMMToMins(d.estimatedTime || d.scheduledTime);
    if (dMins < 0) return true;
    let diff = dMins - baseMins;
    if (diff < -720) diff += 1440;
    return diff >= 0 && diff <= 30;
  });
}

function sliceDeparturesByLevel(
  departures: TransitDepartureItem[],
  halfHourList: TransitDepartureItem[],
  level: ExpansionLevel,
  direction: "to_campus" | "to_station",
  hasLineFilter: boolean,
  boardData: TransitBoardResult | null,
  hasMinDepartureConstraint: boolean,
): TransitDepartureItem[] {
  if (departures.length <= 3) return departures;
  if (level === "full") return departures;
  if (level === "half_hour") {
    const count = Math.max(3, halfHourList.length);
    return departures.slice(0, count);
  }
  // In andata o nel ritorno standard (a partire dalla fine lezione):
  // mostra le prime 3 corse a partire da quel momento, aggiungendo la corsa consigliata se è oltre la 3ª.
  if (direction === "to_campus" || hasMinDepartureConstraint) {
    const top3 = departures.slice(0, 3);
    if (
      !hasLineFilter &&
      boardData?.optimalDeparture &&
      !top3.some((d) => d.id === boardData.optimalDeparture?.id)
    ) {
      const opt = departures.find(
        (d) => d.id === boardData.optimalDeparture?.id,
      );
      if (opt) return [...top3, opt];
    }
    return top3;
  }
  if (!hasLineFilter && boardData) {
    const optIdx = boardData.optimalIndex ?? 0;
    const startIdx = Math.max(0, Math.min(optIdx - 1, departures.length - 3));
    return departures.slice(startIdx, startIdx + 3);
  }
  return departures.slice(0, 3);
}

interface TransitBoardCardProps {
  stationName: string;
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  targetName?: string;
  targetDate?: string;
  targetTime?: string;
  direction?: "to_campus" | "to_station";
  theme: AppTheme;
  isToday?: boolean;
  /** Etichetta del giorno attualmente selezionato nel selettore orizzontale (es. "LUN", "GIO") */
  selectedDayLabel?: string;
  /** True solo quando l'architettura delle lezioni e dei treni è in modalità live attiva */
  isLiveContext?: boolean;
  /** Vincolo orario di arrivo a destinazione (partenza treno per ritorno, inizio lezione per andata) */
  constraintTime?: string;
  /** Orario minimo di salita sul mezzo (arrivo del treno in stazione per l'andata) */
  minDepartureTime?: string;
  /** Anticipo richiesto a destinazione prima del vincolo (anticipo in aula o buffer stazione) */
  arrivalBufferMinutes?: number;
  /** In uscita anticipata durante la lezione, calibra a ritroso dal treno per perdere meno minuti possibile */
  preferLatestBeforeDeadline?: boolean;
  /** Timestamp sincronizzato con il ciclo di refresh ogni 60s della sezione treni */
  refreshTimestamp?: number;
  /** Tabellone già risolto dal commuterOptimizer per azzerare la doppia chiamata iniziale */
  prefetchedBoard?: TransitBoardResult;
  /** Callback per aggiornare dinamicamente l'orario e la durata sulla card esterna della tappa */
  onOptimalDepartureResolved?: (update: OptimalTransitTimingUpdate) => void;
}

export type ExpansionLevel = "collapsed" | "half_hour" | "full";

// In-memory cache LRU con TTL per cambi istantanei (0ms) tra andata/ritorno e lezioni target
const MAX_TRANSIT_CARD_CACHE_ENTRIES = 20;
const transitBoardMemoryCache = new Map<
  string,
  { data: TransitBoardResult; ts: number }
>();

function getTransitCardMemoryCache(
  key: string,
  isLive: boolean,
): TransitBoardResult | null {
  const entry = transitBoardMemoryCache.get(key);
  if (!entry) return null;
  const ttl = isLive ? 45_000 : 600_000;
  if (Date.now() - entry.ts >= ttl) {
    transitBoardMemoryCache.delete(key);
    return null;
  }
  // Aggiorna ordine LRU
  transitBoardMemoryCache.delete(key);
  transitBoardMemoryCache.set(key, entry);
  return entry.data;
}

function setTransitCardMemoryCache(
  key: string,
  data: TransitBoardResult,
): void {
  if (transitBoardMemoryCache.has(key)) {
    transitBoardMemoryCache.delete(key);
  }
  transitBoardMemoryCache.set(key, { data, ts: Date.now() });
  while (transitBoardMemoryCache.size > MAX_TRANSIT_CARD_CACHE_ENTRIES) {
    const oldestKey = transitBoardMemoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    transitBoardMemoryCache.delete(oldestKey);
  }
}

export const TransitBoardCard: React.FC<TransitBoardCardProps> = ({
  stationName,
  stationCoords,
  targetCoords,
  targetName,
  targetDate,
  targetTime,
  direction = "to_campus",
  theme,
  isToday = true,
  selectedDayLabel,
  isLiveContext = false,
  constraintTime,
  minDepartureTime,
  arrivalBufferMinutes,
  preferLatestBeforeDeadline = false,
  refreshTimestamp,
  prefetchedBoard,
  onOptimalDepartureResolved,
}) => {
  const isFocused = useIsFocused();
  const effectiveArrivalBuffer = Math.max(
    0,
    typeof arrivalBufferMinutes === "number"
      ? arrivalBufferMinutes
      : direction === "to_station"
        ? 5
        : 0,
  );
  const [originMode, setOriginMode] = useState<
    "station_or_campus" | "current_location"
  >("station_or_campus");
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [detectedAddress, setDetectedAddress] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Controllo preventivo: la logica live è attiva SOLO se il giorno selezionato nel selettore orizzontale corrisponde ad oggi
  // E se il contesto non è forzato su programmato (es. lezioni in corso o già concluse per cui si mostrano le linee programmate)
  const isSelectedDayActiveToday = Boolean(isToday);
  const canUseLive = isSelectedDayActiveToday && isLiveContext !== false;

  const isCurrentLocOrigin = originMode === "current_location";
  const gpsCoordsKey =
    isCurrentLocOrigin && userCoords
      ? `gps:${userCoords.lat.toFixed(4)},${userCoords.lng.toFixed(4)}`
      : "";
  const stableStationKey =
    isCurrentLocOrigin && direction !== "to_station"
      ? gpsCoordsKey || "gps:pending"
      : stationName;
  const stableTargetKey =
    isCurrentLocOrigin && direction === "to_station"
      ? gpsCoordsKey || "gps:pending"
      : targetName;
  const activeQueryKey = `${direction}|${stableStationKey}|${stableTargetKey}|${targetDate || ""}|${canUseLive ? "live" : targetTime || "now"}|${constraintTime || ""}|${minDepartureTime || ""}|buf:${effectiveArrivalBuffer}|${preferLatestBeforeDeadline ? "late" : "std"}`;

  const normStr = (s?: string) => (s || "").trim().toLowerCase();
  const prefetchedMatchesCurrent = Boolean(
    prefetchedBoard &&
    !isCurrentLocOrigin &&
    (prefetchedBoard.departures?.length ?? 0) > 0 &&
    normStr(prefetchedBoard.stationName) === normStr(stationName) &&
    normStr(prefetchedBoard.destinationName) === normStr(targetName) &&
    Boolean(prefetchedBoard.isLiveSource) === canUseLive &&
    (prefetchedBoard.arrivalBufferMinutes ??
      (direction === "to_station" ? 5 : 0)) === effectiveArrivalBuffer &&
    Boolean(prefetchedBoard.preferLatestBeforeDeadline) ===
      Boolean(preferLatestBeforeDeadline),
  );

  const [fetchedBoardEntry, setFetchedBoardEntry] = useState<{
    queryKey: string;
    prefetchedSource: TransitBoardResult | undefined;
    data: TransitBoardResult;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(
    () => isCurrentLocOrigin || !prefetchedMatchesCurrent,
  );

  const hasFetchedOverride = Boolean(
    fetchedBoardEntry &&
    fetchedBoardEntry.queryKey === activeQueryKey &&
    (!prefetchedMatchesCurrent ||
      fetchedBoardEntry.prefetchedSource === prefetchedBoard),
  );
  const boardData = hasFetchedOverride
    ? fetchedBoardEntry!.data
    : prefetchedMatchesCurrent
      ? prefetchedBoard!
      : fetchedBoardEntry &&
          (fetchedBoardEntry.queryKey === activeQueryKey ||
            (originMode === "current_location" &&
              fetchedBoardEntry.queryKey.startsWith(`${direction}|`) &&
              fetchedBoardEntry.queryKey.includes("gps:") &&
              fetchedBoardEntry.data.departures.length > 0))
        ? fetchedBoardEntry.data
        : null;
  const [lineFilterState, setLineFilterState] = useState<{
    queryKey: string;
    line: string | null;
  }>({ queryKey: activeQueryKey, line: null });
  const selectedLineFilter =
    lineFilterState.queryKey === activeQueryKey ? lineFilterState.line : null;
  const setSelectedLineFilter = useCallback(
    (nextLine: string | null) => {
      setLineFilterState({ queryKey: activeQueryKey, line: nextLine });
    },
    [activeQueryKey],
  );

  const [expansionState, setExpansionState] = useState<{
    queryKey: string;
    level: ExpansionLevel;
  }>({ queryKey: activeQueryKey, level: "collapsed" });
  const expansionLevel: ExpansionLevel =
    expansionState.queryKey === activeQueryKey
      ? expansionState.level
      : "collapsed";
  const setExpansionLevel = useCallback(
    (nextLevel: ExpansionLevel) => {
      setExpansionState({ queryKey: activeQueryKey, level: nextLevel });
    },
    [activeQueryKey],
  );
  const [manualRefreshCount, setManualRefreshCount] = useState<number>(0);
  const [spinAnim] = useState(new Animated.Value(0));

  // Stato per il nuovo modale di dettaglio della singola corsa
  const [selectedDepartureModal, setSelectedDepartureModal] =
    useState<TransitDepartureItem | null>(null);
  const [pastOpenForKey, setPastOpenForKey] = useState<string | null>(null);
  const showPastDepartures = pastOpenForKey === activeQueryKey;
  const setShowPastDepartures = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setPastOpenForKey((prevKey) => {
        const cur = prevKey === activeQueryKey;
        const next = typeof updater === "function" ? updater(cur) : updater;
        return next ? activeQueryKey : null;
      });
    },
    [activeQueryKey],
  );
  const [showRecentDepartures, setShowRecentDepartures] =
    useState<boolean>(false);
  const [recentEntries, setRecentEntries] = useState<RecentTransitEntry[]>([]);

  const tripOriginLabel = stationName || "";
  const tripDestLabel = targetName || "";

  useEffect(() => {
    let active = true;
    getRecentTransitDepartures(tripOriginLabel, tripDestLabel)
      .then((list) => {
        if (active) setRecentEntries(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tripOriginLabel, tripDestLabel]);

  const openDepartureModal = useCallback(
    (dep: TransitDepartureItem) => {
      setSelectedDepartureModal(dep);
      recordRecentTransitDeparture(tripOriginLabel, tripDestLabel, dep)
        .then((nextList) => setRecentEntries(nextList))
        .catch(() => {});
    },
    [tripOriginLabel, tripDestLabel],
  );

  const prevManualRefreshCountRef = useRef<number>(0);
  const manualForcePendingRef = useRef<boolean>(false);
  const userCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevPrefetchedBoardRef = useRef<TransitBoardResult | undefined>(
    undefined,
  );
  const prevRefreshTimestampRef = useRef<number | undefined>(undefined);
  const lastPrefetchedQueryKeyRef = useRef<string | null>(null);
  const lastNotifiedSignatureRef = useRef<string>("");
  const prevNotifiedPrefetchedRef = useRef<TransitBoardResult | undefined>(
    undefined,
  );
  const prevNotifiedQueryKeyRef = useRef<string>("");
  const latestBoardParamsRef = useRef<{
    queryKey: string;
    cacheKey: string;
    stationName: string;
    stationCoords?: { lat: number; lng: number };
    targetCoords?: { lat: number; lng: number };
    targetName: string;
    targetDate?: string;
    targetTime?: string;
    direction: "to_campus" | "to_station";
    isLiveContext: boolean;
    constraintTime?: string;
    minDepartureTime?: string;
    arrivalBufferMinutes: number;
    preferLatestBeforeDeadline?: boolean;
  } | null>(null);

  const handleRefreshModalDeparture = useCallback(
    async (
      currentDep: TransitDepartureItem,
    ): Promise<TransitDepartureItem | null> => {
      const params = latestBoardParamsRef.current;
      if (!params) {
        const fallback = findMatchingDepartureInBoard(currentDep, boardData);
        return fallback;
      }
      const fresh = await getStationTransitBoard({
        stationName: params.stationName,
        stationCoords: params.stationCoords,
        targetCoords: params.targetCoords,
        targetName: params.targetName,
        targetDate: params.targetDate,
        targetTime: params.targetTime,
        direction: params.direction,
        isLiveContext: params.isLiveContext,
        constraintTime: params.constraintTime,
        minDepartureTime: params.minDepartureTime,
        arrivalBufferMinutes: params.arrivalBufferMinutes,
        preferLatestBeforeDeadline: params.preferLatestBeforeDeadline,
        forceRefresh: true,
      });
      if (!fresh.fetchFailed && fresh.departures.length > 0) {
        setTransitCardMemoryCache(params.cacheKey, fresh);
        setFetchedBoardEntry({
          queryKey: params.queryKey,
          prefetchedSource: prefetchedBoard,
          data: fresh,
        });
      }
      const matched = findMatchingDepartureInBoard(currentDep, fresh);
      if (matched) {
        recordRecentTransitDeparture(tripOriginLabel, tripDestLabel, matched)
          .then((nextList) => setRecentEntries(nextList))
          .catch(() => {});
        return matched;
      }
      return null;
    },
    [boardData, prefetchedBoard, tripOriginLabel, tripDestLabel],
  );

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  // Risoluzione asincrona del nome della località (es. Viterbo, Orte, Terni, Latina, Roma)
  const resolveLocationName = useCallback(async (lat: number, lng: number) => {
    try {
      const geo = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      if (geo && geo.length > 0) {
        const g = geo[0];
        const cityName =
          g.city || g.subregion || g.district || g.region || g.name;
        if (cityName) {
          setDetectedCity(cityName);
        }
        const street = g.street || g.name;
        const streetNum = g.streetNumber ? ` ${g.streetNumber}` : "";
        if (street && cityName) {
          setDetectedAddress(`${street}${streetNum} • ${cityName}`);
        } else if (street) {
          setDetectedAddress(`${street}${streetNum}`);
        } else if (cityName) {
          setDetectedAddress(cityName);
        }
      }
    } catch {
      // Reverse geocoding best-effort: ignora fallimenti di rete
    }
  }, []);

  // Acquisizione o aggiornamento manuale della posizione GPS reale con supporto interregionale
  // Ritorna true se setUserCoords ha aggiornato le coordinate (così il caller evita una doppia fetch/abort)
  const acquireOrRefreshGpsLocation = useCallback(
    async (isManualRefresh = false): Promise<boolean> => {
      setLocationError(null);
      setIsLocating(true);
      let didUpdateCoords = false;

      try {
        // 1. Verifica e richiesta autorizzazione permessi di localizzazione in primo piano
        const perm = await Location.getForegroundPermissionsAsync();
        let isGranted = perm.granted;
        if (!isGranted) {
          const req = await Location.requestForegroundPermissionsAsync();
          isGranted = req.granted;
        }

        if (!isGranted) {
          setLocationError(
            "Permesso posizione non autorizzato nelle impostazioni",
          );
          setIsLocating(false);
          setLoading(false);
          return false;
        }

        // 2. Controllo posizione recente nella cache di sistema:
        // Si accetta la posizione memorizzata SOLO se è recente (meno di 60 secondi fa)
        // evitando categoricamente di iniettare posizioni stantie di ore o giorni fa (es. Roma quando si è a 70km)
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 60000,
          requiredAccuracy: 300,
        }).catch(() => null);

        const nowTs = Date.now();
        const isFreshCache =
          Boolean(lastKnown?.coords) &&
          Boolean(lastKnown?.timestamp) &&
          nowTs - (lastKnown?.timestamp || 0) < 60000;

        const commitCoordsIfMoved = (nextCoords: {
          lat: number;
          lng: number;
        }) => {
          const prev = userCoordsRef.current;
          if (
            !prev ||
            Math.abs(nextCoords.lat - prev.lat) > 0.00022 ||
            Math.abs(nextCoords.lng - prev.lng) > 0.00028
          ) {
            userCoordsRef.current = nextCoords;
            setUserCoords(nextCoords);
            didUpdateCoords = true;
            return true;
          }
          return false;
        };

        if (isFreshCache && lastKnown?.coords && !isManualRefresh) {
          const cached = {
            lat: lastKnown.coords.latitude,
            lng: lastKnown.coords.longitude,
          };
          commitCoordsIfMoved(cached);
          resolveLocationName(cached.lat, cached.lng);
          // Se il fix nella cache di sistema è recente (<60s) e preciso (<=100m), evita la doppia chiamata GPS + doppia fetch tabellone
          const cachedAcc = lastKnown.coords.accuracy ?? 999;
          if (cachedAcc <= 100) {
            return didUpdateCoords;
          }
        }

        // 3. Rilevazione live della posizione GPS attuale (Balanced per fix rapido anche al chiuso, timeout 12s)
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 12000),
        );
        const freshLoc = await Promise.race([locPromise, timeoutPromise]).catch(
          () => null,
        );

        if (freshLoc?.coords) {
          const freshCoords = {
            lat: freshLoc.coords.latitude,
            lng: freshLoc.coords.longitude,
          };
          commitCoordsIfMoved(freshCoords);
          resolveLocationName(freshCoords.lat, freshCoords.lng);
        } else if (!isFreshCache && !userCoordsRef.current) {
          const fallbackKnown = await Location.getLastKnownPositionAsync({
            maxAge: 300000,
            requiredAccuracy: 1000,
          }).catch(() => null);
          if (fallbackKnown?.coords) {
            const fbCoords = {
              lat: fallbackKnown.coords.latitude,
              lng: fallbackKnown.coords.longitude,
            };
            commitCoordsIfMoved(fbCoords);
            resolveLocationName(fbCoords.lat, fbCoords.lng);
          } else {
            setLocationError(
              "Impossibile rilevare la posizione GPS attuale. Assicurati che la localizzazione sia attiva.",
            );
            setLoading(false);
          }
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Impossibile rilevare la posizione GPS";
        setLocationError(msg);
        setLoading(false);
      } finally {
        setIsLocating(false);
      }
      return didUpdateCoords;
    },
    [resolveLocationName],
  );

  const handleSelectOrigin = useCallback(
    (mode: "station_or_campus" | "current_location") => {
      if (mode === originMode) return;
      setExpansionLevel("collapsed");
      setSelectedLineFilter(null);
      setLocationError(null);
      if (mode === "station_or_campus") {
        setOriginMode("station_or_campus");
        setLoading(!prefetchedMatchesCurrent);
      } else {
        setOriginMode("current_location");
        if (!userCoords) {
          setLoading(true);
        }
        acquireOrRefreshGpsLocation(false);
      }
    },
    [
      originMode,
      userCoords,
      acquireOrRefreshGpsLocation,
      prefetchedMatchesCurrent,
      setExpansionLevel,
      setSelectedLineFilter,
    ],
  );

  // Click sull'icona circolare di refresh del pannello "Mezzi":
  // aggiorna i transiti e, se l'origine è su GPS, verifica/aggiorna anche la posizione
  const handleManualRefresh = useCallback(async () => {
    setLoading(true);
    manualForcePendingRef.current = true;
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 650,
      useNativeDriver: true,
    }).start(() => {
      spinAnim.setValue(0);
    });

    const coordsUpdated =
      originMode === "current_location"
        ? await acquireOrRefreshGpsLocation(true)
        : false;

    if (!coordsUpdated) {
      setManualRefreshCount((k) => k + 1);
    }
  }, [spinAnim, originMode, acquireOrRefreshGpsLocation]);

  const stLat = stationCoords?.lat;
  const stLng = stationCoords?.lng;
  const tgLat = targetCoords?.lat;
  const tgLng = targetCoords?.lng;

  // Caricamento tabellone mezzi sincronizzato anche con refreshTimestamp (ciclo 60s dei treni)
  useEffect(() => {
    let isMounted = true;

    const isCurrentLoc = originMode === "current_location";
    // Se la modalità è su posizione GPS ma le coordinate non sono ancora state acquisite, attendi
    if (isCurrentLoc && !userCoords) {
      return;
    }

    let qStationCoords =
      stLat !== undefined && stLng !== undefined
        ? { lat: stLat, lng: stLng }
        : undefined;
    let qStationName = stationName;
    let qTargetCoords =
      tgLat !== undefined && tgLng !== undefined
        ? { lat: tgLat, lng: tgLng }
        : undefined;
    let qTargetName = targetName;

    if (isCurrentLoc && userCoords) {
      if (direction === "to_station") {
        qTargetCoords = userCoords;
        qTargetName = "La mia posizione";
      } else {
        qStationCoords = userCoords;
        qStationName = "La mia posizione";
      }
    }

    const countChanged =
      manualRefreshCount !== prevManualRefreshCountRef.current;
    prevManualRefreshCountRef.current = manualRefreshCount;
    const isManualForce = countChanged || manualForcePendingRef.current;
    if (manualForcePendingRef.current) {
      manualForcePendingRef.current = false;
    }

    const gpsKeyPart =
      isCurrentLoc && userCoords
        ? `gps:${userCoords.lat.toFixed(4)},${userCoords.lng.toFixed(4)}`
        : "";
    const cacheStationPart =
      isCurrentLoc && direction !== "to_station" ? gpsKeyPart : qStationName;
    const cacheTargetPart =
      isCurrentLoc && direction === "to_station" ? gpsKeyPart : qTargetName;

    const cacheKey = `${direction}_${cacheStationPart}_${cacheTargetPart}_${canUseLive ? "live" : targetTime || "now"}_${targetDate || ""}_${constraintTime || ""}_${minDepartureTime || ""}_buf${effectiveArrivalBuffer}_${preferLatestBeforeDeadline ? "late" : "std"}_${isCurrentLoc ? gpsKeyPart : "default"}`;

    const prevPrefetched = prevPrefetchedBoardRef.current;
    const refreshTickChanged =
      refreshTimestamp !== prevRefreshTimestampRef.current;
    prevRefreshTimestampRef.current = refreshTimestamp;

    // Quando la tab Viaggio non è in focus, non eseguire refetch in background su tick periodici
    if (!isFocused && !isManualForce && refreshTickChanged) {
      return;
    }

    const currentQueryKey = `${direction}|${cacheStationPart}|${cacheTargetPart}|${targetDate || ""}|${canUseLive ? "live" : targetTime || "now"}|${constraintTime || ""}|${minDepartureTime || ""}|buf:${effectiveArrivalBuffer}|${preferLatestBeforeDeadline ? "late" : "std"}`;

    const matchesArrivalBuffer = (board: TransitBoardResult) =>
      (board.arrivalBufferMinutes ?? (direction === "to_station" ? 5 : 0)) ===
        effectiveArrivalBuffer &&
      Boolean(board.preferLatestBeforeDeadline) ===
        Boolean(preferLatestBeforeDeadline);

    const canConsumePrefetched = Boolean(
      prefetchedBoard &&
      !isCurrentLoc &&
      !isManualForce &&
      (prefetchedBoard.departures?.length ?? 0) > 0 &&
      normStr(prefetchedBoard.stationName) === normStr(qStationName) &&
      normStr(prefetchedBoard.destinationName) === normStr(qTargetName) &&
      Boolean(prefetchedBoard.isLiveSource) === canUseLive &&
      matchesArrivalBuffer(prefetchedBoard),
    );

    if (canConsumePrefetched && prefetchedBoard) {
      prevPrefetchedBoardRef.current = prefetchedBoard;
      lastPrefetchedQueryKeyRef.current = currentQueryKey;
      setTransitCardMemoryCache(cacheKey, prefetchedBoard);
      queueMicrotask(() => {
        if (!isMounted) return;
        setLoading(false);
      });
      return () => {
        isMounted = false;
      };
    }

    if (prefetchedBoard && prefetchedBoard !== prevPrefetched) {
      prevPrefetchedBoardRef.current = prefetchedBoard;
    }

    const freshCached = !isManualForce
      ? getTransitCardMemoryCache(cacheKey, canUseLive)
      : null;
    if (freshCached) {
      queueMicrotask(() => {
        if (!isMounted) return;
        setFetchedBoardEntry({
          queryKey: currentQueryKey,
          prefetchedSource: prefetchedBoard,
          data: freshCached,
        });
        setLoading(false);
      });
      // Cache valida e fresca entro TTL (45s live / 10m programmato): evita la refetch ridondante
      return () => {
        isMounted = false;
      };
    }

    if (!isManualForce) {
      queueMicrotask(() => {
        if (!isMounted) return;
        setLoading(true);
      });
    }

    const effectiveGpsConstraint = (() => {
      if (!isCurrentLoc) return constraintTime;
      if (!constraintTime) return undefined;
      const cM = parseHHMMToMins(constraintTime);
      if (cM < 0) return undefined;
      const nowD = new Date();
      const nM = nowD.getHours() * 60 + nowD.getMinutes();
      const relC = cM < nM && nM - cM > 720 ? cM + 1440 : cM;
      return relC > nM ? constraintTime : undefined;
    })();

    const abortController = new AbortController();

    latestBoardParamsRef.current = {
      queryKey: currentQueryKey,
      cacheKey,
      stationName: qStationName,
      stationCoords: qStationCoords,
      targetCoords: qTargetCoords,
      targetName: qTargetName || targetName || "",
      targetDate: isCurrentLoc
        ? undefined
        : canUseLive
          ? undefined
          : targetDate,
      targetTime: isCurrentLoc ? "now" : canUseLive ? "now" : targetTime,
      direction,
      isLiveContext: canUseLive,
      constraintTime: effectiveGpsConstraint,
      minDepartureTime: isCurrentLoc ? undefined : minDepartureTime,
      arrivalBufferMinutes: effectiveArrivalBuffer,
      preferLatestBeforeDeadline: isCurrentLoc
        ? false
        : preferLatestBeforeDeadline,
    };

    getStationTransitBoard({
      stationName: qStationName,
      stationCoords: qStationCoords,
      targetCoords: qTargetCoords,
      targetName: qTargetName || targetName || "",
      targetDate: isCurrentLoc
        ? undefined
        : canUseLive
          ? undefined
          : targetDate,
      targetTime: isCurrentLoc ? "now" : canUseLive ? "now" : targetTime,
      direction,
      isLiveContext: canUseLive,
      constraintTime: effectiveGpsConstraint,
      minDepartureTime: isCurrentLoc ? undefined : minDepartureTime,
      arrivalBufferMinutes: effectiveArrivalBuffer,
      preferLatestBeforeDeadline: isCurrentLoc
        ? false
        : preferLatestBeforeDeadline,
      forceRefresh: isManualForce,
      signal: abortController.signal,
    })
      .then((data) => {
        if (!isMounted || abortController.signal.aborted) return;
        // Se il refresh fallisce (es. timeout o errore temporaneo) e abbiamo già corse valide in memoria/stato,
        // non cancellare le corse già visualizzate.
        if (data.fetchFailed) {
          const existing = transitBoardMemoryCache.get(cacheKey)?.data;
          if (existing && existing.departures.length > 0) {
            setLoading(false);
            return;
          }
          const prefetchedValid = Boolean(
            prefetchedBoard &&
            !isCurrentLoc &&
            (prefetchedBoard.departures?.length ?? 0) > 0 &&
            normStr(prefetchedBoard.stationName) === normStr(qStationName) &&
            normStr(prefetchedBoard.destinationName) === normStr(qTargetName) &&
            Boolean(prefetchedBoard.isLiveSource) === canUseLive &&
            matchesArrivalBuffer(prefetchedBoard),
          );
          if (prefetchedValid) {
            setLoading(false);
            return;
          }
          let keptPrevious = false;
          setFetchedBoardEntry((prev) => {
            const sameGpsDirection =
              isCurrentLoc &&
              prev &&
              prev.queryKey.startsWith(`${direction}|`) &&
              prev.queryKey.includes("gps:") &&
              prev.data.departures.length > 0;
            if (
              prev &&
              (prev.queryKey === currentQueryKey || sameGpsDirection) &&
              prev.data.departures.length > 0
            ) {
              keptPrevious = true;
              return prev;
            }
            return {
              queryKey: currentQueryKey,
              prefetchedSource: prefetchedBoard,
              data,
            };
          });
          setLoading(false);
          if (keptPrevious) return;
          return;
        }

        setTransitCardMemoryCache(cacheKey, data);
        setFetchedBoardEntry({
          queryKey: currentQueryKey,
          prefetchedSource: prefetchedBoard,
          data,
        });
        setLoading(false);
      })
      .catch(() => {
        if (isMounted && !abortController.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [
    isFocused,
    stationName,
    stLat,
    stLng,
    tgLat,
    tgLng,
    targetName,
    targetDate,
    targetTime,
    direction,
    originMode,
    userCoords,
    canUseLive,
    constraintTime,
    minDepartureTime,
    effectiveArrivalBuffer,
    preferLatestBeforeDeadline,
    refreshTimestamp,
    prefetchedBoard,
    manualRefreshCount,
  ]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const filteredDepartures = useMemo(() => {
    if (!boardData) return [];
    if (!selectedLineFilter) return boardData.departures;
    return boardData.departures.filter(
      (d) => d.line.toLowerCase() === selectedLineFilter.toLowerCase(),
    );
  }, [boardData, selectedLineFilter]);

  const unfilteredHalfHourDepartures = useMemo(
    () => getHalfHourDepartures(boardData?.departures || []),
    [boardData],
  );

  // Corse comprese nell'intorno di mezz'ora (+30 minuti dalla prima partenza disponibile)
  const halfHourDepartures = useMemo(
    () => getHalfHourDepartures(filteredDepartures),
    [filteredDepartures],
  );

  const hasMinDepartureConstraint = Boolean(!isCurrentLocOrigin && minDepartureTime);

  const unfilteredDisplayedDepartures = useMemo(
    () =>
      sliceDeparturesByLevel(
        boardData?.departures || [],
        unfilteredHalfHourDepartures,
        expansionLevel,
        direction,
        false,
        boardData,
        hasMinDepartureConstraint,
      ),
    [
      boardData,
      unfilteredHalfHourDepartures,
      expansionLevel,
      direction,
      hasMinDepartureConstraint,
    ],
  );

  const displayedDepartures = useMemo(
    () =>
      sliceDeparturesByLevel(
        filteredDepartures,
        halfHourDepartures,
        expansionLevel,
        direction,
        Boolean(selectedLineFilter),
        boardData,
        hasMinDepartureConstraint,
      ),
    [
      filteredDepartures,
      halfHourDepartures,
      expansionLevel,
      direction,
      selectedLineFilter,
      boardData,
      hasMinDepartureConstraint,
    ],
  );

  // "Linee consigliate" riflette esclusivamente le linee presenti nelle corse attualmente esposte al livello di espansione corrente
  const visibleDirectLines = useMemo(() => {
    if (!boardData || unfilteredDisplayedDepartures.length === 0) return [];
    const seen = new Set<string>();
    const directFirst: string[] = [];
    for (const dep of unfilteredDisplayedDepartures) {
      const lineKey = dep.line.trim();
      if (!lineKey) continue;
      const norm = lineKey.toLowerCase();
      if (dep.isDirect && !seen.has(norm)) {
        seen.add(norm);
        directFirst.push(lineKey);
      }
    }
    if (directFirst.length > 0) return directFirst;
    const fallback: string[] = [];
    for (const dep of unfilteredDisplayedDepartures) {
      const lineKey = dep.line.trim();
      if (!lineKey) continue;
      const norm = lineKey.toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        fallback.push(lineKey);
      }
    }
    return fallback;
  }, [boardData, unfilteredDisplayedDepartures]);

  // Sincronizza il titolo della card Viaggio e i parametri del mezzo consigliato
  // sia al caricamento che quando l'utente espande/comprime le corse visibili o si aggiorna l'itinerario
  useEffect(() => {
    if (!boardData || !onOptimalDepartureResolved) return;
    if (
      prefetchedBoard !== prevNotifiedPrefetchedRef.current ||
      activeQueryKey !== prevNotifiedQueryKeyRef.current
    ) {
      prevNotifiedPrefetchedRef.current = prefetchedBoard;
      prevNotifiedQueryKeyRef.current = activeQueryKey;
      lastNotifiedSignatureRef.current = "";
    }
    const update = toOptimalTimingUpdate(
      boardData,
      canUseLive,
      visibleDirectLines,
      minDepartureTime,
      unfilteredDisplayedDepartures,
    );
    if (!update) return;
    const sig = [
      update.startTime,
      update.endTime,
      update.durationMinutes,
      String(update.walkBeforeMinutes ?? ""),
      String(update.inVehicleMinutes ?? ""),
      String(update.walkAfterMinutes ?? ""),
      update.busDepartureTime || "",
      update.busAlightingTime || "",
      update.coincidenceAvailableFromTime || "",
      update.firstAvailableDepartureTime || "",
      update.line,
      (update.directLines || []).join(","),
      update.lastUsefulDeparture?.id || "",
      update.lastUsefulDeparture?.estimatedTime ||
        update.lastUsefulDeparture?.scheduledTime ||
        "",
      String(Boolean(update.isLiveContext)),
    ].join("|");
    if (lastNotifiedSignatureRef.current === sig) return;
    lastNotifiedSignatureRef.current = sig;
    onOptimalDepartureResolved(update);
  }, [
    boardData,
    prefetchedBoard,
    activeQueryKey,
    canUseLive,
    visibleDirectLines,
    minDepartureTime,
    unfilteredDisplayedDepartures,
    onOptimalDepartureResolved,
  ]);

  const handleToggleExpansion = useCallback(() => {
    const resetFilterIfHiddenInCollapsed = () => {
      if (!selectedLineFilter || !boardData) return;
      const collapsedDeps = sliceDeparturesByLevel(
        boardData.departures,
        unfilteredHalfHourDepartures,
        "collapsed",
        direction,
        false,
        boardData,
        hasMinDepartureConstraint,
      );
      const stillVisible = collapsedDeps.some(
        (d) => d.line.trim().toLowerCase() === selectedLineFilter.toLowerCase(),
      );
      if (!stillVisible) {
        setSelectedLineFilter(null);
      }
    };

    if (expansionLevel === "collapsed") {
      // Se nell'intorno di mezz'ora ci sono più di 3 corse ed è inferiore al totale, espande alla mezz'ora
      if (
        halfHourDepartures.length > 3 &&
        halfHourDepartures.length < filteredDepartures.length
      ) {
        setExpansionLevel("half_hour");
      } else {
        // Altrimenti espande direttamente al limite completo
        setExpansionLevel("full");
      }
    } else if (expansionLevel === "half_hour") {
      if (filteredDepartures.length > displayedDepartures.length) {
        setExpansionLevel("full");
      } else {
        resetFilterIfHiddenInCollapsed();
        setExpansionLevel("collapsed");
      }
    } else {
      resetFilterIfHiddenInCollapsed();
      setExpansionLevel("collapsed");
    }
  }, [
    expansionLevel,
    halfHourDepartures.length,
    filteredDepartures.length,
    displayedDepartures.length,
    selectedLineFilter,
    boardData,
    unfilteredHalfHourDepartures,
    direction,
    hasMinDepartureConstraint,
    setExpansionLevel,
    setSelectedLineFilter,
  ]);

  const renderLineBadges = useCallback(
    (dep: TransitDepartureItem, forceCompact = false, muted = false) => {
      const mutedBg = "#334155";
      const mutedFg = "#94a3b8";
      if (dep.legs && dep.legs.length > 1) {
        return (
          <View style={styles.multiLegBadgeContainer}>
            {dep.legs.map((leg, lIdx) => {
              const lColor = muted
                ? mutedBg
                : getLineBadgeColor(leg.line, leg.mode);
              const lIcon = getTransitModeIcon(leg.mode, leg.line);
              const shortLine = leg.line.replace(/^Metro\s+/i, "M");
              return (
                <React.Fragment key={`leg-badge-${lIdx}`}>
                  {lIdx > 0 && (
                    <Ionicons
                      name="arrow-forward"
                      size={10}
                      color={muted ? "#64748b" : "#94a3b8"}
                      style={{ marginHorizontal: 2 }}
                    />
                  )}
                  <View
                    style={[
                      styles.lineBadgeBoxCompact,
                      { backgroundColor: lColor },
                    ]}
                  >
                    <Ionicons
                      name={lIcon}
                      size={10}
                      color={muted ? mutedFg : "#ffffff"}
                      style={{ marginRight: 3 }}
                    />
                    <Text
                      style={[
                        styles.lineBadgeTextCompact,
                        muted && { color: mutedFg },
                      ]}
                    >
                      {shortLine}
                    </Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        );
      }

      if (dep.line.includes(" + ")) {
        return (
          <View style={styles.multiLegBadgeContainer}>
            {dep.line.split(" + ").map((part, pIdx) => {
              const pTrim = part.trim();
              const pColor = muted ? mutedBg : getLineBadgeColor(pTrim);
              const pIcon = getTransitModeIcon(undefined, pTrim);
              const shortPart = pTrim.replace(/^Metro\s+/i, "M");
              return (
                <React.Fragment key={`part-badge-${pIdx}`}>
                  {pIdx > 0 && (
                    <Ionicons
                      name="arrow-forward"
                      size={10}
                      color={muted ? "#64748b" : "#94a3b8"}
                      style={{ marginHorizontal: 2 }}
                    />
                  )}
                  <View
                    style={[
                      styles.lineBadgeBoxCompact,
                      { backgroundColor: pColor },
                    ]}
                  >
                    <Ionicons
                      name={pIcon}
                      size={10}
                      color={muted ? mutedFg : "#ffffff"}
                      style={{ marginRight: 3 }}
                    />
                    <Text
                      style={[
                        styles.lineBadgeTextCompact,
                        muted && { color: mutedFg },
                      ]}
                    >
                      {shortPart}
                    </Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        );
      }

      const badgeBg = muted ? mutedBg : getLineBadgeColor(dep.line, dep.mode);
      const modeIcon = getTransitModeIcon(dep.mode, dep.line);
      if (forceCompact) {
        return (
          <View
            style={[styles.lineBadgeBoxCompact, { backgroundColor: badgeBg }]}
          >
            <Ionicons
              name={modeIcon}
              size={10}
              color={muted ? mutedFg : "#ffffff"}
              style={{ marginRight: 3 }}
            />
            <Text
              style={[styles.lineBadgeTextCompact, muted && { color: mutedFg }]}
            >
              {dep.line}
            </Text>
          </View>
        );
      }

      return (
        <View style={[styles.lineBadgeBox, { backgroundColor: badgeBg }]}>
          <Ionicons
            name={modeIcon}
            size={12}
            color="#ffffff"
            style={{ marginRight: 4 }}
          />
          <Text style={styles.lineBadgeText}>{dep.line}</Text>
        </View>
      );
    },
    [],
  );

  /**
   * Determina lo stato live di una specifica corsa secondo le direttive:
   * 1. Verifica giorno attivo nel selettore orizzontale (es. "GIO"): se non è oggi, live disattivato preventivamente.
   * 2. Se è oggi, rileva se l'orario del mezzo rientra nella fascia oraria in corso rispetto all'orario attuale reale.
   * 3. Attiva lo stato live ("tra", "ogni", "In arrivo", ritardo e pallino) solo per le corse che hanno effettivi dati live.
   *    Se un mezzo non ha dati live, non viene applicata alcuna informazione fittizia.
   */
  const getDepartureLiveInfo = useCallback(
    (dep: TransitDepartureItem, index: number) => {
      const effectiveDepStr = dep.estimatedTime || dep.scheduledTime;
      const delayMins =
        typeof dep.delayMinutes === "number" ? Math.max(0, dep.delayMinutes) : 0;
      const trafficMins =
        typeof dep.trafficDelayMinutes === "number"
          ? Math.max(0, dep.trafficDelayMinutes)
          : 0;
      const hasShift = Boolean(
        (dep.scheduledTime &&
          effectiveDepStr &&
          dep.scheduledTime !== effectiveDepStr) ||
          delayMins >= 1 ||
          trafficMins >= 1 ||
          dep.statusType === "delayed",
      );

      if (!isSelectedDayActiveToday) {
        return {
          isLiveActive: false,
          displayTime: effectiveDepStr,
          isDelayed: hasShift,
          isHeavyDelay: delayMins >= 5,
          dotColor: hasShift ? "#fbbf24" : undefined,
          delayText: delayMins > 0 ? `+${delayMins}m` : null,
          countdownText: null,
        };
      }

      const now = new Date();
      const currentNowMins = now.getHours() * 60 + now.getMinutes();
      const depMins = parseHHMMToMins(effectiveDepStr);

      if (depMins < 0) {
        return {
          isLiveActive: false,
          displayTime: effectiveDepStr,
          isDelayed: hasShift,
          isHeavyDelay: delayMins >= 5,
          dotColor: hasShift ? "#fbbf24" : undefined,
          delayText: delayMins > 0 ? `+${delayMins}m` : null,
          countdownText: null,
        };
      }

      let diff = depMins - currentNowMins;
      if (diff < -720) diff += 1440;
      if (diff > 720) diff -= 1440;

      const isInCurrentTimeWindow = diff >= -3 && diff <= 75;
      const isInCountdownWindow = diff >= -3 && diff <= 120;

      const hasRealtimeData = Boolean(
        dep.isLive &&
          (dep.statusType !== "scheduled" ||
            delayMins > 0 ||
            (dep.estimatedTime &&
              dep.scheduledTime &&
              dep.estimatedTime !== dep.scheduledTime) ||
            isInCurrentTimeWindow),
      );

      let countdownText: string | null = null;
      if (isInCountdownWindow) {
        if (diff <= 1) {
          countdownText = "In arrivo";
        } else {
          let headwayMins: number | null = null;
          for (let j = index + 1; j < filteredDepartures.length; j++) {
            const nextDep = filteredDepartures[j];
            if (nextDep.line.toLowerCase() === dep.line.toLowerCase()) {
              const nextMins = parseHHMMToMins(
                nextDep.estimatedTime || nextDep.scheduledTime,
              );
              if (nextMins >= 0) {
                let hDiff = nextMins - depMins;
                if (hDiff < -720) hDiff += 1440;
                if (hDiff >= 3 && hDiff <= 15) {
                  headwayMins = hDiff;
                }
              }
              break;
            }
          }

          if (dep.mode === "metro" && headwayMins && diff > 6) {
            countdownText = `ogni ${headwayMins}m`;
          } else {
            countdownText = `tra ${diff}m`;
          }
        }
      }

      const isLiveActive = isInCurrentTimeWindow && hasRealtimeData;

      if (!isLiveActive) {
        return {
          isLiveActive: false,
          displayTime: effectiveDepStr,
          isDelayed: hasShift,
          isHeavyDelay: delayMins >= 5,
          dotColor: hasShift ? "#fbbf24" : undefined,
          delayText: delayMins > 0 ? `+${delayMins}m` : null,
          countdownText,
        };
      }

      const liveDelayMins =
        typeof dep.liveDelayMinutes === "number"
          ? Math.max(0, dep.liveDelayMinutes)
          : 0;
      const isLiveDelayed = liveDelayMins >= 1;
      const isHeavyLiveDelay = isLiveDelayed && liveDelayMins >= 5;
      const dotColor = isLiveDelayed
        ? isHeavyLiveDelay
          ? "#ef4444"
          : "#f59e0b"
        : "#10b981";
      const delayText = isLiveDelayed ? `+${liveDelayMins}m` : "In orario";

      return {
        isLiveActive: true,
        displayTime: effectiveDepStr,
        isDelayed: hasShift,
        isHeavyDelay: isHeavyLiveDelay,
        dotColor,
        delayText,
        countdownText,
      };
    },
    [isSelectedDayActiveToday, filteredDepartures],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: "#13151b", borderColor: "#262a36" },
      ]}
    >
      {/* ── SEZIONE 1: Intestazione pulita con titolo "Mezzi" e pulsante circolare di refresh ── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.headerIconBox,
              { backgroundColor: "rgba(59, 130, 246, 0.15)" },
            ]}
          >
            <Ionicons name="bus" size={15} color="#60a5fa" />
          </View>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Mezzi</Text>
            {canUseLive && (
              <View style={styles.headerLiveBadge}>
                <View style={styles.headerLiveDot} />
                <Text style={styles.headerLiveText}>LIVE</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleManualRefresh}
          disabled={loading || isLocating}
          style={styles.refreshCircleBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Aggiorna mezzi e posizione GPS"
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="refresh" size={14} color="#cbd5e1" />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* ── Selettore di Partenza Mezzi Unificato (Design Moderno & Intuitivo) ── */}
      <View style={styles.unifiedOriginWrapper}>
        <Text style={styles.unifiedOriginSectionLabel}>PARTENZA DA</Text>
        <TouchableOpacity
          activeOpacity={0.78}
          onPress={() =>
            handleSelectOrigin(
              originMode === "current_location"
                ? "station_or_campus"
                : "current_location",
            )
          }
          style={[
            styles.unifiedOriginCard,
            originMode === "current_location" && styles.unifiedOriginCardGps,
          ]}
          accessibilityLabel={
            originMode === "current_location"
              ? direction === "to_station"
                ? "Passa a partenza da Sede"
                : "Passa a partenza da Stazione"
              : "Passa a partenza da Posizione GPS"
          }
        >
          {/* Icona indicatore dello stato di partenza attivo */}
          <View
            style={[
              styles.unifiedOriginIconBox,
              originMode === "current_location"
                ? styles.unifiedOriginIconBoxGps
                : styles.unifiedOriginIconBoxDefault,
            ]}
          >
            {originMode === "current_location" ? (
              isLocating ? (
                <ActivityIndicator size={13} color="#10b981" />
              ) : (
                <Ionicons name="locate" size={16} color="#10b981" />
              )
            ) : (
              <Ionicons
                name={direction === "to_station" ? "school" : "train"}
                size={16}
                color="#60a5fa"
              />
            )}
          </View>

          {/* Testi informativi a due righe: Luogo effettivo di partenza (Stazione o Via e Città) + Dettaglio (mai troncati) */}
          <View style={styles.unifiedOriginTextCol}>
            <Text
              style={[
                styles.unifiedOriginMainText,
                originMode === "current_location" &&
                  styles.unifiedOriginMainTextGps,
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {originMode === "current_location"
                ? isLocating
                  ? "Rilevamento posizione..."
                  : "Posizione"
                : direction === "to_station"
                  ? targetName || "Sede universitaria"
                  : stationName || "Stazione ferroviaria"}
            </Text>
            <Text
              style={[
                styles.unifiedOriginSubText,
                originMode === "current_location" &&
                  styles.unifiedOriginSubTextGps,
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {originMode === "current_location"
                ? isLocating
                  ? "Acquisizione GPS in corso"
                  : detectedAddress ||
                    (detectedCity
                      ? `Coordinate attive • ${detectedCity}`
                      : "Coordinate GPS attive")
                : direction === "to_station"
                  ? "Sede di partenza"
                  : "Stazione ferroviaria"}
            </Text>
          </View>

          {/* Pillola di switch compatta: rende evidente l'azione di cambio lasciando massimo spazio al testo */}
          <View
            style={[
              styles.compactSwitchPill,
              originMode === "current_location"
                ? styles.compactSwitchPillToDefault
                : styles.compactSwitchPillToGps,
            ]}
          >
            <Ionicons
              name="swap-horizontal"
              size={12}
              color={originMode === "current_location" ? "#60a5fa" : "#10b981"}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.compactSwitchPillText,
                originMode === "current_location"
                  ? styles.compactSwitchPillTextToDefault
                  : styles.compactSwitchPillTextToGps,
              ]}
            >
              {originMode === "current_location"
                ? direction === "to_station"
                  ? "Sede"
                  : "Stazione"
                : "GPS"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Segnalazione errore localizzazione */}
      {locationError && (
        <View style={styles.errorNoticeRow}>
          <Ionicons
            name="alert-circle-outline"
            size={12}
            color="#f87171"
            style={{ marginRight: 5 }}
          />
          <Text style={styles.errorNoticeText}>{locationError}</Text>
        </View>
      )}

      {/* ── Sezione "Linee consigliate" filtrata sulle corse effettivamente visualizzate ── */}
      {boardData && visibleDirectLines.length > 0 && (
        <View style={styles.chipsSection}>
          <Text style={styles.chipsLabel}>Linee consigliate</Text>
          <View style={styles.chipsContainer}>
            {visibleDirectLines.map((line) => {
              const isSelected =
                selectedLineFilter?.toLowerCase() === line.toLowerCase();
              const lineColor = getLineBadgeColor(line);
              const lineIcon = getTransitModeIcon(undefined, line);

              return (
                <TouchableOpacity
                  key={`line-chip-${line}`}
                  activeOpacity={0.75}
                  onPress={() => {
                    setSelectedLineFilter(isSelected ? null : line);
                  }}
                  style={[
                    styles.lineChip,
                    {
                      backgroundColor: isSelected
                        ? lineColor
                        : `${lineColor}20`,
                      borderColor: isSelected ? "#ffffff" : `${lineColor}75`,
                    },
                  ]}
                >
                  <Ionicons
                    name={lineIcon}
                    size={11}
                    color={isSelected ? "#ffffff" : lineColor}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.lineChipText,
                      {
                        color: "#ffffff",
                        fontWeight: isSelected ? "800" : "700",
                      },
                    ]}
                  >
                    {line}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {selectedLineFilter && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  setSelectedLineFilter(null);
                }}
                style={styles.resetFilterChip}
              >
                <Ionicons name="close" size={11} color="#94a3b8" />
                <Text style={styles.resetFilterText}>Tutte</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── SEZIONE 3.5 & 3.6: Barra compatta Recenti aperti + Corse precedenti ── */}
      {(() => {
        const pastList = (boardData?.pastDepartures || []).filter((d) => {
          if (!selectedLineFilter) return true;
          return d.line.toLowerCase() === selectedLineFilter.toLowerCase();
        });
        const hasRecent = recentEntries.length > 0;
        const hasPast = pastList.length > 0;
        if (!hasRecent && !hasPast) return null;

        const nowM = new Date().getHours() * 60 + new Date().getMinutes();

        return (
          <View style={{ marginBottom: 8, gap: 6 }}>
            {/* Riga singola compatta con pulsanti espandibili */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              {hasRecent && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    setShowRecentDepartures((p) => {
                      const next = !p;
                      if (next && showPastDepartures) setShowPastDepartures(false);
                      return next;
                    })
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 9,
                    paddingVertical: 6.5,
                    borderRadius: 9,
                    borderWidth: 1,
                    borderColor: showRecentDepartures
                      ? "rgba(96, 165, 250, 0.42)"
                      : "rgba(96, 165, 250, 0.22)",
                    backgroundColor: showRecentDepartures
                      ? "rgba(30, 58, 138, 0.28)"
                      : "rgba(15, 23, 42, 0.55)",
                    gap: 4,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Ionicons
                      name="bookmark-outline"
                      size={12}
                      color="#60a5fa"
                    />
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        color: "#e2e8f0",
                        flexShrink: 1,
                      }}
                      numberOfLines={1}
                    >
                      Recenti ({recentEntries.length})
                    </Text>
                  </View>
                  <Ionicons
                    name={showRecentDepartures ? "chevron-up" : "chevron-down"}
                    size={12}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              )}

              {hasPast && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    setShowPastDepartures((p) => {
                      const next = !p;
                      if (next && showRecentDepartures)
                        setShowRecentDepartures(false);
                      return next;
                    })
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 9,
                    paddingVertical: 6.5,
                    borderRadius: 9,
                    borderWidth: 1,
                    borderColor: showPastDepartures
                      ? "rgba(148, 163, 184, 0.42)"
                      : "rgba(148, 163, 184, 0.22)",
                    backgroundColor: showPastDepartures
                      ? "rgba(51, 65, 85, 0.38)"
                      : "rgba(15, 23, 42, 0.45)",
                    gap: 4,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Ionicons name="time-outline" size={12} color="#94a3b8" />
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        color: "#cbd5e1",
                        flexShrink: 1,
                      }}
                      numberOfLines={1}
                    >
                      Corse precedenti ({pastList.length})
                    </Text>
                  </View>
                  <Ionicons
                    name={showPastDepartures ? "chevron-up" : "chevron-down"}
                    size={12}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Pannello espanso compatto Recenti aperti */}
            {hasRecent && showRecentDepartures && (
              <View
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "rgba(96, 165, 250, 0.22)",
                  backgroundColor: "rgba(15, 23, 42, 0.55)",
                  padding: 7,
                  gap: 5,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 2,
                    marginBottom: 1,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "700",
                      color: "#60a5fa",
                      letterSpacing: 0.3,
                    }}
                  >
                    RECENTI APERTI
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      clearRecentTransitDepartures(tripOriginLabel, tripDestLabel)
                        .then(() => {
                          setRecentEntries([]);
                          setShowRecentDepartures(false);
                        })
                        .catch(() => {});
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "600",
                        color: "#64748b",
                      }}
                    >
                      Pulisci
                    </Text>
                  </TouchableOpacity>
                </View>

                {recentEntries.map((entry, rIdx) => {
                  const liveMatched =
                    findMatchingDepartureInBoard(entry.departure, boardData) ||
                    entry.departure;
                  const recDepStr =
                    liveMatched.estimatedTime || liveMatched.scheduledTime;
                  const hasRecShift = Boolean(
                    liveMatched.scheduledTime &&
                      recDepStr &&
                      liveMatched.scheduledTime !== recDepStr,
                  );
                  const recLiveM = Math.max(0, liveMatched.liveDelayMinutes ?? 0);
                  const recTrafficM = Math.max(
                    0,
                    liveMatched.trafficDelayMinutes ?? 0,
                  );
                  return (
                    <TouchableOpacity
                      key={`recent-${entry.departure.id || rIdx}`}
                      activeOpacity={0.78}
                      onPress={() => openDepartureModal(liveMatched)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "rgba(30, 41, 59, 0.65)",
                        borderColor: "rgba(255, 255, 255, 0.07)",
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 5.5,
                        gap: 6,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {renderLineBadges(liveMatched, true)}
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: "#e2e8f0",
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {liveMatched.headsign || liveMatched.fromStop}
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {(recLiveM > 0 || recTrafficM > 0) && (
                          <Text
                            style={{
                              fontSize: 9.5,
                              fontWeight: "700",
                              color:
                                Math.max(recLiveM, recTrafficM) >= 5
                                  ? "#fca5a5"
                                  : "#fbbf24",
                            }}
                          >
                            +{Math.max(recLiveM, recTrafficM)}m
                          </Text>
                        )}
                        <View style={{ alignItems: "flex-end" }}>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "800",
                              color: hasRecShift ? "#fbbf24" : "#ffffff",
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {recDepStr}
                          </Text>
                          {hasRecShift && (
                            <Text
                              style={[
                                styles.timeScheduledStrike,
                                { fontSize: 9 },
                              ]}
                            >
                              {liveMatched.scheduledTime}
                            </Text>
                          )}
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={12}
                          color="#64748b"
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Pannello espanso compatto Corse precedenti */}
            {hasPast && showPastDepartures && (
              <View
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "rgba(148, 163, 184, 0.22)",
                  backgroundColor: "rgba(15, 23, 42, 0.45)",
                  padding: 7,
                  gap: 5,
                }}
              >
                {pastList.map((pDep, pIdx) => {
                  const pTime = pDep.estimatedTime || pDep.scheduledTime;
                  const pMins = parseHHMMToMins(pTime);
                  let minsAgo = pMins >= 0 ? nowM - pMins : -1;
                  if (minsAgo < -720) minsAgo += 1440;
                  const hasPShift = Boolean(
                    pDep.scheduledTime &&
                      pTime &&
                      pDep.scheduledTime !== pTime,
                  );
                  return (
                    <TouchableOpacity
                      key={`past-${pDep.id || pIdx}`}
                      activeOpacity={0.78}
                      onPress={() => openDepartureModal(pDep)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "rgba(30, 35, 46, 0.55)",
                        borderColor: "rgba(148, 163, 184, 0.10)",
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 5.5,
                        opacity: 0.72,
                        gap: 6,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {renderLineBadges(pDep, true, true)}
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: "#94a3b8",
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {pDep.headsign || pDep.fromStop}
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {minsAgo >= 0 && minsAgo <= 60 && (
                          <Text
                            style={{
                              fontSize: 9.5,
                              fontWeight: "600",
                              color: "#64748b",
                            }}
                          >
                            {minsAgo === 0 ? "ora" : `-${minsAgo}m`}
                          </Text>
                        )}
                        <View style={{ alignItems: "flex-end" }}>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "800",
                              color: "#94a3b8",
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {pTime}
                          </Text>
                          {hasPShift && (
                            <Text
                              style={[
                                styles.timeScheduledStrike,
                                { fontSize: 9 },
                              ]}
                            >
                              {pDep.scheduledTime}
                            </Text>
                          )}
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={12}
                          color="#64748b"
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })()}

      {/* ── SEZIONE 4: Lista schematica dei mezzi senza alcun troncamento del testo ── */}
      {loading && !boardData ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#60a5fa" />
          <Text style={styles.loadingText}>
            {originMode === "current_location" && isLocating && !userCoords
              ? "Rilevamento posizione GPS in corso..."
              : originMode === "current_location"
                ? "Calcolo percorso e mezzi dalla tua posizione..."
                : canUseLive
                  ? "Aggiornamento passaggi e coincidenze in tempo reale..."
                  : "Calcolo orari programmati e ultimo mezzo utile..."}
          </Text>
        </View>
      ) : displayedDepartures.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons
            name="information-circle-outline"
            size={18}
            color="#94a3b8"
          />
          <Text style={styles.emptyText}>
            {selectedLineFilter
              ? `Nessun passaggio trovato per la linea ${selectedLineFilter}`
              : "Nessuna corsa disponibile per questa fascia oraria"}
          </Text>
        </View>
      ) : (
        <View style={styles.departuresList}>
          {displayedDepartures.map((dep, index) => {
            const liveInfo = getDepartureLiveInfo(dep, index);
            const displayTime = liveInfo.displayTime;
            const countdown = liveInfo.countdownText;
            const dotColor = liveInfo.dotColor;
            const isLiveTrip = liveInfo.isLiveActive;
            const isSuggested = Boolean(
              dep.isSuggested ||
              dep.isOptimal ||
              (boardData?.optimalDeparture &&
                dep.id === boardData.optimalDeparture.id),
            );
            const isLastUseful = Boolean(
              boardData?.lastUsefulDeparture &&
              dep.id === boardData.lastUsefulDeparture.id,
            );

            return (
              <TouchableOpacity
                key={dep.id || `dep-${index}`}
                activeOpacity={0.8}
                onPress={() => openDepartureModal(dep)}
                style={[
                  styles.schematicCard,
                  isSuggested && styles.schematicCardSuggested,
                  !isSuggested &&
                    isLastUseful &&
                    styles.schematicCardLastUseful,
                ]}
              >
                {isLastUseful && (
                  <View style={styles.cardLastUsefulStrip}>
                    <View style={styles.lastUsefulRolePill}>
                      <Ionicons
                        name="timer-outline"
                        size={9}
                        color="#fbbf24"
                        style={{ marginRight: 2.5 }}
                      />
                      <Text style={styles.lastUsefulRolePillText}>
                        ULTIMA CORSA
                      </Text>
                    </View>
                  </View>
                )}

                {/* Riga 1: Badge Linea + Pallino Ufficiale Live a sinistra; Orario (giallo sopra + barrato sotto) a destra */}
                {(() => {
                  const hasDepTimeShift = Boolean(
                    dep.scheduledTime &&
                      displayTime &&
                      dep.scheduledTime !== displayTime,
                  );
                  const trafficMins = Math.max(0, dep.trafficDelayMinutes ?? 0);
                  const liveMins = Math.max(0, dep.liveDelayMinutes ?? 0);
                  const trafficIsHeavy = trafficMins >= 5;

                  return (
                    <>
                      {/* SEZIONE 1: Riga unica – badge linea | pallino/+Xm | orario | durata */}
                      <View style={styles.schematicTopRow}>
                        {/* Sinistra: numero bus + pallino ufficiale + eventuale ritardo live */}
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            minHeight: 24,
                            flex: 1,
                            minWidth: 0,
                            gap: 8,
                            marginRight: 8,
                          }}
                        >
                          <View style={{ flexShrink: 0 }}>
                            {renderLineBadges(dep)}
                          </View>

                          {isLiveTrip &&
                            dotColor &&
                            (liveMins > 0 ? (
                              <View style={styles.liveStatusDotWrap}>
                                <View
                                  style={[
                                    styles.liveStatusDot,
                                    { backgroundColor: dotColor },
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.liveDelayText,
                                    {
                                      color:
                                        liveMins >= 5 ? "#fca5a5" : "#fbbf24",
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  +{liveMins}m
                                </Text>
                              </View>
                            ) : (
                              <View
                                style={[
                                  styles.liveStatusDot,
                                  { backgroundColor: dotColor },
                                ]}
                              />
                            ))}
                        </View>

                        {/* Orario a destra: riga primaria allineata a bus/pallino, eventuale barrato sotto */}
                        <View style={styles.schematicTopRight}>
                          <View style={{ alignItems: "flex-end" }}>
                            <View
                              style={{
                                height: 24,
                                justifyContent: "center",
                                alignItems: "flex-end",
                              }}
                            >
                              <Text
                                style={[
                                  styles.departureTimeMain,
                                  hasDepTimeShift && { color: "#fbbf24" },
                                ]}
                                numberOfLines={1}
                              >
                                {displayTime}
                              </Text>
                            </View>
                            {hasDepTimeShift && (
                              <Text
                                style={[
                                  styles.timeScheduledStrike,
                                  { marginTop: 1 },
                                ]}
                                numberOfLines={1}
                              >
                                {dep.scheduledTime}
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>

                      {(!dep.isDirect || dep.transfersCount > 0) && (
                        <View style={styles.transferBadgeRow}>
                          <Ionicons
                            name="git-branch-outline"
                            size={11}
                            color="#c084fc"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.transferBadgeText}>
                            {dep.transfersCount && dep.transfersCount > 1
                              ? `Con ${dep.transfersCount} cambi`
                              : "Con un cambio"}
                          </Text>
                        </View>
                      )}

                      {/* SEZIONE 2: Riquadro direzione + traffico a sinistra + countdown a destra */}
                      <View style={styles.schematicBody}>
                        {/* Riga direzione con traffico + countdown */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          {/* Sinistra: Direzione (con chevron) */}
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 }}>
                            <Text style={styles.schemaFieldLabel}>Direzione:</Text>
                            <Text
                              style={[styles.schemaFieldValue, { flexShrink: 1 }]}
                              numberOfLines={1}
                            >
                              {dep.headsign}
                            </Text>
                            <Ionicons
                              name="chevron-forward"
                              size={13}
                              color="#64748b"
                              style={{ marginLeft: 4, flexShrink: 0 }}
                            />
                          </View>

                          {/* Destra: countdown compatto */}
                          {countdown && (
                            <Text
                              style={{
                                fontSize: 10.5,
                                fontWeight: "700",
                                color: "#34d399",
                                marginLeft: 8,
                                flexShrink: 0,
                              }}
                              numberOfLines={1}
                            >
                              {countdown}
                            </Text>
                          )}
                        </View>

                        {/* Riga traffico sotto direzione (solo se presente) */}
                        {trafficMins > 0 && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginTop: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: "#64748b",
                                fontSize: 10.5,
                                fontWeight: "700",
                                marginRight: 6,
                              }}
                            >
                              Ritardo aggiuntivo:
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <View
                                style={{
                                  width: 6.5,
                                  height: 6.5,
                                  borderRadius: 3.25,
                                  borderWidth: 1.5,
                                  borderColor: trafficIsHeavy
                                    ? "#f87171"
                                    : "#fbbf24",
                                  backgroundColor: "transparent",
                                }}
                              />
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: trafficIsHeavy ? "#f87171" : "#fbbf24",
                                }}
                              >
                                ~+{trafficMins}m traffico
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>
                    </>
                  );
                })()}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!selectedLineFilter &&
        boardData?.lastUsefulDeparture &&
        !displayedDepartures.some(
          (d) => d.id === boardData.lastUsefulDeparture!.id,
        ) &&
        (() => {
          const lastDep = boardData.lastUsefulDeparture!;
          const lastLiveInfo = getDepartureLiveInfo(lastDep, -1);
          const lastDepTime = lastLiveInfo.displayTime;
          const lastRideMins = getDepartureTransitSpanMinutes(lastDep);
          const lastDepMinsParsed = parseHHMMToMins(lastDepTime);
          const lastBusAlightingTime =
            lastDepMinsParsed >= 0
              ? minsToHHMM(lastDepMinsParsed + lastRideMins)
              : lastDep.alightingTime || lastDep.arrivalTime;
          return (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => openDepartureModal(lastDep)}
              style={styles.lastUsefulSummaryBar}
            >
              {/* Riga 1: Etichetta informativa Ultima Corsa (+ eventuali minuti di ritardo) a sinistra, Orario partenza -> discesa mezzo a destra */}
              <View style={styles.lastUsefulBarTopRow}>
                <View
                  style={[
                    styles.lastUsefulSummaryLeft,
                    { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
                  ]}
                >
                  <View style={styles.lastUsefulRolePill}>
                    <Ionicons
                      name="timer-outline"
                      size={9}
                      color="#fbbf24"
                      style={{ marginRight: 2.5 }}
                    />
                    <Text style={styles.lastUsefulRolePillText}>
                      ULTIMA CORSA
                    </Text>
                  </View>

                  {(() => {
                    const lastLiveMins = Math.max(0, lastDep.liveDelayMinutes ?? 0);
                    const lastTrafficMins = Math.max(0, lastDep.trafficDelayMinutes ?? 0);
                    return (
                      <>
                        {lastLiveInfo.isLiveActive &&
                          (lastLiveMins > 0 ? (
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <View
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor:
                                    lastLiveMins >= 5 ? "#ef4444" : "#f59e0b",
                                }}
                              />
                              <Text
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: "700",
                                  color:
                                    lastLiveMins >= 5 ? "#fca5a5" : "#fbbf24",
                                }}
                              >
                                +{lastLiveMins}m
                              </Text>
                            </View>
                          ) : (
                            <View
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 3.5,
                                backgroundColor: "#10b981",
                              }}
                            />
                          ))}
                        {lastTrafficMins > 0 && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                              paddingHorizontal: 5.5,
                              paddingVertical: 2,
                              borderRadius: 5,
                              borderWidth: 1,
                              borderStyle: "dashed",
                              borderColor:
                                lastTrafficMins >= 5
                                  ? "rgba(239, 68, 68, 0.44)"
                                  : "rgba(251, 191, 36, 0.42)",
                              backgroundColor:
                                lastTrafficMins >= 5
                                  ? "rgba(239, 68, 68, 0.10)"
                                  : "rgba(251, 191, 36, 0.08)",
                            }}
                          >
                            <View
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                borderWidth: 1.5,
                                borderColor:
                                  lastTrafficMins >= 5 ? "#f87171" : "#fbbf24",
                              }}
                            />
                            <Text
                              style={{
                                fontSize: 9.5,
                                fontWeight: "700",
                                color:
                                  lastTrafficMins >= 5 ? "#f87171" : "#fbbf24",
                              }}
                            >
                              +{lastTrafficMins}m traffico
                            </Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                </View>

                <View style={styles.lastUsefulSummaryRight}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 5,
                    }}
                  >
                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={[
                          styles.lastUsefulSummaryTime,
                          lastDep.scheduledTime &&
                            lastDep.scheduledTime !== lastDepTime && {
                              color: "#fbbf24",
                            },
                        ]}
                      >
                        {lastDepTime}
                      </Text>
                      {lastDep.scheduledTime &&
                        lastDep.scheduledTime !== lastDepTime && (
                          <Text style={styles.timeScheduledStrike}>
                            {lastDep.scheduledTime}
                          </Text>
                        )}
                    </View>
                    {lastBusAlightingTime ? (
                      <>
                        <Text style={styles.lastUsefulSummaryTime}>→</Text>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text
                            style={[
                              styles.lastUsefulSummaryTime,
                              lastDep.scheduledAlightingTime &&
                                lastDep.scheduledAlightingTime !==
                                  lastBusAlightingTime && { color: "#fbbf24" },
                            ]}
                          >
                            {lastBusAlightingTime}
                          </Text>
                          {lastDep.scheduledAlightingTime &&
                            lastDep.scheduledAlightingTime !==
                              lastBusAlightingTime && (
                              <Text style={styles.timeScheduledStrike}>
                                {lastDep.scheduledAlightingTime}
                              </Text>
                            )}
                        </View>
                      </>
                    ) : null}
                  </View>
                </View>
              </View>

              {/* Riga 2: Numero/badge bus + Direzione/fermata separati dagli orari */}
              <View style={styles.lastUsefulBarBottomRow}>
                <View style={styles.lastUsefulBarLineAndDest}>
                  {renderLineBadges(lastDep, true)}
                  <Text
                    style={styles.lastUsefulSummaryHeadsign}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {lastDep.headsign || lastDep.fromStop}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={13}
                  color="#fbbf24"
                  style={{ marginLeft: 6 }}
                />
              </View>
            </TouchableOpacity>
          );
        })()}

      {/* Pulsante espansione corse a due livelli (intorno mezz'ora -> limite d'ora -> riduci) */}
      {filteredDepartures.length > 3 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleToggleExpansion}
          style={styles.expandButton}
        >
          <Text style={styles.expandButtonText}>
            {expansionLevel === "collapsed"
              ? halfHourDepartures.length > 3 &&
                halfHourDepartures.length < filteredDepartures.length
                ? "Mostra corse (+30 min)"
                : `Mostra altre corse (${filteredDepartures.length - 3})`
              : expansionLevel === "half_hour" &&
                  filteredDepartures.length > displayedDepartures.length
                ? `Mostra tutte le altre corse (${filteredDepartures.length - displayedDepartures.length})`
                : "Riduci corse"}
          </Text>
          <Ionicons
            name={
              expansionLevel === "full" ||
              (expansionLevel === "half_hour" &&
                filteredDepartures.length <= displayedDepartures.length)
                ? "chevron-up"
                : "chevron-down"
            }
            size={12}
            color="#60a5fa"
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>
      )}

      {/* ── SEZIONE 5: Nuovo Modale di Dettaglio con Mappa Interattiva ── */}
      <TransitDepartureModal
        visible={Boolean(selectedDepartureModal)}
        departure={selectedDepartureModal}
        allDepartures={
          unfilteredDisplayedDepartures.length > 0
            ? unfilteredDisplayedDepartures
            : boardData?.departures || []
        }
        directLines={visibleDirectLines}
        isLiveContext={canUseLive}
        theme={theme}
        onClose={() => setSelectedDepartureModal(null)}
        onSelectDeparture={(newDep) => openDepartureModal(newDep)}
        onRefreshDeparture={handleRefreshModalDeparture}
        lastUpdatedLabel={boardData?.lastUpdated}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    borderRadius: CARD_RADIUS.card,
    borderWidth: 1,
    padding: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  headerIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  refreshCircleBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#1e2230",
    borderWidth: 1,
    borderColor: "#2e3446",
    alignItems: "center",
    justifyContent: "center",
  },
  unifiedOriginWrapper: {
    marginBottom: 10,
  },
  unifiedOriginCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0c0e14",
    paddingVertical: 7.5,
    paddingHorizontal: 9.5,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "#1e2433",
  },
  unifiedOriginCardGps: {
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  unifiedOriginIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
    flexShrink: 0,
  },
  unifiedOriginIconBoxDefault: {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.28)",
  },
  unifiedOriginIconBoxGps: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  unifiedOriginTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  unifiedOriginSectionLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: 5,
    paddingLeft: 2,
    textTransform: "uppercase",
  },
  unifiedOriginMainText: {
    color: "#f8fafc",
    fontSize: 13.5,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  unifiedOriginMainTextGps: {
    color: "#34d399",
  },
  unifiedOriginSubText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  unifiedOriginSubTextGps: {
    color: "#6ee7b7",
  },
  compactSwitchPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4.5,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    marginLeft: 8,
    flexShrink: 0,
  },
  compactSwitchPillToGps: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  compactSwitchPillToDefault: {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  compactSwitchPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  compactSwitchPillTextToGps: {
    color: "#10b981",
  },
  compactSwitchPillTextToDefault: {
    color: "#60a5fa",
  },
  errorNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorNoticeText: {
    flex: 1,
    color: "#f87171",
    fontSize: 10.5,
    fontWeight: "500",
  },
  chipsSection: {
    marginBottom: 10,
  },
  chipsLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  lineChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  lineChipText: {
    fontSize: 11,
  },
  resetFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 4.5,
    borderRadius: 8,
    backgroundColor: "#1e2230",
    borderWidth: 1,
    borderColor: "#32384a",
  },
  resetFilterText: {
    color: "#94a3b8",
    fontSize: 10,
    marginLeft: 2,
    fontWeight: "600",
  },
  loadingBox: {
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
  },
  emptyBox: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 11,
    textAlign: "center",
  },
  departuresList: {
    gap: 8,
    marginTop: 2,
  },
  schematicCard: {
    backgroundColor: "#181b24",
    borderRadius: CARD_RADIUS.cardInner,
    padding: 10,
    borderWidth: 1,
    borderColor: "#252a38",
  },
  schematicCardSuggested: {
    borderColor: "rgba(96, 165, 250, 0.45)",
    borderWidth: 1.5,
    backgroundColor: "#191f2e",
  },
  schematicTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  schematicTopLeft: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginRight: 8,
  },
  schematicTopRight: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  schematicTimeAndDurationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  multiLegBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  },
  lineBadgeBoxCompact: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lineBadgeTextCompact: {
    color: "#ffffff",
    fontSize: 10.5,
    fontWeight: "800",
  },
  durationInlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.32)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    minHeight: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  durationInlineBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#cbd5e1",
    includeFontPadding: false,
  },
  transferBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 7,
  },
  transferBadgeText: {
    color: "#c084fc",
    fontSize: 10.5,
    fontWeight: "700",
  },
  lineBadgeBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    minHeight: 24,
    borderRadius: 7,
    minWidth: 50,
    justifyContent: "center",
  },
  lineBadgeText: {
    color: "#ffffff",
    fontSize: 11.5,
    fontWeight: "800",
    includeFontPadding: false,
  },
  liveStatusDotWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  liveStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  liveDelayText: {
    color: "#fbbf24",
    fontSize: 10.5,
    fontWeight: "700",
    includeFontPadding: false,
  },
  timeScheduledStrike: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
    textDecorationLine: "line-through",
    includeFontPadding: false,
  },
  departureTimeMain: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.3,
    includeFontPadding: false,
  },
  countdownBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 7,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  countdownText: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "600",
    includeFontPadding: false,
  },
  schematicBody: {
    backgroundColor: "#11141c",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 4,
    borderWidth: 1,
    borderColor: "#1e2330",
  },
  schemaFieldRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  schemaFieldLabel: {
    color: "#64748b",
    fontSize: 10.5,
    fontWeight: "700",
    width: 66,
    marginTop: 0.5,
  },
  schemaFieldValue: {
    flex: 1,
    color: "#f1f5f9",
    fontSize: 11.5,
    fontWeight: "600",
    lineHeight: 16,
  },
  depAlertBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.28)",
  },
  depAlertText: {
    flex: 1,
    color: "#fbbf24",
    fontSize: 10.5,
    fontWeight: "600",
    lineHeight: 15,
  },
  schematicFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#222736",
  },
  footerMetaLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  footerMetaText: {
    color: "#94a3b8",
    fontSize: 10.5,
    fontWeight: "600",
  },
  footerActionRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  footerActionText: {
    color: "#60a5fa",
    fontSize: 10.5,
    fontWeight: "700",
  },
  expandButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#1c202c",
  },
  expandButtonText: {
    color: "#60a5fa",
    fontSize: 11,
    fontWeight: "600",
  },
  headerTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  headerLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    borderRadius: 5,
    paddingHorizontal: 5.5,
    paddingVertical: 1.5,
    gap: 4,
  },
  headerLiveDot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 3,
    backgroundColor: "#34d399",
  },
  headerLiveText: {
    color: "#34d399",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  schematicCardLastUseful: {
    borderColor: "rgba(245, 158, 11, 0.48)",
    borderWidth: 1.25,
    backgroundColor: "#1e1a16",
  },
  cardLastUsefulStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 7,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(245, 158, 11, 0.2)",
  },
  lastUsefulRolePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    borderRadius: 5,
    paddingHorizontal: 5.5,
    paddingVertical: 2,
  },
  lastUsefulRolePillText: {
    color: "#fbbf24",
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  lastUsefulSummaryBar: {
    flexDirection: "column",
    gap: 7,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8.5,
    borderRadius: CARD_RADIUS.cardInner,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.34)",
  },
  lastUsefulBarTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  lastUsefulBarBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  lastUsefulBarLineAndDest: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
  },
  lastUsefulSummaryLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  lastUsefulSummaryRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  lastUsefulSummaryTime: {
    color: "#fde68a",
    fontSize: 11.5,
    fontWeight: "800",
  },
  lastUsefulSummaryCountdown: {
    color: "#34d399",
    fontSize: 10.5,
    fontWeight: "700",
  },
  lastUsefulSummaryHeadsign: {
    flex: 1,
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "600",
    minWidth: 0,
  },
});
