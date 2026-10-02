import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';

const SAPIENZA_RED = '#822433';

interface ChannelSegmentedSliderProps {
  items: string[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  maxWidth?: number;
}

export function ChannelSegmentedSlider({
  items,
  selectedIndex,
  onSelectIndex,
  maxWidth = 420,
}: ChannelSegmentedSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [animIndex] = useState(() => new Animated.Value(Math.max(0, selectedIndex)));

  useEffect(() => {
    Animated.spring(animIndex, {
      toValue: Math.max(0, selectedIndex),
      useNativeDriver: true,
      tension: 190,
      friction: 18,
    }).start();
  }, [selectedIndex, animIndex]);

  const numItems = items.length;
  if (numItems === 0) return null;

  const padding = 3;
  const availableWidth = trackWidth > 0 ? trackWidth - padding * 2 : 0;
  const thumbWidth = availableWidth > 0 ? availableWidth / numItems : 0;

  const translateX = animIndex.interpolate({
    inputRange: [0, Math.max(1, numItems - 1)],
    outputRange: [0, Math.max(1, numItems - 1) * thumbWidth],
  });

  return (
    <View
      style={[styles.container, { maxWidth }]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {/* Sliding Thumb: con bordino rosso e sfondo traslucido identico alle pillole */}
      {thumbWidth > 0 && (
        <Animated.View
          style={[
            styles.sliderThumb,
            {
              width: thumbWidth,
              transform: [{ translateX }],
            },
          ]}
        />
      )}

      {/* Segmenti / Pulsanti */}
      <View style={styles.segmentsRow}>
        {items.map((item, index) => {
          const isActive = index === selectedIndex;
          return (
            <TouchableOpacity
              key={index}
              style={styles.segmentButton}
              activeOpacity={0.75}
              onPress={() => onSelectIndex(index)}
            >
              <Text
                style={[styles.segmentText, isActive && styles.segmentTextActive]}
                numberOfLines={1}
              >
                {item}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 36,
    backgroundColor: 'rgba(28, 28, 30, 0.75)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2c2c2e',
    padding: 3,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  sliderThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    backgroundColor: 'rgba(130, 36, 51, 0.45)',
    borderColor: SAPIENZA_RED,
    borderWidth: 1,
    borderRadius: 15,
    shadowColor: SAPIENZA_RED,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentsRow: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
  },
  segmentButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    paddingHorizontal: 6,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  segmentTextActive: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});
