# Utopia 2026

Beautiful human data plane for Utopia. Import this Markdown into Notion, then create the databases below or use it as the build checklist for an API installer.

## Today

> Decision-first personal command center: today, dinner, review, use-soon, sources and quick capture.

- Today decision
- Food command center
- Use-first queue
- Review before writing
- Ask Utopia
- Connected sources
- This week

## Navigation

### Today

- Kind: dashboard
- Contains: food_command_center, review_queue, source_health, quick_capture

### Food

- Kind: domain_home
- Contains: meals, kitchen, recipes, shopping, purchases, food_memory

### Sources

- Kind: trust_center
- Contains: source_records, template_health, sync_receipts, schema_registry

### Settings

- Kind: control_plane
- Contains: providers, domains, skills, schemas, workflows, appearance

#### Meals

- Kind: workspace
- Contains: meal_plan, meal_template, meal_log, meal_consumption

#### Kitchen

- Kind: workspace
- Contains: food_item, product, inventory, inventory_lot, inventory_movement, ingredient

#### Recipes

- Kind: workspace
- Contains: recipe, recipe_revision, recipe_step, recipe_tool, nutrition_profile

#### Shopping

- Kind: workspace
- Contains: shopping_list, shopping_item, shopping_demand, store

#### Purchases

- Kind: workspace
- Contains: purchase, purchase_line, attachment

#### Household

- Kind: context
- Contains: household, member, preference, nutrition_goal, nutrition_observation

#### Schema registry

- Kind: advanced
- Contains: audit_event, source_record

## Databases

### Utopia Records

Single canonical table for import/export, app sync and external AI citations.

- Collections: *
- Required properties: Name, _ID, _Domain, _Collection, Status, Meta, Body, Food detail, Relations, Source, Source version, Archived at

### Kitchen

Pantry, product identity, lots, expiry and movement ledger.

- Collections: food_item, product, inventory, inventory_lot, inventory_movement, ingredient, purchase_line
- Views: Use first, By location, Lots, Movements, Products, Receipt-created

### Recipes

Recipes, revisions, steps, tools, substitutions and nutrition profiles.

- Collections: recipe, recipe_revision, recipe_step, recipe_tool, nutrition_profile
- Views: Recipe gallery, Current revisions, Steps, Tools, High protein, Needs ingredient

### Meals

Meal planning, meal memory, servings, portions and Health context.

- Collections: meal_template, meal_plan, meal_log, meal_consumption, nutrition_observation
- Views: This week, Tonight, Cooked, Skipped, Nutrition rollup

### Shopping

Lists, cart state, demand reasons, stores and purchase follow-through.

- Collections: shopping_list, shopping_item, shopping_demand, store, purchase_line
- Views: To buy, In cart, Demand reasons, By store, Bought

### Purchases

Receipts, line items, price memory, returns, waste and attachments.

- Collections: purchase, purchase_line, inventory_movement, attachment
- Views: Receipt review, Line prices, By merchant, Returns/waste, Unmatched

### Household

Members, preferences, goals and constraints used by Food decisions.

- Collections: household, member, preference, nutrition_goal
- Views: Members, Preferences, Goals, Constraints

### Sources and audit

Source snapshots, audit events, template health and citation registry.

- Collections: source_record, audit_event
- Views: Latest sources, Needs repair, Undo window, Template QA

## Visual identity

Use these same tokens for Notion page icons/covers, Sheets dashboard symbols, app cards and MCP/external AI clients. App settings may override these bundled defaults without rebuilding.

