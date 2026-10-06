import React, { useState } from 'react';
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

  if (config !== prevConfig) {
    setPrevConfig(config);
    setLocalConfig(config);
  }

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
                  <Text style={styles.inputLabel}>Città o Indirizzo di Partenza</Text>
                  <TextInput
                    style={styles.textInput}
                    value={localConfig.originAddress}
                    onChangeText={(val) =>
                      setLocalConfig((prev) => ({ ...prev, originAddress: val }))
                    }
                    placeholder="Es. Amelia, Orte, Terni..."
                    placeholderTextColor="#666"
                  />
                  <Text style={styles.inputHelp}>
                    Punto di partenza mattutino per il calcolo dell&apos;orario di sveglia e tragitto.
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
                    <View style={styles.stepperRow}>
                      <Text style={styles.stepperLabel}>Tempo stimato di guida (minuti)</Text>
                      <View style={styles.stepperControls}>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                durationMinutes: Math.max(5, prev.carLeg.durationMinutes - 5),
                              },
                            }))
                          }
                        >
                          <Ionicons name="remove" size={16} color="#fff" />
                        </TouchableOpacity>
                        <Text style={styles.stepperValue}>
                          {localConfig.carLeg.durationMinutes} min
                        </Text>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              carLeg: {
                                ...prev.carLeg,
                                durationMinutes: prev.carLeg.durationMinutes + 5,
                              },
                            }))
                          }
                        >
                          <Ionicons name="add" size={16} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.stepperRow}>
                      <Text style={styles.stepperLabel}>Margine Parcheggio & Accesso (minuti)</Text>
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

                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>Tempo medio verso l&apos;aula (minuti)</Text>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          transitLeg: {
                            ...prev.transitLeg,
                            durationMinutes: Math.max(5, prev.transitLeg.durationMinutes - 5),
                          },
                        }))
                      }
                    >
                      <Ionicons name="remove" size={16} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>
                      {localConfig.transitLeg.durationMinutes} min
                    </Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          transitLeg: {
                            ...prev.transitLeg,
                            durationMinutes: prev.transitLeg.durationMinutes + 5,
                          },
                        }))
                      }
                    >
                      <Ionicons name="add" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Mezzo o Linea Suggerita</Text>
                  <TextInput
                    style={styles.textInput}
                    value={localConfig.transitLeg.lineSuggestion}
                    onChangeText={(val) =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        transitLeg: { ...prev.transitLeg, lineSuggestion: val },
                      }))
                    }
                    placeholder="Es. Bus 492 / Metro B"
                    placeholderTextColor="#666"
                  />
                </View>

                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>Anticipo di sicurezza in aula (minuti)</Text>
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
});
