import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type NameDialogProps = {
  visible: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
};

/**
 * Sayfa adı gibi kısa metinleri soran basit iletişim kutusu.
 *
 * `Alert.prompt` yalnızca iOS'ta olduğu için Android'de de çalışan kendi
 * modalımızı kullanıyoruz.
 */
export function NameDialog({
  visible,
  title,
  description,
  initialValue = '',
  confirmLabel = 'Kaydet',
  placeholder = 'Sayfa adı',
  onCancel,
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [wasVisible, setWasVisible] = useState(visible);

  // Diyalog her açıldığında alan başlangıç değeriyle dolar.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValue(initialValue);
    }
  }

  const trimmed = value.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={Colors.inkFaint}
            style={styles.input}
            maxLength={40}
            autoFocus
            selectionColor={Colors.accent}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (trimmed.length > 0) {
                onSubmit(trimmed);
              }
            }}
          />

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Vazgeç</Text>
            </Pressable>
            <View style={styles.confirm}>
              <ActionButton
                label={confirmLabel}
                disabled={trimmed.length === 0}
                onPress={() => onSubmit(trimmed)}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: Colors.overlay,
    paddingHorizontal: Spacing.four,
  },
  card: {
    backgroundColor: Colors.paper,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 23,
    color: Colors.ink,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.inkSoft,
    marginTop: -Spacing.two,
  },
  input: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.paperLine,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cancel: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
  },
  cancelText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.inkSoft,
  },
  confirm: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
