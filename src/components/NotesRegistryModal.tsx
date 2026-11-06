import React, { useEffect, useState } from 'react';
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
import {
  AppNote,
  deleteNote,
  getNotes,
  subscribeToNotesChanges,
  toggleNoteCompleted,
} from '../utils/notesStorage';

const UNIFORM_MODAL_BG = '#0b0d13';

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

export const NotesRegistryModal: React.FC<NotesRegistryModalProps> = ({
  visible,
  onClose,
  theme = {
    primary: '#822433',
    accent: '#60a5fa',
    cardTint: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.1)',
    subtle: 'rgba(255, 255, 255, 0.08)',
  },
}) => {
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
    getNotes().then((list) => {
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

  const renderNoteCard = ({ item }: { item: AppNote }) => {
    const isLesson = item.targetType === 'lesson';

    let reminderDateFormatted = '';
    let isPastReminder = false;
    if (item.reminderEnabled && item.reminderDate) {
      try {
        const d = new Date(item.reminderDate);
        isPastReminder = d.getTime() <= nowTs;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const dayNum = d.getDate();
        const monthShort = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][d.getMonth()];
        reminderDateFormatted = `${dayNum} ${monthShort} • ${timeStr}`;
      } catch {}
    }

    return (
      <View style={[styles.noteCard, item.isCompleted && styles.noteCardCompleted]}>
        {/* Intestazione target della nota */}
        <View style={styles.cardHeaderRow}>
          <View style={styles.targetBadgeRow}>
            <View
              style={[
                styles.targetIconCircle,
                isLesson
                  ? { backgroundColor: 'rgba(96, 165, 250, 0.15)' }
                  : { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
              ]}
            >
              <Ionicons
                name={isLesson ? 'book' : 'calendar'}
                size={13}
                color={isLesson ? '#60a5fa' : '#f59e0b'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.targetTitle} numberOfLines={1}>
                {isLesson
                  ? item.lessonSubject || 'Lezione'
                  : typeof item.dayIndex === 'number'
                  ? DAYS_NAMES[item.dayIndex]
                  : 'Giorno'}
              </Text>
              {(item.lessonTime || item.lessonRoom || item.dateStr) && (
                <Text style={styles.targetSub} numberOfLines={1}>
                  {isLesson
                    ? `${item.lessonTime ? `${item.lessonTime} • ` : ''}${item.lessonRoom ? `Aula ${item.lessonRoom}` : ''}`
                    : `Data: ${item.dateStr || ''}`}
                </Text>
              )}
            </View>
          </View>

          {/* Azioni rapide Modifica / Elimina */}
          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              style={styles.iconActionBtn}
              onPress={() => handleOpenEditNote(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil-outline" size={15} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconActionBtn, { marginLeft: 6 }]}
              onPress={() => handleDelete(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={15} color="#ef4444" />
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
          {item.reminderEnabled && reminderDateFormatted ? (
            <View
              style={[
                styles.reminderPill,
                isPastReminder && { backgroundColor: 'rgba(100, 116, 139, 0.15)', borderColor: '#334155' },
              ]}
            >
              <Ionicons
                name={isPastReminder ? 'alarm' : 'notifications'}
                size={12}
                color={isPastReminder ? '#94a3b8' : '#10b981'}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.reminderPillText,
                  isPastReminder && { color: '#94a3b8' },
                ]}
              >
                {reminderDateFormatted}
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
    );
  };

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Registro Note & Promemoria"
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'plus',
          prominent: true,
          tintColor: theme.primary,
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
            <Text style={[styles.statNumber, { color: '#60a5fa' }]}>{completedNotes}</Text>
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
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'all' && styles.tabBtnTextActive]}>
              Tutte ({notes.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'lessons' && styles.tabBtnActive]}
            onPress={() => setActiveTab('lessons')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'lessons' && styles.tabBtnTextActive]}>
              Lezioni
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'days' && styles.tabBtnActive]}
            onPress={() => setActiveTab('days')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'days' && styles.tabBtnTextActive]}>
              Giorni
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'reminders' && styles.tabBtnActive]}
            onPress={() => setActiveTab('reminders')}
          >
            <Ionicons
              name="notifications"
              size={11}
              color={activeTab === 'reminders' ? '#ffffff' : '#10b981'}
              style={{ marginRight: 3 }}
            />
            <Text style={[styles.tabBtnText, activeTab === 'reminders' && styles.tabBtnTextActive]}>
              Promemoria ({activeReminders})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Elenco Note */}
        {filteredNotes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="document-text-outline" size={32} color="#64748b" />
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
            <TouchableOpacity style={styles.emptyAddBtn} onPress={handleOpenNewNote} activeOpacity={0.8}>
              <Ionicons name="add" size={16} color="#ffffff" style={{ marginRight: 5 }} />
              <Text style={styles.emptyAddBtnText}>Crea una nuova nota</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderNoteCard}
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
          theme={theme}
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
    backgroundColor: '#141824',
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#21293a',
    marginBottom: 10,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    color: '#f8fafc',
    fontSize: 16,
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
    backgroundColor: '#242e42',
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141824',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    borderWidth: 1,
    borderColor: '#21293a',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: '#f8fafc',
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
    backgroundColor: '#161b26',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#242e42',
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
    backgroundColor: '#141824',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#21293a',
    gap: 8,
  },
  noteCardCompleted: {
    opacity: 0.65,
    backgroundColor: '#0f121a',
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
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  targetTitle: {
    color: '#f8fafc',
    fontSize: 13,
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
    padding: 4,
  },
  cardBody: {
    gap: 3,
  },
  noteTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
  },
  noteContent: {
    color: '#cbd5e1',
    fontSize: 12.5,
    lineHeight: 18,
  },
  textCompleted: {
    textDecorationLine: 'line-through',
    color: '#64748b',
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1d2433',
  },
  reminderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  reminderPillText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  checkboxRowCompleted: {},
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
});
