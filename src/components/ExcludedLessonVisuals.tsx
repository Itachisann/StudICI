import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  TextLayoutEvent,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  SharedValue,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

interface MeasuredStrikeLine {
  x: number;
  width: number;
  strikeTop: number;
}

/**
 * Condivide una progress value animata [0 -> 1] per lo stato escluso di una lezione.
 * Parte immediatamente al valore corretto su mount e anima solo quando cambia lo stato live.
 */
export function useExcludedProgress(
  isExcluded: boolean,
  delayOnExcludeMs = 0,
): SharedValue<number> {
  const progress = useSharedValue(isExcluded ? 1 : 0);
  const prevExcludedRef = useRef(isExcluded);

  useEffect(() => {
    if (prevExcludedRef.current === isExcluded) return;
    prevExcludedRef.current = isExcluded;

    const anim = withTiming(isExcluded ? 1 : 0, {
      duration: isExcluded ? 420 : 300,
      easing: Easing.out(Easing.cubic),
    });

    progress.value =
      isExcluded && delayOnExcludeMs > 0
        ? withDelay(delayOnExcludeMs, anim)
        : anim;
  }, [isExcluded, delayOnExcludeMs, progress]);

  return progress;
}

interface StrikeLineSegmentProps {
  x: number;
  top: number;
  width: number;
  thickness: number;
  index: number;
  total: number;
  progress: SharedValue<number>;
  color: string;
}

function StrikeLineSegment({
  x,
  top,
  width,
  thickness,
  index,
  total,
  progress,
  color,
}: StrikeLineSegmentProps) {
  const animatedBarStyle = useAnimatedStyle(() => {
    const start = total <= 1 ? 0 : (index / total) * 0.9;
    const end =
      total <= 1 ? 1 : Math.min(1, ((index + 1) / total) * 0.9 + 0.1);
    const local = interpolate(
      progress.value,
      [start, end],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const translateX = interpolate(local, [0, 1], [-width, 0]);
    return {
      opacity: local > 0.01 ? 1 : 0,
      transform: [{ translateX }],
    };
  }, [width, index, total]);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x,
        top,
        width,
        height: thickness,
        borderRadius: thickness / 2,
        overflow: 'hidden',
      }}
    >
      <Reanimated.View
        style={[
          {
            width: '100%',
            height: '100%',
            borderRadius: thickness / 2,
            backgroundColor: color,
          },
          animatedBarStyle,
        ]}
      />
    </View>
  );
}

interface AnimatedStrikethroughTextProps {
  children: string;
  progress: SharedValue<number>;
  normalColor: string;
  excludedColor: string;
  strikeColor?: string;
  strikeThickness?: number;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Testo animato con barratura progressiva da sinistra a destra riga per riga
 * tramite coordinate reali da onTextLayout (con fallback geometrico automatico).
 */
export function AnimatedStrikethroughText({
  children,
  progress,
  normalColor,
  excludedColor,
  strikeColor = 'rgba(142, 142, 148, 0.88)',
  strikeThickness = 2,
  numberOfLines,
  style,
  containerStyle,
}: AnimatedStrikethroughTextProps) {
  const [measuredLines, setMeasuredLines] = useState<MeasuredStrikeLine[]>([]);
  const [containerBox, setContainerBox] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  const cleanTextStyle = useMemo<TextStyle>(() => {
    const flattened = (StyleSheet.flatten(style) || {}) as TextStyle;
    const {
      flex: _ignoredFlex,
      textDecorationLine: _ignoredDeco,
      color: _ignoredColor,
      ...rest
    } = flattened;
    return rest;
  }, [style]);

  const animatedTextColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [normalColor, excludedColor],
    ),
  }), [normalColor, excludedColor]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerBox((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  };

  const handleTextLayout = (e: TextLayoutEvent) => {
    const rawLines = e.nativeEvent?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      setMeasuredLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const visibleLines =
      typeof numberOfLines === 'number' && numberOfLines > 0
        ? rawLines.slice(0, numberOfLines)
        : rawLines;

    const maxContainerWidth = containerBox.width > 0 ? containerBox.width : 999;
    const computed: MeasuredStrikeLine[] = visibleLines
      .filter((line) => typeof line.width === 'number' && line.width > 1)
      .map((line) => {
        const lineTop = typeof line.y === 'number' ? line.y : 0;
        const lineHeight =
          typeof line.height === 'number' && line.height > 0 ? line.height : 18;
        const rawCenterOffset =
          typeof line.ascender === 'number' &&
          typeof line.capHeight === 'number' &&
          line.capHeight > 0
            ? line.ascender - line.capHeight * 0.43
            : lineHeight * 0.52;
        const clampedCenterOffset = Math.min(
          lineHeight * 0.64,
          Math.max(lineHeight * 0.36, rawCenterOffset),
        );
        const startX = Math.max(0, (line.x ?? 0) - 1);
        const availableWidth = Math.max(4, maxContainerWidth - startX);
        const barWidth = Math.min(availableWidth, Math.max(4, line.width + 2));

        return {
          x: startX,
          width: barWidth,
          strikeTop: Math.max(0, lineTop + clampedCenterOffset - strikeThickness / 2),
        };
      });

    setMeasuredLines((prev) => {
      if (
        prev.length === computed.length &&
        prev.every(
          (item, idx) =>
            Math.abs(item.x - computed[idx].x) < 0.5 &&
            Math.abs(item.width - computed[idx].width) < 0.5 &&
            Math.abs(item.strikeTop - computed[idx].strikeTop) < 0.5,
        )
      ) {
        return prev;
      }
      return computed;
    });
  };

  const linesToRender: MeasuredStrikeLine[] =
    measuredLines.length > 0
      ? measuredLines
      : containerBox.width > 0 && containerBox.height > 0
        ? [
            {
              x: 0,
              width: containerBox.width,
              strikeTop: Math.max(
                0,
                Math.min(
                  containerBox.height * 0.5,
                  (typeof cleanTextStyle.lineHeight === 'number'
                    ? cleanTextStyle.lineHeight
                    : 18) * 0.52,
                ) -
                  strikeThickness / 2,
              ),
            },
          ]
        : [];

  return (
    <View
      style={[styles.container, containerStyle]}
      onLayout={handleLayout}
    >
      <Reanimated.Text
        style={[cleanTextStyle, animatedTextColor]}
        numberOfLines={numberOfLines}
        onTextLayout={handleTextLayout}
      >
        {children}
      </Reanimated.Text>
      {linesToRender.map((line, idx) => (
        <StrikeLineSegment
          key={`strike-${idx}`}
          x={line.x}
          top={line.strikeTop}
          width={line.width}
          thickness={strikeThickness}
          index={idx}
          total={linesToRender.length}
          progress={progress}
          color={strikeColor}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
});
