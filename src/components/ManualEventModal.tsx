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
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeSheetModal } from './NativeSheetModal';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_MODAL_BG } from '@/constants/theme';
import {
  ManualClassEvent,
  ManualEventRepetition,
  getDefaultSemesterEndDate,
  getSemesterEndDateFromSchedule,
} from '@/utils/manualEvents';
import { getDateForDayIndex } from '@/utils/attendance';

interface ManualEventModalProps {
  visible: boolean;
  editingEvent?: ManualClassEvent | null;
  initialDayIndex?: number;
  semesterInfo?: string;
  alerts?: string[];
  onClose: () => void;
  onSave: (eventData: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'>, id?: string) => void;
  onDelete?: (id: string) => void;
}

const DAYS = ['LUN', 'MAR', 'MER', 'GIO', 'VEN'];

const DEFAULT_TIME_SLOTS = [
  { start: '08:00', end: '10:00', label: '08:00 - 10:00' },
  { start: '10:00', end: '12:00', label: '10:00 - 12:00' },
  { start: '13:00', end: '15:00', label: '13:00 - 15:00' },
  { start: '15:00', end: '17:00', label: '15:00 - 17:00' },
  { start: '17:00', end: '19:00', label: '17:00 - 19:00' },
];

const ITALIAN_MONTHS_NAMES = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

function formatDateItalian(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${ITALIAN_MONTHS_NAMES[m - 1]} ${y}`;
  } catch {
    return dateStr;
  }
}

/**
 * Mini Calendario interattivo iOS per la selezione visuale della data di scadenza
 */
function InlineCalendarPicker({
  selectedDate,
  onSelectDate,
  theme,
}: {
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  theme: any;
}) {
  const initialDate = useMemo(() => {
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      const [y, m, d] = selectedDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [selectedDate]);

  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());

  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const firstDayOffset = useMemo(() => {
    // 0 = Domenica, 1 = Lunedì...
    const day = new Date(currentYear, currentMonth, 1).getDay();
    // Offset da lunedì (0=Lun, 6=Dom)
    return day === 0 ? 6 : day - 1;
  }, [currentYear, currentMonth]);

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const daysGrid = useMemo(() => {
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDayOffset; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(d);
    }
    return cells;
  }, [firstDayOffset, daysInMonth]);

  return (
    <View style={styles.calendarContainer}>
      {/* Header Mese & Frecce */}
      <View style={styles.calendarHeaderRow}>
        <TouchableOpacity
          style={styles.calendarNavBtn}
          onPress={handlePrevMonth}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color="#cbd5e1" />
        </TouchableOpacity>
        <Text style={styles.calendarMonthText}>
          {ITALIAN_MONTHS_NAMES[currentMonth]} {currentYear}
        </Text>
        <TouchableOpacity
          style={styles.calendarNavBtn}
          onPress={handleNextMonth}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
        </TouchableOpacity>
      </View>

      {/* Intestazioni Giorni (Lun-Dom) */}
      <View style={styles.calendarWeekdaysRow}>
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, idx) => (
          <Text key={idx} style={styles.calendarWeekdayText}>
            {d}
          </Text>
        ))}
      </View>

      {/* Griglia dei giorni del mese */}
      <View style={styles.calendarDaysGrid}>
        {daysGrid.map((dayNum, idx) => {
          if (dayNum === null) {
            return <View key={idx} style={styles.calendarDayCellEmpty} />;
          }

          const cellDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(
            dayNum
          ).padStart(2, '0')}`;
          const isSelected = selectedDate === cellDateStr;

          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.calendarDayCell,
                isSelected && [
                  styles.calendarDayCellActive,
                  {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                    shadowColor: theme.primary,
                  },
                ],
              ]}
              onPress={() => onSelectDate(cellDateStr)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.calendarDayText,
                  isSelected && styles.calendarDayTextActive,
                ]}
              >
                {dayNum}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ManualEventForm({
  editingEvent,
  initialDayIndex = 0,
  semesterInfo,
  alerts,
  onClose,
  onSave,
  onDelete,
}: Omit<ManualEventModalProps, 'visible'>) {
  const { theme } = useTheme();

  // Calcola la data stimata/estratta del semestre dai dati Sapienza/notizie
  const detectedSemesterEnd = useMemo(() => {
    return getSemesterEndDateFromSchedule(semesterInfo, alerts) || getDefaultSemesterEndDate();
  }, [semesterInfo, alerts]);

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
    editingEvent?.repeatUntilDate || detectedSemesterEnd
  );
  const [isCustomTimeActive, setIsCustomTimeActive] = useState(() => {
    if (!editingEvent) return false;
    return !DEFAULT_TIME_SLOTS.some(
      (s) => s.start === editingEvent.startTime && s.end === editingEvent.endTime
    );
  });

  // Animazioni di rimbalzo per i giorni della settimana (stesse animazioni del pannello orari)
  const [dayScaleAnims] = useState(() => DAYS.map(() => new Animated.Value(1)));

  const handleSelectDay = (idx: number) => {
    setDayIndex(idx);
    Animated.sequence([
      Animated.timing(dayScaleAnims[idx], {
        toValue: 0.9,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(dayScaleAnims[idx], {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
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
      repeatUntilDate:
        repetitionType === 'semester'
          ? detectedSemesterEnd
          : repetitionType === 'custom_date'
          ? (repeatUntilDate.trim() || detectedSemesterEnd)
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
          tintColor: theme.primary,
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
          {/* ── 1. Dati Principali Lezione ── */}
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

          {/* ── 2. Giorni della Settimana (Glowing + Stesse Colorazioni & Animazioni del Pannello Orari) ── */}
          <Text style={styles.sectionTitle}>GIORNO DELLA SETTIMANA</Text>
          <View style={styles.daysRow}>
            {DAYS.map((name, idx) => {
              const isSelected = dayIndex === idx;
              return (
                <TouchableOpacity
                  key={name}
                  style={styles.dayItem}
                  onPress={() => handleSelectDay(idx)}
                  activeOpacity={0.7}
                >
                  <Animated.View
                    style={[
                      styles.dayCircle,
                      isSelected && [
                        styles.dayCircleActive,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                      { transform: [{ scale: dayScaleAnims[idx] }] },
                    ]}
                  >
                    <Text style={[styles.dayText, isSelected && styles.dayTextActive]}>
                      {name}
                    </Text>
                  </Animated.View>
                  {isSelected && (
                    <View style={[styles.dayDot, { backgroundColor: theme.primary }]} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── 3. Orari Lezione di Default (Pill stile 'Anticipo in aula' in CommuterConfigModal) ── */}
          <Text style={styles.sectionTitle}>ORARI LEZIONE (PRESET RAPIDI)</Text>
          <View style={styles.timeQuickRow}>
            {DEFAULT_TIME_SLOTS.map((slot) => {
              const isSelected = !isCustomTimeActive && startTime === slot.start && endTime === slot.end;
              return (
                <TouchableOpacity
                  key={slot.label}
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
                    setIsCustomTimeActive(false);
                    setStartTime(slot.start);
                    setEndTime(slot.end);
                  }}
                >
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'time-outline'}
                    size={13}
                    color={isSelected ? theme.accent : '#8e8e93'}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && [styles.chipTextActive, { color: theme.accent }],
                    ]}
                    numberOfLines={1}
                  >
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── 4. Selezione Orari stile Lista Tema (Theme Grid & Cards con V del Colore Tema) ── */}
          <Text style={styles.sectionTitle}>SELEZIONE DETTAGLIATA ORARIO</Text>
          <View style={styles.themeGrid}>
            {DEFAULT_TIME_SLOTS.map((slot) => {
              const isSelected = !isCustomTimeActive && startTime === slot.start && endTime === slot.end;
              return (
                <TouchableOpacity
                  key={slot.label}
                  style={[
                    styles.themeCardItem,
                    isSelected && {
                      borderColor: theme.primary,
                      backgroundColor: `${theme.primary}18`,
                    },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => {
                    setIsCustomTimeActive(false);
                    setStartTime(slot.start);
                    setEndTime(slot.end);
                  }}
                >
                  <View
                    style={[
                      styles.themeColorDot,
                      { backgroundColor: isSelected ? theme.primary : '#27272a' },
                    ]}
                  >
                    {isSelected && <Ionicons name="checkmark" size={13} color="#ffffff" />}
                  </View>
                  <Text
                    style={[
                      styles.themeCardName,
                      isSelected && { color: '#ffffff', fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                  >
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {/* Scheda Orario Personalizzato */}
            <TouchableOpacity
              style={[
                styles.themeCardItem,
                isCustomTimeActive && {
                  borderColor: theme.primary,
                  backgroundColor: `${theme.primary}18`,
                },
              ]}
              activeOpacity={0.7}
              onPress={() => setIsCustomTimeActive(true)}
            >
              <View
                style={[
                  styles.themeColorDot,
                  { backgroundColor: isCustomTimeActive ? theme.primary : '#27272a' },
                ]}
              >
                {isCustomTimeActive && <Ionicons name="checkmark" size={13} color="#ffffff" />}
              </View>
              <Text
                style={[
                  styles.themeCardName,
                  isCustomTimeActive && { color: '#ffffff', fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                Personalizzato
              </Text>
            </TouchableOpacity>
          </View>

          {/* Box Selettore Manuale Inizio/Fine (aperto se Personalizzato o visibile per precisione) */}
          {isCustomTimeActive && (
            <View style={[styles.sectionCard, { marginTop: 10 }]}>
              <View style={styles.timeInputsRow}>
                <View style={styles.timeInputCol}>
                  <Text style={styles.timeInputSublabel}>Inizio</Text>
                  <TextInput
                    style={styles.timeBox}
                    value={startTime}
                    onChangeText={setStartTime}
                    placeholder="08:00"
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
                    placeholder="10:00"
                    placeholderTextColor="#64748b"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>
            </View>
          )}

          {/* ── 5. Opzioni di Ripetizione ── */}
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
                    styles.checkCircle,
                    repetitionType === 'semester' && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  {repetitionType === 'semester' && (
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>Tutto il semestre</Text>
                  <Text style={styles.optionSubtitle}>
                    Fino a {formatDateItalian(detectedSemesterEnd)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Opzione 2: Fino a data specifica */}
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setRepetitionType('custom_date')}
              activeOpacity={0.7}
            >
              <View style={styles.optionLeft}>
                <View
                  style={[
                    styles.checkCircle,
                    repetitionType === 'custom_date' && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  {repetitionType === 'custom_date' && (
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>Fino a data specifica</Text>
                  <Text style={styles.optionSubtitle}>
                    Seleziona sul calendario o tramite le opzioni veloci
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {repetitionType === 'custom_date' && (
              <View style={styles.customDateContainer}>
                {/* Banner data attualmente selezionata */}
                <View style={styles.selectedDateBanner}>
                  <Ionicons name="calendar" size={15} color={theme.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.selectedDateBannerText, { color: theme.accent }]}>
                    Fino al {formatDateItalian(repeatUntilDate)}
                  </Text>
                </View>

                {/* Pill arrotondate stile 'Anticipo in aula' per +1 mese, +2 mesi, Fine Semestre */}
                <View style={styles.dateQuickChips}>
                  <TouchableOpacity
                    style={styles.pillDateQuickChip}
                    onPress={() => setCustomDateRelative(1)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add-circle-outline" size={13} color={theme.accent} style={{ marginRight: 4 }} />
                    <Text style={[styles.pillDateQuickChipText, { color: theme.accent }]}>+1 Mese</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pillDateQuickChip}
                    onPress={() => setCustomDateRelative(2)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add-circle-outline" size={13} color={theme.accent} style={{ marginRight: 4 }} />
                    <Text style={[styles.pillDateQuickChipText, { color: theme.accent }]}>+2 Mesi</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pillDateQuickChip}
                    onPress={() => setRepeatUntilDate(detectedSemesterEnd)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="school-outline" size={13} color={theme.accent} style={{ marginRight: 4 }} />
                    <Text style={[styles.pillDateQuickChipText, { color: theme.accent }]}>Fine Semestre</Text>
                  </TouchableOpacity>
                </View>

                {/* Date Picker Calendario Inline Interattivo */}
                <InlineCalendarPicker
                  selectedDate={repeatUntilDate}
                  onSelectDate={setRepeatUntilDate}
                  theme={theme}
                />
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
                    styles.checkCircle,
                    repetitionType === 'single' && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  {repetitionType === 'single' && (
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
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

          {/* ── 6. Tasto Elimina per lezioni esistenti ── */}
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

  /* Giorni della Settimana (Glowing + Stesse Colorazioni & Animazioni del Pannello Orari) */
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    gap: 8,
  },
  dayItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 44,
  },
  dayCircle: {
    width: 48,
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
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 8,
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
    bottom: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  /* Orari di Default Pill stile Anticipo in aula */
  timeQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  timeQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    flexGrow: 1,
  },
  chipActive: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8e8e93',
  },
  chipTextActive: {
    fontWeight: '700',
  },

  /* Selezione Orari stile Lista Tema (themeGrid, themeCardItem, themeColorDot) */
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  themeCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: '47%',
    flexGrow: 1,
    gap: 8,
  },
  themeColorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeCardName: {
    fontSize: 13,
    color: '#cbd5e1',
    fontWeight: '500',
    flex: 1,
  },

  /* Box orario manuale */
  timeInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 12,
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

  /* Opzioni Ripetizione */
  optionRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
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

  /* Sezione Data Personalizzata & Date Picker */
  customDateContainer: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  selectedDateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: 8,
    marginBottom: 12,
  },
  selectedDateBannerText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dateQuickChips: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  pillDateQuickChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
  },
  pillDateQuickChipText: {
    fontSize: 12,
    fontWeight: '700',
  },

  /* Inline Calendar Picker */
  calendarContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  calendarNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarMonthText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  calendarWeekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  calendarWeekdayText: {
    width: 34,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  calendarDaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  calendarDayCellEmpty: {
    width: '14.28%',
    height: 36,
  },
  calendarDayCell: {
    width: '14.28%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    marginVertical: 2,
  },
  calendarDayCellActive: {
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 3,
  },
  calendarDayText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  calendarDayTextActive: {
    color: '#ffffff',
    fontWeight: '800',
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
