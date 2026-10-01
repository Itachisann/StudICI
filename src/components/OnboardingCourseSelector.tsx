import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDegrees, fetchAllCourseData, Degree } from '../utils/scraper';
import { CourseDownloadView } from './CourseDownloadView';

const SAPIENZA_RED = '#822433';

interface OnboardingCourseSelectorProps {
  onComplete: () => void;
}

export function OnboardingCourseSelector({ onComplete }: OnboardingCourseSelectorProps) {
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [currentDegreeName, setCurrentDegreeName] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const degList = await fetchDegrees();
        setDegrees(degList);
      } catch (e) {
        console.error('Errore caricamento corsi:', e);
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleSelectDegree = async (degree: Degree) => {
    setCurrentDegreeName(degree.name);
    setDownloading(true);
    setProgressText('Preparazione e analisi canali...');

    try {
      // 1. Scarica TUTTO in un'unica botta PRIMA di salvare la preferenza in AsyncStorage.
      // In questo modo il layout globale NON unmounta la schermata e l'utente rimane
      // sulla schermata di caricamento fino al completamento al 100%.
      await fetchAllCourseData(degree.url, true, (stepMsg) => {
        setProgressText(stepMsg);
      });

      // 2. Solo al termine completo del download salviamo il corso scelto
      await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
      await AsyncStorage.setItem('selectedDegreeName', degree.name);
      await AsyncStorage.removeItem('defaultTabUrl');

      // 3. Notifica il layout per passare agli orari
      onComplete();
    } catch (err) {
      console.error('Errore durante download iniziale:', err);
      setDownloading(false);
      Alert.alert(
        'Errore di Connessione',
        'Impossibile scaricare i dati del corso dal sito Sapienza. Controlla la tua connessione e riprova.',
        [{ text: 'OK' }]
      );
    }
  };

  const filteredDegrees = degrees.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.className && d.className.toLowerCase().includes(search.toLowerCase()))
  );

  // Schermata di Download Unificato
  if (downloading) {
    return (
      <CourseDownloadView
        courseName={currentDegreeName}
        progressText={progressText}
        title="Configurazione in corso"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header Introduttivo */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Ionicons name="school" size={32} color={SAPIENZA_RED} />
        </View>
        <Text style={styles.appTitle}>Benvenuto in StudICI</Text>
        <Text style={styles.appSubtitle}>
          Sapienza Università di Roma · Facoltà I.C.I.
        </Text>
        <Text style={styles.instruction}>
          Seleziona il tuo corso di laurea per iniziare. Orari e aule verranno memorizzati sul telefono.
        </Text>
      </View>

      {/* Barra di Ricerca */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#8e8e93" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca corso (es. Informatica, Clinica...)"
          placeholderTextColor="#636366"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#8e8e93" />
          </TouchableOpacity>
        )}
      </View>

      {/* Lista Corsi */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={SAPIENZA_RED} />
          <Text style={styles.loadingText}>Caricamento elenco corsi Sapienza...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scrollList} contentContainerStyle={{ paddingBottom: 40 }}>
          {filteredDegrees.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={40} color="#3a3a3c" />
              <Text style={styles.emptyText}>Nessun corso trovato per &quot;{search}&quot;</Text>
            </View>
          ) : (
            filteredDegrees.map((deg, i) => (
              <TouchableOpacity
                key={i}
                style={styles.courseCard}
                activeOpacity={0.7}
                onPress={() => handleSelectDegree(deg)}
              >
                <View style={styles.courseIconCircle}>
                  <Ionicons name="book-outline" size={22} color={SAPIENZA_RED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.courseName}>{deg.name}</Text>
                  {deg.className ? (
                    <Text style={styles.courseClass}>{deg.className}</Text>
                  ) : (
                    <Text style={styles.courseClass}>Corso di Laurea ICI</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#636366" />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(130, 36, 51, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  appSubtitle: {
    fontSize: 13,
    color: SAPIENZA_RED,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  instruction: {
    fontSize: 14,
    color: '#8e8e93',
    marginTop: 8,
    lineHeight: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 20,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
  },
  scrollList: {
    flex: 1,
    paddingHorizontal: 20,
  },
  courseCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  courseIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2c2c2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  courseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  courseClass: {
    fontSize: 12,
    color: '#8e8e93',
    marginTop: 3,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  loadingText: {
    color: '#8e8e93',
    marginTop: 14,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  emptyText: {
    color: '#636366',
    marginTop: 12,
    fontSize: 14,
  },
  // Stili schermata download
  downloadContainer: {
    flex: 1,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadContent: {
    alignItems: 'center',
    paddingHorizontal: 30,
    width: '100%',
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(130, 36, 51, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  downloadTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  downloadCourseName: {
    fontSize: 15,
    color: SAPIENZA_RED,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  progressBox: {
    backgroundColor: '#1c1c1e',
    padding: 18,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  progressStatus: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  progressHint: {
    color: '#8e8e93',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
