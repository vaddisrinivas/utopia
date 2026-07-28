#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { currentGit } from './evidence-provenance.mjs';
import { ensureWebBaseUrl } from './web-static-server.mjs';

const root = process.cwd();
const baseUrl = process.env.LIFEOS_WEB_BASE_URL || 'http://127.0.0.1:8094';
const outDir = join(root, 'app', 'build', 'evidence', 'accessibility');
const outPath = join(outDir, 'accessibility-smoke.json');
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
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
      // next
    }
  }
  try {
    return createRequire(join(root, 'package.json'))('playwright');
  } catch {
    throw new Error('Playwright not found. Set PLAYWRIGHT_NODE_MODULES to a node_modules containing playwright.');
  }
}

function chromeExecutable() {
  return chromeCandidates.find((candidate) => candidate && existsSync(candidate));
}

function isExpectedSqliteWasmFallback(message) {
  return (
    message.includes('wasm streaming compile failed: TypeError: Failed to execute') &&
    message.includes('Incorrect response MIME type. Expected') &&
    message.includes('application/wasm')
  ) || message === 'falling back to ArrayBuffer instantiation'
    || message === 'Failed to load resource: the server responded with a status of 404 (Not Found)';
}

const routes = [
  '/',
  '/food',
  '/record/meal-green-dal',
  '/collection/recipe',
  '/chat',
  '/sources',
  '/settings',
  '/config',
  '/search',
  '/capture',
  '/health-diagnostics',
];

const viewports = [
  { label: 'desktop', width: 1280, height: 900 },
  { label: 'mobile', width: 390, height: 900 },
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
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  for (const path of routes) {
    const url = `${baseUrl}${path}`;
    const result = {
      route: path,
      viewport,
      ok: false,
      unlabeledInteractive: [],
      unlabeledTextboxes: [],
      severeTouchTargetFailures: [],
      touchTargetWarnings: [],
      consoleErrors: [],
    };
    page.removeAllListeners('console');
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !isExpectedSqliteWasmFallback(text)) result.consoleErrors.push(text);
    });

    try {
      await page.goto(`${baseUrl}/_sitemap`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.evaluate(() => localStorage.removeItem('utopia.settings.v1'));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('body', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(250);
      const audit = await page.evaluate(() => {
        function textFromLabelledBy(el) {
          const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
          return ids.map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        }
        function nameOf(el) {
          return [
            el.getAttribute('aria-label'),
            textFromLabelledBy(el),
            el.getAttribute('title'),
            el.getAttribute('placeholder'),
            el.textContent,
            el.getAttribute('value'),
          ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
        }
        function visible(el) {
          const style = window.getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return style.visibility !== 'hidden'
            && style.display !== 'none'
            && Number(style.opacity || '1') > 0
            && box.width > 0
            && box.height > 0
            && box.bottom >= 0
            && box.right >= 0
            && box.top <= window.innerHeight * 3;
        }
        function selectorFor(el) {
          const role = el.getAttribute('role');
          const text = nameOf(el).slice(0, 80);
          const tag = el.tagName.toLowerCase();
          return `${tag}${role ? `[role=${role}]` : ''}${text ? ` "${text}"` : ''}`;
        }
        const interactive = Array.from(document.querySelectorAll([
          'a[href]',
          'button',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="switch"]',
          '[role="tab"]',
          '[tabindex]:not([tabindex="-1"])',
        ].join(','))).filter((el) => visible(el) && el.getAttribute('aria-hidden') !== 'true');

        const unlabeledInteractive = [];
        const unlabeledTextboxes = [];
        const severeTouchTargetFailures = [];
        const touchTargetWarnings = [];

        for (const el of interactive) {
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const name = nameOf(el);
          const box = el.getBoundingClientRect();
          const entry = {
            selector: selectorFor(el),
            role,
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
          if (!name) {
            unlabeledInteractive.push(entry);
          }
          if ((role === 'textbox' || ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase())) && !name) {
            unlabeledTextboxes.push(entry);
          }
          if (['button', 'link', 'checkbox', 'switch', 'tab', 'a'].includes(role)) {
            if (box.width < 32 && box.height < 32) severeTouchTargetFailures.push(entry);
            else if (box.width < 44 || box.height < 44) touchTargetWarnings.push(entry);
          }
        }

        return {
          interactiveCount: interactive.length,
          unlabeledInteractive,
          unlabeledTextboxes,
          severeTouchTargetFailures,
          touchTargetWarnings,
        };
      });
      Object.assign(result, audit);
      result.ok =
        result.consoleErrors.length === 0
        && result.unlabeledInteractive.length === 0
        && result.unlabeledTextboxes.length === 0
        && result.severeTouchTargetFailures.length === 0;
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
  proof: 'utopia_accessibility_smoke',
  pass: results.every((result) => result.ok),
  baseUrl,
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  routes: routes.length,
  viewports,
  rules: {
    fail: [
      'visible interactive element has no accessible name',
      'visible textbox/select has no accessible name',
      'mobile/web touch target has both dimensions below 32px',
      'browser console error',
    ],
    warn: ['touch target below recommended 44px but at least 32px'],
  },
  totals: {
    unlabeledInteractive: results.reduce((sum, result) => sum + result.unlabeledInteractive.length, 0),
    unlabeledTextboxes: results.reduce((sum, result) => sum + result.unlabeledTextboxes.length, 0),
    severeTouchTargetFailures: results.reduce((sum, result) => sum + result.severeTouchTargetFailures.length, 0),
    touchTargetWarnings: results.reduce((sum, result) => sum + result.touchTargetWarnings.length, 0),
    consoleErrors: results.reduce((sum, result) => sum + result.consoleErrors.length, 0),
  },
  results,
};

writeFileSync(outPath, JSON.stringify(evidence, null, 2));

if (!evidence.pass) {
  console.error(`FAIL ${outPath}`);
  console.error(JSON.stringify(evidence.totals, null, 2));
  process.exit(1);
}

console.log(`Accessibility smoke: PASS (${outPath})`);
