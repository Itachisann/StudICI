import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeSheetModal } from './NativeSheetModal';
import { SwipeToDeleteRow } from './SwipeToDeleteRow';
import { NoteItemContextMenu } from './NoteItemContextMenu';
import { useTheme } from '../context/ThemeContext';
import { UNIFORM_MODAL_BG } from '../constants/theme';
import {
  AppNote,
  deleteNote,
  toggleNoteCompleted,
} from '../utils/notesStorage';

export interface ContextNotesListModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  subject?: string;
  room?: string;
  time?: string;
  dayName?: string;
  dateStr?: string;
  notes: AppNote[];
  onOpenEditNote: (note: AppNote) => void;
  onAddNewNote: () => void;
  theme?: {
    primary: string;
    accent: string;
    cardTint: string;
    border: string;
    subtle: string;
    bg?: string;
  };
}

export const ContextNotesListModal: React.FC<ContextNotesListModalProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  subject,
  room,
  time,
  dayName,
  dateStr,
  notes,
  onOpenEditNote,
  onAddNewNote,
  theme,
}) => {
  const { theme: ctxTheme } = useTheme();
  const activeTheme = theme || ctxTheme;
  const [nowTs] = useState(() => Date.now());

  const formattedDate = useMemo(() => {
    if (!dateStr) return '';
    try {
      const [, m, d] = dateStr.split('-').map(Number);
      const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      return `${dayName ? `${dayName} ` : ''}${d} ${months[m - 1]}`;
    } catch {
      return dateStr;
    }
  }, [dateStr, dayName]);

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
          },
        },
      ]
    );
  };

  const handleToggleComplete = async (noteId: string) => {
    await toggleNoteCompleted(noteId);
  };

  const renderNoteItem = ({ item }: { item: AppNote }) => {
    let reminderDateFormatted = '';
    let isPastReminder = false;
    if (item.reminderEnabled && item.reminderDate) {
      try {
        const d = new Date(item.reminderDate);
        isPastReminder = d.getTime() <= nowTs;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const dayNum = d.getDate();
        const monthShort = [
          'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
          'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
        ][d.getMonth()];
        reminderDateFormatted = `${dayNum} ${monthShort} • ${timeStr}`;
      } catch {}
    }

    return (
      <SwipeToDeleteRow
        key={item.id}
        marginBottom={10}
        borderRadius={20}
        onPress={() => onOpenEditNote(item)}
        onDelete={async () => {
          await deleteNote(item.id);
        }}
      >
        <NoteItemContextMenu
          title={item.title || title || 'Nota'}
          onEdit={() => onOpenEditNote(item)}
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
            {/* Header riga */}
            <View style={styles.cardHeaderRow}>
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
                onPress={() => onOpenEditNote(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil-outline" size={15} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Testo nota */}
            <View style={{ marginTop: 2 }}>
              <Text
                style={[styles.noteContent, item.isCompleted && styles.textCompleted]}
                numberOfLines={4}
              >
                {item.content}
              </Text>
            </View>

            {/* Footer con pill promemoria se presente e stato completamento */}
            <View style={styles.cardFooterRow}>
              {item.reminderEnabled && reminderDateFormatted ? (
                <View
                  style={[
                    styles.reminderPill,
                    isPastReminder
                      ? { backgroundColor: 'rgba(100, 116, 139, 0.15)', borderColor: '#334155' }
                      : { backgroundColor: activeTheme.subtle, borderColor: activeTheme.border },
                  ]}
                >
                  <Ionicons
                    name={isPastReminder ? 'alarm' : 'notifications'}
                    size={12}
                    color={isPastReminder ? '#94a3b8' : activeTheme.accent}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.reminderPillText,
                      isPastReminder ? { color: '#94a3b8' } : { color: activeTheme.accent },
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
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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

  if (!visible) return null;

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title={subject ? 'Note lezione' : (dayName ? `Note ${dayName}` : (title || 'Note'))}
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'plus',
          prominent: true,
          tintColor: activeTheme.primary,
          accessibilityLabel: 'Aggiungi nota',
          onPress: onAddNewNote,
        },
      ]}
    >
      <View style={styles.modalRoot}>
        {/* Card Contesto Associazione: coerente con Nuova Nota */}
        {(subject || dayName || subtitle) ? (
          <View style={styles.contextCardContainer}>
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
                  name={subject ? 'book' : 'calendar'}
                  size={18}
                  color={activeTheme.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextTitle} numberOfLines={1}>
                  {subject || formattedDate || (dayName ? `Note di ${dayName}` : 'Note')}
                </Text>

                {subject ? (
                  <View style={styles.contextMetaRow}>
                    <View style={styles.contextMetaPill}>
                      <Ionicons
                        name="calendar-outline"
                        size={11}
                        color="#94a3b8"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.contextMetaPillText}>{dayName || 'Giorno'}</Text>
                    </View>
                    {Boolean(time) && (
                      <View style={styles.contextMetaPill}>
                        <Ionicons
                          name="time-outline"
                          size={11}
                          color="#94a3b8"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.contextMetaPillText}>{time}</Text>
                      </View>
                    )}
                    {Boolean(room) && (
                      <View style={styles.contextMetaPill}>
                        <Ionicons
                          name="location-outline"
                          size={11}
                          color="#94a3b8"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.contextMetaPillText}>
                          {room?.toLowerCase().startsWith('aula') ? room : `Aula ${room}`}
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
        ) : null}

        {notes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View
              style={[
                styles.emptyIconCircle,
                {
                  backgroundColor: activeTheme.subtle,
                  borderColor: activeTheme.border,
                },
              ]}
            >
              <Ionicons
                name="document-text-outline"
                size={32}
                color={activeTheme.accent}
              />
            </View>
            <Text style={styles.emptyTitle}>Nessuna nota presente</Text>
            <Text style={styles.emptySubtitle}>
              Tocca il pulsante + in alto a destra per creare una nuova nota.
            </Text>
          </View>
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            renderItem={renderNoteItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
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
  sectionHeader: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 6,
  },
  contextCardContainer: {
    marginBottom: 14,
  },
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
  listContent: {
    paddingBottom: 32,
    gap: 8,
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  noteTitleDefault: {
    color: '#94a3b8',
    fontSize: 13.5,
    fontWeight: '600',
  },
  noteContent: {
    color: '#e4e4e7',
    fontSize: 14,
    lineHeight: 20,
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
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  reminderPillText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  checkboxRowCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  checkboxText: {
    fontSize: 11.5,
    color: '#94a3b8',
    fontWeight: '600',
  },
  iconActionBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    borderWidth: 1,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#8e8e93',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
