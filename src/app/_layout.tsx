import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

const SAPIENZA_RED = '#822433';

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false, // Nascondiamo la default label perché è disegnata custom
          tabBarStyle: {
            position: 'absolute',
            bottom: 20, // Margin dal fondo (effetto floating)
            left: 20,
            right: 20,
            height: 64,
            elevation: 0,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            borderRadius: 32,
            overflow: 'hidden', // per non far sbordare il BlurView
          },
          tabBarBackground: () => (
            <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />
          ),
          tabBarActiveTintColor: '#ffffff',
          tabBarInactiveTintColor: '#8e8e93',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Orario',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabItem, focused && styles.tabItemActive]}>
                <Ionicons name="calendar" size={22} color={color} />
                <Text style={[styles.tabLabel, { color }]}>Orario</Text>
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Corsi',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabItem, focused && styles.tabItemActive]}>
                <Ionicons name="school" size={22} color={color} />
                <Text style={[styles.tabLabel, { color }]}>Corsi</Text>
              </View>
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  tabItem: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    width: 90,
    borderRadius: 26,
    marginTop: 24, // Compensa il padding standard
  },
  tabItemActive: {
    backgroundColor: 'rgba(130,36,51,0.85)', // Sapienza red translucido
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  }
});
