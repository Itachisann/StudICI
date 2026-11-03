import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getStationTransitBoard,
  TransitBoardResult,
  TransitDepartureItem,
} from '../utils/transitBoardService';
import { AppTheme } from '@/constants/theme';

interface TransitBoardCardProps {
  stationName: string;
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  targetName?: string;
  targetDate?: string;
  targetTime?: string;
  direction?: 'to_campus' | 'to_station';
  theme: AppTheme;
}

export const TransitBoardCard: React.FC<TransitBoardCardProps> = ({
  stationName,
  stationCoords,
  targetCoords,
  targetName,
  targetDate,
  targetTime,
  direction = 'to_campus',
  theme,
}) => {
  // Modalità origine: 'station_or_campus' (default da piano) o 'current_location' (GPS dispositivo)
  const [originMode, setOriginMode] = useState<'station_or_campus' | 'current_location'>('station_or_campus');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Modalità orario: 'live_now' (adesso in tempo reale) o 'travel_time' (all'orario del treno/viaggio)
  const [timeMode, setTimeMode] = useState<'live_now' | 'travel_time'>('live_now');

  const [boardData, setBoardData] = useState<TransitBoardResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedLineFilter, setSelectedLineFilter] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [spinAnim] = useState(new Animated.Value(0));

  // Timer per aggiornamento live ogni 45 secondi se in modalità 'live_now'
  useEffect(() => {
    if (timeMode !== 'live_now') return;
    const interval = setInterval(() => {
      setRefreshTrigger((k) => k + 1);
    }, 45000);
    return () => clearInterval(interval);
  }, [timeMode]);

  // Gestione geolocalizzazione GPS sicura e resiliente
  const handleSelectCurrentLocation = useCallback(async () => {
    setOriginMode('current_location');
    setLocationError(null);

    if (userCoords) {
      // Coordinate già disponibili
      return;
    }

    try {
      setIsLocating(true);

      // Safe lazy loading per prevenire crash se Metro è avviato prima dell'installazione
      // o se il client nativo corrente non contiene ancora il modulo nativo ExpoLocation
      let LocationModule: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        LocationModule = require('expo-location');
      } catch {
        LocationModule = null;
      }

      if (!LocationModule || typeof LocationModule.requestForegroundPermissionsAsync !== 'function') {
        setLocationError('Modulo GPS non caricato nel bundle: riavvia Metro (`npx expo start -c`) o compila la dev build.');
        setOriginMode('station_or_campus');
        setIsLocating(false);
        return;
      }

      const { status } = await LocationModule.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Permesso posizione non autorizzato');
        setOriginMode('station_or_campus');
        setIsLocating(false);
        return;
      }

      const loc = await LocationModule.getCurrentPositionAsync({
        accuracy: LocationModule.Accuracy?.Balanced ?? 3,
      });

      setUserCoords({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Impossibile rilevare la posizione';
      setLocationError(msg);
      setOriginMode('station_or_campus');
    } finally {
      setIsLocating(false);
    }
  }, [userCoords]);

  // Gestione selezione origine
  const handleSelectOrigin = useCallback((mode: 'station_or_campus' | 'current_location') => {
    setLoading(true);
    if (mode === 'station_or_campus') {
      setOriginMode('station_or_campus');
      setLocationError(null);
    } else {
      handleSelectCurrentLocation();
    }
  }, [handleSelectCurrentLocation]);

  // Gestione selezione orario
  const handleSelectTimeMode = useCallback((mode: 'live_now' | 'travel_time') => {
    setLoading(true);
    setTimeMode(mode);
  }, []);

  const handleManualRefresh = useCallback(() => {
    setLoading(true);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
    }).start(() => {
      spinAnim.setValue(0);
    });
    setRefreshTrigger((k) => k + 1);
  }, [spinAnim]);

  // Calcolo parametri di query effettivi in base ai selettori
  useEffect(() => {
    let isMounted = true;

    const isCurrentLoc = originMode === 'current_location' && userCoords;
    const effectiveTime = timeMode === 'live_now' ? 'now' : targetTime;
    const effectiveDate = timeMode === 'live_now' ? undefined : targetDate;

    let qStationCoords = stationCoords;
    let qStationName = stationName;
    let qTargetCoords = targetCoords;
    let qTargetName = targetName;

    if (isCurrentLoc) {
      if (direction === 'to_station') {
        // Da posizione attuale verso stazione FS
        qTargetCoords = userCoords;
        qTargetName = 'Posizione attuale';
      } else {
        // Da posizione attuale verso aula/sede
        qStationCoords = userCoords;
        qStationName = 'Posizione attuale';
      }
    }

    getStationTransitBoard({
      stationName: qStationName,
      stationCoords: qStationCoords,
      targetCoords: qTargetCoords,
      targetName: qTargetName,
      targetDate: effectiveDate,
      targetTime: effectiveTime,
      direction,
    })
      .then((data) => {
        if (isMounted) {
          setBoardData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    stationName,
    stationCoords,
    targetCoords,
    targetName,
    targetDate,
    targetTime,
    direction,
    originMode,
    userCoords,
    timeMode,
    refreshTrigger,
  ]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const filteredDepartures = useMemo(() => {
    if (!boardData) return [];
    if (!selectedLineFilter) return boardData.departures;
    return boardData.departures.filter(
      (d) => d.line.toLowerCase() === selectedLineFilter.toLowerCase()
    );
  }, [boardData, selectedLineFilter]);

  const displayedDepartures = isExpanded
    ? filteredDepartures
    : filteredDepartures.slice(0, 3);

  const getModeIcon = (mode: TransitDepartureItem['mode']) => {
    switch (mode) {
      case 'metro':
        return 'subway-outline';
      case 'tram':
        return 'git-commit-outline';
      case 'rail':
        return 'train-outline';
      case 'bus':
      default:
        return 'bus-outline';
    }
  };

  const getLineBadgeColor = (line: string, mode: TransitDepartureItem['mode']) => {
    const lNorm = line.toLowerCase();
    if (lNorm.includes('metro a') || lNorm === 'ma') return '#f97316';
    if (lNorm.includes('metro b') || lNorm === 'mb' || lNorm === 'nmb') return '#2563eb';
    if (lNorm.includes('metro c') || lNorm === 'mc') return '#10b981';
    if (mode === 'tram') return '#059669';
    if (mode === 'rail') return '#7c3aed';
    if (lNorm.includes('492')) return '#0284c7';
    if (lNorm.includes('71')) return '#ea580c';
    if (lNorm.includes('163')) return '#d97706';
    if (lNorm.includes('448')) return '#4f46e5';
    return '#3b82f6';
  };

  const computeCountdown = (timeStr: string) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;

    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const depM = h * 60 + m;
    let diff = depM - nowM;
    if (diff < -720) diff += 1440;
    if (diff < -5) return null; // Passata da più di 5 minuti
    if (diff <= 1) return 'In arrivo';
    if (diff <= 60) return `tra ${diff}m`;
    return null;
  };

  const originLabelDefault =
    direction === 'to_campus'
      ? stationName
      : targetName || 'Aula / Sede';

  return (
    <View style={[styles.container, { backgroundColor: '#13151b', borderColor: '#262a36' }]}>
      {/* Intestazione */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Ionicons name="bus" size={15} color="#60a5fa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Linee e Partenze Urbane</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {originMode === 'current_location'
                ? `Dalla tua posizione GPS verso ${direction === 'to_campus' ? targetName || 'la sede' : stationName}`
                : direction === 'to_campus'
                  ? `Da ${stationName} verso ${targetName || 'la sede'}`
                  : `Verso la stazione ${stationName}`}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {boardData?.isLiveSource ? (
            <View style={styles.liveBadge}>
              <View style={styles.livePulseDot} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          ) : (
            <View style={styles.schedBadge}>
              <Ionicons name="time-outline" size={10} color="#94a3b8" style={{ marginRight: 3 }} />
              <Text style={styles.schedBadgeText}>ORARI</Text>
            </View>
          )}

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleManualRefresh}
            disabled={loading}
            style={styles.refreshBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Ionicons name="refresh" size={13} color="#94a3b8" />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Controlli Dinamici: Selettore Origine (Stazione / GPS) & Selettore Orario (Adesso / Viaggio) */}
      <View style={styles.controlPillsContainer}>
        {/* Toggle Origine */}
        <View style={styles.segmentGroup}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleSelectOrigin('station_or_campus')}
            style={[
              styles.segmentBtn,
              originMode === 'station_or_campus' && styles.segmentBtnActive,
            ]}
          >
            <Ionicons
              name={direction === 'to_campus' ? 'train-outline' : 'school-outline'}
              size={11}
              color={originMode === 'station_or_campus' ? '#ffffff' : '#94a3b8'}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.segmentBtnText,
                originMode === 'station_or_campus' && styles.segmentBtnTextActive,
              ]}
              numberOfLines={1}
            >
              {originLabelDefault}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleSelectOrigin('current_location')}
            style={[
              styles.segmentBtn,
              originMode === 'current_location' && styles.segmentBtnActive,
            ]}
          >
            {isLocating ? (
              <ActivityIndicator size={10} color="#ffffff" style={{ marginRight: 4 }} />
            ) : (
              <Ionicons
                name="navigate"
                size={11}
                color={originMode === 'current_location' ? '#ffffff' : '#94a3b8'}
                style={{ marginRight: 4 }}
              />
            )}
            <Text
              style={[
                styles.segmentBtnText,
                originMode === 'current_location' && styles.segmentBtnTextActive,
              ]}
              numberOfLines={1}
            >
              Posizione attuale
            </Text>
          </TouchableOpacity>
        </View>

        {/* Toggle Orario */}
        <View style={styles.segmentGroup}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleSelectTimeMode('live_now')}
            style={[
              styles.segmentBtn,
              timeMode === 'live_now' && styles.segmentBtnActiveLive,
            ]}
          >
            <Ionicons
              name="flash"
              size={11}
              color={timeMode === 'live_now' ? '#ffffff' : '#94a3b8'}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.segmentBtnText,
                timeMode === 'live_now' && styles.segmentBtnTextActive,
              ]}
            >
              Adesso live
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleSelectTimeMode('travel_time')}
            style={[
              styles.segmentBtn,
              timeMode === 'travel_time' && styles.segmentBtnActive,
            ]}
          >
            <Ionicons
              name="time-outline"
              size={11}
              color={timeMode === 'travel_time' ? '#ffffff' : '#94a3b8'}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.segmentBtnText,
                timeMode === 'travel_time' && styles.segmentBtnTextActive,
              ]}
            >
              All&apos;arrivo ({targetTime || '15:00'})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Segnalazione errore localizzazione */}
      {locationError && (
        <View style={styles.errorNoticeRow}>
          <Ionicons name="alert-circle-outline" size={11} color="#f87171" style={{ marginRight: 4 }} />
          <Text style={styles.errorNoticeText}>{locationError}</Text>
        </View>
      )}

      {/* Chips delle linee dirette / consigliate */}
      {boardData && boardData.directLines.length > 0 && (
        <View style={styles.chipsRow}>
          <Text style={styles.chipsLabel}>Linee consigliate:</Text>
          <View style={styles.chipsContainer}>
            {boardData.directLines.map((line) => {
              const isSelected = selectedLineFilter?.toLowerCase() === line.toLowerCase();
              return (
                <TouchableOpacity
                  key={`line-chip-${line}`}
                  activeOpacity={0.7}
                  onPress={() => setSelectedLineFilter(isSelected ? null : line)}
                  style={[
                    styles.lineChip,
                    {
                      backgroundColor: isSelected ? theme.primary : '#1e2230',
                      borderColor: isSelected ? theme.primary : '#32384a',
                    },
                  ]}
                >
                  <Ionicons
                    name={line.toLowerCase().includes('metro') ? 'subway-outline' : 'bus-outline'}
                    size={10}
                    color={isSelected ? '#ffffff' : '#93c5fd'}
                    style={{ marginRight: 3 }}
                  />
                  <Text
                    style={[
                      styles.lineChipText,
                      { color: isSelected ? '#ffffff' : '#e2e8f0', fontWeight: isSelected ? '700' : '600' },
                    ]}
                  >
                    {line}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {selectedLineFilter && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setSelectedLineFilter(null)}
                style={styles.resetFilterChip}
              >
                <Ionicons name="close" size={11} color="#94a3b8" />
                <Text style={styles.resetFilterText}>Tutte</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Loading o lista partenze */}
      {loading && !boardData ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#60a5fa" />
          <Text style={styles.loadingText}>
            {timeMode === 'live_now'
              ? 'Rilevamento transiti satellitari AVM e passaggi in corso...'
              : 'Calcolo orari programmati e coincidenze bus/metro...'}
          </Text>
        </View>
      ) : displayedDepartures.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
          <Text style={styles.emptyText}>
            {selectedLineFilter
              ? `Nessun passaggio rilevato per la linea ${selectedLineFilter}`
              : 'Nessuna linea o passaggio trovato per questa tratta al momento'}
          </Text>
        </View>
      ) : (
        <View style={styles.departuresList}>
          {displayedDepartures.map((dep, index) => {
            const badgeBg = getLineBadgeColor(dep.line, dep.mode);
            const countdown = computeCountdown(dep.estimatedTime);

            return (
              <View
                key={dep.id || `dep-${index}`}
                style={[
                  styles.departureRow,
                  index < displayedDepartures.length - 1 && styles.departureRowBorder,
                ]}
              >
                {/* Badge Linea */}
                <View style={[styles.lineBadgeBox, { backgroundColor: badgeBg }]}>
                  <Ionicons
                    name={getModeIcon(dep.mode)}
                    size={11}
                    color="#ffffff"
                    style={{ marginRight: 3 }}
                  />
                  <Text style={styles.lineBadgeText}>{dep.line}</Text>
                </View>

                {/* Dettagli destinazione e fermata */}
                <View style={styles.departureDetails}>
                  <Text style={styles.departureHeadsign} numberOfLines={1}>
                    Dir. {dep.headsign}
                  </Text>
                  <Text style={styles.departureStopSub} numberOfLines={1}>
                    da {dep.fromStop}
                    {dep.inVehicleMinutes ? ` · ~${dep.durationMinutes}m tot` : ''}
                  </Text>

                  {/* Avviso specifico sulla linea */}
                  {dep.alerts && dep.alerts.length > 0 && (
                    <View style={styles.depAlertPill}>
                      <Ionicons name="warning-outline" size={10} color="#f59e0b" style={{ marginRight: 3 }} />
                      <Text style={styles.depAlertText} numberOfLines={1}>
                        {dep.alerts[0]}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Orario e stato Live/Prog */}
                <View style={styles.departureTiming}>
                  <View style={styles.timeRow}>
                    <Text style={styles.departureTimeMain}>{dep.estimatedTime}</Text>
                    {countdown && (
                      <View style={styles.countdownBadge}>
                        <Text style={styles.countdownText}>{countdown}</Text>
                      </View>
                    )}
                  </View>

                  {dep.isLive ? (
                    <View
                      style={[
                        styles.statusPill,
                        dep.statusType === 'delayed'
                          ? styles.statusPillDelayed
                          : dep.statusType === 'early'
                            ? styles.statusPillEarly
                            : styles.statusPillOnTime,
                      ]}
                    >
                      {dep.statusType === 'on_time' && (
                        <View style={styles.statusPulseDot} />
                      )}
                      <Text
                        style={[
                          styles.statusPillText,
                          dep.statusType === 'delayed'
                            ? styles.statusTextDelayed
                            : dep.statusType === 'early'
                              ? styles.statusTextEarly
                              : styles.statusTextOnTime,
                        ]}
                      >
                        {dep.statusLabel}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.departureSchedSub}>Prog. {dep.scheduledTime}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Footer espansione & avviso sorgente */}
      {filteredDepartures.length > 3 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setIsExpanded(!isExpanded)}
          style={styles.expandButton}
        >
          <Text style={styles.expandButtonText}>
            {isExpanded
              ? 'Riduci corse'
              : `Vedi altri passaggi (${filteredDepartures.length - 3} disponibili)`}
          </Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color="#60a5fa"
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>
      )}

      {/* Info footer */}
      {boardData?.sourceNotice && (
        <View style={styles.footerNoteRow}>
          <Ionicons name="shield-checkmark-outline" size={10} color="#64748b" style={{ marginRight: 4 }} />
          <Text style={styles.footerNoteText}>
            {boardData.sourceNotice} · Agg. {boardData.lastUpdated}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  headerIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  livePulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#ef4444',
    marginRight: 4,
  },
  liveBadgeText: {
    color: '#ef4444',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  schedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2230',
    borderWidth: 1,
    borderColor: '#32384a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  schedBadgeText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '600',
  },
  refreshBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#1e2230',
  },
  controlPillsContainer: {
    flexDirection: 'column',
    gap: 6,
    marginBottom: 10,
    backgroundColor: '#0d0f14',
    padding: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2230',
  },
  segmentGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: 'transparent',
  },
  segmentBtnActive: {
    backgroundColor: '#262d40',
  },
  segmentBtnActiveLive: {
    backgroundColor: '#1e3a8a',
  },
  segmentBtnText: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '600',
  },
  segmentBtnTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  errorNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorNoticeText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '500',
  },
  chipsRow: {
    marginBottom: 10,
  },
  chipsLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  lineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  lineChipText: {
    fontSize: 11,
  },
  resetFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#1e2230',
    borderWidth: 1,
    borderColor: '#32384a',
  },
  resetFilterText: {
    color: '#94a3b8',
    fontSize: 10,
    marginLeft: 2,
    fontWeight: '600',
  },
  loadingBox: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  emptyBox: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 11,
    textAlign: 'center',
  },
  departuresList: {
    marginTop: 2,
  },
  departureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  departureRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1c202c',
  },
  lineBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    minWidth: 54,
    justifyContent: 'center',
    marginRight: 10,
  },
  lineBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  departureDetails: {
    flex: 1,
    marginRight: 8,
  },
  departureHeadsign: {
    color: '#f1f5f9',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  departureStopSub: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },
  depAlertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  depAlertText: {
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: '600',
  },
  departureTiming: {
    alignItems: 'flex-end',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  departureTimeMain: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  countdownBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
  },
  countdownText: {
    color: '#4ade80',
    fontSize: 9,
    fontWeight: '700',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    marginTop: 2,
  },
  statusPillOnTime: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  statusPillDelayed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusPillEarly: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  statusPulseDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#22c55e',
    marginRight: 3,
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '700',
  },
  statusTextOnTime: {
    color: '#4ade80',
  },
  statusTextDelayed: {
    color: '#f87171',
  },
  statusTextEarly: {
    color: '#60a5fa',
  },
  departureSchedSub: {
    color: '#64748b',
    fontSize: 9.5,
    marginTop: 2,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1c202c',
  },
  expandButtonText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '600',
  },
  footerNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a1e2a',
  },
  footerNoteText: {
    color: '#64748b',
    fontSize: 9.5,
  },
});
