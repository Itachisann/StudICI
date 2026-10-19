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
import { Button as ExpoUIButton, type UniversalStyle } from '@expo/ui';
import { Host } from '@expo/ui/swift-ui';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const isNativeButtonAvailable = Platform.OS === 'ios' && !isExpoGo;

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
  accentColor = '#007aff',
}) => {
  const isFilled = variant === 'filled';
  const isOutlined = variant === 'outlined';

  // Se su iOS Nativo (IPA), usa il Button nativo SwiftUI racchiuso nell'Host di @expo/ui
  if (isNativeButtonAvailable) {
    const flat = StyleSheet.flatten(style) || {};
    const uStyle: UniversalStyle = {
      borderRadius: typeof flat.borderRadius === 'number' ? flat.borderRadius : 9999,
      width: typeof flat.width === 'number' ? flat.width : undefined,
      height: typeof flat.height === 'number' ? flat.height : undefined,
      opacity: disabled ? 0.45 : flat.opacity,
    };

    return (
      <View
        style={[
          glow && {
            shadowColor: glowColor || accentColor,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: disabled ? 0 : 0.45,
            shadowRadius: 8,
          },
          style,
        ]}
      >
        <Host
          matchContents
          seedColor={accentColor}
          style={{ width: '100%', height: '100%' }}
        >
          <ExpoUIButton
            label={label}
            onPress={onPress}
            variant={variant}
            disabled={disabled}
            style={uStyle}
          />
        </Host>
      </View>
    );
  }

  // Fallback per Expo Go / Android / Web: Pulsante iOS moderno arrotondato con glow
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.baseButton,
        isFilled && {
          backgroundColor: accentColor,
        },
        isOutlined && {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: accentColor,
        },
        variant === 'text' && {
          backgroundColor: 'transparent',
        },
        glow &&
          isFilled && {
            shadowColor: glowColor || accentColor,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: disabled ? 0 : 0.4,
            shadowRadius: 8,
            elevation: 4,
          },
        disabled && { opacity: 0.4 },
        style,
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
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    minHeight: 44,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  labelText: {
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  filledText: {
    color: '#ffffff',
  },
  nativeLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    marginLeft: 6,
  },
});
