import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppPackage, A2UiSurface } from '@/packages/shared/contracts/package';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import { loadAppPackage } from '@/src/domain/package-loader';
import { recordsToViews } from '@/src/domain/renderer';

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

vi.mock('@json-render/react-native', () => ({
  JSONUIProvider: ({ children }: { children: unknown }) => children,
  Renderer: () => null,
  createStandardActionHandlers: () => ({}),
}));

vi.mock('@/src/presentation/json-render-widgets', () => ({
  JSON_RENDER_WIDGET_REGISTRY: {},
}));

vi.mock('@/src/theme', () => ({
  useUtopiaTheme: () => ({ dark: false }),
  colors: {
    canvas: '#FBF7EE',
    ink: '#111111',
    muted: '#555555',
    moss: '#336633',
  },
}));

let buildJsonRenderSpec: typeof import('@/src/presentation/json-render-surface').buildJsonRenderSpec;

beforeAll(async () => {
  ({ buildJsonRenderSpec } = await import('@/src/presentation/json-render-surface'));
});

describe('reference app renderer', () => {
  it('composes today, chores, and household screens from compiled JSON', () => {
    const runtime = loadReferenceRuntime('1.0.0');
    const records = loadReferenceRecords();

    for (const screen of ['today', 'chores', 'household'] as const) {
      const spec = buildJsonRenderSpec({
        title: runtime.activeManifest.label,
        ui: runtime.activeManifest.ui,
        screen,
        records,
      });
      expect(spec.root).toBeTruthy();
      expect(specText(spec)).toContain(screen === 'today' ? 'Today' : screen === 'chores' ? 'Chores' : 'Household');
    }
  });

  it('uses package empty-state copy and renders 1.1.0 chore metadata', () => {
    const runtimeV1 = loadReferenceRuntime('1.0.0');
    const runtimeV11 = loadReferenceRuntime('1.1.0');
    const records = loadReferenceRecords();

    const emptySpec = buildJsonRenderSpec({
      title: runtimeV1.activeManifest.label,
      ui: runtimeV1.activeManifest.ui,
      screen: 'chores',
      records: records.filter((record) => record.collection !== 'chore'),
    });
    expect(specText(emptySpec)).toContain('No chores ready yet.');

    const v11Spec = buildJsonRenderSpec({
      title: runtimeV11.activeManifest.label,
      ui: runtimeV11.activeManifest.ui,
      screen: 'chores',
      records,
    });
    expect(specText(v11Spec)).toContain('15 min · Daily');
    expect(specText(v11Spec)).toContain('30 min · Weekly');
  });

  it('shows a neutral unsupported state and survives malformed widget props', () => {
    const spec = buildJsonRenderSpec({
      title: 'Custom',
      screen: 'custom',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'custom',
        screens: {
          custom: {
            title: 'Custom',
            components: [
              { kind: 'widget', widget: 'unknown_widget', title: 'Mystery block' } as any,
              { kind: 'widget', widget: 'feedList', title: 'Feed', props: { items: 'bad' } } as any,
              { kind: 'widget', widget: 'dataTable', title: 'Table', props: { items: 'bad', columns: 'bad' } } as any,
            ],
          },
        },
      } satisfies A2UiSurface,
    });

    const text = specText(spec);
    expect(text).toContain('Mystery block');
    expect(text).toContain('This package component is unavailable in this runtime.');
    expect(text).toContain('No feed items yet');
    expect(text).toContain('Sample');
  });

  it('maps the extracted panel widget family and keeps blocked widgets blocked', () => {
    const spec = buildJsonRenderSpec({
      title: 'Generic',
      screen: 'custom',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'custom',
        screens: {
          custom: {
            title: 'Generic',
            components: [
              { kind: 'widget', widget: 'unknown_widget', title: 'Mystery block' } as any,
              { kind: 'widget', widget: 'pollCard', title: 'Decision' } as any,
              { kind: 'widget', widget: 'kanbanBoard', title: 'Board view' } as any,
              { kind: 'widget', widget: 'formCard', title: 'Capture form' } as any,
            ],
          },
        },
      } satisfies A2UiSurface,
    });

    const text = specText(spec);
    expect(text).toContain('This package component is unavailable in this runtime.');
    expect(Object.values(spec.elements).some((element) => element.type === 'PollCardWidget')).toBe(true);
    expect(Object.values(spec.elements).some((element) => element.type === 'KanbanBoardWidget')).toBe(true);
    expect(Object.values(spec.elements).some((element) => element.type === 'FormCardWidget')).toBe(true);
    expect(text).toContain('Decision');
    expect(text).toContain('Board view');
    expect(text).toContain('Capture form');
  });

  it('renders extracted panel widgets consistently across reference fixture versions', () => {
    for (const version of ['1.0.0', '1.1.0'] as const) {
      const runtime = loadReferenceRuntime(version);
      const spec = buildJsonRenderSpec({
        title: runtime.activeManifest.label,
        screen: 'custom',
        records: [],
        ui: {
          schemaVersion: 'a2ui.v0_9',
          defaultScreen: 'custom',
          screens: {
            custom: {
              title: 'Custom',
              components: [
                { kind: 'widget', widget: 'pollCard', title: `Poll ${version}` },
                { kind: 'widget', widget: 'kanbanBoard', title: `Board ${version}` },
                { kind: 'widget', widget: 'formCard', title: `Form ${version}` },
              ],
            },
          },
        } satisfies A2UiSurface,
      });
      const screenText = specText(spec);
      expect(Object.values(spec.elements).some((element) => element.type === 'PollCardWidget')).toBe(true);
      expect(Object.values(spec.elements).some((element) => element.type === 'KanbanBoardWidget')).toBe(true);
      expect(Object.values(spec.elements).some((element) => element.type === 'FormCardWidget')).toBe(true);
      expect(screenText).toContain(`Poll ${version}`);
      expect(screenText).toContain(`Board ${version}`);
      expect(screenText).toContain(`Form ${version}`);
    }
  });

  it('maps navigation and record-list widgets from surface composition', () => {
    const spec = buildJsonRenderSpec({
      title: 'Navigation',
      screen: 'custom',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'custom',
        screens: {
          custom: {
            title: 'Navigation surface',
            components: [
              { kind: 'action', placement: 'top', action: { label: 'Open', route: '/settings', payload: { route: '/settings' } } },
              { kind: 'action', placement: 'fab', action: { label: 'Capture', route: '/record/new', payload: { route: '/record/new' } } },
              { kind: 'recordList', title: 'Search', props: { searchable: true } },
            ] as any[],
          },
        },
      } satisfies A2UiSurface,
    });

    const elementTypes = Object.values(spec.elements).map((element) => element.type);
    expect(elementTypes).toContain('ScreenHeaderWidget');
    expect(elementTypes).toContain('FloatingActionWidget');
    expect(elementTypes).toContain('SearchableRecordListWidget');
  });

  it('uses galleryGrid as a generic inventory surface with item details', () => {
    const spec = buildJsonRenderSpec({
      title: 'Workshop',
      screen: 'equipment',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'equipment',
        screens: {
          equipment: {
            title: 'Equipment cabinet',
            components: [{
              kind: 'widget',
              widget: 'galleryGrid',
              title: 'Storage zones',
              props: {
                items: [
                  { title: 'Power tools', subtitle: 'Drills, batteries, and chargers', emoji: 'Tools', route: '/tools' },
                  { title: 'Safety gear', subtitle: 'Gloves, glasses, and masks', emoji: 'Safety', route: '/safety' },
                ],
              },
            }],
          },
        },
      },
    });

    const text = specText(spec);
    expect(text).toContain('Power tools');
    expect(text).toContain('Drills, batteries, and chargers');
    expect(text).toContain('Safety gear');
    expect(Object.values(spec.elements).filter((element) => element.type === 'Pressable')).toHaveLength(2);
  });

  it('binds dataTable rows from a queried record array field', () => {
    const spec = buildJsonRenderSpec({
      title: 'Allocation',
      screen: 'results',
      records: [{
        id: 'result-1',
        collection: 'result',
        title: 'Allocation result',
        body: '',
        source: 'local',
        status: 'Ready',
        tone: 'neutral',
        meta: '',
        properties: {
          rows: [
            { source: 'Alpha', target: 'Beta', amount: '12.50' },
            { source: 'Gamma', target: 'Beta', amount: '7.25' },
          ],
        },
      }],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'results',
        screens: {
          results: {
            components: [{
              kind: 'widget',
              widget: 'dataTable',
              title: 'Transfers',
              query: { collections: ['result'], limit: 1 },
              props: {
                itemsFromRecordField: 'rows',
                columns: [
                  { key: 'source', label: 'From' },
                  { key: 'target', label: 'To' },
                  { key: 'amount', label: 'Amount' },
                ],
              },
            }],
          },
        },
      },
    });

    const text = specText(spec);
    expect(text).toContain('Alpha');
    expect(text).toContain('Gamma');
    expect(text).toContain('12.50');
    expect(text).not.toContain('Sample');
  });

  it('renders chartBlock with configured points and fallback defaults', () => {
    const spec = buildJsonRenderSpec({
      title: 'Metrics',
      screen: 'charts',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'charts',
        screens: {
          charts: {
            components: [{
              kind: 'widget',
              widget: 'chartBlock',
              title: 'Spend',
              props: {
                points: [
                  { label: 'A', value: 4 },
                  { label: 'B', value: 8 },
                ],
              },
            }],
          },
        },
      },
    });
    const fallbackSpec = buildJsonRenderSpec({
      title: 'Charts',
      screen: 'fallback',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'fallback',
        screens: {
          fallback: {
            components: [{
              kind: 'widget',
              widget: 'chartBlock',
              title: 'Usage',
            }],
          },
        },
      },
    });

    expect(specText(spec)).toContain('Spend');
    expect(specText(spec)).toContain('A');
    expect(specText(spec)).toContain('B');
    expect(specText(spec)).toContain('8');
    expect(Object.values(spec.elements).filter((element) => element.type === 'ProgressBar')).toHaveLength(2);
    expect(specText(fallbackSpec)).toContain('A');
    expect(specText(fallbackSpec)).toContain('B');
    expect(specText(fallbackSpec)).toContain('C');
  });

  it('renders metric count from query-filtered records and default title', () => {
    const records = recordsToViews([
      genericRecord('task-1', 'Open pull request', 'Draft review notes', 'medium'),
      genericRecord('task-2', 'Run tests', 'Gate checks and export web', 'high'),
    ]);
    const spec = buildJsonRenderSpec({
      title: 'Counts',
      screen: 'counts',
      records,
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'counts',
        screens: {
          counts: {
            components: [{
              kind: 'metric',
              title: 'Task count',
              query: { collections: ['task'], limit: 1 },
            }],
          },
        },
      },
    });

    expect(specText(spec)).toContain('Task count');
    expect(Object.values(spec.elements).filter((element) => element.type === 'Heading').map((element) => element.props.text)).toContain('1');
  });

  it('preserves dataTable row action bindings from item payloads', () => {
    const spec = buildJsonRenderSpec({
      title: 'Allocation',
      screen: 'results',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'results',
        screens: {
          results: {
            components: [{
              kind: 'widget',
              widget: 'dataTable',
              title: 'Transfers',
              props: {
                items: [{ name: 'Alpha', status: 'Ready', owner: 'Team A', route: '/record/alpha' }],
                columns: [
                  { key: 'name', label: 'Name' },
                  { key: 'status', label: 'Status' },
                  { key: 'owner', label: 'Owner' },
                ],
              },
            }],
          },
        },
      },
    });

    const pressBindings = Object.values(spec.elements)
      .filter((element) => element.type === 'Pressable')
      .flatMap((element) => element.on?.press ? [element.on.press] : []);
    expect(pressBindings).toContainEqual({ action: 'navigate', params: { screen: '/record/alpha' } });
  });

  it('applies persisted density to JSON-render surface spacing', () => {
    const runtime = loadReferenceRuntime('1.0.0');
    const comfortable = buildJsonRenderSpec({
      title: runtime.activeManifest.label,
      ui: runtime.activeManifest.ui,
      screen: 'today',
      records: [],
    }, { density: 'comfortable' });
    const compact = buildJsonRenderSpec({
      title: runtime.activeManifest.label,
      ui: runtime.activeManifest.ui,
      screen: 'today',
      records: [],
    }, { density: 'compact' });

    expect(firstColumnProps(comfortable).gap).toBe(14);
    expect(firstColumnProps(compact).gap).toBe(10);
    expect(firstColumnProps(compact).padding).toBe(12);
  });

  it('renders a configured assistant as a full-page surface without nested page scrolling', () => {
    const spec = buildJsonRenderSpec({
      title: 'Food',
      screen: 'chat',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'chat',
        screens: {
          chat: {
            title: 'Wonder',
            components: [
              {
                kind: 'widget',
                widget: 'assistantChat',
                props: { fullPage: true, showHeader: false },
              },
            ],
          },
        },
      },
    });

    expect(Object.values(spec.elements).some((element) => element.type === 'ScrollContainer')).toBe(false);
    expect(Object.values(spec.elements).find((element) => element.type === 'AssistantChatWidget')?.props.fullPage).toBe(true);
  });

  it('never turns an incomplete action into an implicit chat navigation', () => {
    const spec = buildJsonRenderSpec({
      title: 'Actions',
      screen: 'actions',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'actions',
        screens: {
          actions: {
            components: [
              {
                kind: 'action',
                title: 'Incomplete',
                action: { kind: 'propose', label: 'Dead button', command: 'missing_route' },
              },
              {
                kind: 'action',
                title: 'Working',
                action: { kind: 'propose', label: 'Settings', command: 'open_settings', payload: { route: '/settings' } },
              },
            ],
          },
        },
      },
    });

    const buttons = Object.values(spec.elements).filter((element) => element.type === 'Button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props.label).toBe('Settings');
    expect(buttons[0]?.on?.press).toEqual({
      action: 'navigate',
      params: { screen: '/settings' },
    });
  });

  it('renders package-declared top and floating actions as navigation chrome', () => {
    const spec = buildJsonRenderSpec({
      title: 'Actions',
      screen: 'actions',
      showBack: true,
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'actions',
        screens: {
          actions: {
            title: 'Kitchen',
            components: [
              {
                kind: 'action',
                id: 'settings',
                placement: 'top',
                action: { kind: 'propose', label: 'Settings', command: 'open_settings', payload: { route: '/settings' } },
              },
              {
                kind: 'action',
                id: 'add',
                placement: 'fab',
                action: { kind: 'propose', label: 'Add', command: 'open_capture', payload: { route: '/capture' } },
              },
            ],
          },
        },
      },
    });

    const header = Object.values(spec.elements).find((element) => element.type === 'ScreenHeaderWidget');
    const fab = Object.values(spec.elements).find((element) => element.type === 'FloatingActionWidget');
    expect(header?.props).toMatchObject({
      title: 'Kitchen',
      showBack: true,
      actionLabel: 'Settings',
      actionRoute: '/settings',
    });
    expect(fab?.props).toMatchObject({ label: 'Add', route: '/capture' });
    expect(Object.values(spec.elements).filter((element) => element.type === 'Card')).toHaveLength(0);
  });

  it('preserves chat query params when package actions target Ask', () => {
    const spec = buildJsonRenderSpec({
      title: 'Actions',
      screen: 'actions',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'actions',
        screens: {
          actions: {
            title: 'Kitchen',
            components: [
              {
                kind: 'action',
                id: 'ask',
                action: {
                  kind: 'propose',
                  label: 'Plan dinner',
                  command: 'ask_food',
                  payload: { route: '/chat?prompt=Plan%20dinner&run=1' },
                },
              },
            ],
          },
        },
      },
    });

    const button = Object.values(spec.elements).find((element) => element.type === 'Button');
    expect(button?.on?.press).toEqual({
      action: 'navigate',
      params: { screen: '/chat?prompt=Plan%20dinner&run=1' },
    });
  });

  it('keeps the Food overview free of a global top Add button', async () => {
    const food = (await import('@/packages/domain-config/domains/food.v1.json')).default as any;
    const overview = food.ui.screens.overview.components;
    expect(overview.some((component: any) => component.placement === 'top' && component.action?.label?.includes('Add'))).toBe(false);
  });

  it('keeps installation launch routes scoped under /apps/:installationId', async () => {
    const { getAppInstallation, installApprovedAppPackage } = await import('@/src/db/app-package-registry');
    const { buildPackageInstallApprovalReceipt, buildPackageInstallPreview } = await import('@/packages/shared/contracts/package-install');
    const { MemoryDb } = await import('@/tests/helpers/memory-db');

    const db = new MemoryDb() as any;
    const appPackage = loadReferenceRuntime('1.0.0').activePackage;
    const preview = buildPackageInstallPreview(appPackage, { sourceUrl: 'https://example.com/apps/reference.package.json' });
    const approval = buildPackageInstallApprovalReceipt(preview, 'test-user', '2026-07-28T00:00:00.000Z');

    const installation = await installApprovedAppPackage(db, {
      packageJson: appPackage,
      preview,
      approval,
      installationId: 'reference-install',
      now: '2026-07-28T00:00:01.000Z',
    });

    expect(installation.activation?.launchPath).toBe('/apps/reference-install');
    expect((await getAppInstallation(db, 'reference-install'))?.activation?.launchPath).toBe('/apps/reference-install');
  });

  it('promotes package-declared searchable lists and details to interactive widgets', () => {
    const genericRecords = recordsToViews([
      genericRecord('task-1', 'Write architecture notes', 'Draft testable behavior specs.', 'high'),
      genericRecord('task-2', 'Ship validation', 'Proof rendering stays generic.', 'medium'),
    ]);
    const searchable = buildJsonRenderSpec({
      title: 'Records',
      screen: 'records',
      records: genericRecords,
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'records',
        screens: {
          records: {
            components: [{
              kind: 'recordList',
              id: 'search',
              query: { limit: 100 },
              props: { searchable: true, placeholder: 'Find anything' },
            }],
          },
        },
      },
    });
    const detail = buildJsonRenderSpec({
      title: 'Detail',
      screen: 'detail',
      records: genericRecords.slice(0, 1),
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'detail',
        screens: {
          detail: {
            components: [{
              kind: 'recordList',
              id: 'detail',
              query: { limit: 1 },
              props: { detail: true },
            }],
          },
        },
      },
    });

    const searchProps = Object.values(searchable.elements)
      .find((element) => element.type === 'SearchableRecordListWidget')?.props;
    expect(searchProps).toMatchObject({ placeholder: 'Find anything', searchable: true });
    expect(searchProps?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Write architecture notes' }),
      expect.objectContaining({ title: 'Ship validation' }),
    ]));

    const detailProps = Object.values(detail.elements)
      .find((element) => element.type === 'RecordDetailWidget')?.props;
    expect(detailProps).toMatchObject({ detail: true });
    expect(detailProps?.records).toEqual([
      expect.objectContaining({
        title: 'Write architecture notes',
        body: 'Draft testable behavior specs.',
        properties: expect.objectContaining({ emoji: '🧩' }),
      }),
    ]);
  });

  it('maps generic timed-flow widgets without app-specific renderer types', () => {
    const spec = buildJsonRenderSpec({
      title: 'Intervals',
      screen: 'session',
      records: [],
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'session',
        screens: {
          session: {
            components: [
              {
                kind: 'widget',
                widget: 'stepFlow',
                title: 'Session',
                props: {
                  runId: 'session',
                  steps: [{ id: 'focus', title: 'Focus', durationSeconds: 60 }],
                },
              },
              {
                kind: 'widget',
                widget: 'durationTimer',
                title: 'Break',
                props: { runId: 'break', label: 'Break', durationSeconds: 30 },
              },
            ],
          },
        },
      },
    });

    expect(Object.values(spec.elements).some((element) => element.type === 'StepFlowWidget')).toBe(true);
    expect(Object.values(spec.elements).some((element) => element.type === 'DurationTimerWidget')).toBe(true);
  });

  it('keeps runtime renderer generic and free of reference collection hardcodes', () => {
    const source = [
      'src/presentation/json-render-route.tsx',
      'src/presentation/json-render-surface.tsx',
      'src/presentation/json-render-widgets.tsx',
      'src/domain/renderer.tsx',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(source).not.toMatch(/\breference-app\b/);
    expect(source).not.toMatch(/\bchore\b/);
    expect(source).not.toMatch(/\bassignment\b/);
    expect(source).not.toMatch(/\bhousehold_member\b/);
    expect(source).not.toMatch(/\bcompletion\b/);
    expect(source).not.toMatch(/\bshopping_item\b/);
    expect(source).not.toMatch(/\binventory\b/);
    expect(source).not.toMatch(/\bmeal_plan\b/);
    expect(source).not.toMatch(/\bpantry\b/);
    expect(source).not.toMatch(/\bshopping\b/);
    expect(source).not.toContain('Ask Wonder');
    expect(source).not.toMatch(/\bWonder\b/);
  });

  it('keeps local file widgets in a bounded neutral family', () => {
    const parentSource = readFileSync('src/presentation/json-render-widgets.tsx', 'utf8');
    const familySource = readFileSync('src/presentation/widgets/file-widgets.tsx', 'utf8');

    expect(parentSource).toContain("from '@/src/presentation/widgets/file-widgets'");
    expect(parentSource).not.toContain('function FilePickerWidget');
    expect(parentSource).not.toContain('function FileExportWidget');
    expect(familySource).toContain('requestWidgetCapability');
    expect(familySource).toMatch(/kind:\s*'file-picker'[\s\S]*action:\s*'choose'[\s\S]*declaredPurpose:/);
    expect(familySource).toMatch(/kind:\s*'file-export'[\s\S]*action:\s*'export'[\s\S]*declaredPurpose:/);
    expect(familySource).not.toMatch(/@\/src\/(db|chat|providers|health|settings)\//);
    expect(familySource.split('\n').length).toBeLessThanOrEqual(260);
  });
});

