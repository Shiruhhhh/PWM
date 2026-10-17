import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuthStore } from '../state/authStore';
import { createUnauthenticatedApiClient } from '../services/apiClient';
import { getServerBaseUrl } from '../services/config';
import {
  unwrapVaultKeyFromRecovery,
  runPasswordChangeKeyDerivation,
} from '../services/cryptoFlows';
import { bytesToBase64 } from '../native/base64';

/**
 * RecoveryScreen per SCREENS_UX.md "RecoveryScreen (forgot master
 * password)": enter recovery key, set new master password. Unwraps
 * vaultKey locally via the recovery key, rewraps under the new
 * password-derived key, pushes via POST /recovery/password-change (the
 * session-less variant -- see docs/DECISIONS.md #20). Recovery
 * invalidates all sessions server-side, so this always ends by sending
 * the user back to LoginScreen for a fresh /login with the new password.
 */
export function RecoveryScreen() {
  const [username, setUsername] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const setScreen = useAuthStore((s) => s.setScreen);

  async function handleRecover() {
    const trimmedUsername = username.trim();
    const trimmedMnemonic = mnemonic.trim();

    if (trimmedUsername.length === 0 || trimmedMnemonic.length === 0) {
      setError('username and recovery key are required');
      return;
    }
    if (newPassword.length < 8) {
      setError('new master password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('passwords do not match');
      return;
    }
    setError(undefined);
    setSubmitting(true);

    try {
      const baseUrl = await getServerBaseUrl();
      if (!baseUrl) {
        throw new Error('server address not configured');
      }
      const api = createUnauthenticatedApiClient({ baseUrl });

      const { wrappedVaultKeyRecovery } = await api.getRecoveryWrappedKey(trimmedUsername);
      const vaultKey = unwrapVaultKeyFromRecovery(
        trimmedUsername,
        trimmedMnemonic,
        wrappedVaultKeyRecovery,
      );

      const change = await runPasswordChangeKeyDerivation(trimmedUsername, newPassword, vaultKey);

      // No session required -- this is /recovery/password-change, not
      // the normal session-required /password-change (see
      // docs/DECISIONS.md #20). Possession of the recovery key is the
      // only proof needed, already established above by successfully
      // unwrapping wrappedVaultKeyRecovery.
      await api.recoveryPasswordChange({
        username: trimmedUsername,
        newClientSalt: bytesToBase64(change.newClientSalt),
        newKdfParams: change.newKdfParams,
        newAuthHash: change.newAuthKeyBase64,
        newWrappedVaultKeyPassword: change.newWrappedVaultKeyPasswordBase64,
      });

      Alert.alert('Recovery complete', 'Your master password has been reset.');
      setScreen('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'recovery failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recover your account</Text>
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextField
        label="Recovery key (24 words)"
        value={mnemonic}
        onChangeText={setMnemonic}
        autoCapitalize="none"
        multiline
      />
      <TextField
        label="New master password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
      />
      <TextField
        label="Confirm new master password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        error={error}
      />
      <Button title="Reset password" onPress={handleRecover} disabled={submitting} />
      <Button title="Back to login" variant="secondary" onPress={() => setScreen('login')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#0f172a' },
});
