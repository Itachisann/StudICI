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
import { DisruptionEvent } from "../types/disruptions";
import { refreshAppleCalendarIfConfigured } from "../utils/appleCalendar";
import { getDateForDayIndex } from "../utils/attendance";
import {
  computeCommuterItinerary,
  getRomeStationName,
  getTrainPreferenceKey,
} from "../utils/commuterOptimizer";
import {
  getCommuterConfig,
  saveCommuterConfig,
} from "../utils/commuterStorage";
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
  getManualEvents,
  isManualEventActiveOnDate,
  ManualClassEvent,
  manualEventToClassEvent,
  subscribeToManualEventsChanges,
} from "../utils/manualEvents";
import {
  ClassEvent,
  fetchAllCourseData,
  fetchScheduleData,
  ScheduleData,
} from "../utils/scraper";
import {
  cleanPlatform,
  clearTrenitaliaCache,
  enrichTrainFromCachedAndamento,
  evaluateTrainStatus,
  isSameStation,
  isTrainAndamentoFresh,
  minutesToTime,
  parseTimeToMinutes,
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
  theme: AppTheme;
  onPress?: () => void;
}

function LectureCard({ item, isSelected, theme, onPress }: LectureCardProps) {
  const cardStyle = [
    styles.classCard,
    isSelected && [
      styles.classCardSelected,
      {
        backgroundColor: theme.cardTint,
        borderColor: theme.primary,
        shadowColor: theme.primary,
      },
    ],
  ];

  const cardContent = (
    <>
      <View style={styles.classCardTopRow}>
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
        {isSelected && (
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
        )}
      </View>

      <Text
        style={[
          styles.classSubjectText,
          isSelected && styles.classSubjectTextSelected,
        ]}
        numberOfLines={2}
      >
        {item.subject}
      </Text>

      <View
        style={[
          styles.classRoomRow,
          isSelected && { borderTopColor: theme.border },
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
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        activeOpacity={0.82}
        onPress={onPress}
      >
        {cardContent}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{cardContent}</View>;
}

function getAutoTargetClass(
  classes: ClassEvent[],
  isToday: boolean,
  direction: "outbound" | "return",
  now: Date = new Date(),
  minTravelTimeToCampusMins?: number,
): ClassEvent | null {
  if (!classes || classes.length === 0) return null;

  // Se non è oggi (es. domani, dopodomani o giorni futuri):
  // All'andata seleziona sempre la prima lezione in programma del giorno; al ritorno l'ultima.
  if (!isToday) {
    return direction === "outbound" ? classes[0] : classes[classes.length - 1];
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (direction === "outbound") {
    // Stima minima di percorrenza casa -> aula (auto + treno + trasporto urbano)
    const minTravelMins = minTravelTimeToCampusMins ?? 50;

    // Seleziona la prima lezione che non sia ancora terminata e il cui orario di fine
    // sia sufficientemente nel futuro per permettere l'arrivo in aula prima del termine
    const reachableClass = classes.find(
      (c) => parseTimeToMinutes(c.endTime || "18:00") > nowMins + minTravelMins,
    );
    if (reachableClass) {
      return reachableClass;
    }

    // Se nessuna lezione ha abbastanza tempo residuo, seleziona l'eventuale lezione in corso o l'ultima
    const anyActive = classes.find(
      (c) => parseTimeToMinutes(c.endTime || "18:00") > nowMins,
    );
    return anyActive || classes[classes.length - 1];
  } else {
    // Ritorno:
    // Se c'è una lezione in corso o appena terminata prendi quella, altrimenti l'ultima del giorno
    const activeClass = classes.find((c) => {
      const s = parseTimeToMinutes(c.startTime || "08:30");
      const e = parseTimeToMinutes(c.endTime || "18:00");
      return s <= nowMins && e > nowMins;
    });
    const pastOrActive = [...classes]
      .reverse()
      .find((c) => parseTimeToMinutes(c.endTime || "18:00") <= nowMins + 30);
    return activeClass || pastOrActive || classes[classes.length - 1];
  }
}

export default function ViaggioScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [config, setConfig] = useState<CommuterConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [itinerary, setItinerary] = useState<CommuterItinerary | null>(null);
  const [direction, setDirection] = useState<"outbound" | "return">("outbound");
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    return new Date().getDay();
  });
  const [manualEvents, setManualEvents] = useState<ManualClassEvent[]>([]);
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(null);
  const activeDayIdxRef = useRef<number>(new Date().getDay());
  const activeClassIdxRef = useRef<number | null>(null);
  const directionRef = useRef<"outbound" | "return">("outbound");
  const configCacheRef = useRef<CommuterConfig | null>(null);
  const configMutationSeqRef = useRef<number>(0);
  const scheduleCacheRef = useRef<ScheduleData | null>(null);
  const manualsCacheRef = useRef<ManualClassEvent[] | null>(null);
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
  // Treno appena toccato nello slider: evidenziato subito mentre i dati reali si caricano
  const [pendingTrainNumber, setPendingTrainNumber] = useState<string | null>(
    null,
  );
  const pendingTrainRef = useRef<string | null>(null);
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string | null>(
    null,
  );
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());

  // Registro Manifestazioni, Scioperi e Interruzioni Viabilità
  const [disruptions, setDisruptions] = useState<DisruptionEvent[]>([]);
  const [disruptionsLoading, setDisruptionsLoading] = useState<boolean>(false);
  const [disruptionsModalVisible, setDisruptionsModalVisible] =
    useState<boolean>(false);
  const [disruptionsInitialFilter, setDisruptionsInitialFilter] = useState<
    "all" | "train" | "walk" | "transit"
  >("all");
  const [selectedDisruptionEventId, setSelectedDisruptionEventId] = useState<
    string | null
  >(null);

  const handleOpenDisruptionsModal = useCallback(
    (
      filter: "all" | "train" | "walk" | "transit" = "all",
      eventId?: string | null,
    ) => {
      setDisruptionsInitialFilter(filter);
      setSelectedDisruptionEventId(eventId || null);
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
  >({});
  const [itinerariesByDay, setItinerariesByDay] = useState<{
    [dayIdx: number]: CommuterItinerary | null;
  }>({});

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

  // Helper per combinare lezioni ufficiali e lezioni manuali (solo feriali e con aula specificata)
  const getDayClasses = useCallback(
    (
      jsDayIdx: number,
      sched: ScheduleData | null,
      manuals: ManualClassEvent[],
      tabUrl?: string | null,
    ) => {
      // Nel fine settimana non ci sono lezioni in Viaggio
      const isWeekendDay = jsDayIdx === 0 || jsDayIdx === 6;
      if (isWeekendDay) return [];

      const schedDayIdx = jsDayIdx - 1; // 1=LUN -> 0, ..., 5=VEN -> 4
      const scraped =
        sched?.days && sched.days[schedDayIdx]
          ? [...sched.days[schedDayIdx]]
          : [];
      const { dateStr } = getDateForDayIndex(schedDayIdx);
      const manualForDay = (manuals || [])
        .filter(
          (e) =>
            e.dayIndex === schedDayIdx &&
            Boolean(e.room && e.room.trim().length > 0) &&
            (!e.tabUrl || !tabUrl || e.tabUrl === tabUrl) &&
            isManualEventActiveOnDate(e, dateStr),
        )
        .map(manualEventToClassEvent);

      return [...scraped, ...manualForDay].sort(
        (a, b) =>
          parseTimeToMinutes(a.startTime || "08:30") -
          parseTimeToMinutes(b.startTime || "08:30"),
      );
    },
    [],
  );

  // Lezioni del giorno selezionato (ufficiali + manuali)
  const dayClasses = useMemo(() => {
    return getDayClasses(selectedDayIdx, schedule, manualEvents, defaultTabUrl);
  }, [selectedDayIdx, schedule, manualEvents, defaultTabUrl, getDayClasses]);

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

    const now = new Date();
    const isToday = now.getDay() === selectedDayIdx;
    const approxTimeToStation = config?.carLeg?.enabled
      ? (config.carLeg.durationMinutes || 24) +
        (config.carLeg.parkingBufferMinutes ?? 7)
      : 10;
    const approxMinTravel =
      approxTimeToStation + 40 + (config?.transitLeg?.durationMinutes || 20);

    return getAutoTargetClass(
      dayClasses,
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
  ]);

  const activeSelectedClassIndex = useMemo(() => {
    if (!activeSelectedClass || dayClasses.length === 0) return 0;
    const idx = dayClasses.findIndex(
      (c) =>
        c.subject === activeSelectedClass.subject &&
        c.startTime === activeSelectedClass.startTime,
    );
    return idx >= 0 ? idx : 0;
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

  const heroDelayMin = useMemo(() => {
    if (!isSelectedDayToday || !itinerary?.liveTrain) return 0;
    if (
      itinerary.liveTrain.isArrivedAtDestination ||
      itinerary.liveTrain.trainStatusType === "arrived" ||
      trainStatus?.badgeLabel === "Arrivato"
    ) {
      return 0;
    }
    const trainDelay = itinerary.liveTrain.delayMinutes ?? 0;
    if (trainDelay > 0) return trainDelay;
    if (trainStatus?.delayBadge) {
      const parsed = parseInt(
        trainStatus.delayBadge.label.replace(/\D/g, ""),
        10,
      );
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, [isSelectedDayToday, itinerary, trainStatus]);

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
        overrides?.direction !== undefined ? overrides.direction : direction;
      const effDayIdx =
        overrides?.selectedDayIdx !== undefined
          ? overrides.selectedDayIdx
          : selectedDayIdx;
      const effClassIdx =
        overrides?.selectedClassIndex !== undefined
          ? overrides.selectedClassIndex
          : selectedClassIndex;
      const effTrainOffset =
        overrides?.selectedTrainOffset !== undefined
          ? overrides.selectedTrainOffset
          : selectedTrainOffset;
      const effTrainNum =
        overrides?.selectedTrainNumber !== undefined
          ? overrides.selectedTrainNumber
          : selectedTrainNumber;

      const requestId = ++loadRequestIdRef.current;

      if (!silent) {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
      }

      if (isRefresh) {
        clearTrenitaliaCache();
      }

      try {
        let currentConfig: CommuterConfig;
        if (!isRefresh && configCacheRef.current) {
          currentConfig = configCacheRef.current;
        } else {
          currentConfig = await getCommuterConfig();
          configCacheRef.current = currentConfig;
        }
        if (requestId !== loadRequestIdRef.current) return;
        setConfig(currentConfig);

        if (currentConfig.enabled === false) {
          setItinerary(null);
          setLoading(false);
          setRefreshing(false);
          return;
        }

        // Carica lezioni manuali salvate
        let currentManuals: ManualClassEvent[] = [];
        try {
          if (!isRefresh && manualsCacheRef.current) {
            currentManuals = manualsCacheRef.current;
          } else {
            currentManuals = await getManualEvents();
            manualsCacheRef.current = currentManuals;
          }
          setManualEvents(currentManuals);
        } catch (err) {
          console.warn("Errore lettura manual events:", err);
        }

        // Carica i dati dell'orario reale dal corso selezionato
        let sched: ScheduleData | null = null;
        let defaultTab: string | null = null;
        try {
          if (!isRefresh && scheduleCacheRef.current) {
            sched = scheduleCacheRef.current;
          } else {
            const url = await AsyncStorage.getItem("selectedDegreeUrl");
            defaultTab = await AsyncStorage.getItem("defaultTabUrl");
            setDefaultTabUrl(defaultTab);
            if (url) {
              const courseData = await fetchAllCourseData(url);
              const activeTab =
                courseData.tabs.find((t) => t.url === defaultTab) ||
                courseData.tabs[0];
              if (activeTab) {
                // Indice per URL del tab (o per nome se fallback)
                sched =
                  courseData.schedules[activeTab.url] ||
                  courseData.schedules[activeTab.name] ||
                  null;

                if (!sched) {
                  sched = await fetchScheduleData(activeTab.url);
                }
              }
              scheduleCacheRef.current = sched;
            }
          }
        } catch (err) {
          console.warn("Errore lettura schedule corso:", err);
        }

        if (requestId !== loadRequestIdRef.current) return;
        setSchedule(sched);

        // Calcola data target in base al giorno selezionato
        const targetDate = new Date();
        const currentDay = targetDate.getDay();
        let diff = (effDayIdx - currentDay + 7) % 7;
        targetDate.setDate(targetDate.getDate() + diff);

        // Determina la lezione target per il calcolo (nessuna lezione nel weekend)
        const isEffWeekend = effDayIdx === 0 || effDayIdx === 6;
        const currentDayClasses = getDayClasses(
          effDayIdx,
          sched,
          currentManuals,
          defaultTab,
        );

        const now = new Date();
        const isToday = now.getDay() === effDayIdx;
        const nowMins = now.getHours() * 60 + now.getMinutes();

        let targetClassForCalculation: ClassEvent | null = null;
        const isExplicitClass =
          effClassIdx !== null && Boolean(currentDayClasses[effClassIdx]);

        if (!isEffWeekend && currentDayClasses.length > 0) {
          if (isExplicitClass) {
            targetClassForCalculation = currentDayClasses[effClassIdx!];
          } else {
            const approxTimeToStation = currentConfig?.carLeg?.enabled
              ? (currentConfig.carLeg.durationMinutes || 24) +
                (currentConfig.carLeg.parkingBufferMinutes ?? 7)
              : 10;
            const approxMinTravel =
              approxTimeToStation +
              40 +
              (currentConfig?.transitLeg?.durationMinutes || 20);

            targetClassForCalculation = getAutoTargetClass(
              currentDayClasses,
              isToday,
              effDir,
              now,
              approxMinTravel,
            );
          }
        }

        const lastClass =
          currentDayClasses.length > 0
            ? currentDayClasses[currentDayClasses.length - 1]
            : null;
        const isAllClassesFinished = Boolean(
          isToday &&
          !isEffWeekend &&
          lastClass &&
          nowMins >= parseTimeToMinutes(lastClass.endTime || "18:00"),
        );

        const isTargetClassFinished = Boolean(
          isToday &&
          !isEffWeekend &&
          targetClassForCalculation &&
          (isAllClassesFinished ||
            nowMins >=
              parseTimeToMinutes(targetClassForCalculation.endTime || "18:00")),
        );

        const isTargetClassInProgress = Boolean(
          isToday &&
          !isEffWeekend &&
          targetClassForCalculation &&
          nowMins >=
            parseTimeToMinutes(
              targetClassForCalculation.startTime || "08:30",
            ) &&
          nowMins <
            parseTimeToMinutes(targetClassForCalculation.endTime || "18:00"),
        );

        // Imposta l'orario del viaggio su targetDate per centrare la ricerca ViaggiaTreno
        if (
          targetClassForCalculation &&
          !isTargetClassFinished &&
          !(effDir === "outbound" && isTargetClassInProgress)
        ) {
          const timeToUse =
            effDir === "outbound"
              ? targetClassForCalculation.startTime || "08:30"
              : targetClassForCalculation.endTime || "16:00";
          const [hh, mm] = timeToUse.split(":").map(Number);
          targetDate.setHours(hh || 8, mm || 30, 0, 0);
        } else {
          if (isToday) {
            targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
          } else {
            targetDate.setHours(effDir === "outbound" ? 8 : 16, 30, 0, 0);
          }
        }

        const itin = await computeCommuterItinerary({
          config: currentConfig,
          scheduleData: sched,
          manualEvents: currentManuals,
          direction: effDir,
          targetDate,
          selectedClass: targetClassForCalculation,
          isExplicitClass,
          selectedTrainOffset: effTrainOffset,
          selectedTrainNumber: effTrainNum || undefined,
          forceRefresh: isRefresh,
        });

        if (requestId !== loadRequestIdRef.current) return;
        // Ignora il risultato se l'utente ha già switchato a un altro giorno
        if (effDayIdx !== activeDayIdxRef.current) return;

        const cacheKey = `${effDir}_${effDayIdx}_${effClassIdx ?? "auto"}`;
        itinerariesCacheRef.current[cacheKey] = itin;
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
    [
      direction,
      selectedDayIdx,
      selectedClassIndex,
      selectedTrainOffset,
      selectedTrainNumber,
      getDayClasses,
    ],
  );

  useEffect(() => {
    const unsub = subscribeToManualEventsChanges(() => {
      getManualEvents()
        .then((evts) => {
          setManualEvents(evts);
          loadData(true, true);
        })
        .catch(() => {});
    });
    return () => unsub();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      loadDisruptionsData();
      // Aggiornamento automatico sincronizzato di treni, ritardi e mezzi ogni minuto (60 secondi)
      const id = setInterval(() => {
        // Non interrompere il caricamento di un treno appena selezionato dall'utente
        if (pendingTrainRef.current) return;
        loadData(true, true);
      }, 60000);
      const appStateSub = AppState.addEventListener("change", (nextState) => {
        if (nextState === "active") {
          if (!pendingTrainRef.current) {
            loadData(true, true);
          }
          refreshAppleCalendarIfConfigured().catch(() => {});
        }
      });
      return () => {
        clearInterval(id);
        appStateSub.remove();
      };
    }, [loadData, loadDisruptionsData]),
  );

  const handleDayChange = useCallback(
    (dayIdx: number) => {
      activeDayIdxRef.current = dayIdx;
      activeClassIdxRef.current = null;
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

  const handleResetToToday = () => {
    const today = new Date().getDay();
    handleDayPress(today);
  };

  const handleDirectionChange = (newDir: "outbound" | "return") => {
    directionRef.current = newDir;
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
    } else if (!itinerary) {
      setLoading(true);
    }
    loadData(false, Boolean(cached || itinerary), {
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
          if (opts.precomputedItineraries?.[k]) {
            pendingCalPrecomputedRef.current[k] =
              opts.precomputedItineraries[k];
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

    const prevMap = prevPrefs?.preferredTrains || {};
    const nextMap = nextPrefs?.preferredTrains || {};
    const dirtyPrefKeys = new Set<string>();
    for (const k of Object.keys(prevMap)) {
      if (prevMap[k]?.departureTime !== nextMap[k]?.departureTime) {
        dirtyPrefKeys.add(k);
      }
    }
    for (const k of Object.keys(nextMap)) {
      if (prevMap[k]?.departureTime !== nextMap[k]?.departureTime) {
        dirtyPrefKeys.add(k);
      }
    }

    if (dirtyPrefKeys.size === 0) return;

    const affectedPrefixes = new Set<string>();
    const calSlotKeys: string[] = [];
    for (const k of dirtyPrefKeys) {
      const parts = k.split("_");
      const dir = parts[0];
      const dayNum = parseInt(parts[1] || "", 10);
      if (
        (dir === "outbound" || dir === "return") &&
        dayNum >= 1 &&
        dayNum <= 5
      ) {
        affectedPrefixes.add(`${dir}_${dayNum}_`);
        const slot = `${dayNum - 1}_${dir}`;
        if (!calSlotKeys.includes(slot)) calSlotKeys.push(slot);
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

    if (calSlotKeys.length > 0) {
      scheduleCoalescedCalendarRefresh({
        onlySlotKeys: calSlotKeys,
        clearSlotPrecomputed: calSlotKeys,
      });
    } else {
      scheduleCoalescedCalendarRefresh();
    }
  };

  const isCurrentTrainPreferred = Boolean(
    config &&
    itinerary?.liveTrain?.departureTimePlanned &&
    config.trainPreferences?.preferredTrains?.[
      getTrainPreferenceKey(direction, selectedDayIdx, itinerary.targetLecture)
    ]?.departureTime === itinerary.liveTrain.departureTimePlanned,
  );

  const handleTogglePreferredTrain = () => {
    const baseConfig = configCacheRef.current || config;
    if (!baseConfig || !itinerary?.liveTrain) return;
    const t = itinerary.liveTrain;
    const depTime = t.departureTimePlanned;
    if (!depTime) return;
    const key = getTrainPreferenceKey(
      direction,
      selectedDayIdx,
      itinerary.targetLecture,
    );
    const currentPrefs = baseConfig.trainPreferences?.preferredTrains || {};
    const isPref = currentPrefs[key]?.departureTime === depTime;
    const nextTrains = { ...currentPrefs };
    if (isPref) {
      delete nextTrains[key];
    } else {
      nextTrains[key] = {
        departureTime: depTime,
        arrivalTime: t.arrivalTimePlanned,
        label: `${t.category} ${t.trainNumber.replace(/\D/g, "")}`,
        subject: itinerary.targetLecture?.subject,
        room: itinerary.targetLecture?.room,
      };
    }

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

    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);

    const calSlotKey =
      selectedDayIdx >= 1 && selectedDayIdx <= 5
        ? `${selectedDayIdx - 1}_${direction}`
        : null;

    if (!isPref) {
      // Stella appena attivata sul treno già visualizzato: nessun ricalcolo né spinner in UI
      const currentCacheKey = `${direction}_${selectedDayIdx}_${activeClassIdxRef.current ?? "auto"}`;
      itinerariesCacheRef.current[currentCacheKey] = itinerary;
      itinerariesCacheRef.current[String(selectedDayIdx)] = itinerary;
      setItinerariesByDay((prev) => ({
        ...prev,
        [selectedDayIdx]: itinerary,
      }));

      const canPrecomputeForCal =
        Boolean(calSlotKey) && new Date().getDay() !== selectedDayIdx;
      scheduleCoalescedCalendarRefresh(
        calSlotKey
          ? {
              onlySlotKeys: [calSlotKey],
              precomputedItineraries: canPrecomputeForCal
                ? { [calSlotKey]: itinerary }
                : undefined,
              clearSlotPrecomputed: canPrecomputeForCal
                ? undefined
                : [calSlotKey],
            }
          : undefined,
      );
    } else {
      // Stella rimossa: aggiorna silenziosamente solo il giorno/direzione corrente riusando la cache GTFS
      loadData(false, true, {
        selectedTrainOffset: 0,
        selectedTrainNumber: null,
      });
      scheduleCoalescedCalendarRefresh(
        calSlotKey
          ? {
              onlySlotKeys: [calSlotKey],
              clearSlotPrecomputed: [calSlotKey],
            }
          : undefined,
      );
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
  // affinché corrisponda all'ultimo mezzo utile per arrivare a destinazione in tempo
  const handleOptimalTransitResolved = useCallback(
    (update: OptimalTransitTimingUpdate) => {
      setItinerary((prev) => {
        if (!prev) return prev;
        const transitIdx = prev.legs.findIndex((l) => l.type === "transit");
        if (transitIdx === -1) return prev;
        const currentLeg = prev.legs[transitIdx];
        const newTitle =
          update.directLines && update.directLines.length > 0
            ? `Linee ${update.directLines.join(" / ")}`
            : update.line
              ? `Linea ${update.line}`
              : currentLeg.title;

        if (
          currentLeg.startTime === update.startTime &&
          currentLeg.endTime === update.endTime &&
          currentLeg.durationMinutes === update.durationMinutes &&
          currentLeg.title === newTitle
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
        };

        // Se la tappa successiva è l'attesa in stazione (nel ritorno), riallinea il suo inizio all'arrivo del mezzo
        const nextLeg = updatedLegs[transitIdx + 1];
        let nextLectureTimeStatus = prev.lectureTimeStatus;

        if (
          nextLeg &&
          nextLeg.type === "wait" &&
          nextLeg.id === "station-wait-leg"
        ) {
          const waitStartM = parseTimeToMinutes(update.endTime);
          const waitEndM = parseTimeToMinutes(nextLeg.endTime);
          const newWaitDur = Math.max(0, waitEndM - waitStartM);
          updatedLegs[transitIdx + 1] = {
            ...nextLeg,
            startTime: update.endTime,
            durationMinutes: newWaitDur,
          };
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
          const isLectureFinished = lectureEndM > 0 && classArrM >= lectureEndM;

          const existingLectureIdx = updatedLegs.findIndex(
            (l) => l.id === "lecture-leg",
          );

          if (isLectureFinished) {
            if (existingLectureIdx !== -1) {
              updatedLegs.splice(existingLectureIdx, 1);
            }
            nextLectureTimeStatus = undefined;
          } else if (classArrM > lectureStartM && classArrM < lectureEndM) {
            const remainingMins = Math.max(1, lectureEndM - classArrM);
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
            const spareTime = lectureStartM - classArrM;
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
          // Nel ritorno, se la prima tappa è il mezzo urbano, la partenza coincide con l'ultimo mezzo utile
          newDepTime = update.startTime;
        } else if (
          updatedLegs[0]?.id === "leave-lecture-leg" &&
          prev.targetLecture?.endTime
        ) {
          const lecStartM = parseTimeToMinutes(
            prev.targetLecture.startTime || "08:30",
          );
          const lecEndM = parseTimeToMinutes(prev.targetLecture.endTime);
          const leaveM = Math.max(
            lecStartM,
            parseTimeToMinutes(update.startTime) - 7,
          );
          if (leaveM < lecEndM) {
            const lostMins = Math.max(1, lecEndM - leaveM);
            const lostBadge = `${formatDuration(lostMins)} persi`;
            nextLectureTimeStatus = {
              type: "early_departure",
              minutes: lostMins,
              badgeText: lostBadge,
            };
            updatedLegs[0] = {
              ...updatedLegs[0],
              startTime: minutesToTime(leaveM),
              endTime: update.startTime,
              durationMinutes: Math.max(
                1,
                parseTimeToMinutes(update.startTime) - leaveM,
              ),
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
              startTime: prev.targetLecture.endTime,
              endTime: minutesToTime(lecEndM + 7),
              durationMinutes: 7,
              details: undefined,
            };
            newDepTime = prev.targetLecture.endTime;
          }
        }

        const depM = parseTimeToMinutes(newDepTime);
        const arrM = parseTimeToMinutes(newArrTime);
        const newTotalDur =
          arrM >= depM ? arrM - depM : prev.totalDurationMinutes;

        const nextItin: CommuterItinerary = {
          ...prev,
          departureTime: newDepTime,
          arrivalTime: newArrTime,
          totalDurationMinutes: newTotalDur,
          lectureTimeStatus: nextLectureTimeStatus,
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
        setItinerariesByDay((prevMap) =>
          prevMap[dayIdx] ? { ...prevMap, [dayIdx]: nextItin } : prevMap,
        );

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

  const renderEmptyItinerary = () => (
    <View
      style={[
        styles.heroCard,
        {
          backgroundColor: theme.cardTint,
          borderColor: theme.border,
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
          ) : pageClasses.length === 0 ? (
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
              const previewTarget = getAutoTargetClass(
                pageClasses,
                isPageToday,
                direction,
                new Date(),
              );
              const previewTargetIndex = previewTarget
                ? pageClasses.findIndex(
                    (c) =>
                      c.subject === previewTarget.subject &&
                      c.startTime === previewTarget.startTime,
                  )
                : 0;
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
                    const isSelected = previewTarget
                      ? item.subject === previewTarget.subject &&
                        item.startTime === previewTarget.startTime
                      : idx === 0;

                    return (
                      <LectureCard
                        key={`${item.subject}-${item.startTime}-${idx}`}
                        item={item}
                        isSelected={isSelected}
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
                <TouchableOpacity
                  style={styles.headerIconBtn}
                  activeOpacity={0.7}
                  disabled={refreshing}
                  onPress={() => loadData(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Aggiorna orari treni"
                >
                  {isNativeIos && CallstackLiquidGlass?.LiquidGlassView ? (
                    <CallstackLiquidGlass.LiquidGlassView
                      effect="regular"
                      colorScheme="dark"
                      tintColor="rgba(255, 255, 255, 0.12)"
                      style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                    />
                  ) : null}
                  {refreshing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="refresh" size={19} color="#fff" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.headerIconBtn, { marginLeft: 8 }]}
                  activeOpacity={0.7}
                  onPress={() =>
                    handleOpenDisruptionsModal(
                      "all",
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
                      tintColor="rgba(255, 255, 255, 0.12)"
                      style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
                    />
                  ) : null}
                  <Ionicons
                    name="megaphone-outline"
                    size={18}
                    color={
                      currentTrainDisruptions.length > 0 ||
                      currentWalkDisruptions.length > 0
                        ? "#f59e0b"
                        : "#fff"
                    }
                  />
                  {(currentTrainDisruptions.length > 0 ||
                    currentWalkDisruptions.length > 0) && (
                    <View style={styles.headerAlertDot} />
                  )}
                </TouchableOpacity>
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
                                const isSelected = activeSelectedClass
                                  ? item.subject ===
                                      activeSelectedClass.subject &&
                                    item.startTime ===
                                      activeSelectedClass.startTime
                                  : idx === 0;

                                return (
                                  <LectureCard
                                    key={`${item.subject}-${item.startTime}-${idx}`}
                                    item={item}
                                    isSelected={isSelected}
                                    theme={theme}
                                    onPress={() => handleSelectClass(idx)}
                                  />
                                );
                              })}
                            </ScrollView>
                          )}
                        </View>

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
                                  borderColor: theme.border,
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
                                      itinerary.totalDurationMinutes,
                                    )}
                                  </Text>
                                </View>

                                {isSelectedDayToday && heroDelayMin > 0 && (
                                  <View
                                    style={[
                                      styles.heroDelayPill,
                                      {
                                        backgroundColor:
                                          heroDelayMin > 5
                                            ? "rgba(239, 68, 68, 0.16)"
                                            : "rgba(245, 158, 11, 0.16)",
                                        borderColor:
                                          heroDelayMin > 5
                                            ? "rgba(239, 68, 68, 0.35)"
                                            : "rgba(245, 158, 11, 0.35)",
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name="time-outline"
                                      size={11}
                                      color={
                                        heroDelayMin > 5 ? "#ef4444" : "#f59e0b"
                                      }
                                      style={{ marginRight: 3 }}
                                    />
                                    <Text
                                      style={[
                                        styles.heroDelayPillText,
                                        {
                                          color:
                                            heroDelayMin > 5
                                              ? "#ef4444"
                                              : "#f59e0b",
                                        },
                                      ]}
                                    >
                                      {`+${heroDelayMin}m ritardo`}
                                    </Text>
                                  </View>
                                )}
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

                              <View
                                style={[
                                  styles.heroTargetLectureBox,
                                  {
                                    backgroundColor: theme.subtle,
                                    borderColor: theme.border,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={
                                    isWeekend
                                      ? "train-outline"
                                      : isTargetLectureFinished
                                        ? "checkmark-circle-outline"
                                        : direction === "outbound"
                                          ? "flag"
                                          : "home"
                                  }
                                  size={16}
                                  color={
                                    isWeekend
                                      ? theme.primary
                                      : isTargetLectureFinished
                                        ? "#10b981"
                                        : theme.accent
                                  }
                                  style={{ marginRight: 8 }}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={styles.heroLectureSubject}
                                    numberOfLines={1}
                                  >
                                    {isWeekend
                                      ? direction === "outbound"
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
                                          : `Rientro ad ${config?.originAddress}`}
                                  </Text>
                                  <Text
                                    style={styles.heroLectureDetails}
                                    numberOfLines={1}
                                  >
                                    {isWeekend
                                      ? "Fine settimana • Nessuna lezione collegata"
                                      : isTargetLectureFinished
                                        ? "Terminata • Treni da adesso"
                                        : direction === "outbound"
                                          ? itinerary.lectureTimeStatus
                                              ?.type === "late_arrival"
                                            ? `${itinerary.targetLecture?.room} • In corso (${itinerary.lectureTimeStatus.badgeText})`
                                            : `${itinerary.targetLecture?.room} • Inizio ore ${itinerary.targetLecture?.startTime}`
                                          : `Fine lezioni ore ${itinerary.targetLecture?.endTime}`}
                                  </Text>
                                </View>
                              </View>
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
                                        currentTrainDisruptions[0]?.id,
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

                                {/* Consiglio Rientro Anticipato (solo Ritorno, quando conviene nettamente) */}
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
                                          numberOfLines={2}
                                        >
                                          {itinerary.smartReturnRecommendation
                                            .isCurrentlySelected
                                            ? `Esci ${itinerary.smartReturnRecommendation.lostLectureMinutes} min prima per tornare a casa ${itinerary.smartReturnRecommendation.savedArrivalMinutes} min prima (${itinerary.smartReturnRecommendation.smartHomeArrivalTime} vs ${itinerary.smartReturnRecommendation.standardHomeArrivalTime})`
                                            : `Esci ${itinerary.smartReturnRecommendation.lostLectureMinutes} min prima dalla lezione per tornare a casa alle ${itinerary.smartReturnRecommendation.smartHomeArrivalTime} (${itinerary.smartReturnRecommendation.savedArrivalMinutes} min prima di ${itinerary.smartReturnRecommendation.standardTrainNumber})`}
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
                                              : undefined;
                                          const isSmartRecommended = Boolean(
                                            smartRec &&
                                            at.trainNumber.replace(/\D/g, "") ===
                                              smartRec.trainNumber.replace(
                                                /\D/g,
                                                "",
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
                                                isSmartRecommended &&
                                                  !isCurrent && {
                                                    borderColor:
                                                      "rgba(245, 158, 11, 0.55)",
                                                    backgroundColor:
                                                      "rgba(245, 158, 11, 0.12)",
                                                  },
                                                isStoppedRegular &&
                                                  !isCurrent && {
                                                    borderColor:
                                                      "rgba(56, 189, 248, 0.45)",
                                                    backgroundColor:
                                                      "rgba(56, 189, 248, 0.1)",
                                                  },
                                                isStoppedLate &&
                                                  !isCurrent && {
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
                                                  isSmartRecommended &&
                                                    !isCurrent && {
                                                      color: "#fcd34d",
                                                    },
                                                  isStoppedRegular &&
                                                    !isCurrent && {
                                                      color: "#38bdf8",
                                                    },
                                                  isStoppedLate &&
                                                    !isCurrent && {
                                                      color: "#f59e0b",
                                                    },
                                                ]}
                                                numberOfLines={1}
                                              >
                                                {at.trainNumber} •{" "}
                                                {at.departureTimePlanned}
                                              </Text>
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
                                                      {`-${smartRec.savedArrivalMinutes}m`}
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

                                return (
                                  <View
                                    key={leg.id}
                                    style={styles.timelineStepRow}
                                  >
                                    {/* Colonna Orario */}
                                    <View style={styles.timeColumn}>
                                      <Text style={styles.timeStartText}>
                                        {leg.startTime}
                                      </Text>
                                      <Text style={styles.timeEndText}>
                                        {leg.endTime}
                                      </Text>
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
                                        <View style={styles.connectingLine} />
                                      )}
                                    </View>

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
                                                  {formatDuration(
                                                    leg.durationMinutes,
                                                  )}
                                                </Text>
                                              </View>
                                            </View>

                                            <Text
                                              style={styles.stepSubtitleText}
                                            >
                                              {leg.subtitle}
                                            </Text>
                                          </TouchableOpacity>

                                          {/* Segnalazione manifestazioni o blocchi viabilità che impattano il percorso (a piedi o con mezzi) */}
                                          {isTransitOrWalk &&
                                            currentWalkDisruptions.length > 0 &&
                                            (() => {
                                              const activeDisruption =
                                                currentWalkDisruptions[0];
                                              const timeInfo =
                                                parseDisruptionTime(
                                                  activeDisruption,
                                                );

                                              // Rimuove suffissi di data ridondanti per una lettura immediata a colpo d'occhio
                                              const cleanTitle =
                                                activeDisruption.title
                                                  .replace(
                                                    /,\s*(?:lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s+\d+.*$/i,
                                                    "",
                                                  )
                                                  .trim();

                                              let disruptionDesc = cleanTitle;
                                              if (timeInfo.hasTimeWindow) {
                                                const hoursStr =
                                                  timeInfo.endHour !== undefined
                                                    ? `${timeInfo.startHour.toString().padStart(2, "0")}:${timeInfo.startMinute.toString().padStart(2, "0")} - ${timeInfo.endHour.toString().padStart(2, "0")}:${timeInfo.endMinute!.toString().padStart(2, "0")}`
                                                    : `dalle ${timeInfo.startHour.toString().padStart(2, "0")}:${timeInfo.startMinute.toString().padStart(2, "0")}`;
                                                disruptionDesc = `${cleanTitle} (${hoursStr})`;
                                              } else if (
                                                activeDisruption.timeWindow
                                              ) {
                                                disruptionDesc = `${cleanTitle} (${activeDisruption.timeWindow})`;
                                              }

                                              const bannerColor = "#f59e0b";
                                              const bannerBg =
                                                "rgba(245, 158, 11, 0.10)";
                                              const bannerBorder =
                                                "rgba(245, 158, 11, 0.28)";

                                              return (
                                                <TouchableOpacity
                                                  activeOpacity={0.85}
                                                  onPress={() => {
                                                    handleOpenDisruptionsModal(
                                                      leg.type === "transit"
                                                        ? "transit"
                                                        : "walk",
                                                      activeDisruption.id,
                                                    );
                                                  }}
                                                  style={[
                                                    styles.walkDisruptionAlertBanner,
                                                    {
                                                      backgroundColor: bannerBg,
                                                      borderColor: bannerBorder,
                                                    },
                                                  ]}
                                                >
                                                  <View
                                                    style={
                                                      styles.walkDisruptionAlertHeader
                                                    }
                                                  >
                                                    <Ionicons
                                                      name="warning"
                                                      size={13}
                                                      color={bannerColor}
                                                      style={{ marginRight: 5 }}
                                                    />
                                                    <Text
                                                      style={[
                                                        styles.walkDisruptionAlertTitle,
                                                        { color: bannerColor },
                                                      ]}
                                                    >
                                                      Attenzione sul tuo
                                                      tragitto
                                                    </Text>
                                                  </View>
                                                  <Text
                                                    style={
                                                      styles.walkDisruptionAlertDesc
                                                    }
                                                    numberOfLines={3}
                                                  >
                                                    {disruptionDesc}
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
                                              const anchorTimeStr =
                                                leg.details?.targetTime ||
                                                leg.startTime;

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

                                              // Se una lezione è in corso o conclusa, la card dei mezzi deve mostrare le linee "programmate"
                                              // per quell'orario precedente, selezionando la corsa consigliata (primi mezzi utili)
                                              const isTransitLiveContext =
                                                Boolean(isSelectedDayToday) &&
                                                !isLectureActiveOrFinished;

                                              const constraintTimeForTransit =
                                                direction === "return"
                                                  ? isSelectedDayToday
                                                    ? liveTr?.departureTimePlanned ||
                                                      liveTr?.departureTimeActual
                                                    : liveTr?.departureTimePlanned
                                                  : itinerary.targetLecture
                                                      ?.startTime;

                                              const minDepTimeForTransit =
                                                direction === "outbound"
                                                  ? isSelectedDayToday
                                                    ? liveTr?.arrivalTimeActual ||
                                                      liveTr?.arrivalTimePlanned
                                                    : liveTr?.arrivalTimePlanned
                                                  : itinerary.targetLecture
                                                      ?.endTime;

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
                                                    itinerary.transitLiveContext ??
                                                    isTransitLiveContext
                                                  }
                                                  constraintTime={
                                                    itinerary.transitConstraintTime ??
                                                    constraintTimeForTransit
                                                  }
                                                  minDepartureTime={
                                                    itinerary.transitMinDepartureTime ??
                                                    minDepTimeForTransit
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
                                            leg.type !== "walk" && (
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
          }}
          disruptions={disruptions}
          loading={disruptionsLoading}
          onRefresh={() => loadDisruptionsData(true)}
          theme={theme}
          initialFilter={disruptionsInitialFilter}
          activeStationName={commuterStationName}
          highlightEventId={selectedDisruptionEventId}
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
  classSubjectText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#e2e8f0",
    lineHeight: 16,
    minHeight: 32,
    letterSpacing: -0.2,
  },
  classSubjectTextSelected: {
    color: "#ffffff",
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
    backgroundColor: "rgba(130, 36, 51, 0.15)",
    borderRadius: CARD_RADIUS.cardInner,
    padding: 10,
    marginTop: 0,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.3)",
  },
  heroLectureSubject: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  heroLectureDetails: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
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
    width: 48,
    alignItems: "flex-end",
    paddingRight: 8,
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
    marginBottom: 3,
  },
  stepTitleText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    flex: 1,
    marginRight: 8,
    lineHeight: 19,
  },
  durationBadgeContainer: {
    paddingTop: 1,
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
  headerAlertDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#f59e0b",
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
});
