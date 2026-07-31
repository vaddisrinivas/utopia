import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectWidgetCapabilityBoundaryViolations } from '../../scripts/quality/check-core-port-boundaries.mjs';

const root = process.cwd();

describe('widget native capability boundaries', () => {
  it('has no direct Expo capability imports in package widgets', () => {
    const violations = collectWidgetCapabilityBoundaryViolations(root);
    expect(violations.filter((value: string) => value.includes('direct Expo capability import'))).toEqual([]);
  });

  it('requires every native bridge consumer to include the broker', () => {
    const violations = collectWidgetCapabilityBoundaryViolations(root);
    expect(violations.filter((value: string) => value.includes('native bridge consumer has no capability broker call'))).toEqual([]);
  });

  it('keeps the concrete Expo imports confined to the bridge adapter', () => {
    const bridge = readFileSync(resolve(root, 'src/presentation/widget-native-bridges.ts'), 'utf8');
    expect(bridge).toMatch(/import\('expo-audio'\)/);
    expect(bridge).toMatch(/import\('expo-file-system\/legacy'\)/);
    expect(bridge).not.toMatch(/requestWidgetCapability|requireWidgetCapability/);
  });

  it('keeps every native preload behind its broker decision', () => {
    const violations = collectWidgetCapabilityBoundaryViolations(root);
    expect(violations.filter((value: string) => value.includes('must load only after'))).toEqual([]);
  });

  it('forwards the persisted consent port through file capability checks', () => {
    const source = readFileSync(resolve(root, 'src/presentation/widgets/file-widgets.tsx'), 'utf8');
    expect(source).toContain('requestWidgetCapability(\n    runtime,');
  });

  it('rechecks camera capability before requesting camera permission', () => {
    const source = readFileSync(resolve(root, 'src/presentation/json-render-widgets.tsx'), 'utf8');
    expect(source).toContain("kind: 'camera-scanner',\n      action: 'scan'");
    expect(source).toContain('const currentCapability = requestWidgetCapability(runtime,');
  });

  it('checks audio capability before creating the native player', () => {
    const source = readFileSync(resolve(root, 'src/presentation/json-render-widgets.tsx'), 'utf8');
    expect(source).toContain("const playbackCapability = requestWidgetCapability(runtime, { kind: 'audio-file', action: 'choose' });");
    expect(source).toContain('if (!playbackCapability.ok) throw new Error(playbackCapability.error.message);');
  });
});
