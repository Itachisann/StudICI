import { AppTheme, CARD_RADIUS } from "@/constants/theme";
import { DisruptionCategory, DisruptionEvent } from "@/types/disruptions";
import {
  formatDisruptionModalTimeWindow,
  getDisruptionActiveWindowForDate,
  isTrainStrikeImpactingCommuter,
  isWalkDisruptionImpactingCommuter,
  parseDisruptionSchedule,
} from "@/utils/disruptionsService";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MenuAction, MenuView } from "@expo/ui/community/menu";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Platform,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { NativeSheetModal } from "./NativeSheetModal";

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

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DisruptionsRegistryModalProps {
  visible: boolean;
  onClose: () => void;
  disruptions: DisruptionEvent[];
  loading?: boolean;
  onRefresh?: () => void;
  theme?: AppTheme;
  initialFilter?: "all" | "train" | "walk" | "transit";
  activeStationName?: string;
  /** Data (YYYY-MM-DD) del giorno selezionato nella schermata Viaggio */
  selectedDateIso?: string;
  highlightEventId?: string | null;
  highlightEventIds?: string[];
}

type FilterMode = "all" | "train" | "walk" | "protests" | "transit";
type PersistedFilterMode = "all" | "train" | "walk" | "protests";
type DayScope = "selected" | "all";

const DISRUPTIONS_MODAL_PREFS_KEY = "@studici_disruptions_modal_prefs_v1";
let cachedModalPrefs: {
  dayScope: DayScope;
  onlyMyRoute: boolean;
  filterMode: PersistedFilterMode;
} = {
  dayScope: "selected",
  onlyMyRoute: true,
  filterMode: "all",
};
let modalPrefsHydrated = false;

interface DisruptionSection {
  key: string;
  title: string;
  isSelectedDayHighlight?: boolean;
  hasPinned: boolean;
  sortKey: string;
  data: DisruptionEvent[];
}

const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const WEEKDAYS_LONG = [
  "Domenica",
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
];
const MONTHS_LONG = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

