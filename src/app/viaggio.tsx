import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFocusEffect } from "expo-router";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  LayoutChangeEvent,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Reanimated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
} from "react-native-reanimated";
import {
  AnimatedStrikethroughText,
  useExcludedProgress,
} from "../components/ExcludedLessonVisuals";

import {
  type AppTheme,
  CARD_RADIUS,
  MAX_CONTENT_WIDTH,
  UNIFORM_SCREEN_BG,
} from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { CommuterConfigModal } from "../components/CommuterConfigModal";
import { DisruptionsRegistryModal } from "../components/DisruptionsRegistryModal";
import { NativeActionButton } from "../components/NativeActionButton";
import { TrainRouteProgress } from "../components/TrainRouteProgress";
import {
  OptimalTransitTimingUpdate,
  TransitBoardCard,
} from "../components/TransitBoardCard";
import { CommuterConfig, CommuterItinerary, TripLeg } from "../types/commuter";
import { DisruptionCategory, DisruptionEvent } from "../types/disruptions";
import { refreshAppleCalendarIfConfigured } from "../utils/appleCalendar";
import {
  clearPersistedItinerariesCache,
  computeCommuterItinerary,
  elapsedMinutes,
  getDayClassesForWeekday,
  getInFlightStartupPrefetch,
  getRomeStationName,
  getWarmViaggioStartupSnapshot,
  invalidateViaggioStartupSnapshot,
  loadPersistedItinerariesCache,
  normalizeRelativeMinutes,
  resolveAutoTargetClass as getAutoTargetClass,
  resolveViaggioTargetContext,
  savePersistedItineraryEntry,
} from "../utils/commuterOptimizer";
import {
  getCommuterConfig,
  saveCommuterConfig,
  subscribeToCommuterChanges,
} from "../utils/commuterStorage";
import {
  doesPreferredTrainMatchLiveTrain,
  findMatchingPreferredTrain,
  getPreferredTrainDiffSlotKeys,
  getPreferredTrainsForDayDirection,
  jsDayToCalendarDayIndex,
  togglePreferredTrainInMap,
} from "../utils/preferredTrains";
import {
  formatTrainStrikeBannerSummary,
  getCommuterRelevantTrainStrikes,
  getCommuterRelevantWalkDisruptions,
  getDisruptions,
  getDisruptionsForWeekday,
  getWeekdayDate,
  parseDisruptionTime,
  TimeWindowMins,
} from "../utils/disruptionsService";
import {
  computeStableStrikeKey,
  consumePendingStrikeNotificationTap,
  StrikeNotificationTapPayload,
  subscribeToStrikeNotificationTap,
  syncStrikeNotifications,
} from "../utils/strikeNotifications";
import {
  getManualEvents,
  ManualClassEvent,
  subscribeToManualEventsChanges,
} from "../utils/manualEvents";
import {
  buildExcludedIdSet,
  ExcludedLessonRecord,
  getExcludedLessons,
  isLessonExcluded,
  jsDayToScheduleDayIndex,
  subscribeToExcludedLessonsChanges,
} from "../utils/excludedLessons";
import {
  ClassEvent,
  fetchAllCourseData,
  fetchScheduleData,
  ScheduleData,
} from "../utils/scraper";
import {
  cleanPlatform,
  enrichTrainFromCachedAndamento,
  evaluateTrainStatus,
  isSameStation,
  isTrainAndamentoFresh,
  minutesToTime,
  parseTimeToMinutes,
  refreshLiveTrenitaliaCache,
  TrainStatusResult,
} from "../utils/trenitaliaApi";

const SAPIENZA_RED = "#822433";
const SAPIENZA_RED_ACCENT = "#e05666";
const SAPIENZA_RED_LIGHT = "#f87171";
const SAPIENZA_RED_BG = "rgba(130, 36, 51, 0.45)";
const SAPIENZA_RED_BORDER = "rgba(130, 36, 51, 0.4)";
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === "ios" && !isExpoGo;

let CallstackLiquidGlass: any = null;
if (isNativeIos) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CallstackLiquidGlass = require("@callstack/liquid-glass");
  } catch {
    CallstackLiquidGlass = null;
  }
}
const hasNativeCallstackLiquidGlass =
  isNativeIos &&
  Boolean(CallstackLiquidGlass?.isLiquidGlassSupported) &&
  Boolean(CallstackLiquidGlass?.LiquidGlassView);

function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const WALK_DISRUPTION_META: Record<
  DisruptionCategory,
  {
    badgeLabel: string;
    isStrike: boolean;
    iconName: "warning" | "megaphone" | "alert-circle" | "construct";
  }
> = {
  sciopero_treni: {
    badgeLabel: "SCIOPERO TRENI",
    isStrike: true,
    iconName: "warning",
  },
  sciopero_tpl: {
    badgeLabel: "SCIOPERO MEZZI",
    isStrike: true,
    iconName: "warning",
  },
  manifestazione: {
    badgeLabel: "MANIFESTAZIONE",
    isStrike: false,
    iconName: "megaphone",
  },
  blocco_stradale: {
    badgeLabel: "BLOCCO STRADALE",
    isStrike: false,
    iconName: "alert-circle",
  },
  cantiere_viabilita: {
    badgeLabel: "VIABILITÀ",
    isStrike: false,
    iconName: "construct",
  },
  altro: {
    badgeLabel: "ALLERTA TRAGITTO",
    isStrike: false,
    iconName: "warning",
  },
};

function formatWalkDisruptionSummary(event: DisruptionEvent) {
  const meta = WALK_DISRUPTION_META[event.category] || WALK_DISRUPTION_META.altro;
  const timeInfo = parseDisruptionTime(event);

  // Rimuove suffissi di data ridondanti per una lettura immediata a colpo d'occhio
  const strippedTitle = event.title
    .replace(
      /,\s*(?:lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s+\d+.*$/i,
      "",
    )
    .trim();
  const cleanTitle = strippedTitle.length > 0 ? strippedTitle : event.title.trim();

  let description = cleanTitle;
  if (timeInfo.hasTimeWindow) {
    const hoursStr =
      timeInfo.endHour !== undefined
        ? `${timeInfo.startHour.toString().padStart(2, "0")}:${timeInfo.startMinute.toString().padStart(2, "0")} - ${timeInfo.endHour.toString().padStart(2, "0")}:${timeInfo.endMinute!.toString().padStart(2, "0")}`
        : `dalle ${timeInfo.startHour.toString().padStart(2, "0")}:${timeInfo.startMinute.toString().padStart(2, "0")}`;
    description = `${cleanTitle} (${hoursStr})`;
  } else if (event.timeWindow) {
    description = `${cleanTitle} (${event.timeWindow})`;
  }

  return {
    badgeLabel: meta.badgeLabel,
    description,
    isStrike: meta.isStrike,
    iconName: meta.iconName,
    accentColor: meta.isStrike ? "#ef4444" : "#f59e0b",
    bgColor: meta.isStrike
      ? "rgba(239, 68, 68, 0.16)"
      : "rgba(245, 158, 11, 0.14)",
    borderColor: meta.isStrike
      ? "rgba(239, 68, 68, 0.45)"
      : "rgba(245, 158, 11, 0.42)",
    badgeBgColor: meta.isStrike
      ? "rgba(239, 68, 68, 0.26)"
      : "rgba(245, 158, 11, 0.24)",
    descColor: meta.isStrike ? "#fecaca" : "#fde68a",
    modalFilter: "walk" as "transit" | "walk",
  };
}

interface WeekdayItem {
  label: string;
  fullLabel: string;
  dayIdx: number;
  isWeekend?: boolean;
}

const WEEKDAYS: WeekdayItem[] = [
  { label: "LUN", fullLabel: "Lunedì", dayIdx: 1 },
  { label: "MAR", fullLabel: "Martedì", dayIdx: 2 },
  { label: "MER", fullLabel: "Mercoledì", dayIdx: 3 },
  { label: "GIO", fullLabel: "Giovedì", dayIdx: 4 },
  { label: "VEN", fullLabel: "Venerdì", dayIdx: 5 },
  { label: "SAB", fullLabel: "Sabato", dayIdx: 6, isWeekend: true },
  { label: "DOM", fullLabel: "Domenica", dayIdx: 0, isWeekend: true },
];

const LECTURE_CARD_WIDTH = 206;
const LECTURE_CARD_GAP = 8;
const LECTURE_CARD_STRIDE = LECTURE_CARD_WIDTH + LECTURE_CARD_GAP;

function getLectureScrollOffset(index: number, viewportWidth: number): number {
  const halfScreen =
    viewportWidth > 0 ? Math.max(0, (viewportWidth - LECTURE_CARD_WIDTH) / 2) : 80;
  return Math.max(0, index * LECTURE_CARD_STRIDE - halfScreen);
}

interface LectureCardProps {
  item: ClassEvent;
  isSelected: boolean;
  isExcluded?: boolean;
  theme: AppTheme;
  onPress?: () => void;
}

function LectureCard({
  item,
  isSelected,
  isExcluded = false,
  theme,
  onPress,
}: LectureCardProps) {
  const excludedProgress = useExcludedProgress(isExcluded, 0);

  const normalBg = isSelected ? theme.cardTint : "#1c1c1e";
  const excludedBg = isSelected ? theme.cardTint : "#141519";
  const normalBorder = isSelected
    ? theme.primary
    : "rgba(255, 255, 255, 0.08)";
  const excludedBorder = isSelected
    ? theme.primary
    : "rgba(255, 255, 255, 0.055)";

  // L'animated style resta sempre agganciato e valorizzato per entrambi gli stati:
  // rimuoverlo condizionalmente o restituire `{}` su Fabric/Reanimated 4 lascia
  // impressi sul layer nativo `#1c1c1e` e il bordo scuro al primo cambio target.
  const animatedCardStyle = useAnimatedStyle(
    () => ({
      backgroundColor: isSelected
        ? normalBg
        : interpolateColor(
            excludedProgress.value,
            [0, 1],
            [normalBg, excludedBg],
          ),
      borderColor: isSelected
        ? normalBorder
        : interpolateColor(
            excludedProgress.value,
            [0, 1],
            [normalBorder, excludedBorder],
          ),
    }),
    [isSelected, normalBg, excludedBg, normalBorder, excludedBorder],
  );

  const animatedSelectedWashStyle = useAnimatedStyle(() => ({
    opacity: isSelected ? interpolate(excludedProgress.value, [0, 1], [0, 0.22]) : 0,
  }), [isSelected]);

  const animatedDimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      excludedProgress.value,
      [0, 1],
      [1, isSelected ? 0.78 : 0.55],
    ),
  }), [isSelected]);

  const cardStyle = [
    styles.classCard,
    isSelected && [
      styles.classCardSelected,
      {
        shadowColor: theme.primary,
      },
    ],
    animatedCardStyle,
  ];

  const cardContent = (
    <Reanimated.View style={cardStyle}>
      {isSelected && (
        <Reanimated.View
          pointerEvents="none"
          style={[styles.excludedSelectedWash, animatedSelectedWashStyle]}
        />
      )}
      <Reanimated.View style={[styles.classCardTopRow, animatedDimStyle]}>
        <View
          style={[
            styles.classTimeBadge,
            isSelected && {
              backgroundColor: theme.bg,
              borderColor: theme.primary,
            },
          ]}
        >
          <Ionicons
            name="time-outline"
            size={10.5}
            color={isSelected ? theme.light : "#94a3b8"}
            style={{ marginRight: 3.5 }}
          />
          <Text
            style={[
              styles.classTimeText,
              isSelected && styles.classTimeTextSelected,
            ]}
          >
            {item.startTime} - {item.endTime}
          </Text>
        </View>
        {isSelected ? (
          <View
            style={[
              styles.targetBadge,
              {
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
              },
            ]}
          >
            <Ionicons
              name="checkmark-circle"
              size={10.5}
              color="#fff"
              style={{ marginRight: 3 }}
            />
            <Text style={styles.targetBadgeText}>Target</Text>
          </View>
        ) : null}
      </Reanimated.View>

      <AnimatedStrikethroughText
        progress={excludedProgress}
        normalColor={isSelected ? "#ffffff" : "#e2e8f0"}
        excludedColor={isSelected ? "#94a3b8" : "#71717a"}
        strikeColor="rgba(142, 142, 148, 0.88)"
        strikeThickness={1.8}
        numberOfLines={2}
        style={styles.classSubjectText}
      >
        {item.subject}
      </AnimatedStrikethroughText>

      <Reanimated.View
        style={[
          styles.classRoomRow,
          isSelected && { borderTopColor: theme.border },
          animatedDimStyle,
        ]}
      >
        <Ionicons
          name="location-outline"
          size={11}
          color={isSelected ? theme.light : "#64748b"}
          style={{ marginRight: 4 }}
        />
        <Text
          style={[
            styles.classRoomText,
            isSelected && [
              styles.classRoomTextSelected,
              { color: theme.light },
            ],
          ]}
          numberOfLines={1}
        >
          {item.room || "Aula"}
          {item.building ? ` • ${item.building}` : ""}
        </Text>
      </Reanimated.View>
    </Reanimated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
      >
        {cardContent}
      </TouchableOpacity>
    );
  }

  return cardContent;
}

const getDayClasses = getDayClassesForWeekday;

