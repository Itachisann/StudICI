import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDegrees, fetchTabs, fetchAllCourseData, Degree, Tab } from '../utils/scraper';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { CourseDownloadView } from '../components/CourseDownloadView';
import { DefaultTabPicker } from '../components/DefaultTabPicker';
import { parseTabHierarchy } from '../components/YearChannelSelector';

const SAPIENZA_RED = '#822433';

export default function ProfiloScreen() {
  const [degreeName, setDegreeName] = useState<string>('');
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(null);
  const [availableTabs, setAvailableTabs] = useState<Tab[]>([]);
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseModalVisible, setCourseModalVisible] = useState(false);
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [downloadingCourse, setDownloadingCourse] = useState<Degree | null>(null);
  const [downloadProgressText, setDownloadProgressText] = useState('');

  const loadProfileData = useCallback(async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const storedName = await AsyncStorage.getItem('selectedDegreeName');
      const storedDefaultTab = await AsyncStorage.getItem('defaultTabUrl');

      setDegreeUrl(storedUrl);
      setDegreeName(storedName || '');
      setDefaultTabUrl(storedDefaultTab);

      if (storedUrl) {
        const tabs = await fetchTabs(storedUrl);
        setAvailableTabs(tabs);
      }

      const degList = await fetchDegrees();
      setDegrees(degList);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfileData();
    }, [loadProfileData])
  );

  const selectDegree = async (degree: Degree) => {
    // Chiudi il modal di selezione corsi e avvia la schermata di download
    setCourseModalVisible(false);
    setDownloadingCourse(degree);
    setDownloadProgressText('Preparazione e analisi canali...');

    try {
      // 1. Scarica TUTTO in un'unica botta con avanzamento in tempo reale
      const { tabs } = await fetchAllCourseData(degree.url, true, (stepMsg) => {
        setDownloadProgressText(stepMsg);
      });

      // 2. Salviamo il corso e impostiamo il tab predefinito
      await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
      await AsyncStorage.setItem('selectedDegreeName', degree.name);
      
      const firstTab = tabs && tabs[0] ? tabs[0].url : null;
      if (firstTab) {
        await AsyncStorage.setItem('defaultTabUrl', firstTab);
      } else {
        await AsyncStorage.removeItem('defaultTabUrl');
      }

      setDegreeUrl(degree.url);
      setDegreeName(degree.name);
      setDefaultTabUrl(firstTab);
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

      // 3. Se ci sono più canali, apri subito la scelta di anno e canale per il nuovo corso
      if (tabs && tabs.length > 1) {
        setChannelModalVisible(true);
      } else {
        router.replace('/');
      }
    } catch (err) {
      console.error('Errore durante download nuovo corso:', err);
      setDownloadingCourse(null);
      Alert.alert(
        'Errore di Connessione',
        'Impossibile scaricare i dati del corso dal sito Sapienza. Controlla la tua connessione e riprova.',
        [{ text: 'OK' }]
      );
    }
  };

  const selectDefaultTab = async (tab: Tab) => {
    setDefaultTabUrl(tab.url);
    await AsyncStorage.setItem('defaultTabUrl', tab.url);
    setChannelModalVisible(false);
  };

  const clearCacheAndReload = async () => {
    if (!degreeUrl) return;
    try {
      const dummyDegree: Degree = {
        name: degreeName || 'Corso di Laurea',
        url: degreeUrl,
        className: '',
      };
      setDownloadingCourse(dummyDegree);
      setDownloadProgressText('Svuotamento cache...');

      const allKeys = await AsyncStorage.getAllKeys();
      const keysToKeep = ['selectedDegreeUrl', 'selectedDegreeName', 'defaultTabUrl'];
      const cacheKeys = allKeys.filter(k => !keysToKeep.includes(k));
      await AsyncStorage.multiRemove(cacheKeys);

      const { tabs } = await fetchAllCourseData(degreeUrl, true, (stepMsg) => {
        setDownloadProgressText(stepMsg);
      });
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

      Alert.alert('Cache Aggiornata', 'Orari e aule di tutti i canali sono stati riscaricati dal sito Sapienza.', [
        { text: 'OK', onPress: () => router.replace('/') }
      ]);
    } catch (e) {
      console.error(e);
      setDownloadingCourse(null);
      Alert.alert('Errore', 'Si è verificato un errore durante l\'aggiornamento.');
    }
  };

  const resetApp = async () => {
    Alert.alert(
      'Reset Completo',
      'Sei sicuro di voler ripristinare l\'app? Perderai il corso selezionato.',
      [
        { text: 'Annulla', style: 'cancel' },
        { 
          text: 'Reset', 
          style: 'destructive', 
          onPress: async () => {
            await AsyncStorage.clear();
            router.replace('/');
          }
        }
      ]
    );
  };

  const openSourceWebsite = async () => {
    await WebBrowser.openBrowserAsync('https://ici.web.uniroma1.it/node/388');
  };

  const parsedAvailable = useMemo(() => parseTabHierarchy(availableTabs), [availableTabs]);
  const defaultTabInfo = useMemo(() => {
    if (!defaultTabUrl) return parsedAvailable[0] || null;
    return parsedAvailable.find(p => p.tab.url === defaultTabUrl) || parsedAvailable[0] || null;
  }, [defaultTabUrl, parsedAvailable]);

  const defaultTabObj = availableTabs.find(t => t.url === defaultTabUrl) || (availableTabs[0] || null);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.largeTitle}>Profilo & Impostazioni</Text>
        <Text style={styles.subHeader}>Gestisci il tuo corso, preferenze e fonti ufficiali.</Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Sezione Corso Attuale */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CORSO DI LAUREA</Text>
          <View style={styles.card}>
            <View style={[styles.cardIconCircle, { backgroundColor: 'rgba(130, 36, 51, 0.18)' }]}>
              <Ionicons name="school" size={22} color="#e57373" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{degreeName || 'Nessun corso selezionato'}</Text>
              <Text style={styles.cardSubtitle}>Facoltà ICI · Sapienza Roma</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.actionButton} activeOpacity={0.85} onPress={() => setCourseModalVisible(true)}>
            <Ionicons name="swap-horizontal" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.actionButtonText}>Cambia Corso di Laurea</Text>
          </TouchableOpacity>
        </View>

        {/* Sezione Canale / Anno Predefinito */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CANALE / ANNO PREDEFINITO</Text>
          <Text style={styles.sectionDescription}>
            {"Il canale o anno con cui l'app si aprirà in automatico."}
          </Text>
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => setChannelModalVisible(true)}
          >
            <View style={[styles.cardIconCircle, { backgroundColor: 'rgba(245, 158, 11, 0.18)' }]}>
              <Ionicons name="funnel" size={20} color="#fbbf24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {defaultTabInfo
                  ? `${defaultTabInfo.year}${defaultTabInfo.channel ? ` · ${defaultTabInfo.channel}` : ''}`
                  : (defaultTabObj ? defaultTabObj.name : 'Seleziona canale predefinito')}
              </Text>
              <Text style={styles.cardSubtitle}>
                {defaultTabInfo ? `Foglio: ${defaultTabInfo.tab.name}` : 'Tocca per modificare'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>

        {/* Sezione Fonte Dati */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FONTE DATI UFFICIALE</Text>
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={openSourceWebsite}>
            <View style={[styles.cardIconCircle, { backgroundColor: 'rgba(59, 130, 246, 0.18)' }]}>
              <Ionicons name="globe-outline" size={20} color="#60a5fa" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Sito Ufficiale ICI Sapienza</Text>
              <Text style={styles.cardSubtitle}>ici.web.uniroma1.it/node/388</Text>
            </View>
            <Ionicons name="open-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>

        {/* Gestione Cache & Reset */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SISTEMA</Text>
          <TouchableOpacity style={[styles.card, { marginBottom: 12 }]} activeOpacity={0.8} onPress={clearCacheAndReload}>
            <View style={[styles.cardIconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.18)' }]}>
              <Ionicons name="refresh" size={20} color="#34d399" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Svuota Cache</Text>
              <Text style={styles.cardSubtitle}>{"Forza un nuovo download di orari e aule"}</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={resetApp}>
            <View style={[styles.cardIconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.18)' }]}>
              <Ionicons name="trash" size={20} color="#f87171" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Reset Totale App</Text>
              <Text style={styles.cardSubtitle}>{"Cancella tutto e torna alla configurazione"}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Info App */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {`StudICI · Versione ${Constants.expoConfig?.version || '1.0.1'}`}
          </Text>
          <Text style={styles.footerSubText}>Sapienza Università di Roma</Text>
        </View>
      </ScrollView>

      {/* Modal Cambio Corso */}
      <Modal
        visible={courseModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCourseModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Scegli Corso di Laurea</Text>
            <TouchableOpacity onPress={() => setCourseModalVisible(false)}>
              <Text style={styles.modalCloseText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView style={styles.modalScroll}>
              {degrees.map((deg, i) => {
                const isSelected = degreeUrl === deg.url;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                    onPress={() => selectDegree(deg)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemTitle, isSelected && { color: '#fff' }]}>{deg.name}</Text>
                      {deg.className ? <Text style={styles.modalItemClass}>{deg.className}</Text> : null}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={SAPIENZA_RED} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Modal Cambio Canale / Anno Predefinito */}
      <Modal
        visible={channelModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setChannelModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#111111' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 16 }}>
            <TouchableOpacity onPress={() => setChannelModalVisible(false)}>
              <Text style={{ color: '#8e8e93', fontSize: 16, fontWeight: '600' }}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          <DefaultTabPicker
            tabs={availableTabs}
            initialTabUrl={defaultTabUrl}
            degreeName={degreeName}
            title="Anno e Canale Predefinito"
            subtitle="Scegli quale orario visualizzare in automatico all'apertura dell'app."
            confirmButtonText="Salva come Predefinito"
            onConfirm={async (tab) => {
              await selectDefaultTab(tab);
            }}
            onCancel={() => setChannelModalVisible(false)}
          />
        </SafeAreaView>
      </Modal>

      {/* Modal Schermata Download Unificato (uguale all'onboarding iniziale) */}
      <Modal
        visible={Boolean(downloadingCourse)}
        animationType="fade"
        presentationStyle="fullScreen"
      >
        {downloadingCourse && (
          <CourseDownloadView
            courseName={downloadingCourse.name}
            progressText={downloadProgressText}
            title="Configurazione in corso"
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  largeTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subHeader: {
    fontSize: 14,
    color: '#8e8e93',
    marginTop: 4,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#8e8e93',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionDescription: {
    fontSize: 13,
    color: '#636366',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  cardIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 2,
  },
  actionButton: {
    flexDirection: 'row',
    backgroundColor: SAPIENZA_RED,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  footerText: {
    color: '#636366',
    fontSize: 13,
    fontWeight: '600',
  },
  footerSubText: {
    color: '#48484a',
    fontSize: 12,
    marginTop: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#1c1c1e',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalCloseText: {
    color: SAPIENZA_RED,
    fontSize: 16,
    fontWeight: '600',
  },
  modalScroll: {
    padding: 16,
  },
  modalItem: {
    backgroundColor: '#2c2c2e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalItemSelected: {
    borderColor: SAPIENZA_RED,
    borderWidth: 1.5,
  },
  modalItemTitle: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '600',
  },
  modalItemClass: {
    color: '#8e8e93',
    fontSize: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  channelDialog: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    width: '100%',
    padding: 20,
  },
  channelDialogTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  channelDialogSubtitle: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 4,
  },
  channelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2c2c2e',
  },
  channelItemSelected: {},
  channelItemText: {
    color: '#fff',
    fontSize: 15,
  },
  dialogCloseButton: {
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  dialogCloseText: {
    color: '#8e8e93',
    fontSize: 15,
    fontWeight: '600',
  },
});
