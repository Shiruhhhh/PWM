import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import {
  deriveKeysFromPassword,
  unwrapVaultKeyFromPassword,
  decryptVaultBlob,
} from '../services/cryptoFlows';
import { createUnauthenticatedApiClient, createSessionApiClient } from '../services/apiClient';
import { getServerBaseUrl, setServerBaseUrl } from '../services/config';
import { cacheSessionForBiometricUnlock } from '../services/sessionCache';
import { bytesToBase64, base64ToBytes } from '../native/base64';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { useVaultKeyStore } from '../state/vaultKeyStore';
import { runCertRenewalCheck } from '../services/certRenewal';
import { runUpdateCheck } from '../services/appUpdate';

/**
 * LoginScreen per SCREENS_UX.md: username + master password. Biometric
 * unlock is a separate, earlier-checked path (app-root cold-start check,
 * see App.tsx) -- this screen is the fallback / fresh-login path, always
 * a full POST /login issuing a brand new session.
 *
 * Server address is normally invisible: it's baked into the APK at build
 * time (packages/mobile/.env via react-native-config). The field below is
 * a collapsed "Advanced" override, only needed if the DDNS host/LAN IP
 * changes without a new APK build -- see docs/DECISIONS.md.
 */
export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const [showServerField, setShowServerField] = useState(false);
  const [serverUrl, setServerUrlInput] = useState('');

  const setScreen = useAuthStore((s) => s.setScreen);
  const setSession = useAuthStore((s) => s.setSession);
  const setEntries = useVaultStore((s) => s.setEntries);
  const setVaultKey = useVaultKeyStore((s) => s.setVaultKey);

  useEffect(() => {
    getServerBaseUrl().then((url) => setServerUrlInput(url ?? ''));
  }, []);

  async function handleLogin() {
    const trimmedUsername = username.trim();
    if (trimmedUsername.length === 0 || password.length === 0) {
      setError('username and password are required');
      return;
    }
    setError(undefined);
    setSubmitting(true);

    try {
      const trimmedServerUrl = serverUrl.trim();
      if (trimmedServerUrl.length > 0) {
        await setServerBaseUrl(trimmedServerUrl);
      }
      const baseUrl = await getServerBaseUrl();
      if (!baseUrl) {
        throw new Error('server address not configured');
      }
      const api = createUnauthenticatedApiClient({ baseUrl });

      // authKey is derivable from clientSalt/kdfParams alone (both come
      // back from /login/params, no server round trip needed yet).
      const params = await api.getLoginParams(trimmedUsername);
      const clientSalt = base64ToBytes(params.clientSalt);
      const { authKey, vaultWrapKey } = await deriveKeysFromPassword(
        password,
        clientSalt,
        params.kdfParams,
      );

      const loginResult = await api.login({
        username: trimmedUsername,
        authHash: bytesToBase64(authKey),
      });

      const vaultKey = unwrapVaultKeyFromPassword(
        trimmedUsername,
        vaultWrapKey,
        loginResult.wrappedVaultKeyPassword,
      );

      // api is unauthenticated -- getVault() (session-required, per
      // API_SPEC.md) needs the session client instead, same pattern as
      // SetupScreen.tsx's bootstrapApiWithSession. Without this, getVault()
      // sent no Authorization header at all, failing requireSession's
      // missing-token check every time (401) -- see docs/DECISIONS.md #31.
      const apiWithSession = createSessionApiClient({
        baseUrl,
        sessionToken: loginResult.sessionToken,
      });
      const vault = await apiWithSession.getVault();
      const blob = decryptVaultBlob(
        vault.encryptedBlob,
        vaultKey,
        loginResult.userId,
        vault.blobFormatVersion,
      );
      setEntries(blob.entries, vault.revision);

      await cacheSessionForBiometricUnlock(
        {
          vaultKey,
          sessionToken: loginResult.sessionToken,
          userId: loginResult.userId,
          username: trimmedUsername,
        },
        'Confirm to secure your vault',
      );

      setVaultKey(vaultKey);
      setSession({
        sessionToken: loginResult.sessionToken,
        userId: loginResult.userId,
        username: trimmedUsername,
      });
      // A manual /login means this device already has a valid cert
      // (the public mTLS listener requires one) -- check renewal now,
      // same as the cold-start/foreground paths, since a freshly
      // re-installed app or a device that skipped foreground checks
      // for a long time wouldn't otherwise get one until later.
      runCertRenewalCheck(loginResult.sessionToken);
      runUpdateCheck(loginResult.sessionToken);

      setScreen('vaultList');
    } catch {
      // Generic message deliberately -- mirrors the server's own
      // anti-enumeration stance (API_SPEC.md "Error handling conventions"),
      // don't hint whether the username or the password was wrong.
      setError('login failed -- check your username and password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>PWM</Text>
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
        error={error}
      />
      <Button title="Log in" onPress={handleLogin} disabled={submitting} />
      {showServerField ? (
        <TextField
          label="Server address (advanced)"
          value={serverUrl}
          onChangeText={setServerUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : (
        <Text style={styles.advancedLink} onPress={() => setShowServerField(true)}>
          Server address
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1, justifyContent: 'center' },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    color: '#0f172a',
    textAlign: 'center',
  },
  advancedLink: {
    marginTop: 24,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
  },
});
