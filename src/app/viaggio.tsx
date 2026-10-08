import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Clipboard from 'expo-clipboard';

import { CommuterConfig, CommuterItinerary, TripLeg, LiveTrainInfo } from '../types/commuter';
import { getCommuterConfig, saveCommuterConfig } from '../utils/commuterStorage';
import { computeCommuterItinerary } from '../utils/commuterOptimizer';
import { fetchAllCourseData, fetchScheduleData, ScheduleData, ClassEvent } from '../utils/scraper';
import { parseTimeToMinutes, evaluateTrainStatus } from '../utils/trenitaliaApi';
import { CommuterConfigModal } from '../components/CommuterConfigModal';
import { useTheme } from '@/context/ThemeContext';

const SAPIENZA_RED = '#822433';
const SAPIENZA_RED_ACCENT = '#e05666';
const SAPIENZA_RED_LIGHT = '#f87171';
const SAPIENZA_RED_BG = 'rgba(130, 36, 51, 0.45)';
const SAPIENZA_RED_BORDER = 'rgba(130, 36, 51, 0.4)';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === 'ios' && !isExpoGo;

const WEEKDAYS = [
  { label: 'LUN', dayIdx: 1 },
  { label: 'MAR', dayIdx: 2 },
  { label: 'MER', dayIdx: 3 },
  { label: 'GIO', dayIdx: 4 },
  { label: 'VEN', dayIdx: 5 },
];

