import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDeclaredScreenId } from '@/src/presentation/screen-navigation';

const root = path.resolve(process.cwd());

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as Record<string, any>;
}

describe('package screen navigation contract', () => {
  it('fails closed for unknown deep links and preserves a declared default', () => {
    const ui = {
      defaultScreen: 'home',
      screens: { home: {}, history: {} },
    } as any;

    expect(resolveDeclaredScreenId(ui, 'history')).toBe('history');
    expect(resolveDeclaredScreenId(ui, 'not-declared')).toBe('home');
    expect(resolveDeclaredScreenId({ screens: { first: {}, second: {} } } as any, 'missing')).toBe('first');
    expect(resolveDeclaredScreenId(undefined, 'history')).toBeUndefined();
  });

  it('declares every Audio Loop screen as a reachable tab target', () => {
    const pkg = readJson('apps/audio-loop-108/audio-loop-108.v1.json');
    const screens = pkg.presentation.ui.screens;
    const ids = Object.keys(screens);
    for (const id of ids) {
      const targets = screens[id].shell.tabs.map((tab: { screen?: string; id: string }) => tab.screen ?? tab.id);
      expect(targets).toEqual(expect.arrayContaining(ids));
    }
  });

  it('proves Counter exposes count and history through generic shell tabs', () => {
    const pkg = readJson('apps/counter/counter.v1.json');
    const screens = pkg.presentation.ui.screens;
    expect(Object.keys(screens)).toEqual(expect.arrayContaining(['count', 'history']));
    for (const screen of Object.values(screens) as any[]) {
      expect(screen.shell.tabs.map((tab: { screen?: string; id: string }) => tab.screen ?? tab.id))
        .toEqual(expect.arrayContaining(['count', 'history']));
    }
  });
});
