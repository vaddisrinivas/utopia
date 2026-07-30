import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';

const scriptPath = join(process.cwd(), 'scripts/quality/check-multi-surface-sync-proof.mjs');

type TempRoot = string;
const tempRoots: TempRoot[] = [];
const macosFixtures: string[] = [];
const adbRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const fixture of macosFixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  for (const adbRoot of adbRoots.splice(0)) rmSync(adbRoot, { recursive: true, force: true });
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-multi-surface-proof-'));
  tempRoots.push(root);
  return root;
}

function normalizedGitEnvelope() {
  const git = currentGit(process.cwd());
  return {
    ...git,
    branch: git.branch || 'detached-head',
    tree_hash: git.tree,
    dirty_diff_hash: git.dirtyDiffHash,
  };
}

function writeReceipt(path: string, receipt: Record<string, unknown>) {
  writeFileSync(path, JSON.stringify({
    checked_at: new Date().toISOString(),
    git: normalizedGitEnvelope(),
    ...receipt,
  }));
}

function makeFakeAdb(root: string, devices: string[]) {
  const script = join(root, 'adb');
  const deviceLines = devices.join('\n');
  mkdirSync(root, { recursive: true });
  writeFileSync(script, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    'if (args[0] === "version") {',
    '  console.log("Android Debug Bridge version 1.0.41");',
    '  process.exit(0);',
    '}',
    'if (args[0] === "start-server") {',
    '  process.exit(0);',
    '}',
    'if (args[0] === "devices") {',
    '  console.log("List of devices attached");',
    `  console.log(${JSON.stringify(deviceLines)});`,
    '  process.exit(0);',
    '}',
    'process.exit(1);',
  ].join('\n'));
  chmodSync(script, 0o755);
  adbRoots.push(root);
  return root;
}

function createMacosBundle(fixtureName: string) {
  const bundle = join(process.cwd(), 'macos/macos/build/Build/Products', fixtureName, 'Utopia.app');
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, 'Info.plist'), '<plist><dict></dict></plist>');
  macosFixtures.push(bundle);
  return bundle;
}

function runScript(overrides: {
  avdIds: string;
  webReceipt: string;
  macosReceipt: string;
  proofPath: string;
  adbRoot: string;
}) {
  const env = {
    ...process.env,
    PATH: `${overrides.adbRoot}${delimiter}${process.env.PATH}`,
    UTOPIA_EMULATOR_SYNC_AVD_IDS: overrides.avdIds,
    UTOPIA_WEB_SYNC_RECEIPT_PATH: overrides.webReceipt,
    UTOPIA_MACOS_SYNC_RECEIPT_PATH: overrides.macosReceipt,
    UTOPIA_MULTI_SURFACE_SYNC_PROOF_PATH: overrides.proofPath,
  };

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });

  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const evidence = JSON.parse(readFileSync(overrides.proofPath, 'utf8')) as {
    proof: string;
    status: 'PASS' | 'BLOCKED';
    blockers: string[];
    surfaces: Record<string, unknown>;
    status_reason: string;
  };

  return {
    status: result.status ?? 1,
    output,
    evidence,
  };
}

describe('multi-surface sync proof validation', () => {
  it('passes with two emulator ids plus matching web/macos receipts and bundle artifact', () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-sync-proof.json');
    const webReceiptPath = join(temp, 'web-product-smoke.json');
    const macosReceiptPath = join(temp, 'macos-build-receipt.json');
    const adbRoot = join(temp, 'bin');

    writeReceipt(webReceiptPath, {
      proof: 'utopia_web_product_smoke',
      status: 'passed',
      pass: true,
    });
    writeReceipt(macosReceiptPath, {
      proof: 'utopia_macos_build_receipt',
      status: 'passed',
      pass: true,
    });

    const macosBundle = createMacosBundle('PASS-ARTIFACT');
    expect(macosBundle.endsWith('PASS-ARTIFACT/Utopia.app')).toBe(true);

    makeFakeAdb(adbRoot, [
      'emulator-5554 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:1',
      'emulator-5556 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:2',
    ]);

    const result = runScript({
      avdIds: 'emulator-5554,emulator-5556',
      webReceipt: webReceiptPath,
      macosReceipt: macosReceiptPath,
      proofPath,
      adbRoot,
    });

    expect(result.status).toBe(0);
    expect(result.evidence.status).toBe('PASS');
    expect(result.evidence.blockers).toEqual([]);
    expect(result.evidence.status_reason).toContain('no emulator app-execution receipts claimed');
    expect(result.evidence.surfaces).toMatchObject({
      emulators: {
        requested_avd_ids: ['emulator-5554', 'emulator-5556'],
        available_avd_ids: ['emulator-5554', 'emulator-5556'],
      },
    });
  });

  it('blocks when emulator count or surface receipts are invalid', () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-sync-proof.json');
    const webReceiptPath = join(temp, 'web-product-smoke.json');
    const macosReceiptPath = join(temp, 'macos-build-receipt.json');
    const adbRoot = join(temp, 'bin');

    writeReceipt(webReceiptPath, {
      proof: 'utopia_web_product_smoke',
      status: 'failed',
      pass: false,
    });
    writeReceipt(macosReceiptPath, {
      proof: 'utopia_macos_build_receipt_typo',
      status: 'passed',
      pass: true,
    });

    makeFakeAdb(adbRoot, [
      'emulator-5554 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:1',
    ]);

    const result = runScript({
      avdIds: 'emulator-5554,emulator-5556',
      webReceipt: webReceiptPath,
      macosReceipt: macosReceiptPath,
      proofPath,
      adbRoot,
    });

    expect(result.status).toBe(1);
    expect(result.evidence.status).toBe('BLOCKED');
    expect(result.evidence.blockers).toContain('insufficient_emulator_surfaces:2');
    expect(result.evidence.blockers).toContain('receipt_not_passed:web');
    expect(result.evidence.blockers).toContain('proof_mismatch:macos_receipt:utopia_macos_build_receipt_typo');
    expect(result.evidence.blockers).toContain('missing_macos_build_artifact');
    expect(result.evidence.status_reason).toContain('blocked:');
    expect(result.output).toContain('BLOCKER=');
  });

  it('blocks on malformed receipts and reports parser issues', () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-sync-proof.json');
    const webReceiptPath = join(temp, 'web-product-smoke.json');
    const macosReceiptPath = join(temp, 'macos-build-receipt.json');
    const adbRoot = join(temp, 'bin');

    writeFileSync(webReceiptPath, '{this is not json');
    writeReceipt(macosReceiptPath, {
      proof: 'utopia_macos_build_receipt',
      status: 'passed',
      pass: true,
    });
    createMacosBundle('BLOCKED-ARTIFACT');

    makeFakeAdb(adbRoot, [
      'emulator-5554 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:1',
      'emulator-5556 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:2',
    ]);

    const result = runScript({
      avdIds: 'emulator-5554,emulator-5556',
      webReceipt: webReceiptPath,
      macosReceipt: macosReceiptPath,
      proofPath,
      adbRoot,
    });

    expect(result.status).toBe(1);
    expect(result.evidence.status).toBe('BLOCKED');
    expect(result.evidence.blockers.some((blocker) => blocker.startsWith('invalid:web_receipt'))).toBe(true);
  });
});
