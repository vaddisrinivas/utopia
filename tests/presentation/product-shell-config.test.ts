import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRODUCT_SHELL_CONFIG,
  normalizeProductShellConfig,
} from '@/src/presentation/widgets/product-shell-config';

describe('product shell config', () => {
  it('defaults to single composition while preserving legacy layout mode defaults', () => {
    const config = normalizeProductShellConfig(undefined);

    expect(config.layoutMode).toBe('collectionWorkspace');
    expect(config.composition.mode).toBe('single');
    expect(config.composition.ratio).toBeUndefined();
    expect(config.composition.dashboardColumns).toBe(2);
    expect(config.density).toBe('comfortable');
    expect(config.scrollable).toBe(false);
    expect(config.responsive.maxContentWidth).toBe(1280);
    expect(config.responsive.widePadding).toBe(32);
    expect(config.theme.canvas).not.toBe(config.theme.surface);
  });

  it('maps legacy and native composition mode values', () => {
    expect(normalizeProductShellConfig({ layoutMode: 'focusedTool' }).composition.mode).toBe('single');
    expect(normalizeProductShellConfig({ layoutMode: 'dashboardWorkspace' }).composition.mode).toBe('dashboard');
    expect(normalizeProductShellConfig({ layoutMode: 'masterDetail' }).composition.mode).toBe('masterDetail');
    expect(normalizeProductShellConfig({ compositionMode: 'dashboard', composition: { mode: 'single' } }).composition.mode).toBe('dashboard');
  });

  it('normalizes responsive constraints and preserves legacy values', () => {
    const config = normalizeProductShellConfig({
      density: 'spacious',
      responsive: { breakpoint: -1, maxContentWidth: 'bad', narrowPadding: -2, widePadding: 32 },
      layoutMode: 'dashboard',
      dashboardColumns: 5,
      composition: { ratio: 0.2 },
    });

    expect(config.density).toBe('spacious');
    expect(config.responsive).toEqual({ breakpoint: 720, maxContentWidth: 1280, narrowPadding: 16, widePadding: 32 });
    expect(config.layoutMode).toBe('dashboard');
    expect(config.composition.mode).toBe('dashboard');
    expect(config.composition.ratio).toBe(0.22);
    expect(config.composition.dashboardColumns).toBe(3);
  });

  it('supports two unrelated app-style payloads through shared composition contract', () => {
    const expenseListConfig = normalizeProductShellConfig({
      appBarTitle: 'Shared Bills',
      layoutMode: 'masterDetail',
      compositionMode: 'masterDetail',
      bottomActions: [{ id: 'add', label: 'Add Bill', tone: 'primary' }],
      tabs: [{ id: 'due', label: 'Due', icon: 'calendar' }, { id: 'paid', label: 'Paid', icon: 'check' }],
    });

    const habitGridConfig = normalizeProductShellConfig({
      appBarTitle: 'Habit Tracker',
      layoutMode: 'collectionWorkspace',
      compositionMode: 'dashboard',
      dashboardColumns: 3,
      composition: { mode: 'dashboard', dashboardColumns: 3 },
      bottomActions: [{ id: 'streak', label: 'Log Streak', tone: 'secondary' }],
    });

    expect(expenseListConfig.layoutMode).toBe('masterDetail');
    expect(expenseListConfig.composition.mode).toBe('masterDetail');
    expect(expenseListConfig.bottomActions[0].tone).toBe('primary');

    expect(habitGridConfig.layoutMode).toBe('collectionWorkspace');
    expect(habitGridConfig.composition.mode).toBe('dashboard');
    expect(habitGridConfig.composition.dashboardColumns).toBe(3);
  });

  it('deduplicates tabs/actions and keeps active tab only when declared', () => {
    const config = normalizeProductShellConfig({
      activeTab: 'history',
      tabs: [
        { id: 'home', label: 'Home' },
        { id: 'history', label: 'History', icon: '◷' },
        { id: 'history', label: 'Duplicate' },
      ],
      bottomActions: [
        { id: 'save', label: 'Save', tone: 'primary' },
        { id: 'save', label: 'Duplicate' },
      ],
    });

    expect(config.tabs).toHaveLength(2);
    expect(config.activeTab).toBe('history');
    expect(config.bottomActions).toEqual([{ id: 'save', label: 'Save', tone: 'primary' }]);
    expect(normalizeProductShellConfig({ activeTab: 'missing', tabs: [{ id: 'home', label: 'Home' }] }).activeTab).toBe('home');
    expect(DEFAULT_PRODUCT_SHELL_CONFIG.bottomActions).toEqual([]);
  });

  it('normalizes status banners, themes, and action variants without accepting empty strings', () => {
    const config = normalizeProductShellConfig({
      statusBanner: { message: 'Offline', tone: 'warning', dismissible: true },
      theme: { accent: '#123456', ink: '   ' },
      bottomActions: [{ id: 'delete', label: 'Delete', variant: 'danger', event: 'remove' }],
    });

    expect(config.status).toEqual({ message: 'Offline', tone: 'warning', dismissible: true });
    expect(config.theme.accent).toBe('#123456');
    expect(config.theme.ink).toBe(DEFAULT_PRODUCT_SHELL_CONFIG.theme.ink);
    expect(config.bottomActions[0]).toMatchObject({ id: 'delete', tone: 'danger', event: 'remove' });
  });

  it('renders action chrome only from explicit bottomActions', () => {
    expect(normalizeProductShellConfig({
      actions: [{ id: 'manage', label: 'Manage', tone: 'primary' }],
    }).bottomActions).toEqual([]);

    expect(normalizeProductShellConfig({
      bottomActions: [{ id: 'manage', label: 'Manage', tone: 'primary' }],
    }).bottomActions).toEqual([{ id: 'manage', label: 'Manage', tone: 'primary' }]);
  });
});
