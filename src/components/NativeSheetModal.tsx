import React, { useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackHeaderItem,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import {
  DarkTheme,
  NavigationContainer,
  NavigationIndependentTree,
  useNavigation,
} from '@react-navigation/native';
import { UNIFORM_MODAL_BG } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

export interface SheetAction {
  label: string;
  /** Nome SF Symbol su iOS (es. "chevron.left", "square.and.arrow.up", "checkmark") */
  sfSymbol?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Pulsante evidenziato (stile "Fine / Salva" iOS 26 liquid glass) */
  prominent?: boolean;
  /** Colore personalizzato (es. theme.primary, #ef4444) */
  tintColor?: string;
}

export { UNIFORM_MODAL_BG };

export interface NativeSheetModalProps {
  visible: boolean;
  /** Callback di chiusura completa del foglio (swipe verso il basso nativo, tasto Chiudi) */
  onClose: () => void;
  /** Azione del tasto indietro se diverso da onClose */
  onBack?: () => void;
  /** Mostra il tasto 'Indietro' a sinistra se non ci sono leftActions specifiche */
  showCloseButton?: boolean;
  title: string;
  backgroundColor?: string;
  tintColor?: string;
  leftActions?: SheetAction[];
  rightActions?: SheetAction[];
  sheetAllowedDetents?: number[] | 'fitToContents';
  sheetInitialDetentIndex?: number | 'last';
  searchBarOptions?: NativeStackNavigationOptions['headerSearchBarOptions'];
  children: React.ReactNode;
}

const Stack = createNativeStackNavigator();

interface SheetContextValue {
  children: React.ReactNode;
  backgroundColor: string;
  onDismiss: () => void;
}

const SheetContext = React.createContext<SheetContextValue>({
  children: null,
  backgroundColor: UNIFORM_MODAL_BG,
  onDismiss: () => {},
});

/** Schermata statica stabile: non si smonta mai durante i re-render dei dati figli */
function SheetBodyScreen() {
  const { children, backgroundColor, onDismiss } = React.useContext(SheetContext);
  const navigation = useNavigation();

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      // Chiamato quando la rotta viene rimossa fisicamente (es. swipe down nativo o gesture iOS)
      onDismiss();
    });
    return unsub;
  }, [navigation, onDismiss]);

  return (
    <View collapsable={false} style={[styles.contentRoot, { backgroundColor }]}>
      {children}
    </View>
  );
}

function RootPlaceholderScreen() {
  return <View style={styles.placeholder} />;
}

export function NativeSheetModal({
  visible,
  onClose,
  onBack,
  title,
  backgroundColor = UNIFORM_MODAL_BG,
  leftActions,
  rightActions,
  sheetAllowedDetents,
  sheetInitialDetentIndex,
  searchBarOptions,
  children,
}: NativeSheetModalProps) {
  const { theme } = useTheme();
  // Titoli dei modali SEMPRE in bianco universale (#ffffff)
  const effectiveTitleColor = '#ffffff';
  // Colore universale neutro per icone (Indietro, Chiudi, Condividi)
  const universalIconColor = '#ffffff';

  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: backgroundColor,
        card: backgroundColor,
        text: effectiveTitleColor,
        primary: universalIconColor,
      },
    }),
    [backgroundColor]
  );

  const buildLeftItems = (nav: any): NativeStackHeaderItem[] => {
    if (leftActions && leftActions.length > 0) {
      return leftActions.map((action) => ({
        type: 'button',
        label: action.label,
        icon: action.sfSymbol
          ? ({ type: 'sfSymbol', name: action.sfSymbol } as any)
          : undefined,
        tintColor: action.tintColor || universalIconColor,
        disabled: action.disabled,
        onPress: action.onPress,
        accessibilityLabel: action.label,
      }));
    }

    const backHandler = () => {
      if (onBack) {
        onBack();
      } else if (nav?.canGoBack?.()) {
        nav.goBack();
      } else {
        onClose();
      }
    };

    return [
      {
        type: 'button',
        label: '',
        icon: { type: 'sfSymbol', name: 'chevron.left' } as any,
        tintColor: universalIconColor,
        onPress: backHandler,
        accessibilityLabel: 'Indietro',
      },
    ];
  };

  const buildRightItems = (): NativeStackHeaderItem[] =>
    (rightActions || []).map((a) => ({
      type: 'button' as const,
      label: a.label,
      icon: a.sfSymbol
        ? ({ type: 'sfSymbol', name: a.sfSymbol } as any)
        : undefined,
      variant: a.prominent && !a.tintColor ? ('prominent' as const) : ('plain' as const),
      tintColor: a.tintColor || (a.prominent ? theme.primary : universalIconColor),
      sharesBackground: true,
      disabled: a.disabled,
      onPress: a.onPress,
      accessibilityLabel: a.label,
    }));

  const contextValue = useMemo(
    () => ({
      children,
      backgroundColor,
      onDismiss: onClose,
    }),
    [children, backgroundColor, onClose]
  );

  if (!visible) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SheetContext.Provider value={contextValue}>
        <NavigationIndependentTree>
          <NavigationContainer
            theme={navTheme}
            initialState={{
              index: 1,
              routes: [{ name: 'RootPlaceholder' }, { name: 'SheetModal' }],
            }}
          >
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            >
              <Stack.Screen
                name="RootPlaceholder"
                component={RootPlaceholderScreen}
              />

              <Stack.Screen
                name="SheetModal"
                component={SheetBodyScreen}
                options={({ navigation }: any) => ({
                  presentation: 'formSheet',
                  sheetAllowedDetents: sheetAllowedDetents ?? [1.0],
                  sheetInitialDetentIndex: sheetInitialDetentIndex ?? 0,
                  sheetGrabberVisible: true,
                  sheetExpandsWhenScrolledToEdge: true,
                  gestureEnabled: true,
                  animation: 'slide_from_bottom',
                  headerShown: true,
                  title,
                  headerTintColor: effectiveTitleColor,
                  headerStyle: { backgroundColor },
                  headerShadowVisible: false, // Header e sfondo sono tutt'uno senza linee divisorie
                  headerTitleStyle: {
                    color: effectiveTitleColor,
                    fontSize: 17,
                    fontWeight: '600',
                  },
                  headerSearchBarOptions: searchBarOptions
                    ? {
                        placement: 'stacked',
                        allowToolbarIntegration: false,
                        hideWhenScrolling: false,
                        ...searchBarOptions,
                      }
                    : undefined,
                  contentStyle: { backgroundColor },
                  unstable_headerLeftItems: () => buildLeftItems(navigation),
                  unstable_headerRightItems: buildRightItems,
                })}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </NavigationIndependentTree>
      </SheetContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
