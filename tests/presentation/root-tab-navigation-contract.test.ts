import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootLayout = readFileSync('app/_layout.tsx', 'utf8');
const tabLayout = readFileSync('app/(tabs)/_layout.tsx', 'utf8');
const todayRoute = readFileSync('app/(tabs)/index.tsx', 'utf8');

describe('root tab navigation contract', () => {
  it('renders App Library directly without redirecting during a tab transition', () => {
    expect(rootLayout).toContain("initialRouteName: 'install'");
    expect(todayRoute).toContain("export { default } from '../install'");
    expect(todayRoute).not.toContain('router.replace');
  });

  it('keeps the global bar separate from standalone products', () => {
    expect(tabLayout).toContain("animation: 'none'");
    expect(tabLayout).toContain("label: 'Library'");
    expect(tabLayout).toMatch(/name="food"[\s\S]*?href: null/);
  });
});
