import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { NativeSheetModal } from './NativeSheetModal';
import { NativeActionButton } from './NativeActionButton';
import { useTheme } from '../context/ThemeContext';
import { UNIFORM_MODAL_BG } from '../constants/theme';
import { ClassEvent, ScheduleData } from '../utils/scraper';
import {
  ManualClassEvent,
  isManualEventActiveOnDate,
  manualEventToClassEvent,
} from '../utils/manualEvents';
import {
  AttendanceRecord,
  toggleAttendanceForDate,
  batchSetAttendance,
  BatchAttendanceItem,
} from '../utils/attendance';
import {
  getSubjectColor,
  getManualSubjectColor,
} from '../utils/subjectColors';

interface PastAttendanceModalProps {
  visible: boolean;
  onClose: () => void;
  schedule: ScheduleData | null;
  manualEvents: ManualClassEvent[];
  attendanceRecords: AttendanceRecord[];
  degreeUrl?: string | null;
  tabUrl?: string;
}

type SelectionMode = 'single' | 'range';

const DAYS_FULL = ['LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA'];
const MONTHS_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

function formatDateParts(inputDate: Date) {
  const date = new Date(inputDate);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const displayDate = `${date.getDate()} ${MONTHS_IT[date.getMonth()]} ${yyyy}`;
  const jsDay = date.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Lun ... 6=Dom
  const dayName = DAYS_FULL[dayIndex] || 'GIORNO';
  return { date, dateStr, displayDate, dayIndex, dayName };
}

// Settimana Scorsa: Lunedì - Venerdì della settimana precedente
function getLastWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const jsDay = now.getDay();
  const daysSinceThisMon = jsDay === 0 ? 6 : jsDay - 1;

  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceThisMon - 7);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 4); // Venerdì
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// 2 Settimane Fa: Lunedì - Venerdì di 2 settimane fa
function getTwoWeeksAgoRange(): { start: Date; end: Date } {
  const now = new Date();
  const jsDay = now.getDay();
  const daysSinceThisMon = jsDay === 0 ? 6 : jsDay - 1;

  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceThisMon - 14);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Questa Settimana: Lunedì di questa settimana fino a oggi
function getThisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const jsDay = now.getDay();
  const daysSinceThisMon = jsDay === 0 ? 6 : jsDay - 1;

  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceThisMon);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Ultimi 7 Giorni: da 7 giorni fa a oggi
