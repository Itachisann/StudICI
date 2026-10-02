import React, { useState, useEffect, useCallback } from 'react';
import { Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { Tabs as ExpoTabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { NativeTabs } from '@/components/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OnboardingCourseSelector } from '@/components/OnboardingCourseSelector';
import { StartupCheckScreen } from '@/components/StartupCheckScreen';

const SAPIENZA_RED = '#822433';

// In Expo Go i moduli nativi personalizzati non sono inclusi nel runtime condiviso.
// Nell'IPA (standalone / development build su iOS), i native-bottom-tabs sono compilati e attivi.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === 'ios' && !isExpoGo;

export default function AppLayout() {
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [degreeName, setDegreeName] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [startupCheckDone, setStartupCheckDone] = useState(false);

  const checkOnboarding = useCallback(async () => {
    try {
      const url = await AsyncStorage.getItem('selectedDegreeUrl');
      const name = await AsyncStorage.getItem('selectedDegreeName');
      setStartupCheckDone(true); // L'onboarding ha appena scaricato tutto al 100%
      setDegreeUrl(url);
      if (name) setDegreeName(name);
    } catch {}
    setIsReady(true);
  }, []);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      AsyncStorage.getItem('selectedDegreeUrl'),
      AsyncStorage.getItem('selectedDegreeName')
    ]).then(([url, name]) => {
      if (isMounted) {
        setDegreeUrl(url);
        if (name) setDegreeName(name);
        setIsReady(true);
      }
    }).catch(() => {
      if (isMounted) setIsReady(true);
    });

    const interval = setInterval(() => {
      AsyncStorage.getItem('selectedDegreeUrl').then(url => {
        if (isMounted) {
          setDegreeUrl(prev => {
            if (prev !== url) {
              if (!url) {
                setStartupCheckDone(false);
              } else {
                // Se il corso è appena stato configurato/cambiato, i dati sono già freschi al 100%
                setStartupCheckDone(true);
              }
              return url;
            }
            return prev;
          });
        }
      }).catch(() => {});
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!isReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#111111', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={SAPIENZA_RED} />
      </GestureHandlerRootView>
    );
  }

  // Schermata Iniziale: Seleziona Corso (Nasconde interamente le Tab al primo avvio o dopo reset)
  if (!degreeUrl) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <OnboardingCourseSelector onComplete={checkOnboarding} />
      </GestureHandlerRootView>
    );
  }

  // Schermata di Avvio con Controllo Aggiornamenti Foglio (eseguita una volta ad avvio sessione)
  if (!startupCheckDone) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <StartupCheckScreen
          degreeUrl={degreeUrl}
          degreeName={degreeName}
          onFinish={() => setStartupCheckDone(true)}
        />
      </GestureHandlerRootView>
    );
  }

  if (isNativeComponentAvailable) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <NativeTabs screenOptions={{ tabBarActiveTintColor: SAPIENZA_RED }}>
          <NativeTabs.Screen name="index" options={{ title: 'Orario', tabBarIcon: () => ({ sfSymbol: 'calendar' }) }} />
          <NativeTabs.Screen name="aule" options={{ title: 'Aule', tabBarIcon: () => ({ sfSymbol: 'map' }) }} />
          <NativeTabs.Screen name="settings" options={{ title: 'Profilo', tabBarIcon: () => ({ sfSymbol: 'person.crop.circle' }) }} />
        </NativeTabs>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <ExpoTabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            position: 'absolute', bottom: 0, left: 0, right: 0, elevation: 0,
            backgroundColor: 'transparent', borderTopWidth: 0,
            display: !degreeUrl ? 'none' : 'flex' // Nasconde la tab bar anche in /settings se in fase di onboarding
          },
          tabBarBackground: () => <BlurView tint="dark" intensity={95} style={StyleSheet.absoluteFill} />,
          tabBarActiveTintColor: SAPIENZA_RED,
          tabBarInactiveTintColor: '#8e8e93',
        }}
      >
        <ExpoTabs.Screen name="index" options={{ title: 'Orario', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }} />
        <ExpoTabs.Screen name="aule" options={{ title: 'Aule', tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} /> }} />
        <ExpoTabs.Screen name="settings" options={{ title: 'Profilo', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
      </ExpoTabs>
    </GestureHandlerRootView>
  );
}
