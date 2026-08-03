import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRODUCT_SHELL_SUPPORTED_ICON_IDS } from '../../src/presentation/widgets/product-shell-icon-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'src/presentation/widgets/product-shell-widget.tsx'), 'utf8');

describe('ProductShellWidget source contract', () => {
  it('delegates shell and composition config to the shared normalizer', () => {
    expect(source).toContain('export function ProductShellWidget');
    expect(source).toContain('normalizeProductShellConfig(element.props)');
    expect(source).toContain('resolvePanes');
    expect(source).toContain('composition');
  });

  it('keeps actions, back, header, tabs, and status semantics accessible', () => {
    expect(source).toContain('accessibilityRole="header"');
    expect(source).toMatch(/tab:\s*\{[\s\S]*?minHeight:\s*44/);
    expect(source).toMatch(/tabCompact:\s*\{[\s\S]*?minHeight:\s*44/);
    expect(source).toMatch(/tab:\s*\{[\s\S]*?minWidth:\s*44/);
    expect(source).toMatch(/tabCompact:\s*\{[\s\S]*?minWidth:\s*44/);
    expect(source).toContain('accessibilityRole="tablist"');
    expect(source).toContain('accessibilityRole="tab"');
    expect(source).toContain('<Pressable');
    expect(source).toContain('horizontal');
    expect(source).toContain('showsHorizontalScrollIndicator={false}');
    expect(source).toContain('styles.tabIndicator');
    expect(source).not.toContain('<Button');
    expect(source).not.toContain('styles.nativeTab');
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('accessibilityLabel="Go back"');
    expect(source).toContain('accessibilityState={{ disabled: action.disabled }}');
    expect(source).toContain('emit(`tab:${tab.id}`)');
    expect(source).toContain('router.push(route as never)');
    expect(source).toContain('router.setParams({ screen: targetScreen })');
    expect(source).toContain('const route = tabRoutes[tab.id]');
    expect(source).toContain('emit(event)');
  });

  it('supports desktop composition modes and narrow collapse behavior', () => {
    expect(source).toContain('config.composition.mode');
    expect(source).toContain('masterDetail');
    expect(source).toContain('shape.mode === \'masterDetail\'');
    expect(source).toContain('shape.dashboardColumns');
    expect(source).toContain('Children.toArray(children)');
    expect(source).toContain('resolvePanes');
    expect(source).toContain('Screen composition');
    expect(source).toContain('Master list');
    expect(source).toContain('Primary dashboard');
    expect(source).toContain('!isWide');
  });

  it('renders known package icon identifiers without exposing raw icon text', () => {
    expect(source).toContain("from 'expo-symbols'");
    expect(source).toContain('PRODUCT_SHELL_ICON_SYMBOLS');
    expect(source).toContain("'book-open': { ios: 'book', android: 'menu_book', web: 'menu_book' }");
    expect(source).toContain("briefcase: { ios: 'briefcase', android: 'work', web: 'work' }");
    expect(source).toContain("plus: { ios: 'plus', android: 'add', web: 'add' }");
    expect(source).toContain("play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }");
    expect(source).toContain("'rotate-ccw': { ios: 'arrow.counterclockwise', android: 'restart_alt', web: 'restart_alt' }");
    expect(source).toContain('<ProductShellIcon');
    expect(source).not.toContain('>{tab.icon}</Text>');
    expect(source).not.toContain('>{action.icon}</Text>');
  });

  it('keeps the supported-icon policy aligned with the renderer map', () => {
    const mapBody = source.match(/const PRODUCT_SHELL_ICON_SYMBOLS:[^{]+{([\s\S]*?)\n};/)?.[1] ?? '';
    const rendererIconIds = [...mapBody.matchAll(/^\s*(?:'([^']+)'|([a-z0-9-]+)):/gm)]
      .map((match) => match[1] ?? match[2])
      .sort();
    expect([...PRODUCT_SHELL_SUPPORTED_ICON_IDS].sort()).toEqual(rendererIconIds);
  });

  it('treats icons as decorative and unknown icons as blank fallback', () => {
    expect(source).toContain('if (!symbol) return null;');
    expect(source).toContain('accessible={false}');
    expect(source).toContain('accessibilityElementsHidden');
    expect(source).toContain('importantForAccessibility="no"');
    expect(source).toContain('fallback={<View style={{ height: size, width: size }} />}');
  });

  it('keeps shell layout deterministic and keeps direct native access out', () => {
    expect(source).toContain("from 'react-native-safe-area-context'");
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('responsive.breakpoint');
    expect(source).toContain('styles.paneGrid');
    expect(source).toContain('Math.min(config.responsive.maxContentWidth, 960)');
    expect(source).toContain('metrics.appBarHeight + insets.top');
    expect(source).toContain('metrics.appBarPadding + insets.top');
    expect(source).not.toContain('Linking');
    expect(source).not.toContain('requireNative');
  });
});
