import { describe, expect, it } from 'vitest';

import { admission } from '@/src/kernel/admission';
import { parsePackage } from '@/src/kernel/schema';
import type { AppPackage } from '@/src/kernel/schema';
import { fixtureActivePackage } from './v3-fixtures';

const basePackage = fixtureActivePackage();

const unsupportedWidget = 'widgetCatalogPlaceholderMissing';
const hash = 'a'.repeat(64);

function pickUnsupportedWidgetPackage(): { pkg: AppPackage; screenId: string; } {
  const pkg = structuredClone(basePackage);
  const screenId = Object.keys(pkg.presentation.ui.screens)[0] ?? 'home';
  const screen = pkg.presentation.ui.screens[screenId]!;
  const next = structuredClone(screen.components);
  const index = next.findIndex((component) => component.kind === 'widget' && typeof component.widget === 'string');

  if (index >= 0) next[index] = { ...next[index], widget: unsupportedWidget };
  else next.push({ id: 'unsupported', kind: 'widget', widget: unsupportedWidget, title: 'Unsupported' });

  pkg.presentation.ui.screens[screenId] = { ...screen, components: next };
  return { pkg, screenId };
}

function evidenceFor(pkg: AppPackage) {
  const all = ['web', 'android', 'ios', 'macos'] as const;
  return {
    schemaVersion: 'utopia.admission-evidence.v2' as const,
    packageId: pkg.id,
    version: pkg.version,
    packageSha256: pkg.contractLock.checksum,
    author: 'author',
    reviewer: 'independent-reviewer',
    artifacts: all.map((entry) => ({
      platform: entry,
      build: { path: `${entry}-app.apk`, sha256: hash },
      runtime: { id: `${entry}-runtime`, path: `${entry}.zip`, sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed', driver: entry === 'web' ? 'playwright' : entry === 'android' ? 'adb' : entry === 'ios' ? 'simctl' : 'macos-ui' },
      screenshot: { path: `${entry}.png`, sha256: hash },
    })),
    oracles: pkg.acceptanceTests.map((id) => ({ id, path: `${id}.json`, sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed' })),
    accessibility: { id: 'accessibility', path: 'accessibility.json', sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed' },
    persistence: { id: 'persistence', path: 'persistence.json', sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed' },
    errorPaths: { id: 'error-paths', path: 'error.json', sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed' },
    nativeCapabilities: (pkg.nativeCapabilities.permissions ?? []).map((permission) => {
      const id = typeof permission === 'string'
        ? permission
        : typeof permission === 'object' && permission && 'id' in permission && typeof permission.id === 'string'
          ? permission.id
          : 'permission';
      return { id, path: `${id}.json`, sha256: hash, checkedAt: '2026-08-04T10:00:00.000Z', status: 'passed' };
    }),
  };
}

describe('widget boundary', () => {
  it('rejects unsupported widget kinds at schema parse', () => {
    const { pkg } = pickUnsupportedWidgetPackage();
    expect(() => parsePackage(pkg)).toThrow(/Unsupported|invalid/i);
  });

  it('rejects unsupported widget kinds during admission', () => {
    const { pkg, screenId } = pickUnsupportedWidgetPackage();
    const result = admission(pkg as AppPackage, evidenceFor(pkg));
    expect(result.admitted).toBe(false);
    expect(result.issues).toContain(`${screenId}: unsupported widget ${unsupportedWidget}`);
  });
});
