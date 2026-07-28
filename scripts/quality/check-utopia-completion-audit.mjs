#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { currentGit, readEvidence, validateEvidenceEnvelope } from './evidence-provenance.mjs';
import { getDebugAppAcceptance, getSignedReleaseAcceptance, readAcceptanceRegistry } from './utopia-acceptance-registry.mjs';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const outPath = join(evidenceDir, 'utopia-completion-audit.json');

function readJson(relativePath) {
  return readEvidence(root, relativePath);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function newestProviderAuthorityReceipt() {
  const dir = join(evidenceDir, 'live-workspace');
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith('provider-standalone-authority-'))
    .map((name) => {
      const proofPath = join(dir, name, 'provider-standalone-authority-proof.json');
      const statId = Number((name.match(/(\d+)/g) ?? ['0']).at(-1));
      return { name, statId, proofPath };
    })
    .filter((item) => existsSync(item.proofPath))
    .sort((left, right) => right.statId - left.statId);
  if (!candidates.length) return null;
  const latest = candidates[0];
  try {
    return {
      relative_path: `app/build/evidence/live-workspace/${latest.name}/provider-standalone-authority-proof.json`,
      receipt: JSON.parse(readFileSync(latest.proofPath, 'utf8')),
    };
  } catch {
    return {
      relative_path: `app/build/evidence/live-workspace/${latest.name}/provider-standalone-authority-proof.json`,
      receipt: null,
    };
  }
}

function item(id, label, status, evidence, remaining = []) {
  return { id, label, status, evidence, remaining };
}

const head = git(['rev-parse', '--short', 'HEAD']);
const branch = git(['branch', '--show-current']);
const current = currentGit(root);
const providerAuthority = newestProviderAuthorityReceipt();
const providerProvenance = providerAuthority
  ? validateEvidenceEnvelope(root, providerAuthority.relative_path, providerAuthority.receipt, current)
  : { valid: false, issues: ['evidence_missing_or_invalid_json'] };
const foodGoldenPath = readJson('app/build/evidence/food/food-golden-path-proof.json');
const workflow = readJson('app/build/evidence/workflow/workflow-resume-cancel-proof.json');
const accessibility = readJson('app/build/evidence/accessibility/accessibility-smoke.json');
const webProduct = readJson('app/build/evidence/web-product-smoke/web-product-smoke.json');
const visualMatrix = readJson('app/build/evidence/visual-state-matrix/visual-state-matrix.json');
const nativeVisualMatrix = readJson('app/build/evidence/native-visual-matrix/native-visual-matrix.json');
const responsiveVisualMatrix = readJson('app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json');
const performanceBudget = readJson('app/build/evidence/performance/performance-budget.json');
const productPolish = readJson('app/build/evidence/product-polish/product-polish-review.json');
const acceptanceRegistry = readAcceptanceRegistry(root);
const debugAppAcceptance = getDebugAppAcceptance(acceptanceRegistry);
const signedReleaseAcceptance = getSignedReleaseAcceptance(acceptanceRegistry);

const evidencePaths = {
  foodGoldenPath: 'app/build/evidence/food/food-golden-path-proof.json',
  workflow: 'app/build/evidence/workflow/workflow-resume-cancel-proof.json',
  accessibility: 'app/build/evidence/accessibility/accessibility-smoke.json',
  webProduct: 'app/build/evidence/web-product-smoke/web-product-smoke.json',
  visualMatrix: 'app/build/evidence/visual-state-matrix/visual-state-matrix.json',
  nativeVisualMatrix: 'app/build/evidence/native-visual-matrix/native-visual-matrix.json',
  responsiveVisualMatrix: 'app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json',
  performanceBudget: 'app/build/evidence/performance/performance-budget.json',
  productPolish: 'app/build/evidence/product-polish/product-polish-review.json',
};
const provenance = Object.fromEntries(Object.entries(evidencePaths).map(([key, path]) => [key, validateEvidenceEnvelope(root, path, readJson(path), current)]));
const valid = (key) => provenance[key]?.valid === true;
const provenanceRemaining = (key) => provenance[key]?.issues?.map((issue) => `evidence_provenance:${issue}`) ?? ['evidence_provenance:missing'];

const authorityPassed = providerProvenance.valid && providerAuthority?.receipt?.all_authority_checks_passed === true;
const foodGoldenPathPassed = valid('foodGoldenPath') && foodGoldenPath?.all_passed === true;
const workflowPassed = valid('workflow') && workflow?.all_passed === true;
const visualSmokePassed = valid('accessibility') && valid('webProduct') && accessibility?.pass === true && webProduct?.pass === true;
const visualMatrixPassed = valid('visualMatrix') && visualMatrix?.status === 'passed';
const nativeVisualMatrixPassed = valid('nativeVisualMatrix') && nativeVisualMatrix?.status === 'passed';
const responsiveVisualMatrixPassed = valid('responsiveVisualMatrix') && responsiveVisualMatrix?.status === 'passed';
const performanceBudgetPassed = valid('performanceBudget') && performanceBudget?.status === 'passed';
const productPolishPassed = valid('productPolish') && productPolish?.status === 'passed';
const debugAppRegistryPassed = debugAppAcceptance.status === 'passed';
const debugAppRegistryBlockers = debugAppAcceptance.blockers.map((issue) => `${issue.id}:${issue.status}`);

