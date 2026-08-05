module.exports = {
  forbidden: [
    {
      name: 'presentation-no-server-imports',
      from: { path: '(^|/)src/presentation/' },
      to: { path: '(^|/)server/' },
    },
    {
      name: 'server-no-app-imports',
      from: { path: '(^|/)server/src/' },
      to: { path: '(^|/)app/' },
    },
    {
      name: 'providers-stay-isolated',
      from: { path: '(^|/)(src/providers/|server/src/providers/)' },
      to: { path: '(^|/)(app/|src/presentation/|server/src/)' },
    },
    {
      name: 'core-no-server-imports',
      comment: 'Package/compiler/runtime/domain/capability/storage/sync core modules must not import server internals.',
      from: {
        path: '(^|/)(packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config)|src/(domain|ops|actions|chat|ai|workflows|config|health)|server/src/kernel|server/src/runtime|server/src/chat-runtime\\.ts)',
      },
      to: { path: '(^|/)server/src/' },
    },
    {
      name: 'core-no-app-imports',
      comment: 'Core modules must not import Expo Router app entrypoints.',
      from: {
        path: '(^|/)(packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config)|src/(domain|ops|actions|chat|ai|workflows|config|health)|server/src/kernel|server/src/runtime|server/src/chat-runtime\\.ts)',
      },
      to: { path: '(^|/)app/' },
    },
    {
      name: 'core-no-provider-imports',
      comment: 'Core modules must not import providers directly; use capability boundaries.',
      from: {
        path: '(^|/)(packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config)|src/(domain|ops|actions|chat|ai|workflows|config|health)|server/src/kernel|server/src/runtime|server/src/chat-runtime\\.ts)',
      },
      to: { path: '(^|/)(src/providers/|server/src/providers/)' },
    },
    {
      name: 'core-no-cloudflare-runtime',
      comment: 'Core-facing modules must not import deployment/runtime layers.',
      from: {
        path: '(^|/)(packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config)|src/(domain|ops|actions|chat|ai|workflows|config|health)|server/src/kernel|server/src/runtime|server/src/chat-runtime\\.ts)',
      },
      to: { path: '(^|/)(cloudflare/|@cloudflare/|/wrangler\\.js$|/wrangler\\.ts$)' },
    },
    {
      name: 'core-no-react-or-expo-ui',
      comment: 'Core-facing modules must stay UI-platform neutral.',
      from: {
        path: '(^|/)(packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config)|src/(domain|ops|actions|chat|ai|workflows|config|health)|server/src/kernel|server/src/runtime|server/src/chat-runtime\\.ts)',
      },
      to: {
        path: '(^|/)(react$|react-native$|react-native-[^/]+$|@react-native/[^/]+$|@expo/[^/]+$|expo-router$|expo-status-bar$|expo-splash-screen$|expo-symbols$|expo-sharing$|expo-secure-store$|expo-segment$|@json-render/react-native$|react-native-health-connect$|react-native-safe-area-context$)',
      },
    },
    {
      name: 'portable-core-ports-no-shell-runtime',
      comment: 'Portable Core port contracts must not import shell runtimes or concrete database implementations.',
      from: {
        path: '(^|/)src/domain/(database-port|runtime-context\.ports)\.ts$',
      },
      to: {
        path: '(^|/)(expo-sqlite$|react$|react-native$|node:fs$|node:path$|node:crypto$)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|dist|coverage|\\.expo',
    },
    tsConfig: {
      fileName: './tsconfig.json',
    },
    includeOnly: '(^|/)(app|src|server/src|packages/(app-compiler|runtime-kernel|schemas|shared/contracts|domain-config))/',
  },
};
