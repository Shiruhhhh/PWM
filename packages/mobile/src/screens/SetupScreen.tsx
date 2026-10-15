import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { runSetupKeyDerivation, type SetupResult } from '../services/cryptoFlows';
import { createBootstrapApiClient } from '../services/apiClient';
import { getBootstrapBaseUrl } from '../services/config';
import { cacheSessionForBiometricUnlock } from '../services/sessionCache';
import { bytesToBase64 } from '../native/base64';
import { generateCsr, installCert } from '../native/mtlsClient';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { useVaultKeyStore } from '../state/vaultKeyStore';

/**
 * SetupScreen per SCREENS_UX.md -- a deliberate two-phase (really
 * three-step) flow, NOT a single form + checkbox:
 *   1. AccountStep: username + master password.
 *   2. RecoveryDisplayStep: show the 24-word recovery mnemonic once.
 *   3. RecoveryConfirmStep: blind confirmation (type last 6 chars from
 *      memory, not re-shown on screen) before the key is cleared from
 *      state and setup actually completes.
 * Per explicit TASKS.md instruction: do not simplify step 3 to a checkbox.
 */

type Step = 'account' | 'recoveryDisplay' | 'recoveryConfirm';

export function SetupScreen() {
  const [step, setStep] = useState<Step>('account');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountError, setAccountError] = useState<string | undefined>();

  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [confirmInput, setConfirmInput] = useState('');
  const [confirmError, setConfirmError] = useState<string | undefined>();

  const setScreen = useAuthStore((s) => s.setScreen);
  const setSession = useAuthStore((s) => s.setSession);
  const setEntries = useVaultStore((s) => s.setEntries);
  const setVaultKey = useVaultKeyStore((s) => s.setVaultKey);

  async function handleAccountStepSubmit() {
    if (username.trim().length === 0) {
      setAccountError('username is required');
      return;
    }
    if (password.length < 8) {
      setAccountError('master password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setAccountError('passwords do not match');
      return;
    }
    setAccountError(undefined);
    setSubmitting(true);
    try {
      const result = await runSetupKeyDerivation(username.trim(), password);
      setSetupResult(result);
      setStep('recoveryDisplay');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'key derivation failed');
    } finally {
      setSubmitting(false);
    }
  }

  function handleRecoveryDisplayContinue() {
    // Per spec: tapping continue unmounts the display (moves to the
    // confirm step, which never re-renders the mnemonic) -- the
    // mnemonic string itself still lives in `setupResult` state only
    // long enough to validate the blind confirm below, then is cleared.
    setStep('recoveryConfirm');
  }

  async function handleConfirmSubmit() {
    if (!setupResult) return;
    const last6 = setupResult.recoveryMnemonic.replace(/\s/g, '').slice(-6);
    if (confirmInput.trim().toLowerCase() !== last6.toLowerCase()) {
      // Per spec: don't reveal which characters were wrong, no retry limit.
      setConfirmError("doesn't match, check your saved copy");
      return;
    }

    setSubmitting(true);
    try {
      const bootstrapBaseUrl = await getBootstrapBaseUrl();
      if (!bootstrapBaseUrl) {
        throw new Error(
          'bootstrap server address not configured -- connect to your home LAN/VPN first',
        );
      }
      const bootstrapApi = createBootstrapApiClient({ baseUrl: bootstrapBaseUrl });

      // /register (LAN-only listener) auto-logs in on success -- same
      // response shape /login would return, per docs/DECISIONS.md #22.
      const registerResult = await bootstrapApi.register({
        username: setupResult.username,
        clientSalt: bytesToBase64(setupResult.clientSalt),
        kdfParams: setupResult.kdfParams,
        authHash: setupResult.authKeyBase64,
        wrappedVaultKeyPassword: setupResult.wrappedVaultKeyPasswordBase64,
        wrappedVaultKeyRecovery: setupResult.wrappedVaultKeyRecoveryBase64,
      });

      // Immediately get this device's first client cert -- still on the
      // LAN-only listener, using the session /register just returned.
      const { csr, deviceCn, tempAlias } = await generateCsr();
      const bootstrapApiWithSession = createBootstrapApiClient({
        baseUrl: bootstrapBaseUrl,
        sessionToken: registerResult.sessionToken,
      });
      const certResult = await bootstrapApiWithSession.certInitial({ csr, deviceCn });
      await installCert(tempAlias, certResult.cert, certResult.certId);
      // From this point on, the device presents this cert via the
      // public mTLS listener for everything -- no further LAN/VPN
      // requirement, ever (see docs/DECISIONS.md #22).

      await cacheSessionForBiometricUnlock(
        {
          vaultKey: setupResult.vaultKey,
          sessionToken: registerResult.sessionToken,
          userId: registerResult.userId,
          username: setupResult.username,
        },
        'Confirm to secure your vault',
      );

      setVaultKey(setupResult.vaultKey);
      setSession({
        sessionToken: registerResult.sessionToken,
        userId: registerResult.userId,
        username: setupResult.username,
      });
      setEntries([], 0); // freshly registered account -- empty vault, revision 0
      // Clear the recovery mnemonic and setup intermediate state from
      // memory now that registration succeeded -- never persisted,
      // never logged, per SCREENS_UX.md step 4.
      setSetupResult(null);
      setScreen('vaultList');
    } catch (err) {
      Alert.alert('Setup failed', err instanceof Error ? err.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'account') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Create your account</Text>
        <TextField
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="Master password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TextField
          label="Confirm master password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          error={accountError}
        />
        <Button title="Continue" onPress={handleAccountStepSubmit} disabled={submitting} />
      </ScrollView>
    );
  }

  if (step === 'recoveryDisplay' && setupResult) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Save your recovery key</Text>
        <Text style={styles.body}>
          Write this down and keep it somewhere safe. It&apos;s the only way to recover your vault
          if you forget your master password. It will not be shown again.
        </Text>
        <View style={styles.mnemonicBox}>
          <Text style={styles.mnemonic}>{setupResult.recoveryMnemonic}</Text>
        </View>
        <Button title="Continue" onPress={handleRecoveryDisplayContinue} />
      </ScrollView>
    );
  }

  if (step === 'recoveryConfirm') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Confirm you saved it</Text>
        <Text style={styles.body}>
          Type the last 6 characters of your recovery key from memory or your saved copy.
        </Text>
        <TextField
          label="Last 6 characters"
          value={confirmInput}
          onChangeText={setConfirmInput}
          autoCapitalize="none"
          autoCorrect={false}
          error={confirmError}
        />
        <Button
          title="Confirm and finish setup"
          onPress={handleConfirmSubmit}
          disabled={submitting}
        />
      </ScrollView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#0f172a' },
  body: { fontSize: 14, color: '#475569', marginBottom: 16 },
  mnemonicBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  mnemonic: { fontSize: 16, lineHeight: 24, fontFamily: 'monospace', color: '#0f172a' },
});
