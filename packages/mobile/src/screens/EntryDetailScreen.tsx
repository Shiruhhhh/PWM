import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Button } from '../components/Button';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { copyWithAutoClear } from '../services/clipboard';

/**
 * EntryDetailScreen per SCREENS_UX.md: view/copy fields, copy-to-clipboard
 * triggers auto-clear timer (decision #4, see services/clipboard.ts).
 */
export function EntryDetailScreen() {
  const selectedEntryId = useAuthStore((s) => s.selectedEntryId);
  const entries = useVaultStore((s) => s.entries);
  const navigateToEntry = useAuthStore((s) => s.navigateToEntry);
  const setScreen = useAuthStore((s) => s.setScreen);
  const removeEntry = useVaultStore((s) => s.removeEntry);

  const entry = entries.find((e) => e.id === selectedEntryId);

  if (!entry) {
    return (
      <View style={styles.container}>
        <Text>Entry not found.</Text>
        <Button title="Back" onPress={() => setScreen('vaultList')} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{entry.title}</Text>

      <Field label="Username" value={entry.username} />
      <Field label="Password" value={entry.password} mask />
      <Field label="URL" value={entry.url} />
      {entry.notes ? <Field label="Notes" value={entry.notes} /> : null}

      <Button title="Edit" onPress={() => navigateToEntry(entry.id, 'entryEdit')} />
      <Button
        title="Delete"
        variant="danger"
        style={styles.deleteButton}
        onPress={() => {
          removeEntry(entry.id);
          setScreen('vaultList');
        }}
      />
      <Button
        title="Back"
        variant="secondary"
        style={styles.deleteButton}
        onPress={() => setScreen('vaultList')}
      />
    </ScrollView>
  );
}

function Field({ label, value, mask }: { label: string; value: string; mask?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldValue}>
          {mask ? '•'.repeat(Math.min(value.length, 12)) : value}
        </Text>
        <Button title="Copy" variant="secondary" onPress={() => copyWithAutoClear(value)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#0f172a' },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#64748b', marginBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldValue: { fontSize: 16, color: '#0f172a', flexShrink: 1 },
  deleteButton: { marginTop: 8 },
});
