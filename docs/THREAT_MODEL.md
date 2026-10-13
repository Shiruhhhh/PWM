# PWM — Threat Model

## What this protects against

- **Server/DB compromise**: attacker who dumps the entire database gets only encrypted vault blobs, salts, KDF params, and auth hashes — never plaintext passwords, master password, or vault key. Zero-knowledge design (see CRYPTO_SPEC.md).
- **Network eavesdropping**: all traffic over mTLS — both directions authenticated, confidential, tamper-evident.
- **Unauthenticated network access to the backend**: mTLS rejects any connection without a valid, CA-signed, non-revoked client certificate at the TLS handshake layer, before any application code runs.
- **Stolen/lost device, locked**: vault cache on disk is encrypted, keyed through Android Keystore + biometric gate. Without the device's biometric or the master password, cached data is not recoverable.
- **Forgotten master password**: recoverable via the recovery key — generated once, shown once, user-held, never stored by the app or server in usable form.
- **Credential stuffing / brute force on login**: rate-limited per-IP and per-username; the auth value itself is derived through a deliberately slow Argon2id pass, resisting offline guessing even if the DB leaked.
- **GCM nonce reuse, key reuse across purposes**: explicitly designed against — fresh random nonce per encryption, HKDF domain separation between `vaultKey` and `authKey`.
- **Lateral movement from other self-hosted services** (e.g. a compromised Minecraft server on the same Proxmox host): mitigated by network segmentation — pwm-app and pwm-ca firewalled to accept connections only from each other and the router's forwarded port, not from other LAN services (see PROXMOX_NETWORK.md).

## What this does NOT protect against

- **Keylogged or observed master password**: if the master password is captured at entry (malware, shoulder-surfing, compromised keyboard), the attacker can derive all keys exactly as the real user would. No client-side design defends against a compromised input path.
- **A device that is unlocked and in the attacker's hands**: once the vault is decrypted in memory on an unlocked device, screen/clipboard/app data is as exposed as any other unlocked app's data. Idle-lock timeout limits this window but does not eliminate it.
- **Physical coercion** ("rubber-hose cryptanalysis") — forcing the real user to unlock or reveal the master password/recovery key. No technical control addresses this.
- **A fully compromised client device** (rooted/jailbroken with attacker-controlled OS, or malware with Accessibility/root-level access): Android Keystore protections assume OS integrity; a sufficiently compromised OS can potentially extract keys or intercept biometric unlock.
- **Loss of both the master password and the recovery key simultaneously**: by design, this means permanent, unrecoverable data loss — this is the accepted tradeoff of a true zero-knowledge system, not a bug.
- **An undiscovered vulnerability in the custom crypto/protocol implementation**: this is a personal/educational project, not independently audited. See disclaimer below.
- **Supply-chain compromise of a dependency** (npm package, Docker base image): standard due diligence (dependency pinning, lockfiles, minimal dependency surface per DEPENDENCIES.md) reduces but does not eliminate this risk.
- **Denial of service**: an attacker flooding the exposed port 443 can degrade availability even though they cannot authenticate — mTLS prevents data compromise, not resource exhaustion. Not a priority mitigation at this project's scale.

## Disclaimer

This is a personal, educational, self-hosted project. It has not undergone independent professional security audit. The crypto design follows established primitives and patterns (Argon2id, AES-256-GCM, HKDF, mTLS) deliberately chosen to match well-reviewed designs (e.g. Bitwarden's published crypto model), but implementation bugs are possible in any from-scratch build. Use at your own risk for genuinely high-value secrets; treat this as a learning project first, production-grade guarantee second.
