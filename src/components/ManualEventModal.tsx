import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
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
  LayoutAnimation,
  UIManager,
  Animated,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DateTimePicker,
  type DateTimePickerChangeEvent,
} from '@expo/ui/community/datetime-picker';
import { NativeSheetModal } from './NativeSheetModal';
import { NativeActionButton } from './NativeActionButton';
import { useTheme } from '@/context/ThemeContext';
import { CARD_RADIUS, UNIFORM_MODAL_BG } from '@/constants/theme';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { CardContextMenu } from './CardContextMenu';
import {
  ManualClassEvent,
  ManualEventRepetition,
  getDefaultSemesterEndDate,
  extractSemesterEndDate,
  formatDisplayDate,
  isManualEventActiveOnDate,
} from '@/utils/manualEvents';
import { getDateForDayIndex, calculateLessonDuration } from '@/utils/attendance';

interface ManualEventModalProps {
  visible: boolean;
  editingEvent?: ManualClassEvent | null;
  initialDayIndex?: number;
  semesterText?: string;
  tabUrl?: string;
  channelName?: string;
  existingEvents?: ManualClassEvent[];
  onClose: () => void;
  onSave: (eventData: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'>, id?: string) => void;
  onDelete?: (id: string) => void;
}

const DAYS_SHORT = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];
const DAYS_FULL = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const WEEKDAYS = [
  { dayIdx: 0, label: 'LUN', isWeekend: false },
  { dayIdx: 1, label: 'MAR', isWeekend: false },
  { dayIdx: 2, label: 'MER', isWeekend: false },
  { dayIdx: 3, label: 'GIO', isWeekend: false },
  { dayIdx: 4, label: 'VEN', isWeekend: false },
  { dayIdx: 5, label: 'SAB', isWeekend: true },
  { dayIdx: 6, label: 'DOM', isWeekend: true },
];
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === 'ios' && !isExpoGo;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const parseDateFromISO = (isoStr: string): Date => {
  const [y, m, d] = (isoStr || '').split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0);
};

