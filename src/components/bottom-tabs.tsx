import React, { useMemo } from 'react';
import { withLayoutContext } from 'expo-router';
import {
  createNativeBottomTabNavigator,
  NativeBottomTabNavigationOptions,
  NativeBottomTabNavigationEventMap,
} from '@bottom-tabs/react-navigation';
import {
  ParamListBase,
  TabNavigationState,
  ThemeProvider as NavigationThemeProvider,
  DarkTheme,
} from '@react-navigation/native';
import { useTheme as useAppTheme } from '@/context/ThemeContext';

const BaseBottomTabNavigator = createNativeBottomTabNavigator().Navigator;

const BottomTabNavigator: typeof BaseBottomTabNavigator = (props) => {
  const { theme } = useAppTheme();
  const navTheme = useMemo(() => ({
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: theme.primary,
      border: theme.border,
    },
  }), [theme]);

  return (
    <NavigationThemeProvider value={navTheme}>
      <BaseBottomTabNavigator {...props} />
    </NavigationThemeProvider>
  );
};

export const NativeTabs = withLayoutContext<
  NativeBottomTabNavigationOptions,
  typeof BottomTabNavigator,
  TabNavigationState<ParamListBase>,
  NativeBottomTabNavigationEventMap
>(BottomTabNavigator);
