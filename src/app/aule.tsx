import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchAllCourseData, Tab, ScheduleData } from '../utils/scraper';
import {
  resolveClassroom,
  ResolvedClassroom,
  getCanonicalRoomKey,
  normalizeDisplayName,
  formatSapienzaAddress,
  SAPIENZA_BUILDINGS,
} from '../utils/classroomLocations';
import {
  getManualEvents,
  subscribeToManualEventsChanges,
  ManualClassEvent,
} from '../utils/manualEvents';
import { subscribeToLiveSync } from '../utils/cloudSync';
import { hasDateInfo } from '../utils/aiParser';
import { ClassroomModal } from '../components/ClassroomModal';
import { YearChannelSelector } from '../components/YearChannelSelector';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_SCREEN_BG, MAX_CONTENT_WIDTH } from '@/constants/theme';

const SAPIENZA_RED = '#822433';

interface RoomEntry {
  rawRoom: string;
  resolved: ResolvedClassroom;
  subjects: string[];
}

function extractRoomEntries(
  data: ScheduleData,
  manualEvents: ManualClassEvent[] = [],
  tabUrl?: string
): RoomEntry[] {
  const roomMap = new Map<string, { resolved: ResolvedClassroom; subjects: Set<string> }>();

  const contextHeader = [
    data.info?.faculty || '',
    data.info?.course || '',
    data.info?.semester || '',
    ...(data.alerts || [])
  ].join('\n');

  const dayNamesCanon = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
  const dayNamesDisplay = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

  // 1. Estrai da classrooms dichiarate (mappate da Gemini / intestazione con edificio e indirizzo)
  (data.classrooms || []).forEach(c => {
    const canon = getCanonicalRoomKey(c.aulaName);
    const dispName = normalizeDisplayName(c.aulaName);
    if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;
    const fallbackRes = resolveClassroom(c.aulaName, contextHeader);
    const bCode = (c.building || fallbackRes.buildingCode || '').match(/RM\d{3}/i)?.[0]?.toUpperCase();
    const bInfo = bCode ? SAPIENZA_BUILDINGS[bCode] : undefined;
    const finalAddress = formatSapienzaAddress(c.address || bInfo?.address || fallbackRes.address, bCode);
    const res: ResolvedClassroom = {
      displayName: dispName,
      buildingName: c.building || bInfo?.name || fallbackRes.buildingName,
      buildingCode: bCode || fallbackRes.buildingCode,
      address: finalAddress,
      campus: bInfo?.campus || fallbackRes.campus,
      latitude: bInfo?.latitude || fallbackRes.latitude,
      longitude: bInfo?.longitude || fallbackRes.longitude,
    };
    if (!roomMap.has(canon)) {
      roomMap.set(canon, { resolved: res, subjects: new Set() });
    }
  });

  // 2. Estrai da tutte le lezioni dei giorni del corso ufficiale
  (data.days || []).forEach((day, dayIdx) => {
    const currentDayCanon = dayNamesCanon[dayIdx] || '';
    const currentDayDisplay = dayNamesDisplay[dayIdx] || '';

    day.forEach(cls => {
      if (cls.room) {
        const canon = getCanonicalRoomKey(cls.room);
        const dispName = normalizeDisplayName(cls.room);
        if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;

        const fallbackRes = resolveClassroom(cls.room, contextHeader);
        const bCode = (cls.building || fallbackRes.buildingCode || '').match(/RM\d{3}/i)?.[0]?.toUpperCase();
        const bInfo = bCode ? SAPIENZA_BUILDINGS[bCode] : undefined;
        const finalAddress = formatSapienzaAddress(cls.address || bInfo?.address || fallbackRes.address, bCode);

        // Verifica se per questa aula e questo giorno della settimana esiste una variante specifica (es. "15 (lunedi)")
        const escapedCanon = canon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let targetKey = canon;
        let targetDispName = dispName;

        const daySpecificKey = currentDayCanon
          ? Array.from(roomMap.keys()).find(k => {
              if (k === canon) return false;
              const matchesBase = new RegExp(`^${escapedCanon}\\s*\\(`, 'i').test(k);
              return matchesBase && k.includes(currentDayCanon);
            })
          : undefined;

        if (daySpecificKey) {
          targetKey = daySpecificKey;
          targetDispName = roomMap.get(daySpecificKey)!.resolved.displayName;
        } else if (roomMap.has(canon)) {
          const existing = roomMap.get(canon)!;
          const existingBCode = (existing.resolved.buildingCode || existing.resolved.buildingName || '')
            .match(/RM\d{3}/i)?.[0]
            ?.toUpperCase();
          // Se la lezione si svolge in un edificio fisicamente diverso da quello dell'aula standard
          if (existingBCode && bCode && existingBCode !== bCode) {
            const matchingBuildingKey = Array.from(roomMap.keys()).find(k => {
              if (!new RegExp(`^${escapedCanon}\\b`, 'i').test(k)) return false;
              const entryBCode = (roomMap.get(k)?.resolved.buildingCode || roomMap.get(k)?.resolved.buildingName || '')
                .match(/RM\d{3}/i)?.[0]
                ?.toUpperCase();
              return entryBCode === bCode;
            });

            if (matchingBuildingKey) {
              targetKey = matchingBuildingKey;
              targetDispName = roomMap.get(matchingBuildingKey)!.resolved.displayName;
            } else if (currentDayCanon) {
              targetKey = `${canon} (${currentDayCanon})`;
              targetDispName = `${dispName} (${currentDayDisplay})`;
            }
          }
        }

        const res: ResolvedClassroom = {
          displayName: targetDispName,
          buildingName: cls.building || bInfo?.name || fallbackRes.buildingName,
          buildingCode: bCode || fallbackRes.buildingCode,
          address: finalAddress,
          campus: bInfo?.campus || fallbackRes.campus,
          latitude: bInfo?.latitude || fallbackRes.latitude,
          longitude: bInfo?.longitude || fallbackRes.longitude,
        };

        if (!roomMap.has(targetKey)) {
          roomMap.set(targetKey, { resolved: res, subjects: new Set() });
        } else {
          const existing = roomMap.get(targetKey)!;
          const existingBCode = (existing.resolved.buildingCode || existing.resolved.buildingName || '')
            .match(/RM\d{3}/i)?.[0]
            ?.toUpperCase();
          const sameBuilding = !existingBCode || !bCode || existingBCode === bCode;

          if (cls.building && (!existing.resolved.buildingName || existing.resolved.buildingName === 'Edificio Sapienza')) {
            existing.resolved.buildingName = cls.building;
          }
          if (bCode && !existing.resolved.buildingCode) {
            existing.resolved.buildingCode = bCode;
          }
          if (bInfo) {
            if (!existing.resolved.latitude || !existing.resolved.longitude) {
              existing.resolved.latitude = bInfo.latitude;
              existing.resolved.longitude = bInfo.longitude;
            }
            if (!existing.resolved.address) {
              existing.resolved.address = bInfo.address;
            }
          }
          // Aggiorna l'indirizzo solo se mancante oppure se appartiene allo stesso edificio (es. rifinitura civico Scarpa 14 -> 16)
          if (finalAddress && (!existing.resolved.address || (sameBuilding && existing.resolved.address.includes('Scarpa 14') && finalAddress.includes('Scarpa 16')))) {
            existing.resolved.address = formatSapienzaAddress(finalAddress, existing.resolved.buildingCode);
          }
        }

        if (cls.subject) {
          roomMap.get(targetKey)!.subjects.add(cls.subject.toUpperCase());
        }
      }
    });
  });

  // 3. Estrai da lezioni manuali dell'utente (aule custom aggiunte dinamicamente e sincronizzate)
  manualEvents.forEach(evt => {
    if (evt.room && (!evt.tabUrl || !tabUrl || evt.tabUrl === tabUrl)) {
      const canon = getCanonicalRoomKey(evt.room);
      const dispName = normalizeDisplayName(evt.room);
      if (!canon || canon === 'aula' || dispName.toLowerCase() === 'aula') return;
      const fallbackRes = resolveClassroom(evt.room, contextHeader);
      const bCode = (fallbackRes.buildingCode || '').match(/RM\d{3}/i)?.[0]?.toUpperCase();
      const bInfo = bCode ? SAPIENZA_BUILDINGS[bCode] : undefined;
      const finalAddress = formatSapienzaAddress(fallbackRes.address, bCode);
      const res: ResolvedClassroom = {
        displayName: dispName,
        buildingName: fallbackRes.buildingName,
        buildingCode: bCode || fallbackRes.buildingCode,
        address: finalAddress,
        campus: bInfo?.campus || fallbackRes.campus,
        latitude: bInfo?.latitude || fallbackRes.latitude,
        longitude: bInfo?.longitude || fallbackRes.longitude,
      };
      if (!roomMap.has(canon)) {
        roomMap.set(canon, { resolved: res, subjects: new Set() });
      } else {
        const existing = roomMap.get(canon)!;
        if (fallbackRes.buildingName && (!existing.resolved.buildingName || existing.resolved.buildingName === 'Edificio Sapienza')) {
          existing.resolved.buildingName = fallbackRes.buildingName;
        }
        if (finalAddress && !existing.resolved.address) {
          existing.resolved.address = finalAddress;
        }
      }
      if (evt.subject) {
        roomMap.get(canon)!.subjects.add(evt.subject.toUpperCase());
      }
    }
  });

  return Array.from(roomMap.values()).map(item => ({
    rawRoom: item.resolved.displayName,
    resolved: item.resolved,
    subjects: Array.from(item.subjects),
  }));
}

