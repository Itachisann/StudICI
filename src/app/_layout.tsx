import React from 'react';
import { Platform, UIManager, StyleSheet } from 'react-native';
import { Tabs as ExpoTabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { NativeTabs } from '@/components/bottom-tabs';

const SAPIENZA_RED = '#822433';

// Rileva se il modulo nativo RNCTabView è compilato nel binario (IPA) o assente (Expo Go)
const isNativeComponentAvailable = 
  Platform.OS === 'ios' && Boolean(UIManager.getViewManagerConfig?.('RNCTabView'));

export default function AppLayout() {
  // 1. Build Nativa IPA (SideStore): usa react-native-bottom-tabs nativo Apple
  if (isNativeComponentAvailable) {
    return (
      <>
        <StatusBar style="light" />
        <NativeTabs
          screenOptions={{
            tabBarActiveTintColor: SAPIENZA_RED,
          }}
        >
          <NativeTabs.Screen
            name="index"
            options={{
              title: 'Orario',
              tabBarIcon: () => ({ sfSymbol: 'calendar' }),
            }}
          />
          <NativeTabs.Screen
            name="settings"
            options={{
              title: 'Corsi',
              tabBarIcon: () => ({ sfSymbol: 'graduationcap' }),
            }}
          />
        </NativeTabs>
      </>
    );
  }

  // 2. Modalità Expo Go: fallback compatibile senza errori di componenti nativi mancanti
  return (
    <>
      <StatusBar style="light" />
      <ExpoTabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            elevation: 0,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
          },
          tabBarBackground: () => (
            <BlurView tint="dark" intensity={95} style={StyleSheet.absoluteFill} />
          ),
          tabBarActiveTintColor: SAPIENZA_RED,
          tabBarInactiveTintColor: '#8e8e93',
        }}
      >
        <ExpoTabs.Screen
          name="index"
          options={{
            title: 'Orario',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" size={size} color={color} />
            ),
          }}
        />
        <ExpoTabs.Screen
          name="settings"
          options={{
            title: 'Corsi',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="school-outline" size={size} color={color} />
            ),
          }}
        />
      </ExpoTabs>
    </>
  );
}
