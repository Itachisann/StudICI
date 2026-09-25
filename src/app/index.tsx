import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { fetchTabs, fetchSchedule, Tab } from '../utils/scraper';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SAPIENZA_RED = '#822433';

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      if (storedUrl && storedUrl !== degreeUrl) {
        setDegreeUrl(storedUrl);
        const fetchedTabs = await fetchTabs(storedUrl);
        setTabs(fetchedTabs);
        if (fetchedTabs.length > 0) {
          setSelectedTab(fetchedTabs[0]);
          const data = await fetchSchedule(fetchedTabs[0].url);
          setScheduleData(data);
        }
      } else if (!storedUrl) {
        setDegreeUrl(null);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const selectTab = async (tab: Tab) => {
    setSelectedTab(tab);
    setLoading(true);
    const data = await fetchSchedule(tab.url);
    setScheduleData(data);
    setLoading(false);
  };

  const openMapForClass = (text: string) => {
    // Cerchiamo "Aula X" o "AULA X" o "RM002" etc.
    const aulaMatch = text.match(/Aula\s*[a-zA-Z0-9]+/i) || text.match(/RM\d+/i);
    if (aulaMatch) {
      const query = encodeURIComponent(`Sapienza Università di Roma ${aulaMatch[0]}`);
      const url = `http://maps.apple.com/?q=${query}`;
      Linking.openURL(url).catch(err => console.error("Couldn't open maps", err));
    }
  };

  if (!degreeUrl && !loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centerContainer}>
          <Ionicons name="school" size={80} color={SAPIENZA_RED} style={{ marginBottom: 20 }} />
          <Text style={styles.welcomeText}>Benvenuto</Text>
          <Text style={styles.subText}>Configura il tuo corso di laurea per iniziare.</Text>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.primaryButtonText}>Scegli Corso</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.largeTitle}>Orario</Text>

      {loading ? (
        <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 100 }} />
      ) : (
        <>
          <View style={styles.segmentedControlContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentedControl}>
              {tabs.map((tab, i) => {
                const isActive = selectedTab?.url === tab.url;
                return (
                  <TouchableOpacity key={i} onPress={() => selectTab(tab)} style={[styles.segment, isActive && styles.segmentActive]}>
                    <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                      {tab.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView style={styles.scheduleContainer} contentContainerStyle={{ paddingBottom: 100, paddingTop: 10 }}>
            {scheduleData.map((row, i) => {
              if (row.length < 3 || !row[0]) return null;
              return (
                <View key={i} style={styles.card}>
                  <Text style={styles.timeText}>{row[0]}</Text>
                  <View style={styles.cardContent}>
                    {row.slice(1).map((cell, j) => {
                      if (!cell) return null;
                      const hasAula = /Aula\s*[a-zA-Z0-9]+/i.test(cell) || /RM\d+/i.test(cell);
                      return (
                        <TouchableOpacity key={j} activeOpacity={hasAula ? 0.7 : 1} onPress={() => hasAula && openMapForClass(cell)}>
                          <View style={styles.classItem}>
                            <View style={styles.classDot} />
                            <Text style={styles.cardText}>{cell}</Text>
                            {hasAula && (
                              <Ionicons name="location" size={16} color={SAPIENZA_RED} style={{ marginLeft: 6 }} />
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent', // Eredita il nero da _layout
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#ffffff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subText: {
    fontSize: 16,
    color: '#8e8e93', // iOS gray
    textAlign: 'center',
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: '#1c1c1e', // Dark mode button
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginRight: 10,
  },
  segmentedControlContainer: {
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  segmentedControl: {
    backgroundColor: '#1c1c1e', // Sfondo scuro segmentato
    borderRadius: 8,
    padding: 2,
    flexDirection: 'row',
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentActive: {
    backgroundColor: '#3a3a3c', // Highlight grigio iOS
  },
  segmentText: {
    color: '#8e8e93',
    fontWeight: '500',
    fontSize: 14,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  scheduleContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#1c1c1e', // Card in stile iOS puro
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    flexDirection: 'row',
  },
  timeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    width: 60,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  classItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  classDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SAPIENZA_RED,
    marginTop: 6,
    marginRight: 8,
  },
  cardText: {
    color: '#ffffff',
    fontSize: 15,
    flex: 1,
    lineHeight: 20,
  },
});