export default function ViaggioScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const initialTodayDayIdx = new Date().getDay();
  const initialStartupSeed = getWarmViaggioStartupSnapshot(
    initialTodayDayIdx,
    "outbound",
  );
  const [loading, setLoading] = useState(() => !initialStartupSeed);
  const [refreshing, setRefreshing] = useState(false);
  const [config, setConfig] = useState<CommuterConfig | null>(
    () => initialStartupSeed?.config ?? null,
  );
  const [schedule, setSchedule] = useState<ScheduleData | null>(
    () => initialStartupSeed?.schedule ?? null,
  );
  const [scheduleHydrated, setScheduleHydrated] = useState<boolean>(
    () => Boolean(initialStartupSeed),
  );
  const [itinerary, setItinerary] = useState<CommuterItinerary | null>(
    () => initialStartupSeed?.itinerary ?? null,
  );
  const [direction, setDirection] = useState<"outbound" | "return">("outbound");
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(
    initialTodayDayIdx,
  );
  const [manualEvents, setManualEvents] = useState<ManualClassEvent[]>(
    () => initialStartupSeed?.manualEvents ?? [],
  );
  const [excludedLessons, setExcludedLessons] = useState<
    ExcludedLessonRecord[]
  >(() => initialStartupSeed?.excludedLessons ?? []);
  const excludedSet = useMemo(
    () => buildExcludedIdSet(excludedLessons),
    [excludedLessons],
  );
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(
    () => initialStartupSeed?.defaultTabUrl ?? null,
  );
  const activeDayIdxRef = useRef<number>(initialTodayDayIdx);
  const activeClassIdxRef = useRef<number | null>(null);
  const directionRef = useRef<"outbound" | "return">("outbound");
  const configCacheRef = useRef<CommuterConfig | null>(
    initialStartupSeed?.config ?? null,
  );
  const configMutationSeqRef = useRef<number>(0);
  const scheduleCacheRef = useRef<ScheduleData | null>(
    initialStartupSeed?.schedule ?? null,
  );
  const hasLoadedScheduleRef = useRef<boolean>(Boolean(initialStartupSeed));
  const defaultTabUrlRef = useRef<string | null>(
    initialStartupSeed?.defaultTabUrl ?? null,
  );
  const manualsCacheRef = useRef<ManualClassEvent[] | null>(
    initialStartupSeed?.manualEvents ?? null,
  );
  const excludedCacheRef = useRef<ExcludedLessonRecord[] | null>(
    initialStartupSeed?.excludedLessons ?? null,
  );
  const initialSeedConsumedRef = useRef<boolean>(Boolean(initialStartupSeed));
  const loadRequestIdRef = useRef<number>(0);
  const calendarRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingCalDirtySlotsRef = useRef<Set<string>>(new Set());
  const pendingCalForceAllRef = useRef<boolean>(false);
  const pendingCalPrecomputedRef = useRef<Record<string, CommuterItinerary>>(
    {},
  );

  useEffect(() => {
    activeDayIdxRef.current = selectedDayIdx;
  }, [selectedDayIdx]);
  const [selectedClassIndex, setSelectedClassIndex] = useState<number | null>(
    null,
  );
  const [selectedTrainOffset, setSelectedTrainOffset] = useState<number>(0);
  const selectedTrainOffsetRef = useRef<number>(0);
  // Treno appena toccato nello slider: evidenziato subito mentre i dati reali si caricano
  const [pendingTrainNumber, setPendingTrainNumber] = useState<string | null>(
    null,
  );
  const pendingTrainRef = useRef<string | null>(null);
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string | null>(
    null,
  );
  const selectedTrainNumberRef = useRef<string | null>(null);
  useEffect(() => {
    selectedTrainOffsetRef.current = selectedTrainOffset;
  }, [selectedTrainOffset]);
  useEffect(() => {
    selectedTrainNumberRef.current = selectedTrainNumber;
  }, [selectedTrainNumber]);
  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);
  useEffect(() => {
    activeClassIdxRef.current = selectedClassIndex;
  }, [selectedClassIndex]);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(() =>
    initialStartupSeed ? new Date(initialStartupSeed.timestamp) : new Date(),
  );

  // Registro Manifestazioni, Scioperi e Interruzioni Viabilità
  const [disruptions, setDisruptions] = useState<DisruptionEvent[]>(
    () => initialStartupSeed?.disruptions ?? [],
  );
  const [disruptionsLoading, setDisruptionsLoading] = useState<boolean>(false);
  const [disruptionsModalVisible, setDisruptionsModalVisible] =
    useState<boolean>(false);
  const [disruptionsInitialFilter, setDisruptionsInitialFilter] = useState<
    "all" | "train" | "walk" | "transit"
  >("all");
  const [selectedDisruptionEventId, setSelectedDisruptionEventId] = useState<
    string | null
  >(null);

  const [selectedDisruptionEventIds, setSelectedDisruptionEventIds] = useState<
    string[]
  >([]);

  const handleOpenDisruptionsModal = useCallback(
    (
      filter: "all" | "train" | "walk" | "transit" = "all",
      eventIdOrIds?: string | string[] | null,
    ) => {
      setDisruptionsInitialFilter(filter);
      if (Array.isArray(eventIdOrIds)) {
        const cleanIds = eventIdOrIds.filter(Boolean);
        setSelectedDisruptionEventIds(cleanIds);
        setSelectedDisruptionEventId(cleanIds[0] || null);
      } else {
        setSelectedDisruptionEventIds(eventIdOrIds ? [eventIdOrIds] : []);
        setSelectedDisruptionEventId(eventIdOrIds || null);
      }
      setDisruptionsModalVisible(true);
    },
    [],
  );

  const todayDayIdx = useMemo(() => new Date().getDay(), []);

  const currentWeekdayIndex = useMemo(() => {
    const idx = WEEKDAYS.findIndex((w) => w.dayIdx === selectedDayIdx);
    return idx >= 0 ? idx : 0;
  }, [selectedDayIdx]);

  const currentWeekday = WEEKDAYS[currentWeekdayIndex];

  const { width: screenWidth } = useWindowDimensions();
  const initialWeekdayIndex = useMemo(() => {
    const idx = WEEKDAYS.findIndex((w) => w.dayIdx === todayDayIdx);
    return idx >= 0 ? idx : 0;
  }, [todayDayIdx]);

  const horizontalPagerRef = useRef<ScrollView>(null);
  const initialPagerPositioned = useRef(false);
  const activeWeekdayIndexRef = useRef(initialWeekdayIndex);
  const handleDayChangeRef = useRef<(dayIdx: number) => void>(() => {});
  const itinerariesCacheRef = useRef<
    Record<string | number, CommuterItinerary | null>
  >(
    initialStartupSeed?.itinerary
      ? { [`outbound_${initialTodayDayIdx}_auto`]: initialStartupSeed.itinerary }
      : {},
  );
  const [itinerariesByDay, setItinerariesByDay] = useState<{
    [dayIdx: number]: CommuterItinerary | null;
  }>(() =>
    initialStartupSeed?.itinerary
      ? { [initialTodayDayIdx]: initialStartupSeed.itinerary }
      : {},
  );

  // Idratazione istantanea da disco (Stale-While-Revalidate): legge in parallelo da AsyncStorage
  // config, orario lezioni, eventi manuali, esclusioni e ultimi itinerari validi (zero rete)
  // così la schermata Viaggio compare subito completa senza mai flashare "Nessuna lezione".
  useEffect(() => {
    let mounted = true;
    const readLocalScheduleCache = async (): Promise<{
      found: boolean;
      sched: ScheduleData | null;
      defaultTab: string | null;
    }> => {
      if (hasLoadedScheduleRef.current) {
        return {
          found: true,
          sched: scheduleCacheRef.current,
          defaultTab: defaultTabUrlRef.current,
        };
      }
      try {
        const pairs = await AsyncStorage.multiGet([
          "selectedDegreeUrl",
          "defaultTabUrl",
        ]);
        const url = pairs[0]?.[1];
        if (!url) {
          return { found: true, sched: null, defaultTab: null };
        }
        const extraPairs = await AsyncStorage.multiGet([
          `defaultTabUrl_${url}`,
          `allSchedules_v8_${url}`,
        ]);
        const nextDefaultTab =
          extraPairs[0]?.[1] || pairs[1]?.[1] || null;
        const rawCourse = extraPairs[1]?.[1];
        if (!rawCourse) {
          return { found: false, sched: null, defaultTab: nextDefaultTab };
        }
        const parsed = JSON.parse(rawCourse);
        if (
          parsed?.tabs &&
          parsed?.schedules &&
          Array.isArray(parsed.tabs) &&
          parsed.tabs.length > 0
        ) {
          const activeTab =
            parsed.tabs.find((t: { url?: string }) => t?.url === nextDefaultTab) ||
            parsed.tabs[0];
          const loadedSched: ScheduleData | null = activeTab
            ? parsed.schedules[activeTab.url] ||
              parsed.schedules[activeTab.name] ||
              null
            : null;
          if (loadedSched) {
            return {
              found: true,
              sched: loadedSched,
              defaultTab: nextDefaultTab,
            };
          }
        }
        return { found: false, sched: null, defaultTab: nextDefaultTab };
      } catch {
        return { found: false, sched: null, defaultTab: null };
      }
    };

    const curInitialKey = `outbound_${initialTodayDayIdx}_auto`;
    if (itinerariesCacheRef.current[curInitialKey]) {
      savePersistedItineraryEntry(
        curInitialKey,
        itinerariesCacheRef.current[curInitialKey]!,
      );
    }

    Promise.all([
      loadPersistedItinerariesCache().catch(() => null),
      configCacheRef.current
        ? Promise.resolve(configCacheRef.current)
        : getCommuterConfig().catch(() => null),
      manualsCacheRef.current
        ? Promise.resolve(manualsCacheRef.current)
        : getManualEvents().catch(() => null),
      excludedCacheRef.current
        ? Promise.resolve(excludedCacheRef.current)
        : getExcludedLessons().catch(() => null),
      readLocalScheduleCache(),
    ])
      .then(([persisted, localCfg, localManuals, localExcluded, localSched]) => {
        if (!mounted) return;

        if (localCfg && !configCacheRef.current) {
          configCacheRef.current = localCfg;
          setConfig((prev) => prev ?? localCfg);
        }
        if (localManuals && !manualsCacheRef.current) {
          manualsCacheRef.current = localManuals;
          setManualEvents((prev) => (prev.length > 0 ? prev : localManuals));
        }
        if (localExcluded && !excludedCacheRef.current) {
          excludedCacheRef.current = localExcluded;
          setExcludedLessons((prev) => (prev.length > 0 ? prev : localExcluded));
        }
        if (localSched.found && !hasLoadedScheduleRef.current) {
          scheduleCacheRef.current = localSched.sched;
          defaultTabUrlRef.current = localSched.defaultTab;
          hasLoadedScheduleRef.current = true;
          setDefaultTabUrl((prev) => prev ?? localSched.defaultTab);
          setSchedule((prev) => prev ?? localSched.sched);
          setScheduleHydrated(true);
        }

        if (persisted && Object.keys(persisted).length > 0) {
          const byDayUpdates: Record<number, CommuterItinerary> = {};
          for (const [k, val] of Object.entries(persisted)) {
            if (!itinerariesCacheRef.current[k]) {
              itinerariesCacheRef.current[k] = val;
            }
            const parts = k.split("_");
            if (parts[0] === "outbound" && parts[2] === "auto") {
              const dIdx = parseInt(parts[1] || "", 10);
              if (!Number.isNaN(dIdx)) {
                byDayUpdates[dIdx] = val;
              }
            }
          }
          if (Object.keys(byDayUpdates).length > 0) {
            setItinerariesByDay((prev) => ({ ...byDayUpdates, ...prev }));
          }
          const curKey = `${directionRef.current}_${activeDayIdxRef.current}_${activeClassIdxRef.current ?? "auto"}`;
          const curPersisted = itinerariesCacheRef.current[curKey];
          if (curPersisted) {
            setItinerary((prev) => prev ?? curPersisted);
            setLoading(false);
          }
        } else if (localCfg?.enabled === false) {
          setLoading(false);
        }

        // Se la cache persistita non contiene ancora l'itinerario odierno, assorbi lo snapshot
        // del prefetch di avvio già in corso (0 richieste di rete extra) mentre la tab è in memoria.
        const curKeyAfterLocal = `${directionRef.current}_${activeDayIdxRef.current}_${activeClassIdxRef.current ?? "auto"}`;
        if (!itinerariesCacheRef.current[curKeyAfterLocal] && localCfg?.enabled !== false) {
          const applyWarmSeed = (
            seed: ReturnType<typeof getWarmViaggioStartupSnapshot>,
          ) => {
            if (!mounted || !seed) return;
            configCacheRef.current = seed.config;
            manualsCacheRef.current = seed.manualEvents;
            excludedCacheRef.current = seed.excludedLessons || [];
            scheduleCacheRef.current = seed.schedule;
            hasLoadedScheduleRef.current = true;
            defaultTabUrlRef.current = seed.defaultTabUrl;
            setConfig((prev) => prev ?? seed.config);
            setManualEvents((prev) => (prev.length > 0 ? prev : seed.manualEvents));
            setExcludedLessons((prev) =>
              prev.length > 0 ? prev : seed.excludedLessons || [],
            );
            setDefaultTabUrl((prev) => prev ?? seed.defaultTabUrl);
            setSchedule((prev) => prev ?? seed.schedule);
            setScheduleHydrated(true);
            setDisruptions((prev) => (prev.length > 0 ? prev : seed.disruptions));
            if (seed.config.enabled === false || seed.itinerary !== null) {
              if (seed.itinerary) {
                const seedKey = `outbound_${seed.dayIdx}_auto`;
                itinerariesCacheRef.current[seedKey] = seed.itinerary;
                savePersistedItineraryEntry(seedKey, seed.itinerary);
                setItinerariesByDay((prev) => ({
                  ...prev,
                  [seed.dayIdx]: seed.itinerary,
                }));
              }
              setItinerary((prev) => prev ?? seed.itinerary);
              setLastUpdated(new Date(seed.timestamp));
              setLoading(false);
            }
          };

          const warm = getWarmViaggioStartupSnapshot(
            initialTodayDayIdx,
            "outbound",
          );
          if (warm) {
            applyWarmSeed(warm);
          } else {
            const inFlight = getInFlightStartupPrefetch();
            if (inFlight) {
              inFlight.then((seed) => applyWarmSeed(seed)).catch(() => {});
            }
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [initialTodayDayIdx]);

  // Animazione fluida a scorrimento dello slider dei giorni della settimana (sincronizzato al pager)
  const segmentLayouts = useRef<{
    [key: number]: { x: number; width: number };
  }>({});
  const [sliderPillAnim] = useState(() => new Animated.Value(0));
  const [sliderWidthAnim] = useState(() => new Animated.Value(44));
  const initialIsWeekend = initialWeekdayIndex >= 5;
  const [weekendPillAnim] = useState(
    () => new Animated.Value(initialIsWeekend ? 1 : 0),
  );
  const [pagerScrollAnim] = useState(
    () => new Animated.Value(initialWeekdayIndex * 390),
  );
  const [sliderReady, setSliderReady] = useState(false);
  const initialSliderPositioned = useRef(false);

  const handleSegmentLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      segmentLayouts.current[idx] = { x, width };

      if (idx === activeWeekdayIndexRef.current) {
        sliderPillAnim.setValue(x);
        sliderWidthAnim.setValue(width);
        if (!initialSliderPositioned.current) {
          weekendPillAnim.setValue(idx >= 5 ? 1 : 0);
          initialSliderPositioned.current = true;
          setSliderReady(true);
        }
      }
    },
    [sliderPillAnim, sliderWidthAnim, weekendPillAnim],
  );

  const handlePagerScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      if (screenWidth <= 0) return;
      pagerScrollAnim.setValue(offsetX);
      const progress = Math.max(0, Math.min(6, offsetX / screenWidth));
      const baseIdx = Math.floor(progress);
      const nextIdx = Math.min(baseIdx + 1, 6);
      const frac = progress - baseIdx;

      const baseLayout = segmentLayouts.current[baseIdx];
      const nextLayout = segmentLayouts.current[nextIdx];

      if (baseLayout && nextLayout) {
        const currentX = baseLayout.x + (nextLayout.x - baseLayout.x) * frac;
        const currentW =
          baseLayout.width + (nextLayout.width - baseLayout.width) * frac;
        sliderPillAnim.setValue(currentX);
        sliderWidthAnim.setValue(currentW);
      }

      // Transizione cromatica continua in live tra feriali e weekend
      const weekendFactor = Math.max(0, Math.min(1, (progress - 4.2) / 0.6));
      weekendPillAnim.setValue(weekendFactor);
    },
    [
      screenWidth,
      sliderPillAnim,
      sliderWidthAnim,
      weekendPillAnim,
      pagerScrollAnim,
    ],
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const pageIndex = Math.round(offsetX / screenWidth);
      if (pageIndex >= 0 && pageIndex < WEEKDAYS.length) {
        const targetDayIdx = WEEKDAYS[pageIndex].dayIdx;

        pagerScrollAnim.setValue(pageIndex * screenWidth);
        const target = segmentLayouts.current[pageIndex];
        if (target) {
          sliderPillAnim.setValue(target.x);
          sliderWidthAnim.setValue(target.width);
        }
        weekendPillAnim.setValue(pageIndex >= 5 ? 1 : 0);

        if (targetDayIdx !== activeDayIdxRef.current) {
          activeDayIdxRef.current = targetDayIdx;
          activeWeekdayIndexRef.current = pageIndex;
          setSelectedDayIdx(targetDayIdx);
          handleDayChangeRef.current(targetDayIdx);
        }
      }
    },
    [
      screenWidth,
      sliderPillAnim,
      sliderWidthAnim,
      weekendPillAnim,
      pagerScrollAnim,
    ],
  );

  useEffect(() => {
    if (!initialPagerPositioned.current && screenWidth > 0) {
      if (initialWeekdayIndex > 0) {
        horizontalPagerRef.current?.scrollTo({
          x: initialWeekdayIndex * screenWidth,
          animated: false,
        });
        pagerScrollAnim.setValue(initialWeekdayIndex * screenWidth);
      }
      initialPagerPositioned.current = true;
    }
  }, [initialWeekdayIndex, screenWidth, pagerScrollAnim]);

  const trainChipsScrollRef = useRef<ScrollView>(null);
  const trainScrollWidthRef = useRef<number>(0);
  const chipLayoutsRef = useRef<{
    [key: string]: { x: number; width: number };
  }>({});
  const lecturesScrollRef = useRef<ScrollView>(null);

  const centerSelectedTrain = useCallback((trainNum: string) => {
    const cleanNum = trainNum.replace(/\D/g, "");
    const entry = Object.entries(chipLayoutsRef.current).find(
      ([k]) => k.replace(/\D/g, "") === cleanNum,
    );
    if (!entry) return;
    const layout = entry[1];
    const containerWidth = trainScrollWidthRef.current;
    if (layout && containerWidth > 0 && trainChipsScrollRef.current) {
      const targetX = layout.x + layout.width / 2 - containerWidth / 2;
      trainChipsScrollRef.current.scrollTo({
        x: Math.max(0, targetX),
        animated: true,
      });
    }
  }, []);

  const currentTrainNumber = itinerary?.liveTrain?.trainNumber;
  useEffect(() => {
    if (currentTrainNumber) {
      const t = setTimeout(() => {
        centerSelectedTrain(currentTrainNumber);
      }, 100);
      return () => clearTimeout(t);
    }
  }, [currentTrainNumber, centerSelectedTrain]);

  // Stato live, programmato, avvisi e capienza Trenitalia del treno
  const liveTrain = itinerary?.liveTrain;
  const commuterStationName = useMemo(() => {
    if (!config) return "";
    return direction === "outbound"
      ? config.departureStation.shortName || config.departureStation.name
      : getRomeStationName(config, liveTrain, "return");
  }, [config, direction, liveTrain]);

  const isWeekend = selectedDayIdx === 0 || selectedDayIdx === 6;
  const isSelectedDayToday = useMemo(() => {
    return new Date().getDay() === selectedDayIdx;
  }, [selectedDayIdx]);

  // Caricamento asincrono degli eventi da MIT (scioperi) e Luceverde (manifestazioni/cortei a Roma)
  const loadDisruptionsData = useCallback(async (force = false) => {
    setDisruptionsLoading(true);
    try {
      const list = await getDisruptions(force);
      setDisruptions(list);
      syncStrikeNotifications(list, { promptIfNeeded: true }).catch(() => {});
    } catch {
      // silenzioso
    } finally {
      setDisruptionsLoading(false);
    }
  }, []);

  const trainStatus = useMemo<TrainStatusResult | null>(() => {
    if (!liveTrain) return null;
    if (!isSelectedDayToday) {
      return {
        statusType: "scheduled" as const,
        badgeLabel: "Programmato",
        badgeColor: "#94a3b8",
        badgeBg: "rgba(148, 163, 184, 0.12)",
        badgeBorder: "rgba(148, 163, 184, 0.25)",
        iconName: "calendar-outline",
      };
    }
    const targetDate = new Date();
    const res = evaluateTrainStatus(liveTrain, targetDate, commuterStationName);
    if (res.badgeLabel === "Programmato") {
      return {
        ...res,
        badgeColor: "#94a3b8",
        badgeBg: "rgba(148, 163, 184, 0.12)",
        badgeBorder: "rgba(148, 163, 184, 0.25)",
      };
    }
    return res;
  }, [liveTrain, isSelectedDayToday, commuterStationName]);

  // Lezioni del giorno selezionato (ufficiali + manuali)
  const dayClasses = useMemo(() => {
    return getDayClasses(selectedDayIdx, schedule, manualEvents, defaultTabUrl);
  }, [selectedDayIdx, schedule, manualEvents, defaultTabUrl]);

  // Lezione attualmente selezionata per il viaggio
  const activeSelectedClass = useMemo(() => {
    if (dayClasses.length === 0) return null;
    if (selectedClassIndex !== null && dayClasses[selectedClassIndex]) {
      return dayClasses[selectedClassIndex];
    }

    if (itinerary?.targetLecture) {
      const matched = dayClasses.find(
        (c) =>
          c.subject === itinerary.targetLecture?.subject &&
          c.startTime === itinerary.targetLecture?.startTime,
      );
      if (matched) return matched;
    }

    const schedDayIdx = jsDayToScheduleDayIndex(selectedDayIdx);
    const activeDayClasses = dayClasses.filter(
      (c) => !isLessonExcluded(schedDayIdx, c, excludedSet),
    );
    if (activeDayClasses.length === 0) return null;

    const now = new Date();
    const isToday = now.getDay() === selectedDayIdx;
    const approxTimeToStation = config?.carLeg?.enabled
      ? (config.carLeg.durationMinutes || 24) +
        (config.carLeg.parkingBufferMinutes ?? 7)
      : 10;
    const approxMinTravel =
      approxTimeToStation + 40 + (config?.transitLeg?.durationMinutes || 20);

    return getAutoTargetClass(
      activeDayClasses,
      isToday,
      direction,
      now,
      approxMinTravel,
    );
  }, [
    dayClasses,
    selectedClassIndex,
    itinerary,
    selectedDayIdx,
    direction,
    config,
    excludedSet,
  ]);

  const activeSelectedClassIndex = useMemo(() => {
    if (!activeSelectedClass || dayClasses.length === 0) return -1;
    const idx = dayClasses.findIndex(
      (c) =>
        c.subject === activeSelectedClass.subject &&
        c.startTime === activeSelectedClass.startTime,
    );
    return idx >= 0 ? idx : -1;
  }, [activeSelectedClass, dayClasses]);

  const selectedDateIso = useMemo(() => {
    const d = getWeekdayDate(selectedDayIdx);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [selectedDayIdx]);

  // Eventi e scioperi previsti per la data selezionata e filtrati per reale sovrapposizione con orari/durata del viaggio
  const currentDayDisruptions = useMemo(() => {
    return getDisruptionsForWeekday(selectedDayIdx, disruptions);
  }, [selectedDayIdx, disruptions]);

  const currentTrainDisruptions = useMemo(() => {
    if (currentDayDisruptions.length === 0) return [];
    const windows: TimeWindowMins[] = [];
    if (liveTrain) {
      const depPlanM = parseTimeToMinutes(liveTrain.departureTimePlanned || "00:00");
      const rawArrM = liveTrain.arrivalTimePlanned
        ? parseTimeToMinutes(liveTrain.arrivalTimePlanned)
        : depPlanM + (liveTrain.durationMinutes || 45);
      const depActM =
        isSelectedDayToday && liveTrain.departureTimeActual
          ? parseTimeToMinutes(liveTrain.departureTimeActual)
          : depPlanM;
      const arrActM =
        isSelectedDayToday && liveTrain.arrivalTimeActual
          ? parseTimeToMinutes(liveTrain.arrivalTimeActual)
          : rawArrM;

      const minDep = Math.min(depPlanM || depActM, depActM || depPlanM);
      const maxArr = Math.max(rawArrM || arrActM, arrActM || rawArrM);
      if (minDep > 0 || maxArr > 0) {
        const startMins = Math.max(0, minDep - 15);
        const endMins = maxArr >= minDep ? Math.min(1440, maxArr + 15) : 1440;
        windows.push({ startMins, endMins });
      }
    } else if (!isWeekend && activeSelectedClass) {
      const clsStart = parseTimeToMinutes(activeSelectedClass.startTime || "08:30");
      const clsEnd = parseTimeToMinutes(activeSelectedClass.endTime || "18:00");
      if (direction === "outbound") {
        windows.push({ startMins: Math.max(0, clsStart - 150), endMins: clsStart });
      } else {
        windows.push({ startMins: clsEnd, endMins: Math.min(1440, clsEnd + 120) });
      }
    } else if (loading || (itinerary && !liveTrain)) {
      return [];
    }

    return getCommuterRelevantTrainStrikes(
      currentDayDisruptions,
      selectedDateIso,
      windows,
    );
  }, [
    currentDayDisruptions,
    liveTrain,
    isSelectedDayToday,
    isWeekend,
    activeSelectedClass,
    direction,
    loading,
    itinerary,
    selectedDateIso,
  ]);

  const currentWalkDisruptions = useMemo(() => {
    if (currentDayDisruptions.length === 0) return [];
    const urbanLegs = (itinerary?.legs || []).filter(
      (l) => l.type === "walk" || l.type === "transit",
    );
    const windows: TimeWindowMins[] = [];
    for (const leg of urbanLegs) {
      if (!leg.startTime && !leg.endTime) continue;
      const sM = parseTimeToMinutes(leg.startTime || leg.endTime || "08:30");
      const eM = leg.endTime
        ? parseTimeToMinutes(leg.endTime)
        : sM + (leg.durationMinutes || 20);
      windows.push({
        startMins: Math.max(0, sM - 30),
        endMins: Math.min(1440, Math.max(sM, eM) + 30),
      });
    }
    if (windows.length === 0 && !isWeekend && activeSelectedClass) {
      const clsStart = parseTimeToMinutes(activeSelectedClass.startTime || "08:30");
      const clsEnd = parseTimeToMinutes(activeSelectedClass.endTime || "18:00");
      if (direction === "outbound") {
        windows.push({ startMins: Math.max(0, clsStart - 75), endMins: clsStart });
      } else {
        windows.push({ startMins: clsEnd, endMins: Math.min(1440, clsEnd + 75) });
      }
    }
    return getCommuterRelevantWalkDisruptions(
      currentDayDisruptions,
      commuterStationName,
      selectedDateIso,
      windows,
    );
  }, [
    currentDayDisruptions,
    commuterStationName,
    selectedDateIso,
    itinerary,
    isWeekend,
    activeSelectedClass,
    direction,
  ]);

  const hasSelectedDayTrainStrike = currentTrainDisruptions.length > 0;
  const hasSelectedDayTplStrike = currentWalkDisruptions.some(
    (ev) => ev.category === "sciopero_tpl",
  );
  const hasSelectedDayStrike =
    hasSelectedDayTrainStrike || hasSelectedDayTplStrike;
  const hasSelectedDayWalkOnly =
    !hasSelectedDayStrike && currentWalkDisruptions.length > 0;
  const selectedDayAlertCount = hasSelectedDayStrike
    ? currentTrainDisruptions.length +
      currentWalkDisruptions.filter((ev) => ev.category === "sciopero_tpl")
        .length
    : currentWalkDisruptions.length;

  const [strikePulseAnim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!hasSelectedDayStrike) {
      strikePulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(strikePulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(strikePulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      strikePulseAnim.setValue(0);
    };
  }, [hasSelectedDayStrike, strikePulseAnim]);

  const disruptionsRef = useRef<DisruptionEvent[]>(disruptions);
  useEffect(() => {
    disruptionsRef.current = disruptions;
  }, [disruptions]);

  const handleDayPressRef = useRef<(dayIdx: number) => void>(() => {});
  const processStrikeNotificationTap = useCallback(
    async (payload: StrikeNotificationTapPayload | null) => {
      if (!payload) return;
      if (payload.strikeDateIso) {
        const refDate = new Date();
        const matchingWeekday = WEEKDAYS.find((w) => {
          const d = getWeekdayDate(w.dayIdx, refDate);
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return iso === payload.strikeDateIso;
        });
        if (matchingWeekday) {
          handleDayPressRef.current(matchingWeekday.dayIdx);
        }
      }

      let currentList = disruptionsRef.current;
      if (currentList.length === 0) {
        try {
          currentList = await getDisruptions();
          setDisruptions(currentList);
        } catch {}
      }

      const matchedEvent =
        currentList.find((ev) => ev.id === payload.eventId) ||
        (payload.strikeKey
          ? currentList.find(
              (ev) => computeStableStrikeKey(ev) === payload.strikeKey,
            )
          : undefined);

      handleOpenDisruptionsModal(
        payload.category === "sciopero_treni" ? "train" : "walk",
        matchedEvent?.id || payload.eventId || null,
      );
    },
    [handleOpenDisruptionsModal],
  );

  useEffect(() => {
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = consumePendingStrikeNotificationTap();
    if (pending) {
      pendingTimer = setTimeout(() => {
        processStrikeNotificationTap(pending).catch(() => {});
      }, 0);
    }
    const unsub = subscribeToStrikeNotificationTap((payload) => {
      processStrikeNotificationTap(payload).catch(() => {});
    });
    return () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      unsub();
    };
  }, [processStrikeNotificationTap]);

  // Scorrimento automatico orizzontale della lista lezioni per visualizzare e centrare la lezione target
  useEffect(() => {
    if (dayClasses.length > 0 && activeSelectedClassIndex >= 0) {
      const targetOffset = getLectureScrollOffset(
        activeSelectedClassIndex,
        screenWidth,
      );
      const timer = setTimeout(() => {
        lecturesScrollRef.current?.scrollTo({
          x: targetOffset,
          animated: true,
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [
    activeSelectedClassIndex,
    selectedDayIdx,
    dayClasses.length,
    screenWidth,
  ]);

  const loadData = useCallback(
    async (
      isRefresh = false,
      silent = false,
      overrides?: {
        direction?: "outbound" | "return";
        selectedDayIdx?: number;
        selectedClassIndex?: number | null;
        selectedTrainOffset?: number;
        selectedTrainNumber?: string | null;
      },
    ) => {
      const effDir =
        overrides?.direction !== undefined
          ? overrides.direction
          : directionRef.current;
      const effDayIdx =
        overrides?.selectedDayIdx !== undefined
          ? overrides.selectedDayIdx
          : activeDayIdxRef.current;
      const effClassIdx =
        overrides?.selectedClassIndex !== undefined
          ? overrides.selectedClassIndex
          : activeClassIdxRef.current;
      const effTrainOffset =
        overrides?.selectedTrainOffset !== undefined
          ? overrides.selectedTrainOffset
          : selectedTrainOffsetRef.current;
      const effTrainNum =
        overrides?.selectedTrainNumber !== undefined
          ? overrides.selectedTrainNumber
          : selectedTrainNumberRef.current;

      const requestId = ++loadRequestIdRef.current;

      const isDefaultInitialContext =
        !isRefresh &&
        effDir === "outbound" &&
        effDayIdx === new Date().getDay() &&
        effClassIdx === null &&
        effTrainOffset === 0 &&
        !effTrainNum;

      if (isDefaultInitialContext && initialSeedConsumedRef.current) {
        initialSeedConsumedRef.current = false;
        const freshSeed = getWarmViaggioStartupSnapshot(effDayIdx, effDir);
        if (
          freshSeed &&
          (freshSeed.config.enabled === false || freshSeed.itinerary !== null) &&
          Date.now() - freshSeed.timestamp < 20000
        ) {
          syncStrikeNotifications(freshSeed.disruptions, {
            promptIfNeeded: true,
          }).catch(() => {});
          return;
        }
      }

      if (!silent) {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          const existingCacheKey = `${effDir}_${effDayIdx}_${effClassIdx ?? "auto"}`;
          if (!itinerariesCacheRef.current[existingCacheKey]) {
            setLoading(true);
          }
        }
      }

      if (isRefresh) {
        refreshLiveTrenitaliaCache();
        invalidateViaggioStartupSnapshot();
      }

      try {
        if (isDefaultInitialContext) {
          const inFlightSeedPromise = getInFlightStartupPrefetch();
          if (inFlightSeedPromise) {
            const seed = await inFlightSeedPromise;
            if (
              requestId !== loadRequestIdRef.current ||
              effDayIdx !== activeDayIdxRef.current
            ) {
              return;
            }
            if (seed) {
              configCacheRef.current = seed.config;
              manualsCacheRef.current = seed.manualEvents;
              excludedCacheRef.current = seed.excludedLessons || [];
              scheduleCacheRef.current = seed.schedule;
              hasLoadedScheduleRef.current = true;
              defaultTabUrlRef.current = seed.defaultTabUrl;
              setConfig(seed.config);
              setManualEvents(seed.manualEvents);
              setExcludedLessons(seed.excludedLessons || []);
              setDefaultTabUrl(seed.defaultTabUrl);
              setSchedule(seed.schedule);
              setScheduleHydrated(true);
              setDisruptions(seed.disruptions);
              if (seed.config.enabled === false || seed.itinerary !== null) {
                const cacheKey = `${effDir}_${effDayIdx}_auto`;
                if (seed.itinerary) {
                  itinerariesCacheRef.current[cacheKey] = seed.itinerary;
                  savePersistedItineraryEntry(cacheKey, seed.itinerary);
                }
                setItinerary(seed.itinerary);
                if (seed.itinerary) {
                  setItinerariesByDay((prev) => ({
                    ...prev,
                    [effDayIdx]: seed.itinerary,
                  }));
                }
                setLastUpdated(new Date(seed.timestamp));
                syncStrikeNotifications(seed.disruptions, {
                  promptIfNeeded: true,
                }).catch(() => {});
                return;
              }
            }
          }
        }

        // Avvio in parallelo di tutte le fonti dati necessarie alla schermata Viaggio
        // I refresh silenziosi (timer 60s / foreground) usano la cache 30m degli scioperi/manifestazioni
        const disruptionsPromise = getDisruptions(isRefresh && !silent).catch(
          () => disruptionsRef.current,
        );

        const configPromise: Promise<CommuterConfig> =
          !isRefresh && configCacheRef.current
            ? Promise.resolve(configCacheRef.current)
            : getCommuterConfig();

        const manualsPromise: Promise<ManualClassEvent[]> =
          !isRefresh && manualsCacheRef.current
            ? Promise.resolve(manualsCacheRef.current)
            : getManualEvents().catch(() => manualsCacheRef.current || []);

        const excludedPromise: Promise<ExcludedLessonRecord[]> =
          !isRefresh && excludedCacheRef.current
            ? Promise.resolve(excludedCacheRef.current)
            : getExcludedLessons().catch(() => excludedCacheRef.current || []);

        const schedulePromise: Promise<{
          sched: ScheduleData | null;
          defaultTab: string | null;
        }> = (async () => {
          if (!isRefresh && hasLoadedScheduleRef.current) {
            return {
              sched: scheduleCacheRef.current,
              defaultTab: defaultTabUrlRef.current,
            };
          }
          try {
            const storagePairs = await AsyncStorage.multiGet([
              "selectedDegreeUrl",
              "defaultTabUrl",
            ]);
            const url = storagePairs[0]?.[1];
            const nextDefaultTab =
              (url
                ? await AsyncStorage.getItem(`defaultTabUrl_${url}`).catch(
                    () => null,
                  )
                : null) ||
              storagePairs[1]?.[1] ||
              null;
            let loadedSched: ScheduleData | null = null;
            if (url) {
              const courseData = await fetchAllCourseData(url);
              const activeTab =
                courseData.tabs.find((t) => t.url === nextDefaultTab) ||
                courseData.tabs[0];
              if (activeTab) {
                loadedSched =
                  courseData.schedules[activeTab.url] ||
                  courseData.schedules[activeTab.name] ||
                  null;
                if (!loadedSched) {
                  loadedSched = await fetchScheduleData(activeTab.url);
                }
              }
            }
            return { sched: loadedSched, defaultTab: nextDefaultTab };
          } catch (err) {
            console.warn("Errore lettura schedule corso:", err);
            return {
              sched: scheduleCacheRef.current,
              defaultTab: defaultTabUrlRef.current,
            };
          }
        })();

        const [configRes, manualsRes, excludedRes, schedRes] =
          await Promise.allSettled([
            configPromise,
            manualsPromise,
            excludedPromise,
            schedulePromise,
          ]);

        if (
          requestId !== loadRequestIdRef.current ||
          effDayIdx !== activeDayIdxRef.current
        ) {
          return;
        }

        if (configRes.status !== "fulfilled") {
          throw configRes.reason;
        }

        const currentConfig = configRes.value;
        const currentManuals =
          manualsRes.status === "fulfilled"
            ? manualsRes.value
            : manualsCacheRef.current || [];
        const currentExcluded =
          excludedRes.status === "fulfilled"
            ? excludedRes.value
            : excludedCacheRef.current || [];
        const currentExcludedSet = buildExcludedIdSet(currentExcluded);
        const { sched, defaultTab } =
          schedRes.status === "fulfilled"
            ? schedRes.value
            : {
                sched: scheduleCacheRef.current,
                defaultTab: defaultTabUrlRef.current,
              };

        if (currentConfig.enabled === false) {
          const resolvedDisruptions = await disruptionsPromise;
          if (
            requestId !== loadRequestIdRef.current ||
            effDayIdx !== activeDayIdxRef.current
          ) {
            return;
          }
          configCacheRef.current = currentConfig;
          manualsCacheRef.current = currentManuals;
          excludedCacheRef.current = currentExcluded;
          scheduleCacheRef.current = sched;
          hasLoadedScheduleRef.current = true;
          defaultTabUrlRef.current = defaultTab;
          setConfig(currentConfig);
          setManualEvents(currentManuals);
          setExcludedLessons(currentExcluded);
          setDefaultTabUrl(defaultTab);
          setSchedule(sched);
          setScheduleHydrated(true);
          setDisruptions(resolvedDisruptions);
          setItinerary(null);
          return;
        }

        const { targetDate, targetClass, isExplicitClass } =
          resolveViaggioTargetContext({
            effDayIdx,
            direction: effDir,
            config: currentConfig,
            schedule: sched,
            manuals: currentManuals,
            defaultTabUrl: defaultTab,
            selectedClassIndex: effClassIdx,
            excludedLessonIds: currentExcludedSet,
          });

        // Disaccoppia gli avvisi scioperi/viabilità dal commit critico dell'itinerario:
        // se già in cache si risolvono subito, altrimenti aggiornano i badge appena arrivano senza bloccare treni/mezzi.
        let settledDisruptions: DisruptionEvent[] | null = null;
        disruptionsPromise
          .then((freshDisruptions) => {
            settledDisruptions = freshDisruptions;
            if (requestId !== loadRequestIdRef.current) return;
            setDisruptions(freshDisruptions);
            syncStrikeNotifications(freshDisruptions, {
              promptIfNeeded: true,
            }).catch(() => {});
          })
          .catch(() => {});

        const itin = await computeCommuterItinerary({
          config: currentConfig,
          scheduleData: sched,
          manualEvents: currentManuals,
          direction: effDir,
          targetDate,
          selectedClass: targetClass,
          isExplicitClass,
          selectedTrainOffset: effTrainOffset,
          selectedTrainNumber: effTrainNum || undefined,
          forceRefresh: isRefresh && !silent,
          excludedLessonIds: currentExcludedSet,
        });

        if (
          requestId !== loadRequestIdRef.current ||
          effDayIdx !== activeDayIdxRef.current
        ) {
          return;
        }

        const resolvedDisruptions =
          settledDisruptions ?? disruptionsRef.current;

        // Commit atomico in un unico batch React: lezioni, hero card, treni e mezzi compaiono insieme
        configCacheRef.current = currentConfig;
        manualsCacheRef.current = currentManuals;
        excludedCacheRef.current = currentExcluded;
        scheduleCacheRef.current = sched;
        hasLoadedScheduleRef.current = true;
        defaultTabUrlRef.current = defaultTab;

        setConfig(currentConfig);
        setManualEvents(currentManuals);
        setExcludedLessons(currentExcluded);
        setDefaultTabUrl(defaultTab);
        setSchedule(sched);
        setScheduleHydrated(true);
        if (settledDisruptions) {
          setDisruptions(resolvedDisruptions);
        }

        const cacheKey = `${effDir}_${effDayIdx}_${effClassIdx ?? "auto"}`;
        itinerariesCacheRef.current[cacheKey] = itin;
        if (effTrainOffset === 0 && !effTrainNum) {
          savePersistedItineraryEntry(cacheKey, itin);
        }
        setItinerary(itin);
        if (effClassIdx === null) {
          setItinerariesByDay((prev) => ({ ...prev, [effDayIdx]: itin }));
        }
        setLastUpdated(new Date());
      } catch (err: any) {
        console.warn("Errore calcolo itinerario pendolare", err);
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          pendingTrainRef.current = null;
          setPendingTrainNumber(null);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const unsub = subscribeToManualEventsChanges(() => {
      manualsCacheRef.current = null;
      itinerariesCacheRef.current = {};
      clearPersistedItinerariesCache();
      invalidateViaggioStartupSnapshot();
      getManualEvents()
        .then((evts) => {
          manualsCacheRef.current = evts;
          setManualEvents(evts);
          loadData(true, true);
        })
        .catch(() => {});
    });
    return () => unsub();
  }, [loadData]);

  useEffect(() => {
    const unsub = subscribeToExcludedLessonsChanges(() => {
      excludedCacheRef.current = null;
      itinerariesCacheRef.current = {};
      clearPersistedItinerariesCache();
      invalidateViaggioStartupSnapshot();
      getExcludedLessons()
        .then((recs) => {
          excludedCacheRef.current = recs;
          setExcludedLessons(recs);
          loadData(true, true);
        })
        .catch(() => {});
    });
    return () => unsub();
  }, [loadData]);

  useEffect(() => {
    const unsub = subscribeToCommuterChanges((nextCfg) => {
      const prevCfg = configCacheRef.current;
      if (prevCfg && JSON.stringify(prevCfg) === JSON.stringify(nextCfg)) {
        return;
      }

      invalidateViaggioStartupSnapshot();
      const prevPrefsJson = JSON.stringify(prevCfg?.trainPreferences || {});
      const nextPrefsJson = JSON.stringify(nextCfg.trainPreferences || {});
      const prefsChanged = prevPrefsJson !== nextPrefsJson;

      configCacheRef.current = nextCfg;
      setConfig(nextCfg);

      if (prefsChanged) {
        const diffSlots = getPreferredTrainDiffSlotKeys(
          prevCfg?.trainPreferences?.preferredTrains,
          nextCfg.trainPreferences?.preferredTrains,
        );
        const curDir = directionRef.current;
        const curDay = activeDayIdxRef.current;
        const curCalSlot = `${jsDayToCalendarDayIndex(curDay)}_${curDir}`;

        if (diffSlots.length > 0) {
          for (const slot of diffSlots) {
            const [calIdxStr, slotDir] = slot.split("_");
            const calIdx = parseInt(calIdxStr || "", 10);
            if (!Number.isNaN(calIdx) && slotDir) {
              const jsDay = (calIdx + 1) % 7;
              const prefPrefix = `${slotDir}_${jsDay}_`;
              for (const cacheKey of Object.keys(itinerariesCacheRef.current)) {
                if (cacheKey.startsWith(prefPrefix)) {
                  delete itinerariesCacheRef.current[cacheKey];
                }
              }
              delete itinerariesCacheRef.current[String(jsDay)];
            }
          }
          if (diffSlots.includes(curCalSlot)) {
            loadData(false, true);
          }
        } else {
          itinerariesCacheRef.current = {};
          loadData(false, true);
        }
      }
    });
    return () => unsub();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Aggiornamento automatico sincronizzato di treni, ritardi e mezzi ogni minuto (60 secondi)
      // Eseguito solo quando è visualizzato il giorno odierno (i giorni futuri sono programmati statici)
      const id = setInterval(() => {
        // Non interrompere il caricamento di un treno appena selezionato dall'utente
        if (pendingTrainRef.current) return;
        if (activeDayIdxRef.current !== new Date().getDay()) return;
        loadData(true, true);
      }, 60000);
      const appStateSub = AppState.addEventListener("change", (nextState) => {
        if (nextState === "active") {
          if (!pendingTrainRef.current && activeDayIdxRef.current === new Date().getDay()) {
            loadData(true, true);
          }
          refreshAppleCalendarIfConfigured().catch(() => {});
        }
      });
      return () => {
        clearInterval(id);
        appStateSub.remove();
      };
    }, [loadData]),
  );

  const handleDayChange = useCallback(
    (dayIdx: number) => {
      activeDayIdxRef.current = dayIdx;
      activeClassIdxRef.current = null;
      selectedTrainOffsetRef.current = 0;
      selectedTrainNumberRef.current = null;
      setSelectedDayIdx(dayIdx);
      setSelectedClassIndex(null);
      setSelectedTrainOffset(0);
      setSelectedTrainNumber(null);
      const cacheKey = `${direction}_${dayIdx}_auto`;
      const cached =
        itinerariesCacheRef.current[cacheKey] ||
        itinerariesCacheRef.current[`${dayIdx}_auto`] ||
        itinerariesCacheRef.current[dayIdx] ||
        itinerariesByDay[dayIdx];
      if (cached) {
        setItinerary(cached);
        setLoading(false);
      } else {
        setItinerary(null);
        setLoading(true);
      }
      loadData(false, Boolean(cached), {
        selectedDayIdx: dayIdx,
        selectedClassIndex: null,
        selectedTrainOffset: 0,
        selectedTrainNumber: null,
      });
    },
    [loadData, itinerariesByDay, direction],
  );

  useEffect(() => {
    handleDayChangeRef.current = handleDayChange;
  }, [handleDayChange]);

  const handleDayPress = (dayIdx: number) => {
    const pageIdx = WEEKDAYS.findIndex((w) => w.dayIdx === dayIdx);
    if (pageIdx >= 0) {
      activeWeekdayIndexRef.current = pageIdx;
      setSelectedDayIdx(dayIdx);
      const target = segmentLayouts.current[pageIdx];
      if (target) {
        Animated.parallel([
          Animated.spring(sliderPillAnim, {
            toValue: target.x,
            useNativeDriver: false,
            bounciness: 0,
          }),
          Animated.spring(sliderWidthAnim, {
            toValue: target.width,
            useNativeDriver: false,
            bounciness: 0,
          }),
          Animated.timing(weekendPillAnim, {
            toValue: pageIdx >= 5 ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
          }),
          Animated.spring(pagerScrollAnim, {
            toValue: pageIdx * screenWidth,
            useNativeDriver: false,
            bounciness: 0,
          }),
        ]).start();
      }
      horizontalPagerRef.current?.scrollTo({
        x: pageIdx * screenWidth,
        animated: true,
      });
      handleDayChange(dayIdx);
    }
  };

  useEffect(() => {
    handleDayPressRef.current = handleDayPress;
  });

  const handleResetToToday = () => {
    const today = new Date().getDay();
    handleDayPress(today);
  };

  const handleDirectionChange = (newDir: "outbound" | "return") => {
    directionRef.current = newDir;
    selectedTrainOffsetRef.current = 0;
    selectedTrainNumberRef.current = null;
    setDirection(newDir);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
    activeClassIdxRef.current = null;
    setSelectedClassIndex(null);
    const cacheKey = `${newDir}_${selectedDayIdx}_auto`;
    const cached = itinerariesCacheRef.current[cacheKey];
    if (cached) {
      setItinerary(cached);
      setLoading(false);
    } else {
      setItinerary(null);
      setLoading(true);
    }
    loadData(false, Boolean(cached), {
      direction: newDir,
      selectedClassIndex: null,
      selectedTrainOffset: 0,
      selectedTrainNumber: null,
    });
  };

  const handleSelectClass = (idx: number) => {
    activeClassIdxRef.current = idx;
    selectedTrainOffsetRef.current = 0;
    selectedTrainNumberRef.current = null;
    setSelectedClassIndex(idx);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
    const targetOffset = getLectureScrollOffset(idx, screenWidth);
    lecturesScrollRef.current?.scrollTo({ x: targetOffset, animated: true });
    const cacheKey = `${direction}_${selectedDayIdx}_${idx}`;
    const cached = itinerariesCacheRef.current[cacheKey];
    if (cached) {
      setItinerary(cached);
      setLoading(false);
    } else {
      setItinerary(null);
      setLoading(true);
    }
    loadData(false, Boolean(cached), {
      selectedClassIndex: idx,
      selectedTrainOffset: 0,
      selectedTrainNumber: null,
    });
  };

  const handleTrainPrev = () => {
    if (itinerary?.availableTrains && itinerary.liveTrain) {
      const currentClean = itinerary.liveTrain.trainNumber.replace(/\D/g, "");
      const idx = itinerary.availableTrains.findIndex(
        (t) => t.trainNumber.replace(/\D/g, "") === currentClean,
      );
      if (idx > 0) {
        const prevTrain = itinerary.availableTrains[idx - 1];
        handleSelectTrainChip(prevTrain.trainNumber);
        return;
      }
    }
    const nextOffset = selectedTrainOffset - 1;
    selectedTrainOffsetRef.current = nextOffset;
    selectedTrainNumberRef.current = null;
    setSelectedTrainOffset(nextOffset);
    setSelectedTrainNumber(null);
    loadData(false, true, {
      selectedTrainOffset: nextOffset,
      selectedTrainNumber: null,
    });
  };

  const handleTrainNext = () => {
    if (itinerary?.availableTrains && itinerary.liveTrain) {
      const currentClean = itinerary.liveTrain.trainNumber.replace(/\D/g, "");
      const idx = itinerary.availableTrains.findIndex(
        (t) => t.trainNumber.replace(/\D/g, "") === currentClean,
      );
      if (idx !== -1 && idx < itinerary.availableTrains.length - 1) {
        const nextTrain = itinerary.availableTrains[idx + 1];
        handleSelectTrainChip(nextTrain.trainNumber);
        return;
      }
    }
    const nextOffset = selectedTrainOffset + 1;
    selectedTrainOffsetRef.current = nextOffset;
    selectedTrainNumberRef.current = null;
    setSelectedTrainOffset(nextOffset);
    setSelectedTrainNumber(null);
    loadData(false, true, {
      selectedTrainOffset: nextOffset,
      selectedTrainNumber: null,
    });
  };

  const handleSelectTrainChip = (trainNum: string) => {
    const clean = trainNum.replace(/\D/g, "");
    if (pendingTrainRef.current === clean) return;

    const isToday = selectedDayIdx === new Date().getDay();
    const avail = itinerary?.availableTrains || [];
    const targetIdx = avail.findIndex(
      (t) => t.trainNumber.replace(/\D/g, "") === clean,
    );
    const targetTrain = targetIdx >= 0 ? avail[targetIdx] : undefined;
    const enrichedTarget = targetTrain ? { ...targetTrain } : undefined;
    const effConfig = configCacheRef.current || config;
    const effDir = directionRef.current || direction;
    const chipDepStation = effConfig
      ? effDir === "outbound"
        ? effConfig.departureStation
        : effConfig.arrivalStation
      : undefined;
    const chipArrStation = effConfig
      ? effDir === "outbound"
        ? effConfig.arrivalStation
        : effConfig.departureStation
      : undefined;
    const didEnrichFromCache = Boolean(
      isToday &&
        enrichedTarget &&
        chipDepStation &&
        chipArrStation &&
        enrichTrainFromCachedAndamento(
          enrichedTarget,
          chipDepStation,
          chipArrStation,
        ),
    );
    const isInstantReady = Boolean(
      enrichedTarget &&
        (!isToday ||
          (isTrainAndamentoFresh(clean, chipDepStation, chipArrStation) &&
            didEnrichFromCache)),
    );

    centerSelectedTrain(trainNum);
    selectedTrainNumberRef.current = trainNum;
    selectedTrainOffsetRef.current = 0;
    setSelectedTrainNumber(trainNum);
    setSelectedTrainOffset(0);

    if (isInstantReady && itinerary && enrichedTarget) {
      pendingTrainRef.current = null;
      setPendingTrainNumber(null);

      // Aggiornamento locale immediato (0ms) solo con dati già allineati ad andamentoTreno
      const depPlanStr = enrichedTarget.departureTimePlanned || "";
      const depStr =
        (isToday
          ? enrichedTarget.departureTimeActual || enrichedTarget.departureTimePlanned
          : enrichedTarget.departureTimePlanned) || "";
      const arrStr =
        (isToday
          ? enrichedTarget.arrivalTimeActual || enrichedTarget.arrivalTimePlanned
          : enrichedTarget.arrivalTimePlanned) || "";

      if (depStr && arrStr) {
        const depM = parseTimeToMinutes(depPlanStr || depStr);
        const arrM = parseTimeToMinutes(arrStr);
        const durM =
          enrichedTarget.durationMinutes && enrichedTarget.durationMinutes > 0
            ? enrichedTarget.durationMinutes
            : arrM >= depM
              ? arrM - depM
              : arrM + 1440 - depM;
        const romeStation = effConfig
          ? getRomeStationName(effConfig, enrichedTarget, itinerary.direction)
          : "";
        let updatedDepTime = itinerary.departureTime;
        const updatedLegs = itinerary.legs.map((leg, lIdx) => {
          if (leg.type === "train") {
            const sub =
              effConfig && romeStation
                ? itinerary.direction === "outbound"
                  ? `${effConfig.departureStation.shortName || effConfig.departureStation.name} ➔ ${romeStation}`
                  : `${romeStation} ➔ ${effConfig.departureStation.shortName || effConfig.departureStation.name}`
                : leg.subtitle;
            if (itinerary.direction === "outbound" && lIdx === 0) {
              updatedDepTime = depStr;
            }
            const effPlat = isToday
              ? enrichedTarget.platformActual || enrichedTarget.platformPlanned
              : enrichedTarget.platformPlanned;
            return {
              ...leg,
              title: `Treno ${enrichedTarget.trainNumber} (${enrichedTarget.isFast ? "Regionale Veloce" : "Regionale"})`,
              subtitle: sub,
              startTime: depStr,
              endTime: arrStr,
              durationMinutes: durM,
              details: {
                ...leg.details,
                trainNumber: enrichedTarget.trainNumber,
                platform: effPlat,
                delay: isToday ? enrichedTarget.delayMinutes : 0,
                delayMinutes: isToday ? enrichedTarget.delayMinutes : 0,
                isLiveTrain: isToday ? enrichedTarget.isLive : false,
                notes: `${enrichedTarget.category} verso ${enrichedTarget.destination} • Binario ${effPlat || "in definizione"} • ${isToday ? enrichedTarget.statusDescription : "Programmato"}`,
              },
            };
          }
          if (
            itinerary.direction === "outbound" &&
            lIdx === 0 &&
            leg.type === "car" &&
            effConfig
          ) {
            const parkBuf = effConfig.carLeg?.parkingBufferMinutes ?? 5;
            const carEndM = Math.max(0, depM - parkBuf);
            const carStartM = Math.max(0, carEndM - leg.durationMinutes);
            updatedDepTime = minutesToTime(carStartM);
            return {
              ...leg,
              startTime: updatedDepTime,
              endTime: minutesToTime(carEndM),
            };
          }
          return leg;
        });

        const updatedAvailableTrains = avail.map((item, idx) =>
          idx === targetIdx ? enrichedTarget : item,
        );

        setItinerary({
          ...itinerary,
          departureTime: updatedDepTime,
          liveTrain: enrichedTarget,
          availableTrains: updatedAvailableTrains,
          selectedTrainIndex: targetIdx,
          legs: updatedLegs,
        });
      }
    } else {
      pendingTrainRef.current = clean;
      setPendingTrainNumber(clean);
    }

    loadData(false, true, {
      selectedTrainNumber: trainNum,
      selectedTrainOffset: 0,
    });
  };

  const persistConfigOptimistic = useCallback(
    (nextCfg: CommuterConfig, partialUpdate: Partial<CommuterConfig>) => {
      const seq = ++configMutationSeqRef.current;
      configCacheRef.current = nextCfg;
      setConfig(nextCfg);
      saveCommuterConfig(partialUpdate)
        .then((saved) => {
          if (configMutationSeqRef.current === seq) {
            configCacheRef.current = saved;
          }
        })
        .catch(() => {});
    },
    [],
  );

  const scheduleCoalescedCalendarRefresh = useCallback(
    (opts?: {
      onlySlotKeys?: string[];
      precomputedItineraries?: Record<string, CommuterItinerary>;
      clearSlotPrecomputed?: string[];
    }) => {
      if (opts?.clearSlotPrecomputed) {
        for (const k of opts.clearSlotPrecomputed) {
          delete pendingCalPrecomputedRef.current[k];
        }
      }
      if (
        opts?.onlySlotKeys &&
        opts.onlySlotKeys.length > 0 &&
        !pendingCalForceAllRef.current
      ) {
        for (const k of opts.onlySlotKeys) {
          pendingCalDirtySlotsRef.current.add(k);
          if (opts.precomputedItineraries) {
            for (const [preKey, preItin] of Object.entries(
              opts.precomputedItineraries,
            )) {
              if (preKey === k || preKey.startsWith(`${k}:`)) {
                pendingCalPrecomputedRef.current[preKey] = preItin;
              }
            }
          }
        }
      } else {
        pendingCalForceAllRef.current = true;
        pendingCalDirtySlotsRef.current.clear();
        if (opts?.precomputedItineraries) {
          Object.assign(
            pendingCalPrecomputedRef.current,
            opts.precomputedItineraries,
          );
        } else {
          pendingCalPrecomputedRef.current = {};
        }
      }

      if (calendarRefreshTimerRef.current) {
        clearTimeout(calendarRefreshTimerRef.current);
      }
      calendarRefreshTimerRef.current = setTimeout(() => {
        calendarRefreshTimerRef.current = null;
        const onlySlots =
          !pendingCalForceAllRef.current &&
          pendingCalDirtySlotsRef.current.size > 0
            ? Array.from(pendingCalDirtySlotsRef.current)
            : undefined;
        const precomputed =
          Object.keys(pendingCalPrecomputedRef.current).length > 0
            ? { ...pendingCalPrecomputedRef.current }
            : undefined;
        pendingCalForceAllRef.current = false;
        pendingCalDirtySlotsRef.current.clear();
        pendingCalPrecomputedRef.current = {};

        refreshAppleCalendarIfConfigured({
          schedule: scheduleCacheRef.current,
          onlySlotKeys: onlySlots,
          precomputedItineraries: precomputed,
        }).catch(() => {});
      }, 90);
    },
    [],
  );

  const handleSaveConfig = async (newConfig: CommuterConfig) => {
    const prevCfg = configCacheRef.current || config;
    const optimisticConfig: CommuterConfig = { ...newConfig, enabled: true };
    persistConfigOptimistic(optimisticConfig, optimisticConfig);

    const coreRouteChanged =
      !prevCfg ||
      prevCfg.departureStation?.code !==
        optimisticConfig.departureStation?.code ||
      prevCfg.arrivalStation?.code !== optimisticConfig.arrivalStation?.code ||
      prevCfg.originAddress !== optimisticConfig.originAddress ||
      Boolean(prevCfg.carLeg?.enabled) !==
        Boolean(optimisticConfig.carLeg?.enabled) ||
      prevCfg.carLeg?.durationMinutes !==
        optimisticConfig.carLeg?.durationMinutes ||
      prevCfg.carLeg?.parkingBufferMinutes !==
        optimisticConfig.carLeg?.parkingBufferMinutes ||
      prevCfg.bufferMinutes !== optimisticConfig.bufferMinutes ||
      Boolean(prevCfg.includeIntercity) !==
        Boolean(optimisticConfig.includeIntercity) ||
      (prevCfg.transitLeg?.preferredMode || "auto") !==
        (optimisticConfig.transitLeg?.preferredMode || "auto");

    if (coreRouteChanged) {
      itinerariesCacheRef.current = {};
      setItinerariesByDay({});
      setSelectedTrainOffset(0);
      setSelectedTrainNumber(null);
      loadData(true, false, {
        selectedTrainOffset: 0,
        selectedTrainNumber: null,
      });
      if (calendarRefreshTimerRef.current) {
        clearTimeout(calendarRefreshTimerRef.current);
        calendarRefreshTimerRef.current = null;
      }
      pendingCalForceAllRef.current = false;
      pendingCalDirtySlotsRef.current.clear();
      pendingCalPrecomputedRef.current = {};
      refreshAppleCalendarIfConfigured({
        schedule: scheduleCacheRef.current,
      }).catch(() => {});
      return;
    }

    const prevPrefs = prevCfg.trainPreferences;
    const nextPrefs = optimisticConfig.trainPreferences;
    const smartReturnChanged =
      (prevPrefs?.smartReturnEnabled ?? true) !==
        (nextPrefs?.smartReturnEnabled ?? true) ||
      (prevPrefs?.maxEarlyLeaveMinutes ?? 15) !==
        (nextPrefs?.maxEarlyLeaveMinutes ?? 15) ||
      (prevPrefs?.minReturnGainMinutes ?? 25) !==
        (nextPrefs?.minReturnGainMinutes ?? 25);

    if (smartReturnChanged) {
      itinerariesCacheRef.current = {};
      setItinerariesByDay({});
      setSelectedTrainOffset(0);
      setSelectedTrainNumber(null);
      loadData(false, true, {
        selectedTrainOffset: 0,
        selectedTrainNumber: null,
      });
      scheduleCoalescedCalendarRefresh();
      return;
    }

    const calSlotKeys = getPreferredTrainDiffSlotKeys(
      prevPrefs?.preferredTrains,
      nextPrefs?.preferredTrains,
    );

    if (calSlotKeys.length === 0) return;

    const affectedPrefixes = new Set<string>();
    for (const slot of calSlotKeys) {
      const [calIdxStr, dir] = slot.split("_");
      const calIdx = parseInt(calIdxStr || "", 10);
      if ((dir === "outbound" || dir === "return") && !Number.isNaN(calIdx)) {
        const jsDay = (calIdx + 1) % 7;
        affectedPrefixes.add(`${dir}_${jsDay}_`);
        delete itinerariesCacheRef.current[String(jsDay)];
      }
    }

    for (const cacheKey of Object.keys(itinerariesCacheRef.current)) {
      for (const prefix of affectedPrefixes) {
        if (cacheKey.startsWith(prefix)) {
          delete itinerariesCacheRef.current[cacheKey];
          break;
        }
      }
    }

    const currentPrefix = `${direction}_${selectedDayIdx}_`;
    if (affectedPrefixes.has(currentPrefix)) {
      setSelectedTrainOffset(0);
      setSelectedTrainNumber(null);
      loadData(false, true, {
        selectedTrainOffset: 0,
        selectedTrainNumber: null,
      });
    }

    scheduleCoalescedCalendarRefresh({
      onlySlotKeys: calSlotKeys,
      clearSlotPrecomputed: calSlotKeys,
    });
  };

  const dayPreferredTrains = useMemo(
    () => getPreferredTrainsForDayDirection(config, direction, selectedDayIdx),
    [config, direction, selectedDayIdx],
  );

  const isCurrentTrainPreferred = Boolean(
    findMatchingPreferredTrain(
      config,
      direction,
      selectedDayIdx,
      itinerary?.liveTrain,
    ),
  );

  const handleTogglePreferredTrain = () => {
    const baseConfig = configCacheRef.current || config;
    if (!baseConfig || !itinerary?.liveTrain) return;
    const t = itinerary.liveTrain;
    const depTime = t.departureTimePlanned || t.departureTimeActual;
    if (!depTime) return;

    const currentPrefs = baseConfig.trainPreferences?.preferredTrains || {};
    const {
      nextMap: nextTrains,
      added,
      entry,
    } = togglePreferredTrainInMap(currentPrefs, direction, selectedDayIdx, t);

    const optimisticConfig: CommuterConfig = {
      ...baseConfig,
      trainPreferences: {
        ...baseConfig.trainPreferences,
        preferredTrains: nextTrains,
      },
    };
    persistConfigOptimistic(optimisticConfig, {
      trainPreferences: optimisticConfig.trainPreferences,
    });

    const prefix = `${direction}_${selectedDayIdx}_`;
    for (const cacheKey of Object.keys(itinerariesCacheRef.current)) {
      if (cacheKey.startsWith(prefix)) {
        delete itinerariesCacheRef.current[cacheKey];
      }
    }
    delete itinerariesCacheRef.current[String(selectedDayIdx)];

    const calDayIdx = jsDayToCalendarDayIndex(selectedDayIdx);
    const calSlotGroupKey = `${calDayIdx}_${direction}`;
    const exactSlotKey = entry
      ? `${calSlotGroupKey}:${entry.id}`
      : calSlotGroupKey;

    if (added) {
      // Stella appena attivata sul treno già visualizzato: nessun ricalcolo né spinner in UI
      setSelectedTrainOffset(0);
      const currentCacheKey = `${direction}_${selectedDayIdx}_${activeClassIdxRef.current ?? "auto"}`;
      itinerariesCacheRef.current[currentCacheKey] = itinerary;
      itinerariesCacheRef.current[String(selectedDayIdx)] = itinerary;
      setItinerariesByDay((prev) => ({
        ...prev,
        [selectedDayIdx]: itinerary,
      }));

      const canPrecomputeForCal = new Date().getDay() !== selectedDayIdx;
      scheduleCoalescedCalendarRefresh({
        onlySlotKeys: [calSlotGroupKey],
        precomputedItineraries: canPrecomputeForCal
          ? { [exactSlotKey]: itinerary }
          : undefined,
        clearSlotPrecomputed: canPrecomputeForCal
          ? undefined
          : [calSlotGroupKey, exactSlotKey],
      });
    } else {
      // Stella rimossa: se il treno era auto-selezionato dalla preferenza (nessuna chip esplicita attiva),
      // torna silenziosamente al treno consigliato standard; altrimenti mantieni il treno correntemente ispezionato.
      if (!selectedTrainNumber) {
        setSelectedTrainOffset(0);
        setSelectedTrainNumber(null);
        loadData(false, true, {
          selectedTrainOffset: 0,
          selectedTrainNumber: null,
        });
      }
      scheduleCoalescedCalendarRefresh({
        onlySlotKeys: [calSlotGroupKey],
        clearSlotPrecomputed: [calSlotGroupKey, exactSlotKey],
      });
    }
  };

  const handleToggleTransitMode = async (mode: "auto" | "walk") => {
    if (!config) return;
    const newConfig: CommuterConfig = {
      ...config,
      transitLeg: {
        ...config.transitLeg,
        preferredMode: mode,
      },
    };
    configCacheRef.current = newConfig;
    configMutationSeqRef.current++;
    setConfig(newConfig);
    itinerariesCacheRef.current = {};
    setItinerariesByDay({});

    // Aggiornamento ottimistico immediato dello stato per garantire reattività istantanea nella UI
    setItinerary((prev) => {
      if (!prev || !prev.legs) return prev;
      const isWalk = mode === "walk";
      const updatedLegs = prev.legs.map((l) => {
        if (
          l.id === "transit-leg" ||
          l.id === "return-transit-leg" ||
          l.type === "transit" ||
          l.type === "walk"
        ) {
          return {
            ...l,
            type: (isWalk ? "walk" : "transit") as TripLeg["type"],
            title: isWalk
              ? "A piedi"
              : l.details?.transitLine || "Mezzi Urbani",
            details: {
              ...l.details,
              travelMode: (isWalk ? "walking" : "transit") as
                | "walking"
                | "transit",
            },
          };
        }
        return l;
      });
      return { ...prev, legs: updatedLegs };
    });

    await saveCommuterConfig(newConfig);
    loadData(true, true);
  };

  const openGoogleMapsRoute = (
    originQuery?: string,
    destQuery?: string,
    mode: "transit" | "driving" | "walking" = "transit",
  ) => {
    if (!destQuery) {
      Alert.alert("Navigazione", "Nessuna destinazione specifica impostata.");
      return;
    }
    const encodedDest = encodeURIComponent(destQuery);
    const encodedOrigin = originQuery ? encodeURIComponent(originQuery) : "";
    const gmapsMode = mode;

    const gmapsAppUrl = originQuery
      ? `comgooglemaps://?saddr=${encodedOrigin}&daddr=${encodedDest}&directionsmode=${gmapsMode}`
      : `comgooglemaps://?daddr=${encodedDest}&directionsmode=${gmapsMode}`;

    const gmapsWebUrl = originQuery
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodedOrigin}&destination=${encodedDest}&travelmode=${gmapsMode}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodedDest}&travelmode=${gmapsMode}`;

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

  const handleOpenMaps = (leg: TripLeg) => {
    const dest = leg.details?.mapCoords
      ? `${leg.details.mapCoords.lat},${leg.details.mapCoords.lng}`
      : leg.details?.mapQuery;
    if (!dest) {
      Alert.alert(
        "Navigazione",
        "Nessuna destinazione specifica per questa tratta.",
      );
      return;
    }

    if (leg.type === "transit" || leg.type === "walk") {
      const stationName =
        config?.arrivalStation.shortName ||
        config?.arrivalStation.name ||
        "Stazione";
      const presetOrigin =
        leg.details?.mapOriginQuery ||
        (direction === "outbound" ? `Stazione Roma ${stationName}` : undefined);
      const originStationLabel =
        direction === "outbound"
          ? `Dalla Stazione di ${stationName}`
          : `Dall'Aula / Sede`;
      const isWalk = leg.type === "walk";
      const travelMode = isWalk ? "walking" : "transit";
      const sheetTitle = isWalk
        ? "Percorso a piedi su Google Maps"
        : "Cerca mezzi su Google Maps";

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [
              "Annulla",
              "Dalla posizione attuale (GPS)",
              originStationLabel,
            ],
            cancelButtonIndex: 0,
            title: sheetTitle,
            message: "Scegli il punto di partenza desiderato:",
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              openGoogleMapsRoute(undefined, dest, travelMode);
            } else if (buttonIndex === 2) {
              openGoogleMapsRoute(presetOrigin, dest, travelMode);
            }
          },
        );
      } else {
        Alert.alert(sheetTitle, "Scegli il punto di partenza desiderato:", [
          { text: "Annulla", style: "cancel" },
          {
            text: "Posizione GPS",
            onPress: () => openGoogleMapsRoute(undefined, dest, travelMode),
          },
          {
            text: originStationLabel,
            onPress: () => openGoogleMapsRoute(presetOrigin, dest, travelMode),
          },
        ]);
      }
      return;
    }

    const origin = leg.details?.mapOriginQuery;
    const mode = leg.details?.travelMode || "driving";
    openGoogleMapsRoute(
      origin,
      dest,
      mode === "walking" ? "walking" : "driving",
    );
  };

  const directionIndex = direction === "outbound" ? 0 : 1;
  const directionTitles = ["Andata", "Ritorno"];

  const now = new Date();
  const currentNowMins = now.getHours() * 60 + now.getMinutes();
  const isTargetLectureFinished = Boolean(
    isSelectedDayToday &&
    !isWeekend &&
    itinerary?.targetLecture &&
    (itinerary.targetLecture.subject === "Lezioni di oggi terminate" ||
      currentNowMins >=
        parseTimeToMinutes(itinerary.targetLecture.endTime || "18:00")),
  );

  // Ricalcola dinamicamente l'orario e la durata sulla card esterna della tappa del viaggio
  // affinché corrisponda al mezzo più efficiente e aggiorni l'eventuale ultima corsa utile
  const handleOptimalTransitResolved = useCallback(
    (update: OptimalTransitTimingUpdate) => {
      setItinerary((prev) => {
        if (!prev) return prev;
        const transitIdx = prev.legs.findIndex((l) => l.type === "transit");
        if (transitIdx === -1) return prev;
        const currentLeg = prev.legs[transitIdx];
        const newTitle =
          update.directLines && update.directLines.length === 1
            ? /^metro\b/i.test(update.directLines[0])
              ? update.directLines[0]
              : `Linea ${update.directLines[0]}`
            : update.directLines && update.directLines.length > 1
              ? `Linee ${update.directLines.join(" / ")}`
              : update.line
                ? /^metro\b/i.test(update.line)
                  ? update.line
                  : `Linea ${update.line}`
                : currentLeg.title;

        const prevLastId = prev.lastUsefulTransitDeparture?.id;
        const nextLastId = update.lastUsefulDeparture?.id;
        const prevLastTime =
          prev.lastUsefulTransitDeparture?.estimatedTime ||
          prev.lastUsefulTransitDeparture?.scheduledTime;
        const nextLastTime =
          update.lastUsefulDeparture?.estimatedTime ||
          update.lastUsefulDeparture?.scheduledTime;

        const prevLeaveLeg =
          prev.legs[0]?.id === "leave-lecture-leg" ? prev.legs[0] : null;
        const leaveLegNeedsSync = Boolean(
          prevLeaveLeg && prevLeaveLeg.durationMinutes !== 0,
        );
        const curDet = currentLeg.details;
        const segDetailsChanged =
          curDet?.walkBeforeMinutes !== update.walkBeforeMinutes ||
          curDet?.inVehicleMinutes !== update.inVehicleMinutes ||
          curDet?.walkAfterMinutes !== update.walkAfterMinutes ||
          curDet?.busDepartureTime !== update.busDepartureTime ||
          curDet?.busAlightingTime !== update.busAlightingTime ||
          curDet?.coincidenceAvailableFromTime !==
            update.coincidenceAvailableFromTime ||
          curDet?.firstAvailableDepartureTime !==
            update.firstAvailableDepartureTime;

        if (
          !leaveLegNeedsSync &&
          !segDetailsChanged &&
          currentLeg.startTime === update.startTime &&
          currentLeg.endTime === update.endTime &&
          currentLeg.durationMinutes === update.durationMinutes &&
          currentLeg.title === newTitle &&
          prevLastId === nextLastId &&
          prevLastTime === nextLastTime
        ) {
          return prev;
        }

        const updatedLegs = [...prev.legs];
        updatedLegs[transitIdx] = {
          ...currentLeg,
          title: newTitle,
          startTime: update.startTime,
          endTime: update.endTime,
          durationMinutes: update.durationMinutes,
          details: {
            ...currentLeg.details,
            walkBeforeMinutes: update.walkBeforeMinutes,
            inVehicleMinutes: update.inVehicleMinutes,
            walkAfterMinutes: update.walkAfterMinutes,
            busDepartureTime: update.busDepartureTime,
            busAlightingTime: update.busAlightingTime,
            coincidenceAvailableFromTime: update.coincidenceAvailableFromTime,
            firstAvailableDepartureTime: update.firstAvailableDepartureTime,
          },
        };

        // Se la tappa successiva è l'attesa in stazione (nel ritorno), riallinea il suo inizio all'arrivo del mezzo consigliato
        const nextLeg = updatedLegs[transitIdx + 1];
        let nextLectureTimeStatus = prev.lectureTimeStatus;

        if (
          nextLeg &&
          nextLeg.type === "wait" &&
          nextLeg.id === "station-wait-leg"
        ) {
          const refStartM = parseTimeToMinutes(update.startTime);
          const relStartM = normalizeRelativeMinutes(
            parseTimeToMinutes(update.endTime),
            refStartM,
          );
          const waitEndM = normalizeRelativeMinutes(
            parseTimeToMinutes(nextLeg.endTime),
            refStartM,
          );
          const newWaitDur = Math.max(0, waitEndM - relStartM);
          if (newWaitDur <= 3) {
            updatedLegs.splice(transitIdx + 1, 1);
          } else {
            updatedLegs[transitIdx + 1] = {
              ...nextLeg,
              startTime: update.endTime,
              durationMinutes: newWaitDur,
            };
          }
        } else if (
          prev.direction === "return" &&
          nextLeg &&
          nextLeg.type === "train"
        ) {
          const refStartM = parseTimeToMinutes(update.startTime);
          const relStartM = normalizeRelativeMinutes(
            parseTimeToMinutes(update.endTime),
            refStartM,
          );
          const waitEndM = normalizeRelativeMinutes(
            parseTimeToMinutes(nextLeg.startTime),
            refStartM,
          );
          const newWaitDur = waitEndM - relStartM;
          if (newWaitDur > 3) {
            const trainPlat = nextLeg.details?.platform;
            const stName = nextLeg.subtitle?.split(" ➔ ")[0];
            updatedLegs.splice(transitIdx + 1, 0, {
              id: "station-wait-leg",
              type: "wait",
              title: stName
                ? `Attesa in Stazione a ${stName}`
                : "Attesa in Stazione",
              subtitle: `Binario di partenza: ${trainPlat || "In definizione"}`,
              startTime: update.endTime,
              endTime: nextLeg.startTime,
              durationMinutes: newWaitDur,
              details: {
                platform: trainPlat,
              },
            });
          }
        } else if (
          prev.direction === "outbound" &&
          prev.targetLecture?.startTime &&
          prev.targetLecture?.endTime
        ) {
          const lectureStartM = parseTimeToMinutes(
            prev.targetLecture.startTime,
          );
          const lectureEndM = parseTimeToMinutes(prev.targetLecture.endTime);
          const classArrM = parseTimeToMinutes(update.endTime);
          const depRefM = parseTimeToMinutes(
            prev.departureTime || update.startTime,
          );
          const relClassArrM = normalizeRelativeMinutes(classArrM, depRefM);
          const nowDate = new Date();
          const nowM = nowDate.getHours() * 60 + nowDate.getMinutes();
          const isTargetDayToday =
            activeDayIdxRef.current === nowDate.getDay();
          const isLectureFinished =
            (isTargetDayToday && lectureEndM > 0 && nowM >= lectureEndM) ||
            (lectureEndM > 0 && relClassArrM >= lectureEndM);

          const existingLectureIdx = updatedLegs.findIndex(
            (l) => l.id === "lecture-leg",
          );

          if (isLectureFinished) {
            if (existingLectureIdx !== -1) {
              updatedLegs.splice(existingLectureIdx, 1);
            }
            nextLectureTimeStatus = undefined;
          } else if (relClassArrM > lectureStartM && relClassArrM < lectureEndM) {
            const remainingMins = Math.max(1, lectureEndM - relClassArrM);
            const remainingBadge = `${formatDuration(remainingMins)} rimanenti`;
            nextLectureTimeStatus = {
              type: "late_arrival",
              minutes: remainingMins,
              badgeText: remainingBadge,
            };
            const updatedLectureLeg: TripLeg = {
              id: "lecture-leg",
              type: "destination",
              title: `Arrivo a lezione: ${prev.targetLecture.subject}`,
              subtitle: `${prev.targetLecture.room} • ${prev.targetLecture.buildingName || ""}`,
              startTime: update.endTime,
              endTime: prev.targetLecture.endTime,
              durationMinutes: remainingMins,
              details: {
                notes: `Arrivo a lezione già iniziata • ${remainingBadge}`,
                badgeText: remainingBadge,
                badgeColor: "#f59e0b",
                badgeBg: "rgba(245, 158, 11, 0.15)",
                remainingLectureMinutes: remainingMins,
              },
            };
            if (existingLectureIdx !== -1) {
              updatedLegs[existingLectureIdx] = updatedLectureLeg;
            } else {
              updatedLegs.splice(transitIdx + 1, 0, updatedLectureLeg);
            }
          } else {
            const spareTime = lectureStartM - relClassArrM;
            nextLectureTimeStatus = undefined;
            const updatedLectureLeg: TripLeg = {
              id: "lecture-leg",
              type: "destination",
              title: `Inizio Lezione: ${prev.targetLecture.subject}`,
              subtitle: `${prev.targetLecture.room} • ${prev.targetLecture.buildingName || ""}`,
              startTime: prev.targetLecture.startTime,
              endTime: prev.targetLecture.endTime,
              durationMinutes: Math.max(60, lectureEndM - lectureStartM),
              details: {
                notes:
                  spareTime > 0
                    ? `Anticipo in aula: +${spareTime} min`
                    : "Arrivo puntuale a inizio lezione",
              },
            };
            if (existingLectureIdx !== -1) {
              updatedLegs[existingLectureIdx] = updatedLectureLeg;
            } else {
              updatedLegs.splice(transitIdx + 1, 0, updatedLectureLeg);
            }
          }
        }

        let newDepTime = prev.departureTime;
        let newArrTime = prev.arrivalTime;

        if (prev.direction === "outbound") {
          // In andata l'arrivo complessivo del viaggio coincide con l'arrivo reale (mezzo + camminata) in aula
          newArrTime = update.endTime;
        } else if (transitIdx === 0) {
          // Nel ritorno, se la prima tappa è il mezzo urbano, la partenza coincide con il mezzo consigliato
          newDepTime = update.startTime;
        } else if (
          updatedLegs[0]?.id === "leave-lecture-leg" &&
          prev.targetLecture?.endTime
        ) {
          const lecStartM = parseTimeToMinutes(
            prev.targetLecture.startTime || "08:30",
          );
          const lecEndM = parseTimeToMinutes(prev.targetLecture.endTime);
          // update.startTime è già l'orario di partenza dell'utente dall'origine (comprensivo di walkBefore),
          // mentre il tratto a piedi iniziale viene rappresentato sul nodo blu della linea verticale dei mezzi.
          const userLeaveM = parseTimeToMinutes(update.startTime);
          const leaveM = Math.max(lecStartM, userLeaveM);
          const lectureRoomSubtitle = prev.targetLecture.buildingName
            ? `${prev.targetLecture.room} • ${prev.targetLecture.buildingName}`
            : prev.targetLecture.room;
          if (leaveM < lecEndM) {
            const lostMins = Math.max(1, lecEndM - leaveM);
            const lostBadge = `Perdi ${formatDuration(lostMins)} di lezione`;
            nextLectureTimeStatus = {
              type: "early_departure",
              minutes: lostMins,
              badgeText: lostBadge,
            };
            updatedLegs[0] = {
              ...updatedLegs[0],
              title: `Termine lezione: ${prev.targetLecture.subject}`,
              subtitle: lectureRoomSubtitle,
              startTime: minutesToTime(leaveM),
              endTime: minutesToTime(leaveM),
              durationMinutes: 0,
              details: {
                ...updatedLegs[0].details,
                notes: `Partenza anticipata durante la lezione • ${lostBadge}`,
                badgeText: lostBadge,
                badgeColor: "#f59e0b",
                badgeBg: "rgba(245, 158, 11, 0.15)",
                lostLectureMinutes: lostMins,
              },
            };
            newDepTime = minutesToTime(leaveM);
          } else {
            nextLectureTimeStatus = undefined;
            updatedLegs[0] = {
              ...updatedLegs[0],
              title: `Termine lezione: ${prev.targetLecture.subject}`,
              subtitle: lectureRoomSubtitle,
              startTime: prev.targetLecture.endTime,
              endTime: prev.targetLecture.endTime,
              durationMinutes: 0,
              details: undefined,
            };
            newDepTime = prev.targetLecture.endTime;
          }
        }

        const depM = parseTimeToMinutes(newDepTime);
        const arrM = parseTimeToMinutes(newArrTime);
        let newTotalDur = elapsedMinutes(depM, arrM);
        if (newTotalDur <= 0) {
          const legsSum = updatedLegs.reduce(
            (acc, l) => acc + Math.max(0, l.durationMinutes || 0),
            0,
          );
          newTotalDur = legsSum > 0 ? legsSum : prev.totalDurationMinutes;
        }

        const isPrevTargetFinished = Boolean(
          prev.direction === "outbound" &&
            prev.targetLecture?.endTime &&
            activeDayIdxRef.current === new Date().getDay() &&
            new Date().getHours() * 60 + new Date().getMinutes() >=
              parseTimeToMinutes(prev.targetLecture.endTime),
        );

        const nextSmartOutbound =
          prev.direction === "outbound" &&
          prev.smartOutboundRecommendation?.isCurrentlySelected &&
          prev.targetLecture?.startTime
            ? {
                ...prev.smartOutboundRecommendation,
                lostLectureMinutes: Math.max(
                  0,
                  normalizeRelativeMinutes(arrM, depM) -
                    parseTimeToMinutes(prev.targetLecture.startTime),
                ),
                smartArrivalTime: newArrTime,
              }
            : prev.smartOutboundRecommendation;

        const nextSmartReturn =
          prev.direction === "return" &&
          prev.smartReturnRecommendation?.isCurrentlySelected &&
          prev.targetLecture?.endTime
            ? {
                ...prev.smartReturnRecommendation,
                lostLectureMinutes: Math.max(
                  0,
                  parseTimeToMinutes(prev.targetLecture.endTime) - depM,
                ),
              }
            : prev.smartReturnRecommendation;

        const nextItin: CommuterItinerary = {
          ...prev,
          departureTime: newDepTime,
          arrivalTime: newArrTime,
          totalDurationMinutes: newTotalDur,
          lectureTimeStatus: nextLectureTimeStatus,
          smartOutboundRecommendation: nextSmartOutbound,
          smartReturnRecommendation: nextSmartReturn,
          transitLiveContext: update.isLiveContext ?? prev.transitLiveContext,
          lastUsefulTransitDeparture: isPrevTargetFinished
            ? undefined
            : update.lastUsefulDeparture,
          legs: updatedLegs,
        };

        const dayIdx = activeDayIdxRef.current;
        const cacheKey = `${directionRef.current}_${dayIdx}_${activeClassIdxRef.current ?? "auto"}`;
        if (itinerariesCacheRef.current[cacheKey]) {
          itinerariesCacheRef.current[cacheKey] = nextItin;
        }
        if (itinerariesCacheRef.current[dayIdx]) {
          itinerariesCacheRef.current[dayIdx] = nextItin;
        }
        queueMicrotask(() => {
          setItinerariesByDay((prevMap) =>
            prevMap[dayIdx] ? { ...prevMap, [dayIdx]: nextItin } : prevMap,
          );
        });

        return nextItin;
      });
    },
    [],
  );

  const renderLoadingItinerary = () => (
    <View
      style={{
        minHeight: 190,
        justifyContent: "center",
        alignItems: "center",
        marginTop: 4,
        marginBottom: 12,
      }}
    >
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.loadingText, { marginTop: 12 }]}>
        Calcolo tempi...
      </Text>
    </View>
  );

  const heroDisruptionBorderColor = hasSelectedDayStrike
    ? "rgba(239, 68, 68, 0.55)"
    : hasSelectedDayWalkOnly
      ? "rgba(245, 158, 11, 0.50)"
      : null;

  const renderHeroDisruptionAlerts = (marginTop = 8) => {
    const totalAlerts =
      currentTrainDisruptions.length + currentWalkDisruptions.length;
    if (totalAlerts === 0) {
      return null;
    }

    const walkStrikes = currentWalkDisruptions.filter(
      (e) => e.category === "sciopero_tpl",
    );
    const walkOthers = currentWalkDisruptions.filter(
      (e) => e.category !== "sciopero_tpl",
    );

    const hasTrainStrike = currentTrainDisruptions.length > 0;
    const hasTplStrike = walkStrikes.length > 0;
    const hasWalkAlert = walkOthers.length > 0;
    const isRedAlert = hasTrainStrike || hasTplStrike;

    let summaryLabel = "";
    if (hasTrainStrike && hasTplStrike && hasWalkAlert) {
      summaryLabel = "Sciopero treni, mezzi e avvisi viabilità";
    } else if (hasTrainStrike && hasTplStrike) {
      summaryLabel = "Sciopero treni e mezzi sul tuo tragitto";
    } else if (hasTrainStrike && hasWalkAlert) {
      summaryLabel = "Sciopero treni e avvisi viabilità";
    } else if (hasTplStrike && hasWalkAlert) {
      summaryLabel = "Sciopero mezzi e avvisi viabilità";
    } else if (hasTrainStrike) {
      summaryLabel =
        formatTrainStrikeBannerSummary(
          currentTrainDisruptions[0],
          selectedDateIso,
        ) || "Sciopero treni sul tuo tragitto";
      summaryLabel = `Sciopero treni · ${summaryLabel}`;
    } else if (hasTplStrike) {
      const tplInfo = formatWalkDisruptionSummary(walkStrikes[0]);
      summaryLabel = `Sciopero mezzi · ${tplInfo.description}`;
    } else {
      const walkInfo = formatWalkDisruptionSummary(walkOthers[0]);
      summaryLabel = `${walkInfo.badgeLabel.charAt(0) + walkInfo.badgeLabel.slice(1).toLowerCase()} · ${walkInfo.description}`;
    }

    const targetFilter: "all" | "train" | "walk" =
      hasTrainStrike && (hasTplStrike || hasWalkAlert)
        ? "all"
        : hasTrainStrike
          ? "train"
          : "walk";
    const allHeroAlertIds = [
      ...currentTrainDisruptions.map((e) => e.id),
      ...walkStrikes.map((e) => e.id),
      ...walkOthers.map((e) => e.id),
    ].filter(Boolean);

    // Quando il tema è già sui toni del rosso/bordeaux/rosa (es. Rosso Sapienza o Rosa Rubino),
    // usa una palette ambra-oro ad alto contrasto per staccare nettamente dal fondo rosso della Hero Card.
    const isRedFamilyTheme =
      theme.id === "sapienza" || theme.id === "rose";
    const useHighContrastGold = isRedAlert && isRedFamilyTheme;

    const stripBgColor = useHighContrastGold
      ? "rgba(245, 158, 11, 0.20)"
      : isRedAlert
        ? "rgba(239, 68, 68, 0.16)"
        : "rgba(245, 158, 11, 0.13)";
    const stripBorderColor = useHighContrastGold
      ? "rgba(251, 191, 36, 0.65)"
      : isRedAlert
        ? "rgba(239, 68, 68, 0.45)"
        : "rgba(245, 158, 11, 0.4)";
    const strikeIconBg = useHighContrastGold
      ? "rgba(251, 191, 36, 0.26)"
      : "rgba(239, 68, 68, 0.24)";
    const strikeIconColor = useHighContrastGold ? "#fbbf24" : "#ef4444";
    const stripTextColor = useHighContrastGold
      ? "#fef08a"
      : isRedAlert
        ? "#fecaca"
        : "#fde68a";
    const countPillBg = useHighContrastGold
      ? "rgba(251, 191, 36, 0.26)"
      : isRedAlert
        ? "rgba(239, 68, 68, 0.24)"
        : "rgba(245, 158, 11, 0.24)";
    const countPillText = useHighContrastGold
      ? "#fde047"
      : isRedAlert
        ? "#fca5a5"
        : "#fcd34d";

    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() =>
          handleOpenDisruptionsModal(targetFilter, allHeroAlertIds)
        }
        style={[
          styles.heroDisruptionCompactStrip,
          {
            marginTop,
            backgroundColor: stripBgColor,
            borderColor: stripBorderColor,
          },
        ]}
      >
        <View style={styles.heroDisruptionCompactIconsWrap}>
          {hasTrainStrike && (
            <View
              style={[
                styles.heroDisruptionCompactIconDot,
                { backgroundColor: strikeIconBg },
              ]}
            >
              <Ionicons name="train" size={11} color={strikeIconColor} />
            </View>
          )}
          {hasTplStrike && (
            <View
              style={[
                styles.heroDisruptionCompactIconDot,
                { backgroundColor: strikeIconBg },
              ]}
            >
              <Ionicons name="bus" size={11} color={strikeIconColor} />
            </View>
          )}
          {hasWalkAlert && (
            <View
              style={[
                styles.heroDisruptionCompactIconDot,
                { backgroundColor: "rgba(245, 158, 11, 0.24)" },
              ]}
            >
              <Ionicons name="megaphone" size={11} color="#f59e0b" />
            </View>
          )}
        </View>

        <Text
          style={[
            styles.heroDisruptionCompactText,
            { color: stripTextColor },
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {summaryLabel}
        </Text>

        {totalAlerts > 1 && (
          <View
            style={[
              styles.heroDisruptionCompactCountPill,
              {
                backgroundColor: countPillBg,
              },
            ]}
          >
            <Text
              style={[
                styles.heroDisruptionCompactCountText,
                { color: countPillText },
              ]}
            >
              {totalAlerts}
            </Text>
          </View>
        )}

        <Ionicons
          name="chevron-forward"
          size={12.5}
          color={countPillText}
          style={{ marginLeft: 4 }}
        />
      </TouchableOpacity>
    );
  };

  const renderEmptyItinerary = () => (
    <View
      style={[
        styles.heroCard,
        {
          backgroundColor: theme.cardTint,
          borderColor: heroDisruptionBorderColor || theme.border,
          minHeight: 190,
          justifyContent: "center",
          alignItems: "center",
          marginTop: 4,
        },
      ]}
    >
      <Ionicons
        name="train-outline"
        size={38}
        color="#64748b"
        style={{ marginBottom: 8 }}
      />
      <Text style={[styles.emptyTitle, { color: theme.light, fontSize: 15 }]}>
        Nessun collegamento trovato
      </Text>
      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { marginTop: 14, paddingHorizontal: 20, paddingVertical: 10 },
        ]}
        onPress={() => loadData(true)}
      >
        <Text style={styles.primaryBtnText}>Ricalcola</Text>
      </TouchableOpacity>
      {renderHeroDisruptionAlerts(14)}
    </View>
  );

  const isGlassHosted = hasNativeCallstackLiquidGlass || Platform.OS === "ios";

  const renderGlassPillBackdrop = (
    borderRadius: number,
    tintColor: string,
    fallbackBg: string,
    fallbackBorderColor?: string,
    fallbackBorderWidth = 1,
    effect: "regular" | "clear" = "regular",
  ) => {
    if (hasNativeCallstackLiquidGlass && CallstackLiquidGlass?.LiquidGlassView) {
      return (
        <CallstackLiquidGlass.LiquidGlassView
          effect={effect}
          interactive={true}
          colorScheme="dark"
          tintColor={tintColor}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          pointerEvents="none"
        />
      );
    }
    if (Platform.OS === "ios") {
      return (
        <BlurView
          intensity={30}
          tint="dark"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius,
              overflow: "hidden",
              backgroundColor: fallbackBg,
              ...(fallbackBorderColor
                ? {
                    borderWidth: fallbackBorderWidth,
                    borderColor: fallbackBorderColor,
                  }
                : {}),
            },
          ]}
          pointerEvents="none"
        />
      );
    }
    return null;
  };

  const renderJumpToTodayPill = () => (
    <TouchableOpacity
      onPress={handleResetToToday}
      activeOpacity={0.82}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel="Torna a oggi"
      style={[
        styles.jumpToTodayPill,
        { shadowColor: theme.primary },
        !isGlassHosted && {
          backgroundColor: theme.primary,
          borderWidth: 1,
          borderColor: theme.primary,
        },
      ]}
    >
      {renderGlassPillBackdrop(14, theme.primary, theme.primary, theme.primary)}
      <Ionicons
        name="arrow-undo-outline"
        size={12}
        color="#ffffff"
        style={{ marginRight: 5 }}
      />
      <Text style={styles.jumpToTodayText} numberOfLines={1}>
        Torna a oggi
      </Text>
    </TouchableOpacity>
  );

  const renderAdjacentDayPreview = (
    w: WeekdayItem,
    pageClasses: ClassEvent[],
  ) => {
    const isPageToday = todayDayIdx === w.dayIdx;
    const cachedItin = itinerariesByDay[w.dayIdx];

    return (
      <View>
        {/* Sezione Selettore Lezioni del Giorno */}
        <View style={styles.lecturesSection}>
          <View style={styles.sectionHeaderRow}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flex: 1,
              }}
            >
              <Ionicons
                name={w.isWeekend ? "sunny-outline" : "school-outline"}
                size={13}
                color={theme.accent}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.sectionTitle, { color: theme.accent }]}>
                {w.isWeekend
                  ? `FINE SETTIMANA • ${w.fullLabel.toUpperCase()}`
                  : `${w.fullLabel.toUpperCase()}`}
              </Text>
            </View>

            {!isPageToday && renderJumpToTodayPill()}
          </View>

          {w.isWeekend ? (
            <View style={[styles.noClassesCard, { borderColor: theme.border }]}>
              <Ionicons
                name="train-outline"
                size={18}
                color={theme.primary}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.noClassesText, { color: theme.light }]}>
                Nessuna lezione universitaria • Monitoraggio treni
                stazione-stazione
              </Text>
            </View>
          ) : !scheduleHydrated && pageClasses.length === 0 ? null : pageClasses.length === 0 ? (
            <View style={[styles.noClassesCard, { borderColor: theme.border }]}>
              <Ionicons
                name="sunny-outline"
                size={18}
                color="#94a3b8"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.noClassesText}>
                Nessuna lezione in programma per questo giorno
              </Text>
            </View>
          ) : (
            (() => {
              const pageSchedDayIdx = jsDayToScheduleDayIndex(w.dayIdx);
              const pageActiveClasses = pageClasses.filter(
                (c) => !isLessonExcluded(pageSchedDayIdx, c, excludedSet),
              );
              const previewTarget =
                pageActiveClasses.length > 0
                  ? getAutoTargetClass(
                      pageActiveClasses,
                      isPageToday,
                      direction,
                      new Date(),
                    )
                  : null;
              const previewTargetIndex = previewTarget
                ? pageClasses.findIndex(
                    (c) =>
                      !isLessonExcluded(pageSchedDayIdx, c, excludedSet) &&
                      c.subject === previewTarget.subject &&
                      c.startTime === previewTarget.startTime &&
                      c.endTime === previewTarget.endTime,
                  )
                : -1;
              const validPreviewIdx =
                previewTargetIndex >= 0 ? previewTargetIndex : 0;
              const previewOffset = getLectureScrollOffset(
                validPreviewIdx,
                screenWidth,
              );

              return (
                <ScrollView
                  horizontal
                  nestedScrollEnabled={true}
                  showsHorizontalScrollIndicator={false}
                  contentOffset={{ x: previewOffset, y: 0 }}
                  contentContainerStyle={styles.classesScrollContainer}
                >
                  {pageClasses.map((item, idx) => {
                    const isExcluded = isLessonExcluded(
                      pageSchedDayIdx,
                      item,
                      excludedSet,
                    );
                    const isSelected = previewTarget
                      ? !isExcluded &&
                        item.subject === previewTarget.subject &&
                        item.startTime === previewTarget.startTime &&
                        item.endTime === previewTarget.endTime
                      : false;

                    return (
                      <LectureCard
                        key={`${w.dayIdx}-${item.subject}-${item.startTime}-${idx}`}
                        item={item}
                        isSelected={isSelected}
                        isExcluded={isExcluded}
                        theme={theme}
                      />
                    );
                  })}
                </ScrollView>
              );
            })()
          )}
        </View>

        {/* Corpo Itinerario per giorno adiacente: se non ancora scaricato mostra il loader uniforme "Calcolo tempi...", altrimenti evita la card parziale monca durante lo swipe */}
        {!cachedItin && renderLoadingItinerary()}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
        {/* ── Liquid Glass Header: Titolo "Viaggio" + Segmented Control + Giorni della Settimana ── */}
        <View
          style={[
            styles.liquidGlassHeader,
            { paddingTop: insets.top > 0 ? insets.top + 6 : 14 },
          ]}
        >
          <BlurView
            tint="dark"
            intensity={65}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.liquidGlassOverlay} />

          {/* Titolo iOS Large Title "Viaggio" */}
          <View style={styles.liquidGlassTitleRow}>
            <View>
              <Text style={styles.liquidGlassTitle}>Viaggio</Text>
              {config?.enabled !== false && lastUpdated && (
                <View style={styles.liveUpdatedRow}>
                  <Text style={styles.liveUpdatedText}>
                    Aggiornato{" "}
                    {lastUpdated.toLocaleTimeString("it-IT", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </Text>
                </View>
              )}
            </View>
            {config?.enabled !== false && (
              <View style={styles.headerActions}>
                <View style={styles.headerAlertBtnWrapper}>
                  {hasSelectedDayStrike && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.headerStrikePulseHalo,
                        {
                          opacity: strikePulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.55, 0],
                          }),
                          transform: [
                            {
                              scale: strikePulseAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 1.38],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  )}
                  <TouchableOpacity
                    style={[
                      styles.headerIconBtn,
                      hasSelectedDayStrike && styles.headerIconBtnStrike,
                      hasSelectedDayWalkOnly && styles.headerIconBtnWalkAlert,
                    ]}
                    activeOpacity={0.7}
                    onPress={() =>
                      handleOpenDisruptionsModal(
                        hasSelectedDayTrainStrike ? "train" : "all",
                        currentTrainDisruptions[0]?.id ||
                          currentWalkDisruptions[0]?.id ||
                          null,
                      )
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Registro scioperi e manifestazioni"
                  >
                    {isNativeIos && CallstackLiquidGlass?.LiquidGlassView ? (
                      <CallstackLiquidGlass.LiquidGlassView
                        effect="regular"
                        colorScheme="dark"
                        tintColor={
                          hasSelectedDayStrike
                            ? "rgba(239, 68, 68, 0.34)"
                            : hasSelectedDayWalkOnly
                              ? "rgba(245, 158, 11, 0.24)"
                              : "rgba(255, 255, 255, 0.12)"
                        }
                        style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                      />
                    ) : null}
                    <Ionicons
                      name={
                        hasSelectedDayStrike || hasSelectedDayWalkOnly
                          ? "megaphone"
                          : "megaphone-outline"
                      }
                      size={
                        hasSelectedDayStrike || hasSelectedDayWalkOnly ? 19 : 18
                      }
                      color={
                        hasSelectedDayStrike
                          ? "#ff453a"
                          : hasSelectedDayWalkOnly
                            ? "#f59e0b"
                            : "#fff"
                      }
                    />
                  </TouchableOpacity>
                  {(hasSelectedDayStrike || hasSelectedDayWalkOnly) && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.headerAlertBadge,
                        {
                          backgroundColor: hasSelectedDayWalkOnly
                            ? "#f59e0b"
                            : "#ef4444",
                        },
                      ]}
                    >
                      <Text style={styles.headerAlertBadgeText}>
                        {selectedDayAlertCount > 1
                          ? String(selectedDayAlertCount)
                          : "!"}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.headerIconBtn, { marginLeft: 8 }]}
                  activeOpacity={0.7}
                  onPress={() => setConfigModalVisible(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Impostazioni viaggio pendolare"
                >
                  {isNativeIos && CallstackLiquidGlass?.LiquidGlassView ? (
                    <CallstackLiquidGlass.LiquidGlassView
                      effect="regular"
                      colorScheme="dark"
                      tintColor="rgba(255, 255, 255, 0.12)"
                      style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                    />
                  ) : null}
                  <Ionicons name="options-outline" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Segmented Control Andata / Ritorno e Selettore Giorni (visibili solo se attivo) */}
          {config?.enabled !== false && (
            <>
              <View style={styles.switcherContainer}>
                {isNativeIos ? (
                  <SegmentedControl
                    key={`seg-viaggio-${theme.primary}`}
                    values={directionTitles}
                    selectedIndex={directionIndex}
                    onChange={(event) => {
                      const idx = event.nativeEvent.selectedSegmentIndex;
                      handleDirectionChange(idx === 0 ? "outbound" : "return");
                    }}
                    appearance="dark"
                    tintColor={theme.primary}
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
                    style={styles.nativeSegmentedControl}
                  />
                ) : (
                  <View style={styles.customSegmentedControl}>
                    <TouchableOpacity
                      style={[
                        styles.customSegmentBtn,
                        direction === "outbound" && [
                          styles.customSegmentBtnActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => handleDirectionChange("outbound")}
                    >
                      <Ionicons
                        name="school-outline"
                        size={15}
                        color={direction === "outbound" ? "#fff" : "#a1a1aa"}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.customSegmentText,
                          direction === "outbound" &&
                            styles.customSegmentTextActive,
                        ]}
                      >
                        Andata
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.customSegmentBtn,
                        direction === "return" && [
                          styles.customSegmentBtnActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ],
                      ]}
                      activeOpacity={0.7}
                      onPress={() => handleDirectionChange("return")}
                    >
                      <Ionicons
                        name="home-outline"
                        size={15}
                        color={direction === "return" ? "#fff" : "#a1a1aa"}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.customSegmentText,
                          direction === "return" &&
                            styles.customSegmentTextActive,
                        ]}
                      >
                        Ritorno
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Selettore Giorno della settimana - Liquid Glass Week Bar */}
              <View style={styles.daySelectorContainer}>
                <View style={styles.daySegmentedBar}>
                  <View style={styles.daySegmentInnerContainer}>
                    {sliderReady && (
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.slidingActivePill,
                          {
                            left: sliderPillAnim,
                            width: sliderWidthAnim,
                            backgroundColor: weekendPillAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [theme.bg, theme.weekend.bg],
                            }),
                            borderColor: weekendPillAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [theme.primary, theme.weekend.color],
                            }),
                            shadowColor: weekendPillAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [theme.primary, theme.weekend.color],
                            }),
                          },
                        ]}
                      />
                    )}

                    {WEEKDAYS.map((w, idx) => {
                      const isSelected = selectedDayIdx === w.dayIdx;
                      const isItemToday = todayDayIdx === w.dayIdx;
                      const isItemWeekend = Boolean(w.isWeekend);

                      const textScale =
                        screenWidth > 0
                          ? pagerScrollAnim.interpolate({
                              inputRange: [
                                (idx - 1) * screenWidth,
                                idx * screenWidth,
                                (idx + 1) * screenWidth,
                              ],
                              outputRange: [1, 1.15, 1],
                              extrapolate: "clamp",
                            })
                          : 1;

                      const textColor =
                        screenWidth > 0
                          ? pagerScrollAnim.interpolate({
                              inputRange: [
                                (idx - 1) * screenWidth,
                                idx * screenWidth,
                                (idx + 1) * screenWidth,
                              ],
                              outputRange: [
                                isItemWeekend ? "#d4d4d8" : "#a1a1aa",
                                "#ffffff",
                                isItemWeekend ? "#d4d4d8" : "#a1a1aa",
                              ],
                              extrapolate: "clamp",
                            })
                          : isSelected
                            ? "#ffffff"
                            : isItemWeekend
                              ? "#d4d4d8"
                              : "#a1a1aa";

                      return (
                        <Fragment key={w.dayIdx}>
                          {idx === 5 && (
                            <View style={styles.dayWeekendDivider} />
                          )}
                          <TouchableOpacity
                            onLayout={(e) => handleSegmentLayout(idx, e)}
                            onPress={() => handleDayPress(w.dayIdx)}
                            activeOpacity={0.7}
                            style={styles.daySegmentItem}
                          >
                            <Animated.Text
                              style={[
                                styles.daySegmentLabel,
                                {
                                  transform: [{ scale: textScale }],
                                  color: textColor,
                                },
                              ]}
                            >
                              {w.label}
                            </Animated.Text>

                            {/* Pallino indicatore (Giorno selezionato bianco / Oggi se non selezionato) */}
                            {/* Mostra il pallino bianco esclusivamente per il giorno corrente (oggi) */}
                            {isItemToday ? (
                              <View
                                style={[
                                  styles.daySegmentDot,
                                  styles.daySegmentDotActive,
                                ]}
                              />
                            ) : null}
                          </TouchableOpacity>
                        </Fragment>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          )}
        </View>

        {config?.enabled === false ? (
          <View style={styles.inactiveStateWrapper}>
            <View
              style={[
                styles.inactiveStateCard,
                { borderColor: theme.border, backgroundColor: "#1c1c1e" },
              ]}
            >
              <View
                style={[
                  styles.inactiveIconCircle,
                  { backgroundColor: theme.subtle, borderColor: theme.border },
                ]}
              >
                <Ionicons name="train-outline" size={34} color={theme.accent} />
              </View>
              <Text style={styles.inactiveStateTitle}>
                Funzionalità non attiva
              </Text>
              <Text style={styles.inactiveStateDesc}>
                La sezione viaggio non è attiva finché non vengono configurate
                le impostazioni del tuo tragitto pendolare.
              </Text>
              <NativeActionButton
                label="Configura"
                onPress={() => setConfigModalVisible(true)}
                accentColor={theme.primary}
                glow={true}
                icon={
                  <Ionicons
                    name="settings-outline"
                    size={16}
                    color="#ffffff"
                    style={{ marginRight: 6 }}
                  />
                }
                style={{ alignSelf: "center", minWidth: 160 }}
              />
            </View>
          </View>
        ) : (
          <ScrollView
            ref={horizontalPagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            directionalLockEnabled
            nestedScrollEnabled
            contentOffset={{ x: initialWeekdayIndex * screenWidth, y: 0 }}
            onScroll={handlePagerScroll}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            scrollEventThrottle={16}
            style={styles.horizontalPager}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {WEEKDAYS.map((w, pageIdx) => {
              const isCurrentDayPage = pageIdx === currentWeekdayIndex;
              const pageClasses = getDayClasses(
                w.dayIdx,
                schedule,
                manualEvents,
                defaultTabUrl,
              );

              return (
                <View
                  key={w.dayIdx}
                  style={[styles.pagerPage, { width: screenWidth }]}
                >
                  <ScrollView
                    style={styles.scrollBody}
                    contentContainerStyle={[
                      styles.scrollContent,
                      { paddingBottom: insets.bottom + 90 },
                    ]}
                    refreshControl={
                      isCurrentDayPage ? (
                        <RefreshControl
                          refreshing={refreshing}
                          onRefresh={() => loadData(true)}
                          tintColor={theme.primary}
                          colors={[theme.primary]}
                        />
                      ) : undefined
                    }
                  >
                    {isCurrentDayPage ? (
                      <View>
                        {(isWeekend || scheduleHydrated || dayClasses.length > 0) &&
                          (config !== null || itinerary !== null || !loading) && (
                          <View style={styles.lecturesSection}>
                          <View style={styles.sectionHeaderRow}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                flex: 1,
                              }}
                            >
                              <Ionicons
                                name={
                                  isWeekend ? "sunny-outline" : "school-outline"
                                }
                                size={13}
                                color={theme.accent}
                                style={{ marginRight: 6 }}
                              />
                              <Text
                                style={[
                                  styles.sectionTitle,
                                  { color: theme.accent },
                                ]}
                              >
                                {isWeekend
                                  ? `FINE SETTIMANA • ${currentWeekday.fullLabel.toUpperCase()}`
                                  : `${currentWeekday.fullLabel.toUpperCase()}`}
                              </Text>
                            </View>

                            {!isSelectedDayToday && renderJumpToTodayPill()}
                          </View>

                          {isWeekend ? (
                            <View
                              style={[
                                styles.noClassesCard,
                                { borderColor: theme.border },
                              ]}
                            >
                              <Ionicons
                                name="train-outline"
                                size={18}
                                color={theme.primary}
                                style={{ marginRight: 8 }}
                              />
                              <Text
                                style={[
                                  styles.noClassesText,
                                  { color: theme.light },
                                ]}
                              >
                                Nessuna lezione universitaria • Monitoraggio
                                treni stazione-stazione
                              </Text>
                            </View>
                          ) : dayClasses.length === 0 ? (
                            <View
                              style={[
                                styles.noClassesCard,
                                { borderColor: theme.border },
                              ]}
                            >
                              <Ionicons
                                name="sunny-outline"
                                size={18}
                                color="#94a3b8"
                                style={{ marginRight: 8 }}
                              />
                              <Text style={styles.noClassesText}>
                                Nessuna lezione in programma per questo giorno
                              </Text>
                            </View>
                          ) : (
                            <ScrollView
                              ref={lecturesScrollRef}
                              horizontal
                              nestedScrollEnabled={true}
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={
                                styles.classesScrollContainer
                              }
                            >
                              {dayClasses.map((item, idx) => {
                                const isExcluded = isLessonExcluded(
                                  jsDayToScheduleDayIndex(selectedDayIdx),
                                  item,
                                  excludedSet,
                                );
                                const isSelected = activeSelectedClass
                                  ? item.subject ===
                                      activeSelectedClass.subject &&
                                    item.startTime ===
                                      activeSelectedClass.startTime &&
                                    item.endTime ===
                                      activeSelectedClass.endTime
                                  : false;

                                return (
                                  <LectureCard
                                    key={`${selectedDayIdx}-${item.subject}-${item.startTime}-${idx}`}
                                    item={item}
                                    isSelected={isSelected}
                                    isExcluded={isExcluded}
                                    theme={theme}
                                    onPress={() => handleSelectClass(idx)}
                                  />
                                );
                              })}
                            </ScrollView>
                          )}
                        </View>
                        )}

                        {/* Corpo Principale Itinerario: se l'itinerario è già disponibile, lo renderizza direttamente azzerando sovrapposizioni e lampeggi con "Calcolo tempi..." */}
                        {!itinerary && loading ? (
                          renderLoadingItinerary()
                        ) : !itinerary ? (
                          renderEmptyItinerary()
                        ) : (
                          <>
                            {/* Hero Card */}
                            <View
                              style={[
                                styles.heroCard,
                                {
                                  backgroundColor: theme.cardTint,
                                  borderColor:
                                    heroDisruptionBorderColor || theme.border,
                                },
                              ]}
                            >
                              {/* Badge in alto a destra: Durata + eventuale Ritardo a distanza ravvicinata (sganciati dal flusso verticale) */}
                              <View
                                style={styles.heroTopRightBadgeStack}
                                pointerEvents="none"
                              >
                                <View style={styles.durationBadge}>
                                  <Ionicons
                                    name="time-outline"
                                    size={13}
                                    color="#94a3b8"
                                    style={{ marginRight: 4 }}
                                  />
                                  <Text style={styles.durationBadgeText}>
                                    {formatDuration(
                                      itinerary.totalDurationMinutes > 0
                                        ? itinerary.totalDurationMinutes
                                        : itinerary.legs.reduce(
                                            (acc, l) =>
                                              acc +
                                              Math.max(
                                                0,
                                                l.durationMinutes || 0,
                                              ),
                                            0,
                                          ),
                                    )}
                                  </Text>
                                </View>
                              </View>

                              {/* Riga Intestazione Hero Card con Titolo */}
                              <View style={styles.heroHeadlineRow}>
                                <Text style={styles.heroHeadline}>
                                  {direction === "return"
                                    ? "Rientro stimato alle"
                                    : "Partenza stimata alle"}
                                </Text>
                              </View>

                              {/* Orario Principale */}
                              <Text style={styles.heroBigTime}>
                                {direction === "outbound"
                                  ? itinerary.departureTime
                                  : itinerary.arrivalTime}
                              </Text>

                              {(() => {
                                const hasNoActiveTargetLecture =
                                  !isWeekend &&
                                  !itinerary.targetLecture &&
                                  !activeSelectedClass;
                                const isTargetExcluded =
                                  !isWeekend &&
                                  !!activeSelectedClass &&
                                  isLessonExcluded(
                                    jsDayToScheduleDayIndex(selectedDayIdx),
                                    activeSelectedClass,
                                    excludedSet,
                                  );

                                const iconColor = theme.accent;
                                const iconBg = "rgba(255, 255, 255, 0.08)";
                                const roomLabel =
                                  itinerary.targetLecture?.room?.trim() ||
                                  activeSelectedClass?.room?.trim() ||
                                  "";
                                const buildingLabel =
                                  itinerary.targetLecture?.buildingName?.trim() ||
                                  "";
                                const locationLabel =
                                  roomLabel &&
                                  buildingLabel &&
                                  !roomLabel
                                    .toLowerCase()
                                    .includes(buildingLabel.toLowerCase())
                                    ? `${roomLabel} (${buildingLabel})`
                                    : roomLabel || buildingLabel;

                                const targetStartTime =
                                  itinerary.targetLecture?.startTime ||
                                  activeSelectedClass?.startTime ||
                                  "";
                                const targetEndTime =
                                  itinerary.targetLecture?.endTime ||
                                  activeSelectedClass?.endTime ||
                                  "";
                                const targetStartM =
                                  parseTimeToMinutes(targetStartTime);
                                const targetEndM =
                                  parseTimeToMinutes(targetEndTime);
                                const nowDateHero = new Date();
                                const isTargetTodayHero =
                                  selectedDayIdx === nowDateHero.getDay();
                                const nowHeroM =
                                  nowDateHero.getHours() * 60 +
                                  nowDateHero.getMinutes();

                                const isInProgressNow = Boolean(
                                  !isWeekend &&
                                  !hasNoActiveTargetLecture &&
                                  !isTargetLectureFinished &&
                                  isTargetTodayHero &&
                                  targetStartM > 0 &&
                                  targetEndM > targetStartM &&
                                  nowHeroM >= targetStartM &&
                                  nowHeroM < targetEndM,
                                );
                                const nowRemainingMins = isInProgressNow
                                  ? Math.max(1, targetEndM - nowHeroM)
                                  : 0;
                                const nowRemainingText =
                                  nowRemainingMins > 0
                                    ? `${formatDuration(nowRemainingMins)} rimanenti`
                                    : "";

                                const mainTitle = isWeekend
                                  ? direction === "outbound"
                                    ? `Tragitto verso ${config?.arrivalStation.shortName || config?.arrivalStation.name}`
                                    : `Rientro ad ${config?.originAddress}`
                                  : hasNoActiveTargetLecture
                                    ? dayClasses.length > 0
                                      ? "Tutte le lezioni escluse"
                                      : direction === "outbound"
                                        ? `Tragitto verso ${config?.arrivalStation.shortName || config?.arrivalStation.name}`
                                        : `Rientro ad ${config?.originAddress}`
                                    : direction === "outbound"
                                      ? itinerary.targetLecture?.subject &&
                                        itinerary.targetLecture.subject !==
                                          "Lezioni di oggi terminate"
                                        ? itinerary.targetLecture.subject
                                        : activeSelectedClass?.subject ||
                                          "Lezione"
                                      : itinerary.targetLecture?.subject &&
                                          itinerary.targetLecture.subject !==
                                            "Lezioni di oggi terminate"
                                        ? itinerary.targetLecture.subject
                                        : `Rientro ad ${config?.originAddress}`;

                                const isLateArrival = Boolean(
                                  !isWeekend &&
                                  !hasNoActiveTargetLecture &&
                                  !isTargetLectureFinished &&
                                  direction === "outbound" &&
                                  itinerary.lectureTimeStatus?.type ===
                                    "late_arrival",
                                );
                                const isOutboundInProgress =
                                  isLateArrival ||
                                  (direction === "outbound" && isInProgressNow);
                                const outboundRemainingText =
                                  itinerary.lectureTimeStatus?.type ===
                                    "late_arrival" &&
                                  itinerary.lectureTimeStatus.badgeText
                                    ? itinerary.lectureTimeStatus.badgeText
                                    : nowRemainingText;
                                const isReturnEarlyDeparture = Boolean(
                                  !isWeekend &&
                                  !hasNoActiveTargetLecture &&
                                  !isTargetLectureFinished &&
                                  direction === "return" &&
                                  itinerary.lectureTimeStatus?.type ===
                                    "early_departure" &&
                                  itinerary.lectureTimeStatus.badgeText,
                                );

                                return (
                                  <View style={styles.heroTargetLectureBox}>
                                    <View
                                      style={[
                                        styles.heroLectureIconBox,
                                        { backgroundColor: iconBg },
                                      ]}
                                    >
                                      <Ionicons
                                        name={
                                          isWeekend || hasNoActiveTargetLecture
                                            ? "train"
                                            : isTargetLectureFinished
                                              ? "checkmark-circle"
                                              : direction === "outbound"
                                                ? "school"
                                                : "home"
                                        }
                                        size={16}
                                        color={iconColor}
                                      />
                                    </View>

                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <View style={styles.heroLectureTitleRow}>
                                        <Text
                                          style={[
                                            styles.heroLectureSubject,
                                            { flex: 1 },
                                          ]}
                                          numberOfLines={1}
                                        >
                                          {mainTitle}
                                        </Text>
                                        {isTargetExcluded && (
                                          <View
                                            style={
                                              styles.heroLectureExcludedPill
                                            }
                                          >
                                            <Text
                                              style={
                                                styles.heroLectureExcludedText
                                              }
                                            >
                                              Esclusa
                                            </Text>
                                          </View>
                                        )}
                                      </View>

                                      <View style={styles.heroLectureMetaRow}>
                                        {isWeekend ? (
                                          <View
                                            style={styles.heroLectureMetaItem}
                                          >
                                            <Ionicons
                                              name="train-outline"
                                              size={12}
                                              color="#94a3b8"
                                              style={{ marginTop: 2 }}
                                            />
                                            <Text
                                              style={styles.heroLectureDetails}
                                            >
                                              Nessuna lezione collegata
                                            </Text>
                                          </View>
                                        ) : hasNoActiveTargetLecture ? (
                                          <View
                                            style={styles.heroLectureMetaItem}
                                          >
                                            <Ionicons
                                              name="information-circle-outline"
                                              size={12}
                                              color="#94a3b8"
                                              style={{ marginTop: 2 }}
                                            />
                                            <Text
                                              style={styles.heroLectureDetails}
                                            >
                                              {dayClasses.length > 0
                                                ? "Tocca una lezione sopra per usarla"
                                                : "Nessuna lezione attiva"}
                                            </Text>
                                          </View>
                                        ) : (
                                          <>
                                            {/* Riga 1: Posizione (Aula + Edificio) */}
                                            {Boolean(locationLabel) && (
                                              <View
                                                style={
                                                  styles.heroLectureMetaItem
                                                }
                                              >
                                                <Ionicons
                                                  name="location-outline"
                                                  size={12}
                                                  color="#94a3b8"
                                                  style={{ marginTop: 2 }}
                                                />
                                                <Text
                                                  style={
                                                    styles.heroLectureDetails
                                                  }
                                                >
                                                  {locationLabel}
                                                </Text>
                                              </View>
                                            )}

                                            {/* Riga 2: Orario / Stato con icona dedicata */}
                                            {isTargetLectureFinished ? (
                                              <View
                                                style={
                                                  styles.heroLectureMetaItem
                                                }
                                              >
                                                <Ionicons
                                                  name="checkmark-circle-outline"
                                                  size={12}
                                                  color={theme.accent}
                                                  style={{ marginTop: 2 }}
                                                />
                                                <Text
                                                  style={[
                                                    styles.heroLectureDetails,
                                                    { color: theme.accent },
                                                  ]}
                                                >
                                                  Terminata · Treni da adesso
                                                </Text>
                                              </View>
                                            ) : direction === "outbound" ? (
                                              <View
                                                style={
                                                  styles.heroLectureMetaItem
                                                }
                                              >
                                                <Ionicons
                                                  name="time-outline"
                                                  size={12}
                                                  color={
                                                    isOutboundInProgress
                                                      ? "#f59e0b"
                                                      : "#94a3b8"
                                                  }
                                                  style={{ marginTop: 2 }}
                                                />
                                                <Text
                                                  style={[
                                                    styles.heroLectureDetails,
                                                    isOutboundInProgress && {
                                                      color: "#fbbf24",
                                                    },
                                                  ]}
                                                >
                                                  {isOutboundInProgress
                                                    ? outboundRemainingText
                                                      ? `In corso (${outboundRemainingText})`
                                                      : "In corso"
                                                    : targetStartTime
                                                      ? `Inizio ore ${targetStartTime}`
                                                      : "Orario non disponibile"}
                                                </Text>
                                              </View>
                                            ) : isInProgressNow ? (
                                              <View
                                                style={
                                                  styles.heroLectureMetaItem
                                                }
                                              >
                                                <Ionicons
                                                  name="time-outline"
                                                  size={12}
                                                  color="#f59e0b"
                                                  style={{ marginTop: 2 }}
                                                />
                                                <Text
                                                  style={[
                                                    styles.heroLectureDetails,
                                                    { color: "#fbbf24" },
                                                  ]}
                                                >
                                                  {nowRemainingText
                                                    ? `In corso (${nowRemainingText})${targetEndTime ? ` · Fine ore ${targetEndTime}` : ""}`
                                                    : targetEndTime
                                                      ? `In corso · Fine ore ${targetEndTime}`
                                                      : "In corso"}
                                                </Text>
                                              </View>
                                            ) : (
                                              <View
                                                style={
                                                  styles.heroLectureMetaItem
                                                }
                                              >
                                                <Ionicons
                                                  name="time-outline"
                                                  size={12}
                                                  color={
                                                    isReturnEarlyDeparture
                                                      ? "#f59e0b"
                                                      : "#94a3b8"
                                                  }
                                                  style={{ marginTop: 2 }}
                                                />
                                                <Text
                                                  style={[
                                                    styles.heroLectureDetails,
                                                    isReturnEarlyDeparture && {
                                                      color: "#fbbf24",
                                                    },
                                                  ]}
                                                >
                                                  {isReturnEarlyDeparture
                                                    ? `Fine ore ${targetEndTime} · ${itinerary.lectureTimeStatus?.badgeText}`
                                                    : targetEndTime
                                                      ? `Fine ore ${targetEndTime}`
                                                      : "Orario non disponibile"}
                                                </Text>
                                              </View>
                                            )}
                                          </>
                                        )}
                                      </View>
                                    </View>
                                  </View>
                                );
                              })()}

                              {renderHeroDisruptionAlerts(10)}
                            </View>

                            {/* Dettaglio Treno Regionale e Switcher Alternative (Tocca per aprire Trenitalia) */}
                            {itinerary.liveTrain && (
                              <View
                                style={[
                                  styles.trainHighlightCard,
                                  {
                                    backgroundColor: "#1c1c1e",
                                    borderColor: theme.border,
                                    borderWidth: 1,
                                  },
                                ]}
                              >
                                {(() => {
                                  const depM = parseTimeToMinutes(
                                    isSelectedDayToday
                                      ? itinerary.liveTrain
                                          .departureTimePlanned ||
                                          itinerary.liveTrain
                                            .departureTimeActual ||
                                          "00:00"
                                      : itinerary.liveTrain
                                          .departureTimePlanned || "00:00",
                                  );
                                  const arrM = parseTimeToMinutes(
                                    isSelectedDayToday
                                      ? itinerary.liveTrain.arrivalTimeActual ||
                                          itinerary.liveTrain
                                            .arrivalTimePlanned ||
                                          "00:00"
                                      : itinerary.liveTrain
                                          .arrivalTimePlanned || "00:00",
                                  );
                                  const tDuration =
                                    itinerary.liveTrain.durationMinutes ||
                                    (arrM > depM ? arrM - depM : 0);

                                  const statusLabel =
                                    trainStatus?.badgeLabel || "";
                                  const hasSeparateDelay = Boolean(
                                    isSelectedDayToday &&
                                    trainStatus?.delayBadge,
                                  );
                                  const hasDwell = Boolean(
                                    isSelectedDayToday &&
                                    trainStatus?.dwellBadge,
                                  );

                                  // Se è presente un ritardo, lo posizioniamo sempre sulla riga 1 tra il numero del treno e la durata
                                  const placeDelayOnTop = hasSeparateDelay;

                                  // Se non c'è ritardo separato, collochiamo il badge primario sulla riga 1 solo se sintetico
                                  const placePrimaryOnTop =
                                    !hasSeparateDelay &&
                                    Boolean(
                                      trainStatus &&
                                      !hasDwell &&
                                      statusLabel.length <= 13 &&
                                      !statusLabel
                                        .toLowerCase()
                                        .includes("(") &&
                                      !statusLabel
                                        .toLowerCase()
                                        .includes("interruz"),
                                    );

                                  const showSecondRow = Boolean(
                                    (placeDelayOnTop &&
                                      trainStatus?.badgeLabel) ||
                                    (!placePrimaryOnTop &&
                                      trainStatus?.badgeLabel) ||
                                    hasDwell,
                                  );

                                  const renderDelayBadge = () =>
                                    isSelectedDayToday &&
                                    trainStatus?.delayBadge ? (
                                      <View
                                        style={[
                                          styles.trainStatusPill,
                                          {
                                            backgroundColor:
                                              trainStatus.delayBadge.bg,
                                            borderColor:
                                              trainStatus.delayBadge.border,
                                          },
                                        ]}
                                      >
                                        <Ionicons
                                          name={
                                            (trainStatus.delayBadge
                                              .iconName as any) ||
                                            "warning-outline"
                                          }
                                          size={12}
                                          color={trainStatus.delayBadge.color}
                                          style={{ marginRight: 4 }}
                                        />
                                        <Text
                                          style={[
                                            styles.trainStatusPillText,
                                            {
                                              color:
                                                trainStatus.delayBadge.color,
                                            },
                                          ]}
                                        >
                                          {trainStatus.delayBadge.label}
                                        </Text>
                                      </View>
                                    ) : null;

                                  const renderPrimaryBadge = () =>
                                    trainStatus && trainStatus.badgeLabel ? (
                                      <View
                                        style={[
                                          styles.trainStatusPill,
                                          {
                                            backgroundColor:
                                              trainStatus.badgeBg,
                                            borderColor:
                                              trainStatus.badgeBorder,
                                          },
                                        ]}
                                      >
                                        <Ionicons
                                          name={trainStatus.iconName as any}
                                          size={12}
                                          color={trainStatus.badgeColor}
                                          style={{ marginRight: 4 }}
                                        />
                                        <Text
                                          style={[
                                            styles.trainStatusPillText,
                                            { color: trainStatus.badgeColor },
                                          ]}
                                        >
                                          {trainStatus.badgeLabel}
                                        </Text>
                                      </View>
                                    ) : null;

                                  const renderDwellBadge = () =>
                                    isSelectedDayToday &&
                                    trainStatus?.dwellBadge ? (
                                      <View
                                        style={[
                                          styles.trainStatusPill,
                                          {
                                            backgroundColor:
                                              trainStatus.dwellBadge.bg,
                                            borderColor:
                                              trainStatus.dwellBadge.border,
                                          },
                                        ]}
                                      >
                                        <Ionicons
                                          name="hourglass-outline"
                                          size={11}
                                          color={trainStatus.dwellBadge.color}
                                          style={{ marginRight: 4 }}
                                        />
                                        <Text
                                          style={[
                                            styles.trainStatusPillText,
                                            {
                                              color:
                                                trainStatus.dwellBadge.color,
                                            },
                                          ]}
                                        >
                                          {trainStatus.dwellBadge.label}
                                        </Text>
                                      </View>
                                    ) : null;

                                  return (
                                    <View style={styles.trainHighlightHeader}>
                                      {/* Riga superiore: Numero treno + eventuale badge ritardo/sintetico a sinistra, Durata viaggio fissa a destra */}
                                      <View style={styles.trainHighlightTopRow}>
                                        <View
                                          style={styles.trainHighlightTopLeft}
                                        >
                                          <View
                                            style={[
                                              styles.trainNumberBadge,
                                              {
                                                backgroundColor: theme.primary,
                                              },
                                            ]}
                                          >
                                            <Ionicons
                                              name="train"
                                              size={14}
                                              color="#fff"
                                              style={{ marginRight: 5 }}
                                            />
                                            <Text
                                              style={styles.trainNumberText}
                                            >
                                              {itinerary.liveTrain.trainNumber}
                                            </Text>
                                          </View>

                                          {placeDelayOnTop &&
                                            renderDelayBadge()}
                                          {placePrimaryOnTop &&
                                            renderPrimaryBadge()}
                                        </View>

                                        {/* Durata del Viaggio ancorata fissa in alto a destra */}
                                        {tDuration > 0 && (
                                          <View style={styles.durationBadge}>
                                            <Ionicons
                                              name="time-outline"
                                              size={13}
                                              color="#94a3b8"
                                              style={{ marginRight: 4 }}
                                            />
                                            <Text
                                              style={styles.durationBadgeText}
                                            >
                                              {formatDuration(tDuration)}
                                            </Text>
                                          </View>
                                        )}
                                      </View>

                                      {/* Riga inferiore compatta: eventuale stato primario / banchina se presente ritardo sopra o non entra */}
                                      {showSecondRow && (
                                        <View
                                          style={styles.trainHighlightPillsRow}
                                        >
                                          {!placePrimaryOnTop &&
                                            renderPrimaryBadge()}
                                          {renderDwellBadge()}
                                        </View>
                                      )}
                                    </View>
                                  );
                                })()}

                                {/* Eventuale Sciopero Treni programmato per il giorno e orario selezionato */}
                                {currentTrainDisruptions.length > 0 && (
                                  <TouchableOpacity
                                    activeOpacity={0.85}
                                    onPress={() => {
                                      handleOpenDisruptionsModal(
                                        "train",
                                        currentTrainDisruptions.map(
                                          (d) => d.id,
                                        ),
                                      );
                                    }}
                                    style={styles.trainStrikeBanner}
                                  >
                                    <View style={styles.trainStrikeBadge}>
                                      <Ionicons
                                        name="warning"
                                        size={11}
                                        color="#ef4444"
                                        style={{ marginRight: 4 }}
                                      />
                                      <Text style={styles.trainStrikeBadgeText}>
                                        SCIOPERO TRENI
                                      </Text>
                                    </View>
                                    <Text
                                      style={styles.trainStrikeBannerText}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {formatTrainStrikeBannerSummary(
                                        currentTrainDisruptions[0],
                                        selectedDateIso,
                                      )}
                                    </Text>
                                    <Ionicons
                                      name="chevron-forward"
                                      size={13}
                                      color="#fca5a5"
                                      style={{ marginLeft: 6 }}
                                    />
                                  </TouchableOpacity>
                                )}

                                {/* Eventuale Avviso / Variazione / Interruzione Trenitalia (solo se oggi) */}
                                {isSelectedDayToday &&
                                trainStatus?.alertMessage ? (
                                  <View style={styles.trainAlertBanner}>
                                    <Ionicons
                                      name="warning-outline"
                                      size={14}
                                      color="#f59e0b"
                                      style={{ marginRight: 6 }}
                                    />
                                    <Text style={styles.trainAlertBannerText}>
                                      {trainStatus.alertMessage}
                                    </Text>
                                  </View>
                                ) : null}

                                {/* Eventuale Segnalazione Capienza / Biglietti non acquistabili (solo se oggi) */}
                                {isSelectedDayToday &&
                                trainStatus?.capacityWarning ? (
                                  <View
                                    style={[
                                      styles.trainCapacityBanner,
                                      {
                                        backgroundColor: theme.cardTint,
                                        borderColor: theme.border,
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name="people-outline"
                                      size={14}
                                      color={theme.accent}
                                      style={{ marginRight: 6 }}
                                    />
                                    <Text
                                      style={[
                                        styles.trainCapacityBannerText,
                                        { color: theme.light },
                                      ]}
                                    >
                                      {trainStatus.capacityWarning}
                                    </Text>
                                  </View>
                                ) : null}

                                {/* Info Partenza / Binario / Arrivo */}
                                <View
                                  style={[
                                    styles.trainInfoRow,
                                    pendingTrainNumber
                                      ? { opacity: 0.35 }
                                      : null,
                                  ]}
                                >
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.trainStationLabel}>
                                      Partenza
                                    </Text>
                                    <Text style={styles.trainStationName}>
                                      {direction === "outbound"
                                        ? config?.departureStation.shortName ||
                                          config?.departureStation.name
                                        : config
                                          ? getRomeStationName(
                                              config,
                                              itinerary.liveTrain,
                                              "return",
                                            )
                                          : ""}
                                    </Text>
                                    {(() => {
                                      const depPlanTime =
                                        itinerary.liveTrain
                                          .departureTimePlanned || "00:00";
                                      if (!isSelectedDayToday) {
                                        return (
                                          <Text style={styles.trainTimeText}>
                                            {depPlanTime}
                                          </Text>
                                        );
                                      }

                                      const depPlanM =
                                        parseTimeToMinutes(depPlanTime);
                                      const currentNowM =
                                        new Date().getHours() * 60 +
                                        new Date().getMinutes();
                                      const isDepartedFromStation = Boolean(
                                        itinerary.liveTrain
                                          .isDepartedFromStation,
                                      );

                                      let depActM: number;
                                      let isDepDelayed = false;

                                      const stationDepDelay = Math.max(
                                        0,
                                        itinerary.liveTrain
                                          .departureDelayAtStation !== undefined
                                          ? itinerary.liveTrain
                                              .departureDelayAtStation
                                          : itinerary.liveTrain
                                                .isDepartedFromStation &&
                                              itinerary.liveTrain
                                                .isOriginStation &&
                                              itinerary.liveTrain
                                                .delayMinutes !== undefined
                                            ? itinerary.liveTrain.delayMinutes
                                            : 0,
                                      );

                                      if (isDepartedFromStation) {
                                        // Il treno è già passato/partito dalla stazione di partenza del pendolare:
                                        // l'orario di partenza è un evento storico già avvenuto e definitivo.
                                        const actualDepTimeStr =
                                          itinerary.liveTrain
                                            .departureTimeActual;
                                        const actualDepM = actualDepTimeStr
                                          ? parseTimeToMinutes(actualDepTimeStr)
                                          : stationDepDelay > 0
                                            ? depPlanM + stationDepDelay
                                            : depPlanM;

                                        depActM = actualDepM;
                                        isDepDelayed =
                                          stationDepDelay > 0 ||
                                          actualDepM > depPlanM;
                                      } else {
                                        // Il treno NON è ancora partito dalla stazione di partenza del pendolare
                                        const myDepStationName =
                                          direction === "outbound"
                                            ? config?.departureStation
                                                .shortName ||
                                              config?.departureStation.name ||
                                              ""
                                            : config
                                              ? getRomeStationName(
                                                  config,
                                                  itinerary.liveTrain,
                                                  "return",
                                                )
                                              : "";
                                        const isStoppedAtMyStation = Boolean(
                                          itinerary.liveTrain
                                            .isStoppedInStation &&
                                          (!itinerary.liveTrain
                                            .stoppedStationName ||
                                            itinerary.liveTrain.stoppedStationName
                                              .toLowerCase()
                                              .includes(
                                                myDepStationName.toLowerCase(),
                                              ) ||
                                            myDepStationName
                                              .toLowerCase()
                                              .includes(
                                                itinerary.liveTrain.stoppedStationName.toLowerCase(),
                                              )),
                                        );
                                        const isNotDepartedPastTime = Boolean(
                                          (itinerary.liveTrain.isDeparted ===
                                            false ||
                                            isStoppedAtMyStation) &&
                                          currentNowM >= depPlanM,
                                        );

                                        // Se è fermo in stazione (es. arrivato in orario o in anticipo come 09:31 a fronte di 09:38):
                                        // l'orario di partenza previsto si basa sulla fermata o sul ritardo specifico di partenza
                                        const stationDepDelay =
                                          isStoppedAtMyStation
                                            ? itinerary.liveTrain
                                                .departureDelayAtStation || 0
                                            : itinerary.liveTrain
                                                  .departureDelayAtStation !==
                                                undefined
                                              ? itinerary.liveTrain
                                                  .departureDelayAtStation
                                              : itinerary.liveTrain
                                                  .delayMinutes || 0;

                                        const lateM = isNotDepartedPastTime
                                          ? Math.max(
                                              stationDepDelay,
                                              currentNowM - depPlanM,
                                            )
                                          : stationDepDelay;

                                        const rawDepActM = parseTimeToMinutes(
                                          itinerary.liveTrain
                                            .departureTimeActual || depPlanTime,
                                        );
                                        depActM = Math.max(
                                          rawDepActM,
                                          depPlanM + Math.max(0, lateM),
                                        );
                                        isDepDelayed =
                                          depActM > depPlanM ||
                                          isNotDepartedPastTime;
                                      }

                                      // La partenza dalla stazione dell'utente non anticipa mai rispetto al programmato
                                      const displayDepTime = isDepDelayed
                                        ? minutesToTime(depActM)
                                        : depPlanTime;

                                      const isTrainArrivedForDep = Boolean(
                                        itinerary.liveTrain
                                          .isArrivedAtDestination ||
                                        itinerary.liveTrain.trainStatusType ===
                                          "arrived" ||
                                        itinerary.liveTrain.statusDescription
                                          ?.toLowerCase()
                                          .includes("arrivato") ||
                                        trainStatus?.badgeLabel === "Arrivato",
                                      );

                                      const depDiffM =
                                        depPlanM > 0
                                          ? Math.max(
                                              0,
                                              parseTimeToMinutes(
                                                displayDepTime,
                                              ) - depPlanM,
                                            )
                                          : 0;

                                      const showStrike =
                                        isDepDelayed &&
                                        depPlanTime &&
                                        displayDepTime &&
                                        depPlanTime !== displayDepTime;

                                      return (
                                        <>
                                          <Text
                                            style={[
                                              styles.trainTimeText,
                                              isDepDelayed && {
                                                color: "#fb923c",
                                              },
                                            ]}
                                          >
                                            {displayDepTime}
                                          </Text>
                                          {showStrike && (
                                            <View
                                              style={{
                                                flexDirection: "row",
                                                alignItems: "center",
                                                marginTop: 1,
                                              }}
                                            >
                                              <Text
                                                style={{
                                                  fontSize: 10,
                                                  color: "#94a3b8",
                                                  textDecorationLine:
                                                    "line-through",
                                                }}
                                              >
                                                prog.{" "}
                                                {
                                                  itinerary.liveTrain
                                                    .departureTimePlanned
                                                }
                                              </Text>
                                              {isTrainArrivedForDep &&
                                                depDiffM > 0 && (
                                                  <Text
                                                    style={{
                                                      fontSize: 10,
                                                      fontWeight: "600",
                                                      color:
                                                        depDiffM > 5
                                                          ? "#ef4444"
                                                          : "#f59e0b",
                                                      marginLeft: 4,
                                                    }}
                                                  >
                                                    +{depDiffM}m
                                                  </Text>
                                                )}
                                            </View>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </View>

                                  {/* Binario Risaltato */}
                                  <View
                                    style={[
                                      styles.platformHighlightBox,
                                      {
                                        borderColor: theme.border,
                                        backgroundColor: theme.subtle,
                                      },
                                    ]}
                                  >
                                    <Text style={styles.platformHighlightLabel}>
                                      BINARIO
                                    </Text>
                                    <Text style={styles.platformHighlightValue}>
                                      {isSelectedDayToday
                                        ? cleanPlatform(
                                            itinerary.liveTrain.platformActual,
                                          ) ||
                                          cleanPlatform(
                                            itinerary.liveTrain.platformPlanned,
                                          ) ||
                                          "-"
                                        : cleanPlatform(
                                            itinerary.liveTrain.platformPlanned,
                                          ) || "-"}
                                    </Text>
                                  </View>

                                  <View
                                    style={{ flex: 1, alignItems: "flex-end" }}
                                  >
                                    <Text style={styles.trainStationLabel}>
                                      Arrivo
                                    </Text>
                                    <Text style={styles.trainStationName}>
                                      {direction === "outbound"
                                        ? config
                                          ? getRomeStationName(
                                              config,
                                              itinerary.liveTrain,
                                              "outbound",
                                            )
                                          : ""
                                        : config?.departureStation.shortName ||
                                          config?.departureStation.name}
                                    </Text>
                                    {(() => {
                                      const arrPlanTime =
                                        itinerary.liveTrain
                                          .arrivalTimePlanned || "00:00";
                                      if (!isSelectedDayToday) {
                                        return (
                                          <Text style={styles.trainTimeText}>
                                            {arrPlanTime}
                                          </Text>
                                        );
                                      }

                                      const depPlanM = parseTimeToMinutes(
                                        itinerary.liveTrain
                                          .departureTimePlanned || "00:00",
                                      );
                                      const arrPlanM =
                                        parseTimeToMinutes(arrPlanTime);
                                      const currentNowM =
                                        new Date().getHours() * 60 +
                                        new Date().getMinutes();
                                      const myDepStationName =
                                        direction === "outbound"
                                          ? config?.departureStation
                                              .shortName ||
                                            config?.departureStation.name ||
                                            ""
                                          : config
                                            ? getRomeStationName(
                                                config,
                                                itinerary.liveTrain,
                                                "return",
                                              )
                                            : "";
                                      const isStoppedAtMyStation = Boolean(
                                        itinerary.liveTrain
                                          .isStoppedInStation &&
                                        (!itinerary.liveTrain
                                          .stoppedStationName ||
                                          itinerary.liveTrain.stoppedStationName
                                            .toLowerCase()
                                            .includes(
                                              myDepStationName.toLowerCase(),
                                            ) ||
                                          myDepStationName
                                            .toLowerCase()
                                            .includes(
                                              itinerary.liveTrain.stoppedStationName.toLowerCase(),
                                            )),
                                      );
                                      const isNotDepartedPastTime = Boolean(
                                        !itinerary.liveTrain
                                          .isDepartedFromStation &&
                                        (itinerary.liveTrain.isDeparted ===
                                          false ||
                                          isStoppedAtMyStation) &&
                                        currentNowM >= depPlanM,
                                      );
                                      const lateM = isNotDepartedPastTime
                                        ? Math.max(
                                            itinerary.liveTrain.delayMinutes ||
                                              0,
                                            currentNowM - depPlanM,
                                          )
                                        : itinerary.liveTrain.delayMinutes || 0;

                                      const isTrainArrived = Boolean(
                                        itinerary.liveTrain
                                          .isArrivedAtDestination ||
                                        itinerary.liveTrain.trainStatusType ===
                                          "arrived" ||
                                        itinerary.liveTrain.statusDescription
                                          ?.toLowerCase()
                                          .includes("arrivato") ||
                                        trainStatus?.badgeLabel === "Arrivato",
                                      );

                                      // L'anticipo sull'orario di arrivo vale solo se il treno è già arrivato oppure si trova
                                      // nell'ultimo tratto (tra penultima stazione e discesa) con anticipo su quella tratta.
                                      const liveStops = itinerary.liveTrain.stops || [];
                                      const uiArrName =
                                        direction === "outbound"
                                          ? config
                                            ? getRomeStationName(
                                                config,
                                                itinerary.liveTrain,
                                                "outbound",
                                              )
                                            : ""
                                          : config?.departureStation.shortName ||
                                            config?.departureStation.name ||
                                            "";
                                      const uiArrCode =
                                        direction === "outbound"
                                          ? config?.arrivalStation.code
                                          : config?.departureStation.code;
                                      let uiArrIdx = uiArrName
                                        ? liveStops.findIndex((s) =>
                                            isSameStation(
                                              s.stationName,
                                              uiArrName,
                                            ),
                                          )
                                        : -1;
                                      if (uiArrIdx < 0 && uiArrCode) {
                                        uiArrIdx = liveStops.findIndex(
                                          (s) => s.stationCode === uiArrCode,
                                        );
                                      }
                                      const uiPenPassed = Boolean(
                                        uiArrIdx > 0 &&
                                        liveStops[uiArrIdx - 1]?.isPassed,
                                      );
                                      const canArrBeEarly = Boolean(
                                        isTrainArrived ||
                                        (itinerary.liveTrain
                                          .canPredictEarlyArrival !== undefined
                                          ? itinerary.liveTrain
                                              .canPredictEarlyArrival
                                          : uiPenPassed),
                                      );
                                      const rawArrDelayM =
                                        itinerary.liveTrain
                                          .arrivalDelayAtStation !== undefined
                                          ? itinerary.liveTrain
                                              .arrivalDelayAtStation
                                          : itinerary.liveTrain.delayMinutes !==
                                              undefined
                                            ? itinerary.liveTrain.delayMinutes
                                            : 0;
                                      const arrDelayM = canArrBeEarly
                                        ? rawArrDelayM
                                        : Math.max(0, rawArrDelayM);

                                      const rawArrActM = parseTimeToMinutes(
                                        itinerary.liveTrain.arrivalTimeActual ||
                                          arrPlanTime,
                                      );
                                      const clampedRawArrActM = canArrBeEarly
                                        ? rawArrActM
                                        : Math.max(arrPlanM, rawArrActM);
                                      const arrActM = Math.max(
                                        clampedRawArrActM,
                                        arrPlanM + Math.max(0, lateM),
                                        arrDelayM > 0
                                          ? arrPlanM + arrDelayM
                                          : 0,
                                      );

                                      const displayArrTime =
                                        isTrainArrived &&
                                        itinerary.liveTrain.arrivalTimeActual &&
                                        canArrBeEarly
                                          ? itinerary.liveTrain
                                              .arrivalTimeActual
                                          : arrDelayM > 0
                                            ? minutesToTime(
                                                arrPlanM + arrDelayM,
                                              )
                                            : arrActM > arrPlanM
                                              ? minutesToTime(arrActM)
                                              : canArrBeEarly && arrDelayM < 0
                                                ? minutesToTime(
                                                    arrPlanM + arrDelayM,
                                                  )
                                                : arrPlanTime;

                                      const arrDiffM =
                                        arrPlanM > 0
                                          ? parseTimeToMinutes(displayArrTime) -
                                            arrPlanM
                                          : 0;

                                      const isArrDelayed = Boolean(
                                        arrPlanM > 0 &&
                                        (arrDiffM > 0 ||
                                          arrDelayM > 0 ||
                                          lateM > 0),
                                      );
                                      const isArrEarly = Boolean(
                                        canArrBeEarly &&
                                        arrPlanM > 0 &&
                                        (arrDiffM < 0 || arrDelayM < 0),
                                      );
                                      const showArrStrike = Boolean(
                                        (isArrDelayed || isArrEarly) &&
                                        arrPlanTime &&
                                        displayArrTime &&
                                        arrPlanTime !== displayArrTime,
                                      );

                                      return (
                                        <>
                                          <Text
                                            style={[
                                              styles.trainTimeText,
                                              isArrDelayed && {
                                                color: "#fb923c",
                                              },
                                              isArrEarly && {
                                                color: "#10b981",
                                              },
                                            ]}
                                          >
                                            {displayArrTime}
                                          </Text>
                                          {showArrStrike && (
                                            <View
                                              style={{
                                                flexDirection: "row",
                                                alignItems: "center",
                                                justifyContent: "flex-end",
                                                marginTop: 1,
                                              }}
                                            >
                                              <Text
                                                style={{
                                                  fontSize: 10,
                                                  color: "#94a3b8",
                                                  textDecorationLine:
                                                    "line-through",
                                                }}
                                              >
                                                prog.{" "}
                                                {
                                                  itinerary.liveTrain
                                                    .arrivalTimePlanned
                                                }
                                              </Text>
                                              {isTrainArrived &&
                                                arrDiffM !== 0 && (
                                                  <Text
                                                    style={{
                                                      fontSize: 10,
                                                      fontWeight: "600",
                                                      color:
                                                        arrDiffM > 5
                                                          ? "#ef4444"
                                                          : arrDiffM > 0
                                                            ? "#f59e0b"
                                                            : "#10b981",
                                                      marginLeft: 4,
                                                    }}
                                                  >
                                                    {arrDiffM > 0
                                                      ? `+${arrDiffM}m`
                                                      : `${arrDiffM}m`}
                                                  </Text>
                                                )}
                                            </View>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </View>
                                </View>

                                {/* Visualizzatore Animato del Percorso e Posizione Convoglio */}
                                <TrainRouteProgress
                                  liveTrain={itinerary.liveTrain}
                                  commuterDepartureStation={
                                    direction === "outbound"
                                      ? config?.departureStation.shortName ||
                                        config?.departureStation.name ||
                                        ""
                                      : config
                                        ? getRomeStationName(
                                            config,
                                            itinerary.liveTrain,
                                            "return",
                                          )
                                        : ""
                                  }
                                  commuterArrivalStation={
                                    direction === "outbound"
                                      ? config
                                        ? getRomeStationName(
                                            config,
                                            itinerary.liveTrain,
                                            "outbound",
                                          )
                                        : ""
                                      : config?.departureStation.shortName ||
                                        config?.departureStation.name ||
                                        ""
                                  }
                                  commuterDepartureStationCode={
                                    direction === "outbound"
                                      ? config?.departureStation.code
                                      : config?.arrivalStation.code
                                  }
                                  commuterArrivalStationCode={
                                    direction === "outbound"
                                      ? config?.arrivalStation.code
                                      : config?.departureStation.code
                                  }
                                  isToday={isSelectedDayToday}
                                  theme={theme}
                                />

                                {/* Consiglio Treno Smart (Andata o Ritorno, quando conviene nettamente) */}
                                {direction === "return" &&
                                  itinerary.smartReturnRecommendation && (
                                    <View
                                      style={[
                                        styles.smartReturnBanner,
                                        itinerary.smartReturnRecommendation
                                          .isCurrentlySelected
                                          ? styles.smartReturnBannerActive
                                          : styles.smartReturnBannerSuggested,
                                      ]}
                                    >
                                      <View
                                        style={{ flex: 1, paddingRight: 10 }}
                                      >
                                        <View
                                          style={styles.smartReturnTitleRow}
                                        >
                                          <Ionicons
                                            name={
                                              itinerary
                                                .smartReturnRecommendation
                                                .isCurrentlySelected
                                                ? "checkmark-circle"
                                                : "sparkles"
                                            }
                                            size={13}
                                            color={
                                              itinerary
                                                .smartReturnRecommendation
                                                .isCurrentlySelected
                                                ? "#10b981"
                                                : "#f59e0b"
                                            }
                                            style={{ marginRight: 5 }}
                                          />
                                          <Text
                                            style={[
                                              styles.smartReturnTitle,
                                              {
                                                color: itinerary
                                                  .smartReturnRecommendation
                                                  .isCurrentlySelected
                                                  ? "#34d399"
                                                  : "#fbbf24",
                                              },
                                            ]}
                                            numberOfLines={1}
                                          >
                                            {itinerary.smartReturnRecommendation
                                              .isCurrentlySelected
                                              ? `Rientro smart attivo • ${itinerary.smartReturnRecommendation.trainNumber}`
                                              : `Consiglio rientro • ${itinerary.smartReturnRecommendation.trainNumber} (${itinerary.smartReturnRecommendation.departureTime})`}
                                          </Text>
                                        </View>
                                        <Text
                                          style={styles.smartReturnSub}
                                          numberOfLines={3}
                                        >
                                          {(() => {
                                            const sr =
                                              itinerary.smartReturnRecommendation!;
                                            const savedSpan =
                                              sr.savedArrivalMinutes >= 60
                                                ? formatDuration(
                                                    sr.savedArrivalMinutes,
                                                  )
                                                : `${sr.savedArrivalMinutes} min`;
                                            const earlyPart =
                                              sr.lostLectureMinutes > 0
                                                ? `esci ${sr.lostLectureMinutes} min prima`
                                                : "a fine lezione";
                                            const boldTimeStyle = {
                                              fontWeight: "700" as const,
                                              color: "#ffffff",
                                            };
                                            return sr.isCurrentlySelected ? (
                                              <>
                                                {`Arrivi ${savedSpan} prima (`}
                                                <Text style={boldTimeStyle}>
                                                  {sr.smartHomeArrivalTime}
                                                </Text>
                                                {` vs ${sr.standardHomeArrivalTime}) • ${earlyPart}`}
                                              </>
                                            ) : (
                                              <>
                                                {`Arrivi ${savedSpan} prima alle ${sr.smartHomeArrivalTime} (${sr.smartHomeArrivalTime} vs `}
                                                <Text style={boldTimeStyle}>
                                                  {sr.standardHomeArrivalTime}
                                                </Text>
                                                {`) • ${earlyPart}`}
                                              </>
                                            );
                                          })()}
                                        </Text>
                                      </View>
                                      <TouchableOpacity
                                        style={[
                                          styles.smartReturnActionBtn,
                                          itinerary.smartReturnRecommendation
                                            .isCurrentlySelected
                                            ? styles.smartReturnActionBtnMuted
                                            : styles.smartReturnActionBtnPrimary,
                                        ]}
                                        activeOpacity={0.75}
                                        onPress={() => {
                                          const sr =
                                            itinerary.smartReturnRecommendation;
                                          if (!sr) return;
                                          handleSelectTrainChip(
                                            sr.isCurrentlySelected
                                              ? sr.standardTrainNumber
                                              : sr.trainNumber,
                                          );
                                        }}
                                      >
                                        <Text
                                          style={[
                                            styles.smartReturnActionText,
                                            {
                                              color: itinerary
                                                .smartReturnRecommendation
                                                .isCurrentlySelected
                                                ? "#cbd5e1"
                                                : "#1c1917",
                                            },
                                          ]}
                                        >
                                          {itinerary.smartReturnRecommendation
                                            .isCurrentlySelected
                                            ? "Standard"
                                            : "Scegli"}
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  )}

                                {direction === "outbound" &&
                                  itinerary.smartOutboundRecommendation && (
                                    <View
                                      style={[
                                        styles.smartReturnBanner,
                                        itinerary.smartOutboundRecommendation
                                          .isCurrentlySelected
                                          ? styles.smartReturnBannerActive
                                          : styles.smartReturnBannerSuggested,
                                      ]}
                                    >
                                      <View
                                        style={{ flex: 1, paddingRight: 10 }}
                                      >
                                        <View
                                          style={styles.smartReturnTitleRow}
                                        >
                                          <Ionicons
                                            name={
                                              itinerary
                                                .smartOutboundRecommendation
                                                .isCurrentlySelected
                                                ? "checkmark-circle"
                                                : "sparkles"
                                            }
                                            size={13}
                                            color={
                                              itinerary
                                                .smartOutboundRecommendation
                                                .isCurrentlySelected
                                                ? "#10b981"
                                                : "#f59e0b"
                                            }
                                            style={{ marginRight: 5 }}
                                          />
                                          <Text
                                            style={[
                                              styles.smartReturnTitle,
                                              {
                                                color: itinerary
                                                  .smartOutboundRecommendation
                                                  .isCurrentlySelected
                                                  ? "#34d399"
                                                  : "#fbbf24",
                                              },
                                            ]}
                                            numberOfLines={1}
                                          >
                                            {itinerary
                                              .smartOutboundRecommendation
                                              .isCurrentlySelected
                                              ? `Andata smart attiva • ${itinerary.smartOutboundRecommendation.trainNumber}`
                                              : `Consiglio andata • ${itinerary.smartOutboundRecommendation.trainNumber} (${itinerary.smartOutboundRecommendation.departureTime})`}
                                          </Text>
                                        </View>
                                        <Text
                                          style={styles.smartReturnSub}
                                          numberOfLines={3}
                                        >
                                          {(() => {
                                            const so =
                                              itinerary.smartOutboundRecommendation!;
                                            const savedSpan =
                                              so.savedDepartureMinutes >= 60
                                                ? formatDuration(
                                                    so.savedDepartureMinutes,
                                                  )
                                                : `${so.savedDepartureMinutes} min`;
                                            const latePart =
                                              so.lostLectureMinutes > 0
                                                ? `${so.lostLectureMinutes} min di ritardo`
                                                : "in orario";
                                            const boldTimeStyle = {
                                              fontWeight: "700" as const,
                                              color: "#ffffff",
                                            };
                                            return so.isCurrentlySelected ? (
                                              <>
                                                {`Parti ${savedSpan} dopo (`}
                                                <Text style={boldTimeStyle}>
                                                  {so.smartHomeDepartureTime}
                                                </Text>
                                                {` vs ${so.standardHomeDepartureTime}) • ${latePart}`}
                                              </>
                                            ) : (
                                              <>
                                                {`Parti ${savedSpan} dopo alle ${so.smartHomeDepartureTime} (${so.smartHomeDepartureTime} vs `}
                                                <Text style={boldTimeStyle}>
                                                  {so.standardHomeDepartureTime}
                                                </Text>
                                                {`) • ${latePart}`}
                                              </>
                                            );
                                          })()}
                                        </Text>
                                      </View>
                                      <TouchableOpacity
                                        style={[
                                          styles.smartReturnActionBtn,
                                          itinerary.smartOutboundRecommendation
                                            .isCurrentlySelected
                                            ? styles.smartReturnActionBtnMuted
                                            : styles.smartReturnActionBtnPrimary,
                                        ]}
                                        activeOpacity={0.75}
                                        onPress={() => {
                                          const so =
                                            itinerary.smartOutboundRecommendation;
                                          if (!so) return;
                                          handleSelectTrainChip(
                                            so.isCurrentlySelected
                                              ? so.standardTrainNumber
                                              : so.trainNumber,
                                          );
                                        }}
                                      >
                                        <Text
                                          style={[
                                            styles.smartReturnActionText,
                                            {
                                              color: itinerary
                                                .smartOutboundRecommendation
                                                .isCurrentlySelected
                                                ? "#cbd5e1"
                                                : "#1c1917",
                                            },
                                          ]}
                                        >
                                          {itinerary.smartOutboundRecommendation
                                            .isCurrentlySelected
                                            ? "Standard"
                                            : "Scegli"}
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  )}

                                {/* Selettore Alternative Treni (Treno prima / dopo & chips) */}
                                <View style={styles.trainAlternativesDivider} />
                                <View style={styles.trainNavButtonsRow}>
                                  <TouchableOpacity
                                    style={[
                                      styles.trainNavBtn,
                                      itinerary.liveTrain.hasEarlierTrain ===
                                        false && styles.trainNavBtnDisabled,
                                    ]}
                                    activeOpacity={0.78}
                                    hitSlop={{
                                      top: 6,
                                      bottom: 6,
                                      left: 4,
                                      right: 4,
                                    }}
                                    disabled={
                                      itinerary.liveTrain.hasEarlierTrain ===
                                      false
                                    }
                                    onPress={handleTrainPrev}
                                  >
                                    <Ionicons
                                      name="chevron-back"
                                      size={14}
                                      color={theme.accent}
                                      style={{ marginRight: 3 }}
                                    />
                                    <Text
                                      style={styles.trainNavBtnText}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.85}
                                    >
                                      Treno prima
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={[
                                      styles.trainPreferredBtn,
                                      isCurrentTrainPreferred && {
                                        backgroundColor:
                                          "rgba(245, 158, 11, 0.16)",
                                        borderColor:
                                          "rgba(251, 191, 36, 0.45)",
                                        shadowColor: "#fbbf24",
                                        shadowOffset: { width: 0, height: 0 },
                                        shadowOpacity: 0.35,
                                        shadowRadius: 6,
                                      },
                                    ]}
                                    activeOpacity={0.78}
                                    hitSlop={{
                                      top: 6,
                                      bottom: 6,
                                      left: 4,
                                      right: 4,
                                    }}
                                    onPress={handleTogglePreferredTrain}
                                  >
                                    <Ionicons
                                      name={
                                        isCurrentTrainPreferred
                                          ? "star"
                                          : "star-outline"
                                      }
                                      size={13}
                                      color={
                                        isCurrentTrainPreferred
                                          ? "#fbbf24"
                                          : "#94a3b8"
                                      }
                                      style={{ marginRight: 5 }}
                                    />
                                    <Text
                                      style={[
                                        styles.trainNavCenterLabel,
                                        isCurrentTrainPreferred && {
                                          color: "#fde68a",
                                        },
                                      ]}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.85}
                                    >
                                      Preferenza
                                    </Text>
                                  </TouchableOpacity>

                                  <TouchableOpacity
                                    style={[
                                      styles.trainNavBtn,
                                      itinerary.liveTrain.hasLaterTrain ===
                                        false && styles.trainNavBtnDisabled,
                                    ]}
                                    activeOpacity={0.78}
                                    hitSlop={{
                                      top: 6,
                                      bottom: 6,
                                      left: 4,
                                      right: 4,
                                    }}
                                    disabled={
                                      itinerary.liveTrain.hasLaterTrain ===
                                      false
                                    }
                                    onPress={handleTrainNext}
                                  >
                                    <Text
                                      style={styles.trainNavBtnText}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.85}
                                    >
                                      Treno dopo
                                    </Text>
                                    <Ionicons
                                      name="chevron-forward"
                                      size={14}
                                      color={theme.accent}
                                      style={{ marginLeft: 3 }}
                                    />
                                  </TouchableOpacity>
                                </View>

                                {/* Chips Treni Alternativi - Binario Liquid Glass */}
                                {itinerary.availableTrains &&
                                  itinerary.availableTrains.length > 1 && (
                                    <View style={styles.trainChipsTrack}>
                                      <ScrollView
                                        ref={trainChipsScrollRef}
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={
                                          styles.trainChipsScroll
                                        }
                                        onLayout={(e) => {
                                          trainScrollWidthRef.current =
                                            e.nativeEvent.layout.width;
                                          if (itinerary.liveTrain?.trainNumber) {
                                            centerSelectedTrain(
                                              itinerary.liveTrain.trainNumber,
                                            );
                                          }
                                        }}
                                      >
                                        {itinerary.availableTrains.map((at) => {
                                          const isCurrent =
                                            at.trainNumber.replace(/\D/g, "") ===
                                            (pendingTrainNumber ||
                                              itinerary.liveTrain?.trainNumber.replace(
                                                /\D/g,
                                                "",
                                              ));
                                          const isDeparted = Boolean(
                                            isSelectedDayToday &&
                                            at.isDepartedFromStation,
                                          );
                                          const atPlannedDepM =
                                            parseTimeToMinutes(
                                              at.departureTimePlanned || "00:00",
                                            );
                                          const atEstDepM =
                                            at.stoppedStationEstimatedDep
                                              ? parseTimeToMinutes(
                                                  at.stoppedStationEstimatedDep,
                                                )
                                              : at.departureTimeActual &&
                                                  at.departureTimeActual !==
                                                    at.departureTimePlanned
                                                ? parseTimeToMinutes(
                                                    at.departureTimeActual,
                                                  )
                                                : 0;
                                          const currentNowM =
                                            new Date().getHours() * 60 +
                                            new Date().getMinutes();

                                          const pastEstStopDep = Boolean(
                                            at.stoppedStationEstimatedDep &&
                                              atEstDepM > 0 &&
                                              ((currentNowM > atEstDepM &&
                                                currentNowM - atEstDepM <= 240) ||
                                                (currentNowM < atEstDepM &&
                                                  atEstDepM - currentNowM > 1200)),
                                          );

                                          // Nello slider:
                                          // Colora l'elemento di azzurro se il treno è fermo regolarmente (senza ritardo, in orario)
                                          // Cambia il colore in giallo se il treno ha accumulato ritardo (arrivato o fermo con ritardo) o supera l'orario programmato
                                          const hasDelay = Boolean(
                                            (at.delayMinutes &&
                                              at.delayMinutes > 0) ||
                                            (atPlannedDepM > 0 &&
                                              currentNowM > atPlannedDepM) ||
                                            (atEstDepM > 0 &&
                                              atEstDepM > atPlannedDepM) ||
                                            pastEstStopDep,
                                          );

                                          const isStoppedLate = Boolean(
                                            isSelectedDayToday &&
                                            !isDeparted &&
                                            at.isStoppedInStation &&
                                            hasDelay,
                                          );

                                          const isStoppedRegular = Boolean(
                                            isSelectedDayToday &&
                                            !isDeparted &&
                                            at.isStoppedInStation &&
                                            !hasDelay,
                                          );

                                          const smartRec =
                                            direction === "return"
                                              ? itinerary.smartReturnRecommendation
                                              : itinerary.smartOutboundRecommendation;
                                          const smartSavedBadge =
                                            direction === "return" &&
                                            itinerary.smartReturnRecommendation
                                              ? `-${formatDuration(itinerary.smartReturnRecommendation.savedArrivalMinutes)}`
                                              : direction === "outbound" &&
                                                  itinerary.smartOutboundRecommendation
                                                ? `+${formatDuration(itinerary.smartOutboundRecommendation.savedDepartureMinutes)}`
                                                : "";
                                          const isSmartRecommended = Boolean(
                                            smartRec &&
                                            at.trainNumber.replace(/\D/g, "") ===
                                              smartRec.trainNumber.replace(
                                                /\D/g,
                                                "",
                                              ),
                                          );
                                          const isChipPreferred =
                                            dayPreferredTrains.some((pref) =>
                                              doesPreferredTrainMatchLiveTrain(
                                                pref,
                                                at,
                                              ),
                                            );

                                          return (
                                            <TouchableOpacity
                                              key={at.trainNumber}
                                              style={[
                                                styles.trainChip,
                                                isCurrent && [
                                                  styles.trainChipCurrent,
                                                  { shadowColor: theme.primary },
                                                  !isGlassHosted && {
                                                    backgroundColor: theme.bg,
                                                    borderColor: theme.primary,
                                                    borderWidth: 1.5,
                                                  },
                                                ],
                                                isDeparted &&
                                                  !isCurrent && {
                                                    opacity: 0.55,
                                                  },
                                                isChipPreferred &&
                                                  !isCurrent && {
                                                    borderColor:
                                                      "rgba(251, 191, 36, 0.55)",
                                                    backgroundColor:
                                                      "rgba(245, 158, 11, 0.14)",
                                                  },
                                                isSmartRecommended &&
                                                  !isCurrent &&
                                                  !isChipPreferred && {
                                                    borderColor:
                                                      "rgba(245, 158, 11, 0.55)",
                                                    backgroundColor:
                                                      "rgba(245, 158, 11, 0.12)",
                                                  },
                                                isStoppedRegular &&
                                                  !isCurrent &&
                                                  !isChipPreferred && {
                                                    borderColor:
                                                      "rgba(56, 189, 248, 0.45)",
                                                    backgroundColor:
                                                      "rgba(56, 189, 248, 0.1)",
                                                  },
                                                isStoppedLate &&
                                                  !isCurrent &&
                                                  !isChipPreferred && {
                                                    borderColor:
                                                      "rgba(245, 158, 11, 0.45)",
                                                    backgroundColor:
                                                      "rgba(245, 158, 11, 0.1)",
                                                  },
                                              ]}
                                              activeOpacity={0.78}
                                              onLayout={(e) => {
                                                chipLayoutsRef.current[
                                                  at.trainNumber
                                                ] = {
                                                  x: e.nativeEvent.layout.x,
                                                  width:
                                                    e.nativeEvent.layout.width,
                                                };
                                                if (isCurrent) {
                                                  centerSelectedTrain(
                                                    at.trainNumber,
                                                  );
                                                }
                                              }}
                                              onPress={() =>
                                                handleSelectTrainChip(
                                                  at.trainNumber,
                                                )
                                              }
                                            >
                                              {isCurrent &&
                                                renderGlassPillBackdrop(
                                                  CARD_RADIUS.cardInner,
                                                  theme.primary,
                                                  theme.bg,
                                                  theme.primary,
                                                  1.5,
                                                  "regular",
                                                )}
                                              <Ionicons
                                                name={
                                                  isSmartRecommended
                                                    ? "sparkles"
                                                    : isStoppedLate ||
                                                        isStoppedRegular
                                                      ? "pause-circle-outline"
                                                      : at.category === "IC" ||
                                                          at.trainNumber.startsWith(
                                                            "IC",
                                                          )
                                                        ? "speedometer-outline"
                                                        : at.isFast
                                                          ? "flash"
                                                          : "train-outline"
                                                }
                                                size={12}
                                                color={
                                                  isSmartRecommended
                                                    ? "#fbbf24"
                                                    : isCurrent
                                                      ? "#ffffff"
                                                      : isStoppedLate
                                                        ? "#f59e0b"
                                                        : isStoppedRegular
                                                          ? "#38bdf8"
                                                          : isDeparted
                                                            ? "#64748b"
                                                            : "#94a3b8"
                                                }
                                                style={{ marginRight: 5 }}
                                              />
                                              <Text
                                                style={[
                                                  styles.trainChipText,
                                                  isCurrent &&
                                                    styles.trainChipTextCurrent,
                                                  isDeparted &&
                                                    !isCurrent && {
                                                      color: "#64748b",
                                                    },
                                                  (isSmartRecommended ||
                                                    isChipPreferred) &&
                                                    !isCurrent && {
                                                      color: "#fde68a",
                                                    },
                                                  isStoppedRegular &&
                                                    !isCurrent &&
                                                    !isChipPreferred && {
                                                      color: "#38bdf8",
                                                    },
                                                  isStoppedLate &&
                                                    !isCurrent &&
                                                    !isChipPreferred && {
                                                      color: "#f59e0b",
                                                    },
                                                ]}
                                                numberOfLines={1}
                                              >
                                                {at.trainNumber} •{" "}
                                                {at.departureTimePlanned}
                                              </Text>
                                              {isChipPreferred && (
                                                <Ionicons
                                                  name="star"
                                                  size={10.5}
                                                  color="#fbbf24"
                                                  style={{ marginLeft: 4 }}
                                                />
                                              )}
                                              {isSmartRecommended &&
                                                smartRec && (
                                                  <View
                                                    style={[
                                                      styles.smartChipPill,
                                                      isCurrent &&
                                                        styles.smartChipPillCurrent,
                                                    ]}
                                                  >
                                                    <Text
                                                      style={
                                                        styles.smartChipPillText
                                                      }
                                                    >
                                                      {smartSavedBadge}
                                                    </Text>
                                                  </View>
                                                )}
                                            </TouchableOpacity>
                                          );
                                        })}
                                      </ScrollView>
                                    </View>
                                  )}
                              </View>
                            )}

                            {/* Timeline delle tappe del viaggio */}
                            <Text style={styles.timelineSectionTitle}>
                              TAPPE DEL VIAGGIO
                            </Text>

                            <View style={styles.timelineContainer}>
                              {itinerary.legs.map((leg, index) => {
                                const isLast =
                                  index === itinerary.legs.length - 1;

                                let iconName: keyof typeof Ionicons.glyphMap =
                                  "navigate";
                                let iconColor = "#60a5fa";
                                let circleBg = "rgba(96, 165, 250, 0.15)";

                                if (leg.type === "car") {
                                  iconName = "car";
                                  iconColor = "#fb923c";
                                  circleBg = "rgba(251, 146, 60, 0.15)";
                                } else if (leg.type === "train") {
                                  iconName = "train";
                                  iconColor = "#fb7185";
                                  circleBg = "rgba(251, 113, 133, 0.15)";
                                } else if (leg.type === "transit") {
                                  iconName = "bus";
                                  iconColor = "#a855f7";
                                  circleBg = "rgba(168, 85, 247, 0.15)";
                                } else if (leg.type === "walk") {
                                  iconName = "walk";
                                  iconColor = "#38bdf8";
                                  circleBg = "rgba(56, 189, 248, 0.15)";
                                } else if (leg.id === "leave-lecture-leg") {
                                  iconName = "school";
                                  iconColor = "#60a5fa";
                                  circleBg = "rgba(96, 165, 250, 0.15)";
                                } else if (leg.type === "destination") {
                                  iconName =
                                    direction === "outbound" ? "flag" : "home";
                                  iconColor = "#34d399";
                                  circleBg = "rgba(52, 211, 153, 0.15)";
                                } else if (leg.type === "wait") {
                                  iconName = "pause";
                                  iconColor = "#94a3b8";
                                  circleBg = "rgba(148, 163, 184, 0.15)";
                                }

                                const isInteractive =
                                  Boolean(leg.details?.mapQuery) &&
                                  leg.type !== "train" &&
                                  leg.type !== "destination";

                                const walkBeforeMins = Math.max(
                                  0,
                                  leg.details?.walkBeforeMinutes ?? 0,
                                );
                                const walkAfterMins = Math.max(
                                  0,
                                  leg.details?.walkAfterMinutes ?? 0,
                                );
                                const inVehicleMins = Math.max(
                                  1,
                                  leg.details?.inVehicleMinutes ??
                                    Math.max(
                                      1,
                                      leg.durationMinutes -
                                        walkBeforeMins -
                                        walkAfterMins,
                                    ),
                                );
                                const isTransitStep =
                                  leg.type === "transit" &&
                                  config?.transitLeg?.preferredMode !== "walk";
                                const hasSegmentedTransitRail = isTransitStep;
                                const busDepTimeStr =
                                  leg.details?.busDepartureTime ||
                                  (walkBeforeMins > 0 &&
                                  parseTimeToMinutes(leg.startTime) >= 0
                                    ? minutesToTime(
                                        parseTimeToMinutes(leg.startTime) +
                                          walkBeforeMins,
                                      )
                                    : leg.startTime);
                                const busAlightTimeStr =
                                  leg.details?.busAlightingTime ||
                                  (walkAfterMins > 0 &&
                                  parseTimeToMinutes(leg.endTime) >= 0
                                    ? minutesToTime(
                                        Math.max(
                                          0,
                                          parseTimeToMinutes(leg.endTime) -
                                            walkAfterMins,
                                        ),
                                      )
                                    : leg.endTime);
                                const walkBeforeStartStr =
                                  parseTimeToMinutes(busDepTimeStr) >= 0 &&
                                  walkBeforeMins > 0
                                    ? minutesToTime(
                                        Math.max(
                                          0,
                                          parseTimeToMinutes(busDepTimeStr) -
                                            walkBeforeMins,
                                        ),
                                      )
                                    : leg.startTime;
                                const walkBeforeEndStr = busDepTimeStr;
                                const walkAfterStartStr = busAlightTimeStr;
                                const walkAfterEndStr =
                                  parseTimeToMinutes(busAlightTimeStr) >= 0 &&
                                  walkAfterMins > 0
                                    ? minutesToTime(
                                        parseTimeToMinutes(busAlightTimeStr) +
                                          walkAfterMins,
                                      )
                                    : leg.endTime;
                                const isVariableFollowUpStep =
                                  leg.id === "station-wait-leg" ||
                                  (leg.id === "lecture-leg" &&
                                    itinerary.lectureTimeStatus?.type ===
                                      "late_arrival");

                                const renderWalkVerticalDashes = (
                                  count = 4,
                                ) => (
                                  <View
                                    style={{
                                      alignItems: "center",
                                      justifyContent: "center",
                                      paddingVertical: 4,
                                      gap: 3.5,
                                    }}
                                  >
                                    {Array.from({ length: count }).map(
                                      (_, dIdx) => (
                                        <View
                                          key={`walk-dash-${dIdx}`}
                                          style={{
                                            width: 2,
                                            height: 4.5,
                                            borderRadius: 1,
                                            backgroundColor: "#38bdf8",
                                          }}
                                        />
                                      ),
                                    )}
                                  </View>
                                );

                                return (
                                  <View
                                    key={leg.id}
                                    style={styles.timelineStepRow}
                                  >
                                    {hasSegmentedTransitRail ? (
                                      <View
                                        style={{
                                          width: 82,
                                          alignSelf: "stretch",
                                          flexDirection: "column",
                                        }}
                                      >
                                        {/* 1. Nodo a piedi iniziale (orario inizio -> fine camminata + durata) */}
                                        {walkBeforeMins > 0 && (
                                          <View
                                            style={{
                                              flexDirection: "row",
                                              alignItems: "flex-start",
                                            }}
                                          >
                                            <View
                                              style={[
                                                styles.timeColumn,
                                                { paddingTop: 2 },
                                              ]}
                                            >
                                              <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[
                                                  styles.timeStartText,
                                                  {
                                                    color: "#38bdf8",
                                                    fontSize: 11,
                                                    letterSpacing: -0.3,
                                                    fontVariant: [
                                                      "tabular-nums",
                                                    ],
                                                  },
                                                ]}
                                              >
                                                ~{walkBeforeStartStr}
                                              </Text>
                                              <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[
                                                  styles.timeEndText,
                                                  {
                                                    color: "#7dd3fc",
                                                    fontSize: 10.5,
                                                    fontWeight: "600",
                                                    letterSpacing: -0.3,
                                                    fontVariant: [
                                                      "tabular-nums",
                                                    ],
                                                  },
                                                ]}
                                              >
                                                ~{walkBeforeEndStr}
                                              </Text>
                                              <Text
                                                numberOfLines={1}
                                                style={{
                                                  fontSize: 10,
                                                  fontWeight: "700",
                                                  color: "#38bdf8",
                                                  marginTop: 1,
                                                }}
                                              >
                                                {walkBeforeMins}m
                                              </Text>
                                            </View>
                                            <View style={styles.lineIconColumn}>
                                              <View
                                                style={[
                                                  styles.stepIconCircle,
                                                  {
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 12,
                                                    backgroundColor:
                                                      "rgba(56, 189, 248, 0.16)",
                                                    borderWidth: 1,
                                                    borderColor:
                                                      "rgba(56, 189, 248, 0.45)",
                                                  },
                                                ]}
                                              >
                                                <Ionicons
                                                  name="walk"
                                                  size={13}
                                                  color="#38bdf8"
                                                />
                                              </View>
                                              {renderWalkVerticalDashes(4)}
                                            </View>
                                          </View>
                                        )}

                                        {/* 2. Nodo mezzo pubblico */}
                                        <View
                                          style={{
                                            flex: 1,
                                            flexDirection: "row",
                                            alignItems: "stretch",
                                          }}
                                        >
                                          <View style={styles.timeColumn} />
                                          <View style={styles.lineIconColumn}>
                                            <View
                                              style={[
                                                styles.stepIconCircle,
                                                {
                                                  backgroundColor: circleBg,
                                                  borderWidth: 1,
                                                  borderColor:
                                                    "rgba(168, 85, 247, 0.48)",
                                                },
                                              ]}
                                            >
                                              <Ionicons
                                                name={iconName}
                                                size={14}
                                                color={iconColor}
                                              />
                                            </View>
                                            {(walkAfterMins > 0 || !isLast) && (
                                              <View
                                                style={[
                                                  styles.connectingLine,
                                                  {
                                                    width: 2.5,
                                                    backgroundColor:
                                                      "rgba(168, 85, 247, 0.55)",
                                                  },
                                                ]}
                                              />
                                            )}
                                          </View>
                                        </View>

                                        {/* 3. Nodo a piedi finale dopo la discesa dal mezzo (orario inizio -> fine camminata + durata) */}
                                        {walkAfterMins > 0 && (
                                          <View
                                            style={{
                                              flexDirection: "row",
                                              alignItems: "flex-start",
                                              paddingBottom: isLast ? 4 : 0,
                                            }}
                                          >
                                            <View
                                              style={[
                                                styles.timeColumn,
                                                { paddingTop: 2 },
                                              ]}
                                            >
                                              <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[
                                                  styles.timeStartText,
                                                  {
                                                    color: "#38bdf8",
                                                    fontSize: 11,
                                                    letterSpacing: -0.3,
                                                    fontVariant: [
                                                      "tabular-nums",
                                                    ],
                                                  },
                                                ]}
                                              >
                                                ~{walkAfterStartStr}
                                              </Text>
                                              <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[
                                                  styles.timeEndText,
                                                  {
                                                    color: "#7dd3fc",
                                                    fontSize: 10.5,
                                                    fontWeight: "600",
                                                    letterSpacing: -0.3,
                                                    fontVariant: [
                                                      "tabular-nums",
                                                    ],
                                                  },
                                                ]}
                                              >
                                                ~{walkAfterEndStr}
                                              </Text>
                                              <Text
                                                numberOfLines={1}
                                                style={{
                                                  fontSize: 10,
                                                  fontWeight: "700",
                                                  color: "#38bdf8",
                                                  marginTop: 1,
                                                }}
                                              >
                                                {walkAfterMins}m
                                              </Text>
                                            </View>
                                            <View style={styles.lineIconColumn}>
                                              <View
                                                style={[
                                                  styles.stepIconCircle,
                                                  {
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 12,
                                                    backgroundColor:
                                                      "rgba(56, 189, 248, 0.16)",
                                                    borderWidth: 1,
                                                    borderColor:
                                                      "rgba(56, 189, 248, 0.45)",
                                                  },
                                                ]}
                                              >
                                                <Ionicons
                                                  name="walk"
                                                  size={13}
                                                  color="#38bdf8"
                                                />
                                              </View>
                                              {!isLast &&
                                                renderWalkVerticalDashes(3)}
                                            </View>
                                          </View>
                                        )}
                                      </View>
                                    ) : (
                                      <>
                                        {/* Colonna Orario */}
                                        <View style={styles.timeColumn}>
                                          <Text
                                            numberOfLines={1}
                                            adjustsFontSizeToFit
                                            style={styles.timeStartText}
                                          >
                                            {isVariableFollowUpStep
                                              ? `~${leg.startTime}`
                                              : leg.startTime}
                                          </Text>
                                          {leg.endTime &&
                                            leg.endTime !== leg.startTime && (
                                              <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={styles.timeEndText}
                                              >
                                                {leg.endTime}
                                              </Text>
                                            )}
                                        </View>

                                        {/* Colonna Linea & Icona */}
                                        <View style={styles.lineIconColumn}>
                                          <View
                                            style={[
                                              styles.stepIconCircle,
                                              { backgroundColor: circleBg },
                                            ]}
                                          >
                                            <Ionicons
                                              name={iconName}
                                              size={15}
                                              color={iconColor}
                                            />
                                          </View>
                                          {!isLast && (
                                            <View
                                              style={styles.connectingLine}
                                            />
                                          )}
                                        </View>
                                      </>
                                    )}

                                    {/* Contenuto Tappa */}
                                    {(() => {
                                      const isTransitOrWalk =
                                        leg.type === "transit" ||
                                        leg.type === "walk";
                                      return (
                                        <View
                                          style={[
                                            styles.stepContentCard,
                                            !isLast && { marginBottom: 6 },
                                            {
                                              borderColor:
                                                "rgba(255, 255, 255, 0.08)",
                                              backgroundColor: "#1c1c1e",
                                            },
                                          ]}
                                        >
                                          {/* Intestazione Titolo / Sottotitolo (toccabile per aprire Maps se disponibile) */}
                                          <TouchableOpacity
                                            activeOpacity={
                                              isInteractive &&
                                              leg.details?.mapQuery
                                                ? 0.85
                                                : 1
                                            }
                                            disabled={
                                              !isInteractive ||
                                              !leg.details?.mapQuery
                                            }
                                            onPress={() => {
                                              if (leg.details?.mapQuery) {
                                                handleOpenMaps(leg);
                                              }
                                            }}
                                          >
                                            <View style={styles.stepTitleRow}>
                                              <Text
                                                style={styles.stepTitleText}
                                              >
                                                {leg.type === "walk"
                                                  ? "A piedi"
                                                  : leg.title}
                                              </Text>
                                              {leg.durationMinutes > 0 && (
                                                <View
                                                  style={
                                                    styles.durationBadgeContainer
                                                  }
                                                >
                                                  <Text
                                                    style={
                                                      styles.stepDurationText
                                                    }
                                                  >
                                                    {isTransitStep ||
                                                    isVariableFollowUpStep
                                                      ? `~${formatDuration(leg.durationMinutes)}`
                                                      : formatDuration(
                                                          leg.durationMinutes,
                                                        )}
                                                  </Text>
                                                </View>
                                              )}
                                            </View>

                                            <Text
                                              style={styles.stepSubtitleText}
                                            >
                                              {leg.subtitle}
                                            </Text>

                                            {isTransitStep && (
                                              <View
                                                style={{
                                                  flexDirection: "row",
                                                  flexWrap: "wrap",
                                                  alignItems: "center",
                                                  marginTop: 7,
                                                }}
                                              >
                                                <View
                                                  style={{
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    paddingHorizontal: 8,
                                                    paddingVertical: 3.5,
                                                    borderRadius: 6,
                                                    backgroundColor: "#191f2e",
                                                    borderWidth: 1,
                                                    borderColor:
                                                      "rgba(96, 165, 250, 0.45)",
                                                  }}
                                                >
                                                  <Ionicons
                                                    name="bus-outline"
                                                    size={11}
                                                    color="#60a5fa"
                                                    style={{
                                                      marginRight: 4,
                                                    }}
                                                  />
                                                  <Text
                                                    style={{
                                                      fontSize: 10.5,
                                                      fontWeight: "700",
                                                      color: "#93c5fd",
                                                    }}
                                                  >
                                                    Consigliato {busDepTimeStr}{" "}
                                                    → {busAlightTimeStr} (
                                                    {inVehicleMins}m)
                                                  </Text>
                                                </View>
                                              </View>
                                            )}
                                          </TouchableOpacity>

                                          {/* Segnalazione scioperi mezzi, manifestazioni o blocchi viabilità che impattano il percorso (identica graficamente alle card sciopero treni) */}
                                          {isTransitOrWalk &&
                                            currentWalkDisruptions.length > 0 &&
                                            (() => {
                                              const activeDisruption =
                                                currentWalkDisruptions[0];
                                              const info =
                                                formatWalkDisruptionSummary(
                                                  activeDisruption,
                                                );
                                              const extraCount = Math.max(
                                                0,
                                                currentWalkDisruptions.length -
                                                  1,
                                              );

                                              return (
                                                <TouchableOpacity
                                                  activeOpacity={0.85}
                                                  onPress={() => {
                                                    handleOpenDisruptionsModal(
                                                      "walk",
                                                      currentWalkDisruptions.map(
                                                        (d) => d.id,
                                                      ),
                                                    );
                                                  }}
                                                  style={[
                                                    styles.heroDisruptionCard,
                                                    {
                                                      marginTop: 8,
                                                      marginBottom: 4,
                                                      backgroundColor:
                                                        info.bgColor,
                                                      borderColor:
                                                        info.borderColor,
                                                    },
                                                  ]}
                                                >
                                                  <View
                                                    style={
                                                      styles.heroDisruptionHeaderRow
                                                    }
                                                  >
                                                    <View
                                                      style={[
                                                        styles.heroDisruptionBadge,
                                                        {
                                                          backgroundColor:
                                                            info.badgeBgColor,
                                                        },
                                                      ]}
                                                    >
                                                      <Ionicons
                                                        name={info.iconName}
                                                        size={11}
                                                        color={info.accentColor}
                                                        style={{
                                                          marginRight: 4,
                                                        }}
                                                      />
                                                      <Text
                                                        style={[
                                                          styles.heroDisruptionBadgeText,
                                                          {
                                                            color:
                                                              info.accentColor,
                                                          },
                                                        ]}
                                                      >
                                                        {info.badgeLabel}
                                                      </Text>
                                                    </View>
                                                    {extraCount > 0 && (
                                                      <View
                                                        style={[
                                                          styles.heroDisruptionExtraPill,
                                                          {
                                                            backgroundColor:
                                                              info.badgeBgColor,
                                                          },
                                                        ]}
                                                      >
                                                        <Text
                                                          style={[
                                                            styles.heroDisruptionExtraText,
                                                            {
                                                              color:
                                                                info.descColor,
                                                            },
                                                          ]}
                                                        >
                                                          +{extraCount}
                                                        </Text>
                                                      </View>
                                                    )}
                                                    <View
                                                      style={
                                                        styles.heroDisruptionActionRow
                                                      }
                                                    >
                                                      <Text
                                                        style={[
                                                          styles.heroDisruptionActionText,
                                                          {
                                                            color:
                                                              info.descColor,
                                                          },
                                                        ]}
                                                      >
                                                        Dettagli
                                                      </Text>
                                                      <Ionicons
                                                        name="chevron-forward"
                                                        size={12}
                                                        color={info.descColor}
                                                      />
                                                    </View>
                                                  </View>
                                                  <Text
                                                    style={[
                                                      styles.heroDisruptionDesc,
                                                      { color: info.descColor },
                                                    ]}
                                                    numberOfLines={2}
                                                  >
                                                    {info.description}
                                                  </Text>
                                                </TouchableOpacity>
                                              );
                                            })()}

                                          {/* Selettore rapido Mezzi / A piedi direttamente sulla tappa urbana (isolato da Maps) */}
                                          {isTransitOrWalk &&
                                            (isNativeIos ? (
                                              <View
                                                style={
                                                  styles.inlineSegmentedWrapper
                                                }
                                              >
                                                <SegmentedControl
                                                  key={`seg-leg-mode-${theme.primary}-${leg.type}-${config?.transitLeg?.preferredMode}`}
                                                  values={[
                                                    "Con i mezzi",
                                                    "A piedi",
                                                  ]}
                                                  selectedIndex={
                                                    leg.type === "walk" ||
                                                    config?.transitLeg
                                                      ?.preferredMode === "walk"
                                                      ? 1
                                                      : 0
                                                  }
                                                  onChange={(e) => {
                                                    const idx =
                                                      e.nativeEvent
                                                        .selectedSegmentIndex;
                                                    handleToggleTransitMode(
                                                      idx === 1
                                                        ? "walk"
                                                        : "auto",
                                                    );
                                                  }}
                                                  onValueChange={(val) => {
                                                    handleToggleTransitMode(
                                                      val === "A piedi"
                                                        ? "walk"
                                                        : "auto",
                                                    );
                                                  }}
                                                  appearance="dark"
                                                  tintColor={theme.primary}
                                                  style={
                                                    styles.inlineSegmentedControl
                                                  }
                                                  fontStyle={{
                                                    fontSize: 11,
                                                    fontWeight: "600",
                                                    color: "#a1a1aa",
                                                  }}
                                                  activeFontStyle={{
                                                    fontSize: 11,
                                                    fontWeight: "700",
                                                    color: "#ffffff",
                                                  }}
                                                />
                                              </View>
                                            ) : (
                                              <View
                                                style={
                                                  styles.inlineTransitSelectorRow
                                                }
                                              >
                                                <TouchableOpacity
                                                  style={[
                                                    styles.inlineTransitBtn,
                                                    leg.type === "transit" &&
                                                      config?.transitLeg
                                                        ?.preferredMode !==
                                                        "walk" &&
                                                      styles.inlineTransitBtnActiveTransit,
                                                  ]}
                                                  activeOpacity={0.7}
                                                  onPress={() =>
                                                    handleToggleTransitMode(
                                                      "auto",
                                                    )
                                                  }
                                                >
                                                  <Ionicons
                                                    name="bus-outline"
                                                    size={11}
                                                    color={
                                                      leg.type === "transit" &&
                                                      config?.transitLeg
                                                        ?.preferredMode !==
                                                        "walk"
                                                        ? "#ffffff"
                                                        : "#94a3b8"
                                                    }
                                                    style={{ marginRight: 4 }}
                                                  />
                                                  <Text
                                                    style={[
                                                      styles.inlineTransitBtnText,
                                                      leg.type === "transit" &&
                                                        config?.transitLeg
                                                          ?.preferredMode !==
                                                          "walk" &&
                                                        styles.inlineTransitBtnTextActive,
                                                    ]}
                                                  >
                                                    Con i mezzi
                                                  </Text>
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                  style={[
                                                    styles.inlineTransitBtn,
                                                    (leg.type === "walk" ||
                                                      config?.transitLeg
                                                        ?.preferredMode ===
                                                        "walk") &&
                                                      styles.inlineTransitBtnActiveWalk,
                                                  ]}
                                                  activeOpacity={0.7}
                                                  onPress={() =>
                                                    handleToggleTransitMode(
                                                      "walk",
                                                    )
                                                  }
                                                >
                                                  <Ionicons
                                                    name="walk-outline"
                                                    size={11}
                                                    color={
                                                      leg.type === "walk" ||
                                                      config?.transitLeg
                                                        ?.preferredMode ===
                                                        "walk"
                                                        ? "#ffffff"
                                                        : "#94a3b8"
                                                    }
                                                    style={{ marginRight: 4 }}
                                                  />
                                                  <Text
                                                    style={[
                                                      styles.inlineTransitBtnText,
                                                      (leg.type === "walk" ||
                                                        config?.transitLeg
                                                          ?.preferredMode ===
                                                          "walk") &&
                                                        styles.inlineTransitBtnTextActive,
                                                    ]}
                                                  >
                                                    A piedi
                                                  </Text>
                                                </TouchableOpacity>
                                              </View>
                                            ))}

                                          {/* Tabellone Partenze & Linee Urbane (attivo con Mezzi Pubblici) */}
                                          {leg.type === "transit" &&
                                            config?.transitLeg
                                              ?.preferredMode !== "walk" &&
                                            (() => {
                                              const liveTr =
                                                itinerary.liveTrain;
                                              const isPastReturnTrain = Boolean(
                                                direction === "return" &&
                                                  isSelectedDayToday &&
                                                  liveTr &&
                                                  !liveTr.isStoppedInStation &&
                                                  (liveTr.isDepartedFromStation ||
                                                    (
                                                      liveTr.statusDescription ||
                                                      ""
                                                    )
                                                      .toLowerCase()
                                                      .includes("passato") ||
                                                    (
                                                      liveTr.statusDescription ||
                                                      ""
                                                    )
                                                      .toLowerCase()
                                                      .includes("arrivato")),
                                              );
                                              const isOutboundPostLesson =
                                                direction === "outbound" &&
                                                Boolean(
                                                  isSelectedDayToday &&
                                                    isTargetLectureFinished,
                                                );

                                              // Verifica se la lezione target odierna è in corso oppure già conclusa
                                              const lectureStartMins = itinerary
                                                .targetLecture?.startTime
                                                ? parseTimeToMinutes(
                                                    itinerary.targetLecture
                                                      .startTime,
                                                  )
                                                : -1;
                                              const isLectureActiveOrFinished =
                                                Boolean(
                                                  isSelectedDayToday &&
                                                  itinerary.targetLecture &&
                                                  (isTargetLectureFinished ||
                                                    (lectureStartMins > 0 &&
                                                      currentNowMins >=
                                                        lectureStartMins) ||
                                                    itinerary.targetLecture
                                                      .subject ===
                                                      "Lezioni di oggi terminate"),
                                                );

                                              // In ritorno a lezioni terminate (con treno ancora da prendere) il tabellone è live da subito;
                                              // in altri contesti con lezione attiva usa il contesto calcolato dall'itinerario
                                              const isTransitLiveContext =
                                                direction === "return" &&
                                                Boolean(isSelectedDayToday) &&
                                                isTargetLectureFinished &&
                                                !isPastReturnTrain
                                                  ? true
                                                  : Boolean(
                                                      isSelectedDayToday,
                                                    ) &&
                                                    !isLectureActiveOrFinished;

                                              const constraintTimeForTransit =
                                                direction === "return"
                                                  ? isSelectedDayToday
                                                    ? liveTr?.departureTimePlanned ||
                                                      liveTr?.departureTimeActual
                                                    : liveTr?.departureTimePlanned
                                                  : isOutboundPostLesson
                                                    ? undefined
                                                    : itinerary.targetLecture
                                                        ?.startTime;

                                              const minDepTimeForTransit =
                                                direction === "outbound"
                                                  ? isSelectedDayToday
                                                    ? liveTr?.arrivalTimeActual ||
                                                      liveTr?.arrivalTimePlanned
                                                    : liveTr?.arrivalTimePlanned
                                                  : isTargetLectureFinished
                                                    ? undefined
                                                    : itinerary.targetLecture
                                                        ?.endTime;

                                              const anchorTimeStr =
                                                direction === "return" &&
                                                isTransitLiveContext
                                                  ? "now"
                                                  : isOutboundPostLesson
                                                    ? minDepTimeForTransit ||
                                                      leg.startTime
                                                    : leg.details?.targetTime ||
                                                      leg.startTime;

                                              return (
                                                <TransitBoardCard
                                                  stationName={
                                                    config
                                                      ? getRomeStationName(
                                                          config,
                                                          itinerary.liveTrain,
                                                          direction,
                                                        )
                                                      : "Roma Tiburtina"
                                                  }
                                                  targetName={
                                                    itinerary.targetLecture
                                                      ? itinerary.targetLecture
                                                          .buildingName
                                                        ? `${itinerary.targetLecture.buildingName} (${itinerary.targetLecture.room})`
                                                        : itinerary
                                                            .targetLecture.room
                                                      : config?.customDestinationName ||
                                                        "Sapienza"
                                                  }
                                                  targetCoords={
                                                    itinerary.targetLecture
                                                      ?.latitude &&
                                                    itinerary.targetLecture
                                                      ?.longitude
                                                      ? {
                                                          lat: itinerary
                                                            .targetLecture
                                                            .latitude,
                                                          lng: itinerary
                                                            .targetLecture
                                                            .longitude,
                                                        }
                                                      : undefined
                                                  }
                                                  targetDate={
                                                    itinerary.targetDate
                                                  }
                                                  targetTime={anchorTimeStr}
                                                  direction={
                                                    direction === "return"
                                                      ? "to_station"
                                                      : "to_campus"
                                                  }
                                                  isToday={isSelectedDayToday}
                                                  selectedDayLabel={
                                                    currentWeekday?.label
                                                  }
                                                  isLiveContext={
                                                    direction === "return" &&
                                                    Boolean(
                                                      isSelectedDayToday,
                                                    ) &&
                                                    isTargetLectureFinished &&
                                                    !isPastReturnTrain
                                                      ? true
                                                      : (itinerary.transitLiveContext ??
                                                        isTransitLiveContext)
                                                  }
                                                  constraintTime={
                                                    isOutboundPostLesson
                                                      ? undefined
                                                      : (itinerary.transitConstraintTime ??
                                                        constraintTimeForTransit)
                                                  }
                                                  minDepartureTime={
                                                    direction === "return" &&
                                                    (isTargetLectureFinished ||
                                                      itinerary.lectureTimeStatus
                                                        ?.type ===
                                                        "early_departure")
                                                      ? undefined
                                                      : (itinerary.transitMinDepartureTime ??
                                                        minDepTimeForTransit)
                                                  }
                                                  arrivalBufferMinutes={
                                                    direction === "return"
                                                      ? (itinerary.transitArrivalBufferMinutes ??
                                                        5)
                                                      : (itinerary.transitArrivalBufferMinutes ??
                                                        config?.bufferMinutes ??
                                                        10)
                                                  }
                                                  preferLatestBeforeDeadline={
                                                    direction === "return" &&
                                                    !isTargetLectureFinished &&
                                                    Boolean(
                                                      itinerary.transitPreferLatestBeforeDeadline,
                                                    )
                                                  }
                                                  prefetchedBoard={
                                                    itinerary.prefetchedTransitBoard
                                                  }
                                                  refreshTimestamp={lastUpdated?.getTime()}
                                                  onOptimalDepartureResolved={
                                                    handleOptimalTransitResolved
                                                  }
                                                  theme={theme}
                                                />
                                              );
                                            })()}

                                          {leg.details?.badgeText &&
                                            leg.type !== "walk" &&
                                            leg.type !== "transit" && (
                                              <View
                                                style={[
                                                  styles.legCustomBadge,
                                                  {
                                                    backgroundColor:
                                                      leg.details.badgeBg ||
                                                      "rgba(245, 158, 11, 0.15)",
                                                    borderColor:
                                                      leg.details.badgeColor ||
                                                      "#f59e0b",
                                                  },
                                                ]}
                                              >
                                                <Ionicons
                                                  name={
                                                    leg.details
                                                      .lostLectureMinutes
                                                      ? "alert-circle"
                                                      : "time"
                                                  }
                                                  size={11}
                                                  color={
                                                    leg.details.badgeColor ||
                                                    "#f59e0b"
                                                  }
                                                  style={{ marginRight: 4 }}
                                                />
                                                <Text
                                                  style={[
                                                    styles.legCustomBadgeText,
                                                    {
                                                      color:
                                                        leg.details
                                                          .badgeColor ||
                                                        "#f59e0b",
                                                    },
                                                  ]}
                                                >
                                                  {leg.details.badgeText}
                                                </Text>
                                              </View>
                                            )}

                                          {/* Avviso Evidente Traffico Stradale */}
                                          {/* Avviso Dinamico Traffico Stradale */}
                                          {leg.type === "car" &&
                                            (leg.details?.trafficFluency ||
                                              leg.details
                                                ?.trafficCondition) && (
                                              <View
                                                style={[
                                                  styles.trafficAlertBox,
                                                  leg.details.trafficFluency ===
                                                    "intenso" ||
                                                  leg.details.trafficFluency ===
                                                    "rallentamenti"
                                                    ? styles.trafficAlertBoxWarning
                                                    : leg.details
                                                          .trafficFluency ===
                                                        "moderato"
                                                      ? styles.trafficAlertBoxModerate
                                                      : styles.trafficAlertBoxSmooth,
                                                ]}
                                              >
                                                <View
                                                  style={
                                                    styles.trafficAlertHeader
                                                  }
                                                >
                                                  <View
                                                    style={[
                                                      styles.trafficAlertIconBox,
                                                      {
                                                        backgroundColor:
                                                          leg.details
                                                            .trafficFluency ===
                                                          "intenso"
                                                            ? "rgba(239, 68, 68, 0.2)"
                                                            : leg.details
                                                                  .trafficFluency ===
                                                                "rallentamenti"
                                                              ? "rgba(245, 158, 11, 0.2)"
                                                              : leg.details
                                                                    .trafficFluency ===
                                                                  "moderato"
                                                                ? "rgba(59, 130, 246, 0.2)"
                                                                : "rgba(16, 185, 129, 0.2)",
                                                      },
                                                    ]}
                                                  >
                                                    <Ionicons
                                                      name={
                                                        leg.details
                                                          .trafficFluency ===
                                                        "intenso"
                                                          ? "flame"
                                                          : leg.details
                                                                .trafficFluency ===
                                                              "rallentamenti"
                                                            ? "warning"
                                                            : leg.details
                                                                  .trafficFluency ===
                                                                "moderato"
                                                              ? "speedometer-outline"
                                                              : "checkmark-circle"
                                                      }
                                                      size={16}
                                                      color={
                                                        leg.details
                                                          .trafficFluency ===
                                                        "intenso"
                                                          ? "#ef4444"
                                                          : leg.details
                                                                .trafficFluency ===
                                                              "rallentamenti"
                                                            ? "#f59e0b"
                                                            : leg.details
                                                                  .trafficFluency ===
                                                                "moderato"
                                                              ? "#60a5fa"
                                                              : "#10b981"
                                                      }
                                                    />
                                                  </View>
                                                  <View style={{ flex: 1 }}>
                                                    <Text
                                                      style={[
                                                        styles.trafficAlertTitle,
                                                        {
                                                          color:
                                                            leg.details
                                                              .trafficFluency ===
                                                            "intenso"
                                                              ? "#fca5a5"
                                                              : leg.details
                                                                    .trafficFluency ===
                                                                  "rallentamenti"
                                                                ? "#fcd34d"
                                                                : leg.details
                                                                      .trafficFluency ===
                                                                    "moderato"
                                                                  ? "#93c5fd"
                                                                  : "#6ee7b7",
                                                        },
                                                      ]}
                                                    >
                                                      {leg.details
                                                        .trafficFluency ===
                                                      "intenso"
                                                        ? "TRAFFICO MOLTO INTENSO"
                                                        : leg.details
                                                              .trafficFluency ===
                                                            "rallentamenti"
                                                          ? "RALLENTAMENTI SU STRADA"
                                                          : leg.details
                                                                .trafficFluency ===
                                                              "moderato"
                                                            ? "TRAFFICO MODERATO"
                                                            : "TRAFFICO SCORREVOLE"}
                                                    </Text>
                                                    <Text
                                                      style={
                                                        styles.trafficAlertDescription
                                                      }
                                                    >
                                                      {(() => {
                                                        let baseCondition = (
                                                          leg.details
                                                            .trafficCondition ||
                                                          (leg.details
                                                            .trafficFluency ===
                                                          "scorrevole"
                                                            ? "Tempo ottimale senza rallentamenti"
                                                            : "Viabilità regolare")
                                                        ).trim();

                                                        // Rimuove eventuali duplicazioni di stringa di ritardo
                                                        baseCondition =
                                                          baseCondition.replace(
                                                            /(\s*\(\+\d+\s*min(?:\s*rispetto\s*al\s*tempo\s*base)?\)){2,}/gi,
                                                            "$1",
                                                          );

                                                        // Appende lo scostamento dal tempo base solo se non è già presente nella stringa
                                                        const alreadyHasDelay =
                                                          baseCondition.includes(
                                                            "rispetto al tempo base",
                                                          ) ||
                                                          baseCondition.includes(
                                                            "(+",
                                                          );

                                                        const delayInfo =
                                                          !alreadyHasDelay &&
                                                          leg.details
                                                            .trafficDelayMinutes &&
                                                          leg.details
                                                            .trafficDelayMinutes >
                                                            0
                                                            ? ` (+${leg.details.trafficDelayMinutes} min rispetto al tempo base)`
                                                            : "";

                                                        return `${baseCondition}${delayInfo}`;
                                                      })()}
                                                    </Text>
                                                  </View>
                                                </View>
                                              </View>
                                            )}

                                          {/* Note della tratta (omesse per treno, arrivo destinazione, mezzi pubblici e camminata) */}
                                          {leg.details?.notes &&
                                            leg.type !== "transit" &&
                                            leg.type !== "walk" &&
                                            leg.type !== "train" &&
                                            leg.type !== "destination" &&
                                            leg.details.notes !==
                                              "Tocca per aprire la navigazione con orario impostato" && (
                                              <Text
                                                style={styles.stepNotesText}
                                              >
                                                {leg.details.notes}
                                              </Text>
                                            )}

                                          {/* Footer minimale Google Maps (omesso per treno e arrivo) */}
                                          {leg.details?.mapQuery &&
                                            leg.type !== "train" &&
                                            leg.type !== "destination" && (
                                              <TouchableOpacity
                                                activeOpacity={0.7}
                                                disabled={!isInteractive}
                                                onPress={() =>
                                                  handleOpenMaps(leg)
                                                }
                                                hitSlop={{
                                                  top: 6,
                                                  bottom: 12,
                                                  left: 12,
                                                  right: 12,
                                                }}
                                                style={[
                                                  styles.mapsFooterRow,
                                                  leg.type === "transit" &&
                                                    config?.transitLeg
                                                      ?.preferredMode !==
                                                      "walk" &&
                                                    !leg.details?.badgeText && {
                                                      marginTop: 2,
                                                    },
                                                ]}
                                              >
                                                <View
                                                  style={styles.mapsFooterLeft}
                                                >
                                                  <Ionicons
                                                    name={
                                                      leg.type === "transit" ||
                                                      leg.details.travelMode ===
                                                        "transit"
                                                        ? "bus-outline"
                                                        : leg.details
                                                              .travelMode ===
                                                            "walking"
                                                          ? "walk-outline"
                                                          : "navigate-outline"
                                                    }
                                                    size={14}
                                                    color={theme.accent}
                                                    style={{ marginRight: 7 }}
                                                  />
                                                  <Text
                                                    style={[
                                                      styles.mapsFooterText,
                                                      { color: theme.accent },
                                                    ]}
                                                    numberOfLines={1}
                                                  >
                                                    {leg.type === "transit"
                                                      ? "Cerca mezzi su Google Maps"
                                                      : leg.details
                                                            .travelMode ===
                                                          "transit"
                                                        ? "Apri su Google Maps"
                                                        : leg.details
                                                              .travelMode ===
                                                            "walking"
                                                          ? "Percorso su Google Maps"
                                                          : "Naviga su Google Maps"}
                                                  </Text>
                                                </View>
                                                <Ionicons
                                                  name="open-outline"
                                                  size={13.5}
                                                  color={theme.accent}
                                                  style={{ opacity: 0.85 }}
                                                />
                                              </TouchableOpacity>
                                            )}
                                        </View>
                                      );
                                    })()}
                                  </View>
                                );
                              })}
                            </View>
                          </>
                        )}
                      </View>
                    ) : (
                      renderAdjacentDayPreview(w, pageClasses)
                    )}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Modal Impostazioni Pendolare */}
        {config && (
          <CommuterConfigModal
            visible={configModalVisible}
            config={config}
            onClose={() => setConfigModalVisible(false)}
            onSave={handleSaveConfig}
          />
        )}

        {/* Modal Registro Manifestazioni e Scioperi */}
        <DisruptionsRegistryModal
          visible={disruptionsModalVisible}
          onClose={() => {
            setDisruptionsModalVisible(false);
            setSelectedDisruptionEventId(null);
            setSelectedDisruptionEventIds([]);
          }}
          disruptions={disruptions}
          loading={disruptionsLoading}
          onRefresh={() => loadDisruptionsData(true)}
          theme={theme}
          initialFilter={disruptionsInitialFilter}
          activeStationName={commuterStationName}
          selectedDateIso={selectedDateIso}
          highlightEventId={selectedDisruptionEventId}
          highlightEventIds={selectedDisruptionEventIds}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UNIFORM_SCREEN_BG,
  },
  safeArea: {
    flex: 1,
  },

  /* Liquid Glass Header */
  liquidGlassHeader: {
    overflow: "hidden",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
    marginBottom: 8,
  },
  liquidGlassOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(24, 24, 26, 0.65)",
  },
  liquidGlassTitleRow: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liquidGlassTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.35,
  },
  liveUpdatedRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  liveUpdatedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34c759",
    marginRight: 6,
  },
  liveUpdatedText: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: "500",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },

  /* Switcher Andata / Ritorno */
  switcherContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  nativeSegmentedControl: {
    height: 36,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  customSegmentedControl: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  customSegmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1c1c1e",
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    paddingHorizontal: 8,
  },
  customSegmentBtnActive: {
    backgroundColor: SAPIENZA_RED_BG,
    borderColor: SAPIENZA_RED,
    borderWidth: 1,
  },
  customSegmentText: {
    fontSize: 13,
    color: "#a1a1aa",
    fontWeight: "600",
  },
  customSegmentTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },

  /* Selettore Giorno della settimana - Liquid Glass Week Bar */
  daySelectorContainer: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 2,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  daySegmentedBar: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: CARD_RADIUS.card,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  daySegmentInnerContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: 38,
    position: "relative",
  },
  slidingActivePill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    height: 38,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 1,
  },
  daySegmentItem: {
    flex: 1,
    height: 38,
    borderRadius: CARD_RADIUS.cardInner,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 8,
    backgroundColor: "transparent",
    borderWidth: 0,
    zIndex: 2,
    position: "relative",
  },
  dayWeekendDivider: {
    width: 1,
    height: 18,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    alignSelf: "center",
    marginHorizontal: 1,
  },
  daySegmentLabel: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "800",
    color: "#a1a1aa",
    textAlign: "center",
    includeFontPadding: false,
  },
  daySegmentLabelWeekend: {
    color: "#d4d4d8",
  },
  daySegmentLabelActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  daySegmentDot: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  daySegmentDotActive: {
    backgroundColor: "#ffffff",
  },
  jumpToTodayPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  jumpToTodayText: {
    color: "#ffffff",
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.15,
  },

  /* Lezioni del Giorno */
  lecturesSection: {
    paddingHorizontal: 0,
    marginBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: SAPIENZA_RED_ACCENT,
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 11,
    color: "#64748b",
  },
  noClassesCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  noClassesText: {
    fontSize: 12,
    color: "#94a3b8",
    flex: 1,
    flexWrap: "wrap",
  },
  classesScrollContainer: {
    gap: LECTURE_CARD_GAP,
    paddingVertical: 3,
  },
  classCard: {
    width: LECTURE_CARD_WIDTH,
    backgroundColor: "#1c1c1e",
    borderRadius: CARD_RADIUS.card,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 2,
  },
  classCardSelected: {
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 3,
  },
  classCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
    gap: 6,
  },
  classTimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    paddingHorizontal: 6.5,
    paddingVertical: 2,
    borderRadius: 999,
  },
  classTimeText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "#cbd5e1",
    fontVariant: ["tabular-nums"],
  },
  classTimeTextSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  targetBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 2,
  },
  targetBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  excludedSelectedWash: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#000000",
    borderRadius: CARD_RADIUS.card,
  },
  classSubjectText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#e2e8f0",
    lineHeight: 16,
    minHeight: 32,
    letterSpacing: -0.2,
  },
  classRoomRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  classRoomText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#94a3b8",
    flex: 1,
  },
  classRoomTextSelected: {
    fontWeight: "600",
  },

  /* Empty / Loading */
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginTop: 12,
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  /* Scroll Body */
  horizontalPager: {
    flex: 1,
    width: "100%",
  },
  pagerPage: {
    flex: 1,
    height: "100%",
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },

  /* Hero Card */
  heroCard: {
    position: "relative",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: CARD_RADIUS.cardLarge,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
    marginBottom: 12,
  },
  heroTopRightBadgeStack: {
    position: "absolute",
    top: 16,
    right: 16,
    alignItems: "flex-end",
    gap: 8,
    zIndex: 2,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heroTopRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  durationBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  durationBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#cbd5e1",
  },
  heroDelayPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  heroDelayPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  heroHeadlineRow: {
    marginBottom: 0,
    paddingRight: 115,
  },
  heroHeadline: {
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: "500",
  },
  heroBigTime: {
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -1,
    includeFontPadding: false,
    marginTop: 6,
    marginBottom: 8,
  },
  heroTargetLectureBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.12)",
    gap: 10,
  },
  heroLectureIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  heroLectureTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heroLectureExcludedPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: "rgba(148, 163, 184, 0.16)",
  },
  heroLectureExcludedText: {
    color: "#cbd5e1",
    fontSize: 9.5,
    fontWeight: "600",
  },
  heroLectureSubject: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: -0.2,
  },
  heroLectureMetaRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 3,
    marginTop: 4,
  },
  heroLectureMetaItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    minWidth: 0,
  },
  heroLectureDetails: {
    fontSize: 12,
    lineHeight: 16,
    color: "#94a3b8",
    fontWeight: "500",
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },

  /* Card Treno Risaltato */
  trainHighlightCard: {
    backgroundColor: "rgba(130, 36, 51, 0.16)",
    borderRadius: CARD_RADIUS.card,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.35)",
    padding: 14,
    marginBottom: 14,
  },
  trainHighlightHeader: {
    marginBottom: 12,
  },
  trainHighlightTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trainHighlightTopLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  trainHighlightPillsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 8,
  },
  trainHighlightHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    flex: 1,
  },
  trainNumberBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  trainNumberText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
  trainStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  trainStatusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  trainOriginPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  trainOriginPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  trainTrenitaliaLinkBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  trainTrenitaliaLinkText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  trainAlertBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  trainAlertBannerText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#f59e0b",
    flex: 1,
    lineHeight: 15,
  },
  trainCapacityBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(130, 36, 51, 0.2)",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.35)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  trainCapacityBannerText: {
    fontSize: 11,
    fontWeight: "600",
    color: SAPIENZA_RED_LIGHT,
    flex: 1,
    lineHeight: 15,
  },
  trainInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trainStationLabel: {
    fontSize: 11,
    color: "#94a3b8",
  },
  trainStationName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    marginTop: 2,
  },
  trainTimeText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#ffffff",
    marginTop: 2,
  },
  platformHighlightBox: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: SAPIENZA_RED_BORDER,
  },
  platformHighlightLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.5,
  },
  platformHighlightValue: {
    fontSize: 22,
    fontWeight: "900",
    color: "#ffffff",
  },
  liveTag: {
    backgroundColor: "#34c759",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  liveTagText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#000",
  },
  trainAlternativesDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginVertical: 10,
  },
  trainNavButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 10,
  },
  trainNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    minHeight: 32,
    flexShrink: 1,
  },
  trainNavBtnDisabled: {
    opacity: 0.35,
  },
  trainNavBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#f8fafc",
    letterSpacing: -0.1,
  },
  trainPreferredBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    minHeight: 32,
    flexShrink: 1,
  },
  trainNavCenterLabel: {
    fontSize: 11.5,
    color: "#cbd5e1",
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  trainChipsTrack: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: CARD_RADIUS.card,
    padding: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  trainChipsScroll: {
    gap: 6,
    paddingHorizontal: 2,
    paddingVertical: 1,
    alignItems: "center",
  },
  trainChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    position: "relative",
  },
  trainChipCurrent: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: 0,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.55,
    shadowRadius: 6,
    elevation: 4,
  },
  trainChipText: {
    fontSize: 11.5,
    color: "#94a3b8",
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.1,
  },
  trainChipTextCurrent: {
    color: "#ffffff",
    fontWeight: "700",
  },
  smartChipPill: {
    marginLeft: 5,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: "rgba(245, 158, 11, 0.22)",
  },
  smartChipPillCurrent: {
    backgroundColor: "rgba(0, 0, 0, 0.28)",
  },
  smartChipPillText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#fcd34d",
  },
  smartReturnBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
  },
  smartReturnBannerSuggested: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  smartReturnBannerActive: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  smartReturnTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  smartReturnTitle: {
    fontSize: 11.5,
    fontWeight: "800",
  },
  smartReturnSub: {
    fontSize: 11,
    color: "#cbd5e1",
    lineHeight: 15,
  },
  smartReturnActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smartReturnActionBtnPrimary: {
    backgroundColor: "#fbbf24",
  },
  smartReturnActionBtnMuted: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  smartReturnActionText: {
    fontSize: 11.5,
    fontWeight: "800",
  },

  /* Timeline */
  timelineSectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  timelineContainer: {
    marginBottom: 16,
  },
  timelineStepRow: {
    flexDirection: "row",
  },
  timeColumn: {
    width: 54,
    alignItems: "flex-end",
    paddingRight: 6,
    paddingTop: 6,
  },
  timeStartText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  timeEndText: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 2,
  },
  lineIconColumn: {
    alignItems: "center",
    width: 28,
  },
  stepIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  connectingLine: {
    width: 2,
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  stepContentCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: CARD_RADIUS.cardLarge,
    padding: 12,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  stepContentCardInteractive: {
    borderColor: SAPIENZA_RED_BORDER,
  },
  stepTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 3,
  },
  stepTitleText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 19,
  },
  durationBadgeContainer: {
    paddingTop: 1,
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  stepDurationText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
  },
  stepSubtitleText: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 4,
    flexShrink: 1,
  },
  inlineTransitSelectorRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 8,
    padding: 2.5,
    gap: 3,
    marginTop: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  inlineSegmentedWrapper: {
    alignSelf: "flex-start",
    marginTop: 6,
    marginBottom: 4,
    width: 210,
  },
  inlineSegmentedControl: {
    height: 30,
  },
  inlineTransitBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 6,
    backgroundColor: "transparent",
  },
  inlineTransitBtnActiveTransit: {
    backgroundColor: "rgba(168, 85, 247, 0.25)",
    borderColor: "rgba(168, 85, 247, 0.5)",
    borderWidth: 1,
  },
  inlineTransitBtnActiveWalk: {
    backgroundColor: "rgba(56, 189, 248, 0.25)",
    borderColor: "rgba(56, 189, 248, 0.5)",
    borderWidth: 1,
  },
  inlineTransitBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
  },
  inlineTransitBtnTextActive: {
    fontWeight: "700",
    color: "#ffffff",
  },
  legCustomBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: "flex-start",
    marginTop: 3,
    marginBottom: 4,
  },
  legCustomBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  stepNotesText: {
    fontSize: 11,
    color: "#cbd5e1",
    marginTop: 2,
  },

  /* Avviso Traffico Prominente */
  trafficAlertBox: {
    borderRadius: CARD_RADIUS.cardInner,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
  },
  trafficAlertBoxWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  trafficAlertBoxModerate: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  trafficAlertBoxSmooth: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderColor: "rgba(16, 185, 129, 0.28)",
  },
  trafficAlertHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  trafficAlertIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 9,
  },
  trafficAlertTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  trafficAlertDescription: {
    fontSize: 11,
    color: "#cbd5e1",
    marginTop: 2,
    lineHeight: 15,
  },
  trafficDelayPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.3)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.5)",
  },
  trafficDelayPillText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#ffedd5",
    letterSpacing: 0.4,
  },

  /* Scheda Link Trenitalia Timeline */
  trenitaliaTimelineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(130, 36, 51, 0.2)",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.35)",
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 8,
  },
  trenitaliaIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  trenitaliaBannerTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  trenitaliaBannerSubtitle: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  trenitaliaActionBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  trenitaliaActionBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },

  /* Footer minimale Google Maps */
  mapsFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    paddingTop: 10,
    marginTop: 10,
  },
  mapsFooterLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  mapsFooterText: {
    fontSize: 12.5,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  inactiveStateWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 90,
  },
  inactiveStateCard: {
    width: "100%",
    borderRadius: CARD_RADIUS.cardLarge,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  inactiveIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  inactiveStateTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 10,
  },
  inactiveStateDesc: {
    fontSize: 14,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
  },
  inactiveConfigureBtn: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  inactiveConfigureBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  headerAlertBtnWrapper: {
    marginLeft: 8,
    position: "relative",
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  headerStrikePulseHalo: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(239, 68, 68, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.85)",
  },
  headerIconBtnStrike: {
    backgroundColor: "rgba(239, 68, 68, 0.24)",
    borderColor: "rgba(239, 68, 68, 0.9)",
    borderWidth: 1.5,
  },
  headerIconBtnWalkAlert: {
    backgroundColor: "rgba(245, 158, 11, 0.18)",
    borderColor: "rgba(245, 158, 11, 0.75)",
    borderWidth: 1.25,
  },
  headerAlertBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 8.5,
    backgroundColor: "#ef4444",
    borderWidth: 1.5,
    borderColor: UNIFORM_SCREEN_BG,
    justifyContent: "center",
    alignItems: "center",
  },
  headerAlertBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
    includeFontPadding: false,
  },
  trainStrikeBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.35)",
    borderRadius: CARD_RADIUS.cardInner,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 0,
    marginBottom: 12,
  },
  trainStrikeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.22)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginRight: 7,
    flexShrink: 0,
  },
  trainStrikeBadgeText: {
    color: "#ef4444",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  trainStrikeBannerText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  walkDisruptionAlertBanner: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 8,
    marginBottom: 4,
  },
  walkDisruptionAlertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  walkDisruptionAlertTitle: {
    color: "#f59e0b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  walkDisruptionAlertDesc: {
    color: "#fde68a",
    fontSize: 12,
    lineHeight: 16,
  },
  heroDisruptionCompactStrip: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroDisruptionCompactIconsWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginRight: 7,
  },
  heroDisruptionCompactIconDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  heroDisruptionCompactText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  heroDisruptionCompactCountPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    marginLeft: 6,
  },
  heroDisruptionCompactCountText: {
    fontSize: 10,
    fontWeight: "800",
  },
  heroDisruptionStack: {
    width: "100%",
    gap: 8,
  },
  heroDisruptionCard: {
    width: "100%",
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  heroDisruptionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroDisruptionBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 5,
    flexShrink: 0,
  },
  heroDisruptionBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.35,
  },
  heroDisruptionExtraPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginLeft: 6,
  },
  heroDisruptionExtraText: {
    fontSize: 10,
    fontWeight: "700",
  },
  heroDisruptionActionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    gap: 2,
  },
  heroDisruptionActionText: {
    fontSize: 11,
    fontWeight: "700",
  },
  heroDisruptionDesc: {
    fontSize: 12.5,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 5,
  },
});
