import React, { useState, useRef } from 'react';
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
  Text,
  Keyboard,
  Animated,
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
  showCancelButton?: boolean;
  onCancel?: () => void;
}

/**
 * Barra di ricerca in stile Native-Stack iOS / Callstack Liquid Glass:
 * - Stile capsule nativo iOS (height 38, borderRadius 12, fill Apple system)
 * - Tasto 'Annulla' dinamico con transizione fluida all'attivazione
 * - Su IPA: LiquidGlassView di @callstack/liquid-glass con effetto vetro reale
 * - Su Expo Go / Fallback: background dark con riflesso glowing e bordo a tema
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
  showCancelButton = true,
  onCancel,
}) => {
  const { theme } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [cancelAnim] = useState(() => new Animated.Value(0));
  const effectiveAccent = tintColor || theme.primary;

  const isLiquidGlassSupported =
    isNativeGlassAvailable &&
    CallstackLiquidGlass &&
    Boolean(CallstackLiquidGlass.isLiquidGlassSupported) &&
    Boolean(CallstackLiquidGlass.LiquidGlassView);

  const handleFocus = () => {
    setIsFocused(true);
    Animated.timing(cancelAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!value) {
      Animated.timing(cancelAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setIsFocused(false);
    Animated.timing(cancelAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
    if (onCancel) {
      onCancel();
    } else if (onClear) {
      onClear();
    } else {
      onChangeText('');
    }
  };

  const cancelWidth = cancelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 68],
    extrapolate: 'clamp',
  });

  const cancelOpacity = cancelAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  const cancelTranslateX = cancelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
    extrapolate: 'clamp',
  });

  // Campo di ricerca centrale (Liquid Glass su IPA o Apple System Fill con Glow)
  const renderField = () => {
    if (isLiquidGlassSupported) {
      const LiquidGlassView = CallstackLiquidGlass.LiquidGlassView;
      return (
        <View style={styles.glassFieldWrapper}>
          <LiquidGlassView
            effect="regular"
            colorScheme="dark"
            style={[
              styles.glassBar,
              isFocused && {
                borderColor: effectiveAccent,
                shadowColor: effectiveAccent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 8,
              },
            ]}
          >
            <Ionicons
              name="search"
              size={17}
              color={isFocused ? effectiveAccent : '#8e8e93'}
              style={styles.searchIcon}
            />
            <TextInput
              ref={inputRef}
              style={[styles.input, inputStyle]}
              placeholder={placeholder}
              placeholderTextColor="#8e8e93"
              value={value}
              onChangeText={onChangeText}
              onFocus={handleFocus}
              onBlur={handleBlur}
              autoCapitalize={autoCapitalize}
              autoCorrect={false}
              autoFocus={autoFocus}
              selectionColor={effectiveAccent}
            />
            {value.length > 0 && (
              <TouchableOpacity
                onPress={onClear ? onClear : () => onChangeText('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.clearBtn}
              >
                <Ionicons name="close-circle" size={17} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </LiquidGlassView>
        </View>
      );
    }

    // Modalità Native-Stack Fallback (Apple System Style con Glow a tema)
    return (
      <View
        style={[
          styles.systemBar,
          {
            borderColor: isFocused ? effectiveAccent : 'rgba(255, 255, 255, 0.08)',
            shadowColor: isFocused ? effectiveAccent : 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isFocused ? 0.45 : 0,
            shadowRadius: 8,
            elevation: isFocused ? 4 : 0,
          },
        ]}
      >
        <Ionicons
          name="search"
          size={17}
          color={isFocused ? effectiveAccent : '#8e8e93'}
          style={styles.searchIcon}
        />
        <TextInput
          ref={inputRef}
          style={[styles.input, inputStyle]}
          placeholder={placeholder}
          placeholderTextColor="#8e8e93"
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          autoFocus={autoFocus}
          selectionColor={effectiveAccent}
        />
        {value.length > 0 && (
          <TouchableOpacity
            onPress={onClear ? onClear : () => onChangeText('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.clearBtn}
          >
            <Ionicons name="close-circle" size={17} color="#8e8e93" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.containerRow, style]}>
      <View style={styles.fieldFlex}>{renderField()}</View>
      {showCancelButton && (
        <Animated.View
          style={[
            styles.cancelWrapper,
            {
              width: cancelWidth,
              opacity: cancelOpacity,
              transform: [{ translateX: cancelTranslateX }],
            },
          ]}
          pointerEvents={isFocused || value.length > 0 ? 'auto' : 'none'}
        >
          <TouchableOpacity
            onPress={handleCancel}
            activeOpacity={0.7}
            style={styles.cancelBtn}
          >
            <Text style={[styles.cancelText, { color: effectiveAccent }]}>
              Annulla
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  containerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  fieldFlex: {
    flex: 1,
  },
  glassFieldWrapper: {
    height: 38,
    borderRadius: 12,
    overflow: 'hidden',
  },
  glassBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  systemBar: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(118, 118, 128, 0.22)',
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 6,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '400',
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 2,
    marginLeft: 4,
  },
  cancelWrapper: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  cancelBtn: {
    paddingLeft: 8,
    paddingRight: 2,
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
