import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, RefreshControl
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchScheduleData, fetchAllCourseData, Tab, ScheduleData, ClassEvent } from '../utils/scraper';
import { resolveClassroom, ResolvedClassroom, formatSapienzaAddress } from '../utils/classroomLocations';
import { hasDateInfo } from '../utils/aiParser';
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
  const insets = useSafeAreaInsets();

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
      setSelectedRoomSubjects(cls.subject ? [cls.subject.toUpperCase()] : []);
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
    setSelectedRoomSubjects(cls.subject ? [cls.subject.toUpperCase()] : []);
  };

  const todayClasses = schedule?.days[selectedDay] || [];

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      {/* ── Liquid Glass Header: Titolo "Orari" + Selezione Anni & Canali (fino ai canali) ── */}
      <View style={[styles.liquidGlassHeader, { paddingTop: insets.top > 0 ? insets.top + 6 : 14 }]}>
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
              <Text style={styles.moreAlertsText}>+{schedule.alerts.length - 1}</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={14} color="#71717a" style={{ marginLeft: 6 }} />
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
                  {cls.subject?.toUpperCase()}
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

      {/* ── Modal Avvisi (Alerts) Fluttuante iOS ── */}
      <Modal
        visible={alertsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setAlertsModalVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAlertsModalVisible(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalGrabber} />
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIconBox}>
                <Ionicons name="megaphone" size={18} color="#ff9f0a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.modalTitle}>Avvisi & Comunicazioni</Text>
                <Text style={styles.modalSubtitle}>
                  {schedule?.alerts?.length === 1 ? '1 comunicazione ufficiale' : `${schedule?.alerts?.length || 0} comunicazioni ufficiali`}
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
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {schedule?.alerts?.map((alert, idx) => (
                <View key={idx} style={styles.modalAlertItem}>
                  <View style={styles.alertItemAccent} />
                  <View style={styles.alertItemContent}>
                    <Text style={styles.modalAlertText}>{alert}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                activeOpacity={0.8}
                onPress={() => setAlertsModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>Ho capito</Text>
              </TouchableOpacity>
            </View>
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

  /* Liquid Glass Header */
  liquidGlassHeader: {
    overflow: 'hidden',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
    marginBottom: 8,
  },
  liquidGlassOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(24, 24, 26, 0.65)',
  },
  liquidGlassTitleRow: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
  },
  liquidGlassTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.36,
  },

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

  /* Info Banner Fluttuante iOS */
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 159, 10, 0.08)',
    marginHorizontal: 16,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 10, 0.22)',
  },
  alertIconSquircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 159, 10, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  infoBannerText: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    lineHeight: 18,
  },
  moreAlertsBadge: {
    backgroundColor: 'rgba(255, 159, 10, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 10, 0.4)',
  },
  moreAlertsText: { color: '#ff9f0a', fontSize: 11, fontWeight: '700' },

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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayCircleActive: {
    backgroundColor: 'rgba(130, 36, 51, 0.45)',
    borderWidth: 1,
    borderColor: SAPIENZA_RED,
  },

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
    borderRadius: 18,
    marginBottom: 14,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  accentBar: {
    width: 4,
    marginLeft: 16,
    marginVertical: 18,
    borderRadius: 2,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 16,
    paddingLeft: 14,
  },
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
  
  /* Modal Fluttuante iOS */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 32,
  },
  modalContent: {
    backgroundColor: '#1c1c1e',
    borderRadius: 26,
    width: '100%',
    maxHeight: '82%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2c2c2e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  modalGrabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#3a3a3c',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  modalHeaderIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 159, 10, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#8e8e93',
    fontSize: 12,
    marginTop: 1,
  },
  modalCloseIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2c2c2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScroll: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    maxHeight: 380,
  },
  modalAlertItem: {
    flexDirection: 'row',
    backgroundColor: '#242426',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2e2e32',
  },
  alertItemAccent: {
    width: 4,
    backgroundColor: '#ff9f0a',
  },
  alertItemContent: {
    flex: 1,
    padding: 14,
  },
  modalAlertText: {
    color: '#f4f4f5',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400',
  },
  modalFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2c2c2e',
    backgroundColor: '#1c1c1e',
  },
  modalCloseBtn: {
    backgroundColor: '#2c2c2e',
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
