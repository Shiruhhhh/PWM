import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, Alert } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuthStore } from '../state/authStore';
import { useVaultStore } from '../state/vaultStore';
import { useVaultKeyStore } from '../state/vaultKeyStore';
import { useSettingsStore } from '../state/settingsStore';
import { clearCachedSession } from '../services/sessionCache';
import { deleteVaultKeystoreKey, isBiometricAvailable } from '../native/keystore';
import { getActiveCertInfo, deleteKeyAlias } from '../native/mtlsClient';
import { createApiClient } from '../services/apiClient';
import { getServerBaseUrl } from '../services/config';

/**
 * SettingsScreen per SCREENS_UX.md: idle timeout (configurable),
 * biometric toggle, manage devices/certs (list + revoke), recovery
 * reminder (never re-displays the key), logout.
 */
export function SettingsScreen() {
  const setScreen = useAuthStore((s) => s.setScreen);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const clearSession = useAuthStore((s) => s.clearSession);
  const clearVault = useVaultStore((s) => s.clear);
  const clearVaultKey = useVaultKeyStore((s) => s.clear);

  const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
  const biometricEnabled = useSettingsStore((s) => s.biometricEnabled);
  const setIdleTimeoutMs = useSettingsStore((s) => s.setIdleTimeoutMs);
  const setBiometricEnabled = useSettingsStore((s) => s.setBiometricEnabled);

  const [idleTimeoutInput, setIdleTimeoutInput] = useState(String(idleTimeoutMs / 1000));
  const [biometricHwAvailable, setBiometricHwAvailable] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBiometricHwAvailable);
  }, []);

  async function handleIdleTimeoutSave() {
    const seconds = Number(idleTimeoutInput);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      Alert.alert('Invalid value', 'Enter a positive number of seconds');
      return;
    }
    await setIdleTimeoutMs(seconds * 1000);
  }

  async function handleLogout() {
    await clearCachedSession();
    clearVault();
    clearVaultKey();
    clearSession();
  }

  // NOTE: SCREENS_UX.md's "manage devices/certs -- list, revoke action
  // per device" only covers THIS device here -- a real multi-device
  // list (fetching all of the account's client_certs, revoking a
  // DIFFERENT device remotely) isn't built; that's what the /admin/*
  // plane's certs/:certId/revoke is for (an admin acting on someone
  // else's behalf), not a per-user multi-device UI. This button does
  // call /cert/revoke now, on the device's own active cert.
  async function handleForgetDevice() {
    Alert.alert(
      'Forget this device',
      "This revokes this device's certificate on the server and clears your vault and login from this device. Continue?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget device',
          style: 'destructive',
          onPress: async () => {
            try {
              const baseUrl = await getServerBaseUrl();
              const certInfo = await getActiveCertInfo();
              if (baseUrl && certInfo && sessionToken) {
                const api = createApiClient({ baseUrl, sessionToken });
                await api.certRevoke({ certId: certInfo.certId });
                await deleteKeyAlias(certInfo.alias);
              }
            } catch (err) {
              // Still proceed to clear local state even if the server
              // call failed (e.g. no network) -- the device-side
              // "forget" half should always succeed; the user can
              // revoke server-side later via the admin plane if needed.
              Alert.alert(
                'Could not revoke on server',
                `Local data was still cleared. ${err instanceof Error ? err.message : 'unknown error'}`,
              );
            }
            await deleteVaultKeystoreKey();
            await clearCachedSession();
            clearVault();
            clearVaultKey();
            clearSession();
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Biometric unlock</Text>
        <Switch
          value={biometricEnabled}
          onValueChange={setBiometricEnabled}
          disabled={!biometricHwAvailable}
        />
      </View>
      {!biometricHwAvailable ? (
        <Text style={styles.hint}>No biometric hardware enrolled on this device.</Text>
      ) : null}

      <TextField
        label="Idle lock timeout (seconds)"
        value={idleTimeoutInput}
        onChangeText={setIdleTimeoutInput}
        keyboardType="number-pad"
      />
      <Button title="Save timeout" variant="secondary" onPress={handleIdleTimeoutSave} />

      <Text style={styles.hint}>
        Your recovery key was shown once at setup. PWM never stores or re-displays it -- if you lost
        it, you&apos;ll need to set a new master password manually and lose access to recovery.
      </Text>

      <Button
        title="Forget this device"
        variant="danger"
        onPress={handleForgetDevice}
        style={styles.spaced}
      />
      <Button title="Log out" variant="secondary" onPress={handleLogout} style={styles.spaced} />
      <Button title="Back" onPress={() => setScreen('vaultList')} style={styles.spaced} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#0f172a' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rowLabel: { fontSize: 16, color: '#334155' },
  hint: { fontSize: 13, color: '#64748b', marginVertical: 12 },
  spaced: { marginTop: 8 },
});
