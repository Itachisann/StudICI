import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  LayoutChangeEvent,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useTheme } from "@/context/ThemeContext";
import { UNIFORM_SCREEN_BG } from "@/constants/theme";
import { CommuterConfigModal } from "../components/CommuterConfigModal";
import { NativeActionButton } from "../components/NativeActionButton";
import { CommuterConfig, CommuterItinerary, TripLeg } from "../types/commuter";
import { computeCommuterItinerary } from "../utils/commuterOptimizer";
import {
  getCommuterConfig,
  saveCommuterConfig,
} from "../utils/commuterStorage";
import {
  ClassEvent,
  fetchAllCourseData,
  fetchScheduleData,
  ScheduleData,
} from "../utils/scraper";
import {
  cleanPlatform,
  clearTrenitaliaCache,
  evaluateTrainStatus,
  formatStationName,
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
  const [selectedClassIndex, setSelectedClassIndex] = useState<number | null>(
    null,
  );
  const [selectedTrainOffset, setSelectedTrainOffset] = useState<number>(0);
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string | null>(
    null,
  );
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(new Date());

  const todayDayIdx = useMemo(() => new Date().getDay(), []);

  const currentWeekdayIndex = useMemo(() => {
    const idx = WEEKDAYS.findIndex((w) => w.dayIdx === selectedDayIdx);
    return idx >= 0 ? idx : 0;
  }, [selectedDayIdx]);

  const currentWeekday = WEEKDAYS[currentWeekdayIndex];

  // Transizione fluida da giorno a giorno (identica a quella della sezione Orari)
  const prevWeekdayIndexRef = useRef(currentWeekdayIndex);
  const [daySlideAnim] = useState(() => new Animated.Value(0));
  const [dayFadeAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (prevWeekdayIndexRef.current === currentWeekdayIndex) return;
    const isForward = currentWeekdayIndex > prevWeekdayIndexRef.current;
    prevWeekdayIndexRef.current = currentWeekdayIndex;

    dayFadeAnim.setValue(0.25);
    daySlideAnim.setValue(isForward ? 16 : -16);

    Animated.parallel([
      Animated.timing(dayFadeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(daySlideAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentWeekdayIndex, dayFadeAnim, daySlideAnim]);

  // Animazione fluida a scorrimento dello slider dei giorni della settimana
  const segmentLayouts = useRef<{ [key: number]: { x: number; width: number } }>({});
  const [sliderPillAnim] = useState(() => new Animated.Value(0));
  const [sliderWidthAnim] = useState(() => new Animated.Value(44));
  const [sliderReady, setSliderReady] = useState(false);
  const initialSliderPositioned = useRef(false);

  const handleSegmentLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      const actualX = idx === 5 ? x + 4 : x;
      const actualWidth = idx === 5 ? width - 4 : width;
      segmentLayouts.current[idx] = { x: actualX, width: actualWidth };

      if (idx === currentWeekdayIndex && !initialSliderPositioned.current) {
        sliderPillAnim.setValue(actualX);
        sliderWidthAnim.setValue(actualWidth);
        initialSliderPositioned.current = true;
        setSliderReady(true);
      }
    },
    [currentWeekdayIndex, sliderPillAnim, sliderWidthAnim],
  );

  useEffect(() => {
    const target = segmentLayouts.current[currentWeekdayIndex];
    if (target && initialSliderPositioned.current) {
      Animated.parallel([
        Animated.spring(sliderPillAnim, {
          toValue: target.x,
          damping: 24,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: false,
        }),
        Animated.spring(sliderWidthAnim, {
          toValue: target.width,
          damping: 24,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [currentWeekdayIndex, sliderPillAnim, sliderWidthAnim]);

  const trainChipsScrollRef = useRef<ScrollView>(null);
  const trainScrollWidthRef = useRef<number>(0);
  const chipLayoutsRef = useRef<{
    [key: string]: { x: number; width: number };
  }>({});

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
  const commuterStationName =
    direction === "outbound"
      ? config?.departureStation.shortName || config?.departureStation.name
      : config?.arrivalStation.shortName || config?.arrivalStation.name;

  const isWeekend = selectedDayIdx === 0 || selectedDayIdx === 6;
  const isSelectedDayToday = useMemo(() => {
    return new Date().getDay() === selectedDayIdx;
  }, [selectedDayIdx]);

  const trainStatus = useMemo<TrainStatusResult | null>(() => {
    if (!liveTrain) return null;
    if (!isSelectedDayToday) {
      return {
        statusType: 'scheduled' as const,
        badgeLabel: 'Programmato',
        badgeColor: '#94a3b8',
        badgeBg: 'rgba(148, 163, 184, 0.12)',
        badgeBorder: 'rgba(148, 163, 184, 0.25)',
        iconName: 'calendar-outline',
      };
    }
    const targetDate = new Date();
    const res = evaluateTrainStatus(liveTrain, targetDate, commuterStationName);
    if (res.badgeLabel === 'Programmato') {
      return {
        ...res,
        badgeColor: '#94a3b8',
        badgeBg: 'rgba(148, 163, 184, 0.12)',
        badgeBorder: 'rgba(148, 163, 184, 0.25)',
      };
    }
    return res;
  }, [liveTrain, isSelectedDayToday, commuterStationName]);

  // Lezioni del giorno selezionato (non presenti nel weekend)
  const dayClasses = useMemo(() => {
    if (isWeekend) return [];
    const dayScheduleIndex = selectedDayIdx - 1;
    if (!schedule?.days || !schedule.days[dayScheduleIndex]) return [];
    return [...schedule.days[dayScheduleIndex]].sort(
      (a, b) =>
        parseTimeToMinutes(a.startTime || "08:30") -
        parseTimeToMinutes(b.startTime || "08:30"),
    );
  }, [schedule, selectedDayIdx, isWeekend]);

  // Lezione attualmente selezionata per il viaggio
  const activeSelectedClass = useMemo(() => {
    if (dayClasses.length === 0) return null;
    if (selectedClassIndex !== null && dayClasses[selectedClassIndex]) {
      return dayClasses[selectedClassIndex];
    }

    const now = new Date();
    const isToday = now.getDay() === selectedDayIdx;

    if (isToday) {
      const nowMins = now.getHours() * 60 + now.getMinutes();
      if (direction === "outbound") {
        const upcoming = dayClasses.find(
          (c) => parseTimeToMinutes(c.startTime || "08:30") >= nowMins - 15,
        );
        return upcoming || dayClasses[0];
      } else {
        const pastOrActive = [...dayClasses]
          .reverse()
          .find(
            (c) => parseTimeToMinutes(c.endTime || "18:00") <= nowMins + 30,
          );
        return pastOrActive || dayClasses[dayClasses.length - 1];
      }
    }

    return direction === "outbound"
      ? dayClasses[0]
      : dayClasses[dayClasses.length - 1];
  }, [dayClasses, selectedClassIndex, selectedDayIdx, direction]);

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

      if (!silent) {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
      }

      if (isRefresh) {
        clearTrenitaliaCache();
      }

      try {
        const currentConfig = await getCommuterConfig();
        setConfig(currentConfig);

        if (currentConfig.enabled === false) {
          setItinerary(null);
          setLoading(false);
          setRefreshing(false);
          return;
        }

        // Carica i dati dell'orario reale dal corso selezionato
        let sched: ScheduleData | null = null;
        try {
          const url = await AsyncStorage.getItem("selectedDegreeUrl");
          const defaultTab = await AsyncStorage.getItem("defaultTabUrl");
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
          }
        } catch (err) {
          console.warn("Errore lettura schedule corso:", err);
        }

        setSchedule(sched);

        // Calcola data target in base al giorno selezionato
        const targetDate = new Date();
        const currentDay = targetDate.getDay();
        let diff = (effDayIdx - currentDay + 7) % 7;
        targetDate.setDate(targetDate.getDate() + diff);

        // Determina la lezione target per il calcolo (nessuna lezione nel weekend)
        const isEffWeekend = effDayIdx === 0 || effDayIdx === 6;
        const dayScheduleIndex = effDayIdx - 1;
        const currentDayClasses =
          !isEffWeekend && sched?.days && sched.days[dayScheduleIndex]
            ? [...sched.days[dayScheduleIndex]].sort(
                (a, b) =>
                  parseTimeToMinutes(a.startTime || "08:30") -
                  parseTimeToMinutes(b.startTime || "08:30"),
              )
            : [];

        const now = new Date();
        const isToday = now.getDay() === effDayIdx;
        const nowMins = now.getHours() * 60 + now.getMinutes();

        let targetClassForCalculation: ClassEvent | null = null;
        if (!isEffWeekend) {
          if (effClassIdx !== null && currentDayClasses[effClassIdx]) {
            targetClassForCalculation = currentDayClasses[effClassIdx];
          } else if (currentDayClasses.length > 0) {
            if (isToday) {
              if (effDir === "outbound") {
                const upcoming = currentDayClasses.find(
                  (c) =>
                    parseTimeToMinutes(c.startTime || "08:30") >= nowMins - 15,
                );
                targetClassForCalculation = upcoming || currentDayClasses[0];
              } else {
                const pastOrActive = [...currentDayClasses]
                  .reverse()
                  .find(
                    (c) =>
                      parseTimeToMinutes(c.endTime || "18:00") <= nowMins + 30,
                  );
                targetClassForCalculation =
                  pastOrActive ||
                  currentDayClasses[currentDayClasses.length - 1];
              }
            } else {
              targetClassForCalculation =
                effDir === "outbound"
                  ? currentDayClasses[0]
                  : currentDayClasses[currentDayClasses.length - 1];
            }
          }
        }

        const isTargetClassFinished = Boolean(
          isToday &&
          !isEffWeekend &&
          targetClassForCalculation &&
          (effDir === "outbound"
            ? nowMins >
              parseTimeToMinutes(targetClassForCalculation.startTime || "08:30")
            : nowMins >
              parseTimeToMinutes(targetClassForCalculation.endTime || "18:00")),
        );

        // Imposta l'orario del viaggio su targetDate per centrare la ricerca ViaggiaTreno
        if (targetClassForCalculation && !isTargetClassFinished) {
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
          direction: effDir,
          targetDate,
          selectedClass: targetClassForCalculation,
          selectedTrainOffset: effTrainOffset,
          selectedTrainNumber: effTrainNum || undefined,
          forceRefresh: isRefresh,
        });

        setItinerary(itin);
        setLastUpdated(new Date());
      } catch (err: any) {
        console.warn("Errore calcolo itinerario pendolare", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      direction,
      selectedDayIdx,
      selectedClassIndex,
      selectedTrainOffset,
      selectedTrainNumber,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Aggiornamento automatico silenzioso di treni, ritardi e stato ogni 60 secondi
      const id = setInterval(() => {
        loadData(true, true);
      }, 60000);
      return () => clearInterval(id);
    }, [loadData]),
  );

  const handleDayChange = (dayIdx: number) => {
    setSelectedDayIdx(dayIdx);
    setSelectedClassIndex(null);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
    setItinerary(null);
    loadData(false, false, {
      selectedDayIdx: dayIdx,
      selectedClassIndex: null,
      selectedTrainOffset: 0,
      selectedTrainNumber: null,
    });
  };

  const handleResetToToday = () => {
    handleDayChange(new Date().getDay());
  };

  const handleDirectionChange = (newDir: "outbound" | "return") => {
    setDirection(newDir);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
    setItinerary(null);
    loadData(false, false, {
      direction: newDir,
      selectedTrainOffset: 0,
      selectedTrainNumber: null,
    });
  };

  const handleSelectClass = (idx: number) => {
    setSelectedClassIndex(idx);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
    loadData(false, false, {
      selectedClassIndex: idx,
      selectedTrainOffset: 0,
      selectedTrainNumber: null,
    });
  };

  const handleTrainPrev = () => {
    const nextOffset = selectedTrainOffset - 1;
    setSelectedTrainOffset(nextOffset);
    setSelectedTrainNumber(null);
    loadData(false, false, {
      selectedTrainOffset: nextOffset,
      selectedTrainNumber: null,
    });
  };

  const handleTrainNext = () => {
    const nextOffset = selectedTrainOffset + 1;
    setSelectedTrainOffset(nextOffset);
    setSelectedTrainNumber(null);
    loadData(false, false, {
      selectedTrainOffset: nextOffset,
      selectedTrainNumber: null,
    });
  };

  const handleSelectTrainChip = (trainNum: string) => {
    setSelectedTrainNumber(trainNum);
    setSelectedTrainOffset(0);
    loadData(false, false, {
      selectedTrainNumber: trainNum,
      selectedTrainOffset: 0,
    });
  };

  const handleSaveConfig = async (newConfig: CommuterConfig) => {
    const saved = await saveCommuterConfig({ ...newConfig, enabled: true });
    setConfig(saved);
    loadData();
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
    const dest = leg.details?.mapQuery;
    if (!dest) {
      Alert.alert(
        "Navigazione",
        "Nessuna destinazione specifica per questa tratta.",
      );
      return;
    }

    if (leg.type === "transit") {
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

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [
              "Annulla",
              "Dalla posizione attuale (GPS)",
              originStationLabel,
            ],
            cancelButtonIndex: 0,
            title: "Cerca mezzi su Google Maps",
            message: "Scegli il punto di partenza desiderato:",
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              openGoogleMapsRoute(undefined, dest, "transit");
            } else if (buttonIndex === 2) {
              openGoogleMapsRoute(presetOrigin, dest, "transit");
            }
          },
        );
      } else {
        Alert.alert(
          "Cerca mezzi su Google Maps",
          "Scegli il punto di partenza desiderato:",
          [
            { text: "Annulla", style: "cancel" },
            {
              text: "Posizione GPS",
              onPress: () => openGoogleMapsRoute(undefined, dest, "transit"),
            },
            {
              text: originStationLabel,
              onPress: () => openGoogleMapsRoute(presetOrigin, dest, "transit"),
            },
          ],
        );
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
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="refresh" size={19} color="#fff" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.headerIconBtn, { marginLeft: 8 }]}
                  activeOpacity={0.7}
                  onPress={() => setConfigModalVisible(true)}
                >
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
                    key={`seg-viaggio-${directionIndex}-${theme.primary}`}
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
                  {sliderReady && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.slidingActivePill,
                        {
                          left: sliderPillAnim,
                          width: sliderWidthAnim,
                          backgroundColor: isWeekend
                            ? "rgba(245, 158, 11, 0.22)"
                            : theme.bg,
                          borderColor: isWeekend ? "#f59e0b" : theme.primary,
                          shadowColor: isWeekend ? "#f59e0b" : theme.primary,
                        },
                      ]}
                    />
                  )}

                  {WEEKDAYS.map((w, idx) => {
                    const isSelected = selectedDayIdx === w.dayIdx;
                    const isItemToday = todayDayIdx === w.dayIdx;
                    const isItemWeekend = Boolean(w.isWeekend);

                    return (
                      <View
                        key={w.dayIdx}
                        onLayout={(e) => handleSegmentLayout(idx, e)}
                        style={[
                          styles.daySegmentWrapper,
                          idx === 5 && styles.daySegmentWrapperWithDivider,
                        ]}
                      >
                        {idx === 5 && <View style={styles.dayWeekendDivider} />}
                        <TouchableOpacity
                          onPress={() => handleDayChange(w.dayIdx)}
                          activeOpacity={0.7}
                          style={styles.daySegmentItem}
                        >
                          <Text
                            style={[
                              styles.daySegmentLabel,
                              isItemWeekend &&
                                !isSelected &&
                                styles.daySegmentLabelWeekend,
                              isSelected && styles.daySegmentLabelActive,
                            ]}
                          >
                            {w.label}
                          </Text>

                          {isItemToday && (
                            <View
                              style={[
                                styles.daySegmentDot,
                                isSelected
                                  ? styles.daySegmentDotActive
                                  : { backgroundColor: theme.primary },
                              ]}
                            />
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
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
            style={styles.scrollBody}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + 90 },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadData(true)}
                tintColor={theme.primary}
                colors={[theme.primary]}
              />
            }
          >
            {/* Contenuto Viaggio con Transizione Animata da Giorno a Giorno */}
            <Animated.View
              style={{
                opacity: dayFadeAnim,
                transform: [{ translateX: daySlideAnim }],
              }}
            >
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
                    name={isWeekend ? "sunny-outline" : "school-outline"}
                    size={13}
                    color={theme.accent}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.sectionTitle, { color: theme.accent }]}>
                    {isWeekend
                      ? `FINE SETTIMANA • ${currentWeekday.fullLabel.toUpperCase()}`
                      : `${currentWeekday.fullLabel.toUpperCase()} • ${
                          isSelectedDayToday
                            ? "LEZIONI DI OGGI"
                            : "PROGRAMMATO"
                        }`}
                  </Text>
                </View>

                {!isSelectedDayToday && (
                  <TouchableOpacity
                    onPress={handleResetToToday}
                    style={[
                      styles.jumpToTodayPill,
                      { borderColor: `${theme.primary}50` },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="arrow-undo-outline"
                      size={11}
                      color={theme.primary}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[
                        styles.jumpToTodayText,
                        { color: theme.primary },
                      ]}
                    >
                      Torna a oggi
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {isWeekend ? (
                <View
                  style={[styles.noClassesCard, { borderColor: theme.border }]}
                >
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
              ) : dayClasses.length === 0 ? (
                <View
                  style={[styles.noClassesCard, { borderColor: theme.border }]}
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
                  horizontal
                  nestedScrollEnabled={true}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.classesScrollContainer}
                >
                  {dayClasses.map((item, idx) => {
                    const isSelected = activeSelectedClass
                      ? item.subject === activeSelectedClass.subject &&
                        item.startTime === activeSelectedClass.startTime
                      : idx === 0;

                    return (
                      <TouchableOpacity
                        key={`${item.subject}-${item.startTime}-${idx}`}
                        style={[
                          styles.classCard,
                          isSelected && [
                            styles.classCardSelected,
                            {
                              backgroundColor: theme.cardTint,
                              borderColor: theme.primary,
                            },
                          ],
                        ]}
                        activeOpacity={0.8}
                        onPress={() => handleSelectClass(idx)}
                      >
                        <View style={styles.classCardTopRow}>
                          <View
                            style={[
                              styles.classTimeBadge,
                              { backgroundColor: theme.subtle },
                              isSelected && [
                                styles.classTimeBadgeSelected,
                                { backgroundColor: theme.primary },
                              ],
                            ]}
                          >
                            <Ionicons
                              name="time-outline"
                              size={11}
                              color={isSelected ? "#fff" : theme.accent}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.classTimeText,
                                { color: theme.accent },
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
                                { backgroundColor: theme.primary },
                              ]}
                            >
                              <Ionicons
                                name="checkmark-circle"
                                size={12}
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

                        <View style={styles.classRoomRow}>
                          <Ionicons
                            name="location-outline"
                            size={12}
                            color={isSelected ? theme.light : "#94a3b8"}
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
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* Corpo Principale Itinerario */}
            {loading ? (
              <View style={[styles.centerContainer, { minHeight: 280 }]}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.loadingText}>Calcolo tempi ...</Text>
              </View>
            ) : !itinerary ? (
              <View style={[styles.centerContainer, { minHeight: 280 }]}>
                <Ionicons name="train-outline" size={44} color="#64748b" />
                <Text style={styles.emptyTitle}>
                  Nessun itinerario calcolato
                </Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => loadData(true)}
                >
                  <Text style={styles.primaryBtnText}>Ricalcola</Text>
                </TouchableOpacity>
              </View>
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
                  <View style={styles.heroTopRow}>
                    {(() => {
                      let badgeText = itinerary.statusBadge.text;
                      let badgeColor = itinerary.statusBadge.color;
                      let badgeBg = `${itinerary.statusBadge.color}22`;
                      let badgeBorder = `${itinerary.statusBadge.color}35`;

                      if (!isSelectedDayToday) {
                        badgeText = "Programmato";
                        badgeColor = "#38bdf8";
                        badgeBg = "rgba(56, 189, 248, 0.12)";
                        badgeBorder = "rgba(56, 189, 248, 0.25)";
                      } else if (
                        badgeText === "Fonte: Trenitalia" ||
                        badgeText === "Dati Trenitalia"
                      ) {
                        badgeText = "In orario";
                        badgeColor = "#10b981";
                        badgeBg = "rgba(16, 185, 129, 0.15)";
                        badgeBorder = "rgba(16, 185, 129, 0.3)";
                      }

                      return (
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor: badgeBg,
                              borderColor: badgeBorder,
                              borderWidth: 1,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.statusDot,
                              { backgroundColor: badgeColor },
                            ]}
                          />
                          <Text
                            style={[
                              styles.statusBadgeText,
                              { color: badgeColor },
                            ]}
                          >
                            {badgeText}
                          </Text>
                        </View>
                      );
                    })()}

                    <View style={styles.heroTopRowRight}>
                      <View style={styles.durationBadge}>
                        <Ionicons
                          name="time-outline"
                          size={13}
                          color="#94a3b8"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.durationBadgeText}>
                          {formatDuration(itinerary.totalDurationMinutes)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.heroHeadline}>
                    {direction === "return"
                      ? "Rientro stimato alle"
                      : isWeekend || isTargetLectureFinished
                        ? "Prossima partenza da casa alle"
                        : "Parti da casa alle"}
                  </Text>
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
                      <Text style={styles.heroLectureSubject} numberOfLines={1}>
                        {isWeekend
                          ? direction === "outbound"
                            ? `Tragitto verso ${config?.arrivalStation.shortName || config?.arrivalStation.name}`
                            : `Rientro ad ${config?.originAddress}`
                          : direction === "outbound"
                            ? itinerary.targetLecture?.subject &&
                              itinerary.targetLecture.subject !==
                                "Lezioni di oggi terminate"
                              ? itinerary.targetLecture.subject
                              : activeSelectedClass?.subject || "Lezione"
                            : itinerary.targetLecture?.subject &&
                                itinerary.targetLecture.subject !==
                                  "Lezioni di oggi terminate"
                              ? itinerary.targetLecture.subject
                              : `Rientro ad ${config?.originAddress}`}
                      </Text>
                      <Text style={styles.heroLectureDetails} numberOfLines={1}>
                        {isWeekend
                          ? "Fine settimana • Nessuna lezione collegata"
                          : isTargetLectureFinished
                            ? "Terminata • Treni da adesso"
                            : direction === "outbound"
                              ? `${itinerary.targetLecture?.room} • Inizio ore ${itinerary.targetLecture?.startTime}`
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
                    <View style={styles.trainHighlightHeader}>
                      <View style={styles.trainHighlightHeaderLeft}>
                        <View
                          style={[
                            styles.trainNumberBadge,
                            { backgroundColor: theme.primary },
                          ]}
                        >
                          <Ionicons
                            name="train"
                            size={14}
                            color="#fff"
                            style={{ marginRight: 5 }}
                          />
                          <Text style={styles.trainNumberText}>
                            {itinerary.liveTrain.trainNumber}
                          </Text>
                        </View>

                        {trainStatus && (
                          <View
                            style={[
                              styles.trainStatusPill,
                              {
                                backgroundColor: trainStatus.badgeBg,
                                borderColor: trainStatus.badgeBorder,
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
                        )}

                        {/* Badge Dedicato al Ritardo (mostrato solo per la data odierna se presente ritardo live) */}
                        {isSelectedDayToday && trainStatus?.delayBadge ? (
                          <View
                            style={[
                              styles.trainStatusPill,
                              {
                                backgroundColor: trainStatus.delayBadge.bg,
                                borderColor: trainStatus.delayBadge.border,
                              },
                            ]}
                          >
                            <Ionicons
                              name="time-outline"
                              size={12}
                              color={trainStatus.delayBadge.color}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.trainStatusPillText,
                                { color: trainStatus.delayBadge.color },
                              ]}
                            >
                              {trainStatus.delayBadge.label}
                            </Text>
                          </View>
                        ) : null}

                        {/* Badge Permanente Origine Corsa */}
                        {(() => {
                          const cleanCommuter = (commuterStationName || "")
                            .trim()
                            .toLowerCase();
                          let rawOrigin = (
                            itinerary.liveTrain.originStationName || ""
                          ).trim();
                          if (/^S\d+$/i.test(rawOrigin)) {
                            rawOrigin = "";
                          }
                          const isOriginRef = Boolean(
                            itinerary.liveTrain.isOriginStation ||
                            (rawOrigin &&
                              cleanCommuter &&
                              rawOrigin
                                .toLowerCase()
                                .includes(cleanCommuter)) ||
                            (cleanCommuter &&
                              rawOrigin &&
                              cleanCommuter.includes(rawOrigin.toLowerCase())),
                          );
                          const displayOrigin = formatStationName(
                            (isOriginRef ? commuterStationName : rawOrigin) ||
                              commuterStationName ||
                              "Stazione",
                          );

                          return (
                            <View
                              style={[
                                styles.trainOriginPill,
                                isOriginRef
                                  ? {
                                      backgroundColor:
                                        "rgba(14, 165, 233, 0.16)",
                                      borderColor: "rgba(14, 165, 233, 0.35)",
                                    }
                                  : {
                                      backgroundColor:
                                        "rgba(148, 163, 184, 0.12)",
                                      borderColor: "rgba(148, 163, 184, 0.25)",
                                    },
                              ]}
                            >
                              <Ionicons
                                name="navigate-outline"
                                size={11}
                                color={isOriginRef ? "#38bdf8" : "#94a3b8"}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                style={[
                                  styles.trainOriginPillText,
                                  {
                                    color: isOriginRef ? "#38bdf8" : "#cbd5e1",
                                  },
                                ]}
                              >
                                {`Origine corsa • ${displayOrigin}`}
                              </Text>
                            </View>
                          );
                        })()}

                        {/* Nuova Pill Durata Viaggio Treno */}
                        {(() => {
                          const depM = parseTimeToMinutes(
                            isSelectedDayToday
                              ? itinerary.liveTrain.departureTimePlanned ||
                                  itinerary.liveTrain.departureTimeActual ||
                                  "00:00"
                              : itinerary.liveTrain.departureTimePlanned ||
                                  "00:00",
                          );
                          const arrM = parseTimeToMinutes(
                            isSelectedDayToday
                              ? itinerary.liveTrain.arrivalTimeActual ||
                                  itinerary.liveTrain.arrivalTimePlanned ||
                                  "00:00"
                              : itinerary.liveTrain.arrivalTimePlanned ||
                                  "00:00",
                          );
                          const tDuration =
                            itinerary.liveTrain.durationMinutes ||
                            (arrM > depM ? arrM - depM : 0);
                          if (tDuration <= 0) return null;

                          return (
                            <View
                              style={[
                                styles.trainStatusPill,
                                {
                                  backgroundColor: "rgba(56, 189, 248, 0.14)",
                                  borderColor: "rgba(56, 189, 248, 0.32)",
                                },
                              ]}
                            >
                              <Ionicons
                                name="timer-outline"
                                size={12}
                                color="#38bdf8"
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                style={[
                                  styles.trainStatusPillText,
                                  { color: "#38bdf8", fontWeight: "600" },
                                ]}
                              >
                                {`Durata: ${formatDuration(tDuration)}`}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    </View>

                    {/* Eventuale Avviso / Variazione / Interruzione Trenitalia (solo se oggi) */}
                    {isSelectedDayToday && trainStatus?.alertMessage ? (
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
                    {isSelectedDayToday && trainStatus?.capacityWarning ? (
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
                    <View style={styles.trainInfoRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.trainStationLabel}>Partenza</Text>
                        <Text style={styles.trainStationName}>
                          {direction === "outbound"
                            ? config?.departureStation.shortName ||
                              config?.departureStation.name
                            : config?.arrivalStation.shortName ||
                              config?.arrivalStation.name}
                        </Text>
                        {(() => {
                          const depPlanTime =
                            itinerary.liveTrain.departureTimePlanned || "00:00";
                          if (!isSelectedDayToday) {
                            return (
                              <Text style={styles.trainTimeText}>
                                {depPlanTime}
                              </Text>
                            );
                          }

                          const depPlanM = parseTimeToMinutes(depPlanTime);
                          const currentNowM =
                            new Date().getHours() * 60 +
                            new Date().getMinutes();
                          const isNotDepartedPastTime = Boolean(
                            !itinerary.liveTrain.isDepartedFromStation &&
                              (itinerary.liveTrain.isDeparted === false ||
                                itinerary.liveTrain.isStoppedInStation) &&
                              currentNowM >= depPlanM,
                          );
                          const lateM = isNotDepartedPastTime
                            ? Math.max(
                                itinerary.liveTrain.delayMinutes || 0,
                                currentNowM - depPlanM,
                              )
                            : itinerary.liveTrain.delayMinutes || 0;

                          const rawDepActM = parseTimeToMinutes(
                            itinerary.liveTrain.departureTimeActual ||
                              depPlanTime,
                          );
                          const depActM = Math.max(rawDepActM, depPlanM + lateM);
                          const displayDepTime =
                            depActM > depPlanM
                              ? minutesToTime(depActM)
                              : itinerary.liveTrain.departureTimeActual ||
                                depPlanTime;

                          const isDepDelayed = Boolean(
                            (depPlanM > 0 && depActM > depPlanM) ||
                              isNotDepartedPastTime,
                          );
                          const showStrike = Boolean(
                            isDepDelayed &&
                              depPlanTime &&
                              displayDepTime &&
                              depPlanTime !== displayDepTime,
                          );

                          return (
                            <>
                              <Text
                                style={[
                                  styles.trainTimeText,
                                  isDepDelayed && { color: "#fb923c" },
                                ]}
                              >
                                {displayDepTime}
                              </Text>
                              {showStrike && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    textDecorationLine: "line-through",
                                  }}
                                >
                                  prog.{" "}
                                  {itinerary.liveTrain.departureTimePlanned}
                                </Text>
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
                            ? cleanPlatform(itinerary.liveTrain.platformActual) ||
                              cleanPlatform(
                                itinerary.liveTrain.platformPlanned,
                              ) ||
                              "-"
                            : cleanPlatform(
                                itinerary.liveTrain.platformPlanned,
                              ) || "-"}
                        </Text>
                      </View>

                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={styles.trainStationLabel}>Arrivo</Text>
                        <Text style={styles.trainStationName}>
                          {direction === "outbound"
                            ? config?.arrivalStation.shortName ||
                              config?.arrivalStation.name
                            : config?.departureStation.shortName ||
                              config?.departureStation.name}
                        </Text>
                        {(() => {
                          const arrPlanTime =
                            itinerary.liveTrain.arrivalTimePlanned || "00:00";
                          if (!isSelectedDayToday) {
                            return (
                              <Text style={styles.trainTimeText}>
                                {arrPlanTime}
                              </Text>
                            );
                          }

                          const depPlanM = parseTimeToMinutes(
                            itinerary.liveTrain.departureTimePlanned || "00:00",
                          );
                          const arrPlanM = parseTimeToMinutes(arrPlanTime);
                          const currentNowM =
                            new Date().getHours() * 60 +
                            new Date().getMinutes();
                          const isNotDepartedPastTime = Boolean(
                            !itinerary.liveTrain.isDepartedFromStation &&
                              (itinerary.liveTrain.isDeparted === false ||
                                itinerary.liveTrain.isStoppedInStation) &&
                              currentNowM >= depPlanM,
                          );
                          const lateM = isNotDepartedPastTime
                            ? Math.max(
                                itinerary.liveTrain.delayMinutes || 0,
                                currentNowM - depPlanM,
                              )
                            : itinerary.liveTrain.delayMinutes || 0;

                          const rawArrActM = parseTimeToMinutes(
                            itinerary.liveTrain.arrivalTimeActual ||
                              arrPlanTime,
                          );
                          const arrActM = Math.max(rawArrActM, arrPlanM + lateM);
                          const displayArrTime =
                            arrActM > arrPlanM
                              ? minutesToTime(arrActM)
                              : itinerary.liveTrain.arrivalTimeActual ||
                                arrPlanTime;

                          const isArrDelayed = Boolean(
                            arrPlanM > 0 && (arrActM > arrPlanM || lateM > 0),
                          );
                          const showArrStrike = Boolean(
                            isArrDelayed &&
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
                                ]}
                              >
                                {displayArrTime}
                              </Text>
                              {showArrStrike && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    textDecorationLine: "line-through",
                                  }}
                                >
                                  prog. {itinerary.liveTrain.arrivalTimePlanned}
                                </Text>
                              )}
                            </>
                          );
                        })()}
                      </View>
                    </View>

                    {/* Selettore Alternative Treni (Treno prima / dopo & chips) */}
                    <View style={styles.trainAlternativesDivider} />
                    <View style={styles.trainNavButtonsRow}>
                      <TouchableOpacity
                        style={[
                          styles.trainNavBtn,
                          {
                            backgroundColor: theme.subtle,
                            borderColor: theme.border,
                            borderWidth: 1,
                          },
                          itinerary.liveTrain.hasEarlierTrain === false &&
                            styles.trainNavBtnDisabled,
                        ]}
                        disabled={itinerary.liveTrain.hasEarlierTrain === false}
                        onPress={handleTrainPrev}
                      >
                        <Ionicons
                          name="chevron-back"
                          size={14}
                          color={theme.accent}
                          style={{ marginRight: 3 }}
                        />
                        <Text
                          style={[
                            styles.trainNavBtnText,
                            { color: theme.accent },
                          ]}
                        >
                          Treno prima
                        </Text>
                      </TouchableOpacity>

                      <Text style={styles.trainNavCenterLabel}>
                        Cambia treno
                      </Text>

                      <TouchableOpacity
                        style={[
                          styles.trainNavBtn,
                          {
                            backgroundColor: theme.subtle,
                            borderColor: theme.border,
                            borderWidth: 1,
                          },
                          itinerary.liveTrain.hasLaterTrain === false &&
                            styles.trainNavBtnDisabled,
                        ]}
                        disabled={itinerary.liveTrain.hasLaterTrain === false}
                        onPress={handleTrainNext}
                      >
                        <Text
                          style={[
                            styles.trainNavBtnText,
                            { color: theme.accent },
                          ]}
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

                    {/* Chips Treni Alternativi */}
                    {itinerary.availableTrains &&
                      itinerary.availableTrains.length > 1 && (
                        <ScrollView
                          ref={trainChipsScrollRef}
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.trainChipsScroll}
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
                              itinerary.liveTrain?.trainNumber.replace(
                                /\D/g,
                                "",
                              );
                            const isDeparted = Boolean(
                              isSelectedDayToday && at.isDepartedFromStation,
                            );
                            const atPlannedDepM = parseTimeToMinutes(
                              at.departureTimePlanned || "00:00",
                            );
                            const atEstDepM = at.stoppedStationEstimatedDep
                              ? parseTimeToMinutes(at.stoppedStationEstimatedDep)
                              : at.departureTimeActual &&
                                  at.departureTimeActual !== at.departureTimePlanned
                                ? parseTimeToMinutes(at.departureTimeActual)
                                : 0;
                            const effectiveDepM =
                              atEstDepM > 0 ? atEstDepM : atPlannedDepM;
                            const currentNowM =
                              new Date().getHours() * 60 +
                              new Date().getMinutes();

                            // Nello slider, (Fermo) deve uscire sempre dal momento in cui si supera
                            // la partenza stimata o programmata (se non c'è la stimata): solo chi è fermo
                            // oltre il tempo previsto risulta fermo, non chi è fermo al binario in orario.
                            const isStoppedLate = Boolean(
                              isSelectedDayToday &&
                                !isDeparted &&
                                at.isStoppedInStation &&
                                effectiveDepM > 0 &&
                                currentNowM >= effectiveDepM,
                            );

                            return (
                              <TouchableOpacity
                                key={at.trainNumber}
                                style={[
                                  styles.trainChip,
                                  isCurrent && [
                                    styles.trainChipCurrent,
                                    {
                                      backgroundColor: theme.bg,
                                      borderColor: theme.primary,
                                    },
                                  ],
                                  isDeparted && !isCurrent && { opacity: 0.65 },
                                  isStoppedLate &&
                                    !isCurrent && {
                                      borderColor: "rgba(245, 158, 11, 0.4)",
                                    },
                                ]}
                                activeOpacity={0.7}
                                onLayout={(e) => {
                                  chipLayoutsRef.current[at.trainNumber] = {
                                    x: e.nativeEvent.layout.x,
                                    width: e.nativeEvent.layout.width,
                                  };
                                  if (isCurrent) {
                                    centerSelectedTrain(at.trainNumber);
                                  }
                                }}
                                onPress={() =>
                                  handleSelectTrainChip(at.trainNumber)
                                }
                              >
                                <Ionicons
                                  name={
                                    isStoppedLate
                                      ? "pause-circle-outline"
                                      : at.isFast
                                        ? "flash"
                                        : "train-outline"
                                  }
                                  size={12}
                                  color={
                                    isCurrent
                                      ? theme.accent
                                      : isStoppedLate
                                        ? "#f59e0b"
                                        : isDeparted
                                          ? "#64748b"
                                          : "#94a3b8"
                                  }
                                  style={{ marginRight: 4 }}
                                />
                                <Text
                                  style={[
                                    styles.trainChipText,
                                    isCurrent && styles.trainChipTextCurrent,
                                    isDeparted &&
                                      !isCurrent && { color: "#64748b" },
                                    isStoppedLate &&
                                      !isCurrent && { color: "#f59e0b" },
                                  ]}
                                >
                                  {at.trainNumber} •{" "}
                                  {isSelectedDayToday
                                    ? at.departureTimeActual ||
                                      at.departureTimePlanned
                                    : at.departureTimePlanned}
                                  {isDeparted
                                    ? " (Passato)"
                                    : isStoppedLate
                                      ? " (Fermo)"
                                      : ""}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      )}
                  </View>
                )}

                {/* Timeline delle tappe del viaggio */}
                <Text style={styles.timelineSectionTitle}>
                  TAPPE DEL VIAGGIO
                </Text>

                <View style={styles.timelineContainer}>
                  {itinerary.legs.map((leg, index) => {
                    const isFirst = index === 0;
                    const isLast = index === itinerary.legs.length - 1;

                    let iconName: keyof typeof Ionicons.glyphMap = "navigate";
                    let iconColor = theme.accent;
                    let circleBg = theme.subtle;

                    if (leg.type === "car") {
                      iconName = "car";
                      iconColor = "#fb923c";
                      circleBg = "rgba(251, 146, 60, 0.15)";
                    } else if (leg.type === "train") {
                      iconName = "train";
                      iconColor = theme.accent;
                      circleBg = theme.subtle;
                    } else if (leg.type === "transit") {
                      iconName = "bus";
                      iconColor = "#a855f7";
                      circleBg = "rgba(168, 85, 247, 0.15)";
                    } else if (leg.type === "destination") {
                      iconName = direction === "outbound" ? "flag" : "home";
                      iconColor = theme.primary;
                      circleBg = theme.subtle;
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
                      <View key={leg.id} style={styles.timelineStepRow}>
                        {/* Colonna Orario */}
                        <View style={styles.timeColumn}>
                          <Text style={styles.timeStartText}>
                            {leg.startTime}
                          </Text>
                          <Text style={styles.timeEndText}>{leg.endTime}</Text>
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
                          {!isLast && <View style={styles.connectingLine} />}
                        </View>

                        {/* Contenuto Tappa */}
                        <TouchableOpacity
                          activeOpacity={isInteractive ? 0.85 : 1}
                          disabled={!isInteractive}
                          onPress={() => {
                            if (leg.details?.mapQuery) {
                              handleOpenMaps(leg);
                            }
                          }}
                          style={[
                            styles.stepContentCard,
                            isFirst && { marginTop: 0 },
                            {
                              borderColor: "rgba(255, 255, 255, 0.08)",
                              backgroundColor: "#1c1c1e",
                            },
                          ]}
                        >
                          <View style={styles.stepTitleRow}>
                            <Text style={styles.stepTitleText}>
                              {leg.title}
                            </Text>
                            <View style={styles.durationBadgeContainer}>
                              <Text style={styles.stepDurationText}>
                                {formatDuration(leg.durationMinutes)}
                              </Text>
                            </View>
                          </View>

                          <Text style={styles.stepSubtitleText}>
                            {leg.subtitle}
                          </Text>

                          {leg.details?.badgeText && (
                            <View
                              style={[
                                styles.legCustomBadge,
                                {
                                  backgroundColor:
                                    leg.details.badgeBg ||
                                    "rgba(245, 158, 11, 0.15)",
                                  borderColor:
                                    leg.details.badgeColor || "#f59e0b",
                                },
                              ]}
                            >
                              <Ionicons
                                name={
                                  leg.details.lostLectureMinutes
                                    ? "alert-circle"
                                    : "time"
                                }
                                size={11}
                                color={leg.details.badgeColor || "#f59e0b"}
                                style={{ marginRight: 4 }}
                              />
                              <Text
                                style={[
                                  styles.legCustomBadgeText,
                                  { color: leg.details.badgeColor || "#f59e0b" },
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
                              leg.details?.trafficCondition) && (
                              <View
                                style={[
                                  styles.trafficAlertBox,
                                  leg.details.trafficFluency === "intenso" ||
                                  leg.details.trafficFluency === "rallentamenti"
                                    ? styles.trafficAlertBoxWarning
                                    : leg.details.trafficFluency === "moderato"
                                      ? styles.trafficAlertBoxModerate
                                      : styles.trafficAlertBoxSmooth,
                                ]}
                              >
                                <View style={styles.trafficAlertHeader}>
                                  <View
                                    style={[
                                      styles.trafficAlertIconBox,
                                      {
                                        backgroundColor:
                                          leg.details.trafficFluency ===
                                          "intenso"
                                            ? "rgba(239, 68, 68, 0.2)"
                                            : leg.details.trafficFluency ===
                                                "rallentamenti"
                                              ? "rgba(245, 158, 11, 0.2)"
                                              : leg.details.trafficFluency ===
                                                  "moderato"
                                                ? "rgba(59, 130, 246, 0.2)"
                                                : "rgba(16, 185, 129, 0.2)",
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name={
                                        leg.details.trafficFluency === "intenso"
                                          ? "flame"
                                          : leg.details.trafficFluency ===
                                              "rallentamenti"
                                            ? "warning"
                                            : leg.details.trafficFluency ===
                                                "moderato"
                                              ? "speedometer-outline"
                                              : "checkmark-circle"
                                      }
                                      size={16}
                                      color={
                                        leg.details.trafficFluency === "intenso"
                                          ? "#ef4444"
                                          : leg.details.trafficFluency ===
                                              "rallentamenti"
                                            ? "#f59e0b"
                                            : leg.details.trafficFluency ===
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
                                            leg.details.trafficFluency ===
                                            "intenso"
                                              ? "#fca5a5"
                                              : leg.details.trafficFluency ===
                                                  "rallentamenti"
                                                ? "#fcd34d"
                                                : leg.details.trafficFluency ===
                                                    "moderato"
                                                  ? "#93c5fd"
                                                  : "#6ee7b7",
                                        },
                                      ]}
                                    >
                                      {leg.details.trafficFluency === "intenso"
                                        ? "TRAFFICO MOLTO INTENSO"
                                        : leg.details.trafficFluency ===
                                            "rallentamenti"
                                          ? "RALLENTAMENTI SU STRADA"
                                          : leg.details.trafficFluency ===
                                              "moderato"
                                            ? "TRAFFICO MODERATO"
                                            : "TRAFFICO SCORREVOLE"}
                                    </Text>
                                    <Text
                                      style={styles.trafficAlertDescription}
                                    >
                                      {(() => {
                                        const baseCondition =
                                          leg.details.trafficCondition ||
                                          (leg.details.trafficFluency ===
                                          "scorrevole"
                                            ? "Tempo ottimale senza rallentamenti"
                                            : "Viabilità regolare");
                                        const delayInfo =
                                          leg.details.trafficDelayMinutes &&
                                          leg.details.trafficDelayMinutes > 0
                                            ? ` (+${leg.details.trafficDelayMinutes} min rispetto al tempo base)`
                                            : "";
                                        return `${baseCondition}${delayInfo}`;
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            )}

                          {/* Note della tratta (omesse per treno, arrivo destinazione e mezzi pubblici) */}
                          {leg.details?.notes &&
                            leg.type !== "transit" &&
                            leg.type !== "train" &&
                            leg.type !== "destination" &&
                            leg.details.notes !==
                              "Tocca per aprire la navigazione con orario impostato" && (
                              <Text style={styles.stepNotesText}>
                                {leg.details.notes}
                              </Text>
                            )}

                          {/* Banner Apri Google Maps (omesso per treno e arrivo) */}
                          {leg.details?.mapQuery &&
                            leg.type !== "train" &&
                            leg.type !== "destination" && (
                              <View
                                style={[
                                  styles.mapsBanner,
                                  {
                                    backgroundColor: theme.cardTint,
                                    borderColor: theme.border,
                                  },
                                ]}
                              >
                                <View style={styles.mapsBannerLeft}>
                                  <View
                                    style={[
                                      styles.mapsIconCircle,
                                      { backgroundColor: theme.subtle },
                                    ]}
                                  >
                                    <Ionicons
                                      name={
                                        leg.type === "transit" ||
                                        leg.details.travelMode === "transit"
                                          ? "bus"
                                          : leg.details.travelMode === "walking"
                                            ? "walk"
                                            : "navigate"
                                      }
                                      size={14}
                                      color={theme.accent}
                                    />
                                  </View>
                                  <View style={{ flex: 1, marginRight: 6 }}>
                                    <Text
                                      style={[
                                        styles.mapsBannerTitle,
                                        { color: theme.accent },
                                      ]}
                                    >
                                      {leg.type === "transit"
                                        ? "Cerca mezzi su Google Maps"
                                        : leg.details.travelMode === "transit"
                                          ? "Apri su Google Maps"
                                          : leg.details.travelMode === "walking"
                                            ? "Percorso su Google Maps"
                                            : "Naviga su Google Maps"}
                                    </Text>
                                  </View>
                                </View>
                                <View
                                  style={[
                                    styles.mapsActionBadge,
                                    { backgroundColor: theme.primary },
                                  ]}
                                >
                                  <Text style={styles.mapsActionBadgeText}>
                                    APRI MAPS
                                  </Text>
                                  <Ionicons
                                    name="open-outline"
                                    size={11}
                                    color="#ffffff"
                                    style={{ marginLeft: 3 }}
                                  />
                                </View>
                              </View>
                            )}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
            </Animated.View>
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
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },

  /* Switcher Andata / Ritorno */
  switcherContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  nativeSegmentedControl: {
    height: 36,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  customSegmentedControl: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    maxWidth: 600,
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
    maxWidth: 600,
    alignSelf: "center",
  },
  daySegmentedBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 3.5,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
    position: "relative",
  },
  slidingActivePill: {
    position: "absolute",
    top: 3.5,
    bottom: 3.5,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 1,
  },
  daySegmentWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 2,
  },
  daySegmentWrapperWithDivider: {
    paddingLeft: 2,
  },
  dayWeekendDivider: {
    width: 1,
    height: 18,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    marginRight: 3,
  },
  daySegmentItem: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  daySegmentLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#a1a1aa",
    letterSpacing: 0.3,
  },
  daySegmentLabelWeekend: {
    color: "#d4d4d8",
  },
  daySegmentLabelActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  daySegmentDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    marginTop: 2,
  },
  daySegmentDotActive: {
    backgroundColor: "#ffffff",
  },
  jumpToTodayPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  jumpToTodayText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
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
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  noClassesText: {
    fontSize: 12,
    color: "#94a3b8",
    flex: 1,
    flexWrap: "wrap",
  },
  classesScrollContainer: {
    gap: 8,
    paddingVertical: 2,
  },
  classCard: {
    width: 200,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  classCardSelected: {
    backgroundColor: "rgba(130, 36, 51, 0.3)",
    borderColor: SAPIENZA_RED,
    borderWidth: 1.5,
  },
  classCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  classTimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(130, 36, 51, 0.25)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  classTimeBadgeSelected: {
    backgroundColor: SAPIENZA_RED,
  },
  classTimeText: {
    fontSize: 11,
    fontWeight: "700",
    color: SAPIENZA_RED_ACCENT,
  },
  classTimeTextSelected: {
    color: "#ffffff",
  },
  targetBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  targetBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  classSubjectText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
    lineHeight: 16,
    minHeight: 32,
    marginBottom: 6,
  },
  classSubjectTextSelected: {
    color: "#ffffff",
  },
  classRoomRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  classRoomText: {
    fontSize: 11,
    color: "#94a3b8",
    flex: 1,
  },
  classRoomTextSelected: {
    color: "#fca5a5",
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
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },

  /* Hero Card */
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
    marginBottom: 12,
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
  heroHeadline: {
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: "500",
  },
  heroBigTime: {
    fontSize: 42,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -1,
    marginVertical: 4,
  },
  heroTargetLectureBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(130, 36, 51, 0.15)",
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.35)",
    padding: 14,
    marginBottom: 14,
  },
  trainHighlightHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
    marginBottom: 8,
  },
  trainNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  trainNavBtnDisabled: {
    opacity: 0.35,
  },
  trainNavBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  trainNavCenterLabel: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: "600",
  },
  trainChipsScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  trainChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  trainChipCurrent: {
    backgroundColor: SAPIENZA_RED_BG,
    borderColor: SAPIENZA_RED,
  },
  trainChipText: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: "600",
  },
  trainChipTextCurrent: {
    color: "#ffffff",
    fontWeight: "700",
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
    marginBottom: 6,
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
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 4,
  },
  stepContentCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
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
    borderRadius: 10,
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
    borderRadius: 9,
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

  /* Banner Google Maps */
  mapsBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(130, 36, 51, 0.14)",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.3)",
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 8,
  },
  mapsBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  mapsIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(130, 36, 51, 0.28)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  mapsBannerTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: SAPIENZA_RED_ACCENT,
  },
  mapsBannerSubtitle: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
    lineHeight: 15,
  },
  mapsActionBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  mapsActionBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
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
    borderRadius: 24,
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
});
