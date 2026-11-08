import React, { useCallback, useMemo } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

interface SwipeToDeleteRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  onPress?: () => void;
  enabled?: boolean;
  marginBottom?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

const SNAP_OPEN_WIDTH = 76;
const DELETE_DRAG_THRESHOLD = 92;
const DELETE_VELOCITY_THRESHOLD = -500;

export function SwipeToDeleteRow({
  children,
  onDelete,
  onPress,
  enabled = true,
  marginBottom = 10,
  borderRadius = 16,
  style,
}: SwipeToDeleteRowProps) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const measuredWidth = useSharedValue(360);
  const measuredHeight = useSharedValue(0);

  const isCollapsing = useSharedValue(false);
  const rowHeight = useSharedValue(0);
  const rowMarginBottom = useSharedValue(marginBottom);
  const rowOpacity = useSharedValue(1);

  const handleConfirmDelete = useCallback(() => {
    onDelete();
  }, [onDelete]);

  const handleCardLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (isCollapsing.get()) return;
      const { width, height } = e.nativeEvent.layout;
      if (width > 0) {
        measuredWidth.set(width);
      }
      if (height > 0) {
        measuredHeight.set(height);
        rowHeight.set(height);
      }
    },
    [isCollapsing, measuredHeight, measuredWidth, rowHeight]
  );

  const triggerCollapseOnUI = useCallback(() => {
    'worklet';
    if (isCollapsing.get()) return;
    isCollapsing.set(true);

    if (measuredHeight.get() <= 0) {
      runOnJS(handleConfirmDelete)();
      return;
    }

    translateX.set(
      withTiming(-measuredWidth.get() - 24, {
        duration: 170,
        easing: Easing.out(Easing.cubic),
      })
    );
    rowOpacity.set(
      withTiming(0, {
        duration: 170,
        easing: Easing.out(Easing.quad),
      })
    );
    rowMarginBottom.set(
      withTiming(0, {
        duration: 190,
        easing: Easing.out(Easing.cubic),
      })
    );
    rowHeight.set(
      withTiming(
        0,
        {
          duration: 190,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) {
            runOnJS(handleConfirmDelete)();
          }
        }
      )
    );
  }, [
    handleConfirmDelete,
    isCollapsing,
    measuredHeight,
    measuredWidth,
    rowHeight,
    rowMarginBottom,
    rowOpacity,
    translateX,
  ]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          if (isCollapsing.get()) return;
          startX.set(translateX.get());
        })
        .onUpdate((e) => {
          if (isCollapsing.get()) return;
          const rawX = startX.get() + e.translationX;
          if (rawX > 0) {
            translateX.set(rawX * 0.15);
          } else {
            translateX.set(rawX);
          }
        })
        .onEnd((e) => {
          if (isCollapsing.get()) return;

          const currentX = translateX.get();
          const shouldDelete =
            currentX <= -DELETE_DRAG_THRESHOLD ||
            (e.velocityX <= DELETE_VELOCITY_THRESHOLD && currentX <= -36);

          if (shouldDelete) {
            triggerCollapseOnUI();
            return;
          }

          if (currentX <= -SNAP_OPEN_WIDTH * 0.5 && e.velocityX <= 200) {
            translateX.set(
              withSpring(-SNAP_OPEN_WIDTH, {
                damping: 24,
                stiffness: 280,
                mass: 0.7,
              })
            );
          } else {
            translateX.set(
              withSpring(0, {
                damping: 26,
                stiffness: 300,
                mass: 0.7,
              })
            );
          }
        }),
    [enabled, isCollapsing, startX, translateX, triggerCollapseOnUI]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(enabled)
        .maxDistance(8)
        .onEnd(() => {
          'worklet';
          if (isCollapsing.get()) return;
          if (Math.abs(translateX.get()) > 4) {
            translateX.set(
              withSpring(0, {
                damping: 26,
                stiffness: 300,
                mass: 0.7,
              })
            );
            return;
          }
          if (onPress) {
            runOnJS(onPress)();
          }
        }),
    [enabled, isCollapsing, onPress, translateX]
  );

  const composedGesture = useMemo(() => {
    if (!onPress) return panGesture;
    return Gesture.Exclusive(panGesture, tapGesture);
  }, [panGesture, tapGesture, onPress]);

  const outerAnimatedStyle = useAnimatedStyle(() => {
    if (!isCollapsing.get()) {
      return {
        marginBottom,
        opacity: 1,
      };
    }
    return {
      height: rowHeight.get(),
      marginBottom: rowMarginBottom.get(),
      opacity: rowOpacity.get(),
    };
  });

  const foregroundAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const redBackgroundStyle = useAnimatedStyle(() => {
    const dragAmount = Math.max(0, -translateX.get());
    return {
      opacity: dragAmount > 0.5 ? 1 : 0,
    };
  });

  const trashContainerStyle = useAnimatedStyle(() => {
    const dragAmount = Math.max(0, -translateX.get());
    return {
      width: Math.max(SNAP_OPEN_WIDTH, dragAmount),
    };
  });

  const iconAnimatedStyle = useAnimatedStyle(() => {
    const dragAmount = Math.max(0, -translateX.get());
    const scale = interpolate(
      dragAmount,
      [0, 24, SNAP_OPEN_WIDTH, DELETE_DRAG_THRESHOLD, 180],
      [0.3, 0.75, 1, 1.15, 1.2],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      dragAmount,
      [0, 16, 40],
      [0, 0.5, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const handleTrashPress = useCallback(() => {
    triggerCollapseOnUI();
  }, [triggerCollapseOnUI]);

  return (
    <Animated.View
      style={[
        styles.outerContainer,
        { borderRadius },
        style,
        outerAnimatedStyle,
      ]}
    >
      {/* Sfondo rosso continuo che copre esattamente l'area della card */}
      <Animated.View
        style={[
          styles.redBackground,
          redBackgroundStyle,
        ]}
      >
        <Animated.View
          style={[
            styles.trashContainer,
            trashContainerStyle,
          ]}
        >
          <Pressable
            style={styles.trashPressable}
            onPress={handleTrashPress}
            accessibilityRole="button"
            accessibilityLabel="Elimina"
          >
            <Animated.View style={iconAnimatedStyle}>
              <Ionicons name="trash" size={22} color="#ffffff" />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Animated.View>

      {/* Contenuto della card trascinabile */}
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          onLayout={handleCardLayout}
          style={[foregroundAnimatedStyle, { width: '100%' }]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  redBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ff3b30',
    overflow: 'hidden',
  },
  trashContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trashPressable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
