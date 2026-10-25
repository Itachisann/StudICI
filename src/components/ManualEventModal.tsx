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
import { NativeSheetModal } from './NativeSheetModal';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_MODAL_BG } from '@/constants/theme';
import {
  ManualClassEvent,
  ManualEventRepetition,
  getDefaultSemesterEndDate,
} from '@/utils/manualEvents';
import { getDateForDayIndex } from '@/utils/attendance';

interface ManualEventModalProps {
  visible: boolean;
  editingEvent?: ManualClassEvent | null;
  initialDayIndex?: number;
  onClose: () => void;
  onSave: (eventData: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'>, id?: string) => void;
  onDelete?: (id: string) => void;
}

const DAYS_SHORT = ['LUN', 'MAR', 'MER', 'GIO', 'VEN'];
const TIME_PRESETS = [
  { start: '08:30', end: '10:30', label: '08:30 - 10:30' },
  { start: '10:30', end: '12:30', label: '10:30 - 12:30' },
  { start: '14:00', end: '16:00', label: '14:00 - 16:00' },
  { start: '16:00', end: '18:00', label: '16:00 - 18:00' },
];

function ManualEventForm({
  editingEvent,
  initialDayIndex = 0,
  onClose,
  onSave,
  onDelete,
}: Omit<ManualEventModalProps, 'visible'>) {
  const { theme } = useTheme();

  const defaultSemesterEnd = useMemo(() => getDefaultSemesterEndDate(), []);
  const safeInitialDay = Math.min(Math.max(0, initialDayIndex), 4);

  const [subject, setSubject] = useState(editingEvent?.subject || '');
  const [teacher, setTeacher] = useState(editingEvent?.teacher || '');
  const [room, setRoom] = useState(editingEvent?.room || '');
  const [dayIndex, setDayIndex] = useState(
    typeof editingEvent?.dayIndex === 'number' ? editingEvent.dayIndex : safeInitialDay
  );
  const [startTime, setStartTime] = useState(editingEvent?.startTime || '08:30');
  const [endTime, setEndTime] = useState(editingEvent?.endTime || '10:30');
  const [repetitionType, setRepetitionType] = useState<ManualEventRepetition>(
    editingEvent?.repetitionType || 'semester'
  );
  const [repeatUntilDate, setRepeatUntilDate] = useState(
    editingEvent?.repeatUntilDate || defaultSemesterEnd
  );

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
        ? defaultSemesterEnd
        : repetitionType === 'custom_date'
        ? (repeatUntilDate.trim() || defaultSemesterEnd)
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

  return (
    <NativeSheetModal
      visible={true}
      onClose={onClose}
      title={editingEvent ? 'Modifica Lezione' : 'Nuova Lezione'}
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: 'Salva',
          sfSymbol: 'checkmark',
          prominent: true,
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

          {/* Giorno della settimana */}
          <Text style={styles.sectionTitle}>GIORNO DELLA SETTIMANA</Text>
          <View style={styles.daySelectorRow}>
            {DAYS_SHORT.map((name, idx) => {
              const isSelected = dayIndex === idx;
              return (
                <TouchableOpacity
                  key={name}
                  style={[
                    styles.dayChip,
                    isSelected && { backgroundColor: theme.primary, borderColor: theme.primary },
                  ]}
                  onPress={() => setDayIndex(idx)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayChipText, isSelected && styles.dayChipTextSelected]}>
                    {name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Orario Inizio e Fine */}
          <Text style={styles.sectionTitle}>ORARIO LEZIONE</Text>
          <View style={styles.sectionCard}>
            <View style={styles.timeInputsRow}>
              <View style={styles.timeInputCol}>
                <Text style={styles.timeInputSublabel}>Inizio</Text>
                <TextInput
                  style={styles.timeBox}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="08:30"
                  placeholderTextColor="#64748b"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>
              <View style={styles.timeArrow}>
                <Ionicons name="arrow-forward" size={16} color="#64748b" />
              </View>
              <View style={styles.timeInputCol}>
                <Text style={styles.timeInputSublabel}>Fine</Text>
                <TextInput
                  style={styles.timeBox}
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="10:30"
                  placeholderTextColor="#64748b"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>
            </View>

            {/* Preset rapidi per l'orario */}
            <View style={styles.presetsRow}>
              {TIME_PRESETS.map((preset) => {
                const isSelected = startTime === preset.start && endTime === preset.end;
                return (
                  <TouchableOpacity
                    key={preset.label}
                    style={[
                      styles.presetChip,
                      isSelected && {
                        backgroundColor: 'rgba(239,68,68,0.2)',
                        borderColor: theme.primary,
                      },
                    ]}
                    onPress={() => {
                      setStartTime(preset.start);
                      setEndTime(preset.end);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && { color: theme.primary, fontWeight: '700' },
                      ]}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Opzioni di Ripetizione */}
          <Text style={styles.sectionTitle}>RIPETIZIONE</Text>
          <View style={styles.sectionCard}>
            {/* Opzione 1: Tutto il semestre */}
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
                    Si ripete ogni settimana fino alla fine del semestre ({defaultSemesterEnd})
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Opzione 2: Fino a data personalizzata */}
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
                <View style={styles.dateInputRow}>
                  <Text style={styles.dateInputLabel}>Ripeti fino al:</Text>
                  <TextInput
                    style={styles.dateBox}
                    value={repeatUntilDate}
                    onChangeText={setRepeatUntilDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#64748b"
                    maxLength={10}
                  />
                </View>
                <View style={styles.dateQuickChips}>
                  <TouchableOpacity
                    style={styles.dateQuickChip}
                    onPress={() => setCustomDateRelative(1)}
                  >
                    <Text style={styles.dateQuickChipText}>+1 Mese</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dateQuickChip}
                    onPress={() => setCustomDateRelative(2)}
                  >
                    <Text style={styles.dateQuickChipText}>+2 Mesi</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dateQuickChip}
                    onPress={() => setRepeatUntilDate(defaultSemesterEnd)}
                  >
                    <Text style={styles.dateQuickChipText}>Fine Semestre</Text>
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
  daySelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
  },
  dayChipTextSelected: {
    color: '#ffffff',
  },
  timeInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  timeInputCol: {
    alignItems: 'center',
    flex: 1,
  },
  timeInputSublabel: {
    fontSize: 12,
    color: '#8e8e93',
    marginBottom: 6,
    fontWeight: '600',
  },
  timeBox: {
    width: 90,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  timeArrow: {
    paddingHorizontal: 12,
    marginTop: 18,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetChipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
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
  customDateContainer: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  dateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
  },
  dateInputLabel: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  dateBox: {
    width: 120,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  dateQuickChips: {
    flexDirection: 'row',
    gap: 8,
  },
  dateQuickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  dateQuickChipText: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '600',
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
});
