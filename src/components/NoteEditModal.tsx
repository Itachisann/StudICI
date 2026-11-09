import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DateTimePicker,
  type DateTimePickerChangeEvent,
} from '@expo/ui/community/datetime-picker';
import { UNIFORM_MODAL_BG } from '../constants/theme';
import { NativeSheetModal } from './NativeSheetModal';
import { NativeActionButton } from './NativeActionButton';
import { useTheme } from '../context/ThemeContext';
import {
  AppNote,
  deleteNote,
  getAppleReminderStatus,
  NoteTargetType,
  saveNote,
} from '../utils/notesStorage';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 8 preset uniformati: 4 per riga
const LESSON_REMINDER_PRESETS = [
  { id: '15m', label: '-15 min' },
  { id: '30m', label: '-30 min' },
  { id: '1h', label: '-1 ora' },
  { id: '2h', label: '-2 ore' },
  { id: '4h', label: '-4 ore' },
  { id: '12h', label: '-12 ore' },
  { id: '1d', label: '-1 giorno' },
  { id: 'custom', label: 'Orario' },
];

const DAY_REMINDER_PRESETS = [
  { id: '15m', label: '-15 min' },
  { id: '30m', label: '-30 min' },
  { id: '1h', label: '-1 ora' },
  { id: '2h', label: '-2 ore' },
  { id: '4h', label: '-4 ore' },
  { id: '12h', label: '-12 ore' },
  { id: '1d', label: '-1 giorno' },
  { id: 'custom', label: 'Orario' },
];

export interface NoteEditModalProps {
  visible: boolean;
  onClose: () => void;
  noteToEdit?: AppNote | null;
  initialLesson?: {
    subject: string;
    room?: string;
    time?: string;
    teacher?: string;
    dayIndex?: number;
    dateStr?: string;
    dayName?: string;
  } | null;
  initialDay?: {
    dayIndex: number;
    dateStr: string;
    dayName?: string;
  } | null;
  onSaved?: (note: AppNote) => void;
  onDeleted?: (noteId: string) => void;
  theme?: {
    primary: string;
    accent: string;
    cardTint: string;
    border: string;
    subtle: string;
    bg?: string;
  };
}

