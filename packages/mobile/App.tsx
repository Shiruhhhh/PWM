/**
 * @format
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  StatusBar,
  StyleSheet,
  View,
  ToastAndroid,
  Platform,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SetupScreen } from './src/screens/SetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { VaultListScreen } from './src/screens/VaultListScreen';
import { EntryDetailScreen } from './src/screens/EntryDetailScreen';
import { EntryEditScreen } from './src/screens/EntryEditScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { RecoveryScreen } from './src/screens/RecoveryScreen';

import { useAuthStore } from './src/state/authStore';
import { useVaultStore } from './src/state/vaultStore';
import { useVaultKeyStore } from './src/state/vaultKeyStore';
import { useSettingsStore } from './src/state/settingsStore';
import { hasIdleTimeoutElapsed } from './src/state/idleTimer';
import { loadCachedSession } from './src/services/sessionCache';
import { getServerBaseUrl } from './src/services/config';
import { isBiometricAvailable } from './src/native/keystore';
import { isClientCertInstalled } from './src/native/mtlsClient';
import { decryptVaultBlob } from './src/services/cryptoFlows';
import { createApiClient } from './src/services/apiClient';
import { checkAndRenewCertIfNeeded } from './src/services/certRenewal';

type ColdStartState = 'checking' | 'ready';

/**
 * App root -- cold-start resume check (SCREENS_UX.md "App lifecycle"
 * #1/#2), idle-lock on background (#3/#4), and the screen router (no
 * navigation library, per decision to keep this small-app-sized).
 */
function App() {
  const [coldStart, setColdStart] = useState<ColdStartState>('checking');
  const screen = useAuthStore((s) => s.screen);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const setScreen = useAuthStore((s) => s.setScreen);
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const recordBiometricFailure = useAuthStore((s) => s.recordBiometricFailure);
  const resetBiometricFailures = useAuthStore((s) => s.resetBiometricFailures);
  const consecutiveBiometricFailures = useAuthStore((s) => s.consecutiveBiometricFailures);
  const setBiometricEnrolled = useAuthStore((s) => s.setBiometricEnrolled);

  const setEntries = useVaultStore((s) => s.setEntries);
  const clearVault = useVaultStore((s) => s.clear);

  const setVaultKey = useVaultKeyStore((s) => s.setVaultKey);
  const clearVaultKey = useVaultKeyStore((s) => s.clear);

  const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
  const loadSettings = useSettingsStore((s) => s.load);

  const backgroundedAtRef = useRef<number | null>(null);

  // Cold start: check for an installed client cert (uncertified devices
  // need SetupScreen's LAN-only bootstrap flow, not LoginScreen, which
  // lives entirely behind the public mTLS listener per
  // docs/DECISIONS.md #22) and a cached, biometric-unlockable session.
  useEffect(() => {
    (async () => {
      await loadSettings();

      const certInstalled = await isClientCertInstalled();
      if (!certInstalled) {
        setColdStart('ready');
        setScreen('setup');
        return;
      }

      const biometricAvailable = await isBiometricAvailable();
      setBiometricEnrolled(biometricAvailable);

      if (!biometricAvailable || consecutiveBiometricFailures >= 3) {
        setColdStart('ready');
        setScreen('login');
        return;
      }

      try {
        const cached = await loadCachedSession('Unlock PWM');
        if (!cached) {
          setColdStart('ready');
          setScreen('login');
          return;
        }

        setVaultKey(cached.vaultKey);
        setSession({
          sessionToken: cached.sessionToken,
          userId: cached.userId,
          username: cached.username,
        });
        resetBiometricFailures();

        // Resume the stored session (rolling TTL, no /login call) and
        // pull the vault, per SCREENS_UX.md step 1.
        const baseUrl = await getServerBaseUrl();
        if (baseUrl) {
          const api = createApiClient({ baseUrl, sessionToken: cached.sessionToken });
          const vault = await api.getVault();
          const blob = decryptVaultBlob(
            vault.encryptedBlob,
            cached.vaultKey,
            cached.userId,
            vault.blobFormatVersion,
          );
          setEntries(blob.entries, vault.revision);

          // Background cert-renewal check, per SCREENS_UX.md "Cert
          // renewal" -- no dedicated screen, toast only. Doesn't block
          // the cold-start flow; failures are surfaced but not fatal.
          checkAndRenewCertIfNeeded(cached.sessionToken)
            .then((status) => {
              if (status && Platform.OS === 'android') {
                ToastAndroid.show(status, ToastAndroid.LONG);
              }
            })
            .catch((err: unknown) => {
              if (Platform.OS === 'android') {
                ToastAndroid.show(
                  `Certificate renewal failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                  ToastAndroid.LONG,
                );
              }
            });
        }

        setScreen('vaultList');
      } catch {
        recordBiometricFailure();
        setScreen('login');
      } finally {
        setColdStart('ready');
      }
    })();
    // Deliberately run once on mount only -- cold start, not a reactive
    // effect on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle lock on background per SCREENS_UX.md #3/#4.
  useEffect(() => {
    function handleAppStateChange(next: AppStateStatus) {
      if (next === 'background' || next === 'inactive') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (next === 'active' && backgroundedAtRef.current !== null) {
        const elapsed = hasIdleTimeoutElapsed(backgroundedAtRef.current, Date.now(), idleTimeoutMs);
        backgroundedAtRef.current = null;
        if (elapsed && sessionToken) {
          // Clear in-memory vault + require unlock again, per #4 --
          // does NOT clear the disk cache, so biometric unlock can
          // still resume without a full /login.
          clearVault();
          clearVaultKey();
          clearSession();
          setScreen('login');
        }
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [idleTimeoutMs, sessionToken, clearVault, clearVaultKey, clearSession, setScreen]);

  if (coldStart === 'checking') {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Router screen={screen} />
      </View>
    </SafeAreaProvider>
  );
}

function Router({ screen }: { screen: ReturnType<typeof useAuthStore.getState>['screen'] }) {
  const vaultKey = useVaultKeyStore((s) => s.vaultKey);

  switch (screen) {
    case 'setup':
      return <SetupScreen />;
    case 'login':
      return <LoginScreen />;
    case 'vaultList':
      return vaultKey ? <VaultListScreen vaultKey={vaultKey} /> : <LoginScreen />;
    case 'entryDetail':
      return <EntryDetailScreen />;
    case 'entryEdit':
      return <EntryEditScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'recovery':
      return <RecoveryScreen />;
    default:
      return <LoginScreen />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, backgroundColor: '#ffffff' },
});

export default App;