function loadReferenceRuntime(version: '1.0.0' | '1.1.0') {
  const parsed = JSON.parse(
    readFileSync(`tests/fixtures/app-packages/reference-app/compiled/reference-app-${version}.package.json`, 'utf8'),
  ) as AppPackage;
  return loadAppPackage(parsed);
}

function loadReferenceRecords() {
  const parsed = JSON.parse(
    readFileSync('tests/fixtures/app-packages/reference-app/fixtures/records.json', 'utf8'),
  ) as CanonicalRecord[];
  return recordsToViews(parsed);
}

function genericRecord(id: string, title: string, body: string, priority: string): CanonicalRecord {
  const timestamp = '2026-07-29T00:00:00.000Z';
  return {
    id,
    domain: 'work',
    collection: 'task',
    title,
    properties: {
      body,
      emoji: id === 'task-1' ? '🧩' : '✅',
      area: id === 'task-1' ? 'Desk' : 'Board',
      units: id === 'task-1' ? '2' : '3',
      due_date: '2026-12-31',
      priority,
    },
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: id,
      url: null,
      observed_at: timestamp,
      content_hash: null,
    },
    archived_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    revision: 1,
    schema_version: 'utopia.record.v1',
    deleted: false,
    privacy: 'personal',
    provenance: {
      actor: 'user',
      confidence: null,
      evidence: [],
      reason: 'renderer_test_fixture',
    },
  };
}

function firstColumnProps(spec: { elements: Record<string, { type?: string; props?: Record<string, unknown> }> }) {
  const column = Object.values(spec.elements).find((element) => element.type === 'Column');
  if (!column?.props) throw new Error('Column element missing');
  return column.props;
}

function specText(spec: { elements: Record<string, { props?: Record<string, unknown> }> }) {
  return Object.values(spec.elements)
    .flatMap((element) => Object.values(element.props ?? {}))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}
