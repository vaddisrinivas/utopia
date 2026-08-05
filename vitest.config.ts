import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: 'false',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'expo-crypto': fileURLToPath(new URL('./tests/mocks/expo-crypto.ts', import.meta.url)),
      'react-native': fileURLToPath(new URL('./tests/mocks/react-native.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
