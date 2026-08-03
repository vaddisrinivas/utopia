import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: () => false, replace: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return { ...actual, useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }) };
});
vi.mock('@json-render/react-native', () => ({
  JSONUIProvider: ({ children }: { children: unknown }) => children,
  Renderer: () => null,
  createStandardActionHandlers: () => ({}),
}));
vi.mock('@/src/presentation/json-render-widgets', () => ({ JSON_RENDER_WIDGET_REGISTRY: {} }));
vi.mock('@/src/theme', () => ({ useUtopiaTheme: () => ({ dark: false, density: 'comfortable' }) }));

import { buildJsonRenderSpec } from '@/src/presentation/json-render-surface';

const ui = {
  schemaVersion: 'a2ui.v0_9' as const,
  defaultScreen: 'budget',
  screens: {
    budget: {
      components: [{
        kind: 'widget' as const,
        widget: 'dataTable' as const,
        title: 'Budget rows',
        query: { collections: ['budget_entry'], limit: 20 },
        props: {
          columns: [
            { key: 'title', label: 'Entry' },
            { key: 'direction', label: 'Type' },
            { key: 'category', label: 'Category' },
            { key: 'amount', label: 'Amount' },
            { key: 'route', label: 'Action' },
          ],
        },
      }],
    },
  },
};

const surface = {
  title: 'Budget',
  screen: 'budget',
  records: [{
    id: 'entry-1', collection: 'budget_entry', title: 'August salary', body: '', source: 'local', status: 'Ready', tone: 'neutral' as const, meta: '',
    properties: { direction: 'income', category: 'Pay', amount: 5000, route: '/record/entry-1' },
  }],
  ui,
};

function elementsWith(spec: { elements: Record<string, { type: string; props: Record<string, unknown>; on?: Record<string, unknown> }> }, type: string) {
  return Object.values(spec.elements).filter((element) => element.type === type);
}

describe('generic dataTable responsive contract', () => {
  it('uses intact labeled records on narrow screens and preserves values and actions', () => {
    const spec = buildJsonRenderSpec(surface, { viewportWidth: 390 });
    expect(elementsWith(spec, 'Container').some((element) => element.props.accessibilityRole === 'list')).toBe(true);
    expect(elementsWith(spec, 'Label').filter((element) => ['Entry', 'Type', 'Category', 'Amount', 'Action'].includes(String(element.props.text)))).toHaveLength(10);
    expect(elementsWith(spec, 'Paragraph').map((element) => element.props.text)).toEqual(expect.arrayContaining(['August salary', 'income', 'Pay', '5000', '/record/entry-1']));
    expect(elementsWith(spec, 'Pressable').map((element) => element.on?.press)).toContainEqual({ action: 'navigate', params: { screen: '/record/entry-1' } });
  });

  it('uses a semantic table-like grid on wide screens without app-specific behavior', () => {
    const spec = buildJsonRenderSpec(surface, { viewportWidth: 1024 });
    expect(elementsWith(spec, 'Container').some((element) => element.props.accessibilityRole === 'table')).toBe(true);
    expect(elementsWith(spec, 'Container').filter((element) => element.props.accessibilityRole === 'cell')).toHaveLength(5);
    expect(elementsWith(spec, 'Container').filter((element) => element.props.accessibilityRole === 'row')).toHaveLength(1);
    expect(elementsWith(spec, 'Container').some((element) => element.props.accessibilityRole === 'list')).toBe(false);
  });
});
