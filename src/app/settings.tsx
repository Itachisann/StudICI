import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDegrees, fetchTabs, Degree, Tab } from '../utils/scraper';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

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
    setDegreeUrl(degree.url);
    setDegreeName(degree.name);
    await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
    await AsyncStorage.setItem('selectedDegreeName', degree.name);
    // Reset default channel
    await AsyncStorage.removeItem('defaultTabUrl');
    setDefaultTabUrl(null);
    setCourseModalVisible(false);

    // Fetch tabs for new degree
    const tabs = await fetchTabs(degree.url);
    setAvailableTabs(tabs);
  };

  const selectDefaultTab = async (tab: Tab) => {
    setDefaultTabUrl(tab.url);
    await AsyncStorage.setItem('defaultTabUrl', tab.url);
    setChannelModalVisible(false);
  };

  const clearCacheAndReload = async () => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToKeep = ['selectedDegreeUrl', 'selectedDegreeName', 'defaultTabUrl'];
      const cacheKeys = allKeys.filter(k => !keysToKeep.includes(k));
      await AsyncStorage.multiRemove(cacheKeys);
      Alert.alert('Cache Svuotata', 'I dati dell\'orario e le aule verranno ricaricati aggiornati dal sito Sapienza.');
    } catch (e) {
      console.error(e);
    }
  };

  const openSourceWebsite = async () => {
    await WebBrowser.openBrowserAsync('https://ici.web.uniroma1.it/node/388');
  };

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
            <View style={styles.cardIconCircle}>
              <Ionicons name="school" size={24} color={SAPIENZA_RED} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{degreeName || 'Nessun corso selezionato'}</Text>
              <Text style={styles.cardSubtitle}>Facoltà ICI · Sapienza Roma</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.actionButton} onPress={() => setCourseModalVisible(true)}>
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
            <View style={styles.cardIconCircle}>
              <Ionicons name="funnel" size={22} color="#f59e0b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {defaultTabObj ? defaultTabObj.name : 'Seleziona canale predefinito'}
              </Text>
              <Text style={styles.cardSubtitle}>Tocca per modificare</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>

        {/* Sezione Fonte Dati */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FONTE DATI UFFICIALE</Text>
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={openSourceWebsite}>
            <View style={styles.cardIconCircle}>
              <Ionicons name="globe-outline" size={22} color="#3b82f6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Sito Ufficiale ICI Sapienza</Text>
              <Text style={styles.cardSubtitle}>ici.web.uniroma1.it/node/388</Text>
            </View>
            <Ionicons name="open-outline" size={18} color="#8e8e93" />
          </TouchableOpacity>
        </View>

        {/* Gestione Cache */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>GESTIONE CACHE</Text>
          <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={clearCacheAndReload}>
            <View style={styles.cardIconCircle}>
              <Ionicons name="refresh" size={22} color="#10b981" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Svuota Cache e Ricarica</Text>
              <Text style={styles.cardSubtitle}>{"Scarica di nuovo l'orario se i docenti hanno fatto modifiche"}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Info App */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>StudICI · Versione 1.0.0</Text>
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

      {/* Modal Cambio Canale Predefinito */}
      <Modal
        visible={channelModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setChannelModalVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setChannelModalVisible(false)}>
          <View style={styles.channelDialog} onStartShouldSetResponder={() => true}>
            <Text style={styles.channelDialogTitle}>Seleziona Canale / Anno</Text>
            <Text style={styles.channelDialogSubtitle}>{"Scegli quale orario visualizzare all'apertura"}</Text>
            <ScrollView style={{ maxHeight: 300, marginVertical: 12 }}>
              {availableTabs.map((t, idx) => {
                const isSelected = defaultTabUrl === t.url || (!defaultTabUrl && idx === 0);
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.channelItem, isSelected && styles.channelItemSelected]}
                    onPress={() => selectDefaultTab(t)}
                  >
                    <Text style={[styles.channelItemText, isSelected && { color: SAPIENZA_RED, fontWeight: 'bold' }]}>
                      {t.name}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={20} color={SAPIENZA_RED} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.dialogCloseButton} onPress={() => setChannelModalVisible(false)}>
              <Text style={styles.dialogCloseText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#2c2c2e',
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
    borderRadius: 12,
    padding: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
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
