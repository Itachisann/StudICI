import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  Platform, Share
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import * as Clipboard from 'expo-clipboard';
import { ResolvedClassroom, openInMaps } from '../utils/classroomLocations';

const SAPIENZA_RED = '#822433';

interface ClassroomModalProps {
  visible: boolean;
  classroom: ResolvedClassroom | null;
  subjects?: string[];
  onClose: () => void;
}

export function ClassroomModal({ visible, classroom, subjects, onClose }: ClassroomModalProps) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  if (!classroom) return null;

  const lat = classroom.latitude || 41.90382;
  const lng = classroom.longitude || 12.51685;
  const isWeb = Platform.OS === 'web';

  const handleShare = async () => {
    try {
      const msg = `📍 ${classroom.displayName} · ${classroom.buildingName}\nIndirizzo: ${classroom.address}\n\nCondiviso da StudICI Sapienza`;
      await Share.share({
        title: classroom.displayName,
        message: msg,
      });
    } catch {}
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(classroom.address);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Backdrop con Blur iOS */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <BlurView tint="dark" intensity={35} style={StyleSheet.absoluteFill} />
          <View style={styles.backdropOverlay} />
        </TouchableOpacity>

        {/* Apple Style Floating Sheet */}
        <View
          style={[
            styles.sheetContainer,
            { paddingBottom: insets.bottom > 0 ? insets.bottom + 12 : 28 }
          ]}
        >
          {/* Grabber Handle iOS */}
          <View style={styles.grabberContainer}>
            <View style={styles.grabber} />
          </View>

          {/* Header con Titolo, Campus Badge e Tasto Chiudi Circolare */}
          <View style={styles.headerRow}>
            <View style={styles.roomIconSquircle}>
              <Ionicons name="location" size={24} color="#ffffff" />
            </View>

            <View style={styles.headerInfo}>
              <View style={styles.titleTopRow}>
                <Text style={styles.roomTitle} numberOfLines={1}>
                  {classroom.displayName}
                </Text>
                {classroom.campus ? (
                  <View style={styles.campusBadge}>
                    <Ionicons name="business" size={11} color="#f43f5e" style={{ marginRight: 4 }} />
                    <Text style={styles.campusBadgeText} numberOfLines={1}>
                      {classroom.campus}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.buildingSubtitle} numberOfLines={1}>
                {classroom.buildingName}
              </Text>
            </View>

            {/* Pulsante Chiudi Circolare Stile Apple */}
            <TouchableOpacity
              style={styles.closeCircleButton}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={18} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          {/* ── Mappa Interattiva Incorporata (Live MapKit Preview) ── */}
          <View style={styles.mapCard}>
            {!isWeb ? (
              <MapView
                style={styles.mapView}
                initialRegion={{
                  latitude: lat,
                  longitude: lng,
                  latitudeDelta: 0.0035,
                  longitudeDelta: 0.0035,
                }}
                scrollEnabled={true}
                zoomEnabled={true}
                pitchEnabled={false}
                rotateEnabled={false}
                userInterfaceStyle="dark"
              >
                <Marker
                  coordinate={{ latitude: lat, longitude: lng }}
                  title={classroom.displayName}
                  description={classroom.buildingName}
                >
                  <View style={styles.markerContainer}>
                    <View style={styles.markerPulse} />
                    <View style={styles.markerBadge}>
                      <Ionicons name="school" size={16} color="#ffffff" />
                    </View>
                  </View>
                </Marker>
              </MapView>
            ) : (
              <View style={styles.mapFallback}>
                <Ionicons name="map-outline" size={40} color="#8e8e93" />
                <Text style={styles.mapFallbackText}>Mappa Sapienza ICI</Text>
              </View>
            )}

            {/* Overlay Inferiore della Mappa con Indirizzo e Tasto Naviga Rapido */}
            <TouchableOpacity
              style={styles.mapAddressOverlay}
              activeOpacity={0.85}
              onPress={() => {
                openInMaps(classroom, 'apple');
                onClose();
              }}
            >
              <Ionicons name="navigate-circle" size={20} color="#38bdf8" style={{ marginRight: 8 }} />
              <Text style={styles.mapAddressText} numberOfLines={1}>
                {classroom.address}
              </Text>
              <Ionicons name="open-outline" size={14} color="#94a3b8" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </View>

          {/* ── Materie Associate in Quest'Aula ── */}
          {subjects && subjects.length > 0 && (
            <View style={styles.subjectsSection}>
              <Text style={styles.subjectsLabel}>{"INSEGNAMENTI IN QUEST'AULA"}</Text>
              <View style={styles.subjectsRow}>
                {subjects.slice(0, 4).map((sub, idx) => (
                  <View key={idx} style={styles.subjectPill}>
                    <Ionicons name="book-outline" size={12} color="#f43f5e" style={{ marginRight: 6 }} />
                    <Text style={styles.subjectText} numberOfLines={1}>
                      {sub}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Ottieni Indicazioni (Apple Mappe & Google Maps) ── */}
          <View style={styles.directionSection}>
            <Text style={styles.sectionLabel}>OTTIENI INDICAZIONI</Text>
            <View style={styles.directionRow}>
              {/* Apple Mappe */}
              <TouchableOpacity
                style={[styles.directionButton, styles.appleButton]}
                activeOpacity={0.8}
                onPress={() => {
                  openInMaps(classroom, 'apple');
                  onClose();
                }}
              >
                <View style={styles.directionIconCircle}>
                  <Ionicons name="navigate" size={16} color="#ffffff" />
                </View>
                <View style={styles.directionTextContainer}>
                  <Text style={styles.directionMainText}>Apple Mappe</Text>
                  <Text style={styles.directionSubText}>Avvia itinerario</Text>
                </View>
              </TouchableOpacity>

              {/* Google Maps */}
              <TouchableOpacity
                style={[styles.directionButton, styles.googleButton]}
                activeOpacity={0.8}
                onPress={() => {
                  openInMaps(classroom, 'google');
                  onClose();
                }}
              >
                <View style={[styles.directionIconCircle, styles.googleIconCircle]}>
                  <Ionicons name="map" size={16} color="#38bdf8" />
                </View>
                <View style={styles.directionTextContainer}>
                  <Text style={styles.directionMainText}>Google Maps</Text>
                  <Text style={styles.directionSubText}>Avvia itinerario</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Barra Azioni Secondarie: Condividi & Copia Indirizzo ── */}
          <View style={styles.secondaryActionsRow}>
            {/* Copia Indirizzo */}
            <TouchableOpacity
              style={[styles.secondaryButton, copied && styles.secondaryButtonActive]}
              activeOpacity={0.7}
              onPress={handleCopy}
            >
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={16}
                color={copied ? '#10b981' : '#f59e0b'}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.secondaryButtonText, copied && { color: '#10b981' }]}>
                {copied ? 'Indirizzo Copiato!' : 'Copia Indirizzo'}
              </Text>
            </TouchableOpacity>

            {/* Condividi Aula */}
            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.7}
              onPress={handleShare}
            >
              <Ionicons name="share-outline" size={16} color="#a855f7" style={{ marginRight: 8 }} />
              <Text style={styles.secondaryButtonText}>Condividi Aula</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheetContainer: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 24,
  },
  grabberContainer: {
    alignItems: 'center',
    paddingBottom: 14,
  },
  grabber: {
    width: 38,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  roomIconSquircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  headerInfo: {
    flex: 1,
  },
  titleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  roomTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  campusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  campusBadgeText: {
    color: '#f43f5e',
    fontSize: 11,
    fontWeight: '700',
  },
  buildingSubtitle: {
    fontSize: 13.5,
    color: '#a1a1aa',
    fontWeight: '500',
    marginTop: 2,
  },
  closeCircleButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2c2c2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  /* Map View Preview */
  mapCard: {
    height: 175,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
    position: 'relative',
  },
  mapView: {
    ...StyleSheet.absoluteFill,
  },
  mapFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#18181b',
  },
  mapFallbackText: {
    color: '#71717a',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerPulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(130, 36, 51, 0.35)',
  },
  markerBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SAPIENZA_RED,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 5,
  },
  mapAddressOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(24, 24, 27, 0.88)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  mapAddressText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  /* Insegnamenti Pills */
  subjectsSection: {
    marginBottom: 16,
  },
  subjectsLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  subjectsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subjectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  subjectText: {
    color: '#f4f4f5',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#71717a',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  /* Indicazioni Section (Dual Buttons: Apple & Google) */
  directionSection: {
    marginBottom: 10,
  },
  directionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  directionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  appleButton: {
    backgroundColor: SAPIENZA_RED,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  googleButton: {
    backgroundColor: '#27272a',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  directionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
  },
  googleIconCircle: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  directionTextContainer: {
    flex: 1,
  },
  directionMainText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  directionSubText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  /* Azioni Secondarie Row */
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272a',
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  secondaryButtonActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  secondaryButtonText: {
    color: '#e4e4e7',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