const items = [
  item(
    'food_golden_path',
    'Food golden path, undo, export and restore proof',
    foodGoldenPathPassed ? 'passed' : 'missing',
    'app/build/evidence/food/food-golden-path-proof.json',
    foodGoldenPathPassed ? [] : provenanceRemaining('foodGoldenPath').concat(['Run check:food-golden-path and inspect all_passed.']),
  ),
  item(
    'live_user_token_notion_sheets_authority',
    'Live user-token Notion and Sheets authority proof',
    authorityPassed ? 'passed' : 'missing',
    providerAuthority?.relative_path ?? null,
    authorityPassed ? [] : providerProvenance.issues.map((issue) => `evidence_provenance:${issue}`).concat(['Run check:provider-standalone-authority with live Notion and Sheets credentials.']),
  ),
  item(
    'workflow_resume_cancel',
    'Workflow resume/cancel proof',
    workflowPassed ? 'passed' : 'missing',
    'app/build/evidence/workflow/workflow-resume-cancel-proof.json',
    workflowPassed ? [] : (provenanceRemaining('workflow').concat(['Run phase7:check:workflow-resume-cancel and inspect all_passed.'])),
  ),
  item(
    'web_visual_state_matrix',
    'Web visual state matrix',
    visualMatrixPassed ? 'passed' : 'missing',
    'app/build/evidence/visual-state-matrix/visual-state-matrix.json',
    visualMatrixPassed ? [] : provenanceRemaining('visualMatrix').concat(['Run phase9:check:visual-state-matrix after check:web-product and check:accessibility-smoke.']),
  ),
  item(
    'native_visual_state_matrix',
    'Native visual state matrix',
    nativeVisualMatrixPassed ? 'passed' : 'missing',
    'app/build/evidence/native-visual-matrix/native-visual-matrix.json',
    nativeVisualMatrixPassed ? [] : provenanceRemaining('nativeVisualMatrix').concat(['Run phase9:check:native-visual-matrix on an Android emulator with the release APK.']),
  ),
  item(
    'responsive_visual_state_matrix',
    'Tablet/foldable responsive visual matrix',
    responsiveVisualMatrixPassed ? 'passed' : 'missing',
    'app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json',
    responsiveVisualMatrixPassed ? [] : provenanceRemaining('responsiveVisualMatrix').concat(['Run phase9:check:responsive-visual-matrix against tablet/foldable viewports.']),
  ),
  item(
    'performance_budget',
    'Performance budget',
    performanceBudgetPassed ? 'passed' : 'missing',
    'app/build/evidence/performance/performance-budget.json',
    performanceBudgetPassed ? [] : provenanceRemaining('performanceBudget').concat(['Run phase9:check:performance-budget after web/android/iOS exports.']),
  ),
  item(
    'final_visual_accessibility_polish',
    'Final visual/accessibility polish',
    productPolishPassed ? 'passed' : (visualSmokePassed && visualMatrixPassed && nativeVisualMatrixPassed && responsiveVisualMatrixPassed && performanceBudgetPassed ? 'partial' : 'missing'),
    {
      web_product: 'app/build/evidence/web-product-smoke/web-product-smoke.json',
      accessibility: 'app/build/evidence/accessibility/accessibility-smoke.json',
      visual_matrix: 'app/build/evidence/visual-state-matrix/visual-state-matrix.json',
      native_visual_matrix: 'app/build/evidence/native-visual-matrix/native-visual-matrix.json',
      responsive_visual_matrix: 'app/build/evidence/responsive-visual-matrix/responsive-visual-matrix.json',
      performance_budget: 'app/build/evidence/performance/performance-budget.json',
      product_polish_review: 'app/build/evidence/product-polish/product-polish-review.json',
    },
    productPolishPassed
      ? []
      : productPolish?.issues?.length
        ? productPolish.issues
      : visualSmokePassed
      ? [
        'Run phase9:check:product-polish-review and clear its issues.',
      ]
      : ['Run/fix check:web-product and check:accessibility-smoke.'],
  ),
  item(
    'debug_app_acceptance_registry',
    'Debug app acceptance registry',
    debugAppRegistryPassed ? 'passed' : 'missing',
    'docs/V1-ACCEPTANCE-REGISTRY.json',
    debugAppRegistryPassed
      ? []
      : debugAppRegistryBlockers.concat(['Resolve open or partial P0/P1 items before calling the debug app complete.']),
  ),
];

const complete = items.every((entry) => entry.status === 'passed');
const blocked = items.filter((entry) => entry.status === 'blocked');
const partial = items.filter((entry) => entry.status === 'partial');
const missing = items.filter((entry) => entry.status === 'missing');
const signedReleaseItem = item(
  'signed_release_acceptance',
  signedReleaseAcceptance.label,
  signedReleaseAcceptance.status === 'accepted' ? 'passed' : 'blocked',
  'docs/V1-ACCEPTANCE-REGISTRY.json',
  signedReleaseAcceptance.status === 'accepted' ? [] : [signedReleaseAcceptance.summary],
);
const payload = {
  proof: 'utopia_completion_audit',
  checked_at: new Date().toISOString(),
  git: { branch, head },
  complete,
  summary: {
    passed: items.filter((entry) => entry.status === 'passed').length,
    partial: partial.length,
    blocked: blocked.length,
    missing: missing.length,
  },
  items,
  release_acceptance: signedReleaseItem,
  acceptance_registry: acceptanceRegistry,
  no_secret_values_written: true,
  evidence_provenance: provenance,
};
payload.evidence_provenance.providerAuthority = providerProvenance;

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2));

const blockers = [...blocked, ...partial, ...missing].map((entry) => `${entry.id}:${entry.status}`);
console.log(`Utopia completion audit: ${complete ? 'COMPLETE' : 'NOT_COMPLETE'} (${blockers.join(', ') || 'none'}; signed_release=${signedReleaseItem.status}; evidence: ${outPath})`);

if (process.env.REQUIRE_LIFEOS_COMPLETE === '1' && !complete) {
  process.exit(1);
}
