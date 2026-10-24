import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Tab } from '../utils/scraper';
import { useTheme } from '@/context/ThemeContext';
import { NativeActionButton } from './NativeActionButton';

export interface ParsedTabInfo {
  tab: Tab;
  year: string;
  channel: string;
}

export function parseTabHierarchy(tabs: Tab[]): ParsedTabInfo[] {
  return tabs.map(tab => {
    const raw = tab.name.trim();

    // 1. Estrazione Anno
    let year = '';
    const numMatch = raw.match(/(?:^|\b)(\d+)\s*[°^ª]?\s*anno\b/i);
    const romanMatch = raw.match(/(?:^|\b)(I|II|III|IV|V)\s+anno\b/i);
    const wordMatch = raw.match(/(?:^|\b)(primo|secondo|terzo|quarto|quinto)\s+anno\b/i);

    if (numMatch) {
      year = `${numMatch[1]}° Anno`;
    } else if (romanMatch) {
      const romanMap: Record<string, string> = { I: '1°', II: '2°', III: '3°', IV: '4°', V: '5°' };
      year = `${romanMap[romanMatch[1].toUpperCase()]} Anno`;
    } else if (wordMatch) {
      const wordMap: Record<string, string> = {
        primo: '1°',
        secondo: '2°',
        terzo: '3°',
        quarto: '4°',
        quinto: '5°'
      };
      year = `${wordMap[wordMatch[1].toLowerCase()]} Anno`;
    } else if (/magistrale/i.test(raw)) {
      year = 'Magistrale';
    } else {
      // Fallback: se inizia con un numero
      const firstNum = raw.match(/^(\d+)/);
      if (firstNum) {
        year = `${firstNum[1]}° Anno`;
      } else {
        year = raw.split(/[-:(]/)[0].trim() || 'Generale';
      }
    }

    // 2. Estrazione Canale / Suddivisione
    const withoutAcademicYear = raw.replace(/\b\d{4}[-/]\d{2,4}\b/g, '').replace(/A\.A\./gi, '').trim();

    let channel = '';

    // Controlla parentesi: es. "(A-L)", "(Canale 1)", "(M-Z)"
    const parenMatch = withoutAcademicYear.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const inside = parenMatch[1].trim();
      if (/^[a-z0-9\s-]+$/i.test(inside)) {
        channel = inside.toLowerCase().startsWith('canale') ? inside : `Canale ${inside}`;
      } else {
        channel = inside;
      }
    } else {
      // Controlla "canale X" o "canale A-K"
      const canalMatch = withoutAcademicYear.match(/canale\s*([a-zA-Z0-9\-_]+(?:\s*-\s*[a-zA-Z0-9\-_]+)?)/i);
      if (canalMatch) {
        channel = `Canale ${canalMatch[1].replace(/\s+/g, '')}`;
      } else {
        const canalRangeMatch = withoutAcademicYear.match(/\b([A-Za-z]\s*-\s*[A-Za-z])\b/i);
        if (canalRangeMatch) {
          channel = `Canale ${canalRangeMatch[1].replace(/\s+/g, '').toUpperCase()}`;
        }
      }
    }

    // Pulisci il nome canale se è identico all'anno
    if (channel.toLowerCase() === year.toLowerCase()) {
      channel = '';
    }

    return {
      tab,
      year,
      channel,
    };
  });
}

interface YearChannelSelectorProps {
  tabs: Tab[];
  selectedTab: Tab | null;
  onSelectTab: (tab: Tab) => void;
}

