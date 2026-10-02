import React from 'react';
import { Platform, TouchableOpacity, View, StyleProp, ViewStyle } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { MenuView, MenuAction } from '@expo/ui/community/menu';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeIos = Platform.OS === 'ios' && !isExpoGo;

export interface NativeDropdownMenuProps {
  title?: string;
  actions: MenuAction[];
  onSelect: (actionId: string) => void;
  onFallbackPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function NativeDropdownMenu({
  title,
  actions,
  onSelect,
  onFallbackPress,
  style,
  children,
}: NativeDropdownMenuProps) {
  // Nell'IPA su iOS: utilizza il menu a discesa nativo Apple (SwiftUI / UIKit UIMenu)
  if (isNativeIos && actions.length > 0) {
    return (
      <MenuView
        title={title}
        actions={actions}
        onPressAction={({ nativeEvent }) => {
          onSelect(nativeEvent.event);
        }}
        style={style}
      >
        <View style={{ width: '100%' }}>
          {children}
        </View>
      </MenuView>
    );
  }

  // Fallback per Expo Go o ambienti senza modulo nativo: apre il modal / selettore
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onFallbackPress}
      style={style}
    >
      {children}
    </TouchableOpacity>
  );
}