export default function AuleScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [schedulesMap, setSchedulesMap] = useState<Record<string, ScheduleData>>({});
  const [manualEvents, setManualEvents] = useState<ManualClassEvent[]>([]);
  const [roomEntries, setRoomEntries] = useState<RoomEntry[]>([]);
  const [selectedRoomModal, setSelectedRoomModal] = useState<RoomEntry | null>(null);
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
        setManualEvents([]);
        setRoomEntries([]);
      }

      setDegreeUrl(storedUrl);

      if (tabs.length === 0 || force || (degreeUrl && storedUrl !== degreeUrl)) {
        setLoading(true);
      }

      // Usa la cache condivisa di tutti i canali scaricati e carica le lezioni manuali
      const [courseData, fetchedManual] = await Promise.all([
        fetchAllCourseData(storedUrl, force),
        getManualEvents(storedUrl || undefined),
      ]);

      setManualEvents(fetchedManual);

      const { tabs: fetchedTabs, schedules } = courseData;

      if (fetchedTabs.length > 0) {
        setTabs(fetchedTabs);
        setSchedulesMap(schedules);

        const currentActive = selectedTab && fetchedTabs.find(t => t.url === selectedTab.url);
        const target = currentActive || fetchedTabs.find(t => t.url === storedDefaultTab) || fetchedTabs[0];

        setSelectedTab(target);
        if (schedules[target.url]) {
          setRoomEntries(extractRoomEntries(schedules[target.url], fetchedManual, target.url));
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

  // Ascolta modifiche alle lezioni manuali (aggiunta o eliminazione lezione con nuova aula)
  useEffect(() => {
    const unsub = subscribeToManualEventsChanges(async () => {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const list = await getManualEvents(storedUrl || undefined);
      setManualEvents(list);
      if (selectedTab && schedulesMap[selectedTab.url]) {
        setRoomEntries(extractRoomEntries(schedulesMap[selectedTab.url], list, selectedTab.url));
      }
    });
    return unsub;
  }, [selectedTab, schedulesMap]);

  // Ascolta la sincronizzazione cloud live per aggiornare le aule su altri dispositivi
  useEffect(() => {
    const unsubSync = subscribeToLiveSync((status, updated) => {
      if (updated) {
        AsyncStorage.getItem('selectedDegreeUrl').then(async (storedUrl) => {
          const list = await getManualEvents(storedUrl || undefined);
          setManualEvents(list);
          if (selectedTab && schedulesMap[selectedTab.url]) {
            setRoomEntries(extractRoomEntries(schedulesMap[selectedTab.url], list, selectedTab.url));
          }
        }).catch(() => {});
      }
    });
    return unsubSync;
  }, [selectedTab, schedulesMap]);

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
      setRoomEntries(extractRoomEntries(schedulesMap[tab.url], manualEvents, tab.url));
    }
  };

  const currentSemester = (selectedTab && schedulesMap[selectedTab.url]?.info?.semester) || '';

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      {/* ── Liquid Glass Header: Titolo "Aule" + Selezione Anni & Canali (fino ai canali) ── */}
      <View style={[styles.liquidGlassHeader, { paddingTop: insets.top > 0 ? insets.top + 6 : 14 }]}>
        <BlurView tint="dark" intensity={65} style={StyleSheet.absoluteFill} />
        <View style={styles.liquidGlassOverlay} />

        {/* Titolo iOS Large Title "Aule" */}
        <View style={styles.liquidGlassTitleRow}>
          <Text style={styles.liquidGlassTitle}>Aule</Text>
        </View>

        {/* Selezione Gerarchica Anni e Canali */}
        <YearChannelSelector
          tabs={tabs}
          selectedTab={selectedTab}
          onSelectTab={onSelectTab}
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
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        {/* ── Periodo Didattico / Semestre (Mostrato solo se contiene informazioni sulla data) ── */}
        {currentSemester && hasDateInfo(currentSemester) ? (
          <View style={styles.centeredCardContainer}>
            <View style={[styles.semesterCard, { borderColor: theme.border }]}>
              <View style={[styles.semesterIconBox, { backgroundColor: theme.primary }]}>
                <Ionicons name="calendar" size={16} color="#ffffff" />
              </View>
              <View style={styles.semesterContent}>
                <Text style={[styles.semesterTitle, { color: theme.accent }]}>CALENDARIO DIDATTICO</Text>
                <Text style={styles.semesterValue} numberOfLines={2}>
                  {currentSemester}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loadingText}>Carico le aule...</Text>
          </View>
        ) : (
          <View style={styles.list}>
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
                  activeOpacity={0.82}
                  onPress={() => setSelectedRoomModal(entry)}
                >
                  {/* Top Row: Squircle Icon + Aula & Edificio + Action Circle */}
                  <View style={styles.cardHeader}>
                    <View
                      style={[
                        styles.iconSquircle,
                        {
                          backgroundColor: theme.cardTint,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Ionicons name="school" size={20} color={theme.accent} />
                    </View>

                    <View style={styles.titleBlock}>
                      <Text style={styles.roomName} numberOfLines={1}>
                        {entry.resolved.displayName}
                      </Text>
                      {Boolean(entry.resolved.buildingName) && (
                        <View style={styles.buildingRow}>
                          <Ionicons name="business-outline" size={12} color="#8e8e93" />
                          <Text style={styles.buildingName} numberOfLines={1}>
                            {entry.resolved.buildingName}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.chevronPill}>
                      <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />
                    </View>
                  </View>

                  {/* Address Row */}
                  {Boolean(entry.resolved.address) && (
                    <View style={styles.addressRow}>
                      <Ionicons name="navigate" size={13} color={theme.accent} />
                      <Text style={styles.addressText} numberOfLines={1}>
                        {entry.resolved.address}
                      </Text>
                    </View>
                  )}

                  {/* Rounded Capsule Subject Pills */}
                  {entry.subjects.length > 0 && (
                    <View style={styles.subjectsRow}>
                      {entry.subjects.slice(0, 3).map((sub, sIdx) => (
                        <View key={sIdx} style={styles.subBadge}>
                          <Text style={styles.subBadgeText} numberOfLines={1}>
                            {sub}
                          </Text>
                        </View>
                      ))}
                      {entry.subjects.length > 3 && (
                        <View
                          style={[
                            styles.subBadgeMore,
                            {
                              backgroundColor: theme.cardTint,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <Text style={[styles.subBadgeMoreText, { color: theme.accent }]}>
                            +{entry.subjects.length - 3}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>

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
    backgroundColor: UNIFORM_SCREEN_BG,
  },
  mainScrollView: {
    flex: 1,
  },
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
    paddingTop: 6,
    paddingBottom: 16,
  },
  liquidGlassTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.35,
  },
  centeredCardContainer: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  semesterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.4)',
    width: '100%',
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
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 24,
    borderCurve: 'continuous',
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  iconSquircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13,
  },
  titleBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  roomName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  buildingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2.5,
  },
  buildingName: {
    color: '#8e8e93',
    fontSize: 13,
    fontWeight: '500',
  },
  chevronPill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 2,
  },
  addressText: {
    color: '#c4c4cc',
    fontSize: 13.5,
    fontWeight: '500',
    flex: 1,
  },
  subjectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 11,
  },
  subBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    maxWidth: 195,
  },
  subBadgeText: {
    color: '#e4e4e7',
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  subBadgeMore: {
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subBadgeMoreText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  loadingText: {
    color: '#8e8e93',
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  emptyText: {
    color: '#3a3a3c',
    fontSize: 15,
    marginTop: 12,
  },
});
