#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { currentGit } from './evidence-provenance.mjs';
import { ensureWebBaseUrl } from './web-static-server.mjs';

const root = process.cwd();
const baseUrl = process.env.LIFEOS_WEB_BASE_URL || 'http://127.0.0.1:8094';
const outDir = join(root, 'app', 'build', 'evidence', 'web-product-smoke');

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
  try {
    return createRequire(join(root, 'package.json'))('playwright');
  } catch {
    throw new Error('Playwright not found. Set PLAYWRIGHT_NODE_MODULES to a node_modules containing playwright, or install it for local QA.');
  }
}

function chromeExecutable() {
  return chromeCandidates.find((candidate) => candidate && existsSync(candidate));
}

const routes = [
  {
    name: 'home',
    path: '/',
    must: ['LIFEOS / HOME', 'Ask with context', 'Review queue', 'Life spaces', 'Recent updates', 'Open Sources'],
    forbidden: ['Record not found'],
  },
  {
    name: 'food',
    path: '/food',
    must: ['Today', 'Dinner first. Waste less. Buy only what you need.', 'Tonight', 'Use first', 'Still needed', 'Kitchen', 'Plan', 'Shop'],
    forbidden: ['Record not found', 'Edit package', 'DATA PLANE', 'Tune layout', 'Food dashboard', 'Food collection atlas', 'Kitchen lab', 'Advanced', 'Source and provenance', 'Package controls', 'Sync health'],
    inspect: async (page) => {
      for (const [tab, text] of [
        ['Kitchen', 'Pantry and fridge'],
        ['Plan', 'Meals and recipes'],
        ['Shop', 'To buy'],
        ['Today', 'Tonight'],
      ]) {
        await page.getByRole('tab', { name: new RegExp(tab) }).click();
        await page.waitForFunction((needle) => document.body?.innerText?.includes(needle), text);
      }
    },
  },
  {
    name: 'search',
    path: '/search',
    must: ['LIFEOS / SEARCH', 'Search food.', 'Quick actions', 'Ask Food AI', 'Add food'],
  },
  {
    name: 'capture',
    path: '/capture',
    must: ['LIFEOS / ADD', 'Add food.', 'INBOX FIRST', 'Food', 'Save capture'],
    forbidden: ['this phase', 'inbox (preview)', 'session fallback'],
  },
  {
    name: 'sources',
    path: '/sources',
    must: ['LIFEOS / SOURCES', 'Your food data homes.', 'LOCAL FIRST', 'Pull what you want. Keep control.', 'What Food Chat can cite'],
  },
  {
    name: 'chat',
    path: '/chat',
    must: ['Ask Wonder'],
    mustByViewport: {
      desktop: ['Ask Wonder', 'Ask, compare, plan, then act.', 'Sources in context', 'Assistant route', 'Undo'],
      mobile: ['Ask Wonder', 'New conversation', 'I’m ready. Ask what to cook, what to use first, or what to buy.'],
    },
  },
  {
    name: 'config',
    path: '/config',
    must: ['Active package contract', 'Screen Builder', 'Collections', 'MCP contract', 'Visual identity editor', 'Operating view order'],
  },
  {
    name: 'settings',
    path: '/settings',
    must: ['Advanced'],
    mustByViewport: {
      desktop: ['LIFEOS / CONNECTIONS', 'Food workspace settings', 'Configure food, sources, and app preferences.', 'Local answers first', 'No external sources', 'Advanced'],
      mobile: ['Settings', 'Food · comfortable', 'Wonder AI', 'Food data', 'Health', 'Advanced'],
    },
  },
];

const { chromium } = requirePlaywright();
const executablePath = chromeExecutable();
mkdirSync(outDir, { recursive: true });
const webServer = await ensureWebBaseUrl({ root, baseUrl });

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

const results = [];
const viewports = [
  { label: 'desktop', width: 1500, height: 1100 },
  { label: 'mobile', width: 390, height: 900 },
];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  for (const route of routes) {
    const page = await context.newPage();
    process.stdout.write(`[web-product] ${route.name}-${viewport.label}\n`);
    const result = {
      name: `${route.name}-${viewport.label}`,
      route: route.name,
      viewport,
      url: `${baseUrl}${route.path}`,
      ok: false,
      missing: [],
      screenshot: join(outDir, `${route.name}-${viewport.label}.png`),
      consoleErrors: [],
      runtimeErrors: [],
      wasmResponses: [],
      horizontalOverflow: null,
    };
    const consoleErrors = [];
    const runtimeErrors = [];
    const wasmResponses = [];
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error') consoleErrors.push(text);
    });
    page.on('pageerror', (error) => {
      runtimeErrors.push(error.message);
    });
    page.on('requestfailed', (request) => {
      runtimeErrors.push(`Request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
    });
    page.on('response', (response) => {
      if (!new URL(response.url()).pathname.endsWith('.wasm')) return;
      const contentType = response.headers()['content-type'] || '';
      wasmResponses.push({ url: response.url(), status: response.status(), contentType });
      if (response.status() !== 200 || !contentType.toLowerCase().startsWith('application/wasm')) {
        runtimeErrors.push(`Invalid WASM response: ${response.status()} ${contentType || 'missing-content-type'}`);
      }
    });
    try {
      await page.addInitScript((settings) => {
        localStorage.removeItem('utopia.settings.v1');
        if (settings) localStorage.setItem('utopia.settings.v1', JSON.stringify(settings));
      }, route.localSettings ?? null);
      await page.goto(result.url, { waitUntil: 'networkidle', timeout: 20000 });
      const required = route.mustByViewport?.[viewport.label] ?? route.must;
      await page.waitForFunction(
        (needles) => needles.every((needle) => document.body?.innerText?.includes(needle)),
        required,
        { timeout: 12000 },
      ).catch(() => undefined);
      const text = await page.locator('body').innerText({ timeout: 8000 });
      result.missing = required.filter((needle) => !text.includes(needle));
      if (route.forbidden) {
        for (const needle of route.forbidden) {
          if (text.includes(needle)) result.missing.push(`forbidden:${needle}`);
        }
      }
      result.consoleErrors = consoleErrors;
      result.runtimeErrors = runtimeErrors;
      result.wasmResponses = wasmResponses;
      result.horizontalOverflow = await page.evaluate(() => {
        const doc = document.scrollingElement || document.documentElement;
        return Math.max(0, doc.scrollWidth - window.innerWidth);
      });
      await route.inspect?.(page);
      await page.screenshot({ path: result.screenshot, fullPage: true });
      result.ok = result.missing.length === 0
        && consoleErrors.length === 0
        && runtimeErrors.length === 0
        && wasmResponses.length > 0
        && result.horizontalOverflow <= 2;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      await page.close();
    }
    results.push(result);
    process.stdout.write(`[web-product] ${result.ok ? 'ok' : 'fail'} ${result.name}\n`);
    if (!result.ok) {
      process.stdout.write(`${JSON.stringify({ missing: result.missing, error: result.error, consoleErrors: result.consoleErrors, runtimeErrors: result.runtimeErrors, wasmResponses: result.wasmResponses, horizontalOverflow: result.horizontalOverflow })}\n`);
    }
  }
  await context.close();
}

await browser.close();
await webServer.close();

const evidence = {
  proof: 'utopia_web_product_smoke',
  scope: 'food_debug_app_only',
  pass: results.every((result) => result.ok),
  baseUrl,
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  results,
};

const outPath = join(outDir, 'web-product-smoke.json');
writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf-8');

if (!evidence.pass) {
  console.error(`FAIL ${outPath}`);
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}

console.log(`PASS ${outPath}`);