- 🍲 **domain.food** · accent: moss
- 🏡 **surfaces.food.overview** · accent: moss
- 🍽️ **surfaces.food.meals** · accent: amber
- 🥬 **surfaces.food.kitchen** · accent: moss
- 🛒 **surfaces.food.shopping** · accent: blue
- 🏠 **collections.household** · accent: moss
- 🙂 **collections.member** · accent: plum
- 🍎 **collections.food_item** · accent: moss
- 🏷️ **collections.product** · accent: blue
- 🧺 **collections.inventory** · accent: moss
- 📦 **collections.inventory_lot** · accent: amber
- ↻ **collections.inventory_movement** · accent: blue
- 🧄 **collections.ingredient** · accent: moss
- 📖 **collections.recipe** · accent: amber
- ✍️ **collections.recipe_revision** · accent: plum
- 🔥 **collections.recipe_step** · accent: amber
- 🍳 **collections.recipe_tool** · accent: blue
- 🧩 **collections.meal_template** · accent: plum
- 📅 **collections.meal_plan** · accent: moss
- ✅ **collections.meal_log** · accent: moss
- 🥣 **collections.meal_consumption** · accent: amber
- 📝 **collections.shopping_list** · accent: blue
- 🛒 **collections.shopping_item** · accent: blue
- ❗ **collections.shopping_demand** · accent: amber
- 🧾 **collections.purchase** · accent: plum
- 💳 **collections.purchase_line** · accent: plum
- 🏪 **collections.store** · accent: blue
- ♡ **collections.preference** · accent: plum
- 🎯 **collections.nutrition_goal** · accent: moss
- ⚖️ **collections.nutrition_profile** · accent: moss
- 📈 **collections.nutrition_observation** · accent: blue
- 📎 **collections.attachment** · accent: neutral
- 🧭 **collections.audit_event** · accent: neutral
- 🔗 **collections.source_record** · accent: neutral
- 📅 **statuses.planned** · accent: plum
- 🌙 **statuses.tonight** · accent: moss
- 🛒 **statuses.to buy** · accent: blue
- ⏳ **statuses.use soon** · accent: amber
- ✅ **statuses.available** · accent: moss
- 👀 **statuses.review** · accent: amber
- ⌂ **actions.home** · accent: moss
- ＋ **actions.add_record** · accent: moss
- ＋ **actions.capture** · accent: moss
- ✦ **actions.ask_with_collection** · accent: plum
- ✦ **actions.chat** · accent: plum
- ⌕ **actions.search** · accent: blue
- 🔗 **actions.open_sources** · accent: neutral
- ⚙ **actions.settings** · accent: neutral
- ＋ **actions.add_domain** · accent: plum
- 👀 **actions.review** · accent: amber
- ↻ **actions.refresh** · accent: blue
- ✎ **actions.capture_note** · accent: neutral
- 🍲 **actions.capture_food** · accent: moss
- ▧ **actions.capture_photo** · accent: blue
- 🧾 **actions.capture_receipt** · accent: plum
- ◖ **actions.capture_voice** · accent: amber
- ⌁ **actions.capture_link** · accent: blue
- ◨ **sources.notion** · accent: neutral
- ▦ **sources.google_sheets** · accent: moss
- ▣ **sources.sqlite** · accent: blue
- ⬢ **sources.postgres** · accent: plum
- 🌐 **sources.web** · accent: blue
- 🙂 **sources.user** · accent: moss
- 🍲 **skills.food** · accent: moss
- ↻ **skills.weekly_food_reset** · accent: amber
- 🔎 **skills.source_verifier** · accent: blue
- ✦ **agents.food_brain** · accent: plum
- 🔗 **agents.source_steward** · accent: blue
- ↻ **agents.weekly_reset** · accent: amber

## Relation views

- Recipe uses ingredient and food item
- Meal plan plans recipe and creates shopping demand
- Shopping demand explains shopping item
- Purchase line fulfills shopping item and creates inventory lot
- Inventory movement moves lot and can be caused by meal log
- Nutrition observation describes meal log using nutrition profile
- Source record supports every citable record

## Buttons

- **Plan dinner from pantry** on Food: Create meal plan draft from use-first kitchen items
- **Add receipt** on Purchases: Create purchase, purchase lines, unmatched review rows and lot candidates
- **Log cooked** on Meal page: Create meal log and inventory movement candidates
- **Build shopping list** on Shopping: Create shopping demands from planned meals and missing ingredients

## Template health

- Confirm all databases include stable `_ID` / `id` fields.
- Confirm source snapshot fields exist before enabling sync.
- Confirm Notion buttons do not hide required review steps.
- Confirm `@now` style dates remain dynamic after duplication.
