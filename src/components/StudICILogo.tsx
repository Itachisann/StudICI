import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
  G,
  Circle,
} from 'react-native-svg';

export interface StudICILogoProps {
  /** Dimensione (larghezza e altezza) del logo in pixel (default: 80) */
  size?: number;
  /** Se true, include lo sfondo a squircle (adatto come icona o badge). Se false, è trasparente (default: false) */
  withBackground?: boolean;
  /** Colore di sfondo se withBackground è true (default: #822433 Rosso Sapienza) */
  backgroundColor?: string;
  /** Colore primario per l'emblema (default: #822433 o #ffffff se withBackground) */
  primaryColor?: string;
  /** Colore secondario o di sfumatura per l'emblema */
  secondaryColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Logo StudICI minimalista, moderno ed elegante in pura grafica vettoriale SVG.
 * 
 * - Ispirato all'architettura borrominiana di Sant'Ivo alla Sapienza e al monogramma "S" + "I"
 * - Versatile: utilizzabile sia con sfondo squircle (per icone) sia senza sfondo (vettoriale puro trasparente)
 */
export const StudICILogo: React.FC<StudICILogoProps> = ({
  size = 80,
  withBackground = false,
  backgroundColor = '#822433',
  primaryColor,
  secondaryColor,
  style,
}) => {
  const effectivePrimary =
    primaryColor || (withBackground ? '#ffffff' : '#822433');
  const effectiveSecondary =
    secondaryColor || (withBackground ? '#fecdd3' : '#be123c');

  const cornerRadius = 28;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          {/* Gradiente per lo sfondo squircle */}
          <LinearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={backgroundColor} stopOpacity="1" />
            <Stop offset="100%" stopColor="#4c0519" stopOpacity="1" />
          </LinearGradient>

          {/* Gradiente per l'emblema geometrico */}
          <LinearGradient id="logoGlyphGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={effectivePrimary} />
            <Stop offset="100%" stopColor={effectiveSecondary} />
          </LinearGradient>

          {/* Gradiente luce per accento superiore */}
          <LinearGradient id="logoAccentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#fbbf24" />
            <Stop offset="100%" stopColor="#f59e0b" />
          </LinearGradient>
        </Defs>

        {/* 1. Sfondo squircle opzionale */}
        {withBackground && (
          <>
            <Rect
              x="0"
              y="0"
              width="120"
              height="120"
              rx={cornerRadius}
              ry={cornerRadius}
              fill="url(#logoBgGrad)"
            />
            {/* Sottile riflesso di luce sul bordo */}
            <Rect
              x="1.5"
              y="1.5"
              width="117"
              height="117"
              rx={cornerRadius - 1}
              ry={cornerRadius - 1}
              fill="none"
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth="1.2"
            />
          </>
        )}

        {/* 2. Emblema minimalista vettoriale */}
        <G
          transform={
            withBackground
              ? 'scale(0.82) translate(13, 13)'
              : 'scale(1) translate(0, 0)'
          }
        >
          {/* Spirale / S-Curve continua ed elegante */}
          <Path
            d="M 34,46 C 34,31 46,24 60,24 C 76,24 86,34 86,47 C 86,60 74,65 60,68 C 44,71 34,76 34,88 C 34,101 46,108 60,108 C 76,108 86,99 86,84"
            fill="none"
            stroke="url(#logoGlyphGrad)"
            strokeWidth="8.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Colonna verticale (la "I" centrale, pilastro della conoscenza) */}
          <Path
            d="M 60,40 L 60,82"
            fill="none"
            stroke={withBackground ? 'rgba(255, 255, 255, 0.95)' : effectivePrimary}
            strokeWidth="6.5"
            strokeLinecap="round"
          />

          {/* Gemma di conoscenza / cuspide di Sant'Ivo */}
          <Circle
            cx="60"
            cy="24"
            r="4"
            fill="url(#logoAccentGrad)"
          />

          {/* Accento geometrico alla base */}
          <Circle
            cx="86"
            cy="84"
            r="3.5"
            fill={effectiveSecondary}
          />
        </G>
      </Svg>
    </View>
  );
};
