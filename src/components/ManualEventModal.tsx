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
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { MenuView } from '@expo/ui/community/menu';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { NativeSheetModal } from './NativeSheetModal';
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

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === 'ios' && !isExpoGo;

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

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00',
];

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

  // Fallback modal per selezione orario su Expo Go
  const [fallbackTimePickerField, setFallbackTimePickerField] = useState<'start' | 'end' | null>(null);

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

  // Menu actions native per orario inizio
  const startTimeMenuActions = useMemo(
    () =>
      TIME_SLOTS.map((t) => ({
        id: t,
        title: t,
        state: (t === startTime ? 'on' : 'off') as 'on' | 'off',
      })),
    [startTime]
  );

  // Menu actions native per orario fine
  const endTimeMenuActions = useMemo(
    () =>
      TIME_SLOTS.map((t) => ({
        id: t,
        title: t,
        state: (t === endTime ? 'on' : 'off') as 'on' | 'off',
      })),
    [endTime]
  );

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

          {/* Selezione Orari con struttura visuale nativa iOS (uguale alla selezione del tema) */}
          <Text style={styles.sectionTitle}>ORARIO LEZIONE</Text>
          <View style={styles.sectionCard}>
            {/* Riga Orario Inizio */}
            {isNativeComponentAvailable ? (
              <MenuView
                title="Orario Inizio"
                onPressAction={({ nativeEvent }) => {
                  setStartTime(nativeEvent.event);
                  // Se l'orario di fine è precedente o uguale, spostalo di 2 ore
                  const startIdx = TIME_SLOTS.indexOf(nativeEvent.event);
                  if (startIdx >= 0) {
                    const endIdx = TIME_SLOTS.indexOf(endTime);
                    if (endIdx <= startIdx) {
                      const newEndIdx = Math.min(startIdx + 4, TIME_SLOTS.length - 1);
                      setEndTime(TIME_SLOTS[newEndIdx]);
                    }
                  }
                }}
                actions={startTimeMenuActions as any}
                style={{ width: '100%' }}
              >
                <View style={styles.tableRow}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: theme.subtle, borderColor: theme.border },
                    ]}
                  >
                    <Ionicons name="time-outline" size={17} color={theme.accent} />
                  </View>
                  <Text style={styles.rowTitle}>Orario Inizio</Text>
                  <View style={styles.themeRowPreview}>
                    <Text style={[styles.rowDetail, { color: theme.accent }]}>{startTime}</Text>
                    <Ionicons name="chevron-forward" size={15} color="#48484a" />
                  </View>
                </View>
              </MenuView>
            ) : (
              <TouchableOpacity
                style={styles.tableRow}
                activeOpacity={0.7}
                onPress={() => setFallbackTimePickerField('start')}
              >
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: theme.subtle, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="time-outline" size={17} color={theme.accent} />
                </View>
                <Text style={styles.rowTitle}>Orario Inizio</Text>
                <View style={styles.themeRowPreview}>
                  <Text style={[styles.rowDetail, { color: theme.accent }]}>{startTime}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#48484a" />
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.divider} />

            {/* Riga Orario Fine */}
            {isNativeComponentAvailable ? (
              <MenuView
                title="Orario Fine"
                onPressAction={({ nativeEvent }) => {
                  setEndTime(nativeEvent.event);
                }}
                actions={endTimeMenuActions as any}
                style={{ width: '100%' }}
              >
                <View style={styles.tableRow}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: theme.subtle, borderColor: theme.border },
                    ]}
                  >
                    <Ionicons name="time-outline" size={17} color={theme.accent} />
                  </View>
                  <Text style={styles.rowTitle}>Orario Fine</Text>
                  <View style={styles.themeRowPreview}>
                    <Text style={[styles.rowDetail, { color: theme.accent }]}>{endTime}</Text>
                    <Ionicons name="chevron-forward" size={15} color="#48484a" />
                  </View>
                </View>
              </MenuView>
            ) : (
              <TouchableOpacity
                style={styles.tableRow}
                activeOpacity={0.7}
                onPress={() => setFallbackTimePickerField('end')}
              >
                <View
                  style={[
                    styles.iconBox,
                    { backgroundColor: theme.subtle, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="time-outline" size={17} color={theme.accent} />
                </View>
                <Text style={styles.rowTitle}>Orario Fine</Text>
                <View style={styles.themeRowPreview}>
                  <Text style={[styles.rowDetail, { color: theme.accent }]}>{endTime}</Text>
                  <Ionicons name="chevron-forward" size={15} color="#48484a" />
                </View>
              </TouchableOpacity>
            )}
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
                {/* Expo native DateTimePicker */}
                <View style={styles.datePickerRow}>
                  <Text style={styles.datePickerLabel}>Termina il:</Text>
                  <DateTimePicker
                    value={customDateObj}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'compact' : 'default'}
                    themeVariant="dark"
                    accentColor={theme.primary}
                    minimumDate={new Date()}
                    onChange={(event, selectedDate) => {
                      if (selectedDate) {
                        const yyyy = selectedDate.getFullYear();
                        const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
                        const dd = String(selectedDate.getDate()).padStart(2, '0');
                        setRepeatUntilDate(`${yyyy}-${mm}-${dd}`);
                      }
                    }}
                  />
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

          {/* Tasto Elimina per lezioni esistenti */}
          {editingEvent && onDelete && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={handleDelete}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color="#ef4444" style={{ marginRight: 6 }} />
              <Text style={styles.deleteButtonText}>Elimina questa lezione</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fallback picker modal per ambienti non-iOS-standalone */}
      {fallbackTimePickerField && (
        <Modal
          visible={!!fallbackTimePickerField}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setFallbackTimePickerField(null)}
        >
          <TouchableOpacity
            style={styles.fallbackModalOverlay}
            activeOpacity={1}
            onPress={() => setFallbackTimePickerField(null)}
          >
            <View style={styles.fallbackModalCard}>
              <Text style={styles.fallbackModalTitle}>
                {fallbackTimePickerField === 'start' ? 'Seleziona Orario Inizio' : 'Seleziona Orario Fine'}
              </Text>
              <ScrollView style={{ maxHeight: 300 }}>
                {TIME_SLOTS.map((t) => {
                  const isCurrent =
                    fallbackTimePickerField === 'start' ? t === startTime : t === endTime;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.fallbackTimeRow,
                        isCurrent && { backgroundColor: `${theme.primary}25` },
                      ]}
                      onPress={() => {
                        if (fallbackTimePickerField === 'start') {
                          setStartTime(t);
                          const startIdx = TIME_SLOTS.indexOf(t);
                          const endIdx = TIME_SLOTS.indexOf(endTime);
                          if (startIdx >= 0 && endIdx <= startIdx) {
                            const newEndIdx = Math.min(startIdx + 4, TIME_SLOTS.length - 1);
                            setEndTime(TIME_SLOTS[newEndIdx]);
                          }
                        } else {
                          setEndTime(t);
                        }
                        setFallbackTimePickerField(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.fallbackTimeText,
                          isCurrent && { color: theme.accent, fontWeight: '700' },
                        ]}
                      >
                        {t}
                      </Text>
                      {isCurrent && <Ionicons name="checkmark" size={18} color={theme.accent} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
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
    paddingBottom: 24,
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

  /* Struttura visuale iOS uguale alla selezione del Tema */
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  themeRowPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowDetail: {
    fontSize: 15,
    fontWeight: '600',
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
    paddingVertical: 8,
  },
  datePickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
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

  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ef4444',
  },

  /* Fallback modal per ambienti senza MenuView */
  fallbackModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fallbackModalCard: {
    width: '100%',
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    padding: 16,
  },
  fallbackModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
  },
  fallbackTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  fallbackTimeText: {
    fontSize: 15,
    color: '#ffffff',
  },
});
