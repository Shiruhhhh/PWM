// react-native-config's native module isn't available under Jest (no real
// native build in test). Standard documented workaround: mock Config as a
// plain object -- tests cover config.ts's fallback logic, not .env parsing.
module.exports = {
  SERVER_URL: undefined,
  BOOTSTRAP_URL: undefined,
};
