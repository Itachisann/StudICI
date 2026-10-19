import React from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
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
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <SafeAreaView style={[styles.root, { backgroundColor }]}>
        <StatusBar barStyle="light-content" />
        {/* iOS Native-Style Navigation Bar Header */}
        <View style={styles.header}>
          {/* Pulsante Indietro / Chiudi con stile cerchio translucido iOS */}
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backCircleBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Indietro"
          >
            <Ionicons name="chevron-back" size={20} color={tintColor} />
          </TouchableOpacity>

          {/* Titolo Centrato */}
          <View style={styles.titleContainer} pointerEvents="none">
            <Text
              style={[styles.headerTitle, { color: tintColor }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>

          {/* Azioni Destre (es. Tasto Salva / Esporta) */}
          <View style={styles.rightActionsRow}>
            {rightActions?.map((a) => {
              const isProminent = a.prominent;
              const btnBg = isProminent
                ? a.tintColor || '#ef4444'
                : 'transparent';
              const textColor = isProminent
                ? '#ffffff'
                : a.tintColor || tintColor;

              return (
                <TouchableOpacity
                  key={a.label}
                  onPress={a.onPress}
                  disabled={a.disabled}
                  style={[
                    isProminent
                      ? [styles.prominentBtn, { backgroundColor: btnBg }]
                      : styles.plainBtn,
                    a.disabled && { opacity: 0.4 },
                  ]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                >
                  {a.sfSymbol && !isProminent ? (
                    <Ionicons
                      name={
                        a.sfSymbol === 'square.and.arrow.up'
                          ? 'share-outline'
                          : 'chevron-forward'
                      }
                      size={18}
                      color={textColor}
                      style={{ marginRight: 4 }}
                    />
                  ) : null}
                  <Text
                    style={
                      isProminent
                        ? styles.prominentBtnText
                        : [styles.plainBtnText, { color: textColor }]
                    }
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Hairline Divider */}
        <View style={styles.headerDivider} />

        {/* Sheet Content Body */}
        <View style={[styles.content, { backgroundColor }]}>{children}</View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    position: 'relative',
  },
  backCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  titleContainer: {
    position: 'absolute',
    left: 60,
    right: 60,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  rightActionsRow: {
    minWidth: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    zIndex: 2,
  },
  prominentBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  prominentBtnText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  plainBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainBtnText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  content: {
    flex: 1,
  },
});
