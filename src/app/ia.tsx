import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const CORAL = '#FF6B6B';

const TOOLS = [
  {
    title: 'Spiegami un argomento',
    desc: 'Chiedi a Gemini 3.1 Flash Lite di spiegarti un teorema o concetto difficile con esempi pratici.',
    icon: 'bulb-outline',
  },
  {
    title: 'Riassumi appunti',
    desc: 'Incolla il testo o le slide di una lezione per estrarre formule chiave e concetti.',
    icon: 'document-text-outline',
  },
  {
    title: 'Simulazione Esame',
    desc: 'Esercitati con domande a risposta multipla o quesiti tipici del tuo corso.',
    icon: 'school-outline',
  },
  {
    title: 'Pianificatore Studio',
    desc: 'Organizza le settimane prima dell’esame suddividendo i capitoli giorno per giorno.',
    icon: 'calendar-outline',
  },
];

export default function IAToolsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={14} color={CORAL} />
          <Text style={styles.badgeText}>GEMINI 3.1 FLASH LITE</Text>
        </View>
        <Text style={styles.title}>Strumenti IA</Text>
        <Text style={styles.subtitle}>Potenzia la tua preparazione accademica con l'intelligenza artificiale.</Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 130 }}>
        {TOOLS.map((tool, i) => (
          <TouchableOpacity key={i} style={styles.card} activeOpacity={0.7}>
            <View style={styles.iconCircle}>
              <Ionicons name={tool.icon as any} size={24} color={CORAL} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{tool.title}</Text>
              <Text style={styles.cardDesc}>{tool.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#111111' },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  badgeText: { color: CORAL, fontSize: 11, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', letterSpacing: -0.5 },
  subtitle: { color: '#8e8e93', fontSize: 14, marginTop: 4, lineHeight: 20 },
  list: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardDesc: { color: '#8e8e93', fontSize: 13, lineHeight: 18 },
});
