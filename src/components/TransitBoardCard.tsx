import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  getStationTransitBoard,
  getLineBadgeColor,
  getTransitModeIcon,
  parseHHMMToMins,
  TransitBoardResult,
  TransitDepartureItem,
} from '../utils/transitBoardService';
import { TransitDepartureModal } from './TransitDepartureModal';
import { AppTheme } from '@/constants/theme';

export interface OptimalTransitTimingUpdate {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  line: string;
  directLines?: string[];
}

interface TransitBoardCardProps {
  stationName: string;
  stationCoords?: { lat: number; lng: number };
  targetCoords?: { lat: number; lng: number };
  targetName?: string;
  targetDate?: string;
  targetTime?: string;
  direction?: 'to_campus' | 'to_station';
  theme: AppTheme;
  isToday?: boolean;
  /** Etichetta del giorno attualmente selezionato nel selettore orizzontale (es. "LUN", "GIO") */
  selectedDayLabel?: string;
  /** True solo quando l'architettura delle lezioni e dei treni è in modalità live attiva */
  isLiveContext?: boolean;
  /** Vincolo orario di arrivo a destinazione (partenza treno per ritorno, inizio lezione per andata) */
  constraintTime?: string;
  /** Orario minimo di salita sul mezzo (arrivo del treno in stazione per l'andata) */
  minDepartureTime?: string;
  /** Timestamp sincronizzato con il ciclo di refresh ogni 60s della sezione treni */
  refreshTimestamp?: number;
  /** Callback per aggiornare dinamicamente l'orario e la durata sulla card esterna della tappa */
  onOptimalDepartureResolved?: (update: OptimalTransitTimingUpdate) => void;
}

export type ExpansionLevel = 'collapsed' | 'half_hour' | 'full';

