import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Button } from './Button';
import { useUpdateStore } from '../state/updateStore';
import { useAuthStore } from '../state/authStore';
import { downloadAndInstallUpdate } from '../services/appUpdate';

/**
 * Dismissible, non-blocking update banner per TASKS.md Phase 7 -- never a
 * forced update. Rendered once near the root (App.tsx), only visible
 * when updateStore.available is set (checkForUpdate found something
 * newer than the installed versionCode).
 */
export function UpdateBanner() {
  const available = useUpdateStore((s) => s.available);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const sessionToken = useAuthStore((s) => s.sessionToken);

  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!available) {
    return null;
  }

  async function handleUpdateNow() {
    if (!sessionToken) {
      return;
    }
    setError(undefined);
    setDownloading(true);
    try {
      await downloadAndInstallUpdate(sessionToken);
      // Android's own install dialog takes over from here -- leave the
      // banner as-is (don't dismiss) in case the user cancels that
      // dialog and wants to retry.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={styles.title}>Update available</Text>
        <Text style={styles.subtitle}>Version {available.versionName}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      {downloading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <View style={styles.actions}>
          <Button title="Update now" onPress={handleUpdateNow} style={styles.updateButton} />
          <Button
            title="Dismiss"
            variant="secondary"
            onPress={dismiss}
            style={styles.updateButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: { flex: 1, marginRight: 8 },
  title: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  subtitle: { color: '#cbd5e1', fontSize: 12 },
  error: { color: '#fca5a5', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  updateButton: { paddingVertical: 6, paddingHorizontal: 12 },
});
