import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import {
  ContextMenu,
  Host,
  RNHostView,
  Section,
  Button,
} from '@expo/ui/swift-ui';
import { tint as tintModifier } from '@expo/ui/swift-ui/modifiers';

interface CardContextMenuProps {
  title: string;
  isAttended?: boolean;
  isManual?: boolean;
  isNativeAvailable: boolean;
  onTogglePresence?: () => void;
  onEditManual?: () => void;
  onDeleteManual?: () => void;
  onAddOrViewNote?: () => void;
  children: React.ReactNode;
  style?: any;
}

export function CardContextMenu({
  title,
  isAttended = false,
  isManual,
  isNativeAvailable,
  onTogglePresence,
  onEditManual,
  onDeleteManual,
  onAddOrViewNote,
  children,
  style,
}: CardContextMenuProps) {
  // Standalone iOS: UIContextMenuInteraction SwiftUI nativo con colori vividi ad alto contrasto
  if (isNativeAvailable) {
    return (
      <Host matchContents={{ vertical: true }} style={style} ignoreSafeArea="all">
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents={{ vertical: true }}>
              <>{children}</>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Items>
            <Section title={title}>
              {/* Presenza: se fornita, icona piena bold con rosso sistema vivido (#ff453a) per rimozione, verde smeraldo (#34d399) per segnatura */}
              {onTogglePresence ? (
                <Button
                  label={isAttended ? 'Rimuovi presenza' : 'Segna presenza'}
                  systemImage={isAttended ? 'xmark.circle.fill' : 'checkmark.circle.fill'}
                  role={isAttended ? 'destructive' : undefined}
                  modifiers={[tintModifier(isAttended ? '#ff453a' : '#34d399')]}
                  onPress={onTogglePresence}
                />
              ) : null}

              {/* Modifica lezione manuale: icona matita bianca pura (#ffffff) per risaltare chiaramente */}
              {isManual && onEditManual ? (
                <Button
                  label="Modifica lezione"
                  systemImage="pencil"
                  modifiers={[tintModifier('#ffffff')]}
                  onPress={() => {
                    setTimeout(() => {
                      onEditManual?.();
                    }, 180);
                  }}
                />
              ) : null}

              {/* Elimina lezione manuale: icona cestino piena (trash.fill) con rosso sistema vivido (#ff453a) */}
              {isManual && onDeleteManual ? (
                <Button
                  label="Elimina lezione"
                  systemImage="trash.fill"
                  role="destructive"
                  modifiers={[tintModifier('#ff453a')]}
                  onPress={() => {
                    setTimeout(() => {
                      onDeleteManual?.();
                    }, 180);
                  }}
                />
              ) : null}
            </Section>
          </ContextMenu.Items>
        </ContextMenu>
      </Host>
    );
  }

  // Fallback per Expo Go o piattaforme non-iOS
  return (
    <TouchableOpacity
      style={style}
      activeOpacity={0.85}
      delayLongPress={400}
      onLongPress={() => {
        const buttons: any[] = [];
        if (onTogglePresence) {
          buttons.push({
            text: isAttended ? 'Rimuovi presenza' : 'Segna presenza',
            onPress: onTogglePresence,
          });
        }
        if (isManual && onEditManual) {
          buttons.push({
            text: 'Modifica lezione',
            onPress: onEditManual,
          });
        }
        if (isManual && onDeleteManual) {
          buttons.push({
            text: 'Elimina lezione',
            style: 'destructive' as const,
            onPress: onDeleteManual,
          });
        }
        buttons.push({ text: 'Annulla', style: 'cancel' as const });
        Alert.alert(title, 'Gestisci lezione', buttons);
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
