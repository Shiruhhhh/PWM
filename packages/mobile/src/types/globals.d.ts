// react-native-get-random-values polyfills a minimal `crypto.getRandomValues`
// global (Hermes has no native WebCrypto); the package ships no types.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};
