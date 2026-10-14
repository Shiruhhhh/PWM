const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * pnpm links packages through symlinks into a content-addressable
 * `.pnpm/` store (including the workspace's own @pwm/core), which
 * Metro's default resolver doesn't follow -- without this it fails to
 * resolve even plain devDep-adjacent packages like @babel/runtime at
 * bundle time (not caught by `tsc`/Jest, only by an actual metro bundle).
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  watchFolders: [path.resolve(__dirname, '../..')],
  resolver: {
    ...defaultConfig.resolver,
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    extraNodeModules: new Proxy(
      {},
      {
        get: (_target, name) => path.join(__dirname, 'node_modules', String(name)),
      },
    ),
  },
};

module.exports = mergeConfig(defaultConfig, config);
