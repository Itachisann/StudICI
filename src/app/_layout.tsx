import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

const SAPIENZA_RED = '#822433';

export default function AppLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false, // Rimuove la navbar superiore
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
            <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />
          ),
          tabBarActiveTintColor: SAPIENZA_RED,
          tabBarInactiveTintColor: '#666666',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Orario',
            tabBarIcon: ({ color }) => <Ionicons name="calendar" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Corsi',
            tabBarIcon: ({ color }) => <Ionicons name="school" size={24} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // Sfondo scuro e pulito
  }
});
