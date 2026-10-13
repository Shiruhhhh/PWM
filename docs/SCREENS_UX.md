# PWM — Screens / UX Spec (React Native, Android v1)

## Structure

```
packages/mobile/
  src/
    screens/
    components/
    native/        # Keystore + mTLS native module bridge
    state/
    services/
```

## Screens

### SetupScreen (first run)
Two-phase flow, not a single screen:

1. **Account step** — choose username, master password.
2. **RecoveryDisplayStep** — generate recovery key (32 random bytes → 24-word mnemonic or base58 string). Display full key once. User told to write it down / save securely. Tap "Continue" → key fully removed from screen render (not blurred/dimmed — unmounted).
3. **RecoveryConfirmStep** — blind confirmation, not a checkbox:
   - Input field only, recovery key itself **not shown** on this screen.
   - User types the **last 6 characters** of the key from memory/their saved copy.
   - Validate against value still held in JS state (not re-displayed to screen).
   - Mismatch → error message "doesn't match, check your saved copy" (don't reveal which characters were wrong). No retry limit — this is a UX nudge, not a security boundary.
   - Match → proceed.
4. Clear recovery key from JS memory/state immediately after match — never persisted, never logged, never transmitted anywhere beyond the one-time wrap operation already done locally.
5. Continue setup: derive keys (Argon2id → HKDF split), wrap vaultKey under both password-derived key and recovery key, register with server.

### LoginScreen
- Username + master password.
- Biometric prompt offered if already enrolled on this device.

### VaultListScreen
- Searchable list of entries.
- Pull-to-refresh triggers sync check.

### EntryDetailScreen
- View/copy fields.
- Copy-to-clipboard triggers auto-clear timer (per decision #4).

### EntryEditScreen
- Add/edit entry.
- Built-in password generator: configurable length, charset toggles (upper/lower/digit/symbol), cryptographically secure random (`react-native-get-random-values`, never `Math.random()`).

### SettingsScreen
- Idle lock timeout — configurable (decision #6 addendum).
- Biometric toggle.
- Manage devices/certs — list, revoke action per device.
- Recovery info reminder (does not re-display the key — just a reminder it exists/was shown once).
- Logout.

### RecoveryScreen (forgot master password)
- Enter recovery key.
- Set new master password.
- Unwraps vaultKey locally via recovery key, rewraps under new password-derived key, pushes update (reuses password-change flow server-side).

### Cert renewal
- No dedicated screen — handled as background flow near cert expiry, surfaced only as a toast/notification on success or failure. User action needed only if renewal fails repeatedly.

## State management

**Zustand** (not Redux — overkill for this app size).

- `authStore` — session token, login state, biometric-enrolled flag.
- `vaultStore` — decrypted entries, memory only, cleared on lock/background. Revision number, dirty/sync status.
- `settingsStore` — idle timeout value, biometric preference. Persisted via encrypted storage, not plain AsyncStorage.

## Native module needs

1. **Android Keystore wrapper** — hardware-backed key, `setUserAuthenticationRequired(true)`, wrap/unwrap `vaultKey`. Small Kotlin native module (`wrapKey()` / `unwrapKey()`).
2. **mTLS client cert networking** — `react-native-ssl-pinning` first choice (supports client cert + pinning); fall back to custom native module wrapping OkHttp `SSLSocketFactory` only if needed.
3. **Biometric prompt** — `react-native-biometrics` or `expo-local-authentication`.
4. **Encrypted local storage** — `react-native-encrypted-storage` (Keystore-backed) for wrapped vault blob cache + settings.

## App lifecycle / lock flow

1. Cold start: check encrypted cache for wrapped vault blob + stored session token.
   - Present + biometric enrolled → BiometricPrompt → unwrap vaultKey → decrypt cached blob → resume stored session (no `/login` call needed, session is rolling-TTL per API_SPEC.md) → show vault, background sync check.
   - No cache, or biometric declined/fails → master password screen (full `/login`, new session issued).
2. **Biometric failure fallback**: track consecutive biometric failures in memory (not persisted). After 3 consecutive failures, skip further biometric retries and fall straight to master password screen for that unlock attempt. Counter resets on any successful unlock (biometric or password).
3. App backgrounded → start idle timer (configurable).
4. Timer expires or app force-closed → clear in-memory `vaultStore`. Next resume requires unlock (biometric-first per step 1, not automatically master password).
5. On unlock success → `GET /vault`, compare revision, merge/pull/push per sync logic below. Every successful authenticated request also rolls the server session TTL forward (server-side behavior, see API_SPEC.md) — no separate client action needed.

## Sync logic (client side)

- Local edit → mark dirty, bump local revision marker.
- On foreground/resume → `GET /vault`, compare server revision vs last-known-synced:
  - Equal → no-op.
  - Server newer, no local dirty → pull, decrypt, replace local state.
  - Local dirty, server unchanged → push via `PUT /vault` with `expectedRevision`.
  - Both changed (conflict) → v1: last-write-wins with warning shown to user. True per-item merge deferred, out of scope for whole-blob-sync v1 model.
