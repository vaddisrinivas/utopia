#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const food = read('packages/domain-config/domains/food.v1.json');
const template = read('packages/domain-config/templates/utopia-data-plane-template.v1.json');
const schemaPath = resolve(root, 'packages/domain-config/templates', template.$schema ?? '');
const generatedDir = resolve(root, 'packages/domain-config/templates/generated');
const generatedSheetsDir = resolve(generatedDir, 'sheets');

function fail(message) {
  console.error(`Data-plane template invalid: ${message}`);
  process.exit(1);
}

if (template.schema_version !== 'utopia.data_plane_template.v1') fail('schema_version mismatch');
if (!template.$schema || !existsSync(schemaPath)) fail(`missing referenced schema: ${template.$schema}`);
read(schemaPath);
if (template.sync_contract?.webhooks_required !== false) fail('webhooks must be optional');
if (template.sync_contract?.hosted_server_required !== false) fail('hosted server must not be required');
if (template.sync_contract?.source_snapshots_required !== true) fail('source snapshots must be required');
if (template.notion?.max_navigation_depth > 3) fail('Notion navigation exceeds depth 3');

const foodCollections = new Set(food.collections);
const coverage = template.collection_coverage ?? {};
for (const collection of food.collections) {
  const row = coverage[collection];
  if (!row) fail(`missing collection coverage: ${collection}`);
  if (!Array.isArray(row.notion) || row.notion.length === 0) fail(`missing Notion mapping: ${collection}`);
  if (!Array.isArray(row.sheets) || row.sheets.length === 0) fail(`missing Sheets mapping: ${collection}`);
}

for (const collection of Object.keys(coverage)) {
  if (!foodCollections.has(collection)) fail(`coverage references unknown Food collection: ${collection}`);
}

const notionDatabaseNames = new Set((template.notion?.databases ?? []).map((database) => database.name));
const sheetTabNames = new Set((template.sheets?.tabs ?? []).map((tab) => tab.name));

for (const [collection, row] of Object.entries(coverage)) {
  for (const name of row.notion) {
    if (!notionDatabaseNames.has(name)) fail(`Notion mapping for ${collection} points to missing database: ${name}`);
  }
  for (const name of row.sheets) {
    if (!sheetTabNames.has(name)) fail(`Sheets mapping for ${collection} points to missing tab: ${name}`);
  }
}

const wildcardNotion = (template.notion?.databases ?? []).filter((database) => database.collections?.includes('*'));
if (wildcardNotion.length !== 1) fail('expected one canonical wildcard Notion database');

const wildcardSheets = (template.sheets?.tabs ?? []).filter((tab) => tab.collections?.includes('*'));
if (wildcardSheets.length < 2) fail('expected canonical Records and Schema Sheets tabs');

const requiredCanonicalColumns = ['id', 'domain', 'collection', 'title', 'status', 'food_detail_json', 'relations_json'];
const recordsTab = (template.sheets?.tabs ?? []).find((tab) => tab.name === 'Records');
for (const column of requiredCanonicalColumns) {
  if (!recordsTab?.columns?.includes(column)) fail(`Records tab missing column: ${column}`);
}

const visualTab = (template.sheets?.tabs ?? []).find((tab) => tab.name === 'Visual Identity');
if (!visualTab) fail('missing Visual Identity Sheets tab');
for (const column of ['scope', 'key', 'emoji', 'icon', 'image_url', 'accent', 'notion_icon', 'sheets_symbol']) {
  if (!visualTab.columns?.includes(column)) fail(`Visual Identity tab missing column: ${column}`);
}

const collectionVisuals = food.visual_identity?.collections ?? {};
for (const collection of food.collections) {
  if (!collectionVisuals[collection]) fail(`Food visual_identity missing collection token: ${collection}`);
}

const buttonNames = new Set((template.notion?.buttons ?? []).map((button) => button.name));
for (const name of ['Plan dinner from pantry', 'Add receipt', 'Log cooked', 'Build shopping list']) {
  if (!buttonNames.has(name)) fail(`missing Notion button model: ${name}`);
}

const notionImportPath = resolve(generatedDir, 'notion-import.md');
const summaryPath = resolve(generatedDir, 'template-summary.json');
if (!existsSync(notionImportPath)) fail('missing generated Notion import artifact; run npm run generate:data-plane-template');
if (!existsSync(summaryPath)) fail('missing generated template summary; run npm run generate:data-plane-template');

const notionImport = readFileSync(notionImportPath, 'utf8');
if (!notionImport.includes('## Visual identity')) fail('generated Notion import missing visual identity section');
for (const database of template.notion?.databases ?? []) {
  if (!notionImport.includes(`### ${database.name}`)) fail(`generated Notion import missing database: ${database.name}`);
}
for (const button of template.notion?.buttons ?? []) {
  if (!notionImport.includes(`**${button.name}**`)) fail(`generated Notion import missing button: ${button.name}`);
}

const summary = read('packages/domain-config/templates/generated/template-summary.json');
if (summary.template_id !== template.id) fail('generated summary template_id mismatch');
if (summary.food_collections !== food.collections.length) fail('generated summary Food collection count mismatch');
if (summary.notion_databases !== notionDatabaseNames.size) fail('generated summary Notion database count mismatch');
if (summary.sheets_tabs !== sheetTabNames.size) fail('generated summary Sheets tab count mismatch');

function csvName(tabName) {
  return `${tabName.toLowerCase().replaceAll(' ', '-')}.csv`;
}

function csvRows(filePath) {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(','));
}

for (const tab of template.sheets?.tabs ?? []) {
  const file = resolve(generatedSheetsDir, csvName(tab.name));
  if (!existsSync(file)) fail(`missing generated Sheets CSV: ${csvName(tab.name)}`);
  const rows = csvRows(file);
  if (rows.length < 2) fail(`generated Sheets CSV has no rows: ${csvName(tab.name)}`);
  const header = rows[0].join(',');
  if (header !== tab.columns.join(',')) fail(`generated Sheets CSV header drift: ${csvName(tab.name)}`);
}

const recordsRows = csvRows(resolve(generatedSheetsDir, 'records.csv'));
if (recordsRows.length !== food.collections.length + 1) fail('generated Records CSV must include one starter row per Food collection');

const schemaRows = csvRows(resolve(generatedSheetsDir, 'schema.csv'));
if (schemaRows.length !== food.collections.length + 1) fail('generated Schema CSV must include one registry row per Food collection');

const visualRows = csvRows(resolve(generatedSheetsDir, 'visual-identity.csv'));
const visualHeader = visualRows[0].join(',');
if (visualHeader !== visualTab.columns.join(',')) fail('generated Visual Identity CSV header drift');
for (const collection of food.collections) {
  if (!visualRows.some((row) => row[0] === 'collections' && row[1] === collection)) fail(`generated Visual Identity CSV missing collection token: ${collection}`);
}
for (const required of [['actions', 'add_record'], ['sources', 'notion'], ['sources', 'google_sheets']]) {
  if (!visualRows.some((row) => row[0] === required[0] && row[1] === required[1])) fail(`generated Visual Identity CSV missing token: ${required.join('.')}`);
}

const relationRows = csvRows(resolve(generatedSheetsDir, 'relations.csv'));
if (relationRows.length !== food.relations.length + 1) fail('generated Relations CSV must include one edge row per Food relation');

console.log(`Data-plane template valid: ${food.collections.length} Food collections mapped to ${notionDatabaseNames.size} Notion databases, ${sheetTabNames.size} Sheets tabs, and generated import artifacts.`);
