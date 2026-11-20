import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppState, type ColorValue, Platform, StyleSheet, Alert } from 'react-native';
import { Tabs as ExpoTabs, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { NativeTabs } from '@/components/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { linkDeviceWithCode, subscribeToAppReset, subscribeToLiveSync } from '@/utils/cloudSync';
import { subscribeToDegreeChanges, warmCourseStartupData } from '@/utils/scraper';
import { refreshCommuterAlarmsInBackground } from '@/utils/alarmSync';
import { pullExternalAppleCalendarChanges } from '@/utils/appleCalendar';
import { prefetchViaggioStartupData } from '@/utils/commuterOptimizer';
import { subscribeToCommuterChanges } from '@/utils/commuterStorage';
import { subscribeToExcludedLessonsChanges } from '@/utils/excludedLessons';
import { subscribeToManualEventsChanges } from '@/utils/manualEvents';
import {
  emitStrikeNotificationTap,
  ensureStrikeNotificationHandler,
  syncStrikeNotifications,
} from '@/utils/strikeNotifications';
import { DisruptionCategory } from '@/types/disruptions';
import { OnboardingCourseSelector } from '@/components/OnboardingCourseSelector';
import { StartupCheckScreen } from '@/components/StartupCheckScreen';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { UNIFORM_SCREEN_BG } from '@/constants/theme';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import {
  DarkTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';

// Mantiene la splash nativa visibile finché il primo render reale non è pronto
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 250, fade: true });
// Colore di sfondo nativo della finestra (evita il nero di default tra splash e prima schermata)
SystemUI.setBackgroundColorAsync(UNIFORM_SCREEN_BG).catch(() => {});

const ROOT_NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: UNIFORM_SCREEN_BG,
    card: UNIFORM_SCREEN_BG,
  },
};

ensureStrikeNotificationHandler();

// In Expo Go i moduli nativi personalizzati non sono inclusi nel runtime condiviso.
// Nell'IPA (standalone / development build su iOS), i native-bottom-tabs sono compilati e attivi.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeComponentAvailable = Platform.OS === 'ios' && !isExpoGo;

const NATIVE_TAB_OPTIONS = {
  index: { title: 'Orario', tabBarIcon: () => ({ sfSymbol: 'calendar' as const }) },
  viaggio: { title: 'Viaggio', tabBarIcon: () => ({ sfSymbol: 'tram.fill' as const }) },
  aule: { title: 'Aule', tabBarIcon: () => ({ sfSymbol: 'map' as const }) },
  settings: { title: 'Profilo', tabBarIcon: () => ({ sfSymbol: 'person.crop.circle' as const }) },
};

const EXPO_TAB_OPTIONS = {
  index: {
    title: 'Orario',
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
      <Ionicons name="calendar-outline" size={size} color={color} />
    ),
  },
  viaggio: {
    title: 'Viaggio',
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
      <Ionicons name="train-outline" size={size} color={color} />
    ),
  },
  aule: {
    title: 'Aule',
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
      <Ionicons name="map-outline" size={size} color={color} />
    ),
  },
  settings: {
    title: 'Profilo',
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
      <Ionicons name="person-circle-outline" size={size} color={color} />
    ),
  },
};

const renderExpoTabBarBackground = () => (
  <BlurView tint="dark" intensity={95} style={StyleSheet.absoluteFill} />
);