function formatDayLongLabel(iso: string): string {
  const d = dateFromIso(iso);
  if (!d) return iso;
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

function formatSectionDateTitle(iso: string, todayIso: string): string {
  const longLabel = formatDayLongLabel(iso);
  if (iso === todayIso) return `Oggi · ${longLabel}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === isoFromDate(tomorrow)) return `Domani · ${longLabel}`;
  return longLabel;
}

function formatSectionRangeTitle(
  startIso: string,
  endIso: string,
  todayIso: string,
): string {
  const startD = dateFromIso(startIso);
  const endD = dateFromIso(endIso);
  if (!startD || !endD) return `${formatShortIso(startIso)} – ${formatShortIso(endIso)}`;

  const sameMonth =
    startD.getMonth() === endD.getMonth() &&
    startD.getFullYear() === endD.getFullYear();
  const baseRange = sameMonth
    ? `Dal ${startD.getDate()} al ${endD.getDate()} ${MONTHS_LONG[endD.getMonth()]}`
    : `Dal ${startD.getDate()} ${MONTHS_LONG[startD.getMonth()]} al ${endD.getDate()} ${MONTHS_LONG[endD.getMonth()]}`;

  if (startIso <= todayIso && endIso >= todayIso) {
    return `In corso · ${baseRange}`;
  }
  return baseRange;
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateFromIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatShortIso(iso: string): string {
  const parts = (iso || "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso;
}

function formatSingleDateLabel(iso: string, todayIso: string): string {
  const d = dateFromIso(iso);
  if (!d) return iso;
  const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (iso === todayIso) return `Oggi · ${ddmm}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === isoFromDate(tomorrow)) return `Domani · ${ddmm}`;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${ddmm}`;
}

function formatMinutesClock(mins: number): string {
  const safe = Math.max(0, Math.min(1440, Math.round(mins)));
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${String(safe === 1440 ? 24 : h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatActiveWindow(startMins: number, endMins: number): string {
  if (startMins <= 0 && endMins >= 1440) return "tutto il giorno";
  if (startMins <= 0) return `fino alle ${formatMinutesClock(endMins)}`;
  if (endMins >= 1440) return `dalle ${formatMinutesClock(startMins)}`;
  return `${formatMinutesClock(startMins)} – ${formatMinutesClock(endMins)}`;
}

function getCategoryConfig(category: DisruptionCategory): {
  label: string;
  color: string;
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  switch (category) {
    case "sciopero_treni":
      return {
        label: "Sciopero treni",
        color: "#ef4444",
        bg: "rgba(239, 68, 68, 0.16)",
        icon: "train",
      };
    case "sciopero_tpl":
      return {
        label: "Sciopero mezzi",
        color: "#f97316",
        bg: "rgba(249, 115, 22, 0.16)",
        icon: "bus",
      };
    case "manifestazione":
      return {
        label: "Manifestazione",
        color: "#38bdf8",
        bg: "rgba(56, 189, 248, 0.16)",
        icon: "megaphone",
      };
    case "blocco_stradale":
      return {
        label: "Blocco / deviazione",
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.16)",
        icon: "warning",
      };
    case "cantiere_viabilita":
      return {
        label: "Viabilità",
        color: "#a855f7",
        bg: "rgba(168, 85, 247, 0.16)",
        icon: "construct",
      };
    default:
      return {
        label: "Avviso mobilità",
        color: "#94a3b8",
        bg: "rgba(148, 163, 184, 0.16)",
        icon: "information-circle",
      };
  }
}

const DisruptionsRegistryModalContent: React.FC<
  DisruptionsRegistryModalProps
> = ({
  visible,
  onClose,
  disruptions,
  loading = false,
  onRefresh,
  theme,
  initialFilter = "all",
  activeStationName,
  selectedDateIso,
  highlightEventId,
  highlightEventIds,
}) => {
  const primaryColor = theme?.primary || "#0284c7";
  const accent = theme?.accent || primaryColor;
  const todayIso = useMemo(() => isoFromDate(new Date()), []);
  const targetDayIso = useMemo(
    () =>
      selectedDateIso && dateFromIso(selectedDateIso)
        ? selectedDateIso
        : todayIso,
    [selectedDateIso, todayIso],
  );

  const [filterMode, setFilterMode] = useState<FilterMode>(
    () => cachedModalPrefs.filterMode,
  );

  const [dayScope, setDayScope] = useState<DayScope>(cachedModalPrefs.dayScope);
  const [onlyMyRoute, setOnlyMyRoute] = useState<boolean>(
    cachedModalPrefs.onlyMyRoute,
  );

  useEffect(() => {
    if (modalPrefsHydrated) return;
    let active = true;
    AsyncStorage.getItem(DISRUPTIONS_MODAL_PREFS_KEY)
      .then((raw) => {
        modalPrefsHydrated = true;
        if (!raw || !active) return;
        const parsed = JSON.parse(raw) as Partial<{
          dayScope: DayScope;
          onlyMyRoute: boolean;
          filterMode: PersistedFilterMode;
        }>;
        if (parsed.dayScope === "selected" || parsed.dayScope === "all") {
          cachedModalPrefs = { ...cachedModalPrefs, dayScope: parsed.dayScope };
          setDayScope(parsed.dayScope);
        }
        if (typeof parsed.onlyMyRoute === "boolean") {
          cachedModalPrefs = {
            ...cachedModalPrefs,
            onlyMyRoute: parsed.onlyMyRoute,
          };
          setOnlyMyRoute(parsed.onlyMyRoute);
        }
        if (
          parsed.filterMode === "all" ||
          parsed.filterMode === "train" ||
          parsed.filterMode === "walk" ||
          parsed.filterMode === "protests"
        ) {
          cachedModalPrefs = {
            ...cachedModalPrefs,
            filterMode: parsed.filterMode,
          };
          setFilterMode(parsed.filterMode);
        }
      })
      .catch(() => {
        modalPrefsHydrated = true;
      });
    return () => {
      active = false;
    };
  }, []);

  const persistModalPrefs = useCallback(
    (
      next: Partial<{
        dayScope: DayScope;
        onlyMyRoute: boolean;
        filterMode: PersistedFilterMode;
      }>,
    ) => {
      cachedModalPrefs = { ...cachedModalPrefs, ...next };
      modalPrefsHydrated = true;
      AsyncStorage.setItem(
        DISRUPTIONS_MODAL_PREFS_KEY,
        JSON.stringify(cachedModalPrefs),
      ).catch(() => {});
    },
    [],
  );

  const handleChangeFilterMode = useCallback(
    (nextMode: PersistedFilterMode) => {
      setFilterMode(nextMode);
      persistModalPrefs({ filterMode: nextMode });
    },
    [persistModalPrefs],
  );

  const handleChangeDayScope = useCallback(
    (nextScope: DayScope) => {
      setDayScope(nextScope);
      persistModalPrefs({ dayScope: nextScope });
    },
    [persistModalPrefs],
  );

  const handleChangeOnlyMyRoute = useCallback(
    (nextVal: boolean) => {
      setOnlyMyRoute(nextVal);
      persistModalPrefs({ onlyMyRoute: nextVal });
    },
    [persistModalPrefs],
  );
  const sectionListRef =
    useRef<SectionList<DisruptionEvent, DisruptionSection>>(null);
  const [highlightedIdSet, setHighlightedIdSet] = useState<Set<string>>(
    new Set(),
  );
  const [pinnedIdSet, setPinnedIdSet] = useState<Set<string>>(new Set());
  const [prevHighlightSig, setPrevHighlightSig] = useState<string>("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [highlightAnim] = useState(() => new Animated.Value(0));

  const incomingHighlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (highlightEventIds && highlightEventIds.length > 0) {
      for (const id of highlightEventIds) {
        if (id) ids.add(id);
      }
    } else if (highlightEventId) {
      ids.add(highlightEventId);
    }
    return Array.from(ids);
  }, [highlightEventId, highlightEventIds]);

  const incomingHighlightSig = incomingHighlightIds.join("|");

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (
    visible &&
    incomingHighlightIds.length > 0 &&
    prevHighlightSig !== incomingHighlightSig
  ) {
    setPrevHighlightSig(incomingHighlightSig);
    const nextSet = new Set(incomingHighlightIds);
    setHighlightedIdSet(nextSet);
    setPinnedIdSet(nextSet);
    // Le descrizioni/note rimangono chiuse di default e si espandono solo al tocco dell'utente
    setExpandedIds(new Set());

    const targets = disruptions.filter((d) => nextSet.has(d.id));

    // Se l'utente ha toccato dalla Hero Card uno sciopero/avviso non attivo nel giorno scelto
    // mentre il filtro salvato è su "Giorno scelto", passa temporaneamente a "Tutti" così è visibile.
    if (targets.length > 0 && dayScope === "selected") {
      const allActiveOnSelected = targets.every(
        (t) => getDisruptionActiveWindowForDate(t, targetDayIso) !== null,
      );
      if (!allActiveOnSelected) {
        setDayScope("all");
      }
    }
  } else if (
    !visible &&
    (prevHighlightSig !== "" ||
      highlightedIdSet.size > 0 ||
      pinnedIdSet.size > 0)
  ) {
    setPrevHighlightSig("");
    setHighlightedIdSet(new Set());
    setPinnedIdSet(new Set());
    setExpandedIds(new Set());
  }

  // Animazione del bordino rosso di selezione che sfuma dolcemente dopo alcuni secondi
  useEffect(() => {
    if (!visible || highlightedIdSet.size === 0) {
      highlightAnim.setValue(0);
      return;
    }
    highlightAnim.setValue(1);
    const fadeAnim = Animated.sequence([
      Animated.delay(2400),
      Animated.timing(highlightAnim, {
        toValue: 0,
        duration: 950,
        useNativeDriver: false,
      }),
    ]);
    fadeAnim.start(({ finished }) => {
      if (finished) {
        setHighlightedIdSet(new Set());
      }
    });
    return () => {
      fadeAnim.stop();
    };
  }, [visible, incomingHighlightSig, highlightedIdSet.size, highlightAnim]);

  const isImpactingCommuter = (d: DisruptionEvent): boolean =>
    d.category === "sciopero_treni"
      ? isTrainStrikeImpactingCommuter(d)
      : isWalkDisruptionImpactingCommuter(d, activeStationName);

  // 1) Base: filtro "Giorno scelto" / "Tutti" + filtro "Solo sul mio tragitto"
  // Include automaticamente nel "Giorno scelto" anche gli scioperi multi-giorno che lo attraversano.
  const baseList = useMemo(() => {
    let list = [...disruptions];
    if (dayScope === "selected") {
      list = list.filter(
        (d) => getDisruptionActiveWindowForDate(d, targetDayIso) !== null,
      );
    }
    if (onlyMyRoute) {
      list = list.filter(isImpactingCommuter);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disruptions, dayScope, targetDayIso, onlyMyRoute, activeStationName]);

  const trainCount = useMemo(
    () => baseList.filter((d) => d.affectedModes.includes("train")).length,
    [baseList],
  );
  const urbanCount = useMemo(
    () =>
      baseList.filter(
        (d) =>
          d.category !== "manifestazione" &&
          (d.affectedModes.includes("walk") ||
            d.affectedModes.includes("transit")),
      ).length,
    [baseList],
  );
  const protestsCount = useMemo(
    () => baseList.filter((d) => d.category === "manifestazione").length,
    [baseList],
  );

  const totalAllDaysCount = useMemo(() => {
    const pool = onlyMyRoute
      ? disruptions.filter(isImpactingCommuter)
      : disruptions;
    return pool.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disruptions, onlyMyRoute, activeStationName]);

  const filteredDisruptions = useMemo(() => {
    let list = baseList;
    if (filterMode === "train") {
      list = list.filter((d) => d.affectedModes.includes("train"));
    } else if (filterMode === "protests") {
      list = list.filter((d) => d.category === "manifestazione");
    } else if (filterMode === "walk" || filterMode === "transit") {
      list = list.filter(
        (d) =>
          d.category !== "manifestazione" &&
          (d.affectedModes.includes("walk") ||
            d.affectedModes.includes("transit")),
      );
    }

    // Se il modale è stato aperto toccando un badge nella schermata Viaggio,
    // porta le card selezionate in cima alla lista senza creare sezioni artificiali
    if (pinnedIdSet.size > 0) {
      const pinned: DisruptionEvent[] = [];
      const others: DisruptionEvent[] = [];
      for (const item of list) {
        if (pinnedIdSet.has(item.id)) {
          pinned.push(item);
        } else {
          others.push(item);
        }
      }
      return [...pinned, ...others];
    }

    return list;
  }, [baseList, filterMode, pinnedIdSet]);

  const sections = useMemo<DisruptionSection[]>(() => {
    const compareByProximity = (
      a: DisruptionEvent,
      b: DisruptionEvent,
      refIso: string,
    ): number => {
      const aPinned = pinnedIdSet.has(a.id);
      const bPinned = pinnedIdSet.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aStart = a.startDate || "9999-12-31";
      const bStart = b.startDate || "9999-12-31";
      const aDist = Math.abs(
        (dateFromIso(aStart)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (dateFromIso(todayIso)?.getTime() ?? 0),
      );
      const bDist = Math.abs(
        (dateFromIso(bStart)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (dateFromIso(todayIso)?.getTime() ?? 0),
      );
      const aActiveRef = getDisruptionActiveWindowForDate(a, refIso);
      const bActiveRef = getDisruptionActiveWindowForDate(b, refIso);
      if (aActiveRef && bActiveRef) {
        if (aActiveRef.startMinuteOfDay !== bActiveRef.startMinuteOfDay) {
          return aActiveRef.startMinuteOfDay - bActiveRef.startMinuteOfDay;
        }
      }
      if (aStart !== bStart) {
        if (aStart >= todayIso && bStart >= todayIso) {
          return aStart.localeCompare(bStart);
        }
        return aDist - bDist;
      }
      const aSched = parseDisruptionSchedule(a);
      const bSched = parseDisruptionSchedule(b);
      const aMins = aSched.startHour * 60 + aSched.startMinute;
      const bMins = bSched.startHour * 60 + bSched.startMinute;
      return aMins - bMins;
    };

    if (dayScope === "selected") {
      if (filteredDisruptions.length === 0) return [];
      const sorted = [...filteredDisruptions].sort((a, b) =>
        compareByProximity(a, b, targetDayIso),
      );
      return [
        {
          key: `sec-selected-${targetDayIso}`,
          title: formatSectionDateTitle(targetDayIso, todayIso),
          isSelectedDayHighlight: true,
          hasPinned:
            pinnedIdSet.size > 0 && sorted.some((i) => pinnedIdSet.has(i.id)),
          sortKey: targetDayIso,
          data: sorted,
        },
      ];
    }

    // Modalità "Tutti":
    // 1) Gli avvisi attivi nel giorno scelto vengono raggruppati in evidenza in cima.
    // 2) Tutti gli altri sono classificati per data (o intervallo per i multi-giorno) e ordinati per vicinanza a oggi.
    const selectedDayItems: DisruptionEvent[] = [];
    const groups = new Map<
      string,
      {
        title: string;
        sortKey: string;
        refIso: string;
        items: DisruptionEvent[];
      }
    >();

    for (const item of filteredDisruptions) {
      if (getDisruptionActiveWindowForDate(item, targetDayIso) !== null) {
        selectedDayItems.push(item);
        continue;
      }
      const isMultiDay =
        Boolean(item.startDate && item.endDate) &&
        item.startDate !== item.endDate;
      const isActiveToday =
        getDisruptionActiveWindowForDate(item, todayIso) !== null;
      const effStart =
        item.startDate && item.startDate >= todayIso ? item.startDate : todayIso;

      const bucketKey = isMultiDay
        ? `range:${item.startDate}:${item.endDate}`
        : `day:${effStart}`;
      const bucketSortKey = isMultiDay
        ? `${isActiveToday ? todayIso : effStart}_${item.endDate}`
        : effStart;
      const bucketTitle = isMultiDay
        ? formatSectionRangeTitle(item.startDate, item.endDate, todayIso)
        : formatSectionDateTitle(effStart, todayIso);
      const bucketRefIso = isActiveToday ? todayIso : effStart;

      const existing = groups.get(bucketKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(bucketKey, {
          title: bucketTitle,
          sortKey: bucketSortKey,
          refIso: bucketRefIso,
          items: [item],
        });
      }
    }

    const built: DisruptionSection[] = [];

    if (selectedDayItems.length > 0) {
      const sortedSelected = [...selectedDayItems].sort((a, b) =>
        compareByProximity(a, b, targetDayIso),
      );
      built.push({
        key: `sec-highlight-${targetDayIso}`,
        title:
          targetDayIso === todayIso
            ? `In evidenza · ${formatSectionDateTitle(targetDayIso, todayIso)}`
            : `In evidenza · Giorno scelto (${formatSectionDateTitle(targetDayIso, todayIso)})`,
        isSelectedDayHighlight: true,
        hasPinned:
          pinnedIdSet.size > 0 &&
          sortedSelected.some((i) => pinnedIdSet.has(i.id)),
        sortKey: "0000-00-00",
        data: sortedSelected,
      });
    }

    const otherSections: DisruptionSection[] = Array.from(groups.entries()).map(
      ([key, grp]) => {
        const sorted = [...grp.items].sort((a, b) =>
          compareByProximity(a, b, grp.refIso),
        );
        return {
          key: `sec-${key}`,
          title: grp.title,
          isSelectedDayHighlight: false,
          hasPinned:
            pinnedIdSet.size > 0 && sorted.some((i) => pinnedIdSet.has(i.id)),
          sortKey: grp.sortKey,
          data: sorted,
        };
      },
    );

    otherSections.sort((a, b) => {
      if (a.hasPinned !== b.hasPinned) return a.hasPinned ? -1 : 1;
      return a.sortKey.localeCompare(b.sortKey);
    });

    if (
      pinnedIdSet.size > 0 &&
      built.length > 0 &&
      !built[0].hasPinned &&
      otherSections.some((s) => s.hasPinned)
    ) {
      // Se l'utente ha tappato dalla Hero Card un avviso di un altro giorno, porta in cima la sua sezione
      return [...otherSections, ...built];
    }

    return [...built, ...otherSections];
  }, [filteredDisruptions, todayIso, targetDayIso, dayScope, pinnedIdSet]);

  // Scroll automatico in cima quando si apre da un badge specifico
  useEffect(() => {
    if (visible && incomingHighlightIds.length > 0) {
      const scrollTimer = setTimeout(() => {
        try {
          if (sections.length > 0) {
            sectionListRef.current?.scrollToLocation({
              sectionIndex: 0,
              itemIndex: 0,
              animated: true,
              viewOffset: 0,
            });
          }
        } catch {}
      }, 280);

      return () => {
        clearTimeout(scrollTimer);
      };
    }
  }, [
    visible,
    incomingHighlightSig,
    incomingHighlightIds.length,
    sections.length,
  ]);

  const renderDisruptionItem = ({ item }: { item: DisruptionEvent }) => {
    const cat = getCategoryConfig(item.category);
    const isTrain = item.category === "sciopero_treni";
    const impacting = isImpactingCommuter(item);
    const impactColor = isTrain ? "#ef4444" : "#f59e0b";
    const isHighlighted = highlightedIdSet.has(item.id);
    const isExpanded = expandedIds.has(item.id);
    const hasBodyNotes = Boolean(item.notes && item.notes !== item.timeWindow);
    const hasNotes = Boolean(hasBodyNotes || item.unions);
    const isMultiDay =
      Boolean(item.startDate && item.endDate) &&
      item.startDate !== item.endDate;

    const targetWin = getDisruptionActiveWindowForDate(item, targetDayIso);
    const isActiveOnTargetDay = targetWin !== null;
    const isActiveToday =
      getDisruptionActiveWindowForDate(item, todayIso) !== null;

    const animatedBorderColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ["rgba(255, 255, 255, 0.08)", "rgba(239, 68, 68, 0.85)"],
    });
    const animatedBgColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ["#1c1c1e", "rgba(239, 68, 68, 0.08)"],
    });

    const modalTimeText = formatDisruptionModalTimeWindow(item);
    const targetWindowLabel =
      isActiveOnTargetDay && targetWin
        ? formatActiveWindow(targetWin.startMinuteOfDay, targetWin.endMinuteOfDay)
        : null;

    const dateBadgeLabel = isMultiDay
      ? `Dal ${formatShortIso(item.startDate)} al ${formatShortIso(item.endDate)}`
      : item.startDate
        ? formatSingleDateLabel(item.startDate, todayIso)
        : item.formattedDateSpan;

    return (
      <Animated.View
        style={[
          styles.card,
          isHighlighted && {
            borderColor: animatedBorderColor,
            backgroundColor: animatedBgColor,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={hasNotes ? 0.85 : 1}
          onPress={hasNotes ? () => toggleExpand(item.id) : undefined}
        >
          {/* Intestazione: icona categoria + tipo + pill data (singola o multi-giorno) */}
          <View style={styles.cardHeader}>
            <View style={[styles.catIcon, { backgroundColor: cat.bg }]}>
              <Ionicons name={cat.icon} size={17} color={cat.color} />
            </View>

            <View style={styles.cardHeaderText}>
              <Text style={[styles.catLabel, { color: cat.color }]}>
                {cat.label}
              </Text>
              {isMultiDay && (
                <Text style={styles.multiDaySubLabel}>
                  {isActiveToday ? "In corso oggi · più giorni" : "Più giorni"}
                </Text>
              )}
            </View>

            <View
              style={[
                styles.datePill,
                isActiveToday && {
                  backgroundColor: `${primaryColor}22`,
                  borderColor: `${accent}66`,
                },
              ]}
            >
              {isActiveToday ? (
                <View
                  style={[styles.todayDot, { backgroundColor: accent }]}
                />
              ) : (
                <Ionicons
                  name="calendar-outline"
                  size={11}
                  color="#94a3b8"
                  style={{ marginRight: 4 }}
                />
              )}
              <Text
                style={[
                  styles.datePillText,
                  isActiveToday && { color: "#ffffff", fontWeight: "700" },
                ]}
              >
                {dateBadgeLabel}
              </Text>
            </View>
          </View>

          {/* Titolo */}
          <Text style={styles.cardTitle}>{item.title}</Text>

          {/* Stato impatto sul tragitto: riga pulita in stile iOS */}
          <View style={styles.impactLine}>
            <Ionicons
              name={impacting ? "alert-circle" : "checkmark-circle-outline"}
              size={14}
              color={impacting ? impactColor : "#8e8e93"}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[
                styles.impactLineText,
                { color: impacting ? impactColor : "#8e8e93" },
              ]}
            >
              {impacting
                ? isTrain
                  ? "Impatta la tua tratta"
                  : "Impatta il tuo tragitto"
                : `Non impatta il tuo tragitto${item.aiNonImpactReason ? ` · ${item.aiNonImpactReason}` : ""}`}
            </Text>
          </View>

          {/* Dettagli raggruppati in stile iOS (inset grouped) */}
          {(Boolean(modalTimeText) ||
            Boolean(item.affectedCompanies) ||
            Boolean(item.affectedAreas && item.affectedAreas.length > 0)) && (
            <View style={styles.detailsGroup}>
              {Boolean(modalTimeText) && (
                <View style={styles.detailRow}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color="#f59e0b"
                    style={styles.detailIcon}
                  />
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailLabel}>Orari e durata</Text>
                    <Text style={styles.detailValue}>{modalTimeText}</Text>
                    {isMultiDay && targetWindowLabel && (
                      <Text
                        style={[styles.todayWindowNote, { color: accent }]}
                      >
                        {targetDayIso === todayIso
                          ? `Oggi attivo: ${targetWindowLabel}`
                          : `Attivo il ${formatShortIso(targetDayIso)}: ${targetWindowLabel}`}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {Boolean(item.affectedCompanies) && (
                <View
                  style={[
                    styles.detailRow,
                    Boolean(modalTimeText) && styles.detailRowDivider,
                  ]}
                >
                  <Ionicons
                    name="business-outline"
                    size={14}
                    color="#38bdf8"
                    style={styles.detailIcon}
                  />
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailLabel}>Coinvolti</Text>
                    <Text style={styles.detailValue}>
                      {item.affectedCompanies}
                    </Text>
                  </View>
                </View>
              )}

              {Boolean(item.affectedAreas && item.affectedAreas.length > 0) && (
                <View
                  style={[
                    styles.detailRow,
                    (Boolean(modalTimeText) ||
                      Boolean(item.affectedCompanies)) &&
                      styles.detailRowDivider,
                  ]}
                >
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color="#a855f7"
                    style={styles.detailIcon}
                  />
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailLabel}>Zone</Text>
                    <View style={styles.areaPillsContainer}>
                      {item.affectedAreas!.map((area, idx) => (
                        <View key={idx} style={styles.areaPill}>
                          <Text style={styles.areaPillText}>{area}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Descrizione / Sindacati (nascosti di default, espandibili al tocco) */}
          {hasNotes && (
            <View>
              <View style={styles.expandActionRow}>
                <Text
                  style={[
                    styles.expandActionText,
                    { color: isExpanded ? "#8e8e93" : accent },
                  ]}
                >
                  {isExpanded ? "Nascondi descrizione" : "Mostra descrizione"}
                </Text>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={12}
                  color={isExpanded ? "#8e8e93" : accent}
                />
              </View>

              {isExpanded && (
                <View style={styles.notesContainer}>
                  {hasBodyNotes && (
                    <Text style={styles.notesText}>{item.notes}</Text>
                  )}
                  {Boolean(item.unions) && (
                    <Text
                      style={[
                        styles.notesUnionsText,
                        hasBodyNotes && styles.notesUnionsTextSpaced,
                      ]}
                    >
                      <Text style={styles.notesUnionsLabel}>Sindacati: </Text>
                      {item.unions}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Fonte */}
          <View style={styles.cardFooter}>
            <Text style={styles.sourceText}>Fonte: {item.sourceName}</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: DisruptionSection;
  }) => (
    <View style={styles.sectionHeader}>
      <Text
        style={[
          styles.sectionHeaderText,
          dayScope === "all" &&
            section.isSelectedDayHighlight && { color: accent },
        ]}
      >
        {section.title}
      </Text>
      <Text
        style={[
          styles.sectionHeaderCount,
          dayScope === "all" &&
            section.isSelectedDayHighlight && { color: accent },
        ]}
      >
        {section.data.length}
      </Text>
    </View>
  );

  const effectiveCategory: PersistedFilterMode =
    filterMode === "transit" ? "walk" : filterMode;

  const activeCategoryLabel =
    effectiveCategory === "train"
      ? "Treni"
      : effectiveCategory === "walk"
        ? "Viabilità"
        : effectiveCategory === "protests"
          ? "Manifestazioni"
          : "Tutti";

  const filterMenuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "cat_group",
        title: "Categoria",
        displayInline: true,
        subactions: [
          {
            id: "cat_all",
            title: `Tutti (${baseList.length})`,
            image: Platform.OS === "ios" ? "square.grid.2x2" : undefined,
            state: effectiveCategory === "all" ? "on" : "off",
          },
          {
            id: "cat_train",
            title: `Treni (${trainCount})`,
            image: Platform.OS === "ios" ? "tram.fill" : undefined,
            state: effectiveCategory === "train" ? "on" : "off",
          },
          {
            id: "cat_walk",
            title: `Viabilità (${urbanCount})`,
            image: Platform.OS === "ios" ? "bus.fill" : undefined,
            state: effectiveCategory === "walk" ? "on" : "off",
          },
          {
            id: "cat_protests",
            title: `Manifestazioni (${protestsCount})`,
            image: Platform.OS === "ios" ? "megaphone.fill" : undefined,
            state: effectiveCategory === "protests" ? "on" : "off",
          },
        ],
      },
      {
        id: "route_group",
        title: "Tragitto",
        displayInline: true,
        subactions: [
          {
            id: "toggle_route",
            title: "Solo sul mio tragitto",
            image:
              Platform.OS === "ios"
                ? onlyMyRoute
                  ? "shield.checkered"
                  : "globe"
                : undefined,
            state: onlyMyRoute ? "on" : "off",
          },
        ],
      },
    ],
    [
      baseList.length,
      trainCount,
      urbanCount,
      protestsCount,
      effectiveCategory,
      onlyMyRoute,
    ],
  );

  const handleFilterMenuSelect = useCallback(
    (eventId: string) => {
      switch (eventId) {
        case "cat_all":
          handleChangeFilterMode("all");
          break;
        case "cat_train":
          handleChangeFilterMode("train");
          break;
        case "cat_walk":
          handleChangeFilterMode("walk");
          break;
        case "cat_protests":
          handleChangeFilterMode("protests");
          break;
        case "toggle_route":
          handleChangeOnlyMyRoute(!onlyMyRoute);
          break;
      }
    },
    [handleChangeFilterMode, handleChangeOnlyMyRoute, onlyMyRoute],
  );

  const handleOpenFallbackFilterSheet = useCallback(() => {
    const routeOptionLabel = onlyMyRoute
      ? "Mostra anche avvisi non sul tragitto"
      : "Solo sul mio tragitto";
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Filtra avvisi",
          options: [
            `Tutti (${baseList.length})`,
            `Treni (${trainCount})`,
            `Viabilità (${urbanCount})`,
            `Manifestazioni (${protestsCount})`,
            routeOptionLabel,
            "Annulla",
          ],
          cancelButtonIndex: 5,
        },
        (idx) => {
          if (idx === 0) handleChangeFilterMode("all");
          else if (idx === 1) handleChangeFilterMode("train");
          else if (idx === 2) handleChangeFilterMode("walk");
          else if (idx === 3) handleChangeFilterMode("protests");
          else if (idx === 4) handleChangeOnlyMyRoute(!onlyMyRoute);
        },
      );
      return;
    }
    Alert.alert("Filtra avvisi", undefined, [
      {
        text: `Tutti (${baseList.length})`,
        onPress: () => handleChangeFilterMode("all"),
      },
      {
        text: `Treni (${trainCount})`,
        onPress: () => handleChangeFilterMode("train"),
      },
      {
        text: `Viabilità (${urbanCount})`,
        onPress: () => handleChangeFilterMode("walk"),
      },
      {
        text: `Manifestazioni (${protestsCount})`,
        onPress: () => handleChangeFilterMode("protests"),
      },
      {
        text: routeOptionLabel,
        onPress: () => handleChangeOnlyMyRoute(!onlyMyRoute),
      },
      { text: "Annulla", style: "cancel" },
    ]);
  }, [
    baseList.length,
    trainCount,
    urbanCount,
    protestsCount,
    onlyMyRoute,
    handleChangeFilterMode,
    handleChangeOnlyMyRoute,
  ]);

  const totalCount = filteredDisruptions.length;
  const hasActiveFilter = effectiveCategory !== "all" || !onlyMyRoute;
  const filterButtonLabel =
    effectiveCategory !== "all" ? activeCategoryLabel : "Filtri";

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Scioperi e manifestazioni"
      showCloseButton={true}
    >
      <View style={styles.container}>
        <View style={styles.controlsSection}>
          {/* 1. Selettore Giorno: "Giorno scelto" e "Tutti" in colore tema */}
          <SegmentedControl
            key={`seg-disruptions-${primaryColor}`}
            values={["Giorno scelto", "Tutti"]}
            selectedIndex={dayScope === "selected" ? 0 : 1}
            onChange={(e) =>
              handleChangeDayScope(
                e.nativeEvent.selectedSegmentIndex === 0 ? "selected" : "all",
              )
            }
            appearance="dark"
            tintColor={primaryColor}
            fontStyle={{
              fontSize: 13,
              fontWeight: "600",
              color: "#a1a1aa",
            }}
            activeFontStyle={{
              fontSize: 13,
              fontWeight: "700",
              color: "#ffffff",
            }}
            style={styles.segmented}
          />

          {/* 2. Riga compatta: stato attivo a sinistra + pulsante Callstack Liquid Glass Filtri a destra */}
          <View style={styles.compactFilterBar}>
            <View style={styles.compactStatusLeft}>
              <Text style={styles.compactCountText}>
                {totalCount} {totalCount === 1 ? "avviso" : "avvisi"}
              </Text>
              <Text style={styles.compactDotSep}>·</Text>
              <Ionicons
                name={onlyMyRoute ? "shield-checkmark" : "globe-outline"}
                size={12}
                color={onlyMyRoute ? accent : "#8e8e93"}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.compactScopeText,
                  onlyMyRoute && { color: "#cbd5e1" },
                ]}
                numberOfLines={1}
              >
                {onlyMyRoute ? "Sul tuo tragitto" : "Tutti i percorsi"}
              </Text>
            </View>

            <View style={styles.glassFilterBtnWrap}>
              {isNativeIosGlass && CallstackLiquidGlass?.LiquidGlassView ? (
                <CallstackLiquidGlass.LiquidGlassView
                  effect="regular"
                  interactive={true}
                  colorScheme="dark"
                  tintColor={
                    hasActiveFilter
                      ? `${primaryColor}38`
                      : "rgba(255, 255, 255, 0.14)"
                  }
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
                      backgroundColor: hasActiveFilter
                        ? `${primaryColor}33`
                        : "rgba(38, 43, 56, 0.72)",
                      borderWidth: 1,
                      borderColor: hasActiveFilter
                        ? `${accent}66`
                        : "rgba(255, 255, 255, 0.16)",
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
                      backgroundColor: hasActiveFilter
                        ? `${primaryColor}33`
                        : "rgba(38, 43, 56, 0.9)",
                      borderWidth: 1,
                      borderColor: hasActiveFilter
                        ? `${accent}66`
                        : "rgba(255, 255, 255, 0.16)",
                    },
                  ]}
                  pointerEvents="none"
                />
              )}

              {isNativeMenuAvailable ? (
                <MenuView
                  title="Filtra segnalazioni"
                  actions={filterMenuActions}
                  shouldOpenOnLongPress={false}
                  onPressAction={({ nativeEvent }) =>
                    handleFilterMenuSelect(nativeEvent.event)
                  }
                >
                  <View style={styles.glassFilterPillContent}>
                    <Ionicons
                      name="options-outline"
                      size={13}
                      color={effectiveCategory !== "all" ? accent : "#ffffff"}
                    />
                    <Text style={styles.glassFilterPillText}>
                      {filterButtonLabel}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={11}
                      color="rgba(255, 255, 255, 0.78)"
                    />
                  </View>
                </MenuView>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={handleOpenFallbackFilterSheet}
                  style={styles.glassFilterPillContent}
                >
                  <Ionicons
                    name="options-outline"
                    size={13}
                    color={effectiveCategory !== "all" ? accent : "#ffffff"}
                  />
                  <Text style={styles.glassFilterPillText}>
                    {filterButtonLabel}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={11}
                    color="rgba(255, 255, 255, 0.78)"
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Lista Risultati */}
        {loading && disruptions.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={styles.loadingText}>
              Sincronizzazione scioperi e manifestazioni...
            </Text>
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons
              name="checkmark-circle-outline"
              size={48}
              color="#10b981"
            />
            <Text style={styles.emptyTitle}>
              {dayScope === "selected"
                ? targetDayIso === todayIso
                  ? "Nessun avviso per oggi"
                  : `Nessun avviso per il ${formatShortIso(targetDayIso)}`
                : "Nessuna manifestazione o sciopero"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {onlyMyRoute
                ? "Nessuna segnalazione impatta il tuo tragitto con i filtri selezionati."
                : "Al momento non risultano interruzioni o scioperi per i filtri selezionati."}
            </Text>
            {dayScope === "selected" && totalAllDaysCount > 0 && (
              <TouchableOpacity
                style={[styles.emptyCta, { borderColor: `${accent}66` }]}
                activeOpacity={0.8}
                onPress={() => handleChangeDayScope("all")}
              >
                <Text style={[styles.emptyCtaText, { color: accent }]}>
                  Mostra tutti ({totalAllDaysCount})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <SectionList
            ref={sectionListRef}
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderDisruptionItem}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={() => {}}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={loading}
                  onRefresh={onRefresh}
                  tintColor={primaryColor}
                />
              ) : undefined
            }
          />
        )}
      </View>
    </NativeSheetModal>
  );
};

export const DisruptionsRegistryModal: React.FC<
  DisruptionsRegistryModalProps
> = (props) => {
  if (!props.visible) return null;
  return <DisruptionsRegistryModalContent {...props} />;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  controlsSection: {
    marginBottom: 8,
    gap: 10,
  },
  segmented: {
    height: 36,
  },
  compactFilterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  compactStatusLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  compactCountText: {
    color: "#8e8e93",
    fontSize: 12,
    fontWeight: "600",
  },
  compactDotSep: {
    color: "#636366",
    fontSize: 12,
    fontWeight: "700",
    marginHorizontal: 6,
  },
  compactScopeText: {
    color: "#8e8e93",
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 1,
  },
  glassFilterBtnWrap: {
    borderRadius: 999,
    position: "relative",
  },
  glassFilterPillContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6.5,
  },
  glassFilterPillText: {
    color: "#ffffff",
    fontSize: 12.5,
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 28,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    color: "#8e8e93",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    color: "#636366",
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.card,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  catIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: {
    flex: 1,
  },
  catLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  multiDaySubLabel: {
    color: "#8e8e93",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  datePillText: {
    color: "#cbd5e1",
    fontSize: 11.5,
    fontWeight: "600",
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  impactLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  impactLineText: {
    fontSize: 12.5,
    fontWeight: "600",
    flex: 1,
  },
  detailsGroup: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 9,
  },
  detailRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  detailIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  detailTextCol: {
    flex: 1,
  },
  detailLabel: {
    color: "#8e8e93",
    fontSize: 10.5,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailValue: {
    color: "#e5e5ea",
    fontSize: 12.5,
    lineHeight: 17,
  },
  todayWindowNote: {
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 3,
  },
  areaPillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  areaPill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
    backgroundColor: "rgba(168, 85, 247, 0.16)",
  },
  areaPillText: {
    color: "#d8b4fe",
    fontSize: 11,
    fontWeight: "600",
  },
  expandActionRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 10,
    gap: 4,
  },
  expandActionText: {
    fontSize: 12,
    fontWeight: "600",
  },
  notesContainer: {
    marginTop: 8,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    padding: 11,
  },
  notesText: {
    color: "#d1d1d6",
    fontSize: 12,
    lineHeight: 18,
  },
  notesUnionsText: {
    color: "#8e8e93",
    fontSize: 11.5,
    lineHeight: 16,
  },
  notesUnionsTextSpaced: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  notesUnionsLabel: {
    color: "#d1d1d6",
    fontWeight: "600",
  },
  cardFooter: {
    marginTop: 10,
  },
  sourceText: {
    color: "#636366",
    fontSize: 10.5,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 12,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 4,
    textAlign: "center",
  },
  emptySubtitle: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  emptyCtaText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
