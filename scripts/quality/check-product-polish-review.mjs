#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentGit, readEvidence, validateEvidenceEnvelope } from './evidence-provenance.mjs';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence', 'product-polish');
const outPath = join(evidenceDir, 'product-polish-review.json');
mkdirSync(evidenceDir, { recursive: true });

function readJson(relativePath) {
  return readEvidence(root, relativePath);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const webProduct = readJson('app/build/evidence/web-product-smoke/web-product-smoke.json');
const accessibility = readJson('app/build/evidence/accessibility/accessibility-smoke.json');
const visualMatrix = readJson('app/build/evidence/visual-state-matrix/visual-state-matrix.json');
const nativeMatrix = readJson('app/build/evidence/native-visual-matrix/native-visual-matrix.json');
const responsiveMatrix = readJson('app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json');
const performance = readJson('app/build/evidence/performance/performance-budget.json');
const current = currentGit(root);
const evidencePaths = {
  web_product: 'app/build/evidence/web-product-smoke/web-product-smoke.json',
  accessibility: 'app/build/evidence/accessibility/accessibility-smoke.json',
  visual_matrix: 'app/build/evidence/visual-state-matrix/visual-state-matrix.json',
  native_matrix: 'app/build/evidence/native-visual-matrix/native-visual-matrix.json',
  responsive_matrix: 'app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json',
  performance: 'app/build/evidence/performance/performance-budget.json',
};
const provenance = Object.fromEntries(Object.entries(evidencePaths).map(([key, path]) => [key, validateEvidenceEnvelope(root, path, readJson(path), current)]));
const valid = (key) => provenance[key]?.valid === true;

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

const screenshotResults = webProduct?.results ?? [];
const missingScreens = requiredScreens.filter((screen) => {
  return !screenshotResults.some((result) => result.name === `${screen}-desktop`)
    || !screenshotResults.some((result) => result.name === `${screen}-mobile`);
});

const totals = accessibility?.totals ?? {};
const touchWarnings = totals.touchTargetWarnings ?? 0;
const severeTouchFailures = totals.severeTouchTargetFailures ?? 0;
const unlabeledInteractive = totals.unlabeledInteractive ?? 0;
const unlabeledTextboxes = totals.unlabeledTextboxes ?? 0;

const checks = {
  web_smoke_passed: valid('web_product') && webProduct?.pass === true,
  accessibility_smoke_passed: valid('accessibility') && accessibility?.pass === true,
  visual_matrix_passed: valid('visual_matrix') && visualMatrix?.status === 'passed',
  native_matrix_passed: valid('native_matrix') && nativeMatrix?.status === 'passed',
  responsive_matrix_passed: valid('responsive_matrix') && responsiveMatrix?.status === 'passed',
  performance_budget_passed: valid('performance') && performance?.status === 'passed',
  all_core_screens_captured_desktop_and_mobile: missingScreens.length === 0,
  no_unlabeled_interactive_controls: unlabeledInteractive === 0,
  no_unlabeled_textboxes: unlabeledTextboxes === 0,
  no_severe_touch_target_failures: severeTouchFailures === 0,
  no_touch_target_warnings: touchWarnings === 0,
};

const issues = [];
if (!checks.web_smoke_passed) issues.push('web_product_smoke_failed');
if (!checks.accessibility_smoke_passed) issues.push('accessibility_smoke_failed');
if (!checks.visual_matrix_passed) issues.push('web_visual_matrix_failed');
if (!checks.native_matrix_passed) issues.push('native_visual_matrix_failed');
if (!checks.responsive_matrix_passed) issues.push('responsive_visual_matrix_failed');
if (!checks.performance_budget_passed) issues.push('performance_budget_failed');
if (!checks.all_core_screens_captured_desktop_and_mobile) issues.push(`missing_core_screen_screenshots:${missingScreens.join(',')}`);
if (!checks.no_unlabeled_interactive_controls) issues.push(`unlabeled_interactive_controls:${unlabeledInteractive}`);
if (!checks.no_unlabeled_textboxes) issues.push(`unlabeled_textboxes:${unlabeledTextboxes}`);
if (!checks.no_severe_touch_target_failures) issues.push(`severe_touch_target_failures:${severeTouchFailures}`);
if (!checks.no_touch_target_warnings) issues.push(`recommended_touch_target_warnings:${touchWarnings}`);
for (const [key, result] of Object.entries(provenance)) {
  if (!result.valid) issues.push(`evidence_provenance:${key}:${result.issues.join('|')}`);
}

const productVerdict = issues.length === 0 ? 'approved' : 'needs_work';
const payload = {
  proof: 'utopia_product_polish_review',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  product_verdict: productVerdict,
  status: productVerdict === 'approved' ? 'passed' : 'partial',
  checks,
  issues,
  review_notes: [
    'This gate is intentionally stricter than smoke tests.',
    'Smoke tests prove routes render. This review blocks final polish while accessibility warnings or missing visual coverage remain.',
    'It does not mark subjective aesthetics complete without measurable screen, accessibility, responsive, native and performance evidence.',
  ],
  evidence: {
    web_product: 'app/build/evidence/web-product-smoke/web-product-smoke.json',
    accessibility: 'app/build/evidence/accessibility/accessibility-smoke.json',
    visual_matrix: 'app/build/evidence/visual-state-matrix/visual-state-matrix.json',
    native_visual_matrix: 'app/build/evidence/native-visual-matrix/native-visual-matrix.json',
    responsive_visual_matrix: 'app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json',
    performance_budget: 'app/build/evidence/performance/performance-budget.json',
  },
  no_secret_values_written: true,
  evidence_provenance: provenance,
};

writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`Product polish review: ${productVerdict.toUpperCase()} (${issues.join(', ') || 'none'}; evidence: ${outPath})`);

if (process.env.REQUIRE_PRODUCT_POLISH === '1' && productVerdict !== 'approved') {
  process.exit(1);
}
