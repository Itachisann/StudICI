import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Tab } from '../utils/scraper';
import { parseTabHierarchy } from './YearChannelSelector';
import { ChannelSegmentedSlider } from './ChannelSegmentedSlider';

const SAPIENZA_RED = '#822433';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === 'ios' && !isExpoGo;

export interface DefaultTabPickerProps {
  tabs: Tab[];
  initialTabUrl?: string | null;
  degreeName?: string;
  title?: string;
  subtitle?: string;
  confirmButtonText?: string;
  onConfirm: (tab: Tab) => void;
  onCancel?: () => void;
}

export function DefaultTabPicker({
  tabs,
  initialTabUrl,
  degreeName,
  title = 'Scegli Anno e Canale',
  subtitle = 'Verranno mostrati in automatico all\'apertura dell\'app.',
  confirmButtonText = 'Conferma e Inizia',
  onConfirm,
  onCancel,
}: DefaultTabPickerProps) {
  const parsedTabs = useMemo(() => parseTabHierarchy(tabs), [tabs]);

  // Lista degli anni unici
  const uniqueYears = useMemo(() => {
    const years: string[] = [];
    parsedTabs.forEach(p => {
      if (p.year && !years.includes(p.year)) {
        years.push(p.year);
      }
    });
    return years;
  }, [parsedTabs]);

  // Tab iniziale da cui dedurre anno e canale iniziali
  const initialParsed = useMemo(() => {
    if (initialTabUrl) {
      return parsedTabs.find(p => p.tab.url === initialTabUrl) || parsedTabs[0];
    }
    return parsedTabs[0];
  }, [initialTabUrl, parsedTabs]);

  const [selectedYear, setSelectedYear] = useState<string>(
    initialParsed?.year || uniqueYears[0] || ''
  );

  // Canali disponibili per l'anno correntemente selezionato
  const channelsForSelectedYear = useMemo(() => {
    return parsedTabs.filter(p => p.year === selectedYear);
  }, [parsedTabs, selectedYear]);

  const [selectedChannel, setSelectedChannel] = useState<string>(
    initialParsed?.channel || channelsForSelectedYear[0]?.channel || ''
  );

  // Tab attualmente risolto
  const activeTabInfo = useMemo(() => {
    const match = channelsForSelectedYear.find(p => p.channel === selectedChannel);
    return match || channelsForSelectedYear[0] || parsedTabs[0];
  }, [channelsForSelectedYear, selectedChannel, parsedTabs]);

  const handleSelectYear = (year: string) => {
    setSelectedYear(year);
    const available = parsedTabs.filter(p => p.year === year);
    if (available.length > 0) {
      // Prova a mantenere lo stesso canale se esiste nel nuovo anno
      const sameCh = available.find(p => p.channel && p.channel === selectedChannel);
      setSelectedChannel(sameCh ? sameCh.channel : available[0].channel);
    }
  };

  const handleSelectChannel = (channel: string) => {
    setSelectedChannel(channel);
  };

  const handleConfirm = () => {
    if (activeTabInfo?.tab) {
      onConfirm(activeTabInfo.tab);
    }
  };

  // Se c'è solo un tab in tutto il corso, non serve scegliere
  if (tabs.length === 0) return null;

  const showChannelSection = channelsForSelectedYear.length > 1;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Icon & Title */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="funnel" size={28} color="#ffffff" />
          </View>
          <Text style={styles.title}>{title}</Text>
          {degreeName ? (
            <Text style={styles.degreeTitle} numberOfLines={2}>
              {degreeName}
            </Text>
          ) : null}
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        {/* ── 1. Selezione Anno di Corso (se presenti più anni) ── */}
        {uniqueYears.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ANNO DI CORSO</Text>
            <View style={styles.chipsContainer}>
              {uniqueYears.map((year, idx) => {
                const isSelected = year === selectedYear;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    activeOpacity={0.7}
                    onPress={() => handleSelectYear(year)}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'calendar-outline'}
                      size={16}
                      color={isSelected ? '#ffffff' : '#8e8e93'}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                      {year}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── 2. Selezione Canale / Suddivisione (IPA: Segmented Control | Expo Go: Pill Centrate a Larghezza Uguale) ── */}
        {showChannelSection && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CANALE / SUDDIVISIONE</Text>
            {isNativeIos ? (
              <ChannelSegmentedSlider
                key={`picker-seg-${selectedYear}-${channelsForSelectedYear.length}`}
                items={channelsForSelectedYear.map(c => c.channel || c.tab.name)}
                selectedIndex={Math.max(
                  0,
                  channelsForSelectedYear.findIndex(c => (c.channel || '') === selectedChannel)
                )}
                onSelectIndex={(idx) => {
                  if (channelsForSelectedYear[idx]) {
                    handleSelectChannel(channelsForSelectedYear[idx].channel);
                  }
                }}
              />
            ) : (
              <View style={styles.channelRowEqual}>
                {channelsForSelectedYear.map((item, idx) => {
                  const isSelected = (item.channel || '') === selectedChannel;
                  const displayName = item.channel || item.tab.name;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.chipEqual, isSelected && styles.chipActive]}
                      activeOpacity={0.7}
                      onPress={() => handleSelectChannel(item.channel)}
                    >
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'people-outline'}
                        size={15}
                        color={isSelected ? '#ffffff' : '#8e8e93'}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={[styles.chipText, isSelected && styles.chipTextActive]} numberOfLines={1}>
                        {displayName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── 3. Card Anteprima Selezione ── */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryIconBox}>
            <Ionicons name="time" size={24} color={SAPIENZA_RED} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryOverline}>ORARIO PREDEFINITO</Text>
            <Text style={styles.summaryValue}>
              {selectedYear}
              {selectedChannel ? ` · ${selectedChannel}` : ''}
            </Text>
            <Text style={styles.summaryOriginalName} numberOfLines={1}>
              Foglio: {activeTabInfo?.tab.name}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Footer con Pulsante Azione ── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.confirmButton}
          activeOpacity={0.8}
          onPress={handleConfirm}
        >
          <Text style={styles.confirmButtonText}>{confirmButtonText}</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 8 }} />
        </TouchableOpacity>

        {onCancel && (
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Annulla</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 110,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginBottom: 4,
  },
  degreeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: SAPIENZA_RED,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 18,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.8,
    marginBottom: 12,
    textAlign: 'center',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  // Stile Pill Anno e Canale (snello, staccato e centrato)
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 15,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: 'rgba(130, 36, 51, 0.45)',
    borderColor: SAPIENZA_RED,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // Canale Expo Go a Larghezza Uguale
  channelRowEqual: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 8,
  },
  chipEqual: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 8,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    justifyContent: 'center',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    marginTop: 8,
  },
  summaryIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(130, 36, 51, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(130, 36, 51, 0.4)',
  },
  summaryOverline: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#8e8e93',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  summaryOriginalName: {
    fontSize: 12,
    color: '#a1a1aa',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 28,
    backgroundColor: 'rgba(17, 17, 17, 0.94)',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  confirmButton: {
    backgroundColor: SAPIENZA_RED,
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
  },
  cancelButtonText: {
    color: '#8e8e93',
    fontSize: 14,
    fontWeight: '500',
  },
});
