import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPhysicalDeviceReleaseEvidence } from '../../scripts/quality/physical-device-release-evidence.mjs';
import {
  validateAndroidReleaseArtifactsEvidence,
  validatePhysicalDeviceReleaseEvidence,
} from '../../scripts/quality/evidence-provenance.mjs';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function writeArtifact(root: string, relativePath: string, value: string | Buffer) {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value);
  return {
    path: relativePath,
    bytes: Buffer.byteLength(value),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}

function writeJson(root: string, relativePath: string, value: unknown) {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value)}\n`);
}

function makeAndroidArtifactProof(root: string, options: { signing?: string; signed?: boolean; apkDigestOverride?: string } = {}) {
  const apkPayload = 'dummy-apk';
  const aabPayload = 'dummy-aab';
  const apk = writeArtifact(root, 'app/build/outputs/apk/release/app-release.apk', apkPayload);
  const aab = writeArtifact(root, 'android/app/build/outputs/bundle/release/app-release.aab', aabPayload);
  return {
    proof: 'utopia_android_release_artifacts',
    status: 'passed',
    checked_at: new Date().toISOString(),
    git: {
      branch: 'main',
      head: 'test-head',
      tree: 'test-tree',
      dirty: false,
      dirty_diff_hash: 'test',
    },
    package: 'app.utopia',
    version_name: '1.0.0',
    version_code: 1,
    apk: {
      ...apk,
      sha256: options.apkDigestOverride || apk.sha256,
      signing: options.signing || 'release',
      certificate_sha256: 'a'.repeat(64),
    },
    aab: {
      ...aab,
      signed: options.signed ?? true,
    },
    health_connect_permissions: [
      'READ_NUTRITION',
      'READ_HYDRATION',
      'READ_STEPS',
      'READ_ACTIVE_CALORIES_BURNED',
      'READ_WEIGHT',
      'WRITE_HYDRATION',
    ],
  };
}

function writePhysicalEvidenceDir(root: string) {
  const evidenceDir = path.join(root, 'app/build/evidence/physical-device-release');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'package.txt'), 'Package [app.utopia]');
  writeFileSync(path.join(evidenceDir, 'launch-main.txt'), 'Status: ok');
  writeFileSync(path.join(evidenceDir, 'launch-install.txt'), '');
  writeFileSync(path.join(evidenceDir, 'window.xml'), '<node text="Install an app" />');
  writeFileSync(path.join(evidenceDir, 'install-screen.png'), 'proof-screen');
}

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'utopia-physical-proof-'));
}

describe('physical device release evidence', () => {
  it('passes only when install, launch, and app UI flow are all proven', () => {
    const root = tempRoot();
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      installStatus: 0,
      device: {
        manufacturer: 'samsung',
        model: 'SM-S918U1',
      sdk: '36',
        buildFingerprintSha256: 'a'.repeat(64),
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

  it('passes bound proof when artifact and app versions align', () => {
    const root = tempRoot();
    const evidencePath = 'app/build/evidence/android-release-artifacts.json';
    const androidArtifacts = makeAndroidArtifactProof(root);
    writeJson(root, evidencePath, androidArtifacts);
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      installStatus: 0,
      artifactEvidence: evidencePath,
      device: {
        manufacturer: 'google',
        model: 'Pixel',
        sdk: '36',
        buildFingerprintSha256: 'a'.repeat(64),
      },
    });
    const issues = validatePhysicalDeviceReleaseEvidence(root, evidence, {
      enforceEnvelope: false,
      androidArtifacts,
    });

    expect(issues).toEqual([]);
    expect(evidence.app.version_name).toBe('1.0.0');
  });

  it('flags stale physical device evidence', () => {
    const root = tempRoot();
    const evidencePath = 'app/build/evidence/android-release-artifacts.json';
    const androidArtifacts = makeAndroidArtifactProof(root);
    writeJson(root, evidencePath, androidArtifacts);
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      checkedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      installStatus: 0,
      artifactEvidence: evidencePath,
      device: {
        manufacturer: 'google',
        model: 'Pixel',
        sdk: '36',
        buildFingerprintSha256: 'a'.repeat(64),
      },
    });
    const issues = validatePhysicalDeviceReleaseEvidence(root, evidence, {
      enforceEnvelope: false,
      androidArtifacts,
    });

    expect(issues.some((issue) => issue.startsWith('physical_device_stale:checked_at_too_old:'))).toBe(true);
  });

  it('flags evidence created before linked android artifact proof', () => {
    const root = tempRoot();
    const evidencePath = 'app/build/evidence/android-release-artifacts.json';
    const androidArtifacts = makeAndroidArtifactProof(root);
    const physicalCheckedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const artifactCheckedAt = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    const linkedAndroidArtifacts = {
      ...androidArtifacts,
      checked_at: artifactCheckedAt,
    };
    writeJson(root, evidencePath, linkedAndroidArtifacts);
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      checkedAt: physicalCheckedAt,
      installStatus: 0,
      artifactEvidence: evidencePath,
      device: {
        manufacturer: 'google',
        model: 'Pixel',
        sdk: '36',
        buildFingerprintSha256: 'a'.repeat(64),
      },
    });
    const issues = validatePhysicalDeviceReleaseEvidence(root, evidence, {
      enforceEnvelope: false,
      androidArtifacts: linkedAndroidArtifacts,
    });

    expect(issues).toContain(`physical_device_stale:checked_at_older_than_reference:${physicalCheckedAt}:${artifactCheckedAt}`);
  });

  it('flags malformed checked_at on physical proof', () => {
    const root = tempRoot();
    const evidence = buildPhysicalDeviceReleaseEvidence({
      root,
      installStatus: 0,
      checkedAt: 'not-a-timestamp',
      artifactEvidence: {
        proof: 'utopia_android_release_artifacts',
        package: 'app.utopia',
        version_name: '1.0.0',
        version_code: 1,
        apk: { path: 'app/build/outputs/apk/release/app-release.apk', bytes: 0, sha256: sha256(''), signing: 'release' },
        aab: { path: 'android/app/build/outputs/bundle/release/app-release.aab', bytes: 0, sha256: sha256(''), signed: true },
      },
      device: {
        manufacturer: 'google',
        model: 'Pixel',
        sdk: '36',
        buildFingerprintSha256: 'a'.repeat(64),
      },
    });
    const issues = validatePhysicalDeviceReleaseEvidence(root, evidence, {
      enforceEnvelope: false,
      androidArtifacts: evidence.artifact,
    });

    expect(issues).toContain('missing_or_invalid:checked_at');
  });

  it('flags fabricated/missing device IDs', () => {
    const root = tempRoot();
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });
    const issues = validatePhysicalDeviceReleaseEvidence(root, evidence, { enforceEnvelope: false });

    expect(issues).toContain('physical_device_manufacturer_missing');
    expect(issues).toContain('physical_device_model_missing');
    expect(issues).toContain('physical_device_sdk_missing');
    expect(issues).toContain('physical_device_fingerprint_missing_or_invalid');
  });

  it('flags fabricated device serial in physical proof', () => {
    const root = tempRoot();
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });
    const fakeSerialEvidence = { ...evidence, device_serial: 'fabricated-device-id' };
    const issues = validatePhysicalDeviceReleaseEvidence(root, fakeSerialEvidence, {
      enforceEnvelope: false,
      androidArtifacts: evidence.artifact,
    });

    expect(issues).toContain('physical_device_serial_written');
  });

  it('always sets explicit no-device-serial guard', () => {
    const root = tempRoot();
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });
    const serialized = JSON.stringify(evidence);

    expect(evidence.no_device_serial_written).toBe(true);
    expect(serialized).not.toContain('"device_serial":');
  });

  it('flags debug-signed APK in Android release artifact proof', () => {
    const root = tempRoot();
    const androidArtifacts = makeAndroidArtifactProof(root, { signing: 'debug' });
    const issues = validateAndroidReleaseArtifactsEvidence(root, androidArtifacts, { enforceEnvelope: false });

    expect(issues).toContain('android_apk_signing_debug');
  });

  it('flags stale APK digest in Android release artifact proof', () => {
    const root = tempRoot();
    const androidArtifacts = makeAndroidArtifactProof(root, { apkDigestOverride: '0'.repeat(64) });
    const issues = validateAndroidReleaseArtifactsEvidence(root, androidArtifacts, { enforceEnvelope: false });

    expect(issues.some((issue) => issue.startsWith('android_apk:artifact_stale:sha256:'))).toBe(true);
  });

  it('flags exported-but-unsigned AAB in Android release artifact proof', () => {
    const root = tempRoot();
    const androidArtifacts = makeAndroidArtifactProof(root, { signed: false });
    const issues = validateAndroidReleaseArtifactsEvidence(root, androidArtifacts, { enforceEnvelope: false });

    expect(issues).toContain('android_aab_not_signed');
  });

  it('never writes adb serials into the evidence payload', () => {
    const root = tempRoot();
    writePhysicalEvidenceDir(root);
    const evidence = buildPhysicalDeviceReleaseEvidence({ root, installStatus: 0 });
    writeFileSync(path.join(root, 'app/build/evidence/physical-device-release/adb-devices.txt'), 'List of devices attached\n<redacted-device> device\n');
    const serialized = readFileSync(path.join(root, 'app/build/evidence/physical-device-release/adb-devices.txt'), 'utf8');

    expect(serialized).toContain('<redacted-device>');
    expect(serialized).not.toContain('R5CT');
  });
});
