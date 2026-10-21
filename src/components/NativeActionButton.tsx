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
 * Pulsante nativo in stile back button di native-stack:
 * - Su iOS 26 (build IPA): sfrutta @callstack/liquid-glass (LiquidGlassView)
 * - Su iOS < 26 o Expo Go: fallback fluido con BlurView e capsula glass iOS identica a native-stack
 */
export const NativeActionButton: React.FC<NativeActionButtonProps> = ({
  label,
  onPress,
  variant = 'filled',
  disabled = false,
  style,
  textStyle,
  icon,
  glow = false,
  glowColor,
  accentColor = '#822433',
}) => {
  const isFilled = variant === 'filled';
  const isOutlined = variant === 'outlined';

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
        activeOpacity={0.8}
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.containerWrapper,
          glow && {
            shadowColor: glowColor || accentColor,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: disabled ? 0 : 0.45,
            shadowRadius: 8,
            elevation: 4,
          },
          disabled && { opacity: 0.45 },
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
              backgroundColor: accentColor,
            },
            isOutlined && {
              backgroundColor: 'transparent',
              borderColor: accentColor,
            },
          ]}
        >
          {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
          <Text
            style={[
              styles.labelText,
              isFilled ? styles.filledText : { color: accentColor },
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

  // 2. Modalità Nativa iOS < 26 o Fallback Expo Go: Capsula con BlurView in stile back button di native-stack
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.containerWrapper,
        glow && {
          shadowColor: glowColor || accentColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: disabled ? 0 : 0.4,
          shadowRadius: 8,
          elevation: 4,
        },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      <View
        style={[
          styles.basePill,
          styles.glassBorder,
          isFilled && {
            backgroundColor: accentColor,
          },
          isOutlined && {
            backgroundColor: 'transparent',
            borderColor: accentColor,
          },
          variant === 'text' && {
            backgroundColor: 'transparent',
            borderWidth: 0,
          },
        ]}
      >
        {Platform.OS === 'ios' && !isFilled && (
          <BlurView
            intensity={25}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        )}
        {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
        <Text
          style={[
            styles.labelText,
            isFilled ? styles.filledText : { color: accentColor },
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
    minHeight: 44,
    borderRadius: 9999,
    overflow: 'hidden',
  },
  basePill: {
    minHeight: 44,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  glassBorder: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  labelText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  filledText: {
    color: '#ffffff',
  },
});
