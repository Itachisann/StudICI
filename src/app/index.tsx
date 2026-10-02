import { MenuView } from "@expo/ui/community/menu";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
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
import { YearChannelSelector } from "../components/YearChannelSelector";
import { hasDateInfo } from "../utils/aiParser";
import {
  AttendanceRecord,
  generateAttendanceId,
  getAttendanceRecords,
  getDateForDayIndex,
  toggleAttendance,
  toggleDayAttendance,
} from "../utils/attendance";
import {
  formatSapienzaAddress,
  resolveClassroom,
  ResolvedClassroom,
} from "../utils/classroomLocations";
import {
  getICloudAutoSyncEnabled,
  syncWithICloudStorage,
} from "../utils/cloudSync";
import {
  ClassEvent,
  fetchAllCourseData,
  fetchScheduleData,
  ScheduleData,
  Tab,
} from "../utils/scraper";

const SAPIENZA_RED = "#822433";
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === "ios" && !isExpoGo;
const DAYS = ["LUN", "MAR", "MER", "GIO", "VEN"];
const DAYS_FULL = ["LUNEDÌ", "MARTEDÌ", "MERCOLEDÌ", "GIOVEDÌ", "VENERDÌ"];
const ACCENT_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
];

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
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  // Default al giorno corrente (0=LUN, 4=VEN). Weekend → LUN.
  const todayIdx = Math.min(Math.max(new Date().getDay() - 1, 0), 4);
  const [selectedDay, setSelectedDay] = useState(todayIdx);
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
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.max(windowWidth - 32, 280);

  const loadData = useCallback(
    async (force = false) => {
      try {
        try {
          const icloudEnabled = await getICloudAutoSyncEnabled();
          if (icloudEnabled) {
            await syncWithICloudStorage();
          }
        } catch {
          // ignore
        }

        const storedUrl = await AsyncStorage.getItem("selectedDegreeUrl");
        const storedDefaultTab = await AsyncStorage.getItem("defaultTabUrl");

        if (!storedUrl) {
          setDegreeUrl(null);
          setLoading(false);
          return;
        }

        if (degreeUrl && storedUrl !== degreeUrl) {
          setTabs([]);
          setSelectedTab(null);
          setSchedulesMap({});
          setSchedule(null);
        }

        setDegreeUrl(storedUrl);
        if (
          tabs.length === 0 ||
          force ||
          (degreeUrl && storedUrl !== degreeUrl)
        ) {
          setLoading(true);
        }

        const { tabs: fetchedTabs, schedules: fetchedSchedules } =
          await fetchAllCourseData(storedUrl, force);

        if (fetchedTabs.length > 0) {
          setTabs(fetchedTabs);
          setSchedulesMap(fetchedSchedules);

          const currentActive =
            selectedTab && fetchedTabs.find((t) => t.url === selectedTab.url);
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
    [degreeUrl, selectedTab, tabs.length],
  );

  const loadAttendance = useCallback(async () => {
    try {
      const records = await getAttendanceRecords();
      setAttendanceRecords(records);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
      loadAttendance();
    }, [loadData, loadAttendance]),
  );

  const handleClassLongPress = useCallback(
    async (cls: ClassEvent) => {
      try {
        const res = await toggleAttendance(
          selectedDay,
          DAYS_FULL[selectedDay],
          cls,
        );
        setAttendanceRecords(res.records);
        getICloudAutoSyncEnabled().then((enabled) => {
          if (enabled) syncWithICloudStorage().catch(() => {});
        }).catch(() => {});
      } catch (err) {
        console.error(err);
      }
    },
    [selectedDay],
  );

  const handleDayLongPress = useCallback(
    async (dayIdx: number) => {
      const dayClasses = schedule?.days[dayIdx] || [];
      if (dayClasses.length === 0) return;
      try {
        const res = await toggleDayAttendance(
          dayIdx,
          DAYS_FULL[dayIdx],
          dayClasses,
        );
        setAttendanceRecords(res.records);
        getICloudAutoSyncEnabled().then((enabled) => {
          if (enabled) syncWithICloudStorage().catch(() => {});
        }).catch(() => {});
      } catch (err) {
        console.error(err);
      }
    },
    [schedule],
  );

  const checkIsAttended = useCallback(
    (cls: ClassEvent) => {
      const { dateStr } = getDateForDayIndex(selectedDay);
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

  const handleRoomClick = (cls: ClassEvent) => {
    if (!cls.room) return;
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

  const todayClasses = schedule?.days[selectedDay] || [];

  const isCurrentClass = useCallback(
    (cls: ClassEvent) => {
      if (selectedDay !== todayIdx) return false;
      const now = new Date();
      const currentDayOfWeek = now.getDay() - 1; // 0=lun, 4=ven
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
    [selectedDay, todayIdx],
  );

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
      {/* ── Liquid Glass Header: Titolo "Orari" + Selezione Anni & Canali (fino ai canali) ── */}
      <View
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

      {/* ── ScrollView Principale: Pull-to-refresh dall'alto dello schermo ── */}
      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={{ paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={SAPIENZA_RED}
            colors={[SAPIENZA_RED]}
          />
        }
      >
        {/* ── Periodo Didattico / Semestre (Mostrato solo se contiene informazioni sulla data) ── */}
        {schedule?.info?.semester && hasDateInfo(schedule.info.semester) ? (
          <View style={styles.semesterCard}>
            <View style={styles.semesterIconBox}>
              <Ionicons name="calendar" size={16} color="#ffffff" />
            </View>
            <View style={styles.semesterContent}>
              <Text style={styles.semesterTitle}>CALENDARIO DIDATTICO</Text>
              <Text style={styles.semesterValue} numberOfLines={2}>
                {schedule.info.semester}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── Info banner (AI Alerts) in stile fluttuante iOS ── */}
        {schedule?.alerts && schedule.alerts.length > 0 ? (
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
        ) : null}

        {/* ── Day Selector (Allineamento Orizzontale Perfetto & Navigazione Ciclica) ── */}
        <View style={styles.daySelectorContainer}>
          <TouchableOpacity
            style={styles.navArrow}
            onPress={() => setSelectedDay((d) => (d === 0 ? 4 : d - 1))}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={18} color="#ffffff" />
          </TouchableOpacity>

          <View style={styles.daysRow}>
            {DAYS.map((day, i) => {
              const isActive = selectedDay === i;
              const isToday = i === todayIdx;
              const hasAttendance = dayHasAttendance(i);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => setSelectedDay(i)}
                  onLongPress={() => handleDayLongPress(i)}
                  delayLongPress={400}
                  style={styles.dayItem}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      isActive && styles.dayCircleActive,
                    ]}
                  >
                    <Text
                      style={[styles.dayText, isActive && styles.dayTextActive]}
                    >
                      {day}
                    </Text>
                  </View>
                  {hasAttendance ? (
                    <View style={styles.attendanceDayDot} />
                  ) : isToday ? (
                    <View
                      style={[styles.dayDot, isActive && styles.dayDotActive]}
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.navArrow}
            onPress={() => setSelectedDay((d) => (d === 4 ? 0 : d + 1))}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* ── Day label con indicatore ── */}
        <View style={styles.dayLabelRow}>
          <Text style={styles.dayLabel}>
            {DAYS_FULL[selectedDay]} · {todayClasses.length} LEZIONI
          </Text>
          <Text style={styles.dayHintText}>Tieni premuto per presenza</Text>
        </View>

        {/* ── Classes List ── */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={SAPIENZA_RED} />
            <Text style={styles.loadingText}>Caricamento lezioni...</Text>
          </View>
        ) : (
          <View style={styles.classList}>
            {todayClasses.length === 0 && (
              <View style={styles.emptyDay}>
                <Ionicons name="sunny-outline" size={48} color="#3a3a3c" />
                <Text style={styles.emptyDayText}>Nessuna lezione oggi</Text>
              </View>
            )}

            {todayClasses.map((cls: ClassEvent, i: number) => {
              const accentColor = ACCENT_COLORS[i % ACCENT_COLORS.length];
              const isLive = isCurrentClass(cls);
              const isAttended = checkIsAttended(cls);

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
                      <Text style={styles.subjectText} numberOfLines={2}>
                        {cls.subject?.toUpperCase()}
                      </Text>
                      <View style={styles.badgesCluster}>
                        {/* Simbolo colorato distintivo della presenza (con animazione spring all'apparizione) */}
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
                        style={styles.roomBadge}
                        onPress={() => handleRoomClick(cls)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="location" size={12} color="#ef4444" />
                        <Text style={styles.roomBadgeText} numberOfLines={1}>
                          {cls.room}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={11}
                          color="#ef4444"
                          style={{ marginLeft: 2, opacity: 0.8 }}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );

              // In standalone iOS (.IPA), usa UIContextMenuInteraction nativo
              if (isNativeComponentAvailable) {
                return (
                  <MenuView
                    key={i}
                    title={cls.subject}
                    style={[styles.cardMenuWrapper, { width: cardWidth }]}
                    shouldOpenOnLongPress={true}
                    onPressAction={({ nativeEvent }) => {
                      if (nativeEvent.event === "toggle_presence") {
                        handleClassLongPress(cls);
                      }
                    }}
                    actions={[
                      {
                        id: "toggle_presence",
                        title: isAttended
                          ? "Rimuovi Presenza"
                          : "Segna Presenza",
                        image: isAttended
                          ? "checkmark.circle.badge.xmark"
                          : "checkmark.circle",
                        attributes: {
                          destructive: isAttended,
                        },
                      },
                    ]}
                  >
                    {cardView}
                  </MenuView>
                );
              }

              // Fallback per Expo Go o piattaforme non native
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.cardMenuWrapper, { width: cardWidth }]}
                  activeOpacity={0.85}
                  onLongPress={() => handleClassLongPress(cls)}
                  delayLongPress={400}
                >
                  {cardView}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Modal Avvisi (Alerts) Fluttuante iOS ── */}
      <Modal
        visible={alertsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setAlertsModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setAlertsModalVisible(false)}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalGrabber} />
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIconBox}>
                <Ionicons name="megaphone" size={18} color="#ff9f0a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.modalTitle}>Comunicazioni</Text>
                <Text style={styles.modalSubtitle}>
                  {schedule?.alerts?.length === 1
                    ? "1 comunicazione ufficiale"
                    : `${schedule?.alerts?.length || 0} comunicazioni ufficiali`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconButton}
                activeOpacity={0.7}
                onPress={() => setAlertsModalVisible(false)}
              >
                <Ionicons name="close" size={18} color="#a1a1aa" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
            >
              {schedule?.alerts?.map((alert, idx) => (
                <View key={idx} style={styles.modalAlertItem}>
                  <View style={styles.alertItemAccent} />
                  <View style={styles.alertItemContent}>
                    <Text style={styles.modalAlertText}>{alert}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal Mappe per l'aula */}
      <ClassroomModal
        visible={!!selectedRoomModal}
        classroom={selectedRoomModal}
        subjects={selectedRoomSubjects}
        onClose={() => setSelectedRoomModal(null)}
      />
    </SafeAreaView>
  );
}

/* ──────── STYLES ──────── */
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
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

  /* Semester Card */
  semesterCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1e",
    marginHorizontal: 16,
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(130, 36, 51, 0.4)",
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
    marginHorizontal: 16,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 159, 10, 0.22)",
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

  /* Day selector (Allineato sull'asse orizzontale) */
  daySelectorContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  navArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1c1c1e",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2c2c2e",
  },
  daysRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    gap: 8,
  },
  dayItem: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    height: 36,
  },
  dayCircle: {
    width: 44,
    height: 36,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2c2c2e",
    backgroundColor: "#1c1c1e",
  },
  dayCircleActive: {
    backgroundColor: "rgba(130, 36, 51, 0.45)",
    borderWidth: 1,
    borderColor: SAPIENZA_RED,
  },
  dayText: {
    color: "#8e8e93",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  dayTextActive: {
    color: "#ffffff",
  },
  dayDot: {
    position: "absolute",
    bottom: -7,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#8e8e93",
  },
  dayDotActive: {
    backgroundColor: "#ffffff",
  },
  attendanceDayDot: {
    position: "absolute",
    bottom: -7,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#38bdf8",
  },

  /* Loading State */
  loadingContainer: { alignItems: "center", marginTop: 60 },
  loadingText: { color: "#8e8e93", marginTop: 16, fontSize: 14 },

  /* Day label */
  dayLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
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
  },

  /* Empty state */
  emptyDay: { alignItems: "center", marginTop: 60 },
  emptyDayText: { color: "#3a3a3c", fontSize: 16, marginTop: 12 },

  /* Class cards (Formato Calendario ad Alto Impatto con Orari Evidenti) */
  classList: { flex: 1, paddingHorizontal: 16 },
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
    width: 3.5,
    height: "82%",
    borderRadius: 2,
    marginHorizontal: 10,
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
});
