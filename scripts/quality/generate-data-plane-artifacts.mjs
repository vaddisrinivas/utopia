#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const template = read('packages/domain-config/templates/utopia-data-plane-template.v1.json');
const food = read('packages/domain-config/domains/food.v1.json');
const outDir = resolve(root, 'packages/domain-config/templates/generated');
const sheetsDir = resolve(outDir, 'sheets');

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path, rows) {
  writeFileSync(path, rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n', 'utf8');
}

function titleForCollection(collection) {
  return collection
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function visualRows() {
  const rows = [];
  const groups = food.visual_identity ?? {};
  const pushToken = (scope, key, token = {}, notes = '') => {
    const emoji = token.emoji ?? '';
    const icon = token.icon ?? '';
    rows.push([
      scope,
      key,
      emoji,
      icon,
      token.image_url ?? '',
      token.accent ?? 'neutral',
      emoji || icon || key.slice(0, 1).toUpperCase(),
      emoji || icon || key.slice(0, 1).toUpperCase(),
      notes,
    ]);
  };
  if (groups.domain) pushToken('domain', food.id, groups.domain, 'Domain home icon/cover fallback');
  for (const [scope, tokens] of Object.entries(groups)) {
    if (scope === 'domain' || !tokens || typeof tokens !== 'object') continue;
    for (const [key, token] of Object.entries(tokens)) pushToken(scope, key, token, `Shared ${scope} visual token`);
  }
  for (const collection of food.collections) {
    if (!groups.collections?.[collection]) pushToken('collections', collection, {}, 'Fallback generated because manifest has no token');
  }
  return rows;
}

function rowsForTab(tab) {
  const header = tab.columns ?? [];
  const rows = [header];
  if (tab.name === 'Home') {
    rows.push(['Today', 'Ready', 'Open Food and review dinner, pantry risk and shopping gap', 'app://home']);
    rows.push(['Food', 'Ready', 'Use Kitchen, Meals, Recipes, Shopping and Purchases', 'app://food']);
    rows.push(['Sources', 'Optional', 'Connect Notion or Sheets when wanted', 'app://sources']);
    return rows;
  }
  if (tab.name === 'Relations') {
    for (const relation of food.relations) {
      rows.push([
        `${relation.from}-example`,
        relation.name,
        relation.to === '*' ? 'any-record-example' : `${relation.to}-example`,
        relation.from,
        relation.to,
        'source-template'
      ]);
    }
    return rows;
  }
  if (tab.name === 'Schema') {
    for (const collection of food.collections) {
      const coverage = template.collection_coverage[collection];
      rows.push([
        collection,
        coverage.notion.join(' / '),
        'id, collection, title, status, food_detail_json, relations_json, source snapshot',
        food.relations
          .filter((relation) => relation.from === collection || relation.to === collection || relation.to === '*')
          .map((relation) => `${relation.from}.${relation.name}->${relation.to}`)
          .join('; '),
        coverage.notion.join('; '),
        coverage.sheets.join('; '),
        'Generated from Food manifest and Utopia data-plane template'
      ]);
    }
    return rows;
  }
  if (tab.name === 'Visual Identity') {
    rows.push(...visualRows());
    return rows;
  }
  if (tab.name === 'Records') {
    for (const collection of food.collections) {
      rows.push([
        `${collection}-example`,
        'food',
        collection,
        titleForCollection(collection),
        'Template',
        `${titleForCollection(collection)} · sample row`,
        `Starter row for ${collection}. Replace or delete after import.`,
        '{"nutrition":[],"ingredients":[],"instructions":[],"logs":[],"variations":[]}',
        '[]',
        'template',
        `${collection}-example`,
        '',
        '2026-07-23T00:00:00.000Z',
        ''
      ]);
    }
    return rows;
  }

  const collections = tab.collections?.includes('*') ? food.collections : (tab.collections ?? []);
  for (const collection of collections) {
    const row = Object.fromEntries(header.map((column) => [column, '']));
    row.id = `${collection}-example`;
    row.collection = collection;
    row.title = titleForCollection(collection);
    row.status = 'Template';
    row.state = 'Template';
    row.food_detail_json = '{"nutrition":[],"ingredients":[],"instructions":[],"logs":[],"variations":[]}';
    rows.push(header.map((column) => row[column] ?? ''));
  }
  return rows;
}

function notionMarkdown() {
  const lines = [];
  lines.push(`# ${template.notion.template_name}`);
  lines.push('');
  lines.push('Beautiful human data plane for Utopia. Import this Markdown into Notion, then create the databases below or use it as the build checklist for an API installer.');
  lines.push('');
  lines.push('## Today');
  lines.push('');
  lines.push(`> ${template.notion.home_page.job}`);
  lines.push('');
  for (const section of template.notion.home_page.sections) lines.push(`- ${section}`);
  lines.push('');
  lines.push('## Navigation');
  lines.push('');
  for (const page of template.notion.pages) {
    const prefix = page.depth === 1 ? '###' : '####';
    lines.push(`${prefix} ${page.title}`);
    lines.push('');
    lines.push(`- Kind: ${page.kind}`);
    lines.push(`- Contains: ${(page.contains ?? []).join(', ')}`);
    lines.push('');
  }
  lines.push('## Databases');
  lines.push('');
  for (const database of template.notion.databases) {
    lines.push(`### ${database.name}`);
    lines.push('');
    lines.push(database.job);
    lines.push('');
    lines.push(`- Collections: ${(database.collections ?? []).join(', ')}`);
    if (database.required_properties) lines.push(`- Required properties: ${database.required_properties.join(', ')}`);
    if (database.views) lines.push(`- Views: ${database.views.join(', ')}`);
    lines.push('');
  }
  lines.push('## Visual identity');
  lines.push('');
  lines.push('Use these same tokens for Notion page icons/covers, Sheets dashboard symbols, app cards and MCP/external AI clients. App settings may override these bundled defaults without rebuilding.');
  lines.push('');
  for (const [scope, key, emoji, icon, imageUrl, accent] of visualRows()) {
    lines.push(`- ${emoji || icon || '•'} **${scope}.${key}** · accent: ${accent}${imageUrl ? ` · image: ${imageUrl}` : ''}`);
  }
  lines.push('');
  lines.push('## Relation views');
  lines.push('');
  for (const relationView of template.notion.relation_views) lines.push(`- ${relationView}`);
  lines.push('');
  lines.push('## Buttons');
  lines.push('');
  for (const button of template.notion.buttons) {
    lines.push(`- **${button.name}** on ${button.page}: ${button.action}`);
  }
  lines.push('');
  lines.push('## Template health');
  lines.push('');
  lines.push('- Confirm all databases include stable `_ID` / `id` fields.');
  lines.push('- Confirm source snapshot fields exist before enabling sync.');
  lines.push('- Confirm Notion buttons do not hide required review steps.');
  lines.push('- Confirm `@now` style dates remain dynamic after duplication.');
  lines.push('');
  return lines.join('\n');
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(sheetsDir, { recursive: true });

writeFileSync(resolve(outDir, 'notion-import.md'), notionMarkdown(), 'utf8');
writeFileSync(resolve(outDir, 'template-summary.json'), JSON.stringify({
  generated_at: '2026-07-23T00:00:00.000Z',
  template_id: template.id,
  food_collections: food.collections.length,
  notion_databases: template.notion.databases.length,
  sheets_tabs: template.sheets.tabs.length,
  output_files: [
    'notion-import.md',
    'template-summary.json',
    ...template.sheets.tabs.map((tab) => `sheets/${tab.name.toLowerCase().replaceAll(' ', '-')}.csv`)
  ]
}, null, 2) + '\n', 'utf8');

for (const tab of template.sheets.tabs) {
  const file = `${tab.name.toLowerCase().replaceAll(' ', '-')}.csv`;
  writeCsv(resolve(sheetsDir, file), rowsForTab(tab));
}

console.log(`Generated Utopia data-plane artifacts in ${outDir}`);
