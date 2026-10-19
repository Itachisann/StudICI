import React from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DarkTheme } from 'expo-router';
import {
  NavigationContainer,
  NavigationIndependentTree,
} from 'expo-router/react-navigation';
import {
  createNativeStackNavigator,
  type NativeStackHeaderItem,
} from 'expo-router/native-stack';

const Stack = createNativeStackNavigator();

export interface SheetAction {
  label: string;
  /** Nome SF Symbol (iOS), es. "square.and.arrow.up" */
  sfSymbol?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Pulsante evidenziato (stile "Fine/Salva" di iOS 26) */
  prominent?: boolean;
  /** Colore personalizzato del pulsante (es. rosso per Salva) */
  tintColor?: string;
}

export interface NativeSheetModalProps {
  visible: boolean;
  /** Chiusura completa del foglio (swipe verso il basso, tasto indietro Android) */
  onClose: () => void;
  /** Azione del pulsante indietro nell'header. Di default chiude il foglio. */
  onBack?: () => void;
  title: string;
  backgroundColor?: string;
  tintColor?: string;
  rightActions?: SheetAction[];
  children: React.ReactNode;
}

/**
 * Foglio modale a tutta pagina con header nativo `native-stack`
 * (UINavigationBar su iOS: pulsante indietro e azioni con lo stile del sistema,
 * glass su iOS 26). Il trascinamento verso il basso chiude il foglio in modo nativo.
 * Su Android/Web usa un header React Native equivalente.
 */
const SheetContentContext = React.createContext<{
  children: React.ReactNode;
  backgroundColor: string;
}>({
  children: null,
  backgroundColor: '#111111',
});

function SheetContentScreen() {
  const { children, backgroundColor } = React.useContext(SheetContentContext);
  return <View style={{ flex: 1, backgroundColor }}>{children}</View>;
}

export function NativeSheetModal({
  visible,
  onClose,
  onBack,
  title,
  backgroundColor = '#111111',
  tintColor = '#ffffff',
  rightActions,
  children,
}: NativeSheetModalProps) {
  const handleBack = onBack ?? onClose;

  if (Platform.OS !== 'ios') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor }}>
          <View style={styles.fallbackHeader}>
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={10}
              accessibilityLabel="Indietro"
            >
              <Ionicons name="chevron-back" size={24} color={tintColor} />
            </TouchableOpacity>
            <Text style={[styles.fallbackTitle, { color: tintColor }]}>
              {title}
            </Text>
            <View style={styles.fallbackRight}>
              {rightActions?.map((a) => (
                <TouchableOpacity
                  key={a.label}
                  onPress={a.onPress}
                  disabled={a.disabled}
                  hitSlop={10}
                >
                  <Text
                    style={{
                      color: a.tintColor || tintColor,
                      fontWeight: '600',
                      opacity: a.disabled ? 0.4 : 1,
                    }}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {children}
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <IosSheet
      visible={visible}
      onClose={onClose}
      handleBack={handleBack}
      title={title}
      backgroundColor={backgroundColor}
      tintColor={tintColor}
      rightActions={rightActions}
    >
      {children}
    </IosSheet>
  );
}

function IosSheet({
  visible,
  onClose,
  handleBack,
  title,
  backgroundColor,
  tintColor,
  rightActions,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  handleBack: () => void;
  title: string;
  backgroundColor: string;
  tintColor: string;
  rightActions?: SheetAction[];
  children: React.ReactNode;
}) {
  // I callback più recenti vivono in un ref: le opzioni dell'header restano
  // stabili e il navigatore nativo non viene aggiornato a ogni render del genitore.
  const handlersRef = React.useRef({ handleBack, rightActions });
  React.useEffect(() => {
    handlersRef.current = { handleBack, rightActions };
  });

  const actionsKey = (rightActions || [])
    .map(
      (a) =>
        `${a.label}|${a.sfSymbol || ''}|${a.prominent ? 1 : 0}|${a.tintColor || ''}|${a.disabled ? 1 : 0}`,
    )
    .join(';');

  const theme = React.useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: backgroundColor,
        card: backgroundColor,
        text: tintColor,
        primary: tintColor,
      },
    }),
    [backgroundColor, tintColor],
  );

  const screenOptions = React.useMemo(
    () => ({
      headerTintColor: tintColor,
      headerTitleStyle: { color: tintColor },
      headerStyle: { backgroundColor },
      headerShadowVisible: false,
      contentStyle: { backgroundColor },
    }),
    [backgroundColor, tintColor],
  );

  const screenOpts = React.useMemo(
    () => ({
      title,
      unstable_headerLeftItems: (): NativeStackHeaderItem[] => [
        {
          type: 'button',
          label: 'Indietro',
          icon: { type: 'sfSymbol', name: 'chevron.left' } as any,
          onPress: () => handlersRef.current.handleBack(),
          accessibilityLabel: 'Indietro',
        },
      ],
      unstable_headerRightItems: (): NativeStackHeaderItem[] =>
        (handlersRef.current.rightActions || []).map((a, i) => ({
          type: 'button' as const,
          label: a.label,
          icon: a.sfSymbol
            ? ({ type: 'sfSymbol', name: a.sfSymbol } as any)
            : undefined,
          variant: a.prominent ? ('prominent' as const) : ('plain' as const),
          tintColor: a.tintColor || (a.prominent ? undefined : tintColor),
          disabled: a.disabled,
          onPress: () => handlersRef.current.rightActions?.[i]?.onPress(),
          accessibilityLabel: a.label,
        })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, tintColor, actionsKey],
  );

  const contextValue = React.useMemo(
    () => ({ children, backgroundColor }),
    [children, backgroundColor],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <SheetContentContext.Provider value={contextValue}>
        <NavigationIndependentTree>
          <NavigationContainer theme={theme}>
            <Stack.Navigator screenOptions={screenOptions}>
              <Stack.Screen
                name="sheet"
                component={SheetContentScreen}
                options={screenOpts}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </SheetContentContext.Provider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fallbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fallbackTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  fallbackRight: {
    minWidth: 24,
    flexDirection: 'row',
    gap: 12,
  },
});
