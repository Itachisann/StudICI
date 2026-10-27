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
  isAttended: boolean;
  isManual?: boolean;
  isNativeAvailable: boolean;
  onTogglePresence: () => void;
  onEditManual?: () => void;
  onDeleteManual?: () => void;
  children: React.ReactNode;
  style?: any;
}

export function CardContextMenu({
  title,
  isAttended,
  isManual,
  isNativeAvailable,
  onTogglePresence,
  onEditManual,
  onDeleteManual,
  children,
  style,
}: CardContextMenuProps) {
  // Standalone iOS: UIContextMenuInteraction SwiftUI nativo con colori vividi ad alto contrasto
  if (isNativeAvailable) {
    return (
      <Host matchContents style={style} ignoreSafeArea="all">
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents>
              <>{children}</>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Items>
            <Section title={title}>
              {/* Presenza: icona piena bold con rosso sistema vivido (#ff453a) per rimozione, verde smeraldo (#34d399) per segnatura */}
              <Button
                label={isAttended ? 'Rimuovi Presenza' : 'Segna Presenza'}
                systemImage={isAttended ? 'xmark.circle.fill' : 'checkmark.circle.fill'}
                role={isAttended ? 'destructive' : undefined}
                modifiers={[tintModifier(isAttended ? '#ff453a' : '#34d399')]}
                onPress={onTogglePresence}
              />

              {/* Modifica lezione manuale: icona matita bianca pura (#ffffff) per risaltare chiaramente */}
              {isManual && onEditManual ? (
                <Button
                  label="Modifica Lezione Manuale"
                  systemImage="pencil"
                  modifiers={[tintModifier('#ffffff')]}
                  onPress={onEditManual}
                />
              ) : null}

              {/* Elimina lezione manuale: icona cestino piena (trash.fill) con rosso sistema vivido (#ff453a) */}
              {isManual && onDeleteManual ? (
                <Button
                  label="Elimina Lezione Manuale"
                  systemImage="trash.fill"
                  role="destructive"
                  modifiers={[tintModifier('#ff453a')]}
                  onPress={onDeleteManual}
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
        if (isManual) {
          Alert.alert(
            title,
            'Gestisci lezione o presenza',
            [
              {
                text: isAttended ? 'Rimuovi Presenza' : 'Segna Presenza',
                onPress: onTogglePresence,
              },
              ...(onEditManual
                ? [
                    {
                      text: 'Modifica Lezione',
                      onPress: onEditManual,
                    },
                  ]
                : []),
              ...(onDeleteManual
                ? [
                    {
                      text: 'Elimina Lezione',
                      style: 'destructive' as const,
                      onPress: onDeleteManual,
                    },
                  ]
                : []),
              { text: 'Annulla', style: 'cancel' as const },
            ]
          );
        } else {
          onTogglePresence();
        }
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
