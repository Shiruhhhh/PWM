module.exports = {
  preset: '@react-native/jest-preset',
  // @react-native/jest-preset's own transformIgnorePatterns anchors
  // "@react-native/..." immediately after the first node_modules/ segment,
  // which pnpm's content-addressable store breaks (real path is
  // node_modules/.pnpm/@react-native+x@.../node_modules/@react-native/x/...,
  // so "@react-native" never appears right after node_modules/). Since
  // pnpm's store is one global, deduped set of real npm packages anyway,
  // just transform everything -- untransformed plain JS/CJS still passes
  // through babel-jest unchanged, so this costs a little time, not
  // correctness.
  transformIgnorePatterns: [],
};
