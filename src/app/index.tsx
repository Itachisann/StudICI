import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Linking, SafeAreaView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTabs, fetchScheduleData, Tab, ScheduleData, ClassEvent } from '../utils/scraper';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

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
  const [degreeName, setDegreeName] = useState<string>('');
  // Default al giorno corrente (0=LUN, 4=VEN). Weekend → LUN.
  const todayIdx = Math.min(Math.max(new Date().getDay() - 1, 0), 4);
  const [selectedDay, setSelectedDay] = useState(todayIdx);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const storedName = await AsyncStorage.getItem('selectedDegreeName');
      if (storedName) setDegreeName(storedName);
      
      if (storedUrl && storedUrl !== degreeUrl) {
        setDegreeUrl(storedUrl);
        const fetchedTabs = await fetchTabs(storedUrl);
        setTabs(fetchedTabs);
        if (fetchedTabs.length > 0) {
          setSelectedTab(fetchedTabs[0]);
          const data = await fetchScheduleData(fetchedTabs[0].url);
          setSchedule(data);
        }
      } else if (!storedUrl) {
        setDegreeUrl(null);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const selectTab = async (tab: Tab) => {
    setSelectedTab(tab);
    setLoading(true);
    const data = await fetchScheduleData(tab.url);
    setSchedule(data);
    setLoading(false);
  };

  const openMapForRoom = (room: string) => {
    if (!room) return;
    const query = encodeURIComponent(`Sapienza Università di Roma ${room}`);
    Linking.openURL(`http://maps.apple.com/?q=${query}`).catch(() => {});
  };

  const todayClasses = schedule?.days[selectedDay] || [];

  // Onboarding
  if (!degreeUrl && !loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <Ionicons name="school" size={80} color={SAPIENZA_RED} style={{ marginBottom: 20 }} />
          <Text style={styles.welcomeText}>Benvenuto in StudICI</Text>
          <Text style={styles.subText}>Seleziona il tuo corso per iniziare.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/settings')}>
            <Text style={styles.primaryButtonText}>Scegli Corso</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoCircle}>
            <Ionicons name="school" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.appName}>StudICI</Text>
            <Text style={styles.appSubtitle} numberOfLines={1}>
              {degreeName || 'Sapienza Roma'}
            </Text>
          </View>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {schedule?.info.academicYear ? `A.A. ${schedule.info.academicYear}` : 'A.A. 2026-27'}
          </Text>
        </View>
      </View>

      {/* ── Tab Canali (pill chips) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {tabs.map((tab, i) => {
          const isActive = selectedTab?.url === tab.url;
          return (
            <TouchableOpacity
              key={i}
              onPress={() => selectTab(tab)}
              style={[styles.tabChip, isActive && styles.tabChipActive]}
            >
              <Text style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>
                {tab.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Info banner ── */}
      {schedule?.info.semester ? (
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color="#f59e0b" style={{ marginRight: 8, marginTop: 2 }} />
          <Text style={styles.infoBannerText}>
            {schedule.info.semester}
          </Text>
        </View>
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
        <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={styles.classList}
          contentContainerStyle={{ paddingBottom: 120 }}
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
                    onPress={() => openMapForRoom(cls.room)}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logoCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  appName: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  appSubtitle: { color: '#8e8e93', fontSize: 12, maxWidth: 200 },
  badge: {
    backgroundColor: 'rgba(130,36,51,0.25)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  badgeText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },

  /* Tabs */
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

  /* Info Banner */
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  infoBannerText: { color: '#d4d4d4', fontSize: 13, flex: 1, lineHeight: 18 },

  /* Day selector */
  daySelectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  navArrow: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center', alignItems: 'center',
  },
  daysRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },
  dayItem: { alignItems: 'center' },
  dayCircle: {
    width: 42, height: 42, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center',
  },
  dayCircleActive: { backgroundColor: SAPIENZA_RED },
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
});
