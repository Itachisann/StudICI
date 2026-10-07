/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export interface AppTheme {
  id: string;
  name: string;
  primary: string;
  accent: string;
  light: string;
  bg: string;
  subtle: string;
  border: string;
  cardTint: string;
  tagBg: string;
}

export const APP_THEMES: Record<string, AppTheme> = {
  sapienza: {
    id: 'sapienza',
    name: 'Rosso Sapienza',
    primary: '#822433',
    accent: '#e05666',
    light: '#f87171',
    bg: 'rgba(130, 36, 51, 0.45)',
    subtle: 'rgba(130, 36, 51, 0.2)',
    border: 'rgba(130, 36, 51, 0.4)',
    cardTint: 'rgba(130, 36, 51, 0.15)',
    tagBg: 'rgba(130, 36, 51, 0.25)',
  },
  cobalt: {
    id: 'cobalt',
    name: 'Blu Notte',
    primary: '#1d4ed8',
    accent: '#3b82f6',
    light: '#93c5fd',
    bg: 'rgba(29, 78, 216, 0.45)',
    subtle: 'rgba(29, 78, 216, 0.2)',
    border: 'rgba(29, 78, 216, 0.4)',
    cardTint: 'rgba(29, 78, 216, 0.15)',
    tagBg: 'rgba(29, 78, 216, 0.25)',
  },
  emerald: {
    id: 'emerald',
    name: 'Verde Smeraldo',
    primary: '#059669',
    accent: '#10b981',
    light: '#6ee7b7',
    bg: 'rgba(5, 150, 105, 0.45)',
    subtle: 'rgba(5, 150, 105, 0.2)',
    border: 'rgba(5, 150, 105, 0.4)',
    cardTint: 'rgba(5, 150, 105, 0.15)',
    tagBg: 'rgba(5, 150, 105, 0.25)',
  },
  purple: {
    id: 'purple',
    name: 'Viola Reale',
    primary: '#7c3aed',
    accent: '#a855f7',
    light: '#d8b4fe',
    bg: 'rgba(124, 58, 237, 0.45)',
    subtle: 'rgba(124, 58, 237, 0.2)',
    border: 'rgba(124, 58, 237, 0.4)',
    cardTint: 'rgba(124, 58, 237, 0.15)',
    tagBg: 'rgba(124, 58, 237, 0.25)',
  },
  amber: {
    id: 'amber',
    name: 'Arancio Caldo',
    primary: '#d97706',
    accent: '#f59e0b',
    light: '#fde68a',
    bg: 'rgba(217, 119, 6, 0.45)',
    subtle: 'rgba(217, 119, 6, 0.2)',
    border: 'rgba(217, 119, 6, 0.4)',
    cardTint: 'rgba(217, 119, 6, 0.15)',
    tagBg: 'rgba(217, 119, 6, 0.25)',
  },
  rose: {
    id: 'rose',
    name: 'Rosa Rubino',
    primary: '#be185d',
    accent: '#ec4899',
    light: '#fbcfe8',
    bg: 'rgba(190, 24, 93, 0.45)',
    subtle: 'rgba(190, 24, 93, 0.2)',
    border: 'rgba(190, 24, 93, 0.4)',
    cardTint: 'rgba(190, 24, 93, 0.15)',
    tagBg: 'rgba(190, 24, 93, 0.25)',
  },
  cyan: {
    id: 'cyan',
    name: 'Ciano Oceano',
    primary: '#0284c7',
    accent: '#0ea5e9',
    light: '#7dd3fc',
    bg: 'rgba(2, 132, 199, 0.45)',
    subtle: 'rgba(2, 132, 199, 0.2)',
    border: 'rgba(2, 132, 199, 0.4)',
    cardTint: 'rgba(2, 132, 199, 0.15)',
    tagBg: 'rgba(2, 132, 199, 0.25)',
  },
};

export const DEFAULT_THEME = APP_THEMES.sapienza;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
