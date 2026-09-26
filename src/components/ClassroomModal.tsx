import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ResolvedClassroom, openInMaps } from '../utils/classroomLocations';

interface ClassroomModalProps {
  visible: boolean;
  classroom: ResolvedClassroom | null;
  subjects?: string[];
  onClose: () => void;
}

export function ClassroomModal({ visible, classroom, subjects, onClose }: ClassroomModalProps) {
  if (!classroom) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.pinCircle}>
              <Ionicons name="location" size={24} color="#ef4444" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roomName}>{classroom.displayName}</Text>
              <Text style={styles.buildingName}>{classroom.buildingName}</Text>
            </View>
          </View>

          {/* Indirizzo */}
          <View style={styles.addressBox}>
            <Ionicons name="navigate-outline" size={18} color="#8e8e93" style={{ marginRight: 8, marginTop: 2 }} />
            <Text style={styles.addressText}>{classroom.address}</Text>
          </View>

          {/* Materie associate (se presenti) */}
          {subjects && subjects.length > 0 && (
            <View style={styles.subjectsContainer}>
              <Text style={styles.subjectsTitle}>LEZIONI IN QUESTAULA:</Text>
              <View style={styles.subjectTags}>
                {subjects.slice(0, 4).map((s, idx) => (
                  <View key={idx} style={styles.subjectBadge}>
                    <Text style={styles.subjectText} numberOfLines={1}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Opzioni Mappe */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => {
                openInMaps(classroom, 'apple');
                onClose();
              }}
            >
              <Ionicons name="map" size={20} color="#fff" style={{ marginRight: 10 }} />
              <Text style={styles.mapButtonText}>Apri con Apple Mappe</Text>
              <Ionicons name="chevron-forward" size={16} color="#8e8e93" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mapButton, styles.googleButton]}
              onPress={() => {
                openInMaps(classroom, 'google');
                onClose();
              }}
            >
              <Ionicons name="navigate" size={20} color="#fff" style={{ marginRight: 10 }} />
              <Text style={styles.mapButtonText}>Apri con Google Maps</Text>
              <Ionicons name="chevron-forward" size={16} color="#8e8e93" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>

          {/* Tasto Chiudi */}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Chiudi</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  pinCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  roomName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  buildingName: {
    color: '#8e8e93',
    fontSize: 14,
    marginTop: 2,
  },
  addressBox: {
    flexDirection: 'row',
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  addressText: {
    color: '#d4d4d4',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  subjectsContainer: {
    marginBottom: 20,
  },
  subjectsTitle: {
    color: '#8e8e93',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subjectTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectBadge: {
    backgroundColor: '#2c2c2e',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: '100%',
  },
  subjectText: {
    color: '#e5e5e5',
    fontSize: 12,
  },
  actions: {
    gap: 10,
    marginBottom: 14,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2c2c2e',
    padding: 16,
    borderRadius: 14,
  },
  googleButton: {
    backgroundColor: '#242426',
  },
  mapButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: '#8e8e93',
    fontSize: 16,
    fontWeight: '600',
  },
});
