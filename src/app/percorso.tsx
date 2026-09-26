import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const CORAL = '#FF6B6B';

interface CourseNode {
  name: string;
  cfu: number;
  status: 'completed' | 'in_progress' | 'locked';
  year: number;
}

const COURSES: CourseNode[] = [
  { name: 'Analisi Matematica I', cfu: 9, status: 'completed', year: 1 },
  { name: 'Geometria', cfu: 9, status: 'in_progress', year: 1 },
  { name: 'Laboratorio di Matematica', cfu: 3, status: 'in_progress', year: 1 },
  { name: 'Laboratorio di Calcolo Numerico', cfu: 6, status: 'locked', year: 1 },
  { name: 'Fisica Generale I', cfu: 9, status: 'locked', year: 1 },
  { name: 'Fondamenti di Informatica', cfu: 9, status: 'locked', year: 1 },
];

export default function PercorsoScreen() {
  const [selectedFilter, setSelectedFilter] = useState<'all' | '1' | '2' | '3'>('all');

  const filters = [
    { id: 'all', label: 'Panoramica' },
    { id: '1', label: '1° Anno' },
    { id: '2', label: '2° Anno' },
    { id: '3', label: '3° Anno' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Il tuo Percorso</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="color-palette-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="list-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="swap-vertical-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Pill Filter Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll} contentContainerStyle={styles.pillRow}>
        {filters.map(f => {
          const isActive = selectedFilter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.pill, isActive && styles.pillActive]}
              onPress={() => setSelectedFilter(f.id as any)}
            >
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Tree / Path View */}
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={styles.treeContainer}>
          {COURSES.map((course, idx) => {
            const isCompleted = course.status === 'completed';
            const isInProgress = course.status === 'in_progress';
            return (
              <View key={idx} style={styles.nodeWrapper}>
                {idx > 0 && <View style={styles.connectorLine} />}
                <TouchableOpacity
                  style={[
                    styles.nodeCircle,
                    isCompleted && styles.nodeCompleted,
                    isInProgress && styles.nodeInProgress,
                  ]}
                >
                  <View style={styles.cfuBadge}>
                    <Text style={styles.cfuText}>{course.cfu}</Text>
                  </View>
                  <Ionicons
                    name={isCompleted ? 'checkmark-circle' : 'document-text'}
                    size={28}
                    color={isCompleted ? '#fff' : isInProgress ? '#fff' : '#666'}
                  />
                </TouchableOpacity>
                <Text style={styles.courseName}>{course.name}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: -0.5,
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  iconBtn: {
    padding: 6,
  },
  pillScroll: {
    maxHeight: 40,
    marginBottom: 16,
  },
  pillRow: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 16,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: CORAL,
  },
  pillText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  treeContainer: {
    alignItems: 'center',
    paddingTop: 20,
  },
  nodeWrapper: {
    alignItems: 'center',
    marginBottom: 30,
    width: '100%',
  },
  connectorLine: {
    width: 3,
    height: 40,
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
    marginBottom: -5,
  },
  nodeCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2c2c2e',
    position: 'relative',
  },
  nodeCompleted: {
    backgroundColor: CORAL,
    borderColor: '#fff',
    shadowColor: CORAL,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  nodeInProgress: {
    backgroundColor: '#2c2c2e',
    borderColor: CORAL,
    borderWidth: 3,
  },
  cfuBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#f59e0b',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#111',
  },
  cfuText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  courseName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
    maxWidth: 200,
  },
});
