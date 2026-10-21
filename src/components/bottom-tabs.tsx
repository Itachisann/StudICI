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
  NavigationIndependentTree,
  NavigationContainer,
  DarkTheme,
} from '@react-navigation/native';
import { useTheme as useAppTheme } from '@/context/ThemeContext';

const { Navigator: BaseBottomTabNavigator, Screen: NativeTabScreen } =
  createNativeBottomTabNavigator();

function mapToNativeScreens(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) {
      return child;
    }
    const props = child.props as any;
    if (props && props.children) {
      return (
        <NativeTabScreen {...props} key={child.key || props.name}>
          {mapToNativeScreens(props.children)}
        </NativeTabScreen>
      );
    }
    return <NativeTabScreen {...props} key={child.key || props.name} />;
  });
}

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

  const children = useMemo(() => mapToNativeScreens(props.children), [props.children]);

  return (
    <NavigationIndependentTree>
      <NavigationContainer theme={navTheme}>
        <BaseBottomTabNavigator {...props}>
          {children}
        </BaseBottomTabNavigator>
      </NavigationContainer>
    </NavigationIndependentTree>
  );
};

export const NativeTabs = withLayoutContext<
  NativeBottomTabNavigationOptions,
  typeof BottomTabNavigator,
  TabNavigationState<ParamListBase>,
  NativeBottomTabNavigationEventMap
>(BottomTabNavigator);
