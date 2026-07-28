import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson('packages/domain-config/domains/food.v1.json');
const detail = readJson('packages/domain-config/schemas/food-detail.v1.schema.json');

const requiredCollections = [
  'household',
  'member',
  'food_item',
  'product',
  'inventory_lot',
  'inventory_movement',
  'recipe_revision',
  'recipe_step',
  'meal_consumption',
  'shopping_list',
  'shopping_demand',
  'purchase',
  'purchase_line',
  'nutrition_goal',
  'nutrition_profile',
  'audit_event',
  'source_record',
];

const requiredDetailProperties = [
  'identity',
  'products',
  'lots',
  'movements',
  'recipe',
  'meal',
  'shopping',
  'purchase',
  'nutrition_profile',
  'provenance',
  'audit',
];

const requiredRelations = [
  'packages',
  'stores',
  'moves',
  'matches_food',
  'has_revision',
  'has_step',
  'creates_lot',
  'explains',
  'records_change',
];

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

for (const collection of requiredCollections) {
  if (!manifest.collections.includes(collection)) fail(`Food manifest missing collection: ${collection}`);
}

for (const property of requiredDetailProperties) {
  if (!detail.properties[property]) fail(`Food detail schema missing property: ${property}`);
}

for (const relationName of requiredRelations) {
  if (!manifest.relations.some((relation) => relation.name === relationName)) {
    fail(`Food manifest missing relation: ${relationName}`);
  }
}

if (manifest.collections.length < 29) fail(`Expected at least 29 Food collections, found ${manifest.collections.length}`);
if (!detail.$defs?.quantity || !detail.$defs?.money || !detail.$defs?.provenance) {
  fail('Food detail schema must retain quantity, money and provenance value objects.');
}

console.log(`Food schema depth valid: ${manifest.collections.length} collections, ${Object.keys(detail.properties).length} rich detail sections.`);