export function YearChannelSelector({ tabs, selectedTab, onSelectTab }: YearChannelSelectorProps) {
  const { theme } = useTheme();
  const parsedTabs = useMemo(() => parseTabHierarchy(tabs), [tabs]);

  // Lista di tutti gli anni unici ordinati
  const uniqueYears = useMemo(() => {
    const years: string[] = [];
    parsedTabs.forEach(p => {
      if (!years.includes(p.year)) {
        years.push(p.year);
      }
    });
    return years;
  }, [parsedTabs]);

  // Informazioni sul tab attualmente selezionato
  const currentParsed = useMemo(() => {
    if (!selectedTab) return parsedTabs[0] || null;
    return parsedTabs.find(p => p.tab.url === selectedTab.url) || parsedTabs[0] || null;
  }, [selectedTab, parsedTabs]);

  const activeYear = currentParsed ? currentParsed.year : (uniqueYears[0] || '');

  // Canali disponibili per l'anno attualmente selezionato
  const channelsForActiveYear = useMemo(() => {
    return parsedTabs.filter(p => p.year === activeYear);
  }, [parsedTabs, activeYear]);

  // Se c'è più di un canale per quest'anno o se il canale ha un nome specifico, mostriamo la riga 2 unificata
  const showChannelRow = useMemo(() => {
    if (channelsForActiveYear.length > 1) return true;
    if (channelsForActiveYear.length === 1 && channelsForActiveYear[0].channel.length > 0) return true;
    return false;
  }, [channelsForActiveYear]);


  const handleSelectYear = (year: string) => {
    const available = parsedTabs.filter(p => p.year === year);
    if (available.length === 0) return;

    // Cerca di mantenere lo stesso canale (es. Canale A-L) se esiste nel nuovo anno
    const sameChannel = available.find(
      p => currentParsed && p.channel && p.channel.toLowerCase() === currentParsed.channel.toLowerCase()
    );
    if (sameChannel) {
      onSelectTab(sameChannel.tab);
    } else {
      onSelectTab(available[0].tab);
    }
  };

  if (tabs.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* ── Riga 1: Selezione Anno (Pillole Staccate Callstack Liquid Glass) ── */}
      {uniqueYears.length > 1 && (
        uniqueYears.length <= 4 ? (
          <View style={styles.yearRowEqual}>
            {uniqueYears.map((year, i) => {
              const isYearActive = year === activeYear;
              return (
                <NativeActionButton
                  key={i}
                  label={year}
                  onPress={() => handleSelectYear(year)}
                  variant={isYearActive ? "filled" : "glass"}
                  glow={isYearActive}
                  glowColor={theme.primary}
                  accentColor={theme.primary}
                  style={styles.yearChipEqual}
                  pillStyle={
                    isYearActive
                      ? [
                          styles.yearPillBase,
                          styles.yearChipActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ]
                      : [
                          styles.yearPillBase,
                          {
                            backgroundColor: '#1c1c1e',
                            borderColor: '#2c2c2e',
                          },
                        ]
                  }
                  textStyle={[
                    styles.yearChipText,
                    isYearActive && styles.yearChipTextActive,
                  ]}
                />
              );
            })}
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.yearScroll}
            contentContainerStyle={styles.rowContainer}
          >
            {uniqueYears.map((year, i) => {
              const isYearActive = year === activeYear;
              return (
                <NativeActionButton
                  key={i}
                  label={year}
                  onPress={() => handleSelectYear(year)}
                  variant={isYearActive ? "filled" : "glass"}
                  glow={isYearActive}
                  glowColor={theme.primary}
                  accentColor={theme.primary}
                  style={[
                    styles.yearChip,
                    i === uniqueYears.length - 1 && { marginRight: 0 },
                  ]}
                  pillStyle={
                    isYearActive
                      ? [
                          styles.yearPillBase,
                          styles.yearChipActive,
                          {
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                          },
                        ]
                      : [
                          styles.yearPillBase,
                          {
                            backgroundColor: '#1c1c1e',
                            borderColor: '#2c2c2e',
                          },
                        ]
                  }
                  textStyle={[
                    styles.yearChipText,
                    isYearActive && styles.yearChipTextActive,
                  ]}
                />
              );
            })}
          </ScrollView>
        )
      )}

      {/* ── Riga 2: Selezione Canale (Segmented Control Track Capsule con glow Callstack solo sul canale attivo) ── */}
      {showChannelRow && (
        <View style={styles.channelContainer}>
          {channelsForActiveYear.length <= 3 ? (
            <View style={styles.segmentedControlTrack}>
              {channelsForActiveYear.map((item, i) => {
                const isChannelActive = currentParsed?.tab.url === item.tab.url;
                const displayName = item.channel || item.tab.name;
                return (
                  <View key={i} style={styles.segmentSlot}>
                    {isChannelActive ? (
                      <NativeActionButton
                        label={displayName}
                        onPress={() => onSelectTab(item.tab)}
                        variant="filled"
                        glow={true}
                        glowColor={theme.primary}
                        accentColor={theme.primary}
                        style={styles.segmentActionButton}
                        pillStyle={{
                          height: 30,
                          borderRadius: 15,
                          backgroundColor: theme.bg,
                          borderColor: theme.primary,
                          paddingHorizontal: 8,
                        }}
                        textStyle={styles.segmentTextActive}
                      />
                    ) : (
                      <TouchableOpacity
                        onPress={() => onSelectTab(item.tab)}
                        activeOpacity={0.7}
                        style={styles.segmentInactiveButton}
                      >
                        <Text style={styles.segmentText} numberOfLines={1}>
                          {displayName}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.channelScroll}
              contentContainerStyle={styles.rowContainer}
            >
              <View style={styles.segmentedControlTrackScrollable}>
                {channelsForActiveYear.map((item, i) => {
                  const isChannelActive = currentParsed?.tab.url === item.tab.url;
                  const displayName = item.channel || item.tab.name;
                  return (
                    <View key={i} style={styles.segmentSlotScrollable}>
                      {isChannelActive ? (
                        <NativeActionButton
                          label={displayName}
                          onPress={() => onSelectTab(item.tab)}
                          variant="filled"
                          glow={true}
                          glowColor={theme.primary}
                          accentColor={theme.primary}
                          style={styles.segmentActionButton}
                          pillStyle={{
                            height: 30,
                            borderRadius: 15,
                            backgroundColor: theme.bg,
                            borderColor: theme.primary,
                            paddingHorizontal: 12,
                          }}
                          textStyle={styles.segmentTextActive}
                        />
                      ) : (
                        <TouchableOpacity
                          onPress={() => onSelectTab(item.tab)}
                          activeOpacity={0.7}
                          style={styles.segmentInactiveButton}
                        >
                          <Text style={styles.segmentText} numberOfLines={1}>
                            {displayName}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  // Riga Anni a Larghezza Uguale (perfettamente simmetrica al container canali)
  yearRowEqual: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  yearChipEqual: {
    flex: 1,
    height: 34,
    borderRadius: 17,
  },
  yearPillBase: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearScroll: {
    maxHeight: 42,
    marginBottom: 8,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  channelScroll: {
    maxHeight: 42,
    width: '100%',
  },
  rowContainer: {
    flexGrow: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pillole Staccate Anno (per liste lunghe > 4)
  yearChip: {
    minWidth: 84,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
  },
  yearChipActive: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
    elevation: 6,
  },
  yearChipText: {
    color: '#a1a1aa',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    top: Platform.OS === 'ios' ? -0.5 : 0,
  },
  yearChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    top: Platform.OS === 'ios' ? -0.5 : 0,
  },

  // Container Canali (Identica larghezza e allineamento degli anni)
  channelContainer: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  // Segmented Capsule Track (Angoli arrotondati concentrici, nessuno sfondo squadrato)
  segmentedControlTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    padding: 3,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  segmentedControlTrackScrollable: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    padding: 3,
    alignSelf: 'center',
  },
  segmentSlot: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentSlotScrollable: {
    minWidth: 100,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActionButton: {
    width: '100%',
    height: 30,
    borderRadius: 15,
  },
  segmentInactiveButton: {
    width: '100%',
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#a1a1aa',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    top: Platform.OS === 'ios' ? -0.5 : 0,
  },
  segmentTextActive: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    top: Platform.OS === 'ios' ? -0.5 : 0,
  },
});
