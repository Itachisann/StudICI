import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_SCREEN_BG } from '@/constants/theme';
import { StudICILogo } from './StudICILogo';
import { checkCourseUpdates, fetchAllCourseData } from '../utils/scraper';
import { refreshCommuterAlarmsInBackground } from '../utils/alarmSync';

interface StartupCheckScreenProps {
  degreeUrl: string;
  degreeName?: string;
  onFinish: () => void;
}

export function StartupCheckScreen({
  degreeUrl,
  degreeName,
  onFinish,
}: StartupCheckScreenProps) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'checking' | 'updating' | 'up_to_date'>('checking');
  const [statusMessage, setStatusMessage] = useState('Verifica orario in corso...');
  const [progressDetail, setProgressDetail] = useState('');

  // Entrance & status transitions
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [translateYAnim] = useState(() => new Animated.Value(12));
  const [checkScale] = useState(() => new Animated.Value(0));
  const [capsulePulse] = useState(() => new Animated.Value(1));
  const finishedRef = useRef(false);
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const safeFinish = useCallback(() => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      capsulePulse.stopAnimation();
      translateYAnim.stopAnimation();
      checkScale.stopAnimation();

      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        fadeAnim.stopAnimation();
        onFinish();
      });
    }
  }, [fadeAnim, capsulePulse, translateYAnim, checkScale, onFinish]);

  useEffect(() => {
    // Elegant iOS Entrance
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.spring(translateYAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle breathing pulse for the dynamic island status capsule
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(capsulePulse, {
          toValue: 1.025,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(capsulePulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoopRef.current = pulseLoop;
    pulseLoop.start();

    // Safety timeout: max 3.5s per il controllo orari
    const checkTimeout = setTimeout(() => {
      safeFinish();
    }, 3500);

    async function runCheck() {
      const startTime = Date.now();
      try {
        const result = await checkCourseUpdates(degreeUrl);

        if (finishedRef.current) return;

        // Assicura una visualizzazione minima di 450ms del loader per evitare flash istantanei
        const elapsed = Date.now() - startTime;
        if (elapsed < 450) {
          await new Promise((r) => setTimeout(r, 450 - elapsed));
        }

        if (finishedRef.current) return;

        clearTimeout(checkTimeout);

        if (result.hasChanges) {
          setStatus('updating');
          setStatusMessage(result.reason || 'Aggiornamento lezioni in corso...');

          await fetchAllCourseData(degreeUrl, true, (stepMsg) => {
            setProgressDetail(stepMsg);
          });

          refreshCommuterAlarmsInBackground(true).catch(() => {});

          setStatus('up_to_date');
          setStatusMessage('Orario aggiornato');

          Animated.spring(checkScale, {
            toValue: 1,
            friction: 5,
            tension: 50,
            useNativeDriver: true,
          }).start();

          setTimeout(() => {
            safeFinish();
          }, 500);
        } else {
          // Nessuna modifica: mostra il feedback positivo "Orario verificato" prima di entrare
          setStatus('up_to_date');
          setStatusMessage('Orario verificato');

          Animated.spring(checkScale, {
            toValue: 1,
            friction: 5,
            tension: 50,
            useNativeDriver: true,
          }).start();

          setTimeout(() => {
            safeFinish();
          }, 550);
        }
      } catch (err) {
        console.warn('Errore durante check di avvio:', err);
        safeFinish();
      }
    }

    runCheck();

    return () => {
      clearTimeout(checkTimeout);
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      capsulePulse.stopAnimation();
      translateYAnim.stopAnimation();
      checkScale.stopAnimation();
      fadeAnim.stopAnimation();
    };
  }, [degreeUrl, fadeAnim, translateYAnim, capsulePulse, checkScale, safeFinish]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: translateYAnim }],
          },
        ]}
      >
        {/* Logo moderno SVG con halo glow coordinato come al primo avvio */}
        <View style={styles.cleanLogoWrapper}>
          <View
            style={[
              styles.cleanLogoGlow,
              { backgroundColor: theme.primary },
            ]}
          />
          <StudICILogo
            size={100}
            withBackground={false}
            primaryColor={theme.primary}
            secondaryColor="#a1a1aa"
          />
        </View>

        {/* Titolo e Dettaglio Corso con tipografia iOS moderna */}
        <Text style={styles.appTitle}>StudICI</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {degreeName || 'Sapienza Università di Roma'}
        </Text>

        {/* Dynamic Island / Liquid Glass Capsule iOS Loader */}
        <Animated.View
          style={[
            styles.capsuleWrapper,
            {
              transform: [{ scale: status === 'checking' ? capsulePulse : 1 }],
            },
          ]}
        >
          <View
            style={[
              styles.glassCapsule,
              status === 'up_to_date' && {
                borderColor: 'rgba(16, 185, 129, 0.35)',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
              },
            ]}
          >
            {status === 'up_to_date' ? (
              <Animated.View style={{ transform: [{ scale: checkScale }], marginRight: 8 }}>
                <Ionicons name="checkmark-circle" size={18} color="#10b981" />
              </Animated.View>
            ) : (
              <ActivityIndicator
                size="small"
                color={theme.primary}
                style={{ marginRight: 8 }}
              />
            )}
            <Text
              style={[
                styles.capsuleText,
                status === 'up_to_date' && { color: '#10b981' },
              ]}
              numberOfLines={1}
            >
              {statusMessage}
            </Text>
          </View>

          {/* Dettaglio Avanzamento se in download */}
          {status === 'updating' && progressDetail ? (
            <View style={styles.detailBadge}>
              <Text style={styles.progressDetailText} numberOfLines={1}>
                {progressDetail}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>

      {/* Footer Minimal iOS */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Sapienza Università di Roma</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UNIFORM_SCREEN_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 28,
  },
  cleanLogoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    position: 'relative',
  },
  cleanLogoGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    opacity: 0.22,
    transform: [{ scale: 1.15 }],
  },
  appTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
    marginBottom: 28,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  capsuleWrapper: {
    alignItems: 'center',
    width: '100%',
    minHeight: 52,
  },
  glassCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 9999,
    backgroundColor: 'rgba(28, 28, 32, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  capsuleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f4f4f5',
    letterSpacing: -0.2,
  },
  detailBadge: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  progressDetailText: {
    fontSize: 11.5,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 44 : 28,
  },
  footerText: {
    fontSize: 12,
    color: '#52525b',
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
