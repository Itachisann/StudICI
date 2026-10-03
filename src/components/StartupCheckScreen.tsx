import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppLogo } from './AppLogo';
import { checkCourseUpdates, fetchAllCourseData } from '../utils/scraper';

const SAPIENZA_RED = '#822433';

interface StartupCheckScreenProps {
  degreeUrl: string;
  degreeName?: string;
  onFinish: () => void;
}

export function StartupCheckScreen({ degreeUrl, degreeName, onFinish }: StartupCheckScreenProps) {
  const [status, setStatus] = useState<'checking' | 'updating' | 'up_to_date'>('checking');
  const [statusMessage, setStatusMessage] = useState('Verifica aggiornamenti orario...');
  const [progressDetail, setProgressDetail] = useState('');

  const [fadeAnim] = useState(() => new Animated.Value(0));
  const finishedRef = useRef(false);

  const safeFinish = useCallback(() => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      onFinish();
    }
  }, [onFinish]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    // Safety timeout per il solo controllo: max 3.5s per non far attendere l'utente
    const checkTimeout = setTimeout(() => {
      safeFinish();
    }, 3500);

    async function runCheck() {
      try {
        const result = await checkCourseUpdates(degreeUrl);

        if (finishedRef.current) return;

        if (result.hasChanges) {
          clearTimeout(checkTimeout); // Rimuovi il timeout breve durante il download
          setStatus('updating');
          setStatusMessage(result.reason || 'Rilevate modifiche sul foglio ufficiale!');
          
          await fetchAllCourseData(degreeUrl, true, (stepMsg) => {
            setProgressDetail(stepMsg);
          });

          setStatus('up_to_date');
          setStatusMessage('Orario e avvisi aggiornati con successo');
          setTimeout(() => {
            safeFinish();
          }, 300);
        } else {
          // Nessuna modifica rilevata: ingresso immediato senza attese!
          clearTimeout(checkTimeout);
          safeFinish();
        }
      } catch (err) {
        console.warn('Errore durante check di avvio:', err);
        safeFinish();
      }
    }

    runCheck();

    return () => {
      clearTimeout(checkTimeout);
    };
  }, [degreeUrl, fadeAnim, safeFinish]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {/* App Logo */}
        <View style={styles.logoBadge}>
          <AppLogo size={128} />
        </View>

        {/* Title */}
        <Text style={styles.appTitle}>StudICI</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {degreeName || 'Sapienza Università di Roma'}
        </Text>

        {/* Status card */}
        <View style={styles.statusBox}>
          {status === 'up_to_date' ? (
            <Ionicons name="checkmark-circle" size={24} color="#10b981" style={{ marginRight: 10 }} />
          ) : (
            <ActivityIndicator size="small" color={SAPIENZA_RED} style={{ marginRight: 10 }} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusText, status === 'up_to_date' && { color: '#10b981' }]}>
              {statusMessage}
            </Text>
            {status === 'updating' && progressDetail ? (
              <Text style={styles.progressDetailText} numberOfLines={1}>
                {progressDetail}
              </Text>
            ) : null}
          </View>
        </View>
      </Animated.View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Sapienza Università di Roma</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 32,
  },
  logoBadge: {
    width: 128,
    height: 128,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 10,
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8e8e93',
    fontWeight: '500',
    marginBottom: 36,
    textAlign: 'center',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    width: '100%',
    maxWidth: 320,
  },
  statusText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#e4e4e7',
  },
  progressDetailText: {
    fontSize: 11.5,
    color: '#a1a1aa',
    marginTop: 3,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  footerText: {
    fontSize: 12,
    color: '#52525b',
    fontWeight: '500',
  },
});
