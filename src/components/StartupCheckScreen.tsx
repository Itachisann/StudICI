import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
  Alert,
  Linking,
  AppState,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { UNIFORM_SCREEN_BG } from '@/constants/theme';
import { StudICILogo } from './StudICILogo';
import { checkCourseUpdates, fetchAllCourseData } from '../utils/scraper';
import { refreshCommuterAlarmsInBackground } from '../utils/alarmSync';
import {
  checkForAppUpdate,
  GITHUB_LATEST_RELEASE_URL,
  AppUpdateInfo,
} from '../utils/updateChecker';

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
  const [status, setStatus] = useState<'checking' | 'updating' | 'up_to_date' | 'blocked'>('checking');
  const [statusMessage, setStatusMessage] = useState('Controllo cambiamenti orario');
  const [progressDetail, setProgressDetail] = useState('');
  const [blockingUpdate, setBlockingUpdate] = useState<AppUpdateInfo | null>(null);

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

    // Safety timeout: max 3.5s per il controllo orari (annullato se aggiornamento bloccante)
    let checkTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      safeFinish();
    }, 3500);

    async function runCheck() {
      try {
        // Controllo simultaneo di aggiornamenti app obbligatori e orario lezioni
        const [appUpdateRes, courseUpdateRes] = await Promise.allSettled([
          checkForAppUpdate(),
          checkCourseUpdates(degreeUrl),
        ]);

        if (finishedRef.current) return;

        // 1. Se è presente un aggiornamento app obbligatorio/bloccante
        if (
          appUpdateRes.status === 'fulfilled' &&
          appUpdateRes.value.hasUpdate &&
          appUpdateRes.value.isMajor
        ) {
          if (checkTimeout) {
            clearTimeout(checkTimeout);
            checkTimeout = null;
          }
          const updateInfo = appUpdateRes.value;
          setBlockingUpdate(updateInfo);
          setStatus('blocked');
          setStatusMessage('Aggiornamento obbligatorio');

          if (pulseLoopRef.current) {
            pulseLoopRef.current.stop();
            pulseLoopRef.current = null;
          }

          const showBlockingAlert = () => {
            Alert.alert(
              'Aggiornamento disponibile',
              `È disponibile la nuova versione v${updateInfo.latestVersion} di StudICI (installata: v${updateInfo.currentVersion}).\n\nPer continuare a utilizzare l'applicazione è necessario effettuare l'aggiornamento.`,
              [
                {
                  text: 'Aggiorna',
                  style: 'default',
                  onPress: () => {
                    Linking.openURL(
                      updateInfo.ipaUrl ||
                        updateInfo.htmlUrl ||
                        GITHUB_LATEST_RELEASE_URL
                    );
                    setTimeout(showBlockingAlert, 1000);
                  },
                },
              ],
              { cancelable: false }
            );
          };

          showBlockingAlert();
          // Blocca definitivamente l'avanzamento: l'app non va oltre la verifica orario
          return;
        }

        // 2. Se non c'è aggiornamento bloccante, procedi normalmente con l'orario
        if (courseUpdateRes.status === 'fulfilled' && courseUpdateRes.value.hasChanges) {
          if (checkTimeout) {
            clearTimeout(checkTimeout);
            checkTimeout = null;
          }
          setStatus('updating');
          setStatusMessage(courseUpdateRes.value.reason || 'Aggiornamento lezioni in corso...');

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
          }, 450);
        } else {
          if (checkTimeout) {
            clearTimeout(checkTimeout);
            checkTimeout = null;
          }
          safeFinish();
        }
      } catch (err) {
        console.warn('Errore durante check di avvio:', err);
        safeFinish();
      }
    }

    runCheck();

    return () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
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

  // Se l'app è bloccata e l'utente ritorna in primo piano, riproponi l'alert non ignorabile
  useEffect(() => {
    if (status !== 'blocked' || !blockingUpdate) return;

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        Alert.alert(
          'Aggiornamento disponibile',
          `È disponibile la nuova versione v${blockingUpdate.latestVersion} di StudICI (installata: v${blockingUpdate.currentVersion}).\n\nPer continuare a utilizzare l'applicazione è necessario effettuare l'aggiornamento.`,
          [
            {
              text: 'Aggiorna',
              style: 'default',
              onPress: () => {
                Linking.openURL(
                  blockingUpdate.ipaUrl ||
                    blockingUpdate.htmlUrl ||
                    GITHUB_LATEST_RELEASE_URL
                );
              },
            },
          ],
          { cancelable: false }
        );
      }
    });

    return () => {
      sub.remove();
    };
  }, [status, blockingUpdate]);

  const handleCapsulePress = () => {
    if (status === 'blocked' && blockingUpdate) {
      Alert.alert(
        'Aggiornamento disponibile',
        `È disponibile la nuova versione v${blockingUpdate.latestVersion} di StudICI (installata: v${blockingUpdate.currentVersion}).\n\nPer continuare a utilizzare l'applicazione è necessario effettuare l'aggiornamento.`,
        [
          {
            text: 'Aggiorna',
            style: 'default',
            onPress: () => {
              Linking.openURL(
                blockingUpdate.ipaUrl ||
                  blockingUpdate.htmlUrl ||
                  GITHUB_LATEST_RELEASE_URL
              );
            },
          },
        ],
        { cancelable: false }
      );
    }
  };

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
          <TouchableOpacity
            activeOpacity={status === 'blocked' ? 0.7 : 1}
            onPress={handleCapsulePress}
            disabled={status !== 'blocked'}
          >
            <View
              style={[
                styles.glassCapsule,
                status === 'up_to_date' && {
                  borderColor: 'rgba(16, 185, 129, 0.35)',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                },
                status === 'blocked' && {
                  borderColor: 'rgba(239, 68, 68, 0.45)',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                },
              ]}
            >
              {status === 'up_to_date' ? (
                <Animated.View style={{ transform: [{ scale: checkScale }], marginRight: 8 }}>
                  <Ionicons name="checkmark-circle" size={18} color="#10b981" />
                </Animated.View>
              ) : status === 'blocked' ? (
                <Ionicons name="alert-circle" size={18} color="#ef4444" style={{ marginRight: 8 }} />
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
                  status === 'blocked' && { color: '#ef4444' },
                ]}
                numberOfLines={1}
              >
                {statusMessage}
              </Text>
            </View>
          </TouchableOpacity>

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
