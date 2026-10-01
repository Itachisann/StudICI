import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchScheduleData, fetchAllCourseData, Tab, ScheduleData, ClassEvent } from '../utils/scraper';
import { resolveClassroom, ResolvedClassroom, formatSapienzaAddress } from '../utils/classroomLocations';
import { ClassroomModal } from '../components/ClassroomModal';
import { YearChannelSelector } from '../components/YearChannelSelector';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

const SAPIENZA_RED = '#822433';
const DAYS = ['LUN', 'MAR', 'MER', 'GIO', 'VEN'];
const DAYS_FULL = ['LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ'];
const ACCENT_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1'];

export default function ScheduleScreen() {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  // Default al giorno corrente (0=LUN, 4=VEN). Weekend → LUN.
  const todayIdx = Math.min(Math.max(new Date().getDay() - 1, 0), 4);
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const [schedulesMap, setSchedulesMap] = useState<Record<string, ScheduleData>>({});
  const [alertsModalVisible, setAlertsModalVisible] = useState(false);
  const [selectedRoomModal, setSelectedRoomModal] = useState<ResolvedClassroom | null>(null);
  const [selectedRoomSubjects, setSelectedRoomSubjects] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (force = false) => {
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const storedDefaultTab = await AsyncStorage.getItem('defaultTabUrl');
      
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
      if (tabs.length === 0 || force || (degreeUrl && storedUrl !== degreeUrl)) {
        setLoading(true);
      }

      const { tabs: fetchedTabs, schedules: fetchedSchedules } = await fetchAllCourseData(storedUrl, force);

      if (fetchedTabs.length > 0) {
        setTabs(fetchedTabs);
        setSchedulesMap(fetchedSchedules);

        const currentActive = selectedTab && fetchedTabs.find(t => t.url === selectedTab.url);
        const target = currentActive || fetchedTabs.find(t => t.url === storedDefaultTab) || fetchedTabs[0];

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
  }, [degreeUrl, selectedTab, tabs.length]);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData])
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
      setSchedulesMap(prev => ({ ...prev, [tab.url]: data }));
      setLoading(false);
    }
  };

  const handleRoomClick = (cls: ClassEvent) => {
    if (!cls.room) return;
    if (cls.building && cls.address) {
      const bCode = cls.building.replace(/^Edificio\s+/i, '');
      setSelectedRoomModal({
        displayName: cls.room,
        buildingName: cls.building,
        buildingCode: bCode,
        address: formatSapienzaAddress(cls.address, bCode),
      });
      setSelectedRoomSubjects(cls.subject ? [cls.subject] : []);
      return;
    }
    const contextHeader = [
      schedule?.info.faculty,
      schedule?.info.course,
      schedule?.info.semester,
      ...(schedule?.alerts || [])
    ].join(' ');
    const res = resolveClassroom(cls.room, contextHeader);
    setSelectedRoomModal(res);
    setSelectedRoomSubjects(cls.subject ? [cls.subject] : []);
  };

  const todayClasses = schedule?.days[selectedDay] || [];

  // L'onboarding ora è gestito globalmente in _layout.tsx

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ── Selezione Gerarchica Anni e Canali (2 Righe di Pill) ── */}
      <YearChannelSelector
        tabs={tabs}
        selectedTab={selectedTab}
        onSelectTab={selectTab}
      />

      {/* ── Periodo Didattico / Semestre (Evidente e separato dagli avvisi) ── */}
      {schedule?.info?.semester ? (
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

      {/* ── Info banner (AI Alerts) ── */}
      {schedule?.alerts && schedule.alerts.length > 0 ? (
        <TouchableOpacity 
          style={styles.infoBanner} 
          onPress={() => schedule.alerts.length > 1 && setAlertsModalVisible(true)}
          activeOpacity={schedule.alerts.length > 1 ? 0.7 : 1}
        >
          <Ionicons name="information-circle" size={20} color="#f59e0b" style={{ marginRight: 8, marginTop: 2 }} />
          <Text style={styles.infoBannerText} numberOfLines={schedule.alerts.length > 1 ? 1 : undefined}>
            {schedule.alerts[0]}
          </Text>
          {schedule.alerts.length > 1 && (
            <View style={styles.moreAlertsBadge}>
              <Text style={styles.moreAlertsText}>+{schedule.alerts.length - 1}</Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}

      {/* ── Day Selector ── */}
      <View style={styles.daySelectorContainer}>
        <TouchableOpacity
          style={styles.navArrow}
          onPress={() => setSelectedDay(d => Math.max(0, d - 1))}
        >
          <Ionicons name="chevron-back" size={18} color="#666" />
        </TouchableOpacity>

        <View style={styles.daysRow}>
          {DAYS.map((day, i) => {
            const isActive = selectedDay === i;
              const isToday = i === todayIdx;
            return (
              <TouchableOpacity key={i} onPress={() => setSelectedDay(i)} style={styles.dayItem}>
                <View style={[styles.dayCircle, isActive && styles.dayCircleActive]}>
                  <Text style={[styles.dayText, isActive && styles.dayTextActive]}>{day}</Text>
                </View>
                {isToday && <View style={[styles.dayDot, isActive && styles.dayDotActive]} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.navArrow}
          onPress={() => setSelectedDay(d => Math.min(4, d + 1))}
        >
          <Ionicons name="chevron-forward" size={18} color="#666" />
        </TouchableOpacity>
      </View>

      {/* ── Day label ── */}
      <Text style={styles.dayLabel}>
        {DAYS_FULL[selectedDay]} · {todayClasses.length} LEZIONI
      </Text>

      {/* ── Classes List ── */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={SAPIENZA_RED} />
          <Text style={styles.loadingText}>Caricamento lezioni...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.classList}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={SAPIENZA_RED}
              colors={[SAPIENZA_RED]}
            />
          }
        >
          {todayClasses.length === 0 && (
            <View style={styles.emptyDay}>
              <Ionicons name="sunny-outline" size={48} color="#3a3a3c" />
              <Text style={styles.emptyDayText}>Nessuna lezione oggi</Text>
            </View>
          )}

          {todayClasses.map((cls: ClassEvent, i: number) => (
            <View key={i} style={styles.classCard}>
              {/* Color accent bar */}
              <View style={[styles.accentBar, { backgroundColor: ACCENT_COLORS[i % ACCENT_COLORS.length] }]} />

              <View style={styles.cardBody}>
                {/* Subject */}
                <Text style={styles.subjectText} numberOfLines={2}>
                  {cls.subject}
                </Text>

                {/* Time */}
                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={15} color="#8e8e93" />
                  <Text style={styles.infoText}>
                    {cls.startTime} – {cls.endTime} ({cls.duration}h)
                  </Text>
                </View>

                {/* Teacher */}
                {cls.teacher ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={15} color="#8e8e93" />
                    <Text style={styles.infoText}>{cls.teacher}</Text>
                  </View>
                ) : null}

                {/* Room badge */}
                {cls.room ? (
                  <TouchableOpacity
                    style={styles.roomBadge}
                    onPress={() => handleRoomClick(cls)}
                  >
                    <Ionicons name="location" size={13} color="#ef4444" />
                    <Text style={styles.roomBadgeText}>{cls.room}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Modal Avvisi (Alerts) ── */}
      <Modal
        visible={alertsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAlertsModalVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAlertsModalVisible(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="notifications" size={24} color="#f59e0b" />
              <Text style={styles.modalTitle}>Avvisi</Text>
            </View>
            <ScrollView style={styles.modalScroll}>
              {schedule?.alerts?.map((alert, idx) => (
                <View key={idx} style={styles.modalAlertItem}>
                  <Text style={styles.modalAlertText}>{alert}</Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setAlertsModalVisible(false)}>
              <Text style={styles.modalCloseText}>Chiudi</Text>
            </TouchableOpacity>
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
    backgroundColor: '#111111',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  welcomeText: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  subText: { fontSize: 16, color: '#8e8e93', textAlign: 'center', marginBottom: 40 },
  primaryButton: {
    backgroundColor: SAPIENZA_RED,
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 28,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600', marginRight: 8 },

  /* Header */
  /* Top Tabs */
  topTabsContainer: {
    paddingTop: 16,
  },
  tabsScroll: { maxHeight: 34, marginBottom: 10 },
  tabsRow: { paddingHorizontal: 16, alignItems: 'center' },
  tabChip: {
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 14,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    justifyContent: 'center',
  },
  tabChipActive: { backgroundColor: SAPIENZA_RED, borderColor: SAPIENZA_RED },
  tabChipText: { color: '#8e8e93', fontWeight: '600', fontSize: 12 },
  tabChipTextActive: { color: '#fff' },

  /* Semester Card */
  semesterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.4)',
  },
  semesterIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  semesterContent: {
    flex: 1,
  },
  semesterTitle: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#e05666',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  semesterValue: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: 16,
  },

  /* Info Banner */
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  infoBannerText: { color: '#d4d4d4', fontSize: 13, flex: 1, lineHeight: 18 },
  moreAlertsBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  moreAlertsText: { color: '#f59e0b', fontSize: 11, fontWeight: 'bold' },

  /* Day selector */
  daySelectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  navArrow: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center', alignItems: 'center',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 12,
  },
  dayItem: { alignItems: 'center' },
  dayCircle: {
    width: 44, height: 44, borderRadius: 14, // squircle instead of circle
    justifyContent: 'center', alignItems: 'center',
  },
  dayCircleActive: { backgroundColor: SAPIENZA_RED },

  /* Loading State */
  loadingContainer: { alignItems: 'center', marginTop: 60 },
  loadingText: { color: '#8e8e93', marginTop: 16, fontSize: 14 },
  dayText: { color: '#8e8e93', fontSize: 12, fontWeight: 'bold', letterSpacing: 0.5 },
  dayTextActive: { color: '#fff' },
  dayDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: '#3a3a3c',
    marginTop: 4,
  },
  dayDotActive: { backgroundColor: '#fff' },

  /* Day label */
  dayLabel: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginBottom: 12,
  },

  /* Empty state */
  emptyDay: { alignItems: 'center', marginTop: 60 },
  emptyDayText: { color: '#3a3a3c', fontSize: 16, marginTop: 12 },

  /* Class cards */
  classList: { flex: 1, paddingHorizontal: 16 },
  classCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    marginBottom: 14,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  accentBar: {
    width: 4,
    marginLeft: 14,
    marginVertical: 16,
    borderRadius: 2,
  },
  cardBody: { flex: 1, padding: 14, paddingLeft: 12 },
  subjectText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  infoText: {
    color: '#8e8e93',
    fontSize: 14,
    marginLeft: 6,
  },
  roomBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 6,
  },
  roomBadgeText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  
  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    width: '100%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  modalScroll: {
    padding: 20,
  },
  modalAlertItem: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  modalAlertText: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 20,
  },
  modalCloseBtn: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2c2c2e',
  },
  modalCloseText: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '600',
  },
});
