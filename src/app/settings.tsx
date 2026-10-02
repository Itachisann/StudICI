import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, Alert, TextInput
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
  const [degreeClassName, setDegreeClassName] = useState<string>('');
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [defaultTabUrl, setDefaultTabUrl] = useState<string | null>(null);
  const [availableTabs, setAvailableTabs] = useState<Tab[]>([]);
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseModalVisible, setCourseModalVisible] = useState(false);
  const [channelModalVisible, setChannelModalVisible] = useState(false);
  const [searchCourse, setSearchCourse] = useState('');
  const [downloadingCourse, setDownloadingCourse] = useState<Degree | null>(null);
  const [downloadProgressText, setDownloadProgressText] = useState('');

  const loadProfileData = useCallback(async () => {
    setLoading(true);
    try {
      const storedUrl = await AsyncStorage.getItem('selectedDegreeUrl');
      const storedName = await AsyncStorage.getItem('selectedDegreeName');
      const storedClassName = await AsyncStorage.getItem('selectedDegreeClassName');
      const storedDefaultTab = await AsyncStorage.getItem('defaultTabUrl');

      setDegreeUrl(storedUrl);
      setDegreeName(storedName || '');
      setDegreeClassName(storedClassName || '');
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
    setCourseModalVisible(false);
    setDownloadingCourse(degree);
    setDownloadProgressText('Preparazione e analisi canali...');

    try {
      const { tabs } = await fetchAllCourseData(degree.url, true, (stepMsg) => {
        setDownloadProgressText(stepMsg);
      });

      await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
      await AsyncStorage.setItem('selectedDegreeName', degree.name);
      if (degree.className) {
        await AsyncStorage.setItem('selectedDegreeClassName', degree.className);
      }
      
      const firstTab = tabs && tabs[0] ? tabs[0].url : null;
      if (firstTab) {
        await AsyncStorage.setItem('defaultTabUrl', firstTab);
      } else {
        await AsyncStorage.removeItem('defaultTabUrl');
      }

      setDegreeUrl(degree.url);
      setDegreeName(degree.name);
      setDegreeClassName(degree.className || '');
      setDefaultTabUrl(firstTab);
      setAvailableTabs(tabs);
      setDownloadingCourse(null);

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
      setDownloadProgressText('Svuotamento cache e aggiornamento...');

      const allKeys = await AsyncStorage.getAllKeys();
      const keysToKeep = ['selectedDegreeUrl', 'selectedDegreeName', 'selectedDegreeClassName', 'defaultTabUrl'];
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
      'Ripristina Applicazione',
      'Sei sicuro di voler ripristinare StudICI? Verranno rimossi il corso e le impostazioni salvate.',
      [
        { text: 'Annulla', style: 'cancel' },
        { 
          text: 'Ripristina', 
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

  const defaultTabLabel = useMemo(() => {
    if (!defaultTabInfo) return defaultTabObj ? defaultTabObj.name : 'Non impostato';
    return `${defaultTabInfo.year}${defaultTabInfo.channel ? ` · ${defaultTabInfo.channel}` : ''}`;
  }, [defaultTabInfo, defaultTabObj]);

  const courseMetadata = useMemo(() => {
    const rawName = degreeName || '';
    const rawClass = degreeClassName || '';

    // Tipologia Laurea
    const isMagistrale = /magistrale|LM[- ]?\d+/i.test(rawName) || /LM[- ]?\d+/i.test(rawClass);
    const isCicloUnico = /ciclo unico|quinquennale/i.test(rawName) || /ciclo unico/i.test(rawClass);
    const degreeTypeLabel = isCicloUnico 
      ? 'Laurea a Ciclo Unico' 
      : (isMagistrale ? 'Laurea Magistrale' : 'Laurea Triennale');

    // Percorso / Classe (es. "LR9", "L-9", "LM-21")
    let displayClass = rawClass;
    if (!displayClass && rawName) {
      const match = rawName.match(/\b(L[MR]?[- ]?\d+|L[- ]\d+)\b/i);
      if (match) displayClass = match[1].toUpperCase();
    }
    if (displayClass && !displayClass.toLowerCase().startsWith('classe') && !displayClass.toLowerCase().startsWith('percorso')) {
      displayClass = displayClass.startsWith('L') ? `Classe ${displayClass}` : `Percorso ${displayClass}`;
    }

    const cleanCourseTitle = rawName.replace(/\s*[-–]\s*(?:triennale|magistrale)\b/gi, '').trim() || 'Nessun corso';

    return {
      cleanCourseTitle,
      degreeTypeLabel,
      isMagistrale,
      displayClass,
      faculty: 'Facoltà di Ingegneria Civile e Industriale',
    };
  }, [degreeName, degreeClassName]);

  const filteredDegrees = useMemo(() => {
    if (!searchCourse.trim()) return degrees;
    const q = searchCourse.toLowerCase().trim();
    return degrees.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.className && d.className.toLowerCase().includes(q))
    );
  }, [degrees, searchCourse]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.largeTitle}>Profilo</Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        
        {/* Apple ID Style Account Header Card con Metadati Corso */}
        <View style={styles.profileHeaderCard}>
          <View style={styles.profileAvatarBox}>
            <Ionicons name="school" size={26} color="#ffffff" />
          </View>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileDegreeTitle} numberOfLines={2}>
              {courseMetadata.cleanCourseTitle}
            </Text>
            <Text style={styles.profileFacultySubtitle}>
              {courseMetadata.faculty}
            </Text>
            
            {/* Badge Tipologia & Classe/Percorso */}
            <View style={styles.profileBadgesRow}>
              <View style={[
                styles.profileBadge,
                { backgroundColor: courseMetadata.isMagistrale ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)' }
              ]}>
                <View style={[
                  styles.profileBadgeDot,
                  { backgroundColor: courseMetadata.isMagistrale ? '#c084fc' : '#60a5fa' }
                ]} />
                <Text style={[
                  styles.profileBadgeText,
                  { color: courseMetadata.isMagistrale ? '#c084fc' : '#60a5fa' }
                ]}>
                  {courseMetadata.degreeTypeLabel}
                </Text>
              </View>

              {courseMetadata.displayClass ? (
                <View style={[styles.profileBadge, { backgroundColor: 'rgba(255, 159, 10, 0.15)' }]}>
                  <Ionicons name="ribbon-outline" size={11} color="#ff9f0a" style={{ marginRight: 4 }} />
                  <Text style={[styles.profileBadgeText, { color: '#ff9f0a' }]}>
                    {courseMetadata.displayClass}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Gruppo 1: CORSO & DIDATTICA */}
        <Text style={styles.sectionHeader}>CORSO & DIDATTICA</Text>
        <View style={styles.groupedCard}>
          
          {/* Riga 1: Corso di Laurea */}
          <TouchableOpacity 
            style={styles.tableRow} 
            activeOpacity={0.7} 
            onPress={() => setCourseModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: SAPIENZA_RED }]}>
              <Ionicons name="school" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Corso di Laurea</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {courseMetadata.cleanCourseTitle}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Canale / Anno Predefinito */}
          <TouchableOpacity 
            style={styles.tableRow} 
            activeOpacity={0.7} 
            onPress={() => setChannelModalVisible(true)}
          >
            <View style={[styles.iconBox, { backgroundColor: '#ff2d55' }]}>
              <Ionicons name="funnel" size={16} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Canale Predefinito</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {defaultTabLabel}
            </Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

        </View>
        <Text style={styles.sectionFooter}>
          {"L'app visualizzerà in automatico l'orario e le aule del canale selezionato."}
        </Text>

        {/* Gruppo 2: FONTI UFFICIALI */}
        <Text style={styles.sectionHeader}>FONTI UFFICIALI</Text>
        <View style={styles.groupedCard}>
          <TouchableOpacity style={styles.tableRow} activeOpacity={0.7} onPress={openSourceWebsite}>
            <View style={[styles.iconBox, { backgroundColor: '#007aff' }]}>
              <Ionicons name="globe-outline" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Portale Orari ICI</Text>
            <Text style={styles.rowDetail} numberOfLines={1}>web.uniroma1.it</Text>
            <Ionicons name="open-outline" size={15} color="#48484a" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>
          Orari e aule sono estratti direttamente dalle tabelle ufficiali della presidenza.
        </Text>

        {/* Gruppo 3: SISTEMA & ARCHIVIAZIONE */}
        <Text style={styles.sectionHeader}>SISTEMA & ARCHIVIAZIONE</Text>
        <View style={styles.groupedCard}>
          
          {/* Riga 1: Svuota Cache */}
          <TouchableOpacity style={styles.tableRow} activeOpacity={0.7} onPress={clearCacheAndReload}>
            <View style={[styles.iconBox, { backgroundColor: '#34c759' }]}>
              <Ionicons name="refresh" size={17} color="#ffffff" />
            </View>
            <Text style={styles.rowTitle}>Aggiorna & Svuota Cache</Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Riga 2: Reset Totale */}
          <TouchableOpacity style={styles.tableRow} activeOpacity={0.7} onPress={resetApp}>
            <View style={[styles.iconBox, { backgroundColor: '#ff3b30' }]}>
              <Ionicons name="trash" size={16} color="#ffffff" />
            </View>
            <Text style={[styles.rowTitle, { color: '#ff453a' }]}>Ripristina Applicazione</Text>
            <Ionicons name="chevron-forward" size={15} color="#48484a" />
          </TouchableOpacity>

        </View>

        {/* Footer Info App */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {`StudICI per iOS · v${Constants.expoConfig?.version || '1.0.6'} (Build ${Constants.expoConfig?.ios?.buildNumber || '7'})`}
          </Text>
          <Text style={styles.footerSubText}>Sapienza Università di Roma</Text>
        </View>

      </ScrollView>

      {/* Modal Selezione Corso di Laurea in stile App / iOS */}
      <Modal
        visible={courseModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCourseModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Corso di Laurea</Text>
              <Text style={styles.modalSubtitle}>Facoltà di Ingegneria Civile e Industriale</Text>
            </View>
            <TouchableOpacity 
              style={styles.modalCloseCircle} 
              activeOpacity={0.7} 
              onPress={() => setCourseModalVisible(false)}
            >
              <Ionicons name="close" size={20} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          {/* Barra di Ricerca in stile iOS */}
          <View style={styles.searchBarContainer}>
            <Ionicons name="search" size={16} color="#8e8e93" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca corso o classe (es. Clinica, L-9)..."
              placeholderTextColor="#71717a"
              value={searchCourse}
              onChangeText={setSearchCourse}
              clearButtonMode="while-editing"
            />
            {searchCourse.length > 0 && (
              <TouchableOpacity onPress={() => setSearchCourse('')}>
                <Ionicons name="close-circle" size={16} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {filteredDegrees.map((deg, i) => {
                const isSelected = degreeUrl === deg.url;
                const isMagistrale = deg.name.toLowerCase().includes('magistrale') || deg.className?.toUpperCase().startsWith('LM');
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                    activeOpacity={0.7}
                    onPress={() => selectDegree(deg)}
                  >
                    <View style={[styles.courseIconBox, isSelected && { backgroundColor: SAPIENZA_RED }]}>
                      <Ionicons name="school" size={18} color="#ffffff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalItemTitle, isSelected && { color: '#fff' }]}>{deg.name}</Text>
                      <View style={styles.courseBadgesRow}>
                        <View style={[styles.typeBadge, { backgroundColor: isMagistrale ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)' }]}>
                          <Text style={[styles.typeBadgeText, { color: isMagistrale ? '#c084fc' : '#60a5fa' }]}>
                            {isMagistrale ? 'Magistrale' : 'Triennale'}
                          </Text>
                        </View>
                        {deg.className ? (
                          <View style={styles.classBadge}>
                            <Text style={styles.classBadgeText}>{deg.className}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={SAPIENZA_RED} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Modal Fallback Cambio Canale / Anno (usato in Expo Go o cliccando 'Personalizza...') */}
      <Modal
        visible={channelModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setChannelModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#111111' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 16 }}>
            <TouchableOpacity onPress={() => setChannelModalVisible(false)}>
              <Text style={{ color: '#8e8e93', fontSize: 16, fontWeight: '600' }}>Fine</Text>
            </TouchableOpacity>
          </View>
          <DefaultTabPicker
            tabs={availableTabs}
            initialTabUrl={defaultTabUrl}
            degreeName={degreeName}
            title="Anno e Canale Predefinito"
            subtitle="Scegli quale orario visualizzare all'apertura dell'app."
            confirmButtonText="Imposta come Predefinito"
            onConfirm={async (tab) => {
              await selectDefaultTab(tab);
            }}
            onCancel={() => setChannelModalVisible(false)}
          />
        </SafeAreaView>
      </Modal>

      {/* Modal Schermata Download Unificato */}
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
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.35,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  /* Card stile profilo Apple ID */
  profileHeaderCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  profileAvatarBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  profileHeaderInfo: {
    flex: 1,
  },
  profileDegreeTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  profileFacultySubtitle: {
    color: '#8e8e93',
    fontSize: 13,
    marginTop: 3,
  },
  profileBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  profileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  profileBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  profileBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  /* Sezioni e Gruppi Inset Grouped iOS */
  sectionHeader: {
    fontSize: 13,
    fontWeight: '400',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: -0.08,
    marginLeft: 16,
    marginBottom: 6,
    marginTop: 22,
  },
  sectionFooter: {
    fontSize: 13,
    color: '#636366',
    marginLeft: 16,
    marginRight: 16,
    marginTop: 6,
    lineHeight: 18,
  },
  groupedCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  rowTitle: {
    fontSize: 16,
    color: '#ffffff',
    flex: 1,
    letterSpacing: -0.2,
  },
  rowDetail: {
    fontSize: 15,
    color: '#8e8e93',
    marginRight: 6,
    maxWidth: '48%',
    textAlign: 'right',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 60,
  },
  /* Footer */
  footer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
  },
  footerText: {
    color: '#636366',
    fontSize: 13,
    fontWeight: '500',
  },
  footerSubText: {
    color: '#48484a',
    fontSize: 12,
    marginTop: 3,
  },
  /* Modal styling */
  modalContainer: {
    flex: 1,
    backgroundColor: '#111111',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#8e8e93',
    fontSize: 12.5,
    marginTop: 2,
  },
  modalCloseCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14.5,
  },
  modalScroll: {
    padding: 16,
  },
  modalItem: {
    backgroundColor: '#1c1c1e',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  modalItemSelected: {
    borderColor: SAPIENZA_RED,
    backgroundColor: 'rgba(130, 36, 51, 0.15)',
    borderWidth: 1.5,
  },
  courseIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#2c2c2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  modalItemTitle: {
    color: '#f4f4f5',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  courseBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  classBadge: {
    backgroundColor: 'rgba(255, 159, 10, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  classBadgeText: {
    color: '#ff9f0a',
    fontSize: 11,
    fontWeight: '700',
  },
});
