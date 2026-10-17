import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactNativePlugin from 'eslint-plugin-react-native';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/mobile/android/**',
      'services/ca/data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // RN's own scaffold config files (babel.config.js, jest.config.js,
    // metro.config.js) are plain CommonJS, loaded by Node directly --
    // not part of the TS/ESM app code, so they need Node's CJS globals.
    files: [
      'packages/mobile/babel.config.js',
      'packages/mobile/jest.config.js',
      'packages/mobile/metro.config.js',
      'packages/mobile/__mocks__/**/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // index.js is RN's actual app entrypoint (not a Node-run config file
    // like the block above) -- `global` here is React Native's JS runtime
    // global object, used to install polyfills before anything else loads.
    files: ['packages/mobile/index.js'],
    languageOptions: {
      globals: {
        global: 'writable',
      },
    },
  },
  {
    files: ['packages/mobile/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-native': reactNativePlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooksPlugin.configs['recommended-latest'].rules,
      'react/react-in-jsx-scope': 'off',
      'react-native/no-unused-styles': 'error',
      'react-native/no-inline-styles': 'warn',
      'react-native/no-raw-text': 'off',
    },
  },
);
