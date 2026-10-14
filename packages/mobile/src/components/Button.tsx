import React from 'react';
import { Pressable, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, onPress, disabled, variant = 'primary', style }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.base, styles[variant], disabled && styles.disabled, style]}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
}

/* eslint-disable react-native/no-unused-styles -- primary/secondary/danger are
   looked up dynamically via styles[variant] above; the lint rule can't trace that. */
const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  primary: { backgroundColor: '#2563eb' },
  secondary: { backgroundColor: '#64748b' },
  danger: { backgroundColor: '#dc2626' },
  disabled: { opacity: 0.5 },
  text: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
});
/* eslint-enable react-native/no-unused-styles */
