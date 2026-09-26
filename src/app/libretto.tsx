import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const CORAL = '#FF6B6B';

const EXAMS = [
  { name: 'Analisi Matematica I', grade: 28, cfu: 9, date: '15/02/2026' },
  { name: 'Geometria', grade: 30, lode: true, cfu: 9, date: '28/02/2026' },
  { name: 'Fisica Generale I', grade: 27, cfu: 9, date: '20/06/2026' },
  { name: 'Fondamenti di Informatica', grade: 30, cfu: 9, date: '10/07/2026' },
];

export default function LibrettoScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Il tuo Libretto</Text>
      </View>

      {/* KPI Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>MEDIA POND.</Text>
          <Text style={styles.statValue}>28.75</Text>
          <Text style={styles.statSub}>Base laurea: 105.4</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>CFU ACQUISITI</Text>
          <Text style={[styles.statValue, { color: CORAL }]}>36 <Text style={{ fontSize: 16, color: '#8e8e93' }}>/ 180</Text></Text>
          <Text style={styles.statSub}>20% completato</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>ESAMI SOSTENUTI ({EXAMS.length})</Text>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 130 }}>
        {EXAMS.map((exam, i) => (
          <View key={i} style={styles.examCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.examName}>{exam.name}</Text>
              <Text style={styles.examDate}>{exam.date} · {exam.cfu} CFU</Text>
            </View>
            <View style={styles.gradeBadge}>
              <Text style={styles.gradeText}>
                {exam.grade}{exam.lode ? 'L' : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#111111' },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#fff', letterSpacing: -0.5 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  statLabel: { color: '#8e8e93', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  statValue: { color: '#fff', fontSize: 28, fontWeight: 'bold', marginVertical: 4 },
  statSub: { color: '#8e8e93', fontSize: 12 },
  sectionTitle: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  list: { flex: 1, paddingHorizontal: 20 },
  examCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  examName: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  examDate: { color: '#8e8e93', fontSize: 13 },
  gradeBadge: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginLeft: 10,
  },
  gradeText: { color: CORAL, fontSize: 18, fontWeight: 'bold' },
});
