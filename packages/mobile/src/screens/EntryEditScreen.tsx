import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { generatePassword } from '../services/passwordGenerator';
import { generateUuid } from '../services/uuid';

/**
 * EntryEditScreen per SCREENS_UX.md: add/edit entry, built-in password
 * generator with configurable length + charset toggles.
 */
export function EntryEditScreen() {
  const selectedEntryId = useAuthStore((s) => s.selectedEntryId);
  const setScreen = useAuthStore((s) => s.setScreen);
  const entries = useVaultStore((s) => s.entries);
  const upsertEntry = useVaultStore((s) => s.upsertEntry);

  const existing = entries.find((e) => e.id === selectedEntryId);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState(existing?.password ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const [genLength, setGenLength] = useState('20');
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genDigits, setGenDigits] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [genError, setGenError] = useState<string | undefined>();

  function handleGenerate() {
    try {
      const length = Number(genLength);
      const generated = generatePassword({
        length,
        upper: genUpper,
        lower: genLower,
        digits: genDigits,
        symbols: genSymbols,
      });
      setPassword(generated);
      setGenError(undefined);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'generation failed');
    }
  }

  function handleSave() {
    const now = new Date().toISOString();
    upsertEntry({
      id: existing?.id ?? generateUuid(),
      title,
      username,
      password,
      url,
      notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    setScreen('vaultList');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{existing ? 'Edit entry' : 'New entry'}</Text>

      <TextField label="Title" value={title} onChangeText={setTitle} />
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextField label="Password" value={password} onChangeText={setPassword} />
      <TextField label="URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Text style={styles.sectionTitle}>Password generator</Text>
      <TextField
        label="Length"
        value={genLength}
        onChangeText={setGenLength}
        keyboardType="number-pad"
        error={genError}
      />
      <ToggleRow label="Uppercase" value={genUpper} onValueChange={setGenUpper} />
      <ToggleRow label="Lowercase" value={genLower} onValueChange={setGenLower} />
      <ToggleRow label="Digits" value={genDigits} onValueChange={setGenDigits} />
      <ToggleRow label="Symbols" value={genSymbols} onValueChange={setGenSymbols} />
      <Button title="Generate password" variant="secondary" onPress={handleGenerate} />

      <Button title="Save" onPress={handleSave} style={styles.saveButton} />
      <Button title="Cancel" variant="secondary" onPress={() => setScreen('vaultList')} />
    </ScrollView>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#0f172a' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
    color: '#334155',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  toggleLabel: { fontSize: 15, color: '#334155' },
  saveButton: { marginTop: 16 },
});
