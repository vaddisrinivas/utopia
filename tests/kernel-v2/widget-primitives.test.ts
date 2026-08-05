import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Image: 'Image',
  Linking: { openURL: vi.fn() },
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }));
vi.mock('lucide-react-native', () => new Proxy({}, { get: () => 'Icon' }));
vi.mock('tamagui', () => new Proxy({}, { get: (_, key) => String(key) }));
vi.mock('@/src/kernel/chart-visualization', () => ({ ChartVisualization: 'ChartVisualization' }));

import { normalizeWidgetKind, supportsWidget, widgetAliases } from '@/src/kernel/widget-support';

let resolveWidgetAction: typeof import('@/src/kernel/standard-widgets').resolveWidgetAction;
let executeWidgetAction: typeof import('@/src/kernel/standard-widgets').executeWidgetAction;
let standardWidgets: Set<string>;
let openURL: typeof import('react-native').Linking.openURL;

beforeAll(async () => {
  ({ resolveWidgetAction, executeWidgetAction, standardWidgets } = await import('@/src/kernel/standard-widgets'));
  ({ Linking: { openURL } } = await import('react-native'));
});

describe('widget primitive aliases', () => {
  it.each([
    ['quickNav', 'navigationPanel'],
    ['navMenu', 'navigationPanel'],
    ['quickOverlay', 'actionOverlay'],
    ['statusRail', 'statusDisplay'],
    ['metricPanel', 'metricDisplay'],
  ])('maps %s to %s', (alias, canonical) => {
    expect(normalizeWidgetKind(alias)).toBe(canonical);
    expect(supportsWidget(alias)).toBe(true);
  });

  it('supports reusable primitive kinds', () => {
    for (const key of ['navigationPanel', 'actionOverlay', 'statusDisplay', 'metricDisplay']) {
      expect(supportsWidget(key)).toBe(true);
      expect(standardWidgets.has(key)).toBe(true);
    }
  });

  it('normalizes aliases without schema changes', () => {
    for (const alias of Object.keys(widgetAliases)) {
      expect(supportsWidget(alias)).toBe(true);
    }
  });
});

describe('widget action bindings', () => {
  it('uses row route over component action', () => {
    const component = { kind: 'widget', widget: 'menuStrip', action: { kind: 'navigate', target: '/component' } } as const;
    expect(resolveWidgetAction({ route: '/row', action: { kind: 'open_url', url: 'https://ignore' } }, component)).toEqual({
      target: '/row',
      url: 'https://ignore',
      disabled: false,
    });
    expect(resolveWidgetAction({ action: { kind: 'navigate', target: '/row-action' } }, component)).toEqual({
      target: '/row-action',
      url: '',
      disabled: false,
    });
    expect(resolveWidgetAction({ action: { operation: 'navigate', target: '/legacy-row-action' } }, { kind: 'widget', widget: 'menuStrip' } as const)).toEqual({
      target: '/legacy-row-action',
      url: '',
      disabled: false,
    });
  });

  it('calls navigate for route action', () => {
    const nav = vi.fn();
    expect(executeWidgetAction({ route: '/alpha' }, { kind: 'widget', widget: 'navigationPanel' } as const, nav)).toBe(true);
    expect(nav).toHaveBeenCalledWith('/alpha');
  });

  it('calls openURL for external action', () => {
    const nav = vi.fn();
    expect(executeWidgetAction({ action: { kind: 'open_url', url: 'https://example.com' } }, { kind: 'widget', widget: 'actionOverlay' } as const, nav)).toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://example.com');
  });
});
