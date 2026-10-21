import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ThemeProvider as NavigationThemeProvider,
  DarkTheme as NavDarkTheme,
  Theme as NavTheme,
} from '@react-navigation/native';
import { AppTheme, APP_THEMES, DEFAULT_THEME } from '@/constants/theme';

interface ThemeContextType {
  theme: AppTheme;
  themeId: string;
  setThemeId: (id: string) => Promise<void>;
  availableThemes: AppTheme[];
}

const THEME_STORAGE_KEY = 'app_theme_color_id';

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  themeId: DEFAULT_THEME.id,
  setThemeId: async () => {},
  availableThemes: Object.values(APP_THEMES),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME.id);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((savedId) => {
        if (savedId && APP_THEMES[savedId]) {
          setThemeIdState(savedId);
        }
      })
      .catch(() => {});
  }, []);

  const setThemeId = useCallback(async (id: string) => {
    if (APP_THEMES[id]) {
      setThemeIdState(id);
      try {
        await AsyncStorage.setItem(THEME_STORAGE_KEY, id);
      } catch (e) {
        console.warn('Errore salvataggio tema:', e);
      }
    }
  }, []);

  const currentTheme = APP_THEMES[themeId] || DEFAULT_THEME;

  const navTheme: NavTheme = useMemo(() => ({
    ...NavDarkTheme,
    colors: {
      ...NavDarkTheme.colors,
      primary: currentTheme.primary,
      border: currentTheme.border,
    },
  }), [currentTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme: currentTheme,
        themeId,
        setThemeId,
        availableThemes: Object.values(APP_THEMES),
      }}
    >
      <NavigationThemeProvider value={navTheme}>
        {children}
      </NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  return (
    context || {
      theme: DEFAULT_THEME,
      themeId: DEFAULT_THEME.id,
      setThemeId: async () => {},
      availableThemes: Object.values(APP_THEMES),
    }
  );
}