const formatDateToISO = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatDisplayDateShort = (dateStr: string): string => {
  try {
    const [, m, d] = (dateStr || '').split('-').map(Number);
    if (!m || !d) return dateStr;
    const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    return `${d} ${months[m - 1]}`;
  } catch {
    return dateStr;
  }
};


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
  tabUrl,
  channelName,
  existingEvents = [],
  onClose,
  onSave,
  onDelete,
}: Omit<ManualEventModalProps, 'visible'>) {
  const { theme } = useTheme();

  // Calcola la data di fine semestre estratta dinamicamente dal foglio orario Sapienza (Calendario Didattico)
  const dynamicSemesterEnd = useMemo(() => {
    return extractSemesterEndDate(semesterText) || getDefaultSemesterEndDate();
  }, [semesterText]);

  const safeInitialDay = Math.min(Math.max(0, initialDayIndex), 6);

  const [activeEditing, setActiveEditing] = useState<ManualClassEvent | null>(editingEvent || null);
  const scrollRef = useRef<ScrollView>(null);

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

  const [singleDate, setSingleDate] = useState<string>(
    editingEvent?.startDate || getDateForDayIndex(safeInitialDay).dateStr
  );
  const singleDateObj = useMemo(() => parseDateFromISO(singleDate), [singleDate]);

  // Animazione fluida a scorrimento dello slider dei giorni della settimana (Identico a Orari)
  const segmentLayouts = useRef<{ [key: number]: { x: number; width: number } }>({});
  const [sliderPillAnim] = useState(() => new Animated.Value(0));
  const [sliderWidthAnim] = useState(() => new Animated.Value(44));
  const [weekendPillAnim] = useState(() => new Animated.Value(dayIndex >= 5 ? 1 : 0));
  const [sliderReady, setSliderReady] = useState(false);
  const initialSliderPositioned = useRef(false);

  const handleSegmentLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      segmentLayouts.current[idx] = { x, width };

      if (idx === dayIndex) {
        sliderPillAnim.setValue(x);
        sliderWidthAnim.setValue(width);
        if (!initialSliderPositioned.current) {
          weekendPillAnim.setValue(idx >= 5 ? 1 : 0);
          initialSliderPositioned.current = true;
          setSliderReady(true);
        }
      }
    },
    [dayIndex, sliderPillAnim, sliderWidthAnim, weekendPillAnim],
  );

  const handleDaySelect = useCallback(
    (idx: number) => {
      setDayIndex(idx);
      if (repetitionType === 'single') {
        const { dateStr } = getDateForDayIndex(idx);
        setSingleDate(dateStr);
      }
    },
    [repetitionType],
  );

  useEffect(() => {
    const target = segmentLayouts.current[dayIndex];
    if (target && sliderReady) {
      Animated.parallel([
        Animated.spring(sliderPillAnim, {
          toValue: target.x,
          useNativeDriver: false,
          tension: 68,
          friction: 10,
        }),
        Animated.spring(sliderWidthAnim, {
          toValue: target.width,
          useNativeDriver: false,
          tension: 68,
          friction: 10,
        }),
        Animated.timing(weekendPillAnim, {
          toValue: dayIndex >= 5 ? 1 : 0,
          duration: 220,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [dayIndex, sliderReady, sliderPillAnim, sliderWidthAnim, weekendPillAnim]);

  const conflictingEvents = useMemo(() => {
    if (repetitionType !== 'single' || !existingEvents) return [];
    return existingEvents.filter(
      (e) =>
        e.id !== activeEditing?.id &&
        (e.repetitionType === 'single' ? e.startDate === singleDate : isManualEventActiveOnDate(e, singleDate))
    );
  }, [repetitionType, existingEvents, activeEditing?.id, singleDate]);

  const allProgrammedEvents = useMemo(() => {
    if (!existingEvents || existingEvents.length === 0) return [];
    return [...existingEvents].sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) {
        return a.dayIndex - b.dayIndex;
      }
      return a.startTime.localeCompare(b.startTime);
    });
  }, [existingEvents]);

  const getRepetitionText = (ev: ManualClassEvent): string => {
    if (ev.repetitionType === 'semester') {
      return 'Tutto il semestre';
    }
    if (ev.repetitionType === 'custom_date') {
      return `Fino al ${formatDisplayDateShort(ev.repeatUntilDate || '')}`;
    }
    return `Solo il ${formatDisplayDateShort(ev.startDate || '')}`;
  };


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

  const { dateStr: currentDayDateStr } = useMemo(() => {
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

    const duration = calculateLessonDuration(startTime.trim(), endTime.trim());
    let finalDayIndex = dayIndex;
    if (repetitionType === 'single') {
      const [y, m, d] = singleDate.split('-').map(Number);
      if (y && m && d) {
        const parsedDate = new Date(y, m - 1, d, 12, 0, 0);
        const rawDay = parsedDate.getDay();
        finalDayIndex = rawDay === 0 ? 6 : rawDay - 1;
      }
    }
    const payload: Omit<ManualClassEvent, 'id' | 'createdAt' | 'courseUrl'> = {
      subject: trimmedSubject,
      teacher: teacher.trim() || undefined,
      room: room.trim() || undefined,
      dayIndex: finalDayIndex,
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      duration: duration > 0 ? duration : undefined,
      tabUrl: activeEditing?.tabUrl || tabUrl,
      channelName: activeEditing?.channelName || channelName,
      repetitionType,
      startDate: repetitionType === 'single' ? singleDate : (activeEditing?.startDate || currentDayDateStr),
      repeatUntilDate: repetitionType === 'semester'
        ? dynamicSemesterEnd
        : repetitionType === 'custom_date'
        ? (repeatUntilDate.trim() || dynamicSemesterEnd)
        : undefined,
    };

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onSave(payload, activeEditing?.id);
    onClose();
  };

  const handleDelete = () => {
    if (!activeEditing || !onDelete) return;
    Alert.alert(
      'Elimina lezione',
      'Sei sicuro di voler eliminare questa lezione manuale?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onDelete(activeEditing.id);
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

  const plus1Date = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const plus2Date = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const DATE_PRESETS = [
    { label: '+1 mese', date: plus1Date, onPress: () => setCustomDateRelative(1) },
    { label: '+2 mesi', date: plus2Date, onPress: () => setCustomDateRelative(2) },
    { label: 'Fine semestre', date: dynamicSemesterEnd, onPress: () => setRepeatUntilDate(dynamicSemesterEnd) },
  ];

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
      title={activeEditing ? 'Modifica lezione' : 'Nuova lezione'}
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
      <View collapsable={false} style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}>
        <KeyboardAvoidingView
          collapsable={false}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}
        >
          <ScrollView
            ref={scrollRef}
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

          {/* Giorno della settimana (Liquid Glass Week Bar con pillola animata identica a Orari, senza pallini) */}
          <Text style={styles.sectionTitle}>GIORNO DELLA SETTIMANA</Text>
          <View style={styles.daySegmentedBar}>
            <View style={styles.daySegmentInnerContainer}>
              {sliderReady && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.slidingActivePill,
                    {
                      left: sliderPillAnim,
                      width: sliderWidthAnim,
                      backgroundColor: weekendPillAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [theme.bg, 'rgba(245, 158, 11, 0.22)'],
                      }),
                      borderColor: weekendPillAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [theme.primary, '#f59e0b'],
                      }),
                      shadowColor: weekendPillAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [theme.primary, '#f59e0b'],
                      }),
                    },
                  ]}
                />
              )}

              {WEEKDAYS.map((w, idx) => {
                const isSelected = dayIndex === w.dayIdx;
                const isItemWeekend = Boolean(w.isWeekend);

                return (
                  <Fragment key={w.dayIdx}>
                    {idx === 5 && <View style={styles.dayWeekendDivider} />}
                    <TouchableOpacity
                      onLayout={(e) => handleSegmentLayout(idx, e)}
                      onPress={() => handleDaySelect(w.dayIdx)}
                      activeOpacity={0.7}
                      style={styles.daySegmentItem}
                    >
                      <Text
                        style={[
                          styles.daySegmentLabel,
                          isItemWeekend && styles.daySegmentLabelWeekend,
                          isSelected && styles.daySegmentLabelActive,
                        ]}
                      >
                        {w.label}
                      </Text>
                    </TouchableOpacity>
                  </Fragment>
                );
              })}
            </View>
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

                {/* Pulsanti rapidi arrotondati identici graficamente ai preset orari */}
                <View style={styles.dateQuickChips}>
                  {DATE_PRESETS.map((preset) => {
                    const isSelected = repeatUntilDate === preset.date;
                    return (
                      <TouchableOpacity
                        key={preset.label}
                        style={[
                          styles.dateQuickPill,
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
                        onPress={preset.onPress}
                      >
                        <Ionicons
                          name={isSelected ? 'checkmark-circle' : 'calendar-outline'}
                          size={12}
                          color={isSelected ? theme.accent : '#8e8e93'}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.dateQuickPillText,
                            isSelected
                              ? { color: theme.accent, fontWeight: '700' }
                              : { color: '#94a3b8' },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit={true}
                          minimumFontScale={0.8}
                        >
                          {preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
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
                    {repetitionType === 'single'
                      ? `Valida per ${DAYS_FULL[dayIndex]} ${formatDisplayDate(singleDate)}`
                      : 'Lezione una tantum in una data specifica'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {repetitionType === 'single' && (
              <View style={styles.customDateContainer}>
                <View style={styles.datePickerRow}>
                  <Text style={styles.datePickerLabel}>Data della lezione:</Text>
                  <View style={styles.datePickerWrapper}>
                    <DateTimePicker
                      value={singleDateObj}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'compact' : 'default'}
                      locale="it_IT"
                      themeVariant="dark"
                      accentColor={theme.primary}
                      style={styles.datePickerControl}
                      onValueChange={(_event, selectedDate) => {
                        if (selectedDate) {
                          const iso = formatDateToISO(selectedDate);
                          setSingleDate(iso);
                          const rawDay = selectedDate.getDay();
                          const newDayIndex = rawDay === 0 ? 6 : rawDay - 1;
                          setDayIndex(newDayIndex);
                        }
                      }}
                    />
                  </View>
                </View>

                {conflictingEvents.length > 0 && (
                  <View style={styles.conflictWarningPill}>
                    <Ionicons name="alert-circle" size={16} color="#f59e0b" style={{ marginRight: 8, marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.conflictWarningTitle}>
                        {conflictingEvents.length === 1
                          ? 'Attenzione: hai già una lezione per questa data'
                          : `Attenzione: hai già ${conflictingEvents.length} lezioni per questa data`}
                      </Text>
                      {conflictingEvents.map((c) => (
                        <Text key={c.id} style={styles.conflictWarningDesc} numberOfLines={1}>
                          • {c.subject} ({c.startTime} - {c.endTime}){c.room ? ` · ${c.room}` : ''}
                        </Text>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          
          {/* Sezione: Elenco tutte le lezioni programmate */}
          {allProgrammedEvents.length > 0 && (
            <View style={styles.futureSectionContainer}>
              <View style={styles.futureSectionHeader}>
                <Ionicons name="calendar-outline" size={14} color={theme.accent} style={{ marginRight: 6 }} />
                <Text style={styles.futureSectionTitle}>
                  LEZIONI PROGRAMMATE ({allProgrammedEvents.length})
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.futureEventsScroll}>
                {allProgrammedEvents.map((ev) => {
                  const isCurrentEditing = activeEditing?.id === ev.id;
                  return (
                    <CardContextMenu
                      key={ev.id}
                      title={`${ev.subject} • ${DAYS_SHORT[ev.dayIndex]}`}
                      isManual={true}
                      isNativeAvailable={isNativeComponentAvailable}
                      onEditManual={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setActiveEditing(ev);
                        setSubject(ev.subject);
                        setTeacher(ev.teacher || '');
                        setRoom(ev.room || '');
                        setDayIndex(ev.dayIndex);
                        setStartTime(ev.startTime);
                        setEndTime(ev.endTime);
                        setRepetitionType(ev.repetitionType || 'semester');
                        setSingleDate(ev.startDate || getDateForDayIndex(ev.dayIndex).dateStr);
                        setRepeatUntilDate(ev.repeatUntilDate || dynamicSemesterEnd);
                        scrollRef.current?.scrollTo({ y: 0, animated: true });
                      }}
                      onDeleteManual={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        if (activeEditing?.id === ev.id) {
                          setActiveEditing(null);
                          setSubject('');
                          setTeacher('');
                          setRoom('');
                        }
                        onDelete?.(ev.id);
                      }}
                    >
                      <View
                        style={[
                          styles.futureEventChip,
                          isCurrentEditing && { borderColor: theme.accent, backgroundColor: `${theme.primary}25` },
                        ]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <Text style={[styles.futureEventDate, { color: theme.accent }]}>
                            {DAYS_SHORT[ev.dayIndex]} · {getRepetitionText(ev)}
                          </Text>
                        </View>
                        <Text style={styles.futureEventSubject} numberOfLines={1}>
                          {ev.subject}
                        </Text>
                        <Text style={styles.futureEventTime}>
                          {ev.startTime} - {ev.endTime}{ev.room ? ` · ${ev.room}` : ''}
                        </Text>
                      </View>
                    </CardContextMenu>
                  );
                })}
              </ScrollView>
            </View>
          )}

</View>

          {/* Pulsante Elimina in basso solo in modalità modifica, nel colore del tema con Callstack Liquid Glass */}
          {activeEditing && onDelete && (
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
      </View>
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
    borderRadius: CARD_RADIUS.card,
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

  /* Selezione giorni - Liquid Glass Week Bar (Uniforme a Orari) */
  daySegmentedBar: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: CARD_RADIUS.card,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  daySegmentInnerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 38,
    position: 'relative',
  },
  slidingActivePill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    height: 38,
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 1,
  },
  daySegmentItem: {
    flex: 1,
    height: 38,
    borderRadius: CARD_RADIUS.cardInner,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    zIndex: 2,
    position: 'relative',
  },
  dayWeekendDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignSelf: 'center',
    marginHorizontal: 1,
  },
  daySegmentLabel: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    color: '#a1a1aa',
    textAlign: 'center',
    includeFontPadding: false,
  },
  daySegmentLabelWeekend: {
    color: '#d4d4d8',
  },
  daySegmentLabelActive: {
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
    borderRadius: CARD_RADIUS.card,
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
    borderRadius: CARD_RADIUS.cardInner,
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
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
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
    gap: 6,
    marginTop: 10,
  },
  dateQuickPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  dateQuickPillText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#94a3b8',
  },

  conflictWarningPill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: CARD_RADIUS.cardInner,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  conflictWarningTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
    marginBottom: 2,
  },
  conflictWarningDesc: {
    fontSize: 11.5,
    color: '#fbbf24',
    marginTop: 1,
  },
  futureSectionContainer: {
    marginTop: 18,
    marginBottom: 4,
  },
  futureSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  futureSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8e8e93',
    letterSpacing: 0.6,
  },
  futureEventsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  futureEventChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 150,
    maxWidth: 220,
  },
  futureEventDate: {
    fontSize: 11,
    fontWeight: '700',
  },
  futureEventSubject: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 2,
  },
  futureEventTime: {
    fontSize: 11,
    color: '#8e8e93',
    marginTop: 2,
  },
  bottomActionContainer: {
    marginTop: 24,
    marginBottom: 8,
    width: '100%',
  },
});
