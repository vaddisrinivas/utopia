#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { currentGit } from './evidence-provenance.mjs';
import { ensureWebBaseUrl } from './web-static-server.mjs';

const root = process.cwd();
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const baseUrl = process.env.LIFEOS_WEB_BASE_URL || 'http://127.0.0.1:8094';
const outDir = join(root, 'app', 'build', 'evidence', 'responsive-visual-matrix');
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

function requirePlaywright() {
  const moduleDirs = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    process.env.CODEX_PRIMARY_NODE_MODULES,
    '/Users/srinivasvaddi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
  ].filter(Boolean);
  for (const dir of moduleDirs) {
    try {
      return createRequire(join(dir, 'package.json'))('playwright');
    } catch {
      // try next
    }
  }
  return createRequire(join(root, 'package.json'))('playwright');
}

function chromeExecutable() {
  return chromeCandidates.find((candidate) => candidate && existsSync(candidate));
}

function isExpectedSqliteWasmFallback(message) {
  return (
    message.includes('wasm streaming compile failed: TypeError: Failed to execute') &&
    message.includes('Incorrect response MIME type. Expected') &&
    message.includes('application/wasm')
  ) || message === 'falling back to ArrayBuffer instantiation';
}

const routes = [
  { name: 'home', path: '/', labels: ['LIFEOS / HOME', 'Review queue', 'Recent updates'] },
  { name: 'food', path: '/food', labels: ['FOOD', 'Food, gently', 'Tonight', 'Expiring soon', 'Pantry gaps', 'Shopping next'] },
  { name: 'chat', path: '/chat', labels: ['LIFEOS / CHAT', 'Ask, compare, plan, then act.'] },
  { name: 'sources', path: '/sources', labels: ['LIFEOS / SOURCES', 'Your food data homes.'] },
  { name: 'config', path: '/config', labels: ['Active package contract', 'Screen Builder'] },
  { name: 'settings', path: '/settings', labels: ['LIFEOS / CONNECTIONS', 'Local answers first'] },
];

const viewports = [
  { label: 'tablet-portrait', width: 834, height: 1112 },
  { label: 'tablet-landscape', width: 1112, height: 834 },
  { label: 'foldable-portrait', width: 673, height: 841 },
  { label: 'foldable-landscape', width: 841, height: 673 },
];

mkdirSync(outDir, { recursive: true });
const { chromium } = requirePlaywright();
const webServer = await ensureWebBaseUrl({ root, baseUrl });
const browser = await chromium.launch({
  headless: true,
  ...(chromeExecutable() ? { executablePath: chromeExecutable() } : {}),
});

const results = [];
for (const viewport of viewports) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  for (const route of routes) {
    const result = {
      route: route.name,
      viewport,
      url: `${baseUrl}${route.path}`,
      screenshot: `app/build/evidence/responsive-visual-matrix/${route.name}-${viewport.label}.png`,
      ok: false,
      missing: [],
      horizontalOverflow: null,
      consoleErrors: [],
    };
    const consoleErrors = [];
    page.removeAllListeners('console');
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !isExpectedSqliteWasmFallback(text)) consoleErrors.push(text);
    });
    try {
      await page.goto(`${baseUrl}/_sitemap`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.evaluate(() => localStorage.removeItem('utopia.settings.v1'));
      await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('body', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(200);
      const text = await page.locator('body').innerText({ timeout: 8000 });
      result.missing = route.labels.filter((label) => !text.includes(label));
      result.horizontalOverflow = await page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        return Math.max(0, root.scrollWidth - window.innerWidth);
      });
      result.consoleErrors = consoleErrors;
      await page.screenshot({ path: join(root, result.screenshot), fullPage: true });
      result.ok = result.missing.length === 0 && consoleErrors.length === 0 && result.horizontalOverflow <= 2;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
  }
  await page.close();
}
await browser.close();
await webServer.close();

const evidence = {
  proof: 'utopia_responsive_visual_matrix',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  status: results.every((result) => result.ok) ? 'passed' : 'failed',
  baseUrl,
  viewports,
  routes: routes.map((route) => route.name),
  screenshot_count: results.length,
  results,
};

const outPath = join(outDir, 'responsive-visual-matrix.json');
writeFileSync(outPath, JSON.stringify(evidence, null, 2));

console.log(`Responsive visual matrix: ${evidence.status === 'passed' ? 'PASS' : 'FAIL'} (${results.filter((result) => result.ok).length}/${results.length}; evidence: ${outPath})`);
if (evidence.status !== 'passed') {
  process.exit(1);
}