export const TransitBoardCard: React.FC<TransitBoardCardProps> = ({
  stationName,
  stationCoords,
  targetCoords,
  targetName,
  targetDate,
  targetTime,
  direction = 'to_campus',
  theme,
  isToday = true,
  selectedDayLabel,
  isLiveContext = false,
  constraintTime,
  minDepartureTime,
  refreshTimestamp,
  onOptimalDepartureResolved,
}) => {
  const [originMode, setOriginMode] = useState<'station_or_campus' | 'current_location'>(
    'station_or_campus'
  );
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Controllo preventivo: la logica live è attiva SOLO se il giorno selezionato nel selettore orizzontale corrisponde ad oggi
  const isSelectedDayActiveToday = Boolean(isToday);
  const canUseLive = isSelectedDayActiveToday;

  const [boardData, setBoardData] = useState<TransitBoardResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedLineFilter, setSelectedLineFilter] = useState<string | null>(null);
  const [expansionLevel, setExpansionLevel] = useState<ExpansionLevel>('collapsed');
  const [manualRefreshCount, setManualRefreshCount] = useState<number>(0);
  const [spinAnim] = useState(new Animated.Value(0));

  // Stato per il nuovo modale di dettaglio della singola corsa
  const [selectedDepartureModal, setSelectedDepartureModal] =
    useState<TransitDepartureItem | null>(null);

  const prevManualRefreshCountRef = useRef<number>(0);

  // Risoluzione asincrona del nome della località (es. Viterbo, Orte, Terni, Latina, Roma)
  const resolveLocationName = useCallback(async (lat: number, lng: number) => {
    try {
      const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (geo && geo.length > 0) {
        const g = geo[0];
        const cityName = g.city || g.subregion || g.district || g.region || g.name;
        if (cityName) {
          setDetectedCity(cityName);
        }
      }
    } catch {
      // Reverse geocoding best-effort: ignora fallimenti di rete
    }
  }, []);

  // Acquisizione o aggiornamento manuale della posizione GPS reale con supporto interregionale
  const acquireOrRefreshGpsLocation = useCallback(async (isManualRefresh = false) => {
    setLocationError(null);
    setIsLocating(true);

    try {
      // 1. Verifica e richiesta autorizzazione permessi di localizzazione in primo piano
      const perm = await Location.getForegroundPermissionsAsync();
      let isGranted = perm.granted;
      if (!isGranted) {
        const req = await Location.requestForegroundPermissionsAsync();
        isGranted = req.granted;
      }

      if (!isGranted) {
        setLocationError('Permesso posizione non autorizzato nelle impostazioni');
        setIsLocating(false);
        setLoading(false);
        return;
      }

      // 2. Controllo posizione recente nella cache di sistema:
      // Si accetta la posizione memorizzata SOLO se è recente (meno di 60 secondi fa)
      // evitando categoricamente di iniettare posizioni stantie di ore o giorni fa (es. Roma quando si è a 70km)
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 60000,
        requiredAccuracy: 300,
      }).catch(() => null);

      const nowTs = Date.now();
      const isFreshCache =
        Boolean(lastKnown?.coords) &&
        Boolean(lastKnown?.timestamp) &&
        nowTs - (lastKnown?.timestamp || 0) < 60000;

      if (isFreshCache && lastKnown?.coords && !isManualRefresh) {
        const cached = {
          lat: lastKnown.coords.latitude,
          lng: lastKnown.coords.longitude,
        };
        setUserCoords(cached);
        resolveLocationName(cached.lat, cached.lng);
      }

      // 3. Rilevazione live della posizione GPS attuale ad alta precisione con timeout di sicurezza a 15s
      const locPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 15000)
      );
      const freshLoc = await Promise.race([locPromise, timeoutPromise]).catch(() => null);

      if (freshLoc?.coords) {
        const freshCoords = {
          lat: freshLoc.coords.latitude,
          lng: freshLoc.coords.longitude,
        };
        setUserCoords(freshCoords);
        resolveLocationName(freshCoords.lat, freshCoords.lng);
      } else if (!isFreshCache) {
        setLocationError('Impossibile rilevare la posizione GPS attuale. Assicurati che la localizzazione sia attiva.');
        setLoading(false);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Impossibile rilevare la posizione GPS';
      setLocationError(msg);
      setLoading(false);
    } finally {
      setIsLocating(false);
    }
  }, [resolveLocationName]);

  const handleSelectOrigin = useCallback(
    (mode: 'station_or_campus' | 'current_location') => {
      if (mode === originMode) return;
      setExpansionLevel('collapsed');
      setLoading(true);
      if (mode === 'station_or_campus') {
        setOriginMode('station_or_campus');
        setLocationError(null);
      } else {
        setOriginMode('current_location');
        setBoardData(null); // Pulisce le corse precedenti per evitare di mostrare la vecchia origine
        setUserCoords(null); // Resetta le coordinate in attesa del fix GPS reale
        setDetectedCity(null);
        acquireOrRefreshGpsLocation(false);
      }
    },
    [originMode, acquireOrRefreshGpsLocation]
  );

  // Click sull'icona circolare di refresh del pannello "Mezzi":
  // aggiorna i transiti e, se l'origine è su GPS, verifica/aggiorna anche la posizione
  const handleManualRefresh = useCallback(async () => {
    setLoading(true);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 650,
      useNativeDriver: true,
    }).start(() => {
      spinAnim.setValue(0);
    });

    if (originMode === 'current_location') {
      await acquireOrRefreshGpsLocation(true);
    }

    setManualRefreshCount((k) => k + 1);
  }, [spinAnim, originMode, acquireOrRefreshGpsLocation]);

  // Caricamento tabellone mezzi sincronizzato anche con refreshTimestamp (ciclo 60s dei treni)
  useEffect(() => {
    let isMounted = true;

    const isCurrentLoc = originMode === 'current_location';
    // Se la modalità è su posizione GPS ma le coordinate non sono ancora state acquisite, attendi
    if (isCurrentLoc && !userCoords) {
      return;
    }

    let qStationCoords = stationCoords;
    let qStationName = stationName;
    let qTargetCoords = targetCoords;
    let qTargetName = targetName;

    if (isCurrentLoc && userCoords) {
      const locLabel = detectedCity ? `La mia posizione (${detectedCity})` : 'La mia posizione';
      if (direction === 'to_station') {
        qTargetCoords = userCoords;
        qTargetName = locLabel;
      } else {
        qStationCoords = userCoords;
        qStationName = locLabel;
      }
    }

    const isManualForce = manualRefreshCount !== prevManualRefreshCountRef.current;
    prevManualRefreshCountRef.current = manualRefreshCount;

    getStationTransitBoard({
      stationName: qStationName,
      stationCoords: qStationCoords,
      targetCoords: qTargetCoords,
      targetName: qTargetName,
      targetDate: isCurrentLoc ? undefined : (canUseLive ? undefined : targetDate),
      targetTime: isCurrentLoc ? 'now' : (canUseLive ? 'now' : targetTime),
      direction,
      isLiveContext: canUseLive,
      constraintTime: isCurrentLoc ? undefined : constraintTime,
      minDepartureTime: isCurrentLoc ? undefined : minDepartureTime,
      forceRefresh: isManualForce,
    })
      .then((data) => {
        if (!isMounted) return;
        setBoardData(data);
        setLoading(false);

        // Comunica sempre alla card esterna della tappa l'ultimo mezzo utile e la sua durata effettiva
        const opt = data.optimalDeparture || data.departures[0];
        if (opt && onOptimalDepartureResolved) {
          const depT = canUseLive
            ? opt.estimatedTime || opt.scheduledTime
            : opt.scheduledTime;
          const endT = opt.arrivalTime;
          const dur = opt.durationMinutes;
          onOptimalDepartureResolved({
            startTime: depT,
            endTime: endT,
            durationMinutes: dur,
            line: opt.line,
            directLines: data.directLines,
          });
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
    detectedCity,
    canUseLive,
    constraintTime,
    minDepartureTime,
    refreshTimestamp,
    manualRefreshCount,
    onOptimalDepartureResolved,
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

  // Corse comprese nell'intorno di mezz'ora (+30 minuti dalla prima partenza disponibile)
  const halfHourDepartures = useMemo(() => {
    if (filteredDepartures.length === 0) return [];
    const firstDep = filteredDepartures[0];
    const baseDepTimeStr = firstDep.estimatedTime || firstDep.scheduledTime;
    const baseMins = parseHHMMToMins(baseDepTimeStr);
    if (baseMins < 0) return filteredDepartures.slice(0, 5);

    return filteredDepartures.filter((d) => {
      const dTimeStr = d.estimatedTime || d.scheduledTime;
      const dMins = parseHHMMToMins(dTimeStr);
      if (dMins < 0) return true;
      let diff = dMins - baseMins;
      if (diff < -720) diff += 1440;
      return diff >= 0 && diff <= 30;
    });
  }, [filteredDepartures]);

  const displayedDepartures = useMemo(() => {
    if (filteredDepartures.length <= 3) {
      return filteredDepartures;
    }
    if (expansionLevel === 'full') {
      return filteredDepartures;
    }
    if (expansionLevel === 'half_hour') {
      const count = Math.max(3, halfHourDepartures.length);
      return filteredDepartures.slice(0, count);
    }
    // Modalità 'collapsed' (default: prime 3 corse)
    if (direction === 'to_campus') {
      return filteredDepartures.slice(0, 3);
    }
    if (!selectedLineFilter && boardData) {
      const optIdx = boardData.optimalIndex ?? 0;
      const startIdx = Math.max(
        0,
        Math.min(optIdx - 1, filteredDepartures.length - 3)
      );
      return filteredDepartures.slice(startIdx, startIdx + 3);
    }
    return filteredDepartures.slice(0, 3);
  }, [expansionLevel, filteredDepartures, halfHourDepartures, selectedLineFilter, boardData, direction]);

  const handleToggleExpansion = useCallback(() => {
    if (expansionLevel === 'collapsed') {
      // Se nell'intorno di mezz'ora ci sono più di 3 corse ed è inferiore al totale, espande alla mezz'ora
      if (halfHourDepartures.length > 3 && halfHourDepartures.length < filteredDepartures.length) {
        setExpansionLevel('half_hour');
      } else {
        // Altrimenti espande direttamente al limite completo
        setExpansionLevel('full');
      }
    } else if (expansionLevel === 'half_hour') {
      if (filteredDepartures.length > displayedDepartures.length) {
        setExpansionLevel('full');
      } else {
        setExpansionLevel('collapsed');
      }
    } else {
      setExpansionLevel('collapsed');
    }
  }, [expansionLevel, halfHourDepartures.length, filteredDepartures.length, displayedDepartures.length]);

  /**
   * Determina lo stato live di una specifica corsa secondo le direttive:
   * 1. Verifica giorno attivo nel selettore orizzontale (es. "GIO"): se non è oggi, live disattivato preventivamente.
   * 2. Se è oggi, rileva se l'orario del mezzo rientra nella fascia oraria in corso rispetto all'orario attuale reale.
   * 3. Attiva lo stato live ("tra", "ogni", "In arrivo", ritardo e pallino) solo per le corse che hanno effettivi dati live.
   *    Se un mezzo non ha dati live, non viene applicata alcuna informazione fittizia.
   */
  const getDepartureLiveInfo = useCallback(
    (dep: TransitDepartureItem, index: number) => {
      // 1. Controllo giorno attivo: se non è il giorno odierno, disattiva preventivamente qualsiasi logica live
      if (!isSelectedDayActiveToday) {
        return {
          isLiveActive: false,
          displayTime: dep.scheduledTime || dep.estimatedTime,
          isDelayed: false,
          isHeavyDelay: false,
          dotColor: undefined,
          delayText: null,
          countdownText: null,
        };
      }

      // 2. Giorno odierno attivo: calcola la posizione temporale rispetto all'orario reale attuale
      const now = new Date();
      const currentNowMins = now.getHours() * 60 + now.getMinutes();
      const depTimeStr = dep.estimatedTime || dep.scheduledTime;
      const depMins = parseHHMMToMins(depTimeStr);

      if (depMins < 0) {
        return {
          isLiveActive: false,
          displayTime: dep.scheduledTime || depTimeStr,
          isDelayed: false,
          isHeavyDelay: false,
          dotColor: undefined,
          delayText: null,
          countdownText: null,
        };
      }

      let diff = depMins - currentNowMins;
      if (diff < -720) diff += 1440;
      if (diff > 720) diff -= 1440;

      // La fascia oraria in corso comprende i passaggi da -3 min fa fino a +50 min nel futuro
      const isInCurrentTimeWindow = diff >= -3 && diff <= 50;

      // 3. Controlla se il mezzo dispone effettivamente di dati live (GTFS-RT satellitare o segnalazione ritardo)
      const hasRealtimeData = Boolean(
        dep.isLive &&
          (dep.statusType !== 'scheduled' ||
            (typeof dep.delayMinutes === 'number' && dep.delayMinutes !== 0) ||
            (dep.estimatedTime && dep.scheduledTime && dep.estimatedTime !== dep.scheduledTime) ||
            isInCurrentTimeWindow)
      );

      const isLiveActive = isInCurrentTimeWindow && hasRealtimeData;

      if (!isLiveActive) {
        return {
          isLiveActive: false,
          displayTime: dep.scheduledTime || depTimeStr,
          isDelayed: false,
          isHeavyDelay: false,
          dotColor: undefined,
          delayText: null,
          countdownText: null,
        };
      }

      const delayMins = typeof dep.delayMinutes === 'number' ? dep.delayMinutes : 0;
      const isDelayed = dep.statusType === 'delayed' || delayMins > 1;
      const isHeavyDelay = isDelayed && delayMins >= 5;
      const dotColor = isDelayed ? (isHeavyDelay ? '#ef4444' : '#f59e0b') : '#10b981';
      const delayText = isDelayed && delayMins > 0 ? `+${delayMins}m` : null;

      // Calcolo testo countdown: "In arrivo", "tra Xm" o cadenzamento ad alta frequenza "ogni Xm"
      let countdownText: string | null = null;
      if (diff <= 1) {
        countdownText = 'In arrivo';
      } else {
        // Verifica se si tratta di una linea ad alta frequenza (es. Metro B) con corse cadenzate
        let headwayMins: number | null = null;
        for (let j = index + 1; j < filteredDepartures.length; j++) {
          const nextDep = filteredDepartures[j];
          if (nextDep.line.toLowerCase() === dep.line.toLowerCase()) {
            const nextMins = parseHHMMToMins(nextDep.estimatedTime || nextDep.scheduledTime);
            if (nextMins >= 0) {
              let hDiff = nextMins - depMins;
              if (hDiff < -720) hDiff += 1440;
              if (hDiff >= 3 && hDiff <= 15) {
                headwayMins = hDiff;
              }
            }
            break;
          }
        }

        if (dep.mode === 'metro' && headwayMins && diff > 6) {
          countdownText = `ogni ${headwayMins}m`;
        } else {
          countdownText = `tra ${diff}m`;
        }
      }

      return {
        isLiveActive: true,
        displayTime: dep.estimatedTime || dep.scheduledTime,
        isDelayed,
        isHeavyDelay,
        dotColor,
        delayText,
        countdownText,
      };
    },
    [isSelectedDayActiveToday, filteredDepartures]
  );



  return (
    <View style={[styles.container, { backgroundColor: '#13151b', borderColor: '#262a36' }]}>
      {/* ── SEZIONE 1: Intestazione pulita con titolo "Mezzi" e pulsante circolare di refresh ── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.headerIconBox,
              { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
            ]}
          >
            <Ionicons name="bus" size={15} color="#60a5fa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Mezzi</Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleManualRefresh}
          disabled={loading || isLocating}
          style={styles.refreshCircleBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Aggiorna mezzi e posizione GPS"
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="refresh" size={14} color="#cbd5e1" />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* ── Barra grafica compatta per la scelta del punto di partenza (Stazione vs Posizione) ── */}
      <View style={styles.originSwitchBar}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => handleSelectOrigin('station_or_campus')}
          style={[
            styles.originPillBtn,
            originMode === 'station_or_campus' && [
              styles.originPillBtnActive,
              { borderColor: 'rgba(96, 165, 250, 0.45)' },
            ],
          ]}
        >
          <Ionicons
            name={direction === 'to_campus' ? 'train-outline' : 'school-outline'}
            size={12}
            color={originMode === 'station_or_campus' ? '#60a5fa' : '#94a3b8'}
            style={{ marginRight: 5 }}
          />
          <Text
            style={[
              styles.originPillText,
              originMode === 'station_or_campus' && styles.originPillTextActive,
            ]}
            numberOfLines={1}
          >
            {direction === 'to_station' ? 'Sede' : 'Stazione'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => handleSelectOrigin('current_location')}
          style={[
            styles.originPillBtn,
            originMode === 'current_location' && [
              styles.originPillBtnActive,
              { borderColor: 'rgba(16, 185, 129, 0.45)' },
            ],
          ]}
        >
          {isLocating ? (
            <ActivityIndicator size={11} color="#10b981" style={{ marginRight: 5 }} />
          ) : (
            <Ionicons
              name="locate"
              size={12}
              color={originMode === 'current_location' ? '#10b981' : '#94a3b8'}
              style={{ marginRight: 5 }}
            />
          )}
          <Text
            style={[
              styles.originPillText,
              originMode === 'current_location' && styles.originPillTextActive,
            ]}
            numberOfLines={1}
          >
            {detectedCity ? `Posizione (${detectedCity})` : 'Posizione'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Indicatore visivo posizione GPS rilevata con nome del comune/località */}
      {originMode === 'current_location' && !locationError && (
        <View style={styles.gpsNoticeRow}>
          {isLocating ? (
            <ActivityIndicator size={11} color="#10b981" style={{ marginRight: 5 }} />
          ) : (
            <Ionicons
              name="navigate"
              size={12}
              color="#10b981"
              style={{ marginRight: 5 }}
            />
          )}
          <Text style={styles.gpsNoticeText} numberOfLines={1}>
            {isLocating
              ? 'Rilevamento posizione GPS in corso...'
              : detectedCity
              ? `Partenza da: ${detectedCity} (GPS)`
              : 'Partenza dalla tua posizione GPS'}
          </Text>
        </View>
      )}

      {/* Segnalazione errore localizzazione */}
      {locationError && (
        <View style={styles.errorNoticeRow}>
          <Ionicons
            name="alert-circle-outline"
            size={12}
            color="#f87171"
            style={{ marginRight: 5 }}
          />
          <Text style={styles.errorNoticeText}>{locationError}</Text>
        </View>
      )}

      {/* ── Sezione "Linee consigliate" con colori specifici preservati ── */}
      {boardData && boardData.directLines.length > 0 && (
        <View style={styles.chipsSection}>
          <Text style={styles.chipsLabel}>Linee consigliate</Text>
          <View style={styles.chipsContainer}>
            {boardData.directLines.map((line) => {
              const isSelected =
                selectedLineFilter?.toLowerCase() === line.toLowerCase();
              const lineColor = getLineBadgeColor(line);
              const lineIcon = getTransitModeIcon(undefined, line);

              return (
                <TouchableOpacity
                  key={`line-chip-${line}`}
                  activeOpacity={0.75}
                  onPress={() => {
                    setSelectedLineFilter(isSelected ? null : line);
                    setExpansionLevel('collapsed');
                  }}
                  style={[
                    styles.lineChip,
                    {
                      backgroundColor: isSelected ? lineColor : `${lineColor}20`,
                      borderColor: isSelected ? '#ffffff' : `${lineColor}75`,
                    },
                  ]}
                >
                  <Ionicons
                    name={lineIcon}
                    size={11}
                    color={isSelected ? '#ffffff' : lineColor}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.lineChipText,
                      {
                        color: '#ffffff',
                        fontWeight: isSelected ? '800' : '700',
                      },
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
                onPress={() => {
                  setSelectedLineFilter(null);
                  setExpansionLevel('collapsed');
                }}
                style={styles.resetFilterChip}
              >
                <Ionicons name="close" size={11} color="#94a3b8" />
                <Text style={styles.resetFilterText}>Tutte</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── SEZIONE 4: Lista schematica dei mezzi senza alcun troncamento del testo ── */}
      {loading && !boardData ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#60a5fa" />
          <Text style={styles.loadingText}>
            {originMode === 'current_location' && isLocating && !userCoords
              ? 'Rilevamento posizione GPS in corso...'
              : originMode === 'current_location'
              ? 'Calcolo percorso e mezzi dalla tua posizione...'
              : canUseLive
              ? 'Aggiornamento passaggi e coincidenze in tempo reale...'
              : 'Calcolo orari programmati e ultimo mezzo utile...'}
          </Text>
        </View>
      ) : displayedDepartures.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
          <Text style={styles.emptyText}>
            {selectedLineFilter
              ? `Nessun passaggio trovato per la linea ${selectedLineFilter}`
              : 'Nessuna corsa disponibile per questa fascia oraria'}
          </Text>
        </View>
      ) : (
        <View style={styles.departuresList}>
          {displayedDepartures.map((dep, index) => {
            const badgeBg = getLineBadgeColor(dep.line, dep.mode);
            const modeIcon = getTransitModeIcon(dep.mode, dep.line);
            const liveInfo = getDepartureLiveInfo(dep, index);
            const displayTime = liveInfo.displayTime;
            const countdown = liveInfo.countdownText;
            const isDelayed = liveInfo.isDelayed;
            const isHeavyDelay = liveInfo.isHeavyDelay;
            const dotColor = liveInfo.dotColor;
            const isLiveTrip = liveInfo.isLiveActive;

            return (
              <TouchableOpacity
                key={dep.id || `dep-${index}`}
                activeOpacity={0.8}
                onPress={() => setSelectedDepartureModal(dep)}
                style={styles.schematicCard}
              >
                {/* Riga 1: Badge Linea + Pallino Live a sinistra; Orario + Durata (e sotto Countdown) a destra */}
                <View style={styles.schematicTopRow}>
                  <View style={styles.schematicTopLeft}>
                    {/* Badge Linea / Soluzione con cambio compatta */}
                    {dep.legs && dep.legs.length > 1 ? (
                      <View style={styles.multiLegBadgeContainer}>
                        {dep.legs.map((leg, lIdx) => {
                          const lColor = getLineBadgeColor(leg.line, leg.mode);
                          const lIcon = getTransitModeIcon(leg.mode, leg.line);
                          const shortLine = leg.line.replace(/^Metro\s+/i, 'M');
                          return (
                            <React.Fragment key={`leg-badge-${lIdx}`}>
                              {lIdx > 0 && (
                                <Ionicons
                                  name="arrow-forward"
                                  size={10}
                                  color="#94a3b8"
                                  style={{ marginHorizontal: 2 }}
                                />
                              )}
                              <View
                                style={[
                                  styles.lineBadgeBoxCompact,
                                  { backgroundColor: lColor },
                                ]}
                              >
                                <Ionicons
                                  name={lIcon}
                                  size={10}
                                  color="#ffffff"
                                  style={{ marginRight: 3 }}
                                />
                                <Text style={styles.lineBadgeTextCompact}>
                                  {shortLine}
                                </Text>
                              </View>
                            </React.Fragment>
                          );
                        })}
                      </View>
                    ) : dep.line.includes(' + ') ? (
                      <View style={styles.multiLegBadgeContainer}>
                        {dep.line.split(' + ').map((part, pIdx) => {
                          const pTrim = part.trim();
                          const pColor = getLineBadgeColor(pTrim);
                          const pIcon = getTransitModeIcon(undefined, pTrim);
                          const shortPart = pTrim.replace(/^Metro\s+/i, 'M');
                          return (
                            <React.Fragment key={`part-badge-${pIdx}`}>
                              {pIdx > 0 && (
                                <Ionicons
                                  name="arrow-forward"
                                  size={10}
                                  color="#94a3b8"
                                  style={{ marginHorizontal: 2 }}
                                />
                              )}
                              <View
                                style={[
                                  styles.lineBadgeBoxCompact,
                                  { backgroundColor: pColor },
                                ]}
                              >
                                <Ionicons
                                  name={pIcon}
                                  size={10}
                                  color="#ffffff"
                                  style={{ marginRight: 3 }}
                                />
                                <Text style={styles.lineBadgeTextCompact}>
                                  {shortPart}
                                </Text>
                              </View>
                            </React.Fragment>
                          );
                        })}
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.lineBadgeBox,
                          { backgroundColor: badgeBg },
                        ]}
                      >
                        <Ionicons
                          name={modeIcon}
                          size={12}
                          color="#ffffff"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.lineBadgeText}>{dep.line}</Text>
                      </View>
                    )}

                    {/* Pallino di stato Live e ritardo affiancato al badge della linea */}
                    {isLiveTrip && dotColor && (
                      <View style={styles.liveStatusDotWrap}>
                        <View
                          style={[
                            styles.liveStatusDot,
                            { backgroundColor: dotColor },
                          ]}
                        />
                        {isDelayed && dep.delayMinutes > 0 && (
                          <Text
                            style={[
                              styles.liveDelayText,
                              isHeavyDelay && { color: '#f87171' },
                            ]}
                          >
                            +{dep.delayMinutes}m
                          </Text>
                        )}
                      </View>
                    )}
                  </View>

                  {/* Colonna Destra: Orario + Durata sopra; Badge "tra xm" allineato a destra sotto */}
                  <View style={styles.schematicTopRight}>
                    <View style={styles.schematicTimeAndDurationRow}>
                      {isDelayed &&
                        dep.scheduledTime &&
                        dep.scheduledTime !== displayTime && (
                          <Text style={styles.timeScheduledStrike}>
                            {dep.scheduledTime}
                          </Text>
                        )}
                      <Text
                        style={[
                          styles.departureTimeMain,
                          isDelayed && { color: isHeavyDelay ? '#f87171' : '#fb923c' },
                        ]}
                      >
                        {displayTime}
                      </Text>

                      {/* Durata del viaggio con icona time-outline e formato xm */}
                      <View style={styles.durationInlineBadge}>
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color="#94a3b8"
                          style={{ marginRight: 3 }}
                        />
                        <Text style={styles.durationInlineBadgeText}>
                          {dep.durationMinutes}m
                        </Text>
                      </View>
                    </View>

                    {/* Badge "tra xm" posizionato SOTTO quello della durata (stessa dimensione), allineato a destra */}
                    {isLiveTrip && countdown && (
                      <View style={styles.countdownBadge}>
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color="#34d399"
                          style={{ marginRight: 3 }}
                        />
                        <Text style={styles.countdownText} numberOfLines={1}>
                          {countdown}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Badge Soluzione con Cambio: esclusivamente "Con un cambio" senza numeri */}
                {(!dep.isDirect || dep.transfersCount > 0) && (
                  <View style={styles.transferBadgeRow}>
                    <Ionicons
                      name="git-branch-outline"
                      size={11}
                      color="#c084fc"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.transferBadgeText}>
                      {dep.transfersCount && dep.transfersCount > 1
                        ? `Con ${dep.transfersCount} cambi`
                        : 'Con un cambio'}
                    </Text>
                  </View>
                )}

                {/* Blocco Schematico: Direzione per esteso */}
                <View style={styles.schematicBody}>
                  <View style={styles.schemaFieldRow}>
                    <Text style={styles.schemaFieldLabel}>Direzione:</Text>
                    <Text style={styles.schemaFieldValue} numberOfLines={1}>{dep.headsign}</Text>
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color="#64748b"
                      style={{ marginLeft: 6, marginTop: 2 }}
                    />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Pulsante espansione corse a due livelli (intorno mezz'ora -> limite d'ora -> riduci) */}
      {filteredDepartures.length > 3 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleToggleExpansion}
          style={styles.expandButton}
        >
          <Text style={styles.expandButtonText}>
            {expansionLevel === 'collapsed'
              ? halfHourDepartures.length > 3 && halfHourDepartures.length < filteredDepartures.length
                ? 'Mostra corse (+30 min)'
                : `Mostra altre corse (${filteredDepartures.length - 3})`
              : expansionLevel === 'half_hour' && filteredDepartures.length > displayedDepartures.length
              ? `Mostra tutte le altre corse (${filteredDepartures.length - displayedDepartures.length})`
              : 'Riduci corse'}
          </Text>
          <Ionicons
            name={
              expansionLevel === 'full' ||
              (expansionLevel === 'half_hour' && filteredDepartures.length <= displayedDepartures.length)
                ? 'chevron-up'
                : 'chevron-down'
            }
            size={12}
            color="#60a5fa"
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>
      )}

      {/* ── SEZIONE 5: Nuovo Modale di Dettaglio con Mappa Interattiva ── */}
      <TransitDepartureModal
        visible={Boolean(selectedDepartureModal)}
        departure={selectedDepartureModal}
        allDepartures={boardData?.departures || []}
        directLines={boardData?.directLines || []}
        isLiveContext={canUseLive}
        theme={theme}
        onClose={() => setSelectedDepartureModal(null)}
        onSelectDeparture={(newDep) => setSelectedDepartureModal(newDep)}
      />
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
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  refreshCircleBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1e2230',
    borderWidth: 1,
    borderColor: '#2e3446',
    alignItems: 'center',
    justifyContent: 'center',
  },
  originSwitchBar: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    backgroundColor: '#0c0e14',
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2230',
  },
  originPillBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  originPillBtnActive: {
    backgroundColor: '#1a2030',
  },
  originPillText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  originPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  gpsNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  gpsNoticeText: {
    flex: 1,
    color: '#6ee7b7',
    fontSize: 10.5,
    fontWeight: '600',
  },
  errorNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorNoticeText: {
    flex: 1,
    color: '#f87171',
    fontSize: 10.5,
    fontWeight: '500',
  },
  chipsSection: {
    marginBottom: 10,
  },
  chipsLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 5,
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
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  lineChipText: {
    fontSize: 11,
  },
  resetFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 4.5,
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
    textAlign: 'center',
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
    gap: 8,
    marginTop: 2,
  },
  schematicCard: {
    backgroundColor: '#181b24',
    borderRadius: 11,
    padding: 10,
    borderWidth: 1,
    borderColor: '#252a38',
  },
  schematicTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  schematicTopLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginRight: 8,
  },
  schematicTopRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  schematicTimeAndDurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  multiLegBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexWrap: 'wrap',
  },
  lineBadgeBoxCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lineBadgeTextCompact: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },
  durationInlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  durationInlineBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  transferBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 7,
  },
  transferBadgeText: {
    color: '#c084fc',
    fontSize: 10.5,
    fontWeight: '700',
  },
  lineBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    minWidth: 50,
    justifyContent: 'center',
  },
  lineBadgeText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  liveStatusDotWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
  },
  liveStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  liveDelayText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
  },
  timeScheduledStrike: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  departureTimeMain: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 7,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  countdownText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  schematicBody: {
    backgroundColor: '#11141c',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 4,
    borderWidth: 1,
    borderColor: '#1e2330',
  },
  schemaFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  schemaFieldLabel: {
    color: '#64748b',
    fontSize: 10.5,
    fontWeight: '700',
    width: 66,
    marginTop: 0.5,
  },
  schemaFieldValue: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
  },
  depAlertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  depAlertText: {
    flex: 1,
    color: '#fbbf24',
    fontSize: 10.5,
    fontWeight: '600',
    lineHeight: 15,
  },
  schematicFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 7,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#222736',
  },
  footerMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  footerMetaText: {
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: '600',
  },
  footerActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerActionText: {
    color: '#60a5fa',
    fontSize: 10.5,
    fontWeight: '700',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1c202c',
  },
  expandButtonText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '600',
  },
});
