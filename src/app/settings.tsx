import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDegrees, Degree } from '../utils/scraper';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SAPIENZA_RED = '#822433';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadDegrees();
    }, [])
  );

  const loadDegrees = async () => {
    setLoading(true);
    const stored = await AsyncStorage.getItem('selectedDegreeUrl');
    setSelectedUrl(stored);
    
    if (degrees.length === 0) {
      const data = await fetchDegrees();
      setDegrees(data);
    }
    setLoading(false);
  };

  const selectDegree = async (degree: Degree) => {
    setSelectedUrl(degree.url);
    await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
    router.push('/');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.largeTitle}>Corsi</Text>
      <Text style={styles.subHeader}>I dati verranno presi dai moduli Google di facoltà.</Text>
      
      {loading ? (
        <ActivityIndicator size="large" color={SAPIENZA_RED} style={{ marginTop: 50 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {degrees.map((degree, index) => {
            const isSelected = selectedUrl === degree.url;
            return (
              <TouchableOpacity key={index} onPress={() => selectDegree(degree)} style={[styles.card, isSelected && styles.cardSelected]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {degree.name}
                  </Text>
                  <Text style={styles.className}>{degree.className}</Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark" size={24} color={SAPIENZA_RED} />
                )}
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
    flex: 1,
    backgroundColor: 'transparent',
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#ffffff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 5,
  },
  subHeader: {
    fontSize: 15,
    color: '#8e8e93',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: '#1c1c1e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: SAPIENZA_RED,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  className: {
    fontSize: 14,
    color: '#8e8e93',
  },
});
