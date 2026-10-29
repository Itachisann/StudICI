import { CardContextMenu } from "../components/CardContextMenu";
import { SwipeToDeleteRow } from "../components/SwipeToDeleteRow";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFocusEffect } from "expo-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutChangeEvent,
  Linking,
  Modal,
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
import { ClassroomModal } from "../components/ClassroomModal";
import { ManualEventModal } from "../components/ManualEventModal";
import { NativeSheetModal } from "../components/NativeSheetModal";
import { YearChannelSelector } from "../components/YearChannelSelector";
import { useTheme } from "@/context/ThemeContext";
import {
  UNIFORM_SCREEN_BG,
  UNIFORM_MODAL_BG,
  MAX_CONTENT_WIDTH,
} from "@/constants/theme";
import { hasDateInfo } from "../utils/aiParser";
import { ACCENT_COLORS, getSubjectColor, getManualSubjectColor } from "../utils/subjectColors";
import {
  AttendanceRecord,
  generateAttendanceId,
  getAttendanceRecords,
  getDateForDayIndex,
  toggleAttendance,
  toggleDayAttendance,
  subscribeToAttendanceChanges,
} from "../utils/attendance";
import {
  ManualClassEvent,
  getManualEvents,
  addManualEvent,
  updateManualEvent,
  deleteManualEvent,
  manualEventToClassEvent,
  isManualEventActiveOnDate,
  subscribeToManualEventsChanges,
} from "../utils/manualEvents";
import {
  formatSapienzaAddress,
  resolveClassroom,
  ResolvedClassroom,
} from "../utils/classroomLocations";
import {
  getICloudAutoSyncEnabled,
  syncWithICloudStorage,
  subscribeToLiveSync,
} from "../utils/cloudSync";
import {
  ClassEvent,
  fetchAllCourseData,
  fetchScheduleData,
  ScheduleData,
  Tab,
} from "../utils/scraper";
import {
  checkForAppUpdate,
  GITHUB_LATEST_RELEASE_URL,
  AppUpdateInfo,
} from "../utils/updateChecker";

const SAPIENZA_RED = "#822433";
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === "ios" && !isExpoGo;

let _CallstackLiquidGlass: any = null;
if (isNativeComponentAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _CallstackLiquidGlass = require("@callstack/liquid-glass");
  } catch {
    _CallstackLiquidGlass = null;
  }
}
void _CallstackLiquidGlass;


const DAYS_FULL = [
  "LUNEDÌ",
  "MARTEDÌ",
  "MERCOLEDÌ",
  "GIOVEDÌ",
  "VENERDÌ",
  "SABATO",
  "DOMENICA",
];
const WEEKDAYS_ORARI: {
  label: string;
  fullLabel: string;
  dayIdx: number;
  isWeekend?: boolean;
}[] = [
  { label: "LUN", fullLabel: "Lunedì", dayIdx: 0 },
  { label: "MAR", fullLabel: "Martedì", dayIdx: 1 },
  { label: "MER", fullLabel: "Mercoledì", dayIdx: 2 },
  { label: "GIO", fullLabel: "Giovedì", dayIdx: 3 },
  { label: "VEN", fullLabel: "Venerdì", dayIdx: 4 },
  { label: "SAB", fullLabel: "Sabato", dayIdx: 5, isWeekend: true },
  { label: "DOM", fullLabel: "Domenica", dayIdx: 6, isWeekend: true },
];
export { ACCENT_COLORS, getSubjectColor };

function formatReleaseDate(isoString?: string): string {
  if (!isoString) return new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Recente";
  }
}

function AttendanceCheckmark() {
  const [scale] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        tension: 120,
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity]);

  return (
    <Animated.View
      style={[styles.presenceSymbolBox, { transform: [{ scale }], opacity }]}
    >
      <Ionicons name="checkmark-circle" size={17} color="#38bdf8" />
    </Animated.View>
  );
}

