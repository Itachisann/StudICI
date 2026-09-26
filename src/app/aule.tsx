import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchTabs, fetchScheduleData, Tab, ScheduleData, ClassEvent } from '../utils/scraper';
import { resolveClassroom, ResolvedClassroom } from '../utils/classroomLocations';
import { ClassroomModal } from '../components/ClassroomModal';

const SAPIENZA_RED = '#822433';

interface RoomEntry {
  rawRoom: string;
  resolved: ResolvedClassroom;
  subjects: string[];
}

export default function AuleScreen() {
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeName, setDegreeName] = useState<string>('');
  const [roomEntries, setRoomEntries] = useState<RoomEntry[]>([]);
  const [selectedRoomModal, setSelectedRoomModal] = useState<RoomEntry | null>(null);

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

      if (storedUrl) {
        const fetchedTabs = await fetchTabs(storedUrl);
        setTabs(fetchedTabs);

        if (fetchedTabs.length > 0) {
          const currentTab = selectedTab || fetchedTabs[0];
          setSelectedTab(currentTab);
          await loadRoomsForTab(currentTab);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const loadRoomsForTab = async (tab: Tab) => {
    try {
      const data = await fetchScheduleData(tab.url);
      const roomMap = new Map<string, { resolved: ResolvedClassroom; subjects: Set<string> }>();

      const contextHeader = [
        data.info.faculty,
        data.info.course,
        data.info.semester,
        ...(data.alerts || [])
      ].join(' ');

      // 1. Estrai da classrooms dichiarate (mappate da Gemini con edificio e indirizzo)
      data.classrooms.forEach(c => {
        const res: ResolvedClassroom = {
          displayName: c.aulaName,
          buildingName: c.building || 'Edificio RM018 (Castro Laurenziano)',
          buildingCode: c.building ? c.building.replace(/^Edificio\s+/i, '') : 'RM018',
          address: c.address || 'Via del Castro Laurenziano 7a, 00161 Roma',
        };
        if (!roomMap.has(c.aulaName)) {
          roomMap.set(c.aulaName, { resolved: res, subjects: new Set() });
        }
      });

      // 2. Estrai da tutte le lezioni dei 5 giorni
      data.days.forEach(day => {
        day.forEach(cls => {
          if (cls.room) {
            const res: ResolvedClassroom = {
              displayName: cls.room,
              buildingName: cls.building || 'Edificio RM018 (Castro Laurenziano)',
              buildingCode: cls.building ? cls.building.replace(/^Edificio\s+/i, '') : 'RM018',
              address: cls.address || 'Via del Castro Laurenziano 7a, 00161 Roma',
            };
            if (!roomMap.has(cls.room)) {
              roomMap.set(cls.room, { resolved: res, subjects: new Set() });
            }
            if (cls.subject) {
              roomMap.get(cls.room)!.subjects.add(cls.subject);
            }
          }
        });
      });

      const entries: RoomEntry[] = Array.from(roomMap.entries()).map(([name, item]) => ({
        rawRoom: name,
        resolved: item.resolved,
        subjects: Array.from(item.subjects),
      }));

      setRoomEntries(entries);
    } catch (e) {
      console.error(e);
    }
  };

  const onSelectTab = async (tab: Tab) => {
    setSelectedTab(tab);
    setLoading(true);
    await loadRoomsForTab(tab);
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Aule & Edifici</Text>
        <Text style={styles.subtitle}>{degreeName || 'Sapienza Università di Roma'}</Text>
      </View>

      {/* Pill canali */}
      {tabs.length > 0 && (
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
                onPress={() => onSelectTab(tab)}
                style={[styles.tabChip, isActive && styles.tabChipActive]}
              >
                <Text style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>
                  {tab.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={SAPIENZA_RED} />
          <Text style={styles.loadingText}>Carico le aule...</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 120 }}>
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
  tabsScroll: {
    maxHeight: 36,
    marginBottom: 12,
  },
  tabsRow: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
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
  tabChipActive: {
    backgroundColor: SAPIENZA_RED,
    borderColor: SAPIENZA_RED,
  },
  tabChipText: {
    color: '#8e8e93',
    fontWeight: '600',
    fontSize: 12,
  },
  tabChipTextActive: {
    color: '#ffffff',
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
