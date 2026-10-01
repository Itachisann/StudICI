import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Tab } from '../utils/scraper';

const SAPIENZA_RED = '#822433';

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

    // 2. Estrazione Canale / Suddivisione
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

  // Se c'è più di un canale per quest'anno o se il canale ha un nome specifico, mostriamo la riga 2
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
      {/* ── Riga 1: Selezione Anno ── */}
      {uniqueYears.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.yearScroll}
          contentContainerStyle={styles.rowContainer}
        >
          {uniqueYears.map((year, i) => {
            const isYearActive = year === activeYear;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => handleSelectYear(year)}
                style={[styles.chip, isYearActive && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isYearActive && styles.chipTextActive]}>
                  {year}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Riga 2: Selezione Canale / Suddivisione (se presente) ── */}
      {showChannelRow && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.channelScroll}
          contentContainerStyle={styles.rowContainer}
        >
          {channelsForActiveYear.map((item, i) => {
            const isChannelActive = currentParsed?.tab.url === item.tab.url;
            const displayName = item.channel || item.tab.name;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => onSelectTab(item.tab)}
                style={[styles.chip, isChannelActive && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isChannelActive && styles.chipTextActive]}>
                  {displayName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
  },
  yearScroll: {
    maxHeight: 46,
    marginBottom: 8,
  },
  channelScroll: {
    maxHeight: 46,
    marginBottom: 6,
  },
  rowContainer: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  // Stile Pill (sia Anni che Canali)
  chip: {
    backgroundColor: '#242426',
    paddingHorizontal: 20,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333336',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: 'rgba(130, 36, 51, 0.45)',
    borderColor: SAPIENZA_RED,
  },
  chipText: {
    color: '#a1a1aa',
    fontWeight: '600',
    fontSize: 13.5,
  },
  chipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