export default function ScheduleScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const selectedTabRef = useRef<Tab | null>(null);
  useEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);
  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const degreeUrlRef = useRef<string | null>(null);
  useEffect(() => {
    degreeUrlRef.current = degreeUrl;
  }, [degreeUrl]);
  // Calcolo giorno corrente: 0=LUN, ..., 4=VEN, 5=SAB, 6=DOM
  const jsDay = new Date().getDay();
  const todayIdx = jsDay === 0 ? 6 : jsDay - 1;
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const activeDayRef = useRef(todayIdx);
  const { width: screenWidth } = useWindowDimensions();

  const horizontalPagerRef = useRef<ScrollView>(null);
  const initialPagerPositioned = useRef(false);

  // Animazione fluida a scorrimento dello slider dei giorni della settimana (Uniforme a Viaggi)
  const segmentLayouts = useRef<{ [key: number]: { x: number; width: number } }>({});
  const [sliderPillAnim] = useState(() => new Animated.Value(0));
  const [sliderWidthAnim] = useState(() => new Animated.Value(44));
  const [weekendPillAnim] = useState(() => new Animated.Value(todayIdx >= 5 ? 1 : 0));
  const [pagerScrollAnim] = useState(() => new Animated.Value(todayIdx * 390));
  const [sliderReady, setSliderReady] = useState(false);
  const initialSliderPositioned = useRef(false);

  const handleSegmentLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      segmentLayouts.current[idx] = { x, width };

      if (idx === activeDayRef.current) {
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
        const currentW = baseLayout.width + (nextLayout.width - baseLayout.width) * frac;
        sliderPillAnim.setValue(currentX);
        sliderWidthAnim.setValue(currentW);
      }

      // Transizione cromatica continua in live tra feriali e weekend
      const weekendFactor = Math.max(0, Math.min(1, (progress - 4.2) / 0.6));
      weekendPillAnim.setValue(weekendFactor);
    },
    [screenWidth, sliderPillAnim, sliderWidthAnim, weekendPillAnim, pagerScrollAnim],
  );

  const handleDayChange = useCallback(
    (newDay: number) => {
      activeDayRef.current = newDay;
      setSelectedDay(newDay);
      const target = segmentLayouts.current[newDay];
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
            toValue: newDay >= 5 ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
          }),
          Animated.spring(pagerScrollAnim, {
            toValue: newDay * screenWidth,
            useNativeDriver: false,
            bounciness: 0,
          }),
        ]).start();
      }
      if (screenWidth > 0) {
        horizontalPagerRef.current?.scrollTo({
          x: newDay * screenWidth,
          animated: true,
        });
      }
    },
    [screenWidth, sliderPillAnim, sliderWidthAnim, weekendPillAnim, pagerScrollAnim],
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const pageIndex = Math.round(offsetX / screenWidth);
      if (pageIndex >= 0 && pageIndex < 7) {
        pagerScrollAnim.setValue(pageIndex * screenWidth);
        if (activeDayRef.current !== pageIndex) {
          activeDayRef.current = pageIndex;
          setSelectedDay(pageIndex);
        }
        weekendPillAnim.setValue(pageIndex >= 5 ? 1 : 0);
        const target = segmentLayouts.current[pageIndex];
        if (target) {
          sliderPillAnim.setValue(target.x);
          sliderWidthAnim.setValue(target.width);
        }
      }
    },
    [screenWidth, sliderPillAnim, sliderWidthAnim, weekendPillAnim, pagerScrollAnim],
  );

  useEffect(() => {
    if (!initialPagerPositioned.current && screenWidth > 0) {
      if (todayIdx > 0) {
        horizontalPagerRef.current?.scrollTo({
          x: todayIdx * screenWidth,
          animated: false,
        });
        pagerScrollAnim.setValue(todayIdx * screenWidth);
      }
      initialPagerPositioned.current = true;
    }
  }, [todayIdx, screenWidth, pagerScrollAnim]);

  const [schedulesMap, setSchedulesMap] = useState<
    Record<string, ScheduleData>
  >({});
  const [alertsModalVisible, setAlertsModalVisible] = useState(false);
  const [selectedRoomModal, setSelectedRoomModal] =
    useState<ResolvedClassroom | null>(null);
  const [selectedRoomSubjects, setSelectedRoomSubjects] = useState<string[]>(
    [],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<
    AttendanceRecord[]
  >([]);
  const [manualEvents, setManualEvents] = useState<ManualClassEvent[]>([]);
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [editingManualEvent, setEditingManualEvent] = useState<ManualClassEvent | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  useEffect(() => {
    checkForAppUpdate().then((info) => {
      if (info.hasUpdate) {
        setAppUpdate(info);
        // Per gli aggiornamenti minori/patch mostra il prompt opzionale.
        // Per gli aggiornamenti bloccanti (major), la schermata/modal a tutto schermo subentra senza popup.
        if (!info.isMajor) {
          Alert.alert(
            "Aggiornamento Disponibile",
            `È disponibile la nuova versione v${info.latestVersion} di StudICI (installata: v${info.currentVersion}).\n\nVuoi aggiornare ora con le ultime correzioni e miglioramenti?`,
            [
              { text: "Più tardi", style: "cancel" },
              {
                text: "Aggiorna",
                style: "default",
                onPress: () => {
                  Linking.openURL(info.htmlUrl || GITHUB_LATEST_RELEASE_URL);
                },
              },
            ]
          );
        }
      }
    });
  }, []);

  const insets = useSafeAreaInsets();
  const cardWidth = Math.min(Math.max(screenWidth - 32, 280), MAX_CONTENT_WIDTH - 32);

  const loadManualEvents = useCallback(async (courseUrlParam?: string | null) => {
    try {
      const storedUrl = courseUrlParam !== undefined ? courseUrlParam : await AsyncStorage.getItem("selectedDegreeUrl");
      const list = await getManualEvents(storedUrl || undefined);
      setManualEvents((prev) => {
        if (
          prev.length === list.length &&
          prev.every(
            (e, idx) =>
              e.id === list[idx]?.id &&
              e.subject === list[idx]?.subject &&
              e.startTime === list[idx]?.startTime &&
              e.endTime === list[idx]?.endTime &&
              e.room === list[idx]?.room &&
              e.repetitionType === list[idx]?.repetitionType
          )
        ) {
          return prev;
        }
        return list;
      });
    } catch {}
  }, []);

  const loadAttendance = useCallback(async (courseUrlParam?: string | null) => {
    try {
      const storedUrl = courseUrlParam !== undefined ? courseUrlParam : await AsyncStorage.getItem("selectedDegreeUrl");
      const records = await getAttendanceRecords(storedUrl || undefined);
      setAttendanceRecords(records);
    } catch {}
  }, []);

  const loadData = useCallback(
    async (force = false) => {
      try {
        // Sincronizzazione cloud in background per non rallentare l'avvio immediato dell'orario
        getICloudAutoSyncEnabled().then(async (icloudEnabled) => {
          if (icloudEnabled) {
            try {
              const syncRes = await syncWithICloudStorage();
              if (syncRes.updated) {
                const recs = await getAttendanceRecords();
                setAttendanceRecords(recs);
                loadManualEvents();
              }
            } catch {}
          }
        }).catch(() => {});

        const storedUrl = await AsyncStorage.getItem("selectedDegreeUrl");
        const storedDefaultTab = (storedUrl ? await AsyncStorage.getItem(`defaultTabUrl_${storedUrl}`) : null)
          || (await AsyncStorage.getItem("defaultTabUrl"));

        if (!storedUrl) {
          setDegreeUrl(null);
          setLoading(false);
          return;
        }

        const prevDegree = degreeUrlRef.current;
        if (prevDegree && storedUrl !== prevDegree) {
          setTabs([]);
          setSelectedTab(null);
          setSchedulesMap({});
          setSchedule(null);
        }

        setDegreeUrl(storedUrl);
        loadManualEvents(storedUrl);
        loadAttendance(storedUrl);

        if (
          tabsRef.current.length === 0 ||
          force ||
          (prevDegree && storedUrl !== prevDegree)
        ) {
          setLoading(true);
        }

        const { tabs: fetchedTabs, schedules: fetchedSchedules } =
          await fetchAllCourseData(storedUrl, force);

        if (fetchedTabs.length > 0) {
          setTabs(fetchedTabs);
          setSchedulesMap(fetchedSchedules);

          const currentActive =
            selectedTabRef.current &&
            fetchedTabs.find((t) => t.url === selectedTabRef.current?.url);
          const target =
            currentActive ||
            fetchedTabs.find((t) => t.url === storedDefaultTab) ||
            fetchedTabs[0];

          setSelectedTab(target);
          if (fetchedSchedules[target.url]) {
            setSchedule(fetchedSchedules[target.url]);
          }
        }
        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    },
    [loadManualEvents, loadAttendance],
  );

  useFocusEffect(
    useCallback(() => {
      loadData(false);
      loadAttendance();
      loadManualEvents();
    }, [loadData, loadAttendance, loadManualEvents]),
  );

  useEffect(() => {
    const unsub = subscribeToLiveSync((status, updated) => {
      if (updated) {
        loadData(false);
        loadAttendance();
        loadManualEvents();
      }
    });
    return unsub;
  }, [loadData, loadAttendance, loadManualEvents]);

  // Sincronizzazione istantanea in tempo reale tra tab per presenze e lezioni manuali
  useEffect(() => {
    const unsubAtt = subscribeToAttendanceChanges(() => {
      loadAttendance();
    });
    const unsubMan = subscribeToManualEventsChanges(() => {
      loadManualEvents();
    });
    return () => {
      unsubAtt();
      unsubMan();
    };
  }, [loadAttendance, loadManualEvents]);

  const handleClassLongPress = useCallback(
    async (cls: ClassEvent, dayIdx: number = selectedDay) => {
      try {
        const res = await toggleAttendance(
          dayIdx,
          DAYS_FULL[dayIdx],
          cls,
          degreeUrl || undefined,
        );
        setAttendanceRecords(res.records);
        getICloudAutoSyncEnabled().then((enabled) => {
          if (enabled) syncWithICloudStorage().catch(() => {});
        }).catch(() => {});
      } catch (err) {
        console.error(err);
      }
    },
    [selectedDay, degreeUrl],
  );

  const handleDayLongPress = useCallback(
    async (dayIdx: number) => {
      const scraped = schedule?.days[dayIdx] || [];
      const { dateStr } = getDateForDayIndex(dayIdx);
      const manualForDay = manualEvents
        .filter(
          (e) =>
            e.dayIndex === dayIdx &&
            (!e.tabUrl || e.tabUrl === selectedTab?.url) &&
            isManualEventActiveOnDate(e, dateStr),
        )
        .map(manualEventToClassEvent);
      const dayClasses = [...scraped, ...manualForDay];
      if (dayClasses.length === 0) return;
      try {
        const res = await toggleDayAttendance(
          dayIdx,
          DAYS_FULL[dayIdx],
          dayClasses,
          degreeUrl || undefined,
        );
        setAttendanceRecords(res.records);
        getICloudAutoSyncEnabled().then((enabled) => {
          if (enabled) syncWithICloudStorage().catch(() => {});
        }).catch(() => {});
      } catch (err) {
        console.error(err);
      }
    },
    [schedule, manualEvents, degreeUrl, selectedTab?.url],
  );

  const checkIsAttended = useCallback(
    (cls: ClassEvent, dayIdx: number = selectedDay) => {
      const { dateStr } = getDateForDayIndex(dayIdx);
      const id = generateAttendanceId(dateStr, cls.subject, cls.startTime);
      return attendanceRecords.some((r) => r.id === id);
    },
    [selectedDay, attendanceRecords],
  );

  const dayHasAttendance = useCallback(
    (dayIdx: number) => {
      const { dateStr } = getDateForDayIndex(dayIdx);
      return attendanceRecords.some((r) => r.date === dateStr);
    },
    [attendanceRecords],
  );

  const onRefresh = useCallback(async () => {
    if (!degreeUrl) return;
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [degreeUrl, loadData]);

  const selectTab = async (tab: Tab) => {
    setSelectedTab(tab);
    AsyncStorage.setItem("defaultTabUrl", tab.url).catch(() => {});
    if (degreeUrl) {
      AsyncStorage.setItem(`defaultTabUrl_${degreeUrl}`, tab.url).catch(() => {});
    }
    if (schedulesMap[tab.url]) {
      // Istantaneo da memoria: zero caricamento e zero rete!
      setSchedule(schedulesMap[tab.url]);
    } else {
      setLoading(true);
      const data = await fetchScheduleData(tab.url);
      setSchedule(data);
      setSchedulesMap((prev) => ({ ...prev, [tab.url]: data }));
      setLoading(false);
    }
  };

  const handleSaveManualEvent = async (
    data: Omit<ManualClassEvent, "id" | "createdAt" | "courseUrl">,
    id?: string,
  ) => {
    try {
      const dataWithTab = {
        ...data,
        tabUrl: data.tabUrl || selectedTab?.url,
        channelName: data.channelName || selectedTab?.name,
      };
      if (id) {
        const existing = manualEvents.find((e) => e.id === id);
        if (existing) {
          const updated: ManualClassEvent = {
            ...existing,
            ...dataWithTab,
          };
          await updateManualEvent(updated, degreeUrl || undefined);
        }
      } else {
        await addManualEvent(dataWithTab, degreeUrl || undefined);
      }
      await loadManualEvents();
      getICloudAutoSyncEnabled().then((enabled) => {
        if (enabled) syncWithICloudStorage().catch(() => {});
      }).catch(() => {});
    } catch (err) {
      console.error("Errore salvataggio lezione manuale:", err);
    }
  };

  const handleDeleteManualEvent = async (id: string) => {
    try {
      setManualEvents((prev) => prev.filter((e) => e.id !== id));
      await deleteManualEvent(id, degreeUrl || undefined);
      getICloudAutoSyncEnabled().then((enabled) => {
        if (enabled) syncWithICloudStorage().catch(() => {});
      }).catch(() => {});
    } catch (err) {
      console.error("Errore eliminazione lezione manuale:", err);
    }
  };

  const handleRoomClick = (cls: ClassEvent) => {
    if (!cls.room) return;
    if (cls.isManual) {
      // Per le lezioni inserite manualmente dall'utente, rimuovi il plesso/edificio stimato
      setSelectedRoomModal({
        displayName: cls.room,
        buildingName: "",
        buildingCode: "",
        address: cls.address || "",
      });
      setSelectedRoomSubjects(cls.subject ? [cls.subject.toUpperCase()] : []);
      return;
    }
    if (cls.building && cls.address) {
      const bCode = cls.building.replace(/^Edificio\s+/i, "");
      setSelectedRoomModal({
        displayName: cls.room,
        buildingName: cls.building,
        buildingCode: bCode,
        address: formatSapienzaAddress(cls.address, bCode),
      });
      setSelectedRoomSubjects(cls.subject ? [cls.subject.toUpperCase()] : []);
      return;
    }
    const contextHeader = [
      schedule?.info.faculty,
      schedule?.info.course,
      schedule?.info.semester,
      ...(schedule?.alerts || []),
    ].join(" ");
    const res = resolveClassroom(cls.room, contextHeader);
    setSelectedRoomModal(res);
    setSelectedRoomSubjects(cls.subject ? [cls.subject.toUpperCase()] : []);
  };

  const classesByDay = useMemo(() => {
    const map: ClassEvent[][] = [];
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const scraped = schedule?.days[dayIdx] || [];
      const { dateStr } = getDateForDayIndex(dayIdx);
      const manualForDay = manualEvents
        .filter(
          (e) =>
            e.dayIndex === dayIdx &&
            (!e.tabUrl || e.tabUrl === selectedTab?.url) &&
            isManualEventActiveOnDate(e, dateStr),
        )
        .map(manualEventToClassEvent);

      const combined = [...scraped, ...manualForDay];
      map[dayIdx] = combined.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [schedule, manualEvents, selectedTab?.url]);

  const officialUsedColors = useMemo(() => {
    const set = new Set<string>();
    if (schedule?.days) {
      schedule.days.flat().forEach((c) => {
        if (c.subject) {
          set.add(getSubjectColor(c.subject).toLowerCase());
        }
      });
    }
    return set;
  }, [schedule]);

  const isCurrentClass = useCallback(
    (cls: ClassEvent, dayIdx: number) => {
      if (dayIdx !== todayIdx) return false;
      const now = new Date();
      const jsDayNow = now.getDay();
      const currentDayOfWeek = jsDayNow === 0 ? 6 : jsDayNow - 1;
      if (currentDayOfWeek !== todayIdx) return false;

      if (!cls.startTime || !cls.endTime) return false;
      const [startH, startM] = cls.startTime.split(":").map(Number);
      const [endH, endM] = cls.endTime.split(":").map(Number);
      if (isNaN(startH) || isNaN(endH)) return false;

      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = startH * 60 + (startM || 0);
      const endMinutes = endH * 60 + (endM || 0);

      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    },
    [todayIdx],
  );

  const renderClassCard = (cls: ClassEvent, i: number, dayIdx: number) => {
    const accentColor = cls.isManual
      ? getManualSubjectColor(cls.subject, officialUsedColors)
      : getSubjectColor(cls.subject);
    const isLive = isCurrentClass(cls, dayIdx);
    const isAttended = checkIsAttended(cls, dayIdx);

    const cardView = (
      <View
        style={[
          styles.classCard,
          { width: cardWidth },
          isLive && styles.classCardLive,
        ]}
      >
        {/* Colonna Orari a mo' di Calendario (Grande ed Evidente) */}
        <View style={styles.timeColumn}>
          <Text style={styles.timeStartText}>{cls.startTime}</Text>
          <View style={styles.timeLineConnector}>
            <View
              style={[
                styles.timeLineBar,
                { backgroundColor: accentColor },
              ]}
            />
            <View style={styles.durationBadge}>
              <Text style={styles.durationBadgeText}>
                {cls.duration}h
              </Text>
            </View>
            <View
              style={[
                styles.timeLineBar,
                { backgroundColor: accentColor },
              ]}
            />
          </View>
          <Text style={styles.timeEndText}>{cls.endTime}</Text>
        </View>

        {/* Barra di Accento Verticale Colorata stile Calendario */}
        <View
          style={[
            styles.calendarAccentBar,
            { backgroundColor: accentColor },
          ]}
        />

        {/* Dettagli Lezione */}
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.subjectText} numberOfLines={2}>
                {cls.subject?.toUpperCase()}
              </Text>
              {cls.isManual && (
                <TouchableOpacity
                  style={styles.manualBadgeRow}
                  onPress={() => {
                    const found = manualEvents.find((e) => e.id === cls.manualId);
                    if (found) {
                      setEditingManualEvent(found);
                      setManualModalVisible(true);
                    }
                  }}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <View style={styles.manualBadge}>
                    <Ionicons name="pencil" size={10} color="#f59e0b" style={{ marginRight: 3 }} />
                    <Text style={styles.manualBadgeText}>Manuale</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.badgesCluster}>
              {/* Simbolo colorato distintivo della presenza */}
              {isAttended && <AttendanceCheckmark />}
              {isLive && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>ORA</Text>
                </View>
              )}
            </View>
          </View>

          {/* Docente */}
          {cls.teacher ? (
            <View style={styles.infoRow}>
              <Ionicons
                name="person-outline"
                size={13}
                color="#8e8e93"
              />
              <Text style={styles.teacherText} numberOfLines={1}>
                {cls.teacher}
              </Text>
            </View>
          ) : null}

          {/* Badge Aula */}
          {cls.room ? (
            <TouchableOpacity
              style={[
                styles.roomBadge,
                {
                  backgroundColor: theme.cardTint,
                  borderColor: theme.border,
                  borderWidth: 1,
                },
              ]}
              onPress={() => handleRoomClick(cls)}
              activeOpacity={0.7}
            >
              <Ionicons name="location" size={12} color={theme.accent} />
              <Text
                style={[styles.roomBadgeText, { color: theme.accent }]}
                numberOfLines={1}
              >
                {cls.room}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={11}
                color={theme.accent}
                style={{ marginLeft: 2, opacity: 0.8 }}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );

    const isManualRow = Boolean(cls.isManual && cls.manualId);

    const cardElement = (
      <CardContextMenu
        key={cls.manualId ? `manual-${cls.manualId}` : `class-${dayIdx}-${i}`}
        title={cls.subject}
        isAttended={isAttended}
        isManual={isManualRow}
        isNativeAvailable={isNativeComponentAvailable}
        style={[
          styles.cardMenuWrapper,
          { width: cardWidth },
          isManualRow && { marginBottom: 0 },
        ]}
        onTogglePresence={() => handleClassLongPress(cls, dayIdx)}
        onEditManual={() => {
          if (cls.manualId) {
            const found = manualEvents.find((e) => e.id === cls.manualId);
            if (found) {
              setEditingManualEvent(found);
              setManualModalVisible(true);
            }
          }
        }}
        onDeleteManual={() => {
          if (cls.manualId) handleDeleteManualEvent(cls.manualId);
        }}
      >
        {cardView}
      </CardContextMenu>
    );

    if (isManualRow && cls.manualId) {
      const manualId = cls.manualId;
      return (
        <SwipeToDeleteRow
          key={`swipe-${manualId}`}
          marginBottom={12}
          borderRadius={18}
          style={{ width: cardWidth }}
          onDelete={() => handleDeleteManualEvent(manualId)}
        >
          {cardElement}
        </SwipeToDeleteRow>
      );
    }

    return cardElement;
  };

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
      {/* ── Liquid Glass Header: Titolo "Orari" + Selezione Anni & Canali (fino ai canali) ── */}
      <View
        collapsable={false}
        style={[
          styles.liquidGlassHeader,
          { paddingTop: insets.top > 0 ? insets.top + 6 : 14 },
        ]}
      >
        <BlurView tint="dark" intensity={65} style={StyleSheet.absoluteFill} />
        <View style={styles.liquidGlassOverlay} />

        {/* Titolo iOS Large Title "Orari" */}
        <View style={styles.liquidGlassTitleRow}>
          <Text style={styles.liquidGlassTitle}>Orari</Text>
        </View>

        {/* Selezione Gerarchica Anni e Canali */}
        <YearChannelSelector
          tabs={tabs}
          selectedTab={selectedTab}
          onSelectTab={selectTab}
        />
      </View>

            {/* ── Banner Aggiornamento App Disponibile ── */}
      {appUpdate?.hasUpdate && !updateBannerDismissed ? (
        <View style={styles.centeredCardContainer}>
          <TouchableOpacity
            style={[
              styles.updateBanner,
              { backgroundColor: theme.cardTint, borderColor: theme.border },
            ]}
            activeOpacity={0.8}
            onPress={() => {
              Linking.openURL(appUpdate.htmlUrl || GITHUB_LATEST_RELEASE_URL);
            }}
          >
            <View
              style={[
                styles.updateIconSquircle,
                { backgroundColor: theme.primary },
              ]}
            >
              <Ionicons name="arrow-up-circle" size={19} color="#ffffff" />
            </View>
            <View style={{ flex: 1, paddingRight: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.updateBannerTitle}>
                  Nuova Versione {appUpdate.latestVersion}
                </Text>
                <View
                  style={[
                    styles.updateBadge,
                    { backgroundColor: theme.primary },
                  ]}
                >
                  <Text style={styles.updateBadgeText}>UPDATE</Text>
                </View>
              </View>
              <Text style={styles.updateBannerSub} numberOfLines={1}>
                {"Tocca per scaricare l'aggiornamento da GitHub Releases"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setUpdateBannerDismissed(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ padding: 4 }}
            >
              <Ionicons name="close" size={16} color="#8e8e93" />
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Periodo Didattico / Semestre (Mostrato solo se contiene informazioni sulla data) ── */}
      {schedule?.info?.semester && hasDateInfo(schedule.info.semester) ? (
        <View style={styles.centeredCardContainer}>
          <View style={[styles.semesterCard, { borderColor: theme.border }]}>
            <View style={[styles.semesterIconBox, { backgroundColor: theme.primary }]}>
              <Ionicons name="calendar" size={16} color="#ffffff" />
            </View>
            <View style={styles.semesterContent}>
              <Text style={[styles.semesterTitle, { color: theme.accent }]}>CALENDARIO DIDATTICO</Text>
              <Text style={styles.semesterValue} numberOfLines={2}>
                {schedule.info.semester}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* ── Info banner (AI Alerts) in stile fluttuante iOS ── */}
      {schedule?.alerts && schedule.alerts.length > 0 ? (
        <View style={styles.centeredCardContainer}>
          <TouchableOpacity
            style={styles.infoBanner}
            onPress={() => setAlertsModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.alertIconSquircle}>
              <Ionicons name="megaphone" size={15} color="#ff9f0a" />
            </View>
            <Text style={styles.infoBannerText} numberOfLines={1}>
              {schedule.alerts[0]}
            </Text>
            {schedule.alerts.length > 1 ? (
              <View style={styles.moreAlertsBadge}>
                <Text style={styles.moreAlertsText}>
                  +{schedule.alerts.length - 1}
                </Text>
              </View>
            ) : (
              <Ionicons
                name="chevron-forward"
                size={14}
                color="#71717a"
                style={{ marginLeft: 6 }}
              />
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Selettore Giorno della settimana - Liquid Glass Week Bar (Posizione originale con Sabato e Domenica) ── */}
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
                      outputRange: [theme.bg, "rgba(245, 158, 11, 0.22)"],
                    }),
                    borderColor: weekendPillAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [theme.primary, "#f59e0b"],
                    }),
                    shadowColor: weekendPillAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [theme.primary, "#f59e0b"],
                    }),
                  },
                ]}
              />
            )}

            {WEEKDAYS_ORARI.map((w, idx) => {
              const isSelected = selectedDay === w.dayIdx;
              const isItemToday = todayIdx === w.dayIdx;
              const isItemWeekend = Boolean(w.isWeekend);
              const hasAttendance = dayHasAttendance(w.dayIdx);

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
                  {idx === 5 && <View style={styles.dayWeekendDivider} />}
                  <TouchableOpacity
                    onLayout={(e) => handleSegmentLayout(idx, e)}
                    onPress={() => handleDayChange(w.dayIdx)}
                    onLongPress={() => handleDayLongPress(w.dayIdx)}
                    delayLongPress={400}
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

                    {/* Pallino indicatore (Oggi / Presenza registrata) */}
                    {isItemToday ? (
                      <View
                        style={[
                          styles.daySegmentDot,
                          isSelected
                            ? styles.daySegmentDotActive
                            : hasAttendance
                            ? { backgroundColor: theme.primary }
                            : { backgroundColor: "#ffffff" },
                        ]}
                      />
                    ) : hasAttendance ? (
                      <View
                        style={[
                          styles.daySegmentDot,
                          isSelected
                            ? styles.daySegmentDotActive
                            : { backgroundColor: theme.primary },
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

      {/* ── Pager Orizzontale Continuo dei Giorni (Visualizzazione continua metà e metà al 50% di swipe) ── */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>{"Carico l'orario delle lezioni..."}</Text>
        </View>
      ) : (
        <ScrollView
          ref={horizontalPagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          directionalLockEnabled
          nestedScrollEnabled
          contentOffset={{ x: todayIdx * screenWidth, y: 0 }}
          onScroll={handlePagerScroll}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          scrollEventThrottle={16}
          style={styles.horizontalPager}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          {WEEKDAYS_ORARI.map((w) => {
            const dayClasses = classesByDay[w.dayIdx] || [];
            return (
              <View key={w.dayIdx} style={[styles.pagerPage, { width: screenWidth }]}>
                <ScrollView
                  style={styles.mainScrollView}
                  contentContainerStyle={{ paddingTop: 8, paddingBottom: 130 }}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onRefresh}
                      tintColor={theme.primary}
                      colors={[theme.primary]}
                    />
                  }
                >
                  {/* Day label con indicatore */}
                  <View style={styles.dayLabelRow}>
                    <View style={styles.dayLabelLeft}>
                      <Text style={styles.dayLabel}>
                        {DAYS_FULL[w.dayIdx]} · {dayClasses.length} LEZIONI
                      </Text>
                      <Text style={styles.dayHintText}>Tieni premuto per presenza</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.addManualButton}
                      onPress={() => {
                        setEditingManualEvent(null);
                        setManualModalVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={17} color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  {/* Class cards */}
                  {dayClasses.length === 0 ? (
                    <View style={styles.emptyDay}>
                      <Ionicons
                        name={w.dayIdx === todayIdx ? "sunny-outline" : "calendar-outline"}
                        size={48}
                        color="#3a3a3c"
                      />
                      <Text style={styles.emptyDayText}>
                        {w.dayIdx === todayIdx ? "Nessuna lezione oggi" : "Nessuna lezione prevista"}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.classList}>
                      {dayClasses.map((cls, i) => renderClassCard(cls, i, w.dayIdx))}
                    </View>
                  )}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      )}

{/* ── Modal Avvisi (Alerts) Nativo iOS ── */}
      <NativeSheetModal
        visible={alertsModalVisible}
        onClose={() => setAlertsModalVisible(false)}
        title="Comunicazioni"
        backgroundColor={UNIFORM_MODAL_BG}
      >
        <View collapsable={false} style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}>
          <ScrollView
            style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {schedule?.alerts && schedule.alerts.length > 0 ? (
              schedule.alerts.map((alert, idx) => (
                <View key={idx} style={styles.modalAlertItem}>
                  <View style={styles.alertItemAccent} />
                  <View style={styles.alertItemContent}>
                    <Text style={styles.modalAlertText}>{alert}</Text>
                  </View>
                </View>
              ))
            ) : (
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 40,
                }}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={40}
                  color="#8e8e93"
                  style={{ marginBottom: 12 }}
                />
                <Text style={{ color: "#8e8e93", fontSize: 15 }}>
                  Nessuna comunicazione presente
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </NativeSheetModal>

      {/* Modal Mappe per l'aula */}
      <ClassroomModal
        visible={!!selectedRoomModal}
        classroom={selectedRoomModal}
        subjects={selectedRoomSubjects}
        onClose={() => setSelectedRoomModal(null)}
      />

      {/* ── Modal Lezioni Manuali ── */}
      <ManualEventModal
        visible={manualModalVisible}
        editingEvent={editingManualEvent}
        initialDayIndex={selectedDay}
        semesterText={schedule?.info?.semester}
        tabUrl={selectedTab?.url}
        channelName={selectedTab?.name}
        onClose={() => {
          setManualModalVisible(false);
          setEditingManualEvent(null);
        }}
        onSave={handleSaveManualEvent}
        onDelete={handleDeleteManualEvent}
      />

      {/* ── Modal iOS Bloccante per Major Update Obbligatorio ── */}
      <Modal
        visible={Boolean(appUpdate?.hasUpdate && appUpdate?.isMajor)}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.blockingModalContainer}>
          <BlurView tint="dark" intensity={100} style={StyleSheet.absoluteFill} />

          <View
            style={[
              styles.blockingModalContent,
              {
                paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 64 : 36) + 42,
                paddingBottom: Math.max(insets.bottom, Platform.OS === "ios" ? 34 : 20) + 14,
              },
            ]}
          >
            <View style={styles.blockingModalTop}>
              <View
                style={[
                  styles.blockingModalIconSquircle,
                  { backgroundColor: theme.primary, shadowColor: theme.primary },
                ]}
              >
                <Ionicons name="arrow-up-circle" size={44} color="#ffffff" />
              </View>

              <View
                style={[
                  styles.blockingPill,
                  {
                    backgroundColor: theme.bg,
                    borderColor: theme.primary,
                    shadowColor: theme.primary,
                  },
                ]}
              >
                <Text style={[styles.blockingPillText, { color: "#ffffff" }]}>
                  AGGIORNAMENTO RICHIESTO
                </Text>
              </View>

              <Text style={styles.blockingModalTitle}>
                Nuova Versione v{appUpdate?.latestVersion}
              </Text>

              <Text style={styles.blockingModalSub}>
                È richiesta la nuova versione di StudICI per continuare a utilizzare l&apos;applicazione.
              </Text>
            </View>

            <View
              style={[
                styles.blockingCard,
                { backgroundColor: theme.cardTint, borderColor: theme.border },
              ]}
            >
              <View style={styles.blockingCardRow}>
                <Text style={styles.blockingCardLabel}>Versione installata</Text>
                <Text style={styles.blockingCardValOld}>v{appUpdate?.currentVersion}</Text>
              </View>
              <View style={styles.blockingCardDivider} />
              <View style={styles.blockingCardRow}>
                <Text style={styles.blockingCardLabel}>Versione richiesta</Text>
                <Text style={[styles.blockingCardValNew, { color: theme.accent }]}>
                  v{appUpdate?.latestVersion}
                </Text>
              </View>
              <View style={styles.blockingCardDivider} />
              <View style={styles.blockingCardRow}>
                <Text style={styles.blockingCardLabel}>Data di rilascio</Text>
                <Text style={styles.blockingCardValDate}>
                  {formatReleaseDate(appUpdate?.publishedAt)}
                </Text>
              </View>
              <View style={styles.blockingCardDivider} />
              <View style={styles.blockingCardRow}>
                <Text style={styles.blockingCardLabel}>Commit di rilascio</Text>
                <Text style={styles.blockingCardValCommit} numberOfLines={2}>
                  {appUpdate?.commitName || appUpdate?.releaseTitle || appUpdate?.targetCommitish || `v${appUpdate?.latestVersion}`}
                </Text>
              </View>
              <View style={styles.blockingCardDivider} />
              <TouchableOpacity
                style={[styles.changelogBtn, { borderColor: theme.border }]}
                activeOpacity={0.7}
                onPress={() => {
                  Linking.openURL(appUpdate?.htmlUrl || GITHUB_LATEST_RELEASE_URL);
                }}
              >
                <Ionicons name="git-pull-request-outline" size={15} color={theme.accent} style={{ marginRight: 6 }} />
                <Text style={[styles.changelogBtnText, { color: theme.accent }]}>Consulta il Changelog su GitHub</Text>
                <Ionicons name="open-outline" size={13} color="#94a3b8" style={{ marginLeft: "auto" }} />
              </TouchableOpacity>
            </View>

            <View style={styles.blockingModalBottom}>
              <TouchableOpacity
                style={[
                  styles.blockingPrimaryBtn,
                  { backgroundColor: theme.primary, shadowColor: theme.primary },
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  Linking.openURL(appUpdate?.ipaUrl || appUpdate?.htmlUrl || GITHUB_LATEST_RELEASE_URL);
                }}
              >
                <Ionicons name="cloud-download-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.blockingPrimaryBtnText}>Aggiorna</Text>
              </TouchableOpacity>
              <Text style={styles.blockingFooterText}>
                Gli aggiornamenti principali includono modifiche strutturali necessarie alle API Trenitalia e ai server Sapienza.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ──────── STYLES ──────── */
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: UNIFORM_SCREEN_BG,
  },
  mainScrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 10,
  },
  subText: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: SAPIENZA_RED,
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 28,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    marginRight: 8,
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
  },
  liquidGlassTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.35,
  },

  /* Top Tabs */
  topTabsContainer: {
    paddingTop: 16,
  },
  tabsScroll: { maxHeight: 34, marginBottom: 10 },
  tabsRow: { paddingHorizontal: 16, alignItems: "center" },
  tabChip: {
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 14,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#2c2c2e",
    justifyContent: "center",
  },
  tabChipActive: { backgroundColor: SAPIENZA_RED, borderColor: SAPIENZA_RED },
  tabChipText: { color: "#8e8e93", fontWeight: "600", fontSize: 12 },
  tabChipTextActive: { color: "#fff" },

  centeredCardContainer: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  horizontalPager: {
    flex: 1,
    width: "100%",
  },
  pagerPage: {
    flex: 1,
    height: "100%",
  },

  /* Semester Card */
  semesterCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.4)",
    width: "100%",
  },
  semesterIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: SAPIENZA_RED,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  semesterContent: {
    flex: 1,
  },
  semesterTitle: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#e05666",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  semesterValue: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#ffffff",
    lineHeight: 16,
  },

  /* Info Banner Fluttuante iOS */
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 159, 10, 0.08)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 159, 10, 0.22)",
    width: "100%",
  },
  alertIconSquircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255, 159, 10, 0.16)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  infoBannerText: {
    color: "#e4e4e7",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
    lineHeight: 18,
  },
  moreAlertsBadge: {
    backgroundColor: "rgba(255, 159, 10, 0.22)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 159, 10, 0.4)",
  },
  moreAlertsText: { color: "#ff9f0a", fontSize: 11, fontWeight: "700" },

  /* Day selector - Liquid Glass Week Bar (Uniforme a Viaggi con Sabato e Domenica) */
  daySelectorContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 2,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  daySegmentedBar: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
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
    borderRadius: 12,
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
    borderRadius: 12,
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

  /* Loading State */
  loadingContainer: {
    alignItems: "center",
    marginTop: 60,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  loadingText: { color: "#8e8e93", marginTop: 16, fontSize: 14 },

  /* Day label */
  dayLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  dayLabelLeft: {
    flex: 1,
  },
  dayLabel: {
    color: "#8e8e93",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  dayHintText: {
    color: "#71717a",
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
  },
  addManualButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    overflow: "hidden",
  },
  addManualButtonText: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 4,
  },
  manualBadgeRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  manualBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  manualBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#f59e0b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  /* Empty state */
  emptyDay: {
    alignItems: "center",
    marginTop: 60,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  emptyDayText: { color: "#3a3a3c", fontSize: 16, marginTop: 12 },

  /* Class cards (Formato Calendario ad Alto Impatto con Orari Evidenti) */
  classList: {
    flex: 1,
    paddingHorizontal: 16,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  cardMenuWrapper: {
    width: "100%",
    marginBottom: 12,
  },
  classCard: {
    width: "100%",
    backgroundColor: "#1c1c1e",
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  classCardLive: {
    borderColor: "rgba(52, 199, 89, 0.45)",
    backgroundColor: "#1a221c",
  },
  classCardAttended: {
    borderColor: "rgba(16, 185, 129, 0.4)",
    backgroundColor: "#152119",
  },
  /* Colonna Orario a mo' di Calendario */
  timeColumn: {
    width: 62,
    alignItems: "center",
    justifyContent: "center",
  },
  timeStartText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  timeLineConnector: {
    alignItems: "center",
    marginVertical: 3,
  },
  timeLineBar: {
    width: 2,
    height: 6,
    borderRadius: 1,
    opacity: 0.7,
  },
  durationBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    marginVertical: 2,
  },
  durationBadgeAttended: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
  },
  durationBadgeText: {
    color: "#a1a1aa",
    fontSize: 10,
    fontWeight: "700",
  },
  durationBadgeTextAttended: {
    color: "#10b981",
  },
  timeEndText: {
    color: "#8e8e93",
    fontSize: 13,
    fontWeight: "700",
  },
  calendarAccentBar: {
    width: 4,
    alignSelf: "stretch",
    minHeight: 52,
    borderRadius: 2,
    marginHorizontal: 10,
    marginVertical: 4,
  },
  cardBody: {
    flex: 1,
    justifyContent: "center",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 5,
    gap: 6,
  },
  subjectText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    flex: 1,
  },
  badgesCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  presenceSymbolBox: {
    justifyContent: "center",
    alignItems: "center",
    marginRight: 2,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(52, 199, 89, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(52, 199, 89, 0.35)",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34c759",
    marginRight: 4,
  },
  liveText: {
    color: "#34c759",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  teacherText: {
    color: "#8e8e93",
    fontSize: 13,
    marginLeft: 6,
    flex: 1,
  },
  roomBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 2,
  },
  roomBadgeText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },

  /* Modal Fluttuante iOS */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
    padding: 16,
    paddingBottom: 32,
  },
  modalContent: {
    backgroundColor: "#1c1c1e",
    borderRadius: 26,
    width: "100%",
    maxHeight: "82%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2c2c2e",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  modalGrabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#3a3a3c",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2c2c2e",
  },
  modalHeaderIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255, 159, 10, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "#8e8e93",
    fontSize: 12,
    marginTop: 1,
  },
  modalCloseIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#2c2c2e",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScroll: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    maxHeight: 380,
  },
  modalAlertItem: {
    flexDirection: "row",
    backgroundColor: "#242426",
    borderRadius: 16,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2e2e32",
  },
  alertItemAccent: {
    width: 4,
    backgroundColor: "#ff9f0a",
  },
  alertItemContent: {
    flex: 1,
    padding: 14,
  },
  modalAlertText: {
    color: "#f4f4f5",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "400",
  },
  commuterQuickBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(130, 36, 51, 0.12)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.3)",
  },
  commuterBannerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(130, 36, 51, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  commuterBannerTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  commuterBannerSub: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 1,
  },
  /* Banner Aggiornamento In-App */
  updateBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    marginBottom: 4,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    width: "100%",
  },
  updateIconSquircle: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  updateBannerTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
    marginRight: 6,
  },
  updateBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  updateBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  updateBannerSub: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
  },

  /* Modal iOS Bloccante per Major Update */
  blockingModalContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  blockingModalSafeArea: {
    flex: 1,
  },
  blockingModalContent: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  blockingModalTop: {
    alignItems: "center",
    marginTop: 20,
  },
  blockingModalIconSquircle: {
    width: 84,
    height: 84,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  blockingPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    marginBottom: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  blockingPillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  blockingModalTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  blockingModalSub: {
    fontSize: 15,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: 10,
  },
  blockingCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginVertical: 14,
  },
  blockingCardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  blockingCardLabel: {
    fontSize: 14,
    color: "#94a3b8",
    fontWeight: "500",
  },
  blockingCardValOld: {
    fontSize: 15,
    color: "#a1a1aa",
    fontWeight: "600",
  },
  blockingCardValNew: {
    fontSize: 16,
    fontWeight: "800",
  },
  blockingCardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    marginVertical: 10,
  },
  blockingCardValDate: {
    fontSize: 15,
    color: "#f8fafc",
    fontWeight: "600",
  },
  blockingCardValCommit: {
    fontSize: 13,
    color: "#e2e8f0",
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
    marginLeft: 12,
  },
  changelogBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 2,
  },
  changelogBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  blockingModalBottom: {
    alignItems: "center",
  },
  blockingPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 12,
  },
  blockingPrimaryBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
  },
  blockingFooterText: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 16,
    paddingHorizontal: 16,
  },
  swipeDeleteContainer: {
    backgroundColor: "#ff3b30",
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 22,
    borderRadius: 16,
    height: "100%",
  },
  swipeDeleteContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDeleteText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
});
