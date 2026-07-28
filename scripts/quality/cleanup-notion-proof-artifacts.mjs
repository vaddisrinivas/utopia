import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const token = (process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '').trim();
if (!token) {
  console.error('Missing NOTION_TOKEN or NOTION_API_KEY. Values were not printed.');
  process.exit(1);
}

const evidenceDir = join(process.cwd(), 'app', 'build', 'evidence', 'live-workspace');
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, `notion-proof-cleanup-${Math.floor(Date.now() / 1000)}.json`);

const pagePrefixes = [
  'Utopia C14 Scenario Proof',
];
const dataSourcePrefixes = [
  'Utopia Direct Writeback Records',
];

function mask(value) {
  const raw = String(value || '');
  return raw.length > 8 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : raw || null;
}

async function notion(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2026-03-11',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { ok: response.ok, status: response.status, body };
}

function titleOf(item) {
  if (Array.isArray(item.title)) return item.title.map((part) => part.plain_text || '').join('');
  const properties = item.properties && typeof item.properties === 'object' ? item.properties : {};
  for (const prop of Object.values(properties)) {
    if (prop && Array.isArray(prop.title)) return prop.title.map((part) => part.plain_text || '').join('');
  }
  return '';
}

async function search(query) {
  const result = await notion('/search', {
    method: 'POST',
    body: JSON.stringify({ query, page_size: 100 }),
  });
  if (!result.ok) throw new Error(`Notion search failed ${result.status}`);
  return Array.isArray(result.body.results) ? result.body.results : [];
}

const archived = [];
const failed = [];

for (const prefix of pagePrefixes) {
  const matches = (await search(prefix)).filter((item) => (
    item.object === 'page'
    && titleOf(item).startsWith(prefix)
    && !item.in_trash
    && !item.archived
  ));
  for (const page of matches) {
    const result = await notion(`/pages/${encodeURIComponent(page.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ in_trash: true }),
    });
    const receipt = { object: 'page', id: mask(page.id), title: titleOf(page), status: result.status };
    (result.ok ? archived : failed).push(receipt);
  }
}

for (const prefix of dataSourcePrefixes) {
  const matches = (await search(prefix)).filter((item) => (
    item.object === 'data_source'
    && titleOf(item).startsWith(prefix)
    && !item.in_trash
    && !item.archived
  ));
  for (const source of matches) {
    const databaseId = source.parent?.database_id;
    let databaseArchived = false;
    if (databaseId) {
      const dbResult = await notion(`/databases/${encodeURIComponent(databaseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      databaseArchived = dbResult.ok;
      if (!dbResult.ok) {
        failed.push({ object: 'database', id: mask(databaseId), title: titleOf(source), status: dbResult.status });
      }
    }
    const receipt = {
      object: 'data_source',
      id: mask(source.id),
      database_id: mask(databaseId),
      title: titleOf(source),
      database_archived: databaseArchived,
      status: databaseArchived ? 200 : 0,
    };
    (databaseArchived ? archived : failed).push(receipt);
  }
}

const payload = {
  proof: 'notion_proof_artifact_cleanup',
  captured_at: new Date().toISOString(),
  no_token_or_secret_visible: true,
  archived_count: archived.length,
  failed_count: failed.length,
  archived,
  failed,
  all_passed: failed.length === 0,
};
writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
console.log(evidencePath);
if (failed.length) process.exit(1);