const DAYS_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const formatReminderTargetPretty = (d: Date): string => {
  try {
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    if (isToday) return 'Oggi';

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow =
      d.getDate() === tomorrow.getDate() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getFullYear() === tomorrow.getFullYear();
    if (isTomorrow) return 'Domani';

    const dayName = DAYS_NAMES[(d.getDay() + 6) % 7];
    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    return `${dayName} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return '';
  }
};

const NoteEditForm: React.FC<NoteEditModalProps> = ({
  visible,
  onClose,
  noteToEdit,
  initialLesson,
  initialDay,
  onSaved,
  onDeleted,
  theme,
}) => {
  const { theme: ctxTheme } = useTheme();
  const activeTheme = theme || ctxTheme;

  const [nowTs] = useState(() => Date.now());
  const [targetType, setTargetType] = useState<NoteTargetType>(() => {
    if (noteToEdit) return noteToEdit.targetType;
    if (initialDay) return 'day';
    return 'lesson';
  });
  const [title, setTitle] = useState(() => noteToEdit?.title || '');
  const [content, setContent] = useState(() => noteToEdit?.content || '');
  const lessonSubject = noteToEdit?.lessonSubject || initialLesson?.subject || '';
  const lessonTime = noteToEdit?.lessonTime || initialLesson?.time || '';
  const lessonRoom = noteToEdit?.lessonRoom || initialLesson?.room || '';
  const dateStr =
    noteToEdit?.dateStr ||
    initialLesson?.dateStr ||
    initialDay?.dateStr ||
    new Date().toISOString().split('T')[0];

  const dayIndex = useMemo(() => {
    if (typeof noteToEdit?.dayIndex === 'number' && noteToEdit.dayIndex >= 0) return noteToEdit.dayIndex;
    if (typeof initialLesson?.dayIndex === 'number' && initialLesson.dayIndex >= 0) return initialLesson.dayIndex;
    if (typeof initialDay?.dayIndex === 'number' && initialDay.dayIndex >= 0) return initialDay.dayIndex;
    if (dateStr) {
      try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        return (dt.getDay() + 6) % 7;
      } catch {}
    }
    return (new Date().getDay() + 6) % 7;
  }, [noteToEdit?.dayIndex, initialLesson?.dayIndex, initialDay?.dayIndex, dateStr]);

  const formattedDayDate = useMemo(() => {
    if (!dateStr) return '';
    try {
      const [, m, d] = dateStr.split('-').map(Number);
      const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      return `${DAYS_NAMES[dayIndex]} ${d} ${months[m - 1]}`;
    } catch {
      return dateStr;
    }
  }, [dateStr, dayIndex]);

  const dayRelativeBadge = useMemo(() => {
    if (!dateStr) return null;
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (!y || !m || !d) return null;
      const target = new Date(y, m - 1, d);
      const now = new Date();
      if (
        target.getDate() === now.getDate() &&
        target.getMonth() === now.getMonth() &&
        target.getFullYear() === now.getFullYear()
      ) {
        return 'Oggi';
      }
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (
        target.getDate() === tomorrow.getDate() &&
        target.getMonth() === tomorrow.getMonth() &&
        target.getFullYear() === tomorrow.getFullYear()
      ) {
        return 'Domani';
      }
      return null;
    } catch {
      return null;
    }
  }, [dateStr]);

  // Data di riferimento per il promemoria: permette di impostare promemoria anche per settimane future
  const [reminderTargetDate, setReminderTargetDate] = useState<Date>(() => {
    if (noteToEdit?.reminderDate) {
      try {
        const d = new Date(noteToEdit.reminderDate);
        if (!isNaN(d.getTime())) return d;
      } catch {}
    }
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (dateStr && dateStr >= todayStr) {
      try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        if (!isNaN(dt.getTime())) return dt;
      } catch {}
    }
    // Prossima occorrenza del giorno della settimana
    const currentWeekday = (now.getDay() + 6) % 7;
    let diffDays = (dayIndex - currentWeekday + 7) % 7;
    if (diffDays === 0) {
      const startH = parseInt((lessonTime.split('-')[0] || '8').split(':')[0] || '8', 10);
      if (now.getHours() >= startH) {
        diffDays = 7;
      }
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffDays);
  });

  // Promemoria
  const [reminderEnabled, setReminderEnabled] = useState(() => Boolean(noteToEdit?.reminderEnabled));
  const [reminderPreset, setReminderPreset] = useState<string>(() => {
    if (noteToEdit?.reminderDate) return 'custom';
    return '15m';
  });
  const [customTimeDate, setCustomTimeDate] = useState<Date>(() => {
    if (noteToEdit?.reminderDate) {
      try {
        const d = new Date(noteToEdit.reminderDate);
        if (!isNaN(d.getTime())) return d;
      } catch {}
    }
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });

  const toggleReminder = (val: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReminderEnabled(val);
  };

  const selectPreset = (presetId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReminderPreset(presetId);
  };

  const selectTargetType = (type: NoteTargetType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTargetType(type);
  };

  const handleReminderDateChange = (event: DateTimePickerChangeEvent, selectedDate?: Date) => {
    if (selectedDate) {
      setReminderTargetDate(selectedDate);
    } else {
      const ts = (event as any)?.nativeEvent?.timestamp;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) setReminderTargetDate(d);
      }
    }
  };

  const handleCustomTimeChange = (event: DateTimePickerChangeEvent, selectedDate?: Date) => {
    if (selectedDate) {
      setCustomTimeDate(selectedDate);
    } else {
      const ts = (event as any)?.nativeEvent?.timestamp;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) setCustomTimeDate(d);
      }
    }
  };

  // Se il promemoria nativo Apple è stato eliminato dall'app Promemoria, disattiva il toggle
  useEffect(() => {
    if (visible && noteToEdit?.appleReminderId) {
      getAppleReminderStatus(noteToEdit.appleReminderId).then((status) => {
        if (!status.exists) {
          setReminderEnabled(false);
        }
      });
    }
  }, [visible, noteToEdit?.appleReminderId]);

  // Calcola la data/ora esatta del promemoria in base alla data target e al preset scelto
  const computeReminderDateIso = useCallback((): string | undefined => {
    if (!reminderEnabled) return undefined;

    const year = reminderTargetDate.getFullYear();
    const month = reminderTargetDate.getMonth();
    const day = reminderTargetDate.getDate();

    if (targetType === 'lesson') {
      const startTimeStr = (lessonTime.split('-')[0] || '').trim();
      let lessonH = 8;
      let lessonM = 30;
      if (startTimeStr.includes(':')) {
        const [h, m] = startTimeStr.split(':').map(Number);
        if (!isNaN(h)) lessonH = h;
        if (!isNaN(m)) lessonM = m;
      }

      const targetD = new Date(year, month, day, lessonH, lessonM, 0, 0);

      switch (reminderPreset) {
        case '15m':
          return new Date(targetD.getTime() - 15 * 60 * 1000).toISOString();
        case '30m':
          return new Date(targetD.getTime() - 30 * 60 * 1000).toISOString();
        case '1h':
          return new Date(targetD.getTime() - 60 * 60 * 1000).toISOString();
        case '2h':
          return new Date(targetD.getTime() - 2 * 60 * 60 * 1000).toISOString();
        case '4h':
          return new Date(targetD.getTime() - 4 * 60 * 60 * 1000).toISOString();
        case '12h':
          return new Date(targetD.getTime() - 12 * 60 * 60 * 1000).toISOString();
        case '1d':
          return new Date(targetD.getTime() - 24 * 60 * 60 * 1000).toISOString();
        case 'custom':
        default: {
          const cH = customTimeDate.getHours();
          const cM = customTimeDate.getMinutes();
          const cD = new Date(year, month, day, cH, cM, 0, 0);
          return cD.toISOString();
        }
      }
    } else {
      // Per il giorno (riferimento convenzionale alle 09:00 del giorno)
      const baseDayD = new Date(year, month, day, 9, 0, 0, 0);
      switch (reminderPreset) {
        case '15m':
          return new Date(baseDayD.getTime() - 15 * 60 * 1000).toISOString();
        case '30m':
          return new Date(baseDayD.getTime() - 30 * 60 * 1000).toISOString();
        case '1h':
          return new Date(baseDayD.getTime() - 60 * 60 * 1000).toISOString();
        case '2h':
          return new Date(baseDayD.getTime() - 2 * 60 * 60 * 1000).toISOString();
        case '4h':
          return new Date(baseDayD.getTime() - 4 * 60 * 60 * 1000).toISOString();
        case '12h':
          return new Date(baseDayD.getTime() - 12 * 60 * 60 * 1000).toISOString();
        case '1d':
          return new Date(baseDayD.getTime() - 24 * 60 * 60 * 1000).toISOString();
        case 'custom':
        default: {
          const cH = customTimeDate.getHours();
          const cM = customTimeDate.getMinutes();
          const cD = new Date(year, month, day, cH, cM, 0, 0);
          return cD.toISOString();
        }
      }
    }
  }, [reminderEnabled, reminderTargetDate, targetType, lessonTime, reminderPreset, customTimeDate]);

  const handleSave = async () => {
    if (!content.trim()) {
      Alert.alert('Nota vuota', 'Inserisci il testo della nota prima di salvare.');
      return;
    }

    try {
      const reminderDate = computeReminderDateIso();

      const saved = await saveNote({
        id: noteToEdit ? noteToEdit.id : undefined,
        targetType,
        title: title.trim() || undefined,
        content: content.trim(),
        lessonSubject: targetType === 'lesson' ? (lessonSubject.trim() || 'Lezione') : undefined,
        lessonTime: targetType === 'lesson' ? lessonTime.trim() : undefined,
        lessonRoom: targetType === 'lesson' ? lessonRoom.trim() : undefined,
        dayIndex,
        dayName: DAYS_NAMES[dayIndex] || undefined,
        dateStr: dateStr || new Date().toISOString().split('T')[0],
        reminderEnabled,
        reminderDate,
        isCompleted: noteToEdit?.isCompleted ?? false,
      });

      if (onSaved) onSaved(saved);
      onClose();
    } catch {
      Alert.alert('Errore', 'Impossibile salvare la nota. Riprova.');
    }
  };

  const handleDelete = () => {
    if (!noteToEdit) return;
    Alert.alert(
      'Elimina nota',
      'Vuoi davvero eliminare questa nota e l\'eventuale promemoria associato?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            await deleteNote(noteToEdit.id);
            if (onDeleted) onDeleted(noteToEdit.id);
            onClose();
          },
        },
      ]
    );
  };

  if (!visible) return null;

  const reminderDisplayIso = computeReminderDateIso();
  let reminderPreviewText = '';
  if (reminderEnabled && reminderDisplayIso) {
    try {
      const d = new Date(reminderDisplayIso);
      const isPast = d.getTime() <= nowTs;
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const datePretty = `${d.getDate()} ${['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][d.getMonth()]}`;
      reminderPreviewText = `${datePretty} alle ore ${timeStr}${isPast ? ' (Orario già trascorso)' : ''}`;
    } catch {}
  }

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title={noteToEdit ? 'Modifica nota' : 'Nuova nota'}
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'checkmark',
          prominent: true,
          tintColor: activeTheme.primary,
          accessibilityLabel: 'Salva',
          onPress: handleSave,
        },
      ]}
    >
      <View style={styles.modalRoot}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Selettore Segmentato Tipologia (se creata da zero senza contesto fisso) */}
            {!noteToEdit && !initialLesson && !initialDay && (
              <View style={styles.typeSelectorRow}>
                <TouchableOpacity
                  style={[
                    styles.typeSelectorBtn,
                    targetType === 'lesson' && [
                      styles.typeSelectorBtnActive,
                      {
                        backgroundColor: activeTheme.primary,
                        shadowColor: activeTheme.primary,
                      },
                    ],
                  ]}
                  onPress={() => selectTargetType('lesson')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="book-outline"
                    size={13.5}
                    color={targetType === 'lesson' ? '#ffffff' : '#94a3b8'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.typeSelectorText,
                      targetType === 'lesson' && styles.typeSelectorTextActive,
                    ]}
                  >
                    Lezione
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeSelectorBtn,
                    targetType === 'day' && [
                      styles.typeSelectorBtnActive,
                      {
                        backgroundColor: activeTheme.primary,
                        shadowColor: activeTheme.primary,
                      },
                    ],
                  ]}
                  onPress={() => selectTargetType('day')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={13.5}
                    color={targetType === 'day' ? '#ffffff' : '#94a3b8'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.typeSelectorText,
                      targetType === 'day' && styles.typeSelectorTextActive,
                    ]}
                  >
                    Giorno intero
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Header / Badge Contesto Associazione */}
            <View>
              <Text style={styles.sectionHeader}>ASSOCIAZIONE</Text>
              <View style={styles.contextCard}>
                <View
                  style={[
                    styles.contextIconSquircle,
                    {
                      backgroundColor: activeTheme.subtle,
                      borderColor: activeTheme.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={targetType === 'lesson' ? 'book' : 'calendar'}
                    size={18}
                    color={activeTheme.accent}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextTitle} numberOfLines={1}>
                    {targetType === 'lesson'
                      ? lessonSubject || 'Lezione'
                      : formattedDayDate || DAYS_NAMES[dayIndex] || 'Giorno'}
                  </Text>

                  {targetType === 'lesson' ? (
                    <View style={styles.contextMetaRow}>
                      <View style={styles.contextMetaPill}>
                        <Ionicons
                          name="calendar-outline"
                          size={11}
                          color="#94a3b8"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.contextMetaPillText}>
                          {DAYS_NAMES[dayIndex] || 'Giorno'}
                        </Text>
                      </View>
                      {Boolean(lessonTime) && (
                        <View style={styles.contextMetaPill}>
                          <Ionicons
                            name="time-outline"
                            size={11}
                            color="#94a3b8"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.contextMetaPillText}>{lessonTime}</Text>
                        </View>
                      )}
                      {Boolean(lessonRoom) && (
                        <View style={styles.contextMetaPill}>
                          <Ionicons
                            name="location-outline"
                            size={11}
                            color="#94a3b8"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.contextMetaPillText}>
                            {lessonRoom.toLowerCase().startsWith('aula')
                              ? lessonRoom
                              : `Aula ${lessonRoom}`}
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.contextMetaRow}>
                      <View style={styles.contextMetaPill}>
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color="#94a3b8"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.contextMetaPillText}>Intera giornata</Text>
                      </View>
                      {dayRelativeBadge && (
                        <View style={styles.contextMetaPill}>
                          <Ionicons
                            name="sparkles-outline"
                            size={11}
                            color={activeTheme.accent}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[
                              styles.contextMetaPillText,
                              { color: activeTheme.accent, fontWeight: '600' },
                            ]}
                          >
                            {dayRelativeBadge}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Sezione Contenuto Nota (Stile Inset Apple Notes) */}
            <View>
              <Text style={styles.sectionHeader}>CONTENUTO NOTA</Text>
              <View style={styles.cardSection}>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Titolo (opzionale)"
                  placeholderTextColor="#71717a"
                  maxLength={60}
                  returnKeyType="next"
                />

                <View style={styles.hairlineDivider} />

                <TextInput
                  style={styles.contentInput}
                  value={content}
                  onChangeText={setContent}
                  placeholder="Scrivi qui i tuoi appunti, compiti o cose da ricordare..."
                  placeholderTextColor="#71717a"
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Sezione Promemoria e Avvisi */}
            <View>
              <Text style={styles.sectionHeader}>PROMEMORIA</Text>
              <View style={styles.cardSection}>
                <View style={styles.switchRow}>
                  <View
                    style={[
                      styles.switchIconSquircle,
                      {
                        backgroundColor: activeTheme.subtle,
                        borderColor: activeTheme.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="notifications"
                      size={17}
                      color={activeTheme.accent}
                    />
                  </View>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={styles.switchTitle}>Attiva promemoria</Text>
                    <Text style={styles.switchSubtitle}>
                      Sincronizzato con l&apos;app Promemoria
                    </Text>
                  </View>
                  <Switch
                    value={reminderEnabled}
                    onValueChange={toggleReminder}
                    trackColor={{ false: '#39393d', true: activeTheme.primary }}
                    thumbColor="#ffffff"
                    ios_backgroundColor="#39393d"
                  />
                </View>

                {reminderEnabled && (
                  <View style={styles.reminderExpandedContent}>
                    <View style={styles.hairlineDivider} />

                    {/* Selettore Giorno/Data Promemoria (con Apple native compact DatePicker) */}
                    <View style={styles.datePickerRow}>
                      <View
                        style={[
                          styles.rowIconSquircle,
                          {
                            backgroundColor: activeTheme.subtle,
                            borderColor: activeTheme.border,
                          },
                        ]}
                      >
                        <Ionicons
                          name="calendar-outline"
                          size={16}
                          color={activeTheme.accent}
                        />
                      </View>
                      <View style={styles.pickerTextColumn}>
                        <Text style={styles.pickerRowTitle} numberOfLines={1}>
                          Data promemoria
                        </Text>
                        <Text style={styles.pickerRowSubtitle} numberOfLines={1}>
                          {formatReminderTargetPretty(reminderTargetDate)}
                        </Text>
                      </View>
                      <View style={styles.datePickerWrapper}>
                        <DateTimePicker
                          value={reminderTargetDate}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'compact' : 'default'}
                          locale="it_IT"
                          themeVariant="dark"
                          accentColor={activeTheme.primary}
                          onValueChange={handleReminderDateChange}
                          style={styles.datePickerControl}
                        />
                      </View>
                    </View>

                    <Text style={styles.cardSubHeader}>QUANDO AVVISARE</Text>
                    <View style={styles.presetsGrid}>
                      {(targetType === 'lesson'
                        ? LESSON_REMINDER_PRESETS
                        : DAY_REMINDER_PRESETS
                      ).map((preset) => {
                        const isSelected = reminderPreset === preset.id;
                        return (
                          <TouchableOpacity
                            key={preset.id}
                            style={[
                              styles.presetPill,
                              isSelected && [
                                styles.presetPillActive,
                                {
                                  backgroundColor: `${activeTheme.primary}25`,
                                  borderColor: activeTheme.primary,
                                  shadowColor: activeTheme.primary,
                                },
                              ],
                            ]}
                            onPress={() => selectPreset(preset.id)}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.presetPillText,
                                isSelected && {
                                  color: activeTheme.accent,
                                  fontWeight: '700',
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {preset.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {reminderPreset === 'custom' && (
                      <View style={styles.timePickerRow}>
                        <View
                          style={[
                            styles.rowIconSquircle,
                            {
                              backgroundColor: activeTheme.subtle,
                              borderColor: activeTheme.border,
                            },
                          ]}
                        >
                          <Ionicons
                            name="time-outline"
                            size={16}
                            color={activeTheme.accent}
                          />
                        </View>
                        <View style={styles.pickerTextColumn}>
                          <Text style={styles.pickerRowTitle} numberOfLines={1}>
                            Orario personalizzato
                          </Text>
                          <Text style={styles.pickerRowSubtitle} numberOfLines={1}>
                            Ora esatta notifica
                          </Text>
                        </View>
                        <View style={styles.timePickerWrapper}>
                          <DateTimePicker
                            value={customTimeDate}
                            mode="time"
                            display={Platform.OS === 'ios' ? 'compact' : 'default'}
                            locale="it_IT"
                            themeVariant="dark"
                            accentColor={activeTheme.primary}
                            onValueChange={handleCustomTimeChange}
                            style={styles.timePickerControl}
                          />
                        </View>
                      </View>
                    )}

                    {reminderPreviewText ? (
                      <View
                        style={[
                          styles.previewNoticeCard,
                          {
                            backgroundColor: activeTheme.subtle,
                            borderColor: activeTheme.border,
                          },
                        ]}
                      >
                        <Ionicons
                          name="notifications-outline"
                          size={14}
                          color={activeTheme.accent}
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          style={[
                            styles.previewNoticeText,
                            { color: activeTheme.accent },
                          ]}
                        >
                          Promemoria: {reminderPreviewText}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            </View>

            {/* Pulsante Elimina Callstack Liquid Glass in basso se in modifica */}
            {noteToEdit && (
              <View style={styles.deleteSection}>
                <NativeActionButton
                  label="Elimina nota"
                  accentColor="#ef4444"
                  glow={true}
                  glowColor="rgba(239, 68, 68, 0.4)"
                  onPress={handleDelete}
                  icon={
                    <Ionicons
                      name="trash-outline"
                      size={17}
                      color="#ffffff"
                      style={{ marginRight: 6 }}
                    />
                  }
                  style={{ width: '100%', height: 48, borderRadius: 24 }}
                  pillStyle={{ height: 48, borderRadius: 24 }}
                  textStyle={{ fontSize: 15, fontWeight: '700', color: '#ffffff' }}
                />
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </NativeSheetModal>
  );
};

export const NoteEditModal: React.FC<NoteEditModalProps> = (props) => {
  if (!props.visible) return null;
  const formKey =
    props.noteToEdit?.id ||
    (props.initialLesson
      ? `l-${props.initialLesson.subject}-${props.initialLesson.dateStr || ''}`
      : props.initialDay
      ? `d-${props.initialDay.dayIndex}-${props.initialDay.dateStr || ''}`
      : 'new');
  return <NoteEditForm key={formKey} {...props} />;
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: UNIFORM_MODAL_BG,
  },
  container: {
    flex: 1,
    backgroundColor: UNIFORM_MODAL_BG,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
    gap: 14,
  },

  /* Segmented Bar Tipologia */
  typeSelectorRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 2,
  },
  typeSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 11,
  },
  typeSelectorBtnActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 3,
  },
  typeSelectorText: {
    color: '#94a3b8',
    fontSize: 12.5,
    fontWeight: '600',
  },
  typeSelectorTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  /* Sezione Titoli iOS */
  sectionHeader: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 6,
  },

  /* Card Contesto Associazione */
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16171d',
    borderRadius: 20,
    borderCurve: 'continuous',
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  contextIconSquircle: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 12,
  },
  contextTitle: {
    color: '#ffffff',
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  contextMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  contextMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  contextMetaPillText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '500',
  },

  /* Sezione Card Base (Stile Inset iOS) */
  cardSection: {
    backgroundColor: '#16171d',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },

  /* Input Note Stile Apple Notes */
  titleInput: {
    color: '#ffffff',
    fontSize: 16.5,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  contentInput: {
    color: '#e4e4e7',
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    minHeight: 110,
  },
  hairlineDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 16,
  },

  /* Riga Switch Promemoria */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchIconSquircle: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  switchTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  switchSubtitle: {
    color: '#8e8e93',
    fontSize: 12,
    marginTop: 2,
  },

  /* Contenuto Espanso Promemoria */
  reminderExpandedContent: {
    paddingBottom: 14,
    gap: 10,
  },
  cardSubHeader: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.6,
    marginTop: 4,
    marginLeft: 16,
    textTransform: 'uppercase',
  },

  /* Griglia Preset Orari: 4 elementi per riga */
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 14,
  },
  presetPill: {
    flexBasis: '23%',
    flexGrow: 1,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  presetPillActive: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
  presetPillText: {
    fontSize: 11.5,
    color: '#94a3b8',
    fontWeight: '600',
  },

  /* Righe Tabellari Inset iOS per Selettori (DatePicker & TimePicker) */
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowIconSquircle: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pickerTextColumn: {
    marginLeft: 12,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
    justifyContent: 'center',
  },
  pickerRowTitle: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '600',
  },
  pickerRowSubtitle: {
    color: '#8e8e93',
    fontSize: 12,
    marginTop: 2,
  },
  datePickerWrapper: {
    width: Platform.OS === 'ios' ? 120 : 130,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  datePickerControl: {
    width: Platform.OS === 'ios' ? 120 : 130,
    height: 36,
  },
  timePickerWrapper: {
    width: Platform.OS === 'ios' ? 90 : 100,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  timePickerControl: {
    width: Platform.OS === 'ios' ? 90 : 100,
    height: 36,
  },

  /* Avviso Data/Ora Calcolata */
  previewNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 14,
    borderWidth: 1,
  },
  previewNoticeText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },

  /* Sezione Elimina */
  deleteSection: {
    marginTop: 6,
    paddingBottom: 6,
  },
});
