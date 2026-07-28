import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const foodPath = path.join(root, 'packages/domain-config/domains/food.v1.json');
const templatePath = path.join(root, 'packages/domain-config/templates/utopia-data-plane-template.v1.json');
const evidencePath = path.join(root, 'app/build/evidence/food-app-vibe.json');

const food = JSON.parse(fs.readFileSync(foodPath, 'utf8'));
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const issues = [];
const routes = [];

walk(food.ui?.screens ?? {}, [], (value, trail) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (typeof value.route === 'string') {
    routes.push({ path: trail.join('.'), label: value.title ?? value.label ?? value.id ?? '', route: value.route });
  }
  const payload = value.action?.payload;
  if (payload && typeof payload === 'object' && typeof payload.route === 'string') {
    routes.push({ path: `${trail.join('.')}.action.payload`, label: value.action?.label ?? value.title ?? value.id ?? '', route: payload.route });
  }
});

const allowedPrefixes = [
  '/',
  '/capture',
  '/chat',
  '/collection/',
  '/config',
  '/food',
  '/health-diagnostics',
  '/record/',
  '/search',
  '/settings',
  '/sources',
  '/system',
];

for (const item of routes) {
  if (!allowedPrefixes.some((prefix) => item.route === prefix || item.route.startsWith(prefix === '/' ? '/?' : `${prefix}?`) || item.route.startsWith(prefix))) {
    issues.push(`unsupported_route:${item.path}:${item.route}`);
  }
  if ((item.route === '/chat' || item.route === '/ask') && !item.path.startsWith('notFound.')) {
    issues.push(`unprompted_ask_route:${item.path}`);
  }
}

for (const screenId of ['home', 'overview']) {
  const components = food.ui?.screens?.[screenId]?.components ?? [];
  if (components.some((component) => component?.placement === 'top' && /add/i.test(component?.action?.label ?? component?.title ?? ''))) {
    issues.push(`global_top_add:${screenId}`);
  }
}

const foodCollections = new Set(Array.isArray(food.collections) ? food.collections : []);
const templateCollections = Object.keys(template.collection_coverage ?? {});
for (const collection of templateCollections) {
  if (!foodCollections.has(collection)) issues.push(`missing_template_collection:${collection}`);
}

const requiredFields = food.provider_template_fields?.required ?? [];
for (const field of ['id', 'title', 'collection', 'status', 'meta', 'body']) {
  if (!requiredFields.includes(field)) issues.push(`missing_provider_template_required_field:${field}`);
}
for (const aliasGroup of ['rich_detail_json', 'relations_json']) {
  if (!Array.isArray(food.provider_template_fields?.[aliasGroup]) || food.provider_template_fields[aliasGroup].length === 0) {
    issues.push(`missing_provider_template_alias_group:${aliasGroup}`);
  }
}
const recordsTable = template.sheets?.tabs?.find((tab) => tab.id === 'records' || tab.name === 'Records');
const recordsColumns = new Set(recordsTable?.columns ?? []);
for (const field of ['source_provider', 'source_external_id', 'source_url']) {
  if (!recordsColumns.has(field)) issues.push(`template_records_missing_source_column:${field}`);
}

if (issues.length) {
  console.error('Food app vibe check failed:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify({
  status: 'PASS',
  checkedAt: new Date().toISOString(),
  routeCount: routes.length,
  templateCollections: templateCollections.length,
  foodCollections: foodCollections.size,
}, null, 2)}\n`);

console.log(`Food app vibe check: PASS (${routes.length} routes, ${templateCollections.length} template collections aligned)`);

function walk(value, trail, visit) {
  visit(value, trail);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, trail.concat(index), visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, trail.concat(key), visit);
  }
}
