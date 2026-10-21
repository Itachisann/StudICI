import React from 'react';
import {
  Platform,
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

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

export interface NativeActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outlined' | 'text';
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
  glow?: boolean;
  glowColor?: string;
  accentColor?: string;
}

/**
 * Pulsante nativo / a tema:
 * - Su IPA (iOS 26): Callstack Liquid Glass nativo, con la tonalità esatta del tema
 * - Su Expo Go o non iOS 26: Pulsante a tema stile glowing (shadow neon theme.primary)
 */
export const NativeActionButton: React.FC<NativeActionButtonProps> = ({
  label,
  onPress,
  variant = 'filled',
  disabled = false,
  style,
  textStyle,
  icon,
  glow = true,
  glowColor,
  accentColor = '#822433',
}) => {
  const isFilled = variant === 'filled';
  const effectiveGlowColor = glowColor || accentColor;

  const isLiquidGlassSupported =
    isNativeButtonAvailable &&
    CallstackLiquidGlass &&
    Boolean(CallstackLiquidGlass.isLiquidGlassSupported) &&
    Boolean(CallstackLiquidGlass.LiquidGlassView);

  // 1. Modalità iOS 26 nativa tramite Callstack (Liquid Glass) per build IPA
  if (isLiquidGlassSupported) {
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
          style,
        ]}
      >
        <LiquidGlassView
          effect="clear"
          interactive
          style={[
            styles.basePill,
            styles.glassBorder,
            isFilled && {
              backgroundColor: disabled ? '#18181b' : accentColor,
              borderColor: disabled ? '#27272a' : accentColor,
            },
            variant === 'outlined' && {
              backgroundColor: 'transparent',
              borderColor: disabled ? '#27272a' : accentColor,
            },
          ]}
        >
          {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
          <Text
            style={[
              styles.labelText,
              isFilled ? styles.filledText : { color: accentColor },
              disabled && { color: '#52525b' },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </LiquidGlassView>
      </TouchableOpacity>
    );
  }

  // 2. Modalità Fallback Expo Go o iOS < 26: Pulsante a tema stile glowing
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
        style,
      ]}
    >
      <View
        style={[
          styles.basePill,
          isFilled && {
            backgroundColor: disabled ? '#18181b' : accentColor,
            borderColor: disabled ? '#27272a' : accentColor,
            borderWidth: 1.5,
          },
          variant === 'outlined' && {
            backgroundColor: 'transparent',
            borderColor: disabled ? '#27272a' : accentColor,
            borderWidth: 1.5,
          },
          variant === 'text' && {
            backgroundColor: 'transparent',
            borderWidth: 0,
          },
        ]}
      >
        {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
        <Text
          style={[
            styles.labelText,
            isFilled ? styles.filledText : { color: accentColor },
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
  },
  disabledContainer: {
    opacity: 0.5,
  },
  basePill: {
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  glassBorder: {
    borderWidth: 1.5,
  },
  labelText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  filledText: {
    color: '#ffffff',
  },
});
