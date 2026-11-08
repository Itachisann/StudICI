import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeSheetModal } from './NativeSheetModal';
import { NoteEditModal } from './NoteEditModal';
import { SwipeToDeleteRow } from './SwipeToDeleteRow';
import { NoteItemContextMenu } from './NoteItemContextMenu';
import { NativeActionButton } from './NativeActionButton';
import { useTheme } from '../context/ThemeContext';
import { UNIFORM_MODAL_BG } from '../constants/theme';
import {
  AppNote,
  deleteNote,
  getNotes,
  subscribeToNotesChanges,
  syncAppleRemindersWithNotes,
  toggleNoteCompleted,
} from '../utils/notesStorage';

export interface NotesRegistryModalProps {
  visible: boolean;
  onClose: () => void;
  theme?: {
    primary: string;
    accent: string;
    cardTint: string;
    border: string;
    subtle: string;
    bg?: string;
  };
}

type FilterTab = 'all' | 'lessons' | 'days' | 'reminders';

const DAYS_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const formatShortDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const [, m, d] = dateStr.split('-').map(Number);
    const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    return `${d} ${months[m - 1]}`;
  } catch {
    return dateStr;
  }
};

const formatDayTitle = (dayIndex?: number, dateStr?: string): string => {
  if (dateStr) {
    try {
      const [, m, d] = dateStr.split('-').map(Number);
      const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      const dayName = typeof dayIndex === 'number' && DAYS_NAMES[dayIndex] ? DAYS_NAMES[dayIndex] : '';
      return `${dayName ? `${dayName} ` : ''}${d} ${months[m - 1]}`;
    } catch {}
  }
  return typeof dayIndex === 'number' ? DAYS_NAMES[dayIndex] : 'Giorno';
};

const getNoteDayIndex = (note: AppNote): number => {
  if (typeof note.dayIndex === 'number' && note.dayIndex >= 0 && note.dayIndex < 7) {
    return note.dayIndex;
  }
  if (note.dateStr) {
    try {
      const [y, m, d] = note.dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return (dt.getDay() + 6) % 7;
    } catch {}
  }
  return 0;
};

interface DayLessonGroup {
  key: string;
  subject: string;
  time?: string;
  room?: string;
  notes: AppNote[];
}

interface DayGroup {
  dayIndex: number;
  dayName: string;
  dateStr?: string;
  totalNotesCount: number;
  lessonGroups: DayLessonGroup[];
  dayNotes: AppNote[];
}

