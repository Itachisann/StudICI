import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchAllCourseData, Tab, ScheduleData } from '../utils/scraper';
import { resolveClassroom, ResolvedClassroom, getCanonicalRoomKey, normalizeDisplayName, formatSapienzaAddress } from '../utils/classroomLocations';
import { hasDateInfo } from '../utils/aiParser';
import { ClassroomModal } from '../components/ClassroomModal';
import { YearChannelSelector } from '../components/YearChannelSelector';

const SAPIENZA_RED = '#822433';

interface RoomEntry {
  rawRoom: string;
  resolved: ResolvedClassroom;
  subjects: string[];
}

function extractRoomEntries(data: ScheduleData): RoomEntry[] {
  const roomMap = new Map<string, { resolved: ResolvedClassroom; subjects: Set<string> }>();

  const contextHeader = [
    data.info?.faculty || '',
    data.info?.course || '',
    data.info?.semester || '',
    ...(data.alerts || [])
  ].join(' ');

  // 1. Estrai da classrooms dichiarate (mappate da Gemini con edificio e indirizzo)
  (data.classrooms || []).forEach(c => {
    const canon = getCanonicalRoomKey(c.aulaName);
    const dispName = normalizeDisplayName(c.aulaName);
    if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;
    const fallbackRes = resolveClassroom(c.aulaName, contextHeader);
    const bCode = (c.building || fallbackRes.buildingCode || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
    const finalAddress = formatSapienzaAddress(c.address || fallbackRes.address, bCode);
    const res: ResolvedClassroom = {
      displayName: dispName,
      buildingName: c.building || fallbackRes.buildingName,
      buildingCode: bCode ? `RM${bCode}` : fallbackRes.buildingCode,
      address: finalAddress,
    };
    if (!roomMap.has(canon)) {
      roomMap.set(canon, { resolved: res, subjects: new Set() });
    }
  });

  // 2. Estrai da tutte le lezioni dei 5 giorni
  (data.days || []).forEach(day => {
    day.forEach(cls => {
      if (cls.room) {
        const canon = getCanonicalRoomKey(cls.room);
        const dispName = normalizeDisplayName(cls.room);
        if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;
        const fallbackRes = resolveClassroom(cls.room, contextHeader);
        const bCode = (cls.building || fallbackRes.buildingCode || '').match(/RM\d{3}/i)?.[1]?.toUpperCase();
        const finalAddress = formatSapienzaAddress(cls.address || fallbackRes.address, bCode);
        const res: ResolvedClassroom = {
          displayName: dispName,
          buildingName: cls.building || fallbackRes.buildingName,
          buildingCode: bCode ? `RM${bCode}` : fallbackRes.buildingCode,
          address: finalAddress,
        };
        if (!roomMap.has(canon)) {
          roomMap.set(canon, { resolved: res, subjects: new Set() });
        } else {
          // Arricchisci building e address se più specifici
          const existing = roomMap.get(canon)!;
          if (cls.building && (!existing.resolved.buildingName || existing.resolved.buildingName === 'Edificio Sapienza')) {
            existing.resolved.buildingName = cls.building;
          }
          if (finalAddress && (!existing.resolved.address || (existing.resolved.address.includes('00161') && finalAddress.includes('00185')))) {
            existing.resolved.address = finalAddress;
          }
        }
        if (cls.subject) {
          roomMap.get(canon)!.subjects.add(cls.subject.toUpperCase());
        }
      }
    });
  });

  return Array.from(roomMap.values()).map(item => ({
    rawRoom: item.resolved.displayName,
    resolved: item.resolved,
    subjects: Array.from(item.subjects),
  }));
}

export default function AuleScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [degreeName, setDegreeName] = useState<string>('');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [schedulesMap, setSchedulesMap] = useState<Record<string, ScheduleData>>({});
  const [roomEntries, setRoomEntries] = useState<RoomEntry[]>([]);
  const [selectedRoomModal, setSelectedRoomModal] = useState<RoomEntry | null>(null);

  const loadData = useCallback(async (force = false) => {
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const storedName = await AsyncStorage.getItem('selectedDegreeName');
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
        setRoomEntries([]);
      }

      setDegreeUrl(storedUrl);
      if (storedName) setDegreeName(storedName);

      if (tabs.length === 0 || force || (degreeUrl && storedUrl !== degreeUrl)) {
        setLoading(true);
      }

      // Usa la cache condivisa di tutti i canali scaricati in un'unica botta
      const { tabs: fetchedTabs, schedules } = await fetchAllCourseData(storedUrl, force);

      if (fetchedTabs.length > 0) {
        setTabs(fetchedTabs);
        setSchedulesMap(schedules);

        const currentActive = selectedTab && fetchedTabs.find(t => t.url === selectedTab.url);
        const target = currentActive || fetchedTabs.find(t => t.url === storedDefaultTab) || fetchedTabs[0];

        setSelectedTab(target);
        if (schedules[target.url]) {
          setRoomEntries(extractRoomEntries(schedules[target.url]));
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

  // Cambio canale: 100% istantaneo in locale, zero download, zero rete!
  const onSelectTab = (tab: Tab) => {
    setSelectedTab(tab);
    if (schedulesMap[tab.url]) {
      setRoomEntries(extractRoomEntries(schedulesMap[tab.url]));
    }
  };

  const currentSemester = (selectedTab && schedulesMap[selectedTab.url]?.info?.semester) || '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Aule & Edifici</Text>
        <Text style={styles.subtitle}>{degreeName || 'Sapienza Università di Roma'}</Text>
      </View>

      {/* ── Selezione Gerarchica Anni e Canali (2 Righe di Pill) ── */}
      <YearChannelSelector
        tabs={tabs}
        selectedTab={selectedTab}
        onSelectTab={onSelectTab}
      />

      {/* ── Periodo Didattico / Semestre (Mostrato solo se contiene informazioni sulla data) ── */}
      {currentSemester && hasDateInfo(currentSemester) ? (
        <View style={styles.semesterCard}>
          <View style={styles.semesterIconBox}>
            <Ionicons name="calendar" size={16} color="#ffffff" />
          </View>
          <View style={styles.semesterContent}>
            <Text style={styles.semesterTitle}>CALENDARIO DIDATTICO</Text>
            <Text style={styles.semesterValue} numberOfLines={2}>
              {currentSemester}
            </Text>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={SAPIENZA_RED} />
          <Text style={styles.loadingText}>Carico le aule...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
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
          {roomEntries.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="business-outline" size={48} color="#3a3a3c" />
              <Text style={styles.emptyText}>Nessuna aula registrata per questo canale</Text>
            </View>
          ) : (
            roomEntries.map((entry, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.card}
                activeOpacity={0.8}
                onPress={() => setSelectedRoomModal(entry)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="location" size={20} color="#ef4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomName}>{entry.resolved.displayName}</Text>
                    <Text style={styles.buildingName}>{entry.resolved.buildingName}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#666" />
                </View>

                <View style={styles.addressRow}>
                  <Ionicons name="navigate-outline" size={14} color="#8e8e93" style={{ marginRight: 6 }} />
                  <Text style={styles.addressText} numberOfLines={1}>
                    {entry.resolved.address}
                  </Text>
                </View>

                {entry.subjects.length > 0 && (
                  <View style={styles.subjectsRow}>
                    {entry.subjects.slice(0, 3).map((sub, sIdx) => (
                      <View key={sIdx} style={styles.subBadge}>
                        <Text style={styles.subBadgeText} numberOfLines={1}>{sub}</Text>
                      </View>
                    ))}
                    {entry.subjects.length > 3 && (
                      <View style={styles.subBadgeMore}>
                        <Text style={styles.subBadgeMoreText}>+{entry.subjects.length - 3}</Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* Modal Mappe */}
      <ClassroomModal
        visible={!!selectedRoomModal}
        classroom={selectedRoomModal?.resolved || null}
        subjects={selectedRoomModal?.subjects}
        onClose={() => setSelectedRoomModal(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#8e8e93',
    fontSize: 14,
    marginTop: 2,
  },
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
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  roomName: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  buildingName: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 2,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  addressText: {
    color: '#a1a1aa',
    fontSize: 13,
    flex: 1,
  },
  subjectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  subBadge: {
    backgroundColor: '#2c2c2e',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: 160,
  },
  subBadgeText: {
    color: '#d4d4d4',
    fontSize: 11,
  },
  subBadgeMore: {
    backgroundColor: 'rgba(130, 36, 51, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  subBadgeMoreText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#8e8e93',
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    color: '#3a3a3c',
    fontSize: 15,
    marginTop: 12,
  },
});
