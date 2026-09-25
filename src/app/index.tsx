import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Linking, SafeAreaView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTabs, fetchSchedule, Tab } from '../utils/scraper';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

const SAPIENZA_RED = '#822433';
const DAYS = ['LUN', 'MAR', 'MER', 'GIO', 'VEN'];
const ACCENT_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ef4444'];

interface ClassEvent {
  time: string;
  text: string;
  title: string;
  teacher: string;
  room: string;
  color: string;
}

export default function ScheduleScreen() {
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab | null>(null);
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);

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

  const openMapForClass = (room: string) => {
    if (!room) return;
    const query = encodeURIComponent(`Sapienza Università di Roma ${room}`);
    const url = `http://maps.apple.com/?q=${query}`;
    Linking.openURL(url).catch(err => console.error("Couldn't open maps", err));
  };

  // Parso le lezioni in base al giorno selezionato
  const dayClasses = useMemo(() => {
    if (!scheduleData || scheduleData.length === 0) return [];
    
    const classes: ClassEvent[] = [];
    let colorIndex = 0;
    
    // Supponiamo che la prima colonna (index 0) sia l'orario e le colonne 1-5 siano LUN-VEN
    // (a volte 0 è vuoto o ha un header, quindi saltiamo righe senza orario valido)
    scheduleData.forEach((row) => {
      if (row.length < 2) return;
      
      const timeStr = row[0] || '';
      // Se non sembra un orario, saltiamo
      if (!timeStr.match(/\d/)) return;
      
      const cell = row[selectedDay + 1]; // +1 perché l'indice 0 è il tempo
      if (cell && cell.trim() !== '') {
        const lines = cell.split('\n').map(l => l.trim()).filter(l => l !== '');
        let title = lines[0] || cell;
        let teacher = lines.length > 1 ? lines.slice(1).join(' - ') : '';
        let room = '';
        
        // Estrai l'aula (es. "Aula 14", "RM002")
        const roomMatch = cell.match(/Aula\s*[a-zA-Z0-9]+/i) || cell.match(/RM\d+/i);
        if (roomMatch) {
          room = roomMatch[0];
          title = title.replace(roomMatch[0], '').replace(/\(\s*\)/, '').trim();
          teacher = teacher.replace(roomMatch[0], '').replace(/\(\s*\)/, '').trim();
        }

        classes.push({
          time: timeStr,
          text: cell,
          title: title.toUpperCase(),
          teacher: teacher || 'Docente non specificato',
          room: room,
          color: ACCENT_COLORS[colorIndex % ACCENT_COLORS.length]
        });
        colorIndex++;
      }
    });
    
    return classes;
  }, [scheduleData, selectedDay]);

  if (!degreeUrl && !loading) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContainer}>
          <Ionicons name="school" size={80} color={SAPIENZA_RED} style={{ marginBottom: 20 }} />
          <Text style={styles.welcomeText}>Benvenuto in StudICI</Text>
          <Text style={styles.subText}>Seleziona il tuo corso per iniziare.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/settings')}>
            <Text style={styles.primaryButtonText}>Scegli Corso</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* Header App */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.logoCircle}>
              <Ionicons name="school" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.appName}>StudICI</Text>
              <Text style={styles.appSubtitle}>Sapienza Università di Roma</Text>
            </View>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>A.A. 2026-27</Text>
          </View>
        </View>

        {/* Tabs / Canali */}
        <View style={styles.tabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {tabs.map((tab, i) => {
              const isActive = selectedTab?.url === tab.url;
              return (
                <TouchableOpacity key={i} onPress={() => selectTab(tab)} style={[styles.tabChip, isActive && styles.tabChipActive]}>
                  <Text style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>
                    {tab.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Selettore Giorni */}
        <View style={styles.daysSelector}>
          <TouchableOpacity style={styles.navArrow}><Ionicons name="chevron-back" size={20} color="#666" /></TouchableOpacity>
          <View style={styles.daysRow}>
            {DAYS.map((day, i) => {
              const isActive = selectedDay === i;
              return (
                <TouchableOpacity key={i} onPress={() => setSelectedDay(i)} style={styles.dayItem}>
                  <View style={[styles.dayCircle, isActive && styles.dayCircleActive]}>
                    <Text style={[styles.dayText, isActive && styles.dayTextActive]}>{day}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={styles.navArrow}><Ionicons name="chevron-forward" size={20} color="#666" /></TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 100 }} />
        ) : (
          <ScrollView style={styles.scheduleContainer} contentContainerStyle={{ paddingBottom: 120 }}>
            <Text style={styles.dayLabel}>
              {DAYS[selectedDay] === 'LUN' ? 'LUNEDÌ' : 
               DAYS[selectedDay] === 'MAR' ? 'MARTEDÌ' : 
               DAYS[selectedDay] === 'MER' ? 'MERCOLEDÌ' : 
               DAYS[selectedDay] === 'GIO' ? 'GIOVEDÌ' : 'VENERDÌ'} • {dayClasses.length} LEZIONI
            </Text>

            {dayClasses.map((cls, i) => (
              <View key={i} style={styles.classCard}>
                <View style={[styles.colorAccent, { backgroundColor: cls.color }]} />
                <View style={styles.cardContent}>
                  <Text style={styles.classTitle} numberOfLines={2}>{cls.title}</Text>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="time-outline" size={16} color="#8e8e93" />
                    <Text style={styles.infoText}>{cls.time}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={16} color="#8e8e93" />
                    <Text style={styles.infoText} numberOfLines={1}>{cls.teacher}</Text>
                  </View>

                  {cls.room ? (
                    <TouchableOpacity style={styles.roomBadge} onPress={() => openMapForClass(cls.room)}>
                      <Ionicons name="location-outline" size={14} color="#ef4444" />
                      <Text style={styles.roomText}>{cls.room}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111111',
  },
  container: {
    flex: 1,
    backgroundColor: '#111111',
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
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: SAPIENZA_RED,
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  appName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  appSubtitle: {
    color: '#8e8e93',
    fontSize: 13,
  },
  badge: {
    backgroundColor: 'rgba(130,36,51,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  tabsContainer: {
    marginBottom: 20,
  },
  tabChip: {
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 12,
  },
  tabChipActive: {
    backgroundColor: SAPIENZA_RED,
  },
  tabChipText: {
    color: '#8e8e93',
    fontWeight: '600',
    fontSize: 14,
  },
  tabChipTextActive: {
    color: '#ffffff',
  },
  daysSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  navArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  daysRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  dayItem: {
    alignItems: 'center',
  },
  dayCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleActive: {
    backgroundColor: SAPIENZA_RED,
  },
  dayText: {
    color: '#8e8e93',
    fontSize: 13,
    fontWeight: 'bold',
  },
  dayTextActive: {
    color: '#ffffff',
  },
  scheduleContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  dayLabel: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  classCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    marginBottom: 16,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  colorAccent: {
    width: 4,
    marginTop: 16,
    marginBottom: 16,
    marginLeft: 16,
    borderRadius: 2,
  },
  cardContent: {
    flex: 1,
    padding: 16,
    paddingLeft: 12,
  },
  classTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  infoText: {
    color: '#8e8e93',
    fontSize: 14,
    marginLeft: 6,
    flex: 1,
  },
  roomBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roomText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  }
});
