import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { fetchTabs, fetchSchedule, Tab } from '../utils/scraper';
import { Ionicons } from '@expo/vector-icons';
import * as Calendar from 'expo-calendar';

export default function ScheduleScreen() {
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      if (storedUrl) {
        setDegreeUrl(storedUrl);
        const fetchedTabs = await fetchTabs(storedUrl);
        setTabs(fetchedTabs);
        if (fetchedTabs.length > 0) {
          setSelectedTab(fetchedTabs[0]);
          const data = await fetchSchedule(fetchedTabs[0].url);
          setScheduleData(data);
        }
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

  const syncToCalendar = async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status === 'granted') {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCalendar = calendars.find(c => c.isPrimary) || calendars[0];
      if (defaultCalendar) {
        alert('Permesso accordato. Sincronizzazione in corso... (La logica di parsing date/ore richiede mappatura specifica del file Google Sheets)');
        // This is a placeholder for real event insertion
        // Calendar.createEventAsync(defaultCalendar.id, { title: 'Lecture', startDate: new Date(), endDate: new Date() })
      }
    } else {
      alert('Calendar permission not granted');
    }
  };

  if (!degreeUrl) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Please select a faculty in the Profile tab.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#0a84ff" style={{ marginTop: 100 }} />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsContainer}>
            {tabs.map((tab, i) => (
              <TouchableOpacity key={i} onPress={() => selectTab(tab)}>
                <BlurView 
                  tint={selectedTab?.url === tab.url ? "dark" : "light"} 
                  intensity={60} 
                  style={styles.tab}
                >
                  <Text style={[styles.tabText, selectedTab?.url === tab.url && styles.tabTextActive]}>
                    {tab.name}
                  </Text>
                </BlurView>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.scheduleContainer} contentContainerStyle={{ paddingBottom: 100, paddingTop: 20 }}>
            <TouchableOpacity style={styles.syncButton} onPress={syncToCalendar}>
              <Ionicons name="calendar-outline" size={20} color="#fff" />
              <Text style={styles.syncText}>Sync to Apple Calendar</Text>
            </TouchableOpacity>

            {scheduleData.map((row, i) => {
              // Ignore empty or structural rows (simple heuristic)
              if (row.length < 3 || !row[0]) return null;
              return (
                <BlurView key={i} tint="light" intensity={30} style={styles.card}>
                  {row.map((cell, j) => (
                    cell ? <Text key={j} style={styles.cardText}>{cell}</Text> : null
                  ))}
                </BlurView>
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
    backgroundColor: '#000', // Dark background for glassmorphism to pop
  },
  emptyText: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 100,
    fontSize: 16,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginTop: 100, // Account for header
    paddingHorizontal: 10,
    maxHeight: 50,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    overflow: 'hidden',
  },
  tabText: {
    color: '#ccc',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
  scheduleContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a84ff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  syncText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  cardText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
});
