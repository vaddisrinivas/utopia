import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPhysicalDeviceReleaseEvidence } from '../../scripts/quality/physical-device-release-evidence.mjs';

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'utopia-physical-proof-'));
}

function writeArtifact(root: string, name: string, value: string | Buffer) {
  const artifactDir = path.join(root, 'app/build/evidence/physical-device-release');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, name), value);
}

describe('physical device release evidence', () => {
  it('passes only when install, launch, and app UI flow are all proven', () => {
    const root = tempRoot();
    writeArtifact(root, 'package.txt', 'Package [app.utopia]');
    writeArtifact(root, 'launch-main.txt', 'Status: ok');
    writeArtifact(root, 'launch-install.txt', '');
    writeArtifact(root, 'window.xml', '<node text="Install an app" />');
    writeArtifact(root, 'install-screen.png', Buffer.from('proof-screen'));

    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      installStatus: 0,
      device: {
        manufacturer: 'samsung',
        model: 'SM-S918U1',
        sdk: '36',
        buildFingerprintSha256: 'abc123',
      },
      checkedAt: '2026-07-28T00:00:00.000Z',
    });

    expect(evidence.status).toBe('passed');
    expect(evidence.app).toEqual(expect.objectContaining({
      installed: true,
      launch_verified: true,
      basic_flow_verified: true,
      package_name: 'app.utopia',
    }));
    expect(evidence.artifacts.screenshot_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('blocks when launch works but the expected UI cannot be proven', () => {
    const root = tempRoot();
    writeArtifact(root, 'package.txt', 'Package [app.utopia]');
    writeArtifact(root, 'launch-main.txt', 'Status: ok');
    writeArtifact(root, 'launch-install.txt', '');
    writeArtifact(root, 'window.xml', '<node text="Different screen" />');

    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });

    expect(evidence.status).toBe('blocked');
    expect(evidence.app).toEqual(expect.objectContaining({
      installed: true,
      launch_verified: true,
      basic_flow_verified: false,
    }));
  });

  it('never writes adb serials into the evidence payload', () => {
    const root = tempRoot();
    writeArtifact(root, 'package.txt', 'Package [app.utopia]');
    writeArtifact(root, 'launch-main.txt', 'Status: ok');
    writeArtifact(root, 'launch-install.txt', '');
    writeArtifact(root, 'window.xml', '<node text="Registry" />');
    writeArtifact(root, 'adb-devices.txt', 'List of devices attached\n<redacted-device> device\n');

    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });
    const serialized = JSON.stringify(evidence);

    expect(evidence.no_device_serial_written).toBe(true);
    expect(serialized).not.toContain('R5CT');
    expect(serialized).not.toContain('"device_serial":');
  });
});
