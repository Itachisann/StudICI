import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_MODAL_BG } from '@/constants/theme';
import { NativeSheetModal } from './NativeSheetModal';
import {
  AlarmSettings,
  computeWeeklyAlarmPlans,
  DayAlarmPlan,
  isNativeAlarmsModuleAvailable,
  saveAlarmSettings,
  syncNativeAlarms,
} from '../utils/alarmSync';
import { minutesToTime, parseTimeToMinutes } from '../utils/trenitaliaApi';

interface AlarmsConfigModalProps {
  visible: boolean;
  initialSettings: AlarmSettings;
  onClose: () => void;
  onSaved: (settings: AlarmSettings, alarmsCount: number) => void;
}

const PRESET_MINUTES = [5, 10, 15, 20, 30, 45];

function AlarmsConfigForm({
  visible,
  initialSettings,
  onClose,
  onSaved,
}: AlarmsConfigModalProps) {
  const { theme } = useTheme();
  const [enabled, setEnabled] = useState<boolean>(initialSettings.enabled);
  const [minutesBefore, setMinutesBefore] = useState<number>(
    initialSettings.minutesBeforeDeparture ?? 10
  );
  const [basePlans, setBasePlans] = useState<DayAlarmPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    computeWeeklyAlarmPlans(initialSettings.minutesBeforeDeparture ?? 10)
      .then((plans) => {
        if (!cancelled) {
          setBasePlans(plans);
          setLoadingPlans(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingPlans(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialSettings.minutesBeforeDeparture]);

  // Ricalcola istantaneamente gli orari sveglia al variare di minutesBefore senza attendere la rete
  const livePlans = React.useMemo<DayAlarmPlan[]>(() => {
    return basePlans.map((plan) => {
      if (!plan.hasLesson || !plan.estimatedDepartureTime) return plan;
      const depMins = parseTimeToMinutes(plan.estimatedDepartureTime);
      const alarmTotalMins = (((depMins - minutesBefore) % 1440) + 1440) % 1440;
      return {
        ...plan,
        alarmTime: minutesToTime(alarmTotalMins),
        alarmHour: Math.floor(alarmTotalMins / 60),
        alarmMinute: alarmTotalMins % 60,
      };
    });
  }, [basePlans, minutesBefore]);

  const activeDaysCount = React.useMemo(
    () => livePlans.filter((p) => p.hasLesson).length,
    [livePlans]
  );

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updatedSettings = await saveAlarmSettings({
        enabled,
        minutesBeforeDeparture: minutesBefore,
      });
      const res = await syncNativeAlarms({
        force: true,
        settingsOverride: updatedSettings,
        tintColor: theme.primary,
      });

      if (!res.success && enabled) {
        Alert.alert('Attenzione', res.message);
      }

      onSaved(updatedSettings, res.alarmsCount);
      onClose();
    } catch (err: any) {
      Alert.alert(
        'Errore',
        err?.message || 'Impossibile aggiornare le sveglie native.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <NativeSheetModal
      visible={visible}
      onClose={onClose}
      title="Sveglie"
      backgroundColor={UNIFORM_MODAL_BG}
      rightActions={[
        {
          label: '',
          sfSymbol: 'checkmark',
          prominent: true,
          tintColor: theme.primary,
          disabled: saving,
          accessibilityLabel: 'Salva sveglie',
          onPress: handleSave,
        },
      ]}
    >
      <View collapsable={false} style={styles.root}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 1. Hero / Toggle Attivazione Sveglie */}
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View
                style={[
                  styles.iconCircle,
                  {
                    backgroundColor: theme.subtle,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Ionicons name="alarm-outline" size={22} color={theme.primary} />
              </View>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.cardTitle}>Sveglie automatiche</Text>
                <Text style={styles.cardSub}>
                  {enabled
                    ? `${activeDaysCount} ${activeDaysCount === 1 ? 'sveglia attiva' : 'sveglie attive'} sul treno ideale della prima lezione`
                    : 'Attiva per creare le sveglie native sui giorni di lezione'}
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: '#39393d', true: '#34c759' }}
                ios_backgroundColor="#39393d"
              />
            </View>
          </View>

          {/* 2. Scelta Anticipo rispetto alla partenza stimata */}
          <Text style={styles.sectionHeader}>ANTICIPO SULLA PARTENZA STIMATA</Text>
          <View style={[styles.card, !enabled && { opacity: 0.55 }]}>
            <Text style={styles.fieldExplanation}>
              Scegli quanto tempo prima della partenza stimata dall&apos;app (calcolata sul treno ideale della prima lezione) far suonare la sveglia:
            </Text>

            <View style={styles.presetGrid}>
              {PRESET_MINUTES.map((mins) => {
                const isSelected = minutesBefore === mins;
                return (
                  <TouchableOpacity
                    key={mins}
                    style={[
                      styles.presetChip,
                      isSelected && [
                        styles.presetChipActive,
                        {
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          shadowColor: theme.primary,
                        },
                      ],
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setMinutesBefore(mins)}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'time-outline'}
                      size={14}
                      color={isSelected ? '#ffffff' : '#8e8e93'}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && styles.presetChipTextActive,
                      ]}
                    >
                      {mins} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Stepper fine minuto per minuto */}
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                activeOpacity={0.7}
                onPress={() => setMinutesBefore((m) => Math.max(0, m - 1))}
              >
                <Ionicons name="remove" size={18} color="#ffffff" />
              </TouchableOpacity>

              <View
                style={[
                  styles.stepperValueBox,
                  {
                    backgroundColor: theme.subtle,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Ionicons
                  name="alarm-outline"
                  size={15}
                  color={theme.accent}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.stepperValueText, { color: theme.accent }]}>
                  {minutesBefore === 0
                    ? 'All’ora di partenza'
                    : `${minutesBefore} min prima`}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.stepperBtn}
                activeOpacity={0.7}
                onPress={() => setMinutesBefore((m) => Math.min(180, m + 1))}
              >
                <Ionicons name="add" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* 3. Riepilogo sveglie per ciascun giorno della settimana */}
          <Text style={styles.sectionHeader}>
            SVEGLIE GIORNALIERE ({activeDaysCount} GIORNI CON LEZIONE)
          </Text>
          <View style={[styles.card, { paddingVertical: 6 }, !enabled && { opacity: 0.55 }]}>
            {loadingPlans ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={styles.loadingText}>
                  Calcolo treni ideali e orari di partenza...
                </Text>
              </View>
            ) : (
              livePlans.map((plan, idx) => (
                <React.Fragment key={plan.dayIdx}>
                  {idx > 0 && <View style={styles.separator} />}
                  <View style={styles.dayRow}>
                    <View
                      style={[
                        styles.daySquircle,
                        plan.hasLesson
                          ? {
                              backgroundColor: theme.subtle,
                              borderColor: theme.border,
                            }
                          : {
                              backgroundColor: 'rgba(255,255,255,0.03)',
                              borderColor: 'rgba(255,255,255,0.06)',
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.daySquircleText,
                          { color: plan.hasLesson ? theme.accent : '#52525b' },
                        ]}
                      >
                        {plan.shortDayName}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                      <Text style={styles.dayTitleText} numberOfLines={1}>
                        {plan.hasLesson
                          ? `${plan.firstLessonSubject} (${plan.firstLessonStartTime})`
                          : `${plan.dayName} • Nessuna lezione`}
                      </Text>
                      {plan.hasLesson ? (
                        <Text style={styles.daySubText} numberOfLines={1}>
                          {`Partenza stimata ${plan.estimatedDepartureTime}${
                            plan.idealTrainNumber
                              ? ` • Treno ${plan.idealTrainNumber} (${plan.idealTrainTime})`
                              : ''
                          }`}
                        </Text>
                      ) : (
                        <Text style={styles.daySubTextMuted}>
                          Nessuna sveglia programmata
                        </Text>
                      )}
                    </View>

                    {plan.hasLesson && plan.alarmTime ? (
                      <View
                        style={[
                          styles.alarmTimeBadge,
                          {
                            backgroundColor: enabled ? theme.bg : '#27272a',
                            borderColor: enabled ? theme.primary : '#3f3f46',
                          },
                        ]}
                      >
                        <Ionicons
                          name="alarm"
                          size={13}
                          color={enabled ? '#ffffff' : '#a1a1aa'}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.alarmTimeText,
                            { color: enabled ? '#ffffff' : '#a1a1aa' },
                          ]}
                        >
                          {plan.alarmTime}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </React.Fragment>
              ))
            )}
          </View>
          <Text style={styles.footerNote}>
            L&apos;app crea una sveglia nativa per ogni giorno con lezione (calcolata sempre sull&apos;orario programmato ufficiale, incluso il giorno corrente) e la aggiorna automaticamente in background ad ogni accesso in caso di variazioni.
          </Text>

          {/* Info box sul funzionamento nativo iOS */}
          <View style={styles.infoBanner}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={theme.accent}
              style={{ marginTop: 1, marginRight: 10 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBannerTitle}>
                {isNativeAlarmsModuleAvailable()
                  ? 'Motore nativo iOS AlarmKit attivo'
                  : 'Sincronizzazione nativa Calendario iOS attiva'}
              </Text>
              <Text style={styles.infoBannerText}>
                {isNativeAlarmsModuleAvailable()
                  ? "Per policy di sicurezza Apple, nessuna app di terze parti può modificare in background l'elenco interno dell'app Orologio di sistema. StudICI utilizza il framework nativo iOS AlarmKit per programmare sveglie di sistema autonome (che suonano a schermo intero anche in modalità Silenzioso/Full Immersion) aggiornabili in background."
                  : "Per policy di sicurezza Apple, l'app Orologio di sistema non è modificabile in background da app terze. In questa build DevClient le sveglie vengono create sul Calendario nativo iOS («StudICI - Sveglie»); compilando una nuova build IPA verrà attivato anche il modulo nativo Swift StudICIAlarms (AlarmKit)."}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </NativeSheetModal>
  );
}

export function AlarmsConfigModal(props: AlarmsConfigModalProps) {
  if (!props.visible) return null;
  const formKey = `${props.initialSettings.enabled}_${props.initialSettings.minutesBeforeDeparture}`;
  return <AlarmsConfigForm key={formKey} {...props} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UNIFORM_MODAL_BG,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  cardSub: {
    color: '#8e8e93',
    fontSize: 12.5,
    marginTop: 2,
    lineHeight: 17,
  },
  sectionHeader: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 6,
  },
  fieldExplanation: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  presetChip: {
    flexGrow: 1,
    minWidth: '28%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  presetChipActive: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 4,
  },
  presetChipText: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueBox: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  stepperValueText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#8e8e93',
    fontSize: 13,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  daySquircle: {
    width: 42,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySquircleText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  dayTitleText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  daySubText: {
    color: '#a1a1aa',
    fontSize: 12,
    marginTop: 2,
  },
  daySubTextMuted: {
    color: '#52525b',
    fontSize: 12,
    marginTop: 2,
  },
  alarmTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  alarmTimeText: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  footerNote: {
    color: '#71717a',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
    marginHorizontal: 6,
  },
  infoBanner: {
    marginTop: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoBannerTitle: {
    color: '#e4e4e7',
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 3,
  },
  infoBannerText: {
    color: '#a1a1aa',
    fontSize: 11.5,
    lineHeight: 16,
  },
});
