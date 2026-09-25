import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { fetchDegrees, Degree } from '../utils/scraper';

export default function SettingsScreen() {
  const [degrees, setDegrees] = useState<Degree[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useEffect(() => {
    loadDegrees();
  }, []);

  const loadDegrees = async () => {
    setLoading(true);
    const stored = await AsyncStorage.getItem('selectedDegreeUrl');
    setSelectedUrl(stored);
    const data = await fetchDegrees();
    setDegrees(data);
    setLoading(false);
  };

  const selectDegree = async (degree: Degree) => {
    setSelectedUrl(degree.url);
    await AsyncStorage.setItem('selectedDegreeUrl', degree.url);
    alert(`Selezionato: ${degree.name}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Seleziona il tuo corso</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#0a84ff" style={{ marginTop: 50 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {degrees.map((degree, index) => (
            <TouchableOpacity key={index} onPress={() => selectDegree(degree)}>
              <BlurView 
                tint="light" 
                intensity={selectedUrl === degree.url ? 80 : 30} 
                style={[
                  styles.card, 
                  selectedUrl === degree.url && styles.cardSelected
                ]}
              >
                <Text style={styles.name}>{degree.name}</Text>
                <Text style={styles.className}>{degree.className}</Text>
              </BlurView>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 100, // Account for header
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardSelected: {
    borderColor: '#0a84ff',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  className: {
    fontSize: 14,
    color: '#aaa',
  },
});
