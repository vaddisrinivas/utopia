#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const smokeDir = join(root, 'app', 'build', 'evidence', 'web-product-smoke');
const outDir = join(root, 'app', 'build', 'evidence', 'visual-state-matrix');
const outPath = join(outDir, 'visual-state-matrix.json');
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

function readJson(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const requiredScreens = [
  'home',
  'food',
  'search',
  'capture',
  'chat',
  'sources',
  'config',
  'settings',
];
const viewports = ['desktop', 'mobile'];
const screenshots = [];
const missing = [];

for (const screen of requiredScreens) {
  for (const viewport of viewports) {
    const relativePath = `app/build/evidence/web-product-smoke/${screen}-${viewport}.png`;
    const absolutePath = join(root, relativePath);
    const present = existsSync(absolutePath);
    screenshots.push({ screen, viewport, path: relativePath, present });
    if (!present) missing.push(relativePath);
  }
}

const webSmoke = readJson('app/build/evidence/web-product-smoke/web-product-smoke.json');
const accessibility = readJson('app/build/evidence/accessibility/accessibility-smoke.json');
const webSmokePassed = webSmoke?.pass === true;
const accessibilityPassed = accessibility?.pass === true;
const nativeScreenshots = [
  'app/build/evidence/emulatorx-healthconnect-script.png',
  'app/build/evidence/emulatorx-healthconnect-roundtrip.png',
  'app/build/evidence/s23u-expo-native.png',
].filter((relativePath) => existsSync(join(root, relativePath)));

const passed = missing.length === 0 && webSmokePassed && accessibilityPassed;
const payload = {
  proof: 'utopia_visual_state_matrix',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  status: passed ? 'passed' : 'failed',
  scope: 'web_visual_matrix_plus_accessibility_smoke',
  required_screens: requiredScreens,
  viewports,
  screenshots,
  screenshot_count: screenshots.filter((item) => item.present).length,
  missing,
  web_smoke_passed: webSmokePassed,
  accessibility_passed: accessibilityPassed,
  native_visual_evidence_available: nativeScreenshots,
  remaining_for_final_visual_polish: [
    'native full-state visual matrix',
    'tablet/foldable responsive review',
    'manual product-grade UI review against Utopia aesthetic bar',
  ],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`Visual state matrix: ${passed ? 'PASS' : 'FAIL'} (${payload.screenshot_count}/${screenshots.length} screenshots; evidence: ${outPath})`);

if (!passed) {
  process.exit(1);
}
