import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DateTimePicker,
  type DateTimePickerChangeEvent,
} from '@expo/ui/community/datetime-picker';
import { NativeSheetModal } from './NativeSheetModal';
import { NativeActionButton } from './NativeActionButton';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_MODAL_BG } from '@/constants/theme';
import {
  ManualClassEvent,
  ManualEventRepetition,
  getDefaultSemesterEndDate,
  extractSemesterEndDate,
  formatDisplayDate,
} from '@/utils/manualEvents';
import { getDateForDayIndex } from '@/utils/attendance';

interface ManualEventModalProps {
  visible: boolean;
  editingEvent?: ManualClassEvent | null;
  initialDayIndex?: number;
  semesterText?: string;
  onClose: () => void;
  onSave: (eventData: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'>, id?: string) => void;
  onDelete?: (id: string) => void;
}

const DAYS_SHORT = ['LUN', 'MAR', 'MER', 'GIO', 'VEN'];

// Preset orari richiesti dall'utente
const TIME_PRESETS = [
  { start: '08:00', end: '10:00', label: '08:00 - 10:00' },
  { start: '10:00', end: '12:00', label: '10:00 - 12:00' },
  { start: '13:00', end: '15:00', label: '13:00 - 15:00' },
  { start: '15:00', end: '17:00', label: '15:00 - 17:00' },
  { start: '17:00', end: '19:00', label: '17:00 - 19:00' },
];

const parseTimeToDate = (timeStr: string): Date => {
  const d = new Date();
  const [h, m] = (timeStr || '08:00').split(':').map(Number);
  d.setHours(isNaN(h) ? 8 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
};

const formatTimeFromDate = (date: Date): string => {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

function ManualEventForm({
  editingEvent,
  initialDayIndex = 0,
  semesterText,
  onClose,
  onSave,
  onDelete,
}: Omit<ManualEventModalProps, 'visible'>) {
  const { theme } = useTheme();

  // Calcola la data di fine semestre estratta dinamicamente dal foglio orario Sapienza (Calendario Didattico)
  const dynamicSemesterEnd = useMemo(() => {
    return extractSemesterEndDate(semesterText) || getDefaultSemesterEndDate();
  }, [semesterText]);

  const safeInitialDay = Math.min(Math.max(0, initialDayIndex), 4);

  const [subject, setSubject] = useState(editingEvent?.subject || '');
  const [teacher, setTeacher] = useState(editingEvent?.teacher || '');
  const [room, setRoom] = useState(editingEvent?.room || '');
  const [dayIndex, setDayIndex] = useState(
    typeof editingEvent?.dayIndex === 'number' ? editingEvent.dayIndex : safeInitialDay
  );
  const [startTime, setStartTime] = useState(editingEvent?.startTime || '08:00');
  const [endTime, setEndTime] = useState(editingEvent?.endTime || '10:00');
  const [repetitionType, setRepetitionType] = useState<ManualEventRepetition>(
    editingEvent?.repetitionType || 'semester'
  );
  const [repeatUntilDate, setRepeatUntilDate] = useState(
    editingEvent?.repeatUntilDate || dynamicSemesterEnd
  );

  const startTimeDate = useMemo(() => parseTimeToDate(startTime), [startTime]);
  const endTimeDate = useMemo(() => parseTimeToDate(endTime), [endTime]);

  const handleStartTimeChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    if (selectedDate) {
      const newStartStr = formatTimeFromDate(selectedDate);
      setStartTime(newStartStr);

      const startMins = selectedDate.getHours() * 60 + selectedDate.getMinutes();
      const endD = parseTimeToDate(endTime);
      const endMins = endD.getHours() * 60 + endD.getMinutes();
      if (endMins <= startMins) {
        const newEndD = new Date(selectedDate.getTime() + 2 * 60 * 60 * 1000);
        setEndTime(formatTimeFromDate(newEndD));
      }
    }
  };

  const handleEndTimeChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    if (selectedDate) {
      setEndTime(formatTimeFromDate(selectedDate));
    }
  };

  const { dateStr: currentDayDateStr, displayDate: currentDayDisplayDate } = useMemo(() => {
    return getDateForDayIndex(dayIndex);
  }, [dayIndex]);

  const handleSave = () => {
    const trimmedSubject = subject.trim();
    if (!trimmedSubject) {
      Alert.alert('Materia Mancante', 'Inserisci il nome della materia o insegnamento.', [
        { text: 'OK' },
      ]);
      return;
    }

    if (!startTime || !endTime) {
      Alert.alert('Orario Invalido', "Specifica l'orario di inizio e fine.", [{ text: 'OK' }]);
      return;
    }

    const payload: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'> = {
      subject: trimmedSubject,
      teacher: teacher.trim() || undefined,
      room: room.trim() || undefined,
      dayIndex,
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      repetitionType,
      startDate: editingEvent?.startDate || currentDayDateStr,
      repeatUntilDate: repetitionType === 'semester'
        ? dynamicSemesterEnd
        : repetitionType === 'custom_date'
        ? (repeatUntilDate.trim() || dynamicSemesterEnd)
        : undefined,
    };

    onSave(payload, editingEvent?.id);
    onClose();
  };