export const NotesRegistryModal: React.FC<NotesRegistryModalProps> = ({
  visible,
  onClose,
  theme,
}) => {
  const { theme: ctxTheme } = useTheme();
  const activeTheme = theme || ctxTheme;

  const [notes, setNotes] = useState<AppNote[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowTs] = useState(() => Date.now());

  // Modal di modifica / creazione
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedNoteToEdit, setSelectedNoteToEdit] = useState<AppNote | null>(null);

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    syncAppleRemindersWithNotes().then((list) => {
      if (isMounted) setNotes(list);
    });
    const unsub = subscribeToNotesChanges(() => {
      getNotes().then((list) => {
        if (isMounted) setNotes(list);
      });
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, [visible]);

  const handleDelete = (note: AppNote) => {
    Alert.alert(
      'Elimina nota',
      'Vuoi davvero eliminare questa nota e l\'eventuale promemoria associato?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            await deleteNote(note.id);
            const list = await getNotes();
            setNotes(list);
          },
        },
      ]
    );
  };

  const handleDeleteDirectly = async (noteId: string) => {
    await deleteNote(noteId);
    const list = await getNotes();
    setNotes(list);
  };

  const handleToggleComplete = async (noteId: string) => {
    await toggleNoteCompleted(noteId);
    const list = await getNotes();
    setNotes(list);
  };

  const handleOpenNewNote = () => {
    setSelectedNoteToEdit(null);
    setEditModalVisible(true);
  };

  const handleOpenEditNote = (note: AppNote) => {
    setSelectedNoteToEdit(note);
    setEditModalVisible(true);
  };

  // Filtraggio
  const filteredNotes = notes.filter((n) => {
    // Filtro per tab
    if (activeTab === 'lessons' && n.targetType !== 'lesson') return false;
    if (activeTab === 'days' && n.targetType !== 'day') return false;
    if (activeTab === 'reminders' && !n.reminderEnabled) return false;

    // Ricerca testuale
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = (n.title || '').toLowerCase().includes(q);
      const matchContent = n.content.toLowerCase().includes(q);
      const matchSubject = (n.lessonSubject || '').toLowerCase().includes(q);
      const matchRoom = (n.lessonRoom || '').toLowerCase().includes(q);
      return matchTitle || matchContent || matchSubject || matchRoom;
    }
    return true;
  });

  const totalNotes = notes.length;
  const activeReminders = notes.filter((n) => n.reminderEnabled).length;
  const completedNotes = notes.filter((n) => n.isCompleted).length;

  const groupedDays = useMemo<DayGroup[]>(() => {
    const map = new Map<number, {
      dayIndex: number;
      dayName: string;
      dateStr?: string;
      notes: AppNote[];
    }>();

    for (const note of filteredNotes) {
      const dIdx = getNoteDayIndex(note);
      if (!map.has(dIdx)) {
        map.set(dIdx, {
          dayIndex: dIdx,
          dayName: DAYS_NAMES[dIdx] || 'Altro',
          dateStr: note.dateStr,
          notes: [],
        });
      }
      const entry = map.get(dIdx)!;
      if (!entry.dateStr && note.dateStr) {
        entry.dateStr = note.dateStr;
      }
      entry.notes.push(note);
    }

    const sortedDays = Array.from(map.values()).sort((a, b) => a.dayIndex - b.dayIndex);

    return sortedDays.map((day) => {
      const lessonGroupsMap = new Map<string, DayLessonGroup>();
      const dayNotes: AppNote[] = [];

      for (const note of day.notes) {
        if (note.targetType === 'lesson' && note.lessonSubject) {
          const key = `${note.lessonSubject.trim().toLowerCase()}:::${(note.lessonTime || '').trim()}`;
          if (!lessonGroupsMap.has(key)) {
            lessonGroupsMap.set(key, {
              key,
              subject: note.lessonSubject.trim(),
              time: note.lessonTime?.trim(),
              room: note.lessonRoom?.trim(),
              notes: [],
            });
          }
          lessonGroupsMap.get(key)!.notes.push(note);
        } else {
          dayNotes.push(note);
        }
      }

      return {
        dayIndex: day.dayIndex,
        dayName: day.dayName,
        dateStr: day.dateStr,
        totalNotesCount: day.notes.length,
        lessonGroups: Array.from(lessonGroupsMap.values()),
        dayNotes,
      };
    });
  }, [filteredNotes]);

  const formatReminder = (item: AppNote) => {
    if (!item.reminderEnabled || !item.reminderDate) return null;
    try {
      const d = new Date(item.reminderDate);
      const isPast = d.getTime() <= nowTs;
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const dayNum = d.getDate();
      const monthShort = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][d.getMonth()];
      return {
        text: `${dayNum} ${monthShort} • ${timeStr}`,
        isPast,
      };
    } catch {
      return null;
    }
  };

  const renderSingleNoteCard = (item: AppNote) => {
    const isLesson = item.targetType === 'lesson';
    const reminderInfo = formatReminder(item);

    return (
      <SwipeToDeleteRow
        key={item.id}
        marginBottom={10}
        borderRadius={20}
        onPress={() => handleOpenEditNote(item)}
        onDelete={() => handleDeleteDirectly(item.id)}
      >
        <NoteItemContextMenu
          title={item.title || (isLesson ? item.lessonSubject || 'Lezione' : 'Giorno')}
          onEdit={() => handleOpenEditNote(item)}
          onDelete={() => handleDelete(item)}
          onToggleComplete={() => handleToggleComplete(item.id)}
          isCompleted={item.isCompleted}
          style={{ width: '100%' }}
        >
          <View
            style={[
              styles.noteCard,
              item.isCompleted && styles.noteCardCompleted,
            ]}
          >
            {/* Intestazione target della nota */}
            <View style={styles.cardHeaderRow}>
              <View style={styles.targetBadgeRow}>
                <View
                  style={[
                    styles.targetIconCircle,
                    { backgroundColor: activeTheme.subtle },
                  ]}
                >
                  <Ionicons
                    name={isLesson ? 'book' : 'calendar'}
                    size={13}
                    color={activeTheme.accent}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.targetTitle} numberOfLines={1}>
                    {isLesson
                      ? item.lessonSubject || 'Lezione'
                      : formatDayTitle(item.dayIndex, item.dateStr)}
                  </Text>
                  {(item.lessonTime || item.lessonRoom || item.dateStr) && (
                    <Text style={styles.targetSub} numberOfLines={1}>
                      {isLesson
                        ? `${item.lessonTime ? `${item.lessonTime} • ` : ''}${item.lessonRoom ? (item.lessonRoom.toLowerCase().startsWith('aula') ? item.lessonRoom : `Aula ${item.lessonRoom}`) : ''}`
                        : 'Tutto il giorno'}
                    </Text>
                  )}
                </View>
              </View>

              {/* Azione rapida Modifica */}
              <View style={styles.cardActionsRow}>
                <TouchableOpacity
                  style={styles.iconActionBtn}
                  onPress={() => handleOpenEditNote(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="pencil-outline" size={15} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Titolo e Contenuto della nota */}
            <View style={styles.cardBody}>
              {item.title ? (
                <Text
                  style={[styles.noteTitle, item.isCompleted && styles.textCompleted]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
              ) : null}

              <Text
                style={[styles.noteContent, item.isCompleted && styles.textCompleted]}
                numberOfLines={5}
              >
                {item.content}
              </Text>
            </View>

            {/* Footer: Promemoria e Checkbox di completamento */}
            <View style={styles.cardFooterRow}>
              {reminderInfo ? (
                <View
                  style={[
                    styles.reminderPill,
                    reminderInfo.isPast
                      ? { backgroundColor: 'rgba(100, 116, 139, 0.15)', borderColor: '#334155' }
                      : { backgroundColor: activeTheme.subtle, borderColor: activeTheme.border },
                  ]}
                >
                  <Ionicons
                    name={reminderInfo.isPast ? 'alarm' : 'notifications'}
                    size={12}
                    color={reminderInfo.isPast ? '#94a3b8' : activeTheme.accent}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.reminderPillText,
                      reminderInfo.isPast ? { color: '#94a3b8' } : { color: activeTheme.accent },
                    ]}
                  >
                    {reminderInfo.text}
                  </Text>
                </View>
              ) : (
                <View />
              )}

              <TouchableOpacity
                style={[
                  styles.checkboxRow,
                  item.isCompleted && styles.checkboxRowCompleted,
                ]}
                onPress={() => handleToggleComplete(item.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
                  size={15}
                  color={item.isCompleted ? '#10b981' : '#64748b'}
                  style={{ marginRight: 5 }}
                />
                <Text
                  style={[
                    styles.checkboxText,
                    item.isCompleted && { color: '#10b981', fontWeight: '700' },
                  ]}
                >
                  {item.isCompleted ? 'Completata' : 'Da fare'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </NoteItemContextMenu>
      </SwipeToDeleteRow>
    );
  };

  const renderGroupedNoteRow = (item: AppNote, lessonSubject: string) => {
    const reminderInfo = formatReminder(item);

    return (
      <SwipeToDeleteRow
        key={item.id}
        marginBottom={8}
        borderRadius={18}
        onPress={() => handleOpenEditNote(item)}
        onDelete={() => handleDeleteDirectly(item.id)}
      >
        <NoteItemContextMenu
          title={item.title || lessonSubject || 'Nota'}
          onEdit={() => handleOpenEditNote(item)}
          onDelete={() => handleDelete(item)}
          onToggleComplete={() => handleToggleComplete(item.id)}
          isCompleted={item.isCompleted}
          style={{ width: '100%' }}
        >
          <View
            style={[
              styles.groupedNoteCard,
              item.isCompleted && styles.noteCardCompleted,
            ]}
          >
            <View style={styles.groupedCardHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                {item.title ? (
                  <Text
                    style={[styles.noteTitle, item.isCompleted && styles.textCompleted]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                ) : (
                  <Text style={styles.noteTitleDefault}>Appunto</Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.iconActionBtn}
                onPress={() => handleOpenEditNote(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil-outline" size={14} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <View>
              <Text
                style={[styles.noteContent, item.isCompleted && styles.textCompleted]}
                numberOfLines={4}
              >
                {item.content}
              </Text>
            </View>

            <View style={styles.cardFooterRow}>
              {reminderInfo ? (
                <View
                  style={[
                    styles.reminderPill,
                    reminderInfo.isPast
                      ? { backgroundColor: 'rgba(100, 116, 139, 0.15)', borderColor: '#334155' }
                      : { backgroundColor: activeTheme.subtle, borderColor: activeTheme.border },
                  ]}
                >
                  <Ionicons
                    name={reminderInfo.isPast ? 'alarm' : 'notifications'}
                    size={12}
                    color={reminderInfo.isPast ? '#94a3b8' : activeTheme.accent}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.reminderPillText,
                      reminderInfo.isPast ? { color: '#94a3b8' } : { color: activeTheme.accent },
                    ]}
                  >
                    {reminderInfo.text}
                  </Text>
                </View>
              ) : (
                <View />
              )}

              <TouchableOpacity
                style={[
                  styles.checkboxRow,
                  item.isCompleted && styles.checkboxRowCompleted,
                ]}
                onPress={() => handleToggleComplete(item.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
                  size={15}
                  color={item.isCompleted ? '#10b981' : '#64748b'}
                  style={{ marginRight: 5 }}
                />
                <Text
                  style={[
                    styles.checkboxText,
                    item.isCompleted && { color: '#10b981', fontWeight: '700' },
                  ]}
                >
                  {item.isCompleted ? 'Completata' : 'Da fare'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </NoteItemContextMenu>
      </SwipeToDeleteRow>
    );
  };

  const renderDaySection = ({ item: day }: { item: DayGroup }) => {
    return (
      <View style={styles.daySectionBox} key={`day_${day.dayIndex}`}>
        <View style={styles.daySectionHeader}>
          <View style={styles.daySectionLeft}>
            <View style={[styles.dayDot, { backgroundColor: activeTheme.primary }]} />
            <Text style={styles.daySectionTitle}>{day.dayName.toUpperCase()}</Text>
            {day.dateStr ? (
              <Text style={styles.daySectionDate}>• {formatShortDate(day.dateStr)}</Text>
            ) : null}
          </View>
          <View style={[styles.dayCountBadge, { backgroundColor: activeTheme.subtle }]}>
            <Text style={[styles.dayCountText, { color: activeTheme.accent }]}>
              {day.totalNotesCount} {day.totalNotesCount === 1 ? 'nota' : 'note'}
            </Text>
          </View>
        </View>

        {day.lessonGroups.map((lg) => {
          if (lg.notes.length > 1) {
            return (
              <View style={styles.lessonGroupContainer} key={lg.key}>
                <View style={styles.lessonGroupHeader}>
                  <View
                    style={[
                      styles.targetIconCircle,
                      { backgroundColor: activeTheme.subtle },
                    ]}
                  >
                    <Ionicons
                      name="book"
                      size={13}
                      color={activeTheme.accent}
                    />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.lessonGroupTitle} numberOfLines={1}>
                      {lg.subject}
                    </Text>
                    <Text style={styles.lessonGroupSubtitle} numberOfLines={1}>
                      {lg.time ? `${lg.time}` : ''}
                      {lg.room
                        ? ` • ${lg.room.toLowerCase().startsWith('aula') ? lg.room : `Aula ${lg.room}`}`
                        : ''}
                    </Text>
                  </View>
                  <View style={[styles.lessonNotesCountPill, { backgroundColor: activeTheme.subtle }]}>
                    <Text style={[styles.lessonNotesCountText, { color: activeTheme.accent }]}>
                      {lg.notes.length} note
                    </Text>
                  </View>
                </View>
                <View style={styles.lessonGroupBody}>
                  {lg.notes.map((n) => renderGroupedNoteRow(n, lg.subject))}
                </View>
              </View>
            );
          } else {
            return renderSingleNoteCard(lg.notes[0]);
          }
        })}

        {day.dayNotes.map((dn) => renderSingleNoteCard(dn))}
      </View>
    );
  };

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Promemoria"
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'plus',
          prominent: true,
          tintColor: activeTheme.primary,
          accessibilityLabel: 'Nuova nota',
          onPress: handleOpenNewNote,
        },
      ]}
    >
      <View style={styles.modalRoot}>
        {/* Banner Statistiche Rapide */}
        <View style={styles.statsBanner}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{totalNotes}</Text>
            <Text style={styles.statLabel}>Note totali</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: '#10b981' }]}>{activeReminders}</Text>
            <Text style={styles.statLabel}>Promemoria attivi</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: activeTheme.accent }]}>{completedNotes}</Text>
            <Text style={styles.statLabel}>Completate</Text>
          </View>
        </View>

        {/* Barra di ricerca */}
        <View style={styles.searchBarBox}>
          <Ionicons name="search-outline" size={15} color="#64748b" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Cerca tra appunti, lezioni o compiti..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={15} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Tab di Filtraggio */}
        <View style={styles.tabsRow}>
          {(
            [
              { id: 'all' as FilterTab, label: `Tutte (${notes.length})`, icon: undefined },
              { id: 'lessons' as FilterTab, label: 'Lezioni', icon: undefined },
              { id: 'days' as FilterTab, label: 'Giorni', icon: undefined },
              {
                id: 'reminders' as FilterTab,
                label: `Promemoria (${activeReminders})`,
                icon: 'notifications' as keyof typeof Ionicons.glyphMap,
              },
            ]
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.tabBtn,
                  {
                    backgroundColor: isActive ? activeTheme.primary : '#1c1c1e',
                    borderColor: isActive ? activeTheme.primary : 'rgba(255, 255, 255, 0.08)',
                  },
                ]}
                onPress={() => setActiveTab(tab.id)}
                activeOpacity={0.75}
              >
                {tab.icon && (
                  <Ionicons
                    name={tab.icon}
                    size={11}
                    color={isActive ? '#ffffff' : activeTheme.accent}
                    style={{ marginRight: 3 }}
                  />
                )}
                <Text
                  style={[
                    styles.tabBtnText,
                    isActive && styles.tabBtnTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Elenco Note */}
        {filteredNotes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconCircle, { backgroundColor: activeTheme.subtle }]}>
              <Ionicons name="document-text-outline" size={32} color={activeTheme.accent} />
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery
                ? 'Nessuna nota corrisponde alla ricerca'
                : activeTab === 'reminders'
                ? 'Nessun promemoria programmato'
                : 'Nessuna nota salvata'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? 'Prova a cercare un\'altra parola chiave o cancella il filtro'
                : 'Puoi aggiungere note e promemoria per singole lezioni o per intere giornate.'}
            </Text>
            <NativeActionButton
              label="Crea una nuova nota"
              icon={<Ionicons name="add" size={17} color="#ffffff" style={{ marginRight: 6 }} />}
              onPress={handleOpenNewNote}
              accentColor={activeTheme.primary}
              glow={true}
              style={{ minWidth: 210, height: 46, marginTop: 16 }}
            />
          </View>
        ) : (
          <FlatList
            data={groupedDays}
            keyExtractor={(item) => `day_${item.dayIndex}`}
            renderItem={renderDaySection}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Modal Modifica/Creazione */}
        <NoteEditModal
          visible={editModalVisible}
          onClose={() => setEditModalVisible(false)}
          noteToEdit={selectedNoteToEdit}
          onSaved={() => {
            getNotes().then(setNotes);
          }}
          onDeleted={() => {
            getNotes().then(setNotes);
          }}
          theme={activeTheme}
        />
      </View>
    </NativeSheetModal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: UNIFORM_MODAL_BG,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  statsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#16171d',
    borderRadius: 20,
    borderCurve: 'continuous',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 16.5,
    fontWeight: '700',
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 10.5,
    marginTop: 2,
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16171d',
    borderRadius: 16,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    padding: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16171d',
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 6.5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabBtnActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  tabBtnText: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 30,
    gap: 10,
  },
  noteCard: {
    backgroundColor: '#16171d',
    borderRadius: 20,
    borderCurve: 'continuous',
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 8,
    width: '100%',
  },
  noteCardCompleted: {
    opacity: 0.65,
    backgroundColor: '#131419',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  targetBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  targetIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 10,
  },
  targetTitle: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
  },
  targetSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconActionBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  cardBody: {
    gap: 3,
  },
  noteTitle: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
  },
  noteContent: {
    color: '#e4e4e7',
    fontSize: 13.5,
    lineHeight: 19.5,
  },
  textCompleted: {
    textDecorationLine: 'line-through',
    color: '#71717a',
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  reminderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  reminderPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  checkboxRowCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  checkboxText: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 45,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#161b26',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 6,
  },
  emptyAddBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  daySectionBox: {
    marginBottom: 16,
  },
  daySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginBottom: 8,
  },
  daySectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  daySectionTitle: {
    color: '#f8fafc',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  daySectionDate: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '500',
  },
  dayCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  dayCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  lessonGroupContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  lessonGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  lessonGroupTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  lessonGroupSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1.5,
  },
  lessonNotesCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  lessonNotesCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  lessonGroupBody: {
    gap: 4,
  },
  groupedNoteCard: {
    backgroundColor: '#16171d',
    borderRadius: 18,
    borderCurve: 'continuous',
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 6,
    width: '100%',
  },
  groupedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteTitleDefault: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
});
