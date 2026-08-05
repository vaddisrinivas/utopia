import type { AppPackage } from '@/src/kernel/schema';

const basePackage = (overrides: Partial<AppPackage> = {}): AppPackage => ({
  schemaVersion: 'wonder.app-package.v3',
  id: 'fixture-active',
  version: '1.0.0',
  catalog: { status: 'active' },
  collections: {
    item: {
      id: 'item',
      fields: {
        title: { type: 'text', required: true },
      },
    },
  },
  queries: {
    timeline: { from: 'item', limit: 20, orderBy: [{ field: 'title', direction: 'asc' }] },
  },
  computedFields: [],
  views: {
    timeline: { id: 'timeline', query: 'timeline', mode: 'list', fields: ['title'] },
  },
  rules: [],
  dataHomes: [{ id: 'local', kind: 'sqlite', mode: 'local', resource: 'sqlite' }],
  defaultDataHome: 'local',
  capabilities: ['records.read', 'records.write'],
  acceptanceTests: ['oracle-a'],
  dependencyPins: [],
  nativeCapabilities: {
    schemaVersion: 'wonder.app-package-native-capabilities.v1',
    platform: 'expo',
    packages: [],
    permissions: ['camera'],
    intents: [],
  },
  contractLock: {
    schemaVersion: 'wonder.package-contract-lock.v1',
    algorithm: 'sha256',
    checksum: `sha256:${'a'.repeat(64)}`,
    pinnedAt: '2026-08-04T00:00:00.000Z',
    dependencyPins: [],
    nativeCapabilities: {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'expo',
      packages: [],
      permissions: ['camera'],
      intents: [],
    },
  },
  presentation: {
    label: 'Fixture App',
    visualIdentity: {
      icon: 'sparkles',
      emoji: '⚙️',
      accent: '#3366ff',
      canvas: '#f7f7ff',
      tone: 'clean',
      secondary: '#1f2937',
      highlight: '#ef4444',
    },
    ui: {
      defaultScreen: 'home',
      screens: {
        home: {
          title: 'Home',
          components: [
            {
              kind: 'widget',
              id: 'timer',
              widget: 'durationTimer',
              title: 'Timer',
              query: { collections: ['item'] },
              action: { kind: 'create', collection: 'item', values: { title: 'default' } },
            },
          ],
        },
        settings: {
          title: 'Settings',
          components: [
            { kind: 'text', props: { text: 'Settings' } },
          ],
        },
      },
    },
  },
  ...overrides,
});

export const fixturePackages = (): AppPackage[] => [
  basePackage(),
  basePackage({
    id: 'fixture-inactive',
    catalog: { status: 'inactive', duplicateOf: 'fixture-active', similarity: 0.78, reason: 'capability-overlap' },
    presentation: {
      ...basePackage().presentation,
      label: 'Fixture Inactive',
    },
  }),
];

export const fixtureActivePackage = (): AppPackage => structuredClone(basePackage());
export const fixtureInactivePackage = (): AppPackage => structuredClone(basePackage({
  id: 'fixture-inactive',
  catalog: { status: 'inactive', duplicateOf: 'fixture-active', similarity: 0.78, reason: 'capability-overlap' },
}));
