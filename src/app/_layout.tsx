import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

const CORAL = '#FF6B6B';
const INACTIVE_COLOR = 'rgba(255, 255, 255, 0.6)';

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: CORAL,
          tabBarInactiveTintColor: INACTIVE_COLOR,
          tabBarShowLabel: true,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarItemStyle: styles.tabBarItem,
          tabBarStyle: styles.tabBar,
          tabBarBackground: () => (
            <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
          ),
        }}
      >
        {/* 1. Percorso */}
        <Tabs.Screen
          name="percorso"
          options={{
            title: 'Percorso',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
                <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />

        {/* 2. Dashboard (Orario & Corsi) */}
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
                <Ionicons name={focused ? 'school' : 'school-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />

        {/* 3. Libretto */}
        <Tabs.Screen
          name="libretto"
          options={{
            title: 'Libretto',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
                <Ionicons name={focused ? 'document-text' : 'document-text-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />

        {/* 4. Strumenti IA */}
        <Tabs.Screen
          name="ia"
          options={{
            title: 'Strumenti IA',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
                <Ionicons name={focused ? 'sparkles' : 'sparkles-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />

        {/* 5. Impostazioni */}
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Impostazioni',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
                <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={color} />
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
  tabBar: {
    position: 'absolute',
    bottom: 25,
    left: 20,
    right: 20,
    height: 75,
    borderRadius: 40,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarItem: {
    height: 75,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 2,
  },
  iconContainer: {
    width: 44,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainerActive: {
    backgroundColor: 'rgba(255, 107, 107, 0.2)', // Effetto bottone acceso corallo
  },
});