export default function ViaggioScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [config, setConfig] = useState<CommuterConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [itinerary, setItinerary] = useState<CommuterItinerary | null>(null);
  const [direction, setDirection] = useState<'outbound' | 'return'>('outbound');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1; // lunedì se weekend
  });
  const [selectedClassIndex, setSelectedClassIndex] = useState<number | null>(null);
  const [selectedTrainOffset, setSelectedTrainOffset] = useState<number>(0);
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string | null>(null);
  const [configModalVisible, setConfigModalVisible] = useState(false);

  const trainChipsScrollRef = useRef<ScrollView>(null);
  const trainScrollWidthRef = useRef<number>(0);
  const chipLayoutsRef = useRef<{ [key: string]: { x: number; width: number } }>({});

  const centerSelectedTrain = useCallback((trainNum: string) => {
    const cleanNum = trainNum.replace(/\D/g, '');
    const entry = Object.entries(chipLayoutsRef.current).find(
      ([k]) => k.replace(/\D/g, '') === cleanNum
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
  const trainStatus = useMemo(() => {
    if (!liveTrain) return null;
    const targetDate = new Date();
    const currentDay = targetDate.getDay();
    let diff = selectedDayIdx - (currentDay === 0 ? 7 : currentDay);
    if (diff < 0) diff += 7;
    targetDate.setDate(targetDate.getDate() + diff);
    return evaluateTrainStatus(liveTrain, targetDate);
  }, [liveTrain, selectedDayIdx]);

  // Lezioni del giorno selezionato
  const dayClasses = useMemo(() => {
    const dayScheduleIndex = selectedDayIdx - 1;
    if (!schedule?.days || !schedule.days[dayScheduleIndex]) return [];
    return [...schedule.days[dayScheduleIndex]].sort(
      (a, b) =>
        parseTimeToMinutes(a.startTime || '08:30') -
        parseTimeToMinutes(b.startTime || '08:30')
    );
  }, [schedule, selectedDayIdx]);

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
      if (direction === 'outbound') {
        const upcoming = dayClasses.find(
          (c) => parseTimeToMinutes(c.startTime || '08:30') >= nowMins - 15
        );
        return upcoming || dayClasses[dayClasses.length - 1];
      } else {
        const pastOrActive = [...dayClasses].reverse().find(
          (c) => parseTimeToMinutes(c.endTime || '18:00') <= nowMins + 30
        );
        return pastOrActive || dayClasses[dayClasses.length - 1];
      }
    }

    return direction === 'outbound' ? dayClasses[0] : dayClasses[dayClasses.length - 1];
  }, [dayClasses, selectedClassIndex, selectedDayIdx, direction]);

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const currentConfig = await getCommuterConfig();
        setConfig(currentConfig);

        // Carica i dati dell'orario reale dal corso selezionato
        let sched: ScheduleData | null = null;
        try {
          const url = await AsyncStorage.getItem('selectedDegreeUrl');
          const defaultTab = await AsyncStorage.getItem('defaultTabUrl');
          if (url) {
            const courseData = await fetchAllCourseData(url);
            const activeTab =
              courseData.tabs.find((t) => t.url === defaultTab) || courseData.tabs[0];
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
          console.warn('Errore lettura schedule corso:', err);
        }

        setSchedule(sched);

        // Calcola data target in base al giorno selezionato
        const targetDate = new Date();
        const currentDay = targetDate.getDay();
        let diff = selectedDayIdx - (currentDay === 0 ? 7 : currentDay);
        if (diff < 0) {
          diff += 7; // Se il giorno è già trascorso nella settimana corrente, proietta al prossimo giorno utile
        }
        targetDate.setDate(targetDate.getDate() + diff);

        // Determina la lezione target per il calcolo
        const dayScheduleIndex = selectedDayIdx - 1;
        const currentDayClasses =
          sched?.days && sched.days[dayScheduleIndex]
            ? [...sched.days[dayScheduleIndex]].sort(
                (a, b) =>
                  parseTimeToMinutes(a.startTime || '08:30') -
                  parseTimeToMinutes(b.startTime || '08:30')
              )
            : [];

        let targetClassForCalculation: ClassEvent | null = null;
        if (selectedClassIndex !== null && currentDayClasses[selectedClassIndex]) {
          targetClassForCalculation = currentDayClasses[selectedClassIndex];
        } else if (currentDayClasses.length > 0) {
          const now = new Date();
          const isToday = now.getDay() === selectedDayIdx;
          if (isToday) {
            const nowMins = now.getHours() * 60 + now.getMinutes();
            if (direction === 'outbound') {
              const upcoming = currentDayClasses.find(
                (c) => parseTimeToMinutes(c.startTime || '08:30') >= nowMins - 15
              );
              targetClassForCalculation = upcoming || currentDayClasses[currentDayClasses.length - 1];
            } else {
              const pastOrActive = [...currentDayClasses].reverse().find(
                (c) => parseTimeToMinutes(c.endTime || '18:00') <= nowMins + 30
              );
              targetClassForCalculation = pastOrActive || currentDayClasses[currentDayClasses.length - 1];
            }
          } else {
            targetClassForCalculation =
              direction === 'outbound'
                ? currentDayClasses[0]
                : currentDayClasses[currentDayClasses.length - 1];
          }
        }

        // Imposta l'orario del viaggio su targetDate per centrare la ricerca ViaggiaTreno
        if (targetClassForCalculation) {
          const timeToUse =
            direction === 'outbound'
              ? targetClassForCalculation.startTime || '08:30'
              : targetClassForCalculation.endTime || '16:00';
          const [hh, mm] = timeToUse.split(':').map(Number);
          targetDate.setHours(hh || 8, mm || 30, 0, 0);
        } else {
          targetDate.setHours(direction === 'outbound' ? 8 : 16, 30, 0, 0);
        }

        const itin = await computeCommuterItinerary({
          config: currentConfig,
          scheduleData: sched,
          direction,
          targetDate,
          selectedClass: targetClassForCalculation,
          selectedTrainOffset,
          selectedTrainNumber: selectedTrainNumber || undefined,
        });

        setItinerary(itin);
      } catch (err: any) {
        console.warn('Errore calcolo itinerario pendolare', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [direction, selectedDayIdx, selectedClassIndex, selectedTrainOffset, selectedTrainNumber]
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleDayChange = (dayIdx: number) => {
    setSelectedDayIdx(dayIdx);
    setSelectedClassIndex(null);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
  };

  const handleDirectionChange = (newDir: 'outbound' | 'return') => {
    setDirection(newDir);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
  };

  const handleSelectClass = (idx: number) => {
    setSelectedClassIndex(idx);
    setSelectedTrainOffset(0);
    setSelectedTrainNumber(null);
  };

  const handleTrainPrev = () => {
    setSelectedTrainOffset((prev) => prev - 1);
    setSelectedTrainNumber(null);
  };

  const handleTrainNext = () => {
    setSelectedTrainOffset((prev) => prev + 1);
    setSelectedTrainNumber(null);
  };

  const handleSelectTrainChip = (trainNum: string) => {
    setSelectedTrainNumber(trainNum);
    setSelectedTrainOffset(0);
  };

  const handleSaveConfig = async (newConfig: CommuterConfig) => {
    const saved = await saveCommuterConfig(newConfig);
    setConfig(saved);
    loadData();
  };

  const handleOpenMaps = (leg: TripLeg) => {
    const dest = leg.details?.mapQuery;
    const origin = leg.details?.mapOriginQuery;
    const mode = leg.details?.travelMode || 'transit';

    if (!dest) {
      Alert.alert('Navigazione', 'Nessuna destinazione specifica per questa tratta.');
      return;
    }

    const encodedDest = encodeURIComponent(dest);
    const encodedOrigin = origin ? encodeURIComponent(origin) : '';

    // Modalità di viaggio per Google Maps: transit | driving | walking
    const gmapsMode = mode === 'transit' ? 'transit' : mode === 'walking' ? 'walking' : 'driving';

    // 1. URL per App nativa Google Maps su iOS / Android (comgooglemaps://)
    const gmapsAppUrl = origin
      ? `comgooglemaps://?saddr=${encodedOrigin}&daddr=${encodedDest}&directionsmode=${gmapsMode}`
      : `comgooglemaps://?daddr=${encodedDest}&directionsmode=${gmapsMode}`;

    // 2. URL per Google Maps Web / Universale (precisissimo con passaggi e fermate ATAC Roma)
    const gmapsWebUrl = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodedOrigin}&destination=${encodedDest}&travelmode=${gmapsMode}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodedDest}&travelmode=${gmapsMode}`;

    // Prova ad aprire direttamente l'app Google Maps ("nel modo di prima"); se non installata, apre il browser
    Linking.canOpenURL('comgooglemaps://')
      .then((supported) => {
        if (supported) {
          Linking.openURL(gmapsAppUrl);
        } else {
          Linking.openURL(gmapsWebUrl);
        }
      })
      .catch(() => Linking.openURL(gmapsWebUrl));
  };

  const handleOpenTrainLive = async (train?: LiveTrainInfo | null) => {
    const rawNum = train?.trainNumber || '';
    const cleanNum = rawNum.replace(/\D/g, '');
    if (cleanNum) {
      try {
        await Clipboard.setStringAsync(cleanNum);
      } catch {}
    }

    let targetUrl = `http://www.viaggiatreno.it/infomobilitamobile/pages/cercaTreno/cercaTreno.jsp?treno=${cleanNum || ''}`;
    if (cleanNum && train?.originStationCode && train?.departureMillis) {
      targetUrl = `http://www.viaggiatreno.it/infomobilitamobile/pages/cercaTreno/cercaTreno.jsp?treno=${cleanNum}&origine=${train.originStationCode}&datapartenza=${train.departureMillis}`;
    }

    // Trenitalia non espone un deep link pubblico per singolo treno: se l'app è
    // installata la apriamo (il numero treno è già negli appunti), altrimenti
    // ripieghiamo sulla scheda ViaggiaTreno di quel treno.
    try {
      const appInstalled = await Linking.canOpenURL('trenitalia://');
      if (appInstalled) {
        await Linking.openURL('trenitalia://');
        return;
      }
    } catch {}

    Linking.openURL(targetUrl).catch((err) => {
      console.warn('Errore apertura link treno:', err);
    });
  };

  const directionIndex = direction === 'outbound' ? 0 : 1;
  const directionTitles = ['Andata', 'Ritorno'];

  return (
    <View style={styles.container}>
      <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        {/* ── Liquid Glass Header: Titolo "Viaggio" + Segmented Control + Giorni della Settimana ── */}
        <View
          style={[
            styles.liquidGlassHeader,
            { paddingTop: insets.top > 0 ? insets.top + 6 : 14 },
          ]}
        >
          <BlurView tint="dark" intensity={65} style={StyleSheet.absoluteFill} />
          <View style={styles.liquidGlassOverlay} />

          {/* Titolo iOS Large Title "Viaggio" */}
          <View style={styles.liquidGlassTitleRow}>
            <Text style={styles.liquidGlassTitle}>Viaggio</Text>
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
                <Ionicons name="options-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Segmented Control Andata / Ritorno */}
          <View style={styles.switcherContainer}>
            {isNativeIos ? (
              <SegmentedControl
                key={`seg-viaggio-${directionIndex}-${theme.primary}`}
                values={directionTitles}
                selectedIndex={directionIndex}
                onChange={(event) => {
                  const idx = event.nativeEvent.selectedSegmentIndex;
                  handleDirectionChange(idx === 0 ? 'outbound' : 'return');
                }}
                appearance="dark"
                tintColor={theme.primary}
                fontStyle={{ fontSize: 13, fontWeight: '600', color: '#a1a1aa' }}
                activeFontStyle={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}
                style={styles.nativeSegmentedControl}
              />
            ) : (
              <View style={styles.customSegmentedControl}>
                <TouchableOpacity
                  style={[
                    styles.customSegmentBtn,
                    direction === 'outbound' && [
                      styles.customSegmentBtnActive,
                      { backgroundColor: theme.bg, borderColor: theme.primary },
                    ],
                  ]}
                  activeOpacity={0.7}
                  onPress={() => handleDirectionChange('outbound')}
                >
                  <Ionicons
                    name="school-outline"
                    size={15}
                    color={direction === 'outbound' ? '#fff' : '#a1a1aa'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.customSegmentText,
                      direction === 'outbound' && styles.customSegmentTextActive,
                    ]}
                  >
                    Andata
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.customSegmentBtn,
                    direction === 'return' && [
                      styles.customSegmentBtnActive,
                      { backgroundColor: theme.bg, borderColor: theme.primary },
                    ],
                  ]}
                  activeOpacity={0.7}
                  onPress={() => handleDirectionChange('return')}
                >
                  <Ionicons
                    name="home-outline"
                    size={15}
                    color={direction === 'return' ? '#fff' : '#a1a1aa'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.customSegmentText,
                      direction === 'return' && styles.customSegmentTextActive,
                    ]}
                  >
                    Ritorno
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Selettore Giorno della settimana (finisce qui lo sfondo arrotondato) */}
          <View style={styles.daySelectorContainer}>
            <TouchableOpacity
              style={styles.navArrow}
              onPress={() => handleDayChange(selectedDayIdx === 1 ? 5 : selectedDayIdx - 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={18} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.daysRow}>
              {WEEKDAYS.map((w) => {
                const isSelected = selectedDayIdx === w.dayIdx;
                const isToday = new Date().getDay() === w.dayIdx;
                return (
                  <TouchableOpacity
                    key={w.dayIdx}
                    onPress={() => handleDayChange(w.dayIdx)}
                    style={styles.dayItem}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && [
                          styles.dayCircleActive,
                          { backgroundColor: theme.bg, borderColor: theme.primary },
                        ],
                      ]}
                    >
                      <Text
                        style={[styles.dayText, isSelected && styles.dayTextActive]}
                      >
                        {w.label}
                      </Text>
                    </View>
                    {isToday && (
                      <View
                        style={[
                          styles.dayDot,
                          isSelected && [
                            styles.dayDotActive,
                            { backgroundColor: theme.primary },
                          ],
                        ]}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.navArrow}
              onPress={() => handleDayChange(selectedDayIdx === 5 ? 1 : selectedDayIdx + 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sezione Selettore Lezioni del Giorno */}
        <View style={styles.lecturesSection}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="book-outline" size={13} color={theme.accent} style={{ marginRight: 5 }} />
              <Text style={[styles.sectionTitle, { color: theme.accent }]}>LEZIONI DEL GIORNO</Text>
            </View>
          </View>

          {dayClasses.length === 0 ? (
            <View style={[styles.noClassesCard, { borderColor: theme.border }]}>
              <Ionicons name="sunny-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
              <Text style={styles.noClassesText}>Nessuna lezione in programma per questo giorno</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
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
                        { backgroundColor: theme.cardTint, borderColor: theme.primary },
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
                          color={isSelected ? '#fff' : theme.accent}
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
                        <View style={[styles.targetBadge, { backgroundColor: theme.primary }]}>
                          <Ionicons name="checkmark-circle" size={12} color="#fff" style={{ marginRight: 3 }} />
                          <Text style={styles.targetBadgeText}>Target</Text>
                        </View>
                      )}
                    </View>

                    <Text
                      style={[styles.classSubjectText, isSelected && styles.classSubjectTextSelected]}
                      numberOfLines={2}
                    >
                      {item.subject}
                    </Text>

                    <View style={styles.classRoomRow}>
                      <Ionicons
                        name="location-outline"
                        size={12}
                        color={isSelected ? theme.light : '#94a3b8'}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.classRoomText,
                          isSelected && [styles.classRoomTextSelected, { color: theme.light }],
                        ]}
                        numberOfLines={1}
                      >
                        {item.room || 'Aula'}{item.building ? ` • ${item.building}` : ''}
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
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loadingText}>Calcolo tempi, treni regionali e linee dirette...</Text>
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
                tintColor={theme.primary}
              />
            }
          >
            {/* Hero Card */}
            <View style={[styles.heroCard, { backgroundColor: theme.cardTint, borderColor: theme.border }]}>
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

              <View style={[styles.heroTargetLectureBox, { backgroundColor: theme.subtle, borderColor: theme.border }]}>
                <Ionicons
                  name={direction === 'outbound' ? 'school' : 'home'}
                  size={16}
                  color={theme.accent}
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

            {/* Dettaglio Treno Regionale e Switcher Alternative (Tocca per aprire Trenitalia) */}
            {itinerary.liveTrain && (
              <TouchableOpacity
                style={[
                  styles.trainHighlightCard,
                  { backgroundColor: '#1c1c1e', borderColor: theme.border, borderWidth: 1 },
                ]}
                activeOpacity={0.88}
                onPress={() => handleOpenTrainLive(itinerary.liveTrain)}
              >
                <View style={styles.trainHighlightHeader}>
                  <View style={styles.trainHighlightHeaderLeft}>
                    <View style={[styles.trainNumberBadge, { backgroundColor: theme.primary }]}>
                      <Ionicons name="train" size={14} color="#fff" style={{ marginRight: 5 }} />
                      <Text style={styles.trainNumberText}>{itinerary.liveTrain.trainNumber}</Text>
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
                  </View>

                  {/* Badge Link ViaggiaTreno */}
                  <View style={styles.trainTrenitaliaLinkBadge}>
                    <Text style={styles.trainTrenitaliaLinkText}>ViaggiaTreno</Text>
                    <Ionicons name="open-outline" size={12} color="#ffffff" style={{ marginLeft: 3 }} />
                  </View>
                </View>

                {/* Eventuale Avviso / Variazione / Interruzione Trenitalia */}
                {trainStatus?.alertMessage ? (
                  <View style={styles.trainAlertBanner}>
                    <Ionicons name="warning-outline" size={14} color="#f59e0b" style={{ marginRight: 6 }} />
                    <Text style={styles.trainAlertBannerText}>{trainStatus.alertMessage}</Text>
                  </View>
                ) : null}

                {/* Eventuale Segnalazione Capienza / Biglietti non acquistabili */}
                {trainStatus?.capacityWarning ? (
                  <View style={[styles.trainCapacityBanner, { backgroundColor: theme.cardTint, borderColor: theme.border }]}>
                    <Ionicons name="people-outline" size={14} color={theme.accent} style={{ marginRight: 6 }} />
                    <Text style={[styles.trainCapacityBannerText, { color: theme.light }]}>{trainStatus.capacityWarning}</Text>
                  </View>
                ) : null}

                {/* Info Partenza / Binario / Arrivo */}
                <View style={styles.trainInfoRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trainStationLabel}>Partenza</Text>
                    <Text style={styles.trainStationName}>
                      {direction === 'outbound'
                        ? config?.departureStation.shortName || config?.departureStation.name
                        : config?.arrivalStation.shortName || config?.arrivalStation.name}
                    </Text>
                    <Text style={styles.trainTimeText}>
                      {itinerary.liveTrain.departureTimePlanned || itinerary.liveTrain.departureTimeActual}
                    </Text>
                  </View>

                  {/* Binario Risaltato */}
                  <View style={[styles.platformHighlightBox, { borderColor: theme.border, backgroundColor: theme.subtle }]}>
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
                      <Text
                        style={[
                          styles.trainTimeText,
                          Boolean(itinerary.liveTrain.delayMinutes && itinerary.liveTrain.delayMinutes > 0) && {
                            color: '#fb923c',
                          },
                        ]}
                      >
                        {itinerary.liveTrain.arrivalTimeActual || itinerary.liveTrain.arrivalTimePlanned}
                      </Text>
                      {Boolean(
                        itinerary.liveTrain.delayMinutes &&
                          itinerary.liveTrain.delayMinutes > 0 &&
                          itinerary.liveTrain.arrivalTimePlanned &&
                          itinerary.liveTrain.arrivalTimePlanned !== itinerary.liveTrain.arrivalTimeActual
                      ) && (
                        <Text style={{ fontSize: 10, color: '#94a3b8', textDecorationLine: 'line-through' }}>
                          prog. {itinerary.liveTrain.arrivalTimePlanned}
                        </Text>
                      )}
                    </View>
                </View>

                {/* Selettore Alternative Treni (Treno prima / dopo & chips) */}
                <View style={styles.trainAlternativesDivider} />
                <View style={styles.trainNavButtonsRow}>
                  <TouchableOpacity
                    style={[
                      styles.trainNavBtn,
                      { backgroundColor: theme.subtle, borderColor: theme.border, borderWidth: 1 },
                      itinerary.liveTrain.hasEarlierTrain === false && styles.trainNavBtnDisabled,
                    ]}
                    disabled={itinerary.liveTrain.hasEarlierTrain === false}
                    onPress={handleTrainPrev}
                  >
                    <Ionicons name="chevron-back" size={14} color={theme.accent} style={{ marginRight: 3 }} />
                    <Text style={[styles.trainNavBtnText, { color: theme.accent }]}>Treno prima</Text>
                  </TouchableOpacity>

                  <Text style={styles.trainNavCenterLabel}>Cambia treno</Text>

                  <TouchableOpacity
                    style={[
                      styles.trainNavBtn,
                      { backgroundColor: theme.subtle, borderColor: theme.border, borderWidth: 1 },
                      itinerary.liveTrain.hasLaterTrain === false && styles.trainNavBtnDisabled,
                    ]}
                    disabled={itinerary.liveTrain.hasLaterTrain === false}
                    onPress={handleTrainNext}
                  >
                    <Text style={[styles.trainNavBtnText, { color: theme.accent }]}>Treno dopo</Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.accent} style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                </View>

                {/* Chips Treni Alternativi */}
                {itinerary.availableTrains && itinerary.availableTrains.length > 1 && (
                  <ScrollView
                    ref={trainChipsScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.trainChipsScroll}
                    onLayout={(e) => {
                      trainScrollWidthRef.current = e.nativeEvent.layout.width;
                      if (itinerary.liveTrain?.trainNumber) {
                        centerSelectedTrain(itinerary.liveTrain.trainNumber);
                      }
                    }}
                  >
                    {itinerary.availableTrains.map((at) => {
                      const isCurrent =
                        at.trainNumber.replace(/\D/g, '') ===
                        itinerary.liveTrain?.trainNumber.replace(/\D/g, '');

                      return (
                        <TouchableOpacity
                          key={at.trainNumber}
                          style={[
                            styles.trainChip,
                            isCurrent && [
                              styles.trainChipCurrent,
                              { backgroundColor: theme.bg, borderColor: theme.primary },
                            ],
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
                          onPress={() => handleSelectTrainChip(at.trainNumber)}
                        >
                          <Ionicons
                            name={at.isFast ? 'flash' : 'train-outline'}
                            size={12}
                            color={isCurrent ? theme.accent : '#94a3b8'}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[
                              styles.trainChipText,
                              isCurrent && styles.trainChipTextCurrent,
                            ]}
                          >
                            {at.trainNumber} • {at.departureTimePlanned || at.departureTimeActual}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </TouchableOpacity>
            )}

            {/* Timeline delle tappe del viaggio */}
            <Text style={styles.timelineSectionTitle}>TAPPE DEL VIAGGIO</Text>

            <View style={styles.timelineContainer}>
              {itinerary.legs.map((leg, index) => {
                const isFirst = index === 0;
                const isLast = index === itinerary.legs.length - 1;

                let iconName: keyof typeof Ionicons.glyphMap = 'navigate';
                let iconColor = theme.accent;
                let circleBg = theme.subtle;

                if (leg.type === 'car') {
                  iconName = 'car';
                  iconColor = '#fb923c';
                  circleBg = 'rgba(251, 146, 60, 0.15)';
                } else if (leg.type === 'train') {
                  iconName = 'train';
                  iconColor = theme.accent;
                  circleBg = theme.subtle;
                } else if (leg.type === 'transit') {
                  iconName = 'bus';
                  iconColor = '#a855f7';
                  circleBg = 'rgba(168, 85, 247, 0.15)';
                } else if (leg.type === 'destination') {
                  iconName = direction === 'outbound' ? 'school' : 'home';
                  iconColor = theme.primary;
                  circleBg = theme.subtle;
                } else if (leg.type === 'wait') {
                  iconName = 'pause';
                  iconColor = '#94a3b8';
                  circleBg = 'rgba(148, 163, 184, 0.15)';
                }

                const isInteractive = Boolean(leg.details?.mapQuery);

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
                          borderColor: 'rgba(255, 255, 255, 0.08)',
                          backgroundColor: '#1c1c1e',
                        },
                      ]}
                    >
                      <View style={styles.stepTitleRow}>
                        <Text style={styles.stepTitleText}>
                          {leg.title}
                        </Text>
                        <View style={styles.durationBadgeContainer}>
                          <Text style={styles.stepDurationText}>{leg.durationMinutes}m</Text>
                        </View>
                      </View>

                      <Text style={styles.stepSubtitleText}>{leg.subtitle}</Text>

                      {/* Avviso Evidente Traffico Stradale */}
                      {leg.type === 'car' && (leg.details?.trafficFluency || leg.details?.trafficCondition) && (
                        <View
                          style={[
                            styles.trafficAlertBox,
                            (leg.details.trafficFluency === 'intenso' || leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak)
                              ? styles.trafficAlertBoxWarning
                              : styles.trafficAlertBoxSmooth,
                          ]}
                        >
                          <View style={styles.trafficAlertHeader}>
                            <View
                              style={[
                                styles.trafficAlertIconBox,
                                {
                                  backgroundColor:
                                    leg.details.trafficFluency === 'intenso'
                                      ? 'rgba(239, 68, 68, 0.2)'
                                      : leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak
                                      ? 'rgba(245, 158, 11, 0.2)'
                                      : 'rgba(16, 185, 129, 0.2)',
                                },
                              ]}
                            >
                              <Ionicons
                                name={
                                  leg.details.trafficFluency === 'intenso'
                                    ? 'flame'
                                    : leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak
                                    ? 'warning'
                                    : 'checkmark-circle'
                                }
                                size={16}
                                color={
                                  leg.details.trafficFluency === 'intenso'
                                    ? '#ef4444'
                                    : leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak
                                    ? '#f59e0b'
                                    : '#10b981'
                                }
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.trafficAlertTitle,
                                  {
                                    color:
                                      leg.details.trafficFluency === 'intenso'
                                        ? '#fca5a5'
                                        : leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak
                                        ? '#fcd34d'
                                        : '#6ee7b7',
                                  },
                                ]}
                              >
                                {leg.details.trafficFluency === 'intenso'
                                  ? 'TRAFFICO MOLTO INTENSO'
                                  : leg.details.trafficFluency === 'rallentamenti'
                                  ? 'RALLENTAMENTI SU STRADA'
                                  : leg.details.isTrafficPeak
                                  ? 'ORA DI PUNTA • TRAFFICO PREVISTO'
                                  : 'TRAFFICO SCORREVOLE'}
                              </Text>
                              <Text style={styles.trafficAlertDescription}>
                                {leg.details.trafficCondition ||
                                  (leg.details.isTrafficPeak
                                    ? 'Possibili rallentamenti nei pressi della stazione o viabilità extraurbana'
                                    : 'Scorrevolezza stimata ottimale')}
                              </Text>
                            </View>
                            {(leg.details.trafficFluency === 'intenso' || leg.details.trafficFluency === 'rallentamenti' || leg.details.isTrafficPeak) && (
                              <View style={styles.trafficDelayPill}>
                                <Ionicons name="time" size={11} color="#ffedd5" style={{ marginRight: 3 }} />
                                <Text style={styles.trafficDelayPillText}>RITARDO</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      )}

                      {/* Note della tratta */}
                      {leg.details?.notes &&
                        leg.details.notes !== 'Tocca per aprire la navigazione con orario impostato' && (
                        <Text style={styles.stepNotesText}>{leg.details.notes}</Text>
                      )}

                      {/* Banner Apri Google Maps */}
                      {leg.details?.mapQuery && (
                        <View style={[styles.mapsBanner, { backgroundColor: theme.cardTint, borderColor: theme.border }]}>
                          <View style={styles.mapsBannerLeft}>
                            <View style={[styles.mapsIconCircle, { backgroundColor: theme.subtle }]}>
                              <Ionicons
                                name={
                                  leg.details.travelMode === 'transit'
                                    ? 'bus'
                                    : leg.details.travelMode === 'walking'
                                    ? 'walk'
                                    : 'navigate'
                                }
                                size={14}
                                color={theme.accent}
                              />
                            </View>
                            <View style={{ flex: 1, marginRight: 6 }}>
                              <Text style={[styles.mapsBannerTitle, { color: theme.accent }]}>
                                {leg.details.travelMode === 'transit'
                                  ? 'Apri su Google Maps'
                                  : leg.details.travelMode === 'walking'
                                  ? 'Percorso su Google Maps'
                                  : 'Naviga su Google Maps'}
                              </Text>
                            </View>
                          </View>
                          <View style={[styles.mapsActionBadge, { backgroundColor: theme.primary }]}>
                            <Text style={styles.mapsActionBadgeText}>APRI MAPS</Text>
                            <Ionicons name="open-outline" size={11} color="#ffffff" style={{ marginLeft: 3 }} />
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Messaggio Riepilogo */}
            <View style={[styles.summaryFooterBox, { backgroundColor: theme.cardTint, borderColor: theme.border }]}>
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
  safeArea: {
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liquidGlassTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.35,
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

  /* Switcher Andata / Ritorno */
  switcherContainer: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  nativeSegmentedControl: {
    height: 36,
  },
  customSegmentedControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  customSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    paddingHorizontal: 8,
  },
  customSegmentBtnActive: {
    backgroundColor: SAPIENZA_RED_BG,
    borderColor: SAPIENZA_RED,
    borderWidth: 1,
  },
  customSegmentText: {
    fontSize: 13,
    color: '#a1a1aa',
    fontWeight: '600',
  },
  customSegmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  /* Selettore Giorno della settimana */
  daySelectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  navArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 8,
  },
  dayItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 36,
  },
  dayCircle: {
    width: 44,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
    backgroundColor: '#1c1c1e',
  },
  dayCircleActive: {
    backgroundColor: SAPIENZA_RED_BG,
    borderWidth: 1,
    borderColor: SAPIENZA_RED,
  },
  dayText: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dayTextActive: {
    color: '#ffffff',
  },
  dayDot: {
    position: 'absolute',
    bottom: -7,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8e8e93',
  },
  dayDotActive: {
    backgroundColor: '#ffffff',
  },

  /* Lezioni del Giorno */
  lecturesSection: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: SAPIENZA_RED_ACCENT,
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 11,
    color: '#64748b',
  },
  noClassesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  noClassesText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  classesScrollContainer: {
    gap: 8,
    paddingVertical: 2,
  },
  classCard: {
    width: 200,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  classCardSelected: {
    backgroundColor: 'rgba(130, 36, 51, 0.3)',
    borderColor: SAPIENZA_RED,
    borderWidth: 1.5,
  },
  classCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  classTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(130, 36, 51, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  classTimeBadgeSelected: {
    backgroundColor: SAPIENZA_RED,
  },
  classTimeText: {
    fontSize: 11,
    fontWeight: '700',
    color: SAPIENZA_RED_ACCENT,
  },
  classTimeTextSelected: {
    color: '#ffffff',
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  targetBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  classSubjectText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 16,
    minHeight: 32,
    marginBottom: 6,
  },
  classSubjectTextSelected: {
    color: '#ffffff',
  },
  classRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  classRoomText: {
    fontSize: 11,
    color: '#94a3b8',
    flex: 1,
  },
  classRoomTextSelected: {
    color: '#fca5a5',
    fontWeight: '600',
  },

  /* Empty / Loading */
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    marginBottom: 12,
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
    backgroundColor: 'rgba(130, 36, 51, 0.15)',
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.3)',
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

  /* Card Treno Risaltato */
  trainHighlightCard: {
    backgroundColor: 'rgba(130, 36, 51, 0.16)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.35)',
    padding: 14,
    marginBottom: 14,
  },
  trainHighlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trainHighlightHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  trainNumberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  trainNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  trainStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  trainStatusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  trainTrenitaliaLinkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  trainTrenitaliaLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  trainAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  trainAlertBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#f59e0b',
    flex: 1,
    lineHeight: 15,
  },
  trainCapacityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(130, 36, 51, 0.2)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  trainCapacityBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: SAPIENZA_RED_LIGHT,
    flex: 1,
    lineHeight: 15,
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
    color: '#ffffff',
    marginTop: 2,
  },
  platformHighlightBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SAPIENZA_RED_BORDER,
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
  trainAlternativesDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 10,
  },
  trainNavButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  trainNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  trainNavBtnDisabled: {
    opacity: 0.35,
  },
  trainNavBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  trainNavCenterLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  trainChipsScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  trainChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  trainChipCurrent: {
    backgroundColor: SAPIENZA_RED_BG,
    borderColor: SAPIENZA_RED,
  },
  trainChipText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  trainChipTextCurrent: {
    color: '#ffffff',
    fontWeight: '700',
  },

  /* Timeline */
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
  stepContentCardInteractive: {
    borderColor: SAPIENZA_RED_BORDER,
  },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  stepTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
    marginRight: 8,
    lineHeight: 19,
  },
  durationBadgeContainer: {
    paddingTop: 1,
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

  /* Avviso Traffico Prominente */
  trafficAlertBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
  },
  trafficAlertBoxWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  trafficAlertBoxSmooth: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  trafficAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trafficAlertIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
  },
  trafficAlertTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  trafficAlertDescription: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 2,
    lineHeight: 15,
  },
  trafficDelayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  trafficDelayPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#ffedd5',
    letterSpacing: 0.4,
  },

  /* Scheda Link Trenitalia Timeline */
  trenitaliaTimelineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(130, 36, 51, 0.2)',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.35)',
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 8,
  },
  trenitaliaIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  trenitaliaBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  trenitaliaBannerSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  trenitaliaActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  trenitaliaActionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },

  /* Banner Google Maps */
  mapsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(130, 36, 51, 0.14)',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.3)',
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 8,
  },
  mapsBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  mapsIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(130, 36, 51, 0.28)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  mapsBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: SAPIENZA_RED_ACCENT,
  },
  mapsBannerSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    lineHeight: 15,
  },
  mapsActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SAPIENZA_RED,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  mapsActionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },

  /* Footer Riepilogo */
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
