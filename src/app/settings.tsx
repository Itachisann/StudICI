import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, SafeAreaView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchDegrees, Degree } from '../utils/scraper';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const SAPIENZA_RED = '#822433';

export default function SettingsScreen() {
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
    await AsyncStorage.setItem('selectedDegreeName', degree.name);
    router.push('/');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.largeTitle}>Corsi</Text>
          <Text style={styles.subHeader}>Scegli la tua facoltà per caricare gli orari.</Text>
        </View>
        
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  subHeader: {
    fontSize: 15,
    color: '#8e8e93',
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
