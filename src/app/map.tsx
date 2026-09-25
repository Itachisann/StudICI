import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { BlurView } from 'expo-blur';

export default function MapScreen() {
  // Coordinates for Sapienza University main campus
  const sapienzaRegion = {
    latitude: 41.9028,
    longitude: 12.5150,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const aule = [
    { name: 'Facoltà Ingegneria', lat: 41.8931, lng: 12.4930 },
    { name: 'Città Universitaria', lat: 41.9028, lng: 12.5150 },
  ];

  return (
    <View style={styles.container}>
      <MapView 
        style={styles.map} 
        initialRegion={sapienzaRegion}
        showsUserLocation
      >
        {aule.map((aula, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: aula.lat, longitude: aula.lng }}
            title={aula.name}
          />
        ))}
      </MapView>

      <View style={styles.floatingCardContainer}>
        <BlurView tint="dark" intensity={70} style={styles.floatingCard}>
          <Text style={styles.cardTitle}>Navigazione Campus</Text>
          <Text style={styles.cardText}>
            Qui potrai trovare la mappa di Sapienza con le sedi di Ingegneria (es. San Pietro in Vincoli, Città Universitaria) e le aule.
          </Text>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  floatingCardContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
  },
  floatingCard: {
    padding: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cardText: {
    color: '#ddd',
    fontSize: 14,
  }
});