function AppLayoutContent() {
  const { theme } = useTheme();
  const [degreeUrl, setDegreeUrl] = useState<string | null>(null);
  const [degreeName, setDegreeName] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [startupCheckDone, setStartupCheckDone] = useState(false);

  const checkOnboarding = useCallback(async () => {
    try {
      const url = await AsyncStorage.getItem('selectedDegreeUrl');
      const name = await AsyncStorage.getItem('selectedDegreeName');
      if (url) {
        await warmCourseStartupData(url).catch(() => {});
      }
      setStartupCheckDone(true); // L'onboarding ha appena scaricato tutto al 100%
      setDegreeUrl(url);
      if (name) setDegreeName(name);
    } catch {}
    setIsReady(true);
  }, []);

  useEffect(() => {
    const handleUrl = async (urlStr: string) => {
      try {
        const parsed = Linking.parse(urlStr);
        const code = parsed.queryParams?.code;
        if (typeof code === 'string' && code.trim()) {
          const res = await linkDeviceWithCode(code);
          if (res.success) {
            await checkOnboarding();
          } else {
            Alert.alert("Errore Collegamento", res.message);
          }
        }
      } catch {}
    };

    Linking.getInitialURL().then(initial => {
      if (initial) handleUrl(initial);
    });

    const sub = Linking.addEventListener('url', (event) => {
      if (event.url) handleUrl(event.url);
    });

    return () => sub.remove();
  }, [checkOnboarding]);

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

    const unsubDegree = subscribeToDegreeChanges((url, name) => {
      if (!isMounted) return;
      if (name !== undefined) {
        setDegreeName(name);
      }
      setDegreeUrl((prev) => {
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
    });

    return () => {
      isMounted = false;
      unsubDegree();
    };
  }, []);

  // Ascolto immediato del ripristino app o modifiche live sync per tornare subito a Onboarding
  useEffect(() => {
    const unsubReset = subscribeToAppReset(() => {
      setDegreeUrl(null);
      setDegreeName('');
      setStartupCheckDone(false);
    });

    const unsubSync = subscribeToLiveSync((_status, updated) => {
      if (updated) {
        AsyncStorage.multiGet(['selectedDegreeUrl', 'selectedDegreeName'])
          .then((pairs) => {
            const url = pairs[0]?.[1] || null;
            const name = pairs[1]?.[1] || '';
            if (!url) {
              setDegreeUrl(null);
              setDegreeName('');
              setStartupCheckDone(false);
            } else {
              setDegreeName(name);
              setDegreeUrl((prev) => {
                if (prev !== url) {
                  setStartupCheckDone(true);
                  return url;
                }
                return prev;
              });
            }
          })
          .catch(() => {});
      }
    });

    return () => {
      unsubReset();
      unsubSync();
    };
  }, []);

  const handleStrikeNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse | null | undefined) => {
      if (!response) return;
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      if (data?.type !== 'strike_alert') return;

      emitStrikeNotificationTap({
        eventId:
          typeof data.strikeEventId === 'string' ? data.strikeEventId : null,
        strikeKey:
          typeof data.strikeKey === 'string' ? data.strikeKey : null,
        strikeDateIso:
          typeof data.strikeStartDate === 'string'
            ? data.strikeStartDate
            : null,
        category:
          typeof data.strikeCategory === 'string'
            ? (data.strikeCategory as DisruptionCategory)
            : null,
      });

      Notifications.clearLastNotificationResponseAsync().catch(() => {});
      try {
        router.navigate('/viaggio');
      } catch {}
    },
    [],
  );

  useEffect(() => {
    if (!degreeUrl || !startupCheckDone) return;
    // Aggiorna in background sveglie native, avvisi scioperi (-7g / -1g) e cache Viaggio
    prefetchViaggioStartupData(degreeUrl).catch(() => {});
    refreshCommuterAlarmsInBackground().catch(() => {});
    pullExternalAppleCalendarChanges()
      .catch(() => {})
      .finally(() => {
        syncStrikeNotifications().catch(() => {});
      });

    try {
      const lastResponse = Notifications.getLastNotificationResponse();
      if (lastResponse) {
        handleStrikeNotificationResponse(lastResponse);
      }
    } catch {}

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleStrikeNotificationResponse(response);
      },
    );

    const unsubCommuter = subscribeToCommuterChanges((nextCfg) => {
      syncStrikeNotifications(undefined, {
        promptIfNeeded: Boolean(
          nextCfg.enabled &&
            (nextCfg.strikeAlerts?.notify7DaysBefore ||
              nextCfg.strikeAlerts?.notify1DayBefore),
        ),
      }).catch(() => {});
    });
    const unsubExcluded = subscribeToExcludedLessonsChanges(() => {
      syncStrikeNotifications().catch(() => {});
    });
    const unsubManual = subscribeToManualEventsChanges(() => {
      syncStrikeNotifications().catch(() => {});
    });

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        prefetchViaggioStartupData(degreeUrl).catch(() => {});
        refreshCommuterAlarmsInBackground().catch(() => {});
        pullExternalAppleCalendarChanges()
          .catch(() => {})
          .finally(() => {
            syncStrikeNotifications().catch(() => {});
          });
      }
    });
    return () => {
      sub.remove();
      responseSub.remove();
      unsubCommuter();
      unsubExcluded();
      unsubManual();
    };
  }, [degreeUrl, startupCheckDone, handleStrikeNotificationResponse]);

  // Nasconde la splash solo quando i dati iniziali sono pronti e la prima schermata è stata montata
  useEffect(() => {
    if (!isReady) return;
    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        SplashScreen.hide();
      }, 60);
    });
    return () => cancelAnimationFrame(frame);
  }, [isReady, startupCheckDone, degreeUrl]);

  // Mantiene tutte e 4 le schermate montate e visivamente pronte in memoria (freezeOnBlur: false, lazy: false)
  // per evitare il flash nero causato dalla sospensione React Freeze/Suspense prima del cambio tab nativo.
  const nativeScreenOptions = useMemo(
    () => ({
      tabBarActiveTintColor: theme.primary,
      lazy: false,
      freezeOnBlur: false,
      sceneStyle: { backgroundColor: UNIFORM_SCREEN_BG },
    }),
    [theme.primary],
  );

  const expoScreenOptions = useMemo(
    () => ({
      headerShown: false,
      lazy: false,
      freezeOnBlur: false,
      animation: 'none' as const,
      sceneStyle: { backgroundColor: UNIFORM_SCREEN_BG },
      tabBarStyle: {
        position: 'absolute' as const,
        bottom: 0,
        left: 0,
        right: 0,
        elevation: 0,
        backgroundColor: 'transparent',
        borderTopWidth: 0,
        display: (!degreeUrl ? 'none' : 'flex') as 'none' | 'flex',
      },
      tabBarBackground: renderExpoTabBarBackground,
      tabBarActiveTintColor: theme.primary,
      tabBarInactiveTintColor: '#8e8e93',
    }),
    [theme.primary, degreeUrl],
  );

  if (!isReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: UNIFORM_SCREEN_BG }} />
    );
  }

  // Schermata Iniziale: Seleziona Corso (Nasconde interamente le Tab al primo avvio o dopo reset)
  if (!degreeUrl) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: UNIFORM_SCREEN_BG }}>
        <StatusBar style="light" />
        <OnboardingCourseSelector onComplete={checkOnboarding} />
      </GestureHandlerRootView>
    );
  }

  // Schermata di Avvio con Controllo Aggiornamenti Foglio (eseguita una volta ad avvio sessione)
  if (!startupCheckDone) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: UNIFORM_SCREEN_BG }}>
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
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: UNIFORM_SCREEN_BG }}>
        <StatusBar style="light" />
        <NativeTabs screenOptions={nativeScreenOptions}>
          <NativeTabs.Screen name="index" options={NATIVE_TAB_OPTIONS.index} />
          <NativeTabs.Screen name="viaggio" options={NATIVE_TAB_OPTIONS.viaggio} />
          <NativeTabs.Screen name="aule" options={NATIVE_TAB_OPTIONS.aule} />
          <NativeTabs.Screen name="settings" options={NATIVE_TAB_OPTIONS.settings} />
        </NativeTabs>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: UNIFORM_SCREEN_BG }}>
      <StatusBar style="light" />
      <ExpoTabs detachInactiveScreens={false} screenOptions={expoScreenOptions}>
        <ExpoTabs.Screen name="index" options={EXPO_TAB_OPTIONS.index} />
        <ExpoTabs.Screen name="viaggio" options={EXPO_TAB_OPTIONS.viaggio} />
        <ExpoTabs.Screen name="aule" options={EXPO_TAB_OPTIONS.aule} />
        <ExpoTabs.Screen name="settings" options={EXPO_TAB_OPTIONS.settings} />
      </ExpoTabs>
    </GestureHandlerRootView>
  );
}

export default function AppLayout() {
  return (
    <ThemeProvider>
      <NavigationThemeProvider value={ROOT_NAV_THEME}>
        <AppLayoutContent />
      </NavigationThemeProvider>
    </ThemeProvider>
  );
}
