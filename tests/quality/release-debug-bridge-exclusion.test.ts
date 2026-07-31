import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('release debug bridge exclusion', () => {
  it('runs the release artifact marker gate after exports', () => {
    const gate = readFileSync(resolve(process.cwd(), 'scripts/gates/release-proof-exports.sh'), 'utf8');
    expect(gate).toContain('node scripts/quality/check-release-debug-bridge-exclusion.mjs');
    expect(gate).toContain('UTOPIA_RELEASE_BUNDLE=1 npm run export:web');
    expect(gate).toContain('UTOPIA_RELEASE_BUNDLE=1 npm run export:android');
  });

  it('uses a release-only resolver alias for the bridge entrypoint', () => {
    const metro = readFileSync(resolve(process.cwd(), 'metro.config.js'), 'utf8');
    expect(metro).toContain('UTOPIA_RELEASE_BUNDLE');
    expect(metro).toContain('ReleaseNoopGoldenLoopBridge.tsx');
    expect(metro).toContain('DevelopmentGoldenLoopBridge');
  });

  it('fails closed when a release artifact root is missing', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/quality/check-release-debug-bridge-exclusion.mjs'), 'utf8');
    expect(script).toContain("console.error('Release debug bridge exclusion: BLOCKED')");
    expect(script).toContain('missing release artifact root');
    expect(script).toContain('forbidden debug marker');
  });
});
