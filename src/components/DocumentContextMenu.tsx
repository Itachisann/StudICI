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
import { SavedDocument } from '../utils/savedDocuments';

interface DocumentContextMenuProps {
  doc: SavedDocument;
  isNativeAvailable: boolean;
  onOpen: () => void;
  onCopyLink?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
  style?: any;
}

export function DocumentContextMenu({
  doc,
  isNativeAvailable,
  onOpen,
  onCopyLink,
  onEdit,
  onDelete,
  children,
  style,
}: DocumentContextMenuProps) {
  const isLink = doc.type === 'link' || Boolean(doc.url);
  const openLabel =
    doc.type === 'file'
      ? 'Apri file'
      : doc.type === 'note'
      ? 'Visualizza nota'
      : 'Apri link';
  const openIcon =
    doc.type === 'file'
      ? 'doc.text'
      : doc.type === 'note'
      ? 'note.text'
      : 'arrow.up.right.square';

  // 1. Standalone iOS: UIContextMenuInteraction SwiftUI nativo
  if (isNativeAvailable) {
    return (
      <Host
        matchContents={{ vertical: true }}
        style={style}
        ignoreSafeArea="all"
      >
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents={{ vertical: true }}>
              <>{children}</>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Items>
            <Section title={doc.title}>
              {/* Apri link / file / nota */}
              <Button
                label={openLabel}
                systemImage={openIcon}
                modifiers={[tintModifier('#ffffff')]}
                onPress={onOpen}
              />

              {/* Copia link (se applicabile) */}
              {isLink && onCopyLink ? (
                <Button
                  label="Copia link"
                  systemImage="doc.on.doc"
                  modifiers={[tintModifier('#ffffff')]}
                  onPress={onCopyLink}
                />
              ) : null}

              {/* Modifica */}
              <Button
                label="Modifica"
                systemImage="pencil"
                modifiers={[tintModifier('#ffffff')]}
                onPress={onEdit}
              />

              {/* Elimina elemento: distruttivo rosso vivido */}
              <Button
                label="Elimina"
                systemImage="trash.fill"
                role="destructive"
                modifiers={[tintModifier('#ff453a')]}
                onPress={onDelete}
              />
            </Section>
          </ContextMenu.Items>
        </ContextMenu>
      </Host>
    );
  }

  // 2. Fallback per Expo Go o piattaforme non-iOS: Alert nativo su long press
  return (
    <TouchableOpacity
      style={[{ width: '100%' }, style]}
      activeOpacity={0.85}
      delayLongPress={350}
      onLongPress={() => {
        Alert.alert(doc.title, 'Opzioni elemento', [
          { text: openLabel, onPress: onOpen },
          ...(isLink && onCopyLink
            ? [{ text: 'Copia link', onPress: onCopyLink }]
            : []),
          { text: 'Modifica', onPress: onEdit },
          { text: 'Elimina', style: 'destructive', onPress: onDelete },
          { text: 'Annulla', style: 'cancel' },
        ]);
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
