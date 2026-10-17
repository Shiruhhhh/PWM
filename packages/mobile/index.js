/**
 * @format
 */

// Must be the very first import -- Hermes has no global `crypto`, and
// anything imported after this (cryptoFlows, argon2kt bridge, BIP39, HKDF)
// calls crypto.getRandomValues() expecting the polyfill already installed.
import 'react-native-get-random-values';

// Hermes also has no global TextEncoder/TextDecoder -- @pwm/core's crypto
// code (keyWrap.ts, aad.ts) and its @noble/* dependencies need them.
// Unlike the crypto polyfill above, this package doesn't self-install as
// a global on import -- has to be assigned explicitly. Only surfaced once
// a real (non-empty) vault blob was decrypted on a real device -- see
// docs/DECISIONS.md #32.
import { TextEncoder, TextDecoder } from 'text-encoding';
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
