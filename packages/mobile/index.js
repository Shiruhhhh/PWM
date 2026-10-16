/**
 * @format
 */

// Must be the very first import -- Hermes has no global `crypto`, and
// anything imported after this (cryptoFlows, argon2kt bridge, BIP39, HKDF)
// calls crypto.getRandomValues() expecting the polyfill already installed.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
