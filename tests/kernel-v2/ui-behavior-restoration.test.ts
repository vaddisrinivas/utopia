import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Image: 'Image' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }));
vi.mock('lucide-react-native', () => new Proxy({}, { get: () => 'Icon' }));
vi.mock('tamagui', () => new Proxy({}, { get: (_, key) => key === 'TamaguiProvider' ? 'Provider' : String(key) }));
vi.mock('@json-render/react-native', () => ({ JSONUIProvider: 'Provider', Renderer: 'Renderer' }));
vi.mock('@/src/kernel/asset-widget', () => ({}));
vi.mock('@/src/kernel/automation-record-widget', () => ({}));
vi.mock('@/src/kernel/canvas-record-widget', () => ({}));
vi.mock('@/src/kernel/capabilities', () => ({}));
vi.mock('@/src/kernel/game-record-widget', () => ({}));
vi.mock('@/src/kernel/messaging-widget', () => ({}));
vi.mock('@/src/kernel/media-widgets', () => ({}));
vi.mock('@/src/kernel/route-record-widget', () => ({}));
vi.mock('@/src/kernel/showcase-widgets', () => ({}));
vi.mock('@/src/kernel/services', () => ({}));
vi.mock('@/src/kernel/standard-widgets', () => ({}));
vi.mock('@/src/kernel/store', () => ({}));
vi.mock('@/src/kernel/widget-support', () => ({}));

let deriveTheme: typeof import('@/src/kernel/theme').deriveTheme;
let nextTimerMode: typeof import('@/src/kernel/widgets').nextTimerMode;
let reconcileTimer: typeof import('@/src/kernel/widgets').reconcileTimer;
let bulkRows: typeof import('@/src/kernel/record-widgets').bulkRows;
let matchesPreset: typeof import('@/src/kernel/record-widgets').matchesPreset;
beforeAll(async () => {
  ({ deriveTheme } = await import('@/src/kernel/theme'));
  ({ nextTimerMode, reconcileTimer } = await import('@/src/kernel/widgets'));
  ({ bulkRows, matchesPreset } = await import('@/src/kernel/record-widgets'));
});

describe('compact UI behavior restoration', () => {
  it('derives a readable semantic palette from one accent', () => {
    const theme = deriveTheme({ accent: '#0057B8' });
    expect(theme).toEqual({
      accent: '#0057B8',
      canvas: '#F0F5FB',
      surface: '#F8FBFD',
      ink: '#182019',
      muted: '#737978',
    });
    expect(deriveTheme({ canvas: '#FFFFFF', ink: '#FFFFFF' }).ink).toBe('#182019');
  });

  it('reconciles running timers after restart and completes elapsed timers', () => {
    const running = { mode: 'running' as const, duration: 60, remaining: 60, savedAt: 1_000, deadline: 61_000 };
    expect(reconcileTimer(running, 31_000)).toMatchObject({ mode: 'running', remaining: 30 });
    expect(reconcileTimer(running, 62_000)).toMatchObject({ mode: 'complete', remaining: 0 });
  });

  it('fails clock rollback into review and resumes only by explicit transition', () => {
    const restored = reconcileTimer({ mode: 'running', duration: 60, remaining: 30, savedAt: 20_000 }, 10_000);
    expect(restored.mode).toBe('review');
    expect(nextTimerMode(restored.mode, 'START')).toBe('running');
    expect(nextTimerMode(restored.mode, 'RESET')).toBe('idle');
  });

  it('builds bulk rows and applies exact field presets', () => {
    expect(bulkRows('One\nTwo', 'title', { status: 'open' })).toEqual([{ status: 'open', title: 'One' }, { status: 'open', title: 'Two' }]);
    const record = { id: '1', collection: 'tasks', createdAt: '', updatedAt: '', values: { status: 'Open' } };
    expect(matchesPreset(record, { field: 'status', value: 'open' })).toBe(true);
    expect(matchesPreset(record, { field: 'status', value: 'closed' })).toBe(false);
  });
});
