import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

interface AppLogoProps {
  /** Lato del logo in px (quadrato) */
  size?: number;
  /** Mostra lo sfondo rosso arrotondato (badge). Se false, disegna solo il simbolo. */
  badge?: boolean;
  /** Colore di sfondo del badge */
  background?: string;
  /** Colore del tratto del simbolo */
  color?: string;
}

/**
 * Logo StudICI in vettoriale (arco + tocco da laureato).
 * Scala perfettamente a qualsiasi dimensione senza perdere nitidezza.
 */
export function AppLogo({
  size = 96,
  badge = true,
  background = '#822433',
  color = '#ffffff',
}: AppLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {badge ? <Rect x={0} y={0} width={100} height={100} rx={23} fill={background} /> : null}
      <G
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(50 51) scale(0.98) translate(-50 -51)"
      >
        {/* Tocco da laureato */}
        <Path d="M31.6 31.2 L13.5 24.6 L50 9 L86.7 24.6 L68.6 30.3" />
        <Path d="M33.5 38 V28.5 Q50 21.5 68.6 28.5 V38" />
        {/* Nappina */}
        <Path d="M77.6 24.2 Q79.6 33 79.6 37.5" />
        <Circle cx={79.6} cy={37.5} r={1.4} fill={color} />
        <Path d="M79.6 39 Q77.6 46.5 83.2 49.3 Q82 44 80.6 39 Z" fill={color} strokeWidth={1} />
        {/* Arco (doppio profilo) */}
        <Path d="M21.1 60.7 A29 29 0 0 1 79.1 60.7" />
        <Path d="M28.7 60.7 A21.3 21.3 0 0 1 71.3 60.7" />
        {/* Capitelli */}
        <Path d="M18 62.2 H31.5" strokeWidth={3.2} />
        <Path d="M68.5 62.2 H82" strokeWidth={3.2} />
        {/* Colonne */}
        <Path d="M21.1 64 V87 M30.6 64 V87" />
        <Path d="M70.1 64 V87 M79.1 64 V87" />
        {/* Basi */}
        <Path d="M17.8 88.6 Q26 85.6 34 88.6" />
        <Path d="M66.2 88.6 Q74.4 85.6 82.4 88.6" />
        <Path d="M17 92 H34.4" strokeWidth={3.2} />
        <Path d="M65.8 92 H83.2" strokeWidth={3.2} />
      </G>
    </Svg>
  );
}
