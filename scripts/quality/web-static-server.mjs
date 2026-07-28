import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};

async function canReach(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function candidatePaths(webRoot, pathname) {
  const clean = normalize(decodeURIComponent(pathname))
    .replace(/^(\.\.(\/|\\|$))+/, '')
    .replace(/^[/\\]+/, '');
  const route = clean === '' || clean === '.' ? 'index' : clean.replace(/[/\\]$/, '');
  const candidates = [
    join(webRoot, route),
    join(webRoot, `${route}.html`),
    join(webRoot, route, 'index.html'),
  ];
  if (!extname(route)) candidates.push(join(webRoot, 'index.html'));
  return candidates;
}

function createStaticServer(webRoot) {
  return createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const filePath = candidatePaths(webRoot, url.pathname).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (!filePath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(readFileSync(filePath));
  });
}

function ensureWebExport(root, webRoot) {
  if (existsSync(join(webRoot, 'index.html'))) return;
  const result = spawnSync('npm', ['run', 'export:web'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0 || !existsSync(join(webRoot, 'index.html'))) {
    throw new Error('npm run export:web completed without dist/web/index.html. Treat this as a web product/export failure until the static export emits HTML again.');
  }
}

export async function ensureWebBaseUrl({ root, baseUrl }) {
  const sitemapUrl = `${baseUrl.replace(/\/$/, '')}/_sitemap`;
  if (await canReach(sitemapUrl)) {
    return { baseUrl, close: async () => {} };
  }
  if (process.env.LIFEOS_WEB_BASE_URL) {
    throw new Error(`LIFEOS_WEB_BASE_URL is set but unreachable: ${sitemapUrl}`);
  }
  const parsed = new URL(baseUrl);
  const webRoot = join(root, 'dist', 'web');
  ensureWebExport(root, webRoot);
  const server = createStaticServer(webRoot);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(parsed.port || 80), parsed.hostname, resolve);
  });
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
