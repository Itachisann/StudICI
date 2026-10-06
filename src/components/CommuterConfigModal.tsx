import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { CommuterConfig, StationInfo } from '../types/commuter';
import { POPULAR_STATIONS, searchStations } from '../utils/trenitaliaApi';
import { calculateDrivingEstimate, DrivingEstimate } from '../utils/drivingRouter';

const SAPIENZA_RED = '#822433';

interface Props {
  visible: boolean;
  config: CommuterConfig;
  onClose: () => void;
  onSave: (newConfig: CommuterConfig) => void;
}

export function CommuterConfigModal({ visible, config, onClose, onSave }: Props) {
  const [prevConfig, setPrevConfig] = useState(config);
  const [localConfig, setLocalConfig] = useState<CommuterConfig>(config);
  const [stationPickerType, setStationPickerType] = useState<'departure' | 'arrival' | null>(null);
  const [stationSearchQuery, setStationSearchQuery] = useState('');
  const [stationResults, setStationResults] = useState<StationInfo[]>(POPULAR_STATIONS);
  const [searchingStations, setSearchingStations] = useState(false);
  const [drivingEstimate, setDrivingEstimate] = useState<DrivingEstimate | null>(null);
  const [calculatingDriving, setCalculatingDriving] = useState(false);

  if (config !== prevConfig) {
    setPrevConfig(config);
    setLocalConfig(config);
  }

  // Calcolo automatico della stima di guida all'apertura o modifica indirizzo / stazione
  useEffect(() => {
    let cancelled = false;
    const fetchDriveEstimate = async () => {
      if (!localConfig.carLeg.enabled) return;
      setCalculatingDriving(true);
      try {
        const est = await calculateDrivingEstimate(
          localConfig.originAddress,
          localConfig.departureStation.shortName || localConfig.departureStation.name
        );
        if (!cancelled) {
          setDrivingEstimate(est);
          setLocalConfig((prev) => ({
            ...prev,
            carLeg: {
              ...prev.carLeg,
              durationMinutes: est.durationMinutes,
              distanceKm: est.distanceKm,
            },
          }));
        }
      } catch (err) {
        console.warn('Errore calcolo guida:', err);
      } finally {
        if (!cancelled) setCalculatingDriving(false);
      }
    };

    const timer = setTimeout(fetchDriveEstimate, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    localConfig.originAddress,
    localConfig.departureStation.shortName,
    localConfig.departureStation.name,
    localConfig.carLeg.enabled,
  ]);

  const handleSearchChange = (text: string) => {
    setStationSearchQuery(text);
    if (!text.trim()) {
      setStationResults(POPULAR_STATIONS);
      setSearchingStations(false);
      return;
    }
    setSearchingStations(true);
    searchStations(text).then((res) => {
      setStationResults(res);
      setSearchingStations(false);
    });
  };

  const handleSave = () => {
    onSave(localConfig);
    onClose();
  };

  const selectStation = (station: StationInfo) => {
    if (stationPickerType === 'departure') {
      setLocalConfig((prev) => ({
        ...prev,
        departureStation: station,
      }));
    } else if (stationPickerType === 'arrival') {
      setLocalConfig((prev) => ({
        ...prev,
        arrivalStation: station,
      }));
    }
    setStationPickerType(null);
    setStationSearchQuery('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />

        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.cancelText}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Impostazioni Pendolare</Text>
            <TouchableOpacity onPress={handleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.saveText}>Salva</Text>
            </TouchableOpacity>
          </View>

          {stationPickerType ? (
            /* Picker Stazione */
            <View style={{ flex: 1, padding: 16 }}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => {
                    setStationPickerType(null);
                    setStationSearchQuery('');
                  }}
                >
                  <Ionicons name="arrow-back" size={20} color="#38bdf8" />
                  <Text style={styles.backBtnText}>Torna alle opzioni</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>
                  {stationPickerType === 'departure'
                    ? 'Seleziona Stazione di Partenza'
                    : 'Seleziona Stazione di Arrivo'}
                </Text>
              </View>

              <View style={styles.searchBar}>
                <Ionicons name="search" size={17} color="#8e8e93" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Cerca stazione FS o Trenitalia..."
                  placeholderTextColor="#666"
                  value={stationSearchQuery}
                  onChangeText={handleSearchChange}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
                {searchingStations && <ActivityIndicator size="small" color="#38bdf8" />}
              </View>

              <ScrollView style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>
                  {stationSearchQuery.trim() ? 'Risultati Trenitalia' : 'Stazioni Principali'}
                </Text>
                {stationResults.map((st) => (
                  <TouchableOpacity
                    key={st.code}
                    style={styles.stationRow}
                    activeOpacity={0.7}
                    onPress={() => selectStation(st)}
                  >
                    <View style={styles.stationIconCircle}>
                      <Ionicons name="train" size={16} color="#38bdf8" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stationName}>{st.shortName || st.name}</Text>
                      <Text style={styles.stationCode}>Codice: {st.code}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#475569" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : (
            /* Form Configurazione */
            <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Partenza da casa */}
              <View style={styles.card}>
                <Text style={styles.cardHeader}>1. PARTENZA DA CASA</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Indirizzo di Casa o Comune di Partenza</Text>
                  <TextInput
                    style={styles.textInput}
                    value={localConfig.originAddress}
                    onChangeText={(val) =>
                      setLocalConfig((prev) => ({ ...prev, originAddress: val }))
                    }
                    placeholder="Es. Via Amerina 15, Amelia (oppure Amelia)"
                    placeholderTextColor="#666"
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                  <Text style={styles.inputHelp}>
                    Puoi inserire sia il tuo indirizzo completo con via e numero civico (es. Via Amerina 15, Amelia), sia solo il comune. Il calcolo percorso e la navigazione useranno l&apos;indirizzo preciso.
                  </Text>
                </View>
              </View>

              {/* Tragitto in Auto */}
              <View style={styles.card}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.cardHeader}>2. TRAGITTO IN AUTO</Text>
                    <Text style={styles.switchDesc}>
                      Raggiungi la stazione del treno con la tua auto (es. da Amelia a Orte FS)
                    </Text>
                  </View>
                  <Switch
                    value={localConfig.carLeg.enabled}
                    onValueChange={(val) =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        carLeg: { ...prev.carLeg, enabled: val },
                      }))
                    }
                    trackColor={{ false: '#334155', true: SAPIENZA_RED }}
                  />
                </View>

                {localConfig.carLeg.enabled && (
                  <View style={{ marginTop: 12 }}>
                    {/* Box Calcolo Automatico da Mappe */}
                    <View style={styles.autoCalcCard}>
                      <View style={styles.autoCalcHeader}>
                        <View style={styles.autoCalcIconBadge}>
                          <Ionicons name="car-sport" size={16} color="#38bdf8" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.autoCalcTitle}>Calcolo Percorso Automatico</Text>
                          <Text style={styles.autoCalcRoute} numberOfLines={1}>
                            {localConfig.originAddress || 'Partenza'} ➔ Stazione {localConfig.departureStation.shortName || localConfig.departureStation.name}
                          </Text>
                        </View>
                        {calculatingDriving ? (
                          <ActivityIndicator size="small" color="#38bdf8" />
                        ) : (
                          <TouchableOpacity
                            style={styles.recalcBtn}
                            activeOpacity={0.7}
                            onPress={async () => {
                              setCalculatingDriving(true);
                              try {
                                const est = await calculateDrivingEstimate(
                                  localConfig.originAddress,
                                  localConfig.departureStation.shortName || localConfig.departureStation.name
                                );
                                setDrivingEstimate(est);
                                setLocalConfig((prev) => ({
                                  ...prev,
                                  carLeg: {
                                    ...prev.carLeg,
                                    durationMinutes: est.durationMinutes,
                                    distanceKm: est.distanceKm,
                                  },
                                }));
                              } finally {
                                setCalculatingDriving(false);
                              }
                            }}
                          >
                            <Ionicons name="refresh" size={12} color="#38bdf8" style={{ marginRight: 3 }} />
                            <Text style={styles.recalcBtnText}>Ricalcola</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={styles.autoCalcStatsRow}>
                        <View style={styles.autoCalcStat}>
                          <Text style={styles.autoCalcStatValue}>
                            {localConfig.carLeg.durationMinutes || 24} min
                          </Text>
                          <Text style={styles.autoCalcStatLabel}>Tempo Guida Stimato</Text>
                        </View>
                        <View style={styles.autoCalcStatDivider} />
                        <View style={styles.autoCalcStat}>
                          <Text style={styles.autoCalcStatValue}>
                            {localConfig.carLeg.distanceKm ? `${localConfig.carLeg.distanceKm} km` : '~17.2 km'}
                          </Text>
                          <Text style={styles.autoCalcStatLabel}>Distanza Stradale</Text>
                        </View>
                      </View>

                      <Text style={styles.autoCalcSummaryText}>
                        {drivingEstimate?.routeSummary || 'Calcolato automaticamente tramite mappe e viabilità stradale.'}
                      </Text>
                    </View>

                    {/* Margine Parcheggio & Accesso */}
                    <View style={styles.stepperRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.stepperLabel}>Margine Parcheggio & Accesso (minuti)</Text>
                        <Text style={styles.stepperHelp}>Tempo per posteggiare l&apos;auto e raggiungere il binario FS</Text>
                      </View>
                      <View style={styles.stepperControls}>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                parkingBufferMinutes: Math.max(2, prev.carLeg.parkingBufferMinutes - 1),
                              },
                            }))
                          }
                        >
                          <Ionicons name="remove" size={16} color="#fff" />
                        </TouchableOpacity>
                        <Text style={styles.stepperValue}>
                          {localConfig.carLeg.parkingBufferMinutes} min
                        </Text>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                parkingBufferMinutes: prev.carLeg.parkingBufferMinutes + 1,
                              },
                            }))
                          }
                        >
                          <Ionicons name="add" size={16} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}
              </View>

              {/* Stazioni Treno */}
              <View style={styles.card}>
                <Text style={styles.cardHeader}>3. TRATTA IN TRENO (TRENITALIA)</Text>

                <TouchableOpacity
                  style={styles.stationSelectRow}
                  activeOpacity={0.7}
                  onPress={() => setStationPickerType('departure')}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Stazione di Partenza</Text>
                    <Text style={styles.stationSelectedText}>
                      {localConfig.departureStation.shortName || localConfig.departureStation.name}
                    </Text>
                  </View>
                  <View style={styles.changeBadge}>
                    <Text style={styles.changeBadgeText}>Modifica</Text>
                    <Ionicons name="chevron-forward" size={12} color="#38bdf8" />
                  </View>
                </TouchableOpacity>

                <View style={styles.divider} />

                <TouchableOpacity
                  style={styles.stationSelectRow}
                  activeOpacity={0.7}
                  onPress={() => setStationPickerType('arrival')}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Stazione di Arrivo (Roma)</Text>
                    <Text style={styles.stationSelectedText}>
                      {localConfig.arrivalStation.shortName || localConfig.arrivalStation.name}
                    </Text>
                  </View>
                  <View style={styles.changeBadge}>
                    <Text style={styles.changeBadgeText}>Modifica</Text>
                    <Ionicons name="chevron-forward" size={12} color="#38bdf8" />
                  </View>
                </TouchableOpacity>
              </View>

              {/* Mezzi Pubblici Urbani a Roma */}
              <View style={styles.card}>
                <Text style={styles.cardHeader}>4. TRAGITTO URBANO A ROMA</Text>

                {/* Ottimizzazione Dinamica Mezzi Urbani */}
                <View style={styles.urbanTransitBanner}>
                  <View style={styles.urbanTransitHeader}>
                    <View style={styles.urbanTransitIconBadge}>
                      <Ionicons name="git-merge" size={16} color="#a855f7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.urbanTransitTitle}>Ottimizzazione Dinamica Mezzi</Text>
                      <Text style={styles.urbanTransitSubtitle}>
                        Calcolo automatico per ogni aula e orario
                      </Text>
                    </View>
                    <View style={styles.autoBadge}>
                      <Text style={styles.autoBadgeText}>AUTOMATICO</Text>
                    </View>
                  </View>

                  <View style={styles.urbanModesRow}>
                    <View style={styles.urbanModePill}>
                      <Ionicons name="subway-outline" size={12} color="#38bdf8" />
                      <Text style={styles.urbanModeText}>Metro B / A</Text>
                    </View>
                    <View style={styles.urbanModePill}>
                      <Ionicons name="bus-outline" size={12} color="#fb923c" />
                      <Text style={styles.urbanModeText}>Bus ATAC</Text>
                    </View>
                    <View style={styles.urbanModePill}>
                      <Ionicons name="train-outline" size={12} color="#34c759" />
                      <Text style={styles.urbanModeText}>Tram 3 / 19</Text>
                    </View>
                    <View style={styles.urbanModePill}>
                      <Ionicons name="walk-outline" size={12} color="#e2e8f0" />
                      <Text style={styles.urbanModeText}>A piedi</Text>
                    </View>
                  </View>

                  <Text style={styles.urbanTransitDesc}>
                    L&apos;app seleziona automaticamente il mezzo più veloce dalla stazione ({localConfig.arrivalStation.shortName || 'Roma'}) fino all&apos;aula esatta di lezione (es. Bus 649 o Metro A per Sede Ariosto RM102 alla fermata Conte Verde/Manzoni a soli 180m, Metro B per S. Pietro in Vincoli, a piedi per Polo Tiburtina RM025, Bus per Città Universitaria).
                  </Text>
                  <Text style={styles.urbanTransitDescSecondary}>
                    Toccando la card di viaggio, Google Maps si apre già precompilato con la data e l&apos;orario effettivo di inizio o fine lezione, mostrando le linee e fermate attive a quell&apos;ora.
                  </Text>
                </View>

                {/* Anticipo di sicurezza in aula */}
                <View style={[styles.stepperRow, { marginTop: 14 }]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.stepperLabel}>Anticipo di sicurezza in aula (minuti)</Text>
                    <Text style={styles.stepperHelp}>
                      Arrivo anticipato per entrare in sede e prendere posto prima dell&apos;inizio della lezione
                    </Text>
                  </View>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          bufferMinutes: Math.max(2, prev.bufferMinutes - 2),
                        }))
                      }
                    >
                      <Ionicons name="remove" size={16} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{localConfig.bufferMinutes} min</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          bufferMinutes: prev.bufferMinutes + 2,
                        }))
                      }
                    >
                      <Ionicons name="add" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modalContainer: {
    height: '90%',
    backgroundColor: '#16181d',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
  },
  cancelText: {
    fontSize: 16,
    color: '#94a3b8',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#38bdf8',
  },
  body: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 14,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  inputGroup: {
    marginTop: 6,
  },
  inputLabel: {
    fontSize: 13,
    color: '#cbd5e1',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputHelp: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchDesc: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  stepperLabel: {
    fontSize: 13,
    color: '#cbd5e1',
    flex: 1,
    paddingRight: 8,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 10,
    padding: 3,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 10,
    minWidth: 55,
    textAlign: 'center',
  },
  stationSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  stationSelectedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#38bdf8',
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeBadgeText: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '600',
    marginRight: 3,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 10,
  },
  pickerHeader: {
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtnText: {
    color: '#38bdf8',
    fontSize: 14,
    marginLeft: 4,
    fontWeight: '600',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stationIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  stationName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  stationCode: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  autoCalcCard: {
    backgroundColor: 'rgba(56, 189, 248, 0.07)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    padding: 12,
    marginBottom: 10,
  },
  autoCalcHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  autoCalcIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
  },
  autoCalcTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  autoCalcRoute: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  recalcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  recalcBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
  },
  autoCalcStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  autoCalcStat: {
    flex: 1,
    alignItems: 'center',
  },
  autoCalcStatValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#38bdf8',
  },
  autoCalcStatLabel: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  autoCalcStatDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  autoCalcSummaryText: {
    fontSize: 11,
    color: '#cbd5e1',
    lineHeight: 15,
  },
  stepperHelp: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  urbanTransitBanner: {
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.22)',
    padding: 12,
  },
  urbanTransitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  urbanTransitIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
  },
  urbanTransitTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  urbanTransitSubtitle: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 1,
  },
  autoBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  autoBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#c084fc',
    letterSpacing: 0.5,
  },
  urbanModesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 8,
  },
  urbanModePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  urbanModeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  urbanTransitDesc: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 15,
  },
  urbanTransitDescSecondary: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 15,
    marginTop: 4,
  },
});
