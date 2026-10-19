import React from 'react';
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface SheetAction {
  label: string;
  /** Nome SF Symbol (iOS), es. "square.and.arrow.up" */
  sfSymbol?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Pulsante evidenziato (stile "Fine/Salva" di iOS) */
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
 * Foglio modale con presentazione nativa iOS pageSheet.
 * Include una barra di navigazione in stile nativo iOS con tasto Indietro,
 * titolo centrato e azioni personalizzate (es. Salva rosso, Esporta).
 * Il trascinamento verso il basso chiude il foglio in modo nativo e mantiene
 * tutti gli eventi touch e interazioni perfettamente reattivi.
 */
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor }]}>
        {/* iOS Native Style Navigation Bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.navBarLeft}
            onPress={handleBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.6}
            accessibilityLabel="Indietro"
          >
            <Ionicons name="chevron-back" size={24} color={tintColor} />
            <Text style={[styles.navBarBackText, { color: tintColor }]}>
              Indietro
            </Text>
          </TouchableOpacity>

          <View style={styles.navBarCenter} pointerEvents="none">
            <Text
              style={[styles.navBarTitle, { color: tintColor }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>

          <View style={styles.navBarRight}>
            {rightActions?.map((a) => {
              const actionColor =
                a.tintColor || (a.prominent ? '#ef4444' : tintColor);
              if (a.prominent) {
                return (
                  <TouchableOpacity
                    key={a.label}
                    onPress={a.onPress}
                    disabled={a.disabled}
                    activeOpacity={0.75}
                    style={[
                      styles.prominentActionBtn,
                      { backgroundColor: a.tintColor || '#ef4444' },
                      a.disabled && { opacity: 0.4 },
                    ]}
                  >
                    <Text style={styles.prominentActionBtnText}>{a.label}</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={a.label}
                  onPress={a.onPress}
                  disabled={a.disabled}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.6}
                >
                  {a.sfSymbol ? (
                    <Ionicons
                      name="share-outline"
                      size={20}
                      color={actionColor}
                      style={{ opacity: a.disabled ? 0.4 : 1 }}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.plainActionBtnText,
                        { color: actionColor, opacity: a.disabled ? 0.4 : 1 },
                      ]}
                    >
                      {a.label}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.navBarBorder} />

        {/* Content */}
        <View style={{ flex: 1, backgroundColor }}>{children}</View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  navBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
    zIndex: 2,
  },
  navBarBackText: {
    fontSize: 16.5,
    marginLeft: 2,
    fontWeight: '400',
  },
  navBarCenter: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 90,
    zIndex: 1,
  },
  navBarTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  navBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 80,
    gap: 10,
    zIndex: 2,
  },
  navBarBorder: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  prominentActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prominentActionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  plainActionBtnText: {
    fontSize: 16.5,
    fontWeight: '600',
  },
});