function getLast7DaysRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function PastAttendanceModal({
  visible,
  onClose,
  schedule,
  manualEvents,
  attendanceRecords,
  degreeUrl,
  tabUrl,
}: PastAttendanceModalProps) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<SelectionMode>('single');

  // Modalità Singola: default ieri
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  });

  // Modalità Range: default settimana scorsa (Lun - Ven)
  const [startDate, setStartDate] = useState<Date>(() => getLastWeekRange().start);
  const [endDate, setEndDate] = useState<Date>(() => getLastWeekRange().end);

  // Preset rapido attivo per intervallo (default: settimana scorsa)
  const [activeRangePreset, setActiveRangePreset] = useState<
    'lastWeek' | 'twoWeeksAgo' | 'thisWeek' | 'last7Days' | null
  >('lastWeek');

  // Preset rapido attivo per data singola
  const [activeSinglePreset, setActiveSinglePreset] = useState<number | null>(null);

  // Informazioni data singola
  const singleDateInfo = useMemo(() => formatDateParts(selectedDate), [selectedDate]);

  // Helper per ottenere le lezioni di un giorno specifico
  const getClassesForDate = useCallback(
    (dayIndex: number, dateStr: string): ClassEvent[] => {
      if (dayIndex >= 5) return []; // Weekend
      const scraped = schedule?.days[dayIndex] || [];
      const manuals = (manualEvents || [])
        .filter(
          (e) =>
            e.dayIndex === dayIndex &&
            (!e.tabUrl || !tabUrl || e.tabUrl === tabUrl) &&
            isManualEventActiveOnDate(e, dateStr)
        )
        .map(manualEventToClassEvent);

      return [...scraped, ...manuals].sort((a, b) =>
        a.startTime.localeCompare(b.startTime)
      );
    },
    [schedule, manualEvents, tabUrl]
  );

  // Lezioni per data singola
  const singleDayClasses = useMemo(() => {
    return getClassesForDate(singleDateInfo.dayIndex, singleDateInfo.dateStr);
  }, [getClassesForDate, singleDateInfo.dayIndex, singleDateInfo.dateStr]);

  // Calcolo giorni nell'intervallo per modalità range (clonando ogni data in modo immutabile!)
  const rangeDays = useMemo(() => {
    if (mode !== 'range') return [];
    const days = [];
    const curr = new Date(startDate);
    curr.setHours(0, 0, 0, 0);
    const stop = new Date(endDate);
    stop.setHours(23, 59, 59, 999);

    let count = 0;
    while (curr <= stop && count < 31) {
      const dayDate = new Date(curr); // CLONE INDIPENDENTE!
      const parts = formatDateParts(dayDate);
      const classes = getClassesForDate(parts.dayIndex, parts.dateStr);

      days.push({
        ...parts,
        date: dayDate,
        classes,
      });

      curr.setDate(curr.getDate() + 1);
      count++;
    }
    return days;
  }, [mode, startDate, endDate, getClassesForDate]);

  // Giorni con lezioni nell'intervallo
  const rangeDaysWithClasses = useMemo(() => {
    return rangeDays.filter((d) => d.classes.length > 0);
  }, [rangeDays]);

  // Statistiche presenze dell'intervallo
  const { totalRangeClasses, attendedRangeClasses } = useMemo(() => {
    let total = 0;
    let attended = 0;
    rangeDays.forEach((day) => {
      day.classes.forEach((cls) => {
        total++;
        const isPres = attendanceRecords.some(
          (r) =>
            r.date === day.dateStr &&
            r.subject.trim().toLowerCase() === cls.subject.trim().toLowerCase() &&
            r.startTime === cls.startTime
        );
        if (isPres) attended++;
      });
    });
    return { totalRangeClasses: total, attendedRangeClasses: attended };
  }, [rangeDays, attendanceRecords]);

  // Toggle presenza
  const handleToggle = async (
    cls: ClassEvent,
    dateStr: string,
    displayDate: string,
    dayIndex: number,
    dayName: string
  ) => {
    try {
      await toggleAttendanceForDate(
        dateStr,
        displayDate,
        dayIndex,
        dayName,
        cls,
        degreeUrl || undefined
      );
    } catch (err) {
      console.warn('Errore toggle presenza passata:', err);
    }
  };

  // Navigazione rapida data singola
  const handleOffsetSingleDays = (days: number) => {
    setActiveSinglePreset(days);
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + days);
    const today = new Date();
    if (next > today) return;
    setSelectedDate(next);
  };

  // Preset rapidi per range
  const handleSetRangePreset = (type: 'lastWeek' | 'twoWeeksAgo' | 'thisWeek' | 'last7Days') => {
    setActiveRangePreset(type);
    if (type === 'lastWeek') {
      const { start, end } = getLastWeekRange();
      setStartDate(start);
      setEndDate(end);
    } else if (type === 'twoWeeksAgo') {
      const { start, end } = getTwoWeeksAgoRange();
      setStartDate(start);
      setEndDate(end);
    } else if (type === 'thisWeek') {
      const { start, end } = getThisWeekRange();
      setStartDate(start);
      setEndDate(end);
    } else if (type === 'last7Days') {
      const { start, end } = getLast7DaysRange();
      setStartDate(start);
      setEndDate(end);
    }
  };

  // Batch toggle tutte nel range simultaneamente in memoria e storage
  const handleBatchToggleRange = async () => {
    const shouldMarkAll = attendedRangeClasses < totalRangeClasses;
    const items: BatchAttendanceItem[] = [];

    rangeDays.forEach((day) => {
      day.classes.forEach((cls) => {
        items.push({
          dateStr: day.dateStr,
          displayDate: day.displayDate,
          dayIndex: day.dayIndex,
          dayName: day.dayName,
          cls,
        });
      });
    });

    if (items.length === 0) return;

    try {
      await batchSetAttendance(items, shouldMarkAll, degreeUrl || undefined);
    } catch (err) {
      console.warn('Errore batch toggle range:', err);
    }
  };

  // Renderer comune per una card lezione con il colore deterministico della materia
  const renderClassCard = (
    cls: ClassEvent,
    dateStr: string,
    displayDate: string,
    dayIndex: number,
    dayName: string,
    keySuffix: string
  ) => {
    const subjectColor = cls.isManual
      ? getManualSubjectColor(cls.subject)
      : getSubjectColor(cls.subject);

    const isAttended = attendanceRecords.some(
      (r) =>
        r.date === dateStr &&
        r.subject.trim().toLowerCase() === cls.subject.trim().toLowerCase() &&
        r.startTime === cls.startTime
    );

    return (
      <TouchableOpacity
        key={`${dateStr}-${cls.subject}-${cls.startTime}-${keySuffix}`}
        style={[
          styles.classCard,
          isAttended && {
            borderColor: subjectColor,
            backgroundColor: `${subjectColor}15`,
          },
        ]}
        activeOpacity={0.72}
        onPress={() => handleToggle(cls, dateStr, displayDate, dayIndex, dayName)}
      >
        {/* Barra laterale del colore della materia */}
        <View
          style={[
            styles.subjectColorBar,
            { backgroundColor: subjectColor },
          ]}
        />

        {/* Colonna Orario */}
        <View style={styles.timeColumn}>
          <Text style={styles.startTimeText}>{cls.startTime}</Text>
          <View
            style={[
              styles.durationBadge,
              { backgroundColor: `${subjectColor}20` },
            ]}
          >
            <Text style={[styles.durationBadgeText, { color: subjectColor }]}>
              {cls.duration || 2}h
            </Text>
          </View>
          <Text style={styles.endTimeText}>{cls.endTime}</Text>
        </View>

        {/* Dettagli Lezione */}
        <View style={styles.classDetails}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.subjectText,
                isAttended && { color: '#ffffff' },
              ]}
              numberOfLines={2}
            >
              {cls.subject?.toUpperCase()}
            </Text>
            {cls.isManual && (
              <View style={styles.manualBadge}>
                <Text style={styles.manualBadgeText}>MANUALE</Text>
              </View>
            )}
          </View>

          <View style={styles.metaRow}>
            {cls.room ? (
              <View style={styles.roomTag}>
                <Ionicons
                  name="location-outline"
                  size={12}
                  color={subjectColor}
                  style={{ marginRight: 3 }}
                />
                <Text style={styles.roomTagText} numberOfLines={1}>
                  {cls.room}
                </Text>
              </View>
            ) : null}

            {cls.teacher ? (
              <View style={styles.teacherTag}>
                <Ionicons
                  name="person-outline"
                  size={11}
                  color="#94a3b8"
                  style={{ marginRight: 3 }}
                />
                <Text style={styles.teacherTagText} numberOfLines={1}>
                  {cls.teacher}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Pulsante / Spunta Presenza */}
        <View style={styles.checkWrapper}>
          {isAttended ? (
            <View style={styles.checkCircleAttended}>
              <Ionicons name="checkmark" size={16} color="#ffffff" />
            </View>
          ) : (
            <View style={styles.checkCircleEmpty} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Presenze passate"
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'checkmark',
          tintColor: theme.primary,
          prominent: true,
          accessibilityLabel: 'Fine',
          dismissOnPress: true,
          onPress: onClose,
        },
      ]}
    >
      <View collapsable={false} style={{ flex: 1, backgroundColor: UNIFORM_MODAL_BG }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        {/* ── 1. SEGMENTED CONTROL NATIVO: DATA SINGOLA vs INTERVALLO ── */}
        <View style={styles.segmentedWrapper}>
          <SegmentedControl
            values={['Data singola', 'Intervallo date']}
            selectedIndex={mode === 'single' ? 0 : 1}
            onChange={(e) => {
              const idx = e.nativeEvent.selectedSegmentIndex;
              setMode(idx === 0 ? 'single' : 'range');
            }}
            appearance="dark"
            tintColor={theme.primary}
            style={styles.nativeSegmentedControl}
          />
        </View>

        {/* ── 2. SELETTORE DATA / DATE CON LAYOUT SPAZIATO SENZA SOVRAPPOSIZIONI ── */}
        {mode === 'single' ? (
          /* Card Data Singola */
          <View style={styles.pickerSectionCard}>
            <View style={styles.singlePickerTopRow}>
              <View style={styles.singlePickerLabelWrapper}>
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={theme.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.pickerInfoLabel}>DATA SELEZIONATA</Text>
              </View>
              <View style={styles.singleNativePickerBox}>
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="compact"
                  locale="it_IT"
                  themeVariant="dark"
                  accentColor={theme.primary}
                  maximumDate={new Date()}
                  style={styles.pickerNativeControl}
                  onValueChange={(event: any) => {
                    setActiveSinglePreset(null);
                    const ts = event?.nativeEvent?.timestamp;
                    if (ts) {
                      const d = new Date(ts);
                      if (!isNaN(d.getTime())) setSelectedDate(d);
                    }
                  }}
                />
              </View>
            </View>

            <View style={styles.singlePickerDateRow}>
              <Text style={styles.singleDayNameText}>{singleDateInfo.dayName}</Text>
              <Text style={styles.singleDisplayDateText}>{singleDateInfo.displayDate}</Text>
            </View>

            {/* Scorciatoie Rapide Data Singola */}
            <View style={styles.shortcutsRow}>
              {[
                { label: '-1 giorno', days: -1, icon: 'chevron-back' },
                { label: '-1 settimana', days: -7, icon: 'calendar-outline' },
                { label: '-2 settimane', days: -14, icon: 'calendar-outline' },
              ].map((p) => {
                const isSelected = activeSinglePreset === p.days;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[
                      styles.shortcutChip,
                      isSelected && [
                        styles.shortcutChipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    onPress={() => handleOffsetSingleDays(p.days)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : (p.icon as any)}
                      size={12}
                      color={isSelected ? theme.accent : '#8e8e93'}
                      style={{ marginRight: 3 }}
                    />
                    <Text
                      style={[
                        styles.shortcutChipText,
                        isSelected && { color: theme.accent, fontWeight: '700' },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : (
          /* Card Intervallo Date: layout pulito a 2 colonne affiancate perfettamente allineate */
          <View style={styles.pickerSectionCard}>
            <View style={styles.rangeTopRow}>
              <View style={styles.rangeLabelWrapper}>
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={theme.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.pickerInfoLabel}>INTERVALLO DATE SELEZIONATO</Text>
              </View>
            </View>

            <View style={styles.rangeColumnsRow}>
              {/* Box DAL */}
              <View style={styles.rangeColumnBox}>
                <Text style={styles.rangeColumnTitle}>DAL (INIZIO)</Text>
                <View style={styles.rangeNativePickerBox}>
                  <DateTimePicker
                    value={startDate}
                    mode="date"
                    display="compact"
                    locale="it_IT"
                    themeVariant="dark"
                    accentColor={theme.primary}
                    maximumDate={endDate < new Date() ? endDate : new Date()}
                    style={styles.pickerNativeControl}
                    onValueChange={(event: any) => {
                      setActiveRangePreset(null);
                      const ts = event?.nativeEvent?.timestamp;
                      if (ts) {
                        const d = new Date(ts);
                        if (!isNaN(d.getTime())) {
                          setStartDate(d);
                          if (d > endDate) setEndDate(d);
                        }
                      }
                    }}
                  />
                </View>
              </View>

              {/* Freccia centrale di intervallo perfettamente allineata all'altezza dei pickers */}
              <View style={styles.rangeArrowWrapper}>
                <Ionicons name="arrow-forward" size={16} color="#94a3b8" />
              </View>

              {/* Box AL */}
              <View style={styles.rangeColumnBox}>
                <Text style={styles.rangeColumnTitle}>AL (FINE)</Text>
                <View style={styles.rangeNativePickerBox}>
                  <DateTimePicker
                    value={endDate}
                    mode="date"
                    display="compact"
                    locale="it_IT"
                    themeVariant="dark"
                    accentColor={theme.primary}
                    minimumDate={startDate}
                    maximumDate={new Date()}
                    style={styles.pickerNativeControl}
                    onValueChange={(event: any) => {
                      setActiveRangePreset(null);
                      const ts = event?.nativeEvent?.timestamp;
                      if (ts) {
                        const d = new Date(ts);
                        if (!isNaN(d.getTime())) {
                          setEndDate(d);
                          if (d < startDate) setStartDate(d);
                        }
                      }
                    }}
                  />
                </View>
              </View>
            </View>

            {/* Anteprima Intervallo Completo su riga orizzontale dedicata */}
            <View style={styles.rangeDatePreviewRow}>
              <Text style={styles.rangeDatePreviewText}>
                {formatDateParts(startDate).displayDate} — {formatDateParts(endDate).displayDate}
              </Text>
            </View>

            {/* Scorciatoie Rapide Intervallo */}
            <View style={styles.shortcutsRow}>
              {[
                { label: 'Settimana scorsa', key: 'lastWeek' as const },
                { label: '2 settimane fa', key: 'twoWeeksAgo' as const },
                { label: 'Questa settimana', key: 'thisWeek' as const },
                { label: 'Ultimi 7 giorni', key: 'last7Days' as const },
              ].map((p) => {
                const isSelected = activeRangePreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[
                      styles.shortcutChip,
                      isSelected && [
                        styles.shortcutChipActive,
                        {
                          backgroundColor: `${theme.primary}25`,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    onPress={() => handleSetRangePreset(p.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'calendar-outline'}
                      size={12}
                      color={isSelected ? theme.accent : '#8e8e93'}
                      style={{ marginRight: 3 }}
                    />
                    <Text
                      style={[
                        styles.shortcutChipText,
                        isSelected && { color: theme.accent, fontWeight: '700' },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── 3. AZIONI CALL STACK PER BATCH PRESENZE (INTERVALLO) ── */}
        {mode === 'range' && totalRangeClasses > 0 && (
          <View style={styles.callstackActionSection}>
            <View style={styles.rangeStatsRow}>
              <Ionicons name="calendar" size={13} color="#94a3b8" style={{ marginRight: 5 }} />
              <Text style={styles.rangeStatsText}>
                {rangeDaysWithClasses.length} giorni con lezioni · {attendedRangeClasses}/{totalRangeClasses} presenze registrate
              </Text>
            </View>

            <NativeActionButton
              label={
                attendedRangeClasses === totalRangeClasses
                  ? "Deseleziona tutte le presenze"
                  : "Segna tutte le presenze"
              }
              onPress={handleBatchToggleRange}
              variant={attendedRangeClasses === totalRangeClasses ? "glass" : "filled"}
              accentColor={attendedRangeClasses === totalRangeClasses ? "#71717a" : theme.primary}
              glow={true}
              glowColor={
                attendedRangeClasses === totalRangeClasses
                  ? "rgba(148, 163, 184, 0.45)"
                  : undefined
              }
              icon={
                <Ionicons
                  name={
                    attendedRangeClasses === totalRangeClasses
                      ? "close-circle-outline"
                      : "checkmark-done"
                  }
                  size={17}
                  color="#ffffff"
                />
              }
              style={{
                height: 44,
                borderRadius: 22,
                marginTop: 2,
              }}
              pillStyle={{
                height: 44,
                borderRadius: 22,
                backgroundColor:
                  attendedRangeClasses === totalRangeClasses
                    ? "rgba(113, 113, 122, 0.22)"
                    : theme.primary,
                borderColor:
                  attendedRangeClasses === totalRangeClasses
                    ? "rgba(148, 163, 184, 0.35)"
                    : "transparent",
                borderWidth: attendedRangeClasses === totalRangeClasses ? 1 : 0,
              }}
              textStyle={{
                fontSize: 14,
                fontWeight: '700',
                color: '#ffffff',
              }}
            />
          </View>
        )}

        {/* ── 4. LISTA LEZIONI PROGRAMMATE ── */}
        {mode === 'single' ? (
          <>
            <View style={styles.listSectionHeader}>
              <Text style={styles.listSectionTitle}>
                LEZIONI DEL GIORNO ({singleDayClasses.length})
              </Text>
              <Text style={styles.listSectionSub}>
                Tocca per segnare o togliere la presenza
              </Text>
            </View>

            {singleDateInfo.dayIndex >= 5 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="cafe-outline" size={30} color="#64748b" />
                <Text style={styles.emptyCardTitle}>Fine settimana</Text>
                <Text style={styles.emptyCardSub}>
                  Nessuna lezione programmata di {singleDateInfo.dayName.toLowerCase()}.
                </Text>
              </View>
            ) : singleDayClasses.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-clear-outline" size={30} color="#64748b" />
                <Text style={styles.emptyCardTitle}>Nessuna Lezione</Text>
                <Text style={styles.emptyCardSub}>
                  Nessun orario di lezione presente per questo giorno.
                </Text>
              </View>
            ) : (
              singleDayClasses.map((cls, idx) =>
                renderClassCard(
                  cls,
                  singleDateInfo.dateStr,
                  singleDateInfo.displayDate,
                  singleDateInfo.dayIndex,
                  singleDateInfo.dayName,
                  String(idx)
                )
              )
            )}
          </>
        ) : (
          /* Modalità Intervallo Date: Raggruppamento per Giorno */
          <>
            {rangeDaysWithClasses.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-clear-outline" size={30} color="#64748b" />
                <Text style={styles.emptyCardTitle}>Nessuna Lezione nel Periodo</Text>
                <Text style={styles.emptyCardSub}>
                  Nessun orario di lezione programmato nell&apos;intervallo selezionato.
                </Text>
              </View>
            ) : (
              rangeDaysWithClasses.map((day) => {
                const dayAttended = day.classes.filter((cls) =>
                  attendanceRecords.some(
                    (r) =>
                      r.date === day.dateStr &&
                      r.subject.trim().toLowerCase() === cls.subject.trim().toLowerCase() &&
                      r.startTime === cls.startTime
                  )
                ).length;
                const isAllDayAttended =
                  day.classes.length > 0 && dayAttended === day.classes.length;

                return (
                  <View key={day.dateStr} style={styles.dayGroupBlock}>
                    {/* Header Giorno dell'Intervallo con data calcolata esatta */}
                    <View style={styles.dayGroupHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dayGroupTitle}>
                          {day.dayName} · {day.date.getDate()}{' '}
                          {MONTHS_IT[day.date.getMonth()].slice(0, 3).toUpperCase()}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.dayGroupBadge,
                          isAllDayAttended
                            ? {
                                backgroundColor: 'rgba(16, 185, 129, 0.18)',
                                borderColor: 'rgba(16, 185, 129, 0.4)',
                              }
                            : {
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                borderColor: 'rgba(255, 255, 255, 0.1)',
                              },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayGroupBadgeText,
                            isAllDayAttended
                              ? { color: '#34d399' }
                              : { color: '#94a3b8' },
                          ]}
                        >
                          {dayAttended}/{day.classes.length} presenze
                        </Text>
                      </View>
                    </View>

                    {/* Lezioni del giorno */}
                    {day.classes.map((cls, idx) =>
                      renderClassCard(
                        cls,
                        day.dateStr,
                        day.displayDate,
                        day.dayIndex,
                        day.dayName,
                        String(idx)
                      )
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
        </ScrollView>
      </View>
    </NativeSheetModal>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 90,
  },

  /* Segmented Control Nativo */
  segmentedWrapper: {
    marginBottom: 12,
  },
  nativeSegmentedControl: {
    height: 36,
  },

  /* Card Sezione Data */
  pickerSectionCard: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    marginBottom: 14,
  },

  /* Riga Data Singola */
  singlePickerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  singlePickerLabelWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  singlePickerDateRow: {
    paddingBottom: 10,
  },
  pickerInfoLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.6,
  },
  singleDayNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  singleDisplayDateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 1,
  },
  singleNativePickerBox: {
    width: 130,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Colonne Intervallo Date */
  rangeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rangeLabelWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rangeColumnsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  rangeColumnBox: {
    flex: 1,
    alignItems: 'center',
  },
  rangeColumnTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.6,
    marginBottom: 6,
    textAlign: 'center',
  },
  rangeDatePreviewRow: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  rangeDatePreviewText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
  },
  rangeNativePickerBox: {
    width: 130,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeArrowWrapper: {
    height: 36,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerNativeControl: {
    width: 130,
    height: 36,
  },

  /* Scorciatoie Orizzontali */
  shortcutsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  shortcutChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  shortcutChipActive: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  shortcutChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#94a3b8',
  },

  /* Call Stack Action Section (Intervallo) - Trasparente senza bordino scuro esterno */
  callstackActionSection: {
    marginTop: 2,
    marginBottom: 16,
  },
  rangeStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  rangeStatsText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },

  /* Header Sezione Lista */
  listSectionHeader: {
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  listSectionTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.6,
  },
  listSectionSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },

  /* Raggruppamento Giorni Intervallo */
  dayGroupBlock: {
    marginBottom: 16,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  dayGroupTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#e2e8f0',
    letterSpacing: 0.5,
  },
  dayGroupBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  dayGroupBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },

  /* Card Lezione */
  classCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 8,
    overflow: 'hidden',
  },
  subjectColorBar: {
    width: 4,
    height: 38,
    borderRadius: 2,
    marginRight: 10,
  },
  timeColumn: {
    alignItems: 'center',
    width: 46,
  },
  startTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  endTimeText: {
    fontSize: 10.5,
    color: '#94a3b8',
  },
  durationBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginVertical: 1.5,
  },
  durationBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  classDetails: {
    flex: 1,
    marginLeft: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subjectText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
    flexShrink: 1,
    lineHeight: 17,
  },
  manualBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  manualBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#f59e0b',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 3,
  },
  roomTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomTagText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  teacherTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teacherTagText: {
    fontSize: 10.5,
    color: '#94a3b8',
  },
  checkWrapper: {
    marginLeft: 10,
  },
  checkCircleEmpty: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    backgroundColor: '#27272a',
  },
  checkCircleAttended: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },

  /* Empty State */
  emptyCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 4,
  },
  emptyCardTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 8,
  },
  emptyCardSub: {
    fontSize: 12,
    color: '#8e8e93',
    textAlign: 'center',
    marginTop: 3,
    lineHeight: 17,
  },
});
