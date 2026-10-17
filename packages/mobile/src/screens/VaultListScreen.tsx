import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { TextField } from '../components/TextField';
import { Button } from '../components/Button';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { createSessionApiClient } from '../services/apiClient';
import { getServerBaseUrl } from '../services/config';
import { decryptVaultBlob } from '../services/cryptoFlows';
import { decideSyncAction } from '../state/syncLogic';
import type { VaultEntry } from '@pwm/core';

/**
 * VaultListScreen per SCREENS_UX.md: searchable list, pull-to-refresh
 * triggers a sync check (decideSyncAction -- see syncLogic.ts).
 */
interface VaultListScreenProps {
  vaultKey: Uint8Array;
}

export function VaultListScreen({ vaultKey }: VaultListScreenProps) {
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const entries = useVaultStore((s) => s.entries);
  const lastKnownSyncedRevision = useVaultStore((s) => s.lastKnownSyncedRevision);
  const dirty = useVaultStore((s) => s.dirty);
  const setEntries = useVaultStore((s) => s.setEntries);

  const userId = useAuthStore((s) => s.userId);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const setScreen = useAuthStore((s) => s.setScreen);
  const navigateToEntry = useAuthStore((s) => s.navigateToEntry);

  const filtered = useMemo(() => {
    if (query.trim() === '') return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const onRefresh = useCallback(async () => {
    if (!userId || !sessionToken) return;
    setRefreshing(true);
    try {
      const baseUrl = await getServerBaseUrl();
      if (!baseUrl) return;
      const api = createSessionApiClient({ baseUrl, sessionToken });
      const vault = await api.getVault();

      const action = decideSyncAction({
        serverRevision: vault.revision,
        lastKnownSyncedRevision,
        localDirty: dirty,
      });

      if (action.type === 'pull' || action.type === 'noop') {
        const blob = decryptVaultBlob(
          vault.encryptedBlob,
          vaultKey,
          userId,
          vault.blobFormatVersion,
        );
        setEntries(blob.entries, vault.revision);
      }
      // 'push' and 'conflict' are handled by EntryEditScreen's save path
      // (which calls PUT /vault directly) and a conflict banner
      // respectively -- pull-to-refresh here only ever pulls or no-ops.
    } finally {
      setRefreshing(false);
    }
  }, [userId, sessionToken, vaultKey, lastKnownSyncedRevision, dirty, setEntries]);

  return (
    <View style={styles.container}>
      <TextField
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search entries"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }: { item: VaultEntry }) => (
          <Pressable style={styles.row} onPress={() => navigateToEntry(item.id, 'entryDetail')}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowSubtitle}>{item.username}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No entries yet</Text>}
      />
      <Button title="Add entry" onPress={() => navigateToEntry(null, 'entryEdit')} />
      <Button
        title="Settings"
        variant="secondary"
        onPress={() => setScreen('settings')}
        style={styles.settingsButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  rowSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 32 },
  settingsButton: { marginTop: 12 },
});
