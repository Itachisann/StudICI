import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { CommuterConfig, CommuterItinerary, TripLeg } from '../types/commuter';
import { getCommuterConfig, saveCommuterConfig } from '../utils/commuterStorage';
import { computeCommuterItinerary } from '../utils/commuterOptimizer';
import { fetchAllCourseData } from '../utils/scraper';
import { CommuterConfigModal } from '../components/CommuterConfigModal';

const SAPIENZA_RED = '#822433';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === 'ios' && !isExpoGo;

const WEEKDAYS = [
  { label: 'Lun', dayIdx: 1 },
  { label: 'Mar', dayIdx: 2 },
  { label: 'Mer', dayIdx: 3 },
  { label: 'Gio', dayIdx: 4 },
  { label: 'Ven', dayIdx: 5 },
];

export default function ViaggioScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [config, setConfig] = useState<CommuterConfig | null>(null);
  const [itinerary, setItinerary] = useState<CommuterItinerary | null>(null);
  const [direction, setDirection] = useState<'outbound' | 'return'>('outbound');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1; // lunedì se weekend
  });
  const [configModalVisible, setConfigModalVisible] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const currentConfig = await getCommuterConfig();
      setConfig(currentConfig);

      // Carica i dati dell'orario dal corso selezionato
      let sched: any = null;
      try {
        const url = await AsyncStorage.getItem('selectedDegreeUrl');
        const defaultTab = await AsyncStorage.getItem('defaultTabUrl');
        if (url) {
          const courseData = await fetchAllCourseData(url);
          const activeTab = courseData.tabs.find((t) => t.url === defaultTab) || courseData.tabs[0];
          if (activeTab) {
            sched = courseData.schedules[activeTab.name] || null;
          }
        }
      } catch {}

      // Calcola data target in base al giorno selezionato
      const targetDate = new Date();
      const currentDay = targetDate.getDay();
      const diff = selectedDayIdx - (currentDay === 0 ? 7 : currentDay);
      targetDate.setDate(targetDate.getDate() + diff);

      const itin = await computeCommuterItinerary({
        config: currentConfig,
        scheduleData: sched,
        direction,
        targetDate,
      });

      setItinerary(itin);
    } catch (err: any) {
      console.warn('Errore calcolo itinerario pendolare', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [direction, selectedDayIdx]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleSaveConfig = async (newConfig: CommuterConfig) => {
    const saved = await saveCommuterConfig(newConfig);
    setConfig(saved);
    loadData();
  };

  const handleOpenMaps = (leg: TripLeg) => {
    const query = leg.details?.mapQuery;
    const mode = leg.details?.travelMode || 'driving';

    if (!query) {
      Alert.alert('Navigazione', 'Nessuna destinazione specifica per questa tratta.');
      return;
    }

    const encoded = encodeURIComponent(query);
    const appleFlag = mode === 'transit' ? 'r' : mode === 'walking' ? 'w' : 'd';
    const appleUrl = `http://maps.apple.com/?daddr=${encoded}&dirflg=${appleFlag}`;
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=${mode}`;

    Linking.canOpenURL('http://maps.apple.com/')
      .then((supported) => {
        if (supported && Platform.OS === 'ios') {
          Linking.openURL(appleUrl);
        } else {
          Linking.openURL(googleUrl);
        }
      })
      .catch(() => Linking.openURL(googleUrl));
  };

  const directionIndex = direction === 'outbound' ? 0 : 1;
  const directionTitles = ['Andata (Verso Aula)', 'Ritorno (Verso Casa)'];

  return (
    <View style={styles.container}>
      <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Top Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Viaggio Pendolare</Text>
            <Text style={styles.headerSubtitle}>
              {config?.originAddress || 'Partenza'} ➔ Sapienza ({config?.departureStation.shortName || 'Orte'} ➔ {config?.arrivalStation.shortName || 'Roma'})
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={() => loadData(true)}
            >
              <Ionicons name="refresh" size={19} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerIconBtn, { marginLeft: 8 }]}
              activeOpacity={0.7}
              onPress={() => setConfigModalVisible(true)}
            >
              <Ionicons name="options-outline" size={20} color="#38bdf8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Segmented Control Andata / Ritorno */}
        <View style={styles.switcherContainer}>
          {isNativeIos ? (
            <SegmentedControl
              values={directionTitles}
              selectedIndex={directionIndex}
              onChange={(event) => {
                const idx = event.nativeEvent.selectedSegmentIndex;
                setDirection(idx === 0 ? 'outbound' : 'return');
              }}
              style={styles.nativeSegmentedControl}
            />
          ) : (
            <View style={styles.customSegmentedControl}>
              <TouchableOpacity
                style={[
                  styles.customSegmentBtn,
                  direction === 'outbound' && styles.customSegmentBtnActive,
                ]}
                onPress={() => setDirection('outbound')}
              >
                <Ionicons
                  name="school-outline"
                  size={15}
                  color={direction === 'outbound' ? '#fff' : '#94a3b8'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.customSegmentText,
                    direction === 'outbound' && styles.customSegmentTextActive,
                  ]}
                >
                  Andata (Verso Aula)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.customSegmentBtn,
                  direction === 'return' && styles.customSegmentBtnActive,
                ]}
                onPress={() => setDirection('return')}
              >
                <Ionicons
                  name="home-outline"
                  size={15}
                  color={direction === 'return' ? '#fff' : '#94a3b8'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.customSegmentText,
                    direction === 'return' && styles.customSegmentTextActive,
                  ]}
                >
                  Ritorno (Verso Casa)
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Selettore Giorno della settimana */}
        <View style={styles.daysContainer}>
          {WEEKDAYS.map((w) => {
            const isSelected = selectedDayIdx === w.dayIdx;
            return (
              <TouchableOpacity
                key={w.dayIdx}
                style={[styles.dayPill, isSelected && styles.dayPillActive]}
                onPress={() => setSelectedDayIdx(w.dayIdx)}
              >
                <Text style={[styles.dayPillText, isSelected && styles.dayPillTextActive]}>
                  {w.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Corpo Principale */}
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={SAPIENZA_RED} />
            <Text style={styles.loadingText}>Calcolo tempi e binari Trenitalia...</Text>
          </View>
        ) : !itinerary ? (
          <View style={styles.centerContainer}>
            <Ionicons name="train-outline" size={44} color="#64748b" />
            <Text style={styles.emptyTitle}>Nessun itinerario calcolato</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => loadData()}>
              <Text style={styles.primaryBtnText}>Ricalcola</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadData(true)}
                tintColor={SAPIENZA_RED}
              />
            }
          >
            {/* Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: `${itinerary.statusBadge.color}22` },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: itinerary.statusBadge.color },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: itinerary.statusBadge.color },
                    ]}
                  >
                    {itinerary.statusBadge.text}
                  </Text>
                </View>

                <View style={styles.durationBadge}>
                  <Ionicons name="time-outline" size={13} color="#94a3b8" style={{ marginRight: 4 }} />
                  <Text style={styles.durationBadgeText}>
                    {Math.floor(itinerary.totalDurationMinutes / 60)}h{' '}
                    {itinerary.totalDurationMinutes % 60}m
                  </Text>
                </View>
              </View>

              <Text style={styles.heroHeadline}>
                {direction === 'outbound' ? 'Parti da casa alle' : 'Rientro previsto alle'}
              </Text>
              <Text style={styles.heroBigTime}>
                {direction === 'outbound' ? itinerary.departureTime : itinerary.arrivalTime}
              </Text>

              <View style={styles.heroTargetLectureBox}>
                <Ionicons
                  name={direction === 'outbound' ? 'school' : 'home'}
                  size={16}
                  color="#38bdf8"
                  style={{ marginRight: 8 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLectureSubject} numberOfLines={1}>
                    {direction === 'outbound'
                      ? itinerary.targetLecture?.subject || 'Lezione'
                      : `Rientro ad ${config?.originAddress}`}
                  </Text>
                  <Text style={styles.heroLectureDetails} numberOfLines={1}>
                    {direction === 'outbound'
                      ? `${itinerary.targetLecture?.room} • Inizio ore ${itinerary.targetLecture?.startTime}`
                      : `Fine lezioni ore ${itinerary.targetLecture?.endTime}`}
                  </Text>
                </View>
              </View>
            </View>

            {/* Dettaglio Treno Live Risaltato */}
            {itinerary.liveTrain && (
              <View style={styles.trainHighlightCard}>
                <View style={styles.trainHighlightHeader}>
                  <View style={styles.trainNumberBadge}>
                    <Ionicons name="train" size={15} color="#fff" style={{ marginRight: 5 }} />
                    <Text style={styles.trainNumberText}>{itinerary.liveTrain.trainNumber}</Text>
                  </View>
                  <View
                    style={[
                      styles.trainDelayBadge,
                      {
                        backgroundColor:
                          itinerary.liveTrain.delayMinutes > 0
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(52, 199, 89, 0.15)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.trainDelayText,
                        {
                          color:
                            itinerary.liveTrain.delayMinutes > 0 ? '#ef4444' : '#34c759',
                        },
                      ]}
                    >
                      {itinerary.liveTrain.statusDescription}
                    </Text>
                  </View>
                </View>

                <View style={styles.trainInfoRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trainStationLabel}>Partenza</Text>
                    <Text style={styles.trainStationName}>
                      {direction === 'outbound'
                        ? config?.departureStation.shortName || config?.departureStation.name
                        : config?.arrivalStation.shortName || config?.arrivalStation.name}
                    </Text>
                    <Text style={styles.trainTimeText}>
                      {itinerary.liveTrain.departureTimeActual || itinerary.liveTrain.departureTimePlanned}
                    </Text>
                  </View>

                  {/* Binario Live Risaltato */}
                  <View style={styles.platformHighlightBox}>
                    <Text style={styles.platformHighlightLabel}>BINARIO</Text>
                    <Text style={styles.platformHighlightValue}>
                      {itinerary.liveTrain.platformActual ||
                        itinerary.liveTrain.platformPlanned ||
                        '-'}
                    </Text>
                    {itinerary.liveTrain.isLive && (
                      <View style={styles.liveTag}>
                        <Text style={styles.liveTagText}>LIVE</Text>
                      </View>
                    )}
                  </View>

                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.trainStationLabel}>Arrivo</Text>
                    <Text style={styles.trainStationName}>
                      {direction === 'outbound'
                        ? config?.arrivalStation.shortName || config?.arrivalStation.name
                        : config?.departureStation.shortName || config?.departureStation.name}
                    </Text>
                    <Text style={styles.trainTimeText}>
                      {itinerary.liveTrain.arrivalTimeActual || itinerary.liveTrain.arrivalTimePlanned}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Timeline dei passaggi */}
            <Text style={styles.timelineSectionTitle}>TAPPE DEL VIAGGIO</Text>

            <View style={styles.timelineContainer}>
              {itinerary.legs.map((leg, index) => {
                const isFirst = index === 0;
                const isLast = index === itinerary.legs.length - 1;

                let iconName: keyof typeof Ionicons.glyphMap = 'navigate';
                let iconColor = '#38bdf8';
                let circleBg = 'rgba(56, 189, 248, 0.15)';

                if (leg.type === 'car') {
                  iconName = 'car';
                  iconColor = '#fb923c';
                  circleBg = 'rgba(251, 146, 60, 0.15)';
                } else if (leg.type === 'train') {
                  iconName = 'train';
                  iconColor = '#38bdf8';
                  circleBg = 'rgba(56, 189, 248, 0.2)';
                } else if (leg.type === 'transit') {
                  iconName = 'bus';
                  iconColor = '#a855f7';
                  circleBg = 'rgba(168, 85, 247, 0.15)';
                } else if (leg.type === 'destination') {
                  iconName = direction === 'outbound' ? 'school' : 'home';
                  iconColor = SAPIENZA_RED;
                  circleBg = 'rgba(130, 36, 51, 0.2)';
                } else if (leg.type === 'wait') {
                  iconName = 'pause';
                  iconColor = '#94a3b8';
                  circleBg = 'rgba(148, 163, 184, 0.15)';
                }

                return (
                  <View key={leg.id} style={styles.timelineStepRow}>
                    {/* Colonna Orario */}
                    <View style={styles.timeColumn}>
                      <Text style={styles.timeStartText}>{leg.startTime}</Text>
                      <Text style={styles.timeEndText}>{leg.endTime}</Text>
                    </View>

                    {/* Colonna Linea & Icona */}
                    <View style={styles.lineIconColumn}>
                      <View style={[styles.stepIconCircle, { backgroundColor: circleBg }]}>
                        <Ionicons name={iconName} size={15} color={iconColor} />
                      </View>
                      {!isLast && <View style={styles.connectingLine} />}
                    </View>

                    {/* Contenuto Tappa */}
                    <View style={[styles.stepContentCard, isFirst && { marginTop: 0 }]}>
                      <View style={styles.stepTitleRow}>
                        <Text style={styles.stepTitleText} numberOfLines={1}>
                          {leg.title}
                        </Text>
                        <Text style={styles.stepDurationText}>{leg.durationMinutes}m</Text>
                      </View>

                      <Text style={styles.stepSubtitleText}>{leg.subtitle}</Text>

                      {/* Dettagli extra (es. binario treno o note) */}
                      {leg.details?.notes && (
                        <Text style={styles.stepNotesText}>{leg.details.notes}</Text>
                      )}

                      {/* Pulsante Apri Mappe */}
                      {leg.details?.mapQuery && (
                        <TouchableOpacity
                          style={styles.mapsBtn}
                          activeOpacity={0.7}
                          onPress={() => handleOpenMaps(leg)}
                        >
                          <Ionicons
                            name={
                              leg.details.travelMode === 'transit'
                                ? 'bus-outline'
                                : 'navigate-outline'
                            }
                            size={13}
                            color="#38bdf8"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.mapsBtnText}>
                            {leg.details.travelMode === 'transit'
                              ? 'Apri Mappe Mezzi'
                              : 'Naviga con Mappe'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Messaggio Riepilogo */}
            <View style={styles.summaryFooterBox}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color="#94a3b8"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.summaryFooterText}>{itinerary.summaryMessage}</Text>
            </View>
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
    backgroundColor: '#0c0e12',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  switcherContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  nativeSegmentedControl: {
    height: 36,
  },
  customSegmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 3,
  },
  customSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 9,
  },
  customSegmentBtnActive: {
    backgroundColor: SAPIENZA_RED,
  },
  customSegmentText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  customSegmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  daysContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  dayPill: {
    flex: 1,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    alignItems: 'center',
  },
  dayPillActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  dayPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  dayPillTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  heroCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
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
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  durationBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  heroHeadline: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  heroBigTime: {
    fontSize: 42,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -1,
    marginVertical: 4,
  },
  heroTargetLectureBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },
  heroLectureSubject: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  heroLectureDetails: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  trainHighlightCard: {
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 14,
    marginBottom: 16,
  },
  trainHighlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trainNumberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284c7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  trainNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  trainDelayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  trainDelayText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trainInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trainStationLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  trainStationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginTop: 2,
  },
  trainTimeText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#38bdf8',
    marginTop: 2,
  },
  platformHighlightBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  platformHighlightLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  platformHighlightValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  liveTag: {
    backgroundColor: '#34c759',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
  },
  liveTagText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#000',
  },
  timelineSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  timelineContainer: {
    marginBottom: 16,
  },
  timelineStepRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  timeColumn: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: 8,
    paddingTop: 6,
  },
  timeStartText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  timeEndText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  lineIconColumn: {
    alignItems: 'center',
    width: 28,
  },
  stepIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  connectingLine: {
    width: 2,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 4,
  },
  stepContentCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 12,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  stepTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
    marginRight: 6,
  },
  stepDurationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  stepSubtitleText: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
  },
  stepNotesText: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 2,
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 8,
  },
  mapsBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#38bdf8',
  },
  summaryFooterBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  summaryFooterText: {
    fontSize: 12,
    color: '#94a3b8',
    flex: 1,
    lineHeight: 16,
  },
});