  const handleDelete = () => {
    if (!editingEvent || !onDelete) return;
    Alert.alert(
      'Elimina Lezione',
      `Sei sicuro di voler eliminare la lezione "${editingEvent.subject}"?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: () => {
            onDelete(editingEvent.id);
            onClose();
          },
        },
      ]
    );
  };

  const setCustomDateRelative = (monthsToAdd: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthsToAdd);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setRepeatUntilDate(`${yyyy}-${mm}-${dd}`);
  };

  // Converti stringa repeatUntilDate in oggetto Date per il DateTimePicker nativo
  const customDateObj = useMemo(() => {
    try {
      if (repeatUntilDate) {
        const [y, m, d] = repeatUntilDate.split('-').map(Number);
        if (y && m && d) return new Date(y, m - 1, d);
      }
    } catch {}
    return new Date();
  }, [repeatUntilDate]);

  return (
    <NativeSheetModal
      visible={true}
      onClose={onClose}
      title={editingEvent ? 'Modifica Lezione' : 'Nuova Lezione'}
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'checkmark',
          prominent: true,
          tintColor: theme.primary,
          accessibilityLabel: 'Salva',
          onPress: handleSave,
        },
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Sezione Dati Principali */}
          <View style={styles.sectionCard}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Materia</Text>
              <TextInput
                style={styles.textInput}
                value={subject}
                onChangeText={setSubject}
                placeholder="Es. Fisica Sperimentale"
                placeholderTextColor="#64748b"
                autoCapitalize="words"
                clearButtonMode="while-editing"
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Docente</Text>
              <TextInput
                style={styles.textInput}
                value={teacher}
                onChangeText={setTeacher}
                placeholder="Opzionale (es. Prof. Rossi)"
                placeholderTextColor="#64748b"
                autoCapitalize="words"
                clearButtonMode="while-editing"
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Aula</Text>
              <TextInput
                style={styles.textInput}
                value={room}
                onChangeText={setRoom}
                placeholder="Opzionale (es. Aula 1)"
                placeholderTextColor="#64748b"
                clearButtonMode="while-editing"
              />
            </View>
          </View>

          {/* Giorno della settimana (Animazioni & Effetto Glowing fedele alla schermata orari, senza pallino) */}
          <Text style={styles.sectionTitle}>GIORNO DELLA SETTIMANA</Text>
          <View style={styles.daysRow}>
            {DAYS_SHORT.map((name, idx) => {
              const isActive = dayIndex === idx;
              return (
                <TouchableOpacity
                  key={name}
                  style={styles.dayItem}
                  onPress={() => setDayIndex(idx)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      isActive && [
                        styles.dayCircleActive,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                  >
                    <Text style={[styles.dayText, isActive && styles.dayTextActive]}>
                      {name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selezione Orari Grafica (Inizio -> Fine a due colonne con DateTimePicker nativo) */}
          <Text style={styles.sectionTitle}>ORARIO LEZIONE</Text>
          <View style={styles.timeSelectorCard}>
            {/* Colonna Orario Inizio */}
            <View style={styles.timeColumn}>
              <Text style={styles.timeColumnLabel}>Inizio</Text>
              <View style={styles.timePickerWrapper}>
                <DateTimePicker
                  value={startTimeDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'compact' : 'default'}
                  locale="it_IT"
                  themeVariant="dark"
                  accentColor={theme.primary}
                  onValueChange={handleStartTimeChange}
                  style={styles.timePickerControl}
                />
              </View>
            </View>

            {/* Freccia Direzionale tra Inizio e Fine */}
            <View style={styles.timeArrowBox}>
              <Ionicons name="arrow-forward" size={18} color="#64748b" />
            </View>

            {/* Colonna Orario Fine */}
            <View style={styles.timeColumn}>
              <Text style={styles.timeColumnLabel}>Fine</Text>
              <View style={styles.timePickerWrapper}>
                <DateTimePicker
                  value={endTimeDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'compact' : 'default'}
                  locale="it_IT"
                  themeVariant="dark"
                  accentColor={theme.primary}
                  onValueChange={handleEndTimeChange}
                  style={styles.timePickerControl}
                />
              </View>
            </View>
          </View>

          {/* Preset rapidi per l'orario (Pill arrotondate in stile "Anticipo in aula") */}
          <Text style={styles.sectionSubTitle}>PRESET ORARI</Text>
          <View style={styles.timeQuickRow}>
            {TIME_PRESETS.map((preset) => {
              const isSelected = startTime === preset.start && endTime === preset.end;
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[
                    styles.timeQuickChip,
                    isSelected && [
                      styles.chipActive,
                      {
                        backgroundColor: `${theme.primary}25`,
                        borderColor: theme.primary,
                        shadowColor: theme.primary,
                      },
                    ],
                  ]}
                  activeOpacity={0.7}
                  onPress={() => {
                    setStartTime(preset.start);
                    setEndTime(preset.end);
                  }}
                >
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'time-outline'}
                    size={12}
                    color={isSelected ? theme.accent : '#8e8e93'}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.timeQuickChipText,
                      isSelected && { color: theme.accent, fontWeight: '700' },
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Opzioni di Ripetizione */}
          <Text style={styles.sectionTitle}>RIPETIZIONE</Text>
          <View style={styles.sectionCard}>
            {/* Opzione 1: Tutto il semestre (dinamico da calendario didattico Sapienza) */}
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setRepetitionType('semester')}
              activeOpacity={0.7}
            >
              <View style={styles.optionLeft}>
                <View
                  style={[
                    styles.radioCircle,
                    repetitionType === 'semester' && { borderColor: theme.primary },
                  ]}
                >
                  {repetitionType === 'semester' && (
                    <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>Tutto il semestre</Text>
                  <Text style={styles.optionSubtitle}>
                    Si ripete ogni settimana fino alla fine del semestre (fino al{' '}
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>
                      {formatDisplayDate(dynamicSemesterEnd)}
                    </Text>
                    )
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Opzione 2: Fino a data personalizzata con DatePicker nativo */}
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setRepetitionType('custom_date')}
              activeOpacity={0.7}
            >
              <View style={styles.optionLeft}>
                <View
                  style={[
                    styles.radioCircle,
                    repetitionType === 'custom_date' && { borderColor: theme.primary },
                  ]}
                >
                  {repetitionType === 'custom_date' && (
                    <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>Fino a data specifica</Text>
                  <Text style={styles.optionSubtitle}>
                    Si ripete ogni settimana fino alla data scelta
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {repetitionType === 'custom_date' && (
              <View style={styles.customDateContainer}>
                {/* Expo native DateTimePicker con vincoli e larghezza idonea */}
                <View style={styles.datePickerRow}>
                  <Text style={styles.datePickerLabel}>Termina il:</Text>
                  <View style={styles.datePickerWrapper}>
                    <DateTimePicker
                      value={customDateObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'compact' : 'default'}
                      locale="it_IT"
                      themeVariant="dark"
                      accentColor={theme.primary}
                      minimumDate={new Date()}
                      style={styles.datePickerControl}
                      onValueChange={(_event, selectedDate) => {
                        if (selectedDate) {
                          const yyyy = selectedDate.getFullYear();
                          const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
                          const dd = String(selectedDate.getDate()).padStart(2, '0');
                          setRepeatUntilDate(`${yyyy}-${mm}-${dd}`);
                        }
                      }}
                    />
                  </View>
                </View>

                {/* Pulsanti rapidi arrotondati a pillola con testo colore del tema */}
                <View style={styles.dateQuickChips}>
                  <TouchableOpacity
                    style={[
                      styles.dateQuickPill,
                      repeatUntilDate === (() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + 1);
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      })() && [
                        styles.chipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    onPress={() => setCustomDateRelative(1)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dateQuickPillText, { color: theme.primary }]}>
                      +1 Mese
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dateQuickPill,
                      repeatUntilDate === (() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + 2);
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      })() && [
                        styles.chipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    onPress={() => setCustomDateRelative(2)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dateQuickPillText, { color: theme.primary }]}>
                      +2 Mesi
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dateQuickPill,
                      repeatUntilDate === dynamicSemesterEnd && [
                        styles.chipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    onPress={() => setRepeatUntilDate(dynamicSemesterEnd)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dateQuickPillText, { color: theme.primary }]}>
                      Fine Semestre
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            {/* Opzione 3: Solo questa data */}
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setRepetitionType('single')}
              activeOpacity={0.7}
            >
              <View style={styles.optionLeft}>
                <View
                  style={[
                    styles.radioCircle,
                    repetitionType === 'single' && { borderColor: theme.primary },
                  ]}
                >
                  {repetitionType === 'single' && (
                    <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>Solo questa data</Text>
                  <Text style={styles.optionSubtitle}>
                    Valida solo per {currentDayDisplayDate} ({currentDayDateStr})
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* Pulsante Elimina in basso solo in modalità modifica, nel colore del tema con Callstack Liquid Glass */}
          {editingEvent && onDelete && (
            <View style={styles.bottomActionContainer}>
              <NativeActionButton
                label="Elimina questa lezione"
                accentColor={theme.primary}
                glow={true}
                onPress={handleDelete}
                icon={
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color="#ffffff"
                    style={{ marginRight: 6 }}
                  />
                }
                style={{ width: "100%", height: 50, borderRadius: 25 }}
                pillStyle={{ height: 50, borderRadius: 25 }}
                textStyle={{ fontSize: 15, fontWeight: "700", color: "#ffffff" }}
              />
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </NativeSheetModal>
  );
}

export function ManualEventModal(props: ManualEventModalProps) {
  if (!props.visible) return null;
  const formKey = props.editingEvent
    ? `edit_${props.editingEvent.id}`
    : `new_${props.initialDayIndex ?? 0}`;
  return <ManualEventForm key={formKey} {...props} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  contentContainer: {
    paddingTop: 12,
    paddingBottom: 64,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8e8e93',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionSubTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldLabel: {
    width: 80,
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
    paddingVertical: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginLeft: 14,
  },

  /* Selezione giorni con Glowing Effect nativo */
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  dayItem: {
    flex: 1,
    alignItems: 'center',
  },
  dayCircle: {
    width: '100%',
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
    backgroundColor: '#1c1c1e',
  },
  dayCircleActive: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  dayText: {
    color: '#8e8e93',
    fontSize: 12.5,
    fontWeight: '700',
  },
  dayTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },

  /* Selezione Orari Grafica Inizio -> Fine a due colonne */
  timeSelectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  timeColumn: {
    alignItems: 'center',
    flex: 1,
  },
  timeColumnLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
    marginBottom: 8,
    textAlign: 'center',
  },
  timePickerWrapper: {
    width: 110,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerControl: {
    width: 100,
    height: 38,
  },
  timeBox: {
    width: 110,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#242426',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  timeBoxValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  timeArrowBox: {
    paddingHorizontal: 12,
    marginTop: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Pill preset orari in stile "Anticipo in aula" */
  timeQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timeQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  chipActive: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  timeQuickChipText: {
    fontSize: 11.5,
    color: '#94a3b8',
    fontWeight: '600',
  },

  /* Ripetizione */
  optionRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 2,
  },

  /* DatePicker nativo */
  customDateContainer: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    marginTop: 6,
    marginBottom: 8,
  },
  datePickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  datePickerWrapper: {
    width: 140,
    height: 36,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  datePickerControl: {
    width: 140,
    height: 36,
  },
  dateQuickChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  dateQuickPill: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateQuickPillText: {
    fontSize: 12,
    fontWeight: '700',
  },

  bottomActionContainer: {
    marginTop: 24,
    marginBottom: 8,
    width: '100%',
  },
});
