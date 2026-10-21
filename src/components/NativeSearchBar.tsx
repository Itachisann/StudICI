import React, { useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
  TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useTheme } from '@/context/ThemeContext';

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const isNativeGlassAvailable = Platform.OS === 'ios' && !isExpoGo;

// Caricamento sicuro di @callstack/liquid-glass:
// Attivo SOLO su build nativa iOS (IPA) per evitare conflitti o crash in Expo Go
let CallstackLiquidGlass: any = null;
if (isNativeGlassAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CallstackLiquidGlass = require('@callstack/liquid-glass');
  } catch {
    CallstackLiquidGlass = null;
  }
}

export interface NativeSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  autoFocus?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  tintColor?: string;
}

/**
 * Barra di ricerca nativa iOS 26 / a tema:
 * - Su IPA (iOS 26): LiquidGlassView di @callstack/liquid-glass con effetto vetro reale
 * - Su Expo Go o non-iOS 26: Barra scura con bordo a tema e riflesso glowing
 */
export const NativeSearchBar: React.FC<NativeSearchBarProps> = ({
  value,
  onChangeText,
  placeholder = 'Cerca...',
  onClear,
  style,
  inputStyle,
  autoFocus = false,
  autoCapitalize = 'none',
  tintColor,
}) => {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const effectiveAccent = tintColor || theme.primary;

  const isLiquidGlassSupported =
    isNativeGlassAvailable &&
    CallstackLiquidGlass &&
    Boolean(CallstackLiquidGlass.isLiquidGlassSupported) &&
    Boolean(CallstackLiquidGlass.LiquidGlassView);

  // 1. Modalità iOS 26 nativa tramite Callstack (Liquid Glass) per build IPA
  if (isLiquidGlassSupported) {
    const LiquidGlassView = CallstackLiquidGlass.LiquidGlassView;
    return (
      <View style={[styles.outerWrapper, style]}>
        <LiquidGlassView
          effect="regular"
          colorScheme="dark"
          style={[
            styles.glassBar,
            isFocused && {
              borderColor: effectiveAccent,
              shadowColor: effectiveAccent,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.35,
              shadowRadius: 8,
            },
          ]}
        >
          <Ionicons
            name="search"
            size={18}
            color={isFocused ? effectiveAccent : '#8e8e93'}
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.input, inputStyle]}
            placeholder={placeholder}
            placeholderTextColor="#71717a"
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            autoFocus={autoFocus}
            clearButtonMode="while-editing"
            selectionColor={effectiveAccent}
          />
          {value.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity
              onPress={onClear ? onClear : () => onChangeText('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#8e8e93" />
            </TouchableOpacity>
          )}
        </LiquidGlassView>
      </View>
    );
  }

  // 2. Modalità Fallback per Expo Go o iOS < 26: Pulsante/Barra a tema stile glowing
  return (
    <View
      style={[
        styles.fallbackBar,
        {
          borderColor: isFocused ? effectiveAccent : '#27272a',
          shadowColor: isFocused ? effectiveAccent : 'transparent',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isFocused ? 0.45 : 0,
          shadowRadius: 10,
          elevation: isFocused ? 4 : 0,
        },
        style,
      ]}
    >
      <Ionicons
        name="search"
        size={18}
        color={isFocused ? effectiveAccent : '#8e8e93'}
        style={styles.searchIcon}
      />
      <TextInput
        style={[styles.input, inputStyle]}
        placeholder={placeholder}
        placeholderTextColor="#71717a"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        clearButtonMode="while-editing"
        selectionColor={effectiveAccent}
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={onClear ? onClear : () => onChangeText('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={18} color="#8e8e93" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    height: 44,
    borderRadius: 14,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginVertical: 6,
  },
  glassBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  fallbackBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#16181d',
    borderWidth: 1.2,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 0,
  },
});
