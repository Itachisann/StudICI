import React from 'react';
import {
  Platform,
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  View,
} from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { BlurView } from 'expo-blur';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const isNativeButtonAvailable = Platform.OS === 'ios' && !isExpoGo;

// Caricamento condizionale sicuro di @callstack/liquid-glass:
// Attivo SOLO su build nativa iOS (IPA) per evitare qualsiasi conflitto o crash in Expo Go
let CallstackLiquidGlass: any = null;
if (isNativeButtonAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CallstackLiquidGlass = require('@callstack/liquid-glass');
  } catch {
    CallstackLiquidGlass = null;
  }
}

export const NativeGlassContainer: React.FC<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  spacing?: number;
}> = ({ children, style, spacing = 10 }) => {
  const Container = CallstackLiquidGlass?.LiquidGlassContainerView;
  if (isNativeButtonAvailable && Container) {
    return (
      <Container spacing={spacing} style={style}>
        {children}
      </Container>
    );
  }
  return <View style={style}>{children}</View>;
};

export interface NativeActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outlined' | 'text' | 'glass';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  pillStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
  glow?: boolean;
  glowColor?: string;
  accentColor?: string;
}

/**
 * Pulsante nativo / a tema:
 * - Su IPA (iOS): Callstack Liquid Glass nativo (LiquidGlassView), con la tonalità esatta del tema
 * - Su Expo Go o non iOS: Pulsante a tema stile glass con BlurView nativa e glowing neon
 */
export const NativeActionButton: React.FC<NativeActionButtonProps> = ({
  label,
  onPress,
  variant = 'filled',
  disabled = false,
  style,
  pillStyle,
  textStyle,
  icon,
  glow = true,
  glowColor,
  accentColor = '#822433',
}) => {
  const isFilled = variant === 'filled';
  const effectiveGlowColor = glowColor || accentColor;

  const flattenedStyle = (StyleSheet.flatten(style) || {}) as ViewStyle;
  const flattenedPillStyle = (StyleSheet.flatten(pillStyle) || {}) as ViewStyle;
  const customHeight = flattenedPillStyle.height ?? flattenedStyle.height;
  const customRadius = flattenedPillStyle.borderRadius ?? flattenedStyle.borderRadius;
  const customPaddingHorizontal = flattenedPillStyle.paddingHorizontal ?? flattenedStyle.paddingHorizontal;

  const isLiquidGlassAvailable =
    isNativeButtonAvailable &&
    CallstackLiquidGlass &&
    Boolean(CallstackLiquidGlass.LiquidGlassView);

  // 1. Modalità iOS nativa tramite Callstack (Liquid Glass) per build IPA
  if (isLiquidGlassAvailable) {
    const LiquidGlassView = CallstackLiquidGlass.LiquidGlassView;
    return (
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.containerWrapper,
          glow &&
            !disabled && {
              shadowColor: effectiveGlowColor,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.6,
              shadowRadius: 10,
              elevation: 6,
            },
          disabled && styles.disabledContainer,
          customHeight !== undefined && { height: customHeight },
          customRadius !== undefined && { borderRadius: customRadius },
          style,
        ]}
      >
        <LiquidGlassView
          effect={isFilled ? 'regular' : 'clear'}
          interactive={!disabled}
          colorScheme="dark"
          tintColor={isFilled ? (disabled ? '#27272a' : accentColor) : undefined}
          style={[
            StyleSheet.absoluteFill,
            styles.glassBorder,
            isFilled && {
              backgroundColor: disabled ? '#18181b' : accentColor,
              borderColor: disabled ? '#27272a' : accentColor,
            },
            variant === 'outlined' && {
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              borderColor: disabled ? '#27272a' : accentColor,
            },
            variant === 'glass' && {
              backgroundColor: 'rgba(255, 255, 255, 0.10)',
              borderColor: disabled ? '#27272a' : 'rgba(255, 255, 255, 0.22)',
            },
            variant === 'text' && {
              backgroundColor: 'transparent',
              borderWidth: 0,
            },
            styles.glassPill,
            customHeight !== undefined && { height: customHeight },
            customRadius !== undefined && { borderRadius: customRadius },
            pillStyle,
          ]}
          pointerEvents="none"
        />
        <View
          style={[
            styles.contentContainer,
            customPaddingHorizontal !== undefined && { paddingHorizontal: customPaddingHorizontal },
          ]}
          pointerEvents="none"
        >
          {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
          <Text
            style={[
              styles.labelText,
              isFilled
                ? styles.filledText
                : variant === 'glass'
                ? styles.glassText
                : { color: accentColor },
              disabled && { color: '#52525b' },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  // 2. Modalità Fallback Expo Go o non iOS: Pulsante a tema stile glass con BlurView
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.containerWrapper,
        glow &&
          !disabled && {
            shadowColor: effectiveGlowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 10,
            elevation: 6,
          },
        disabled && styles.disabledContainer,
        customHeight !== undefined && { height: customHeight },
        customRadius !== undefined && { borderRadius: customRadius },
        style,
      ]}
    >
      <BlurView
        intensity={Platform.OS === 'ios' ? 30 : 0}
        tint="dark"
        style={[
          StyleSheet.absoluteFill,
          styles.glassBorder,
          isFilled && {
            backgroundColor: disabled ? '#18181b' : accentColor,
            borderColor: disabled ? '#27272a' : accentColor,
          },
          variant === 'outlined' && {
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderColor: disabled ? '#27272a' : accentColor,
          },
          variant === 'glass' && {
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            borderColor: disabled ? '#27272a' : 'rgba(255, 255, 255, 0.20)',
          },
          variant === 'text' && {
            backgroundColor: 'transparent',
            borderWidth: 0,
          },
          styles.glassPill,
          customHeight !== undefined && { height: customHeight },
          customRadius !== undefined && { borderRadius: customRadius },
          pillStyle,
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.contentContainer,
          customPaddingHorizontal !== undefined && { paddingHorizontal: customPaddingHorizontal },
        ]}
        pointerEvents="none"
      >
        {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
        <Text
          style={[
            styles.labelText,
            isFilled
              ? styles.filledText
              : variant === 'glass'
              ? styles.glassText
              : { color: accentColor },
            disabled && { color: '#52525b' },
            textStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  containerWrapper: {
    height: 44,
    borderRadius: 22,
    position: 'relative',
  },
  disabledContainer: {
    opacity: 0.5,
  },
  glassPill: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  contentContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  glassBorder: {
    borderWidth: 1.5,
  },
  labelText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    includeFontPadding: false,
    textAlign: 'center',
  },
  filledText: {
    color: '#ffffff',
  },
  glassText: {
    color: '#ffffff',
  },
});
