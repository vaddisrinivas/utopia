#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'app', 'build', 'evidence', 'utopia-single-shot', stamp);
const outPath = join(outDir, 'summary.json');
mkdirSync(outDir, { recursive: true });

const suites = [
  { id: 'config', command: ['npm', 'run', 'config:validate'] },
  { id: 'typecheck', command: ['npm', 'run', 'typecheck'] },
  { id: 'doctor', command: ['npm', 'run', 'doctor'] },
  { id: 'unit', command: ['npm', 'run', 'test'] },
  { id: 'server_direct', command: ['npm', 'run', 'test:server:direct'] },
  { id: 'package_builder', command: ['npm', 'run', 'check:package-builder-api'] },
  { id: 'food_golden_path', command: ['npm', 'run', 'check:food-golden-path'] },
  { id: 'provider_writeback_local', command: ['npm', 'run', 'check:provider-writeback'] },
  { id: 'ai_runtime', command: ['npm', 'run', 'check:ai-runtime'] },
  { id: 'workflow_runtime', command: ['npm', 'run', 'check:workflow-runtime'] },
  { id: 'workflow_resume_cancel', command: ['npm', 'run', 'phase7:check:workflow-resume-cancel'] },
  { id: 'writer_boundary', command: ['npm', 'run', 'check:writer-boundary'] },
  { id: 'migrations', command: ['npm', 'run', 'check:migrations'] },
  { id: 'roundtrip', command: ['npm', 'run', 'check:roundtrip'] },
  { id: 'sync_merge', command: ['npm', 'run', 'check:sync-merge'] },
  { id: 'web_export', command: ['npm', 'run', 'export:web'] },
  { id: 'web_product', command: ['npm', 'run', 'check:web-product'] },
  { id: 'accessibility', command: ['npm', 'run', 'check:accessibility-smoke'] },
  { id: 'responsive_visual', command: ['npm', 'run', 'phase9:check:responsive-visual-matrix'] },
  { id: 'visual_state', command: ['npm', 'run', 'phase9:check:visual-state-matrix'] },
  { id: 'performance', command: ['npm', 'run', 'phase9:check:performance-budget'] },
  { id: 'android_export', command: ['npm', 'run', 'export:android'] },
  { id: 'native_visual', command: ['npm', 'run', 'phase9:check:native-visual-matrix'], optional: process.env.UTOPIA_REQUIRE_NATIVE_VISUAL !== '1' },
  { id: 'product_polish', command: ['npm', 'run', 'phase9:check:product-polish-review'] },
  { id: 'completion_audit', command: ['npm', 'run', 'phase9:check:completion-audit'], optional: process.env.REQUIRE_LIFEOS_COMPLETE !== '1' },
];

if (process.env.UTOPIA_LIVE_PROVIDERS === '1') {
  suites.push({ id: 'live_sheets_notion', command: ['npm', 'run', 'check:live-providers'], optional: process.env.UTOPIA_REQUIRE_LIVE_PROVIDERS !== '1' });
}

const summary = {
  proof: 'utopia_single_shot_acceptance',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  pass: false,
  failed: null,
  results: [],
  evidence_dir: outDir,
  no_secret_values_written: true,
};

function write() {
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
}

for (const suite of suites) {
  const started = new Date().toISOString();
  process.stdout.write(`\n[utopia] ${suite.id}\n`);
  const result = spawnSync(suite.command[0], suite.command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || '/tmp/utopia-npm-cache',
    },
    maxBuffer: 1024 * 1024 * 20,
  });
  const ended = new Date().toISOString();
  const record = {
    id: suite.id,
    command: suite.command.join(' '),
    started_at: started,
    ended_at: ended,
    status: result.status ?? 1,
    signal: result.signal ?? null,
    optional: Boolean(suite.optional),
    stdout_tail: String(result.stdout || '').slice(-6000),
    stderr_tail: String(result.stderr || '').slice(-6000),
  };
  summary.results.push(record);
  write();
  if (record.status !== 0 && !suite.optional) {
    summary.failed = suite.id;
    summary.pass = false;
    write();
    process.stderr.write(`\n[utopia] FAIL ${suite.id}; evidence ${outPath}\n`);
    process.exit(record.status || 1);
  }
  if (record.status !== 0) process.stderr.write(`\n[utopia] OPTIONAL_FAIL ${suite.id}; continuing\n`);
}

summary.pass = summary.results.every((result) => result.status === 0 || result.optional);
summary.completed_at = new Date().toISOString();
write();

if (!summary.pass) {
  process.stderr.write(`[utopia] NOT_COMPLETE ${outPath}\n`);
  process.exit(1);
}

if (!existsSync(outPath)) throw new Error('summary not written');
console.log(`[utopia] PASS ${outPath}`);
