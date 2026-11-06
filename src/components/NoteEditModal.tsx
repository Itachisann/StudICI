import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeSheetModal } from './NativeSheetModal';
import {
  AppNote,
  deleteNote,
  NoteTargetType,
  saveNote,
} from '../utils/notesStorage';

const UNIFORM_MODAL_BG = '#0b0d13';

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

const NoteEditForm: React.FC<NoteEditModalProps> = ({
  visible,
  onClose,
  noteToEdit,
  initialLesson,
  initialDay,
  onSaved,
  onDeleted,
  theme = {
    primary: '#822433',
    accent: '#60a5fa',
    cardTint: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.1)',
    subtle: 'rgba(255, 255, 255, 0.08)',
  },
}) => {
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
  const dayIndex = typeof noteToEdit?.dayIndex === 'number'
    ? noteToEdit.dayIndex
    : typeof initialLesson?.dayIndex === 'number'
    ? initialLesson.dayIndex
    : typeof initialDay?.dayIndex === 'number'
    ? initialDay.dayIndex
    : 0;
  const dateStr = noteToEdit?.dateStr ||
    initialLesson?.dateStr ||
    initialDay?.dateStr ||
    new Date().toISOString().split('T')[0];

  // Promemoria
  const [reminderEnabled, setReminderEnabled] = useState(() => Boolean(noteToEdit?.reminderEnabled));
  const [reminderPreset, setReminderPreset] = useState<string>(() => {
    if (noteToEdit?.reminderDate) return 'custom';
    if (initialDay) return '08:00';
    return 'start';
  });
  const [customTime, setCustomTime] = useState(() => {
    if (noteToEdit?.reminderDate) {
      try {
        const d = new Date(noteToEdit.reminderDate);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      } catch {}
    }
    return '08:00';
  });

  // Calcola la data/ora esatta del promemoria in base al preset scelto
  const computeReminderDateIso = useCallback((): string | undefined => {
    if (!reminderEnabled) return undefined;

    const baseDate = dateStr || new Date().toISOString().split('T')[0];
    const [year, month, day] = baseDate.split('-').map(Number);

    if (targetType === 'lesson') {
      const startTimeStr = (lessonTime.split('-')[0] || '').trim();
      let lessonH = 8;
      let lessonM = 30;
      if (startTimeStr.includes(':')) {
        const [h, m] = startTimeStr.split(':').map(Number);
        if (!isNaN(h)) lessonH = h;
        if (!isNaN(m)) lessonM = m;
      }

      const targetD = new Date(year, month - 1, day, lessonH, lessonM, 0, 0);

      switch (reminderPreset) {
        case 'start':
          return targetD.toISOString();
        case '15m':
          return new Date(targetD.getTime() - 15 * 60 * 1000).toISOString();
        case '30m':
          return new Date(targetD.getTime() - 30 * 60 * 1000).toISOString();
        case '1h':
          return new Date(targetD.getTime() - 60 * 60 * 1000).toISOString();
        case 'custom':
        default: {
          const [cH, cM] = customTime.split(':').map(Number);
          const cD = new Date(year, month - 1, day, isNaN(cH) ? 8 : cH, isNaN(cM) ? 0 : cM, 0, 0);
          return cD.toISOString();
        }
      }
    } else {
      // Per il giorno
      switch (reminderPreset) {
        case '08:00':
          return new Date(year, month - 1, day, 8, 0, 0, 0).toISOString();
        case '09:00':
          return new Date(year, month - 1, day, 9, 0, 0, 0).toISOString();
        case '20:00_prev': {
          const prev = new Date(year, month - 1, day - 1, 20, 0, 0, 0);
          return prev.toISOString();
        }
        case 'custom':
        default: {
          const [cH, cM] = customTime.split(':').map(Number);
          const cD = new Date(year, month - 1, day, isNaN(cH) ? 8 : cH, isNaN(cM) ? 0 : cM, 0, 0);
          return cD.toISOString();
        }
      }
    }
  }, [reminderEnabled, dateStr, targetType, lessonTime, reminderPreset, customTime]);

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
      title={noteToEdit ? 'Modifica Nota' : 'Nuova Nota'}
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
            {/* Selettore Tipologia se creata da zero */}
            {!noteToEdit && !initialLesson && !initialDay && (
              <View style={styles.typeSelectorRow}>
                <TouchableOpacity
                  style={[
                    styles.typeSelectorBtn,
                    targetType === 'lesson' && styles.typeSelectorBtnActive,
                  ]}
                  onPress={() => setTargetType('lesson')}
                >
                  <Ionicons
                    name="book-outline"
                    size={13}
                    color={targetType === 'lesson' ? '#ffffff' : '#94a3b8'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.typeSelectorText,
                      targetType === 'lesson' && styles.typeSelectorTextActive,
                    ]}
                  >
                    Associata a Lezione
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeSelectorBtn,
                    targetType === 'day' && styles.typeSelectorBtnActive,
                  ]}
                  onPress={() => setTargetType('day')}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={13}
                    color={targetType === 'day' ? '#ffffff' : '#94a3b8'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.typeSelectorText,
                      targetType === 'day' && styles.typeSelectorTextActive,
                    ]}
                  >
                    Associata al Giorno
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Badge Contesto / Associazione */}
            <View style={styles.contextBadgeBox}>
              <View style={styles.contextBadgeIconCircle}>
                <Ionicons
                  name={targetType === 'lesson' ? 'book' : 'calendar'}
                  size={14}
                  color="#60a5fa"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextBadgeTitle}>
                  {targetType === 'lesson'
                    ? lessonSubject || 'Lezione'
                    : `Giorno: ${DAYS_NAMES[dayIndex] || 'Giorno'}`}
                </Text>
                <Text style={styles.contextBadgeSubtitle}>
                  {targetType === 'lesson'
                    ? `${DAYS_NAMES[dayIndex] || ''}${lessonTime ? ` • ${lessonTime}` : ''}${lessonRoom ? ` • ${lessonRoom}` : ''}`
                    : `Data: ${dateStr || 'Odierna'}`}
                </Text>
              </View>
            </View>

            {/* Sezione Contenuto */}
            <View style={styles.cardSection}>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>TITOLO (OPZIONALE)</Text>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Es. Portare fogli protocollo, Esercizio 4..."
                  placeholderTextColor="#64748b"
                  maxLength={60}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>TESTO DELLA NOTA *</Text>
                <TextInput
                  style={styles.contentInput}
                  value={content}
                  onChangeText={setContent}
                  placeholder="Scrivi qui gli appunti, le cose da ricordare, compiti..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Sezione Promemoria e Notifica */}
            <View style={styles.cardSection}>
              <View style={styles.switchRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View
                    style={[
                      styles.reminderIconCircle,
                      reminderEnabled && { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
                    ]}
                  >
                    <Ionicons
                      name={reminderEnabled ? 'notifications' : 'notifications-outline'}
                      size={16}
                      color={reminderEnabled ? '#10b981' : '#94a3b8'}
                    />
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={styles.reminderSwitchLabel}>Attiva Promemoria</Text>
                    <Text style={styles.reminderSwitchSub}>
                      Invia una notifica locale sul dispositivo
                    </Text>
                  </View>
                </View>
                <Switch
                  value={reminderEnabled}
                  onValueChange={setReminderEnabled}
                  trackColor={{ false: '#334155', true: '#10b981' }}
                  thumbColor="#ffffff"
                />
              </View>

              {reminderEnabled && (
                <View style={styles.reminderDetailsBox}>
                  <Text style={styles.presetSectionTitle}>QUANDO AVVISARE</Text>
                  <View style={styles.presetChipsRow}>
                    {targetType === 'lesson' ? (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === 'start' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('start')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === 'start' && styles.presetChipTextActive,
                            ]}
                          >
                            All&apos;inizio
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '15m' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('15m')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '15m' && styles.presetChipTextActive,
                            ]}
                          >
                            -15 min
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '30m' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('30m')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '30m' && styles.presetChipTextActive,
                            ]}
                          >
                            -30 min
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '1h' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('1h')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '1h' && styles.presetChipTextActive,
                            ]}
                          >
                            -1 ora
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === 'custom' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('custom')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === 'custom' && styles.presetChipTextActive,
                            ]}
                          >
                            Orario...
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '08:00' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('08:00')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '08:00' && styles.presetChipTextActive,
                            ]}
                          >
                            08:00
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '09:00' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('09:00')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '09:00' && styles.presetChipTextActive,
                            ]}
                          >
                            09:00
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === '20:00_prev' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('20:00_prev')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === '20:00_prev' && styles.presetChipTextActive,
                            ]}
                          >
                            Sera prima (20:00)
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.presetChip,
                            reminderPreset === 'custom' && styles.presetChipActive,
                          ]}
                          onPress={() => setReminderPreset('custom')}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              reminderPreset === 'custom' && styles.presetChipTextActive,
                            ]}
                          >
                            Orario...
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>

                  {reminderPreset === 'custom' && (
                    <View style={styles.customTimeRow}>
                      <Ionicons name="time-outline" size={14} color="#60a5fa" style={{ marginRight: 6 }} />
                      <Text style={styles.customTimeLabel}>Imposta orario (HH:mm):</Text>
                      <TextInput
                        style={styles.customTimeInput}
                        value={customTime}
                        onChangeText={setCustomTime}
                        placeholder="08:00"
                        placeholderTextColor="#64748b"
                        maxLength={5}
                      />
                    </View>
                  )}

                  {reminderPreviewText ? (
                    <View style={styles.previewNoticeBox}>
                      <Ionicons name="alarm-outline" size={13} color="#10b981" style={{ marginRight: 5 }} />
                      <Text style={styles.previewNoticeText}>
                        Notifica: {reminderPreviewText}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {/* Pulsante Elimina se in modifica */}
            {noteToEdit && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={handleDelete}
                activeOpacity={0.75}
              >
                <Ionicons name="trash-outline" size={16} color="#ef4444" style={{ marginRight: 6 }} />
                <Text style={styles.deleteBtnText}>Elimina questa nota</Text>
              </TouchableOpacity>
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
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 14,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    backgroundColor: '#161b26',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#242e42',
  },
  typeSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 8,
  },
  typeSelectorBtnActive: {
    backgroundColor: '#2563eb',
  },
  typeSelectorText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  typeSelectorTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  contextBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b26',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#242e42',
  },
  contextBadgeIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  contextBadgeTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
  },
  contextBadgeSubtitle: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginTop: 2,
  },
  cardSection: {
    backgroundColor: '#141824',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#21293a',
    gap: 10,
  },
  inputGroup: {
    gap: 4,
  },
  fieldLabel: {
    color: '#64748b',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  titleInput: {
    backgroundColor: '#0d111a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242c3d',
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  contentInput: {
    backgroundColor: '#0d111a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242c3d',
    color: '#f8fafc',
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 88,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    backgroundColor: '#202636',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reminderIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderSwitchLabel: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '600',
  },
  reminderSwitchSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  reminderDetailsBox: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#202636',
    gap: 8,
  },
  presetSectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    backgroundColor: '#1b2232',
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2b364e',
  },
  presetChipActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  presetChipText: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  customTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d111a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#242c3d',
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  customTimeLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '500',
    marginRight: 6,
  },
  customTimeInput: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 50,
    padding: 0,
  },
  previewNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    marginTop: 4,
  },
  previewNoticeText: {
    color: '#6ee7b7',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    marginTop: 4,
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
});
