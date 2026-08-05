import { describe, expect, it } from 'vitest';

import { enrichCatalog, enrichPackage } from '@/scripts/enrich-catalog';
import { recordBindableWidgets } from '@/src/kernel/widget-support';

const basePackage = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'wonder.app-package.v3',
  id: 'field-camera',
  version: '1.0.0',
  catalog: { status: 'active' },
  collections: {
    job: { id: 'job', fields: { title: { type: 'text', required: true } } },
  },
  queries: { jobs: { from: 'job', limit: 20 } },
  views: { jobs: { id: 'jobs', query: 'jobs', mode: 'list', fields: ['title', 'due_at'] } },
  rules: [],
  dataHomes: [{ id: 'local', kind: 'sqlite', mode: 'local' }],
  defaultDataHome: 'local',
  capabilities: ['records.read', 'records.write', 'camera.scan'],
  acceptanceTests: [],
  dependencyPins: [],
  nativeCapabilities: {
    schemaVersion: 'wonder.app-package-native-capabilities.v1',
    platform: 'expo',
    packages: ['expo-camera'],
    permissions: [{ permission: 'camera' }],
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
      packages: ['expo-camera'],
      permissions: [{ permission: 'camera' }],
      intents: [],
    },
  },
  presentation: {
    label: 'Field Camera',
    visualIdentity: {},
    ui: {
      defaultScreen: 'home',
      screens: {
        home: { title: 'Today', components: [{ kind: 'widget', widget: 'formCard', action: { kind: 'create', collection: 'job' } }] },
        settings: { title: 'Settings', components: [{ kind: 'text', props: { text: 'Ready' } }] },
      },
    },
  },
  ...overrides,
});

describe('catalog enrichment', () => {
  it('adds deterministic accessible identity, supported navigation icons, and backed native widgets', () => {
    const result = enrichPackage(basePackage());
    const identity = result.package.presentation.visualIdentity as Record<string, unknown>;
    expect(identity.accent).toMatch(/^#[0-9A-F]{6}$/);
    expect(identity.canvas).toMatch(/^#[0-9A-F]{6}$/);
    expect(identity.palette).toMatchObject({ secondary: expect.any(String), highlight: expect.any(String) });
    expect(identity.emoji).toBe('📷');
    expect(result.package.presentation.ui.navigation?.items.map((item) => item.icon)).toEqual(['home', 'settings']);
    expect(result.addedWidgets).toEqual(['cameraScanner']);
    expect(result.package.presentation.ui.screens.home.components.some((component) => component.widget === 'assetBlock')).toBe(false);
    expect(result.package.presentation.ui.screens.home.components.at(-1)?.props).toMatchObject({ emoji: '📷' });
  });

  it('is idempotent and does not invent media URLs or unsupported widgets', () => {
    const first = enrichPackage(basePackage({
      id: 'plain-list',
      capabilities: [],
      nativeCapabilities: { schemaVersion: 'wonder.app-package-native-capabilities.v1', platform: 'expo', packages: [], permissions: [], intents: [] },
      presentation: { label: 'Plain List', ui: { defaultScreen: 'home', screens: { home: { title: 'List', components: [] } } } },
      collections: {},
      queries: {},
      views: {},
    }));
    const second = enrichPackage(first.package);
    expect(second.changed).toBe(false);
    expect(second.package).toEqual(first.package);
    expect(JSON.stringify(first.package)).not.toMatch(/https?:\/\//);
    expect(first.addedWidgets).toEqual([]);
  });

  it('reports a dry-run without requiring writes', () => {
    const { packages, report } = enrichCatalog([basePackage(), basePackage({ id: 'second-app', presentation: { label: 'Second App', ui: { screens: { home: { title: 'Home', components: [] } } } } })]);
    expect(packages).toHaveLength(2);
    expect(report).toMatchObject({ schemaVersion: 'utopia.catalog-enrichment.v1', dryRun: true, packages: 2, changed: 2 });
    expect(report.results.every((result) => result.changes.length > 0)).toBe(true);
  });

  it('adds only task-appropriate record-bound experiences', () => {
    const result = enrichPackage(basePackage({
      id: 'project-analytics-calendar',
      capabilities: ['project.tasks', 'analytics.dashboard', 'calendar.events', 'photo.gallery'],
      collections: {
        work: { id: 'work', fields: {
          title: { type: 'text' }, status: { type: 'text' }, completed: { type: 'boolean' },
          score: { type: 'number' }, due_at: { type: 'timestamp' }, cover_url: { type: 'text' },
        } },
      },
      queries: { work: { from: 'work' } },
      views: { work: { id: 'work', query: 'work', mode: 'list', fields: ['title'] } },
    }));
    expect(result.addedWidgets).toEqual(expect.arrayContaining(['galleryGrid', 'chartBlock', 'calendarBlock', 'checklistCard', 'kanbanBoard']));
    for (const widget of ['galleryGrid', 'chartBlock', 'calendarBlock', 'checklistCard']) expect(recordBindableWidgets.has(widget)).toBe(true);
    const components = result.package.presentation.ui.screens.home.components;
    expect(components.filter((component) => recordBindableWidgets.has(component.widget ?? '') || component.widget === 'kanbanBoard').every((component) => component.query?.collections?.[0] === 'work')).toBe(true);
  });
});
