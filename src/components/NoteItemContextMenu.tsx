import React from 'react';
import { Alert, Platform, TouchableOpacity } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import {
  ContextMenu,
  Host,
  RNHostView,
  Section,
  Button,
} from '@expo/ui/swift-ui';
import { tint as tintModifier } from '@expo/ui/swift-ui/modifiers';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isNativeAvailable = Platform.OS === 'ios' && !isExpoGo;

interface NoteItemContextMenuProps {
  title: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete?: () => void;
  isCompleted?: boolean;
  children: React.ReactNode;
  style?: any;
}

export function NoteItemContextMenu({
  title,
  onEdit,
  onDelete,
  onToggleComplete,
  isCompleted = false,
  children,
  style,
}: NoteItemContextMenuProps) {
  if (isNativeAvailable) {
    return (
      <Host matchContents={{ vertical: true }} style={[{ width: '100%' }, style]} ignoreSafeArea="all">
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents={{ vertical: true }}>
              <>{children}</>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Items>
            <Section title={title || 'Opzioni Nota'}>
              {onToggleComplete && (
                <Button
                  label={isCompleted ? 'Segna come Da fare' : 'Segna come Completata'}
                  systemImage={isCompleted ? 'arrow.uturn.backward.circle' : 'checkmark.circle'}
                  modifiers={[tintModifier(isCompleted ? '#94a3b8' : '#34d399')]}
                  onPress={onToggleComplete}
                />
              )}
              <Button
                label="Modifica nota"
                systemImage="pencil"
                modifiers={[tintModifier('#ffffff')]}
                onPress={() => {
                  setTimeout(() => {
                    onEdit();
                  }, 180);
                }}
              />
              <Button
                label="Elimina nota"
                systemImage="trash.fill"
                role="destructive"
                modifiers={[tintModifier('#ff453a')]}
                onPress={() => {
                  setTimeout(() => {
                    onDelete();
                  }, 180);
                }}
              />
            </Section>
          </ContextMenu.Items>
        </ContextMenu>
      </Host>
    );
  }

  return (
    <TouchableOpacity
      style={[{ width: '100%' }, style]}
      activeOpacity={0.88}
      delayLongPress={400}
      onLongPress={() => {
        const buttons: any[] = [];
        if (onToggleComplete) {
          buttons.push({
            text: isCompleted ? 'Segna come Da fare' : 'Segna come Completata',
            onPress: onToggleComplete,
          });
        }
        buttons.push({
          text: 'Modifica nota',
          onPress: onEdit,
        });
        buttons.push({
          text: 'Elimina nota',
          style: 'destructive' as const,
          onPress: onDelete,
        });
        buttons.push({ text: 'Annulla', style: 'cancel' as const });
        Alert.alert(title || 'Gestisci Nota', undefined, buttons);
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
