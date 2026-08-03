# Widget Generalization Audit

Scope: `src/presentation/json-render-widgets.tsx` against `packages/shared/contracts/ui-widgets.ts`, with surface routing from `src/presentation/json-render-surface.tsx`.

## Evidence

- Widget contract list: `packages/shared/contracts/ui-widgets.ts:1-42`
- Widget registry and component bodies: `src/presentation/json-render-widgets.tsx:283-2059`
- Surface-side standard widget split and registry mapping: `src/presentation/json-render-surface.tsx:355-820`

## Current Shape

- Contract has 32 widget kinds.
- `json-render-surface.tsx` already treats 12 widgets as standard display widgets inline:
  - `widgetCatalog`
  - `postCard`
  - `linkPreview`
  - `feedList`
  - `chartBlock`
  - `mediaBlock`
  - `mapBlock`
  - `calendarBlock`
  - `timelineBlock`
  - `galleryGrid`
  - `dataTable`
  - `themePreview`
- The remaining 19 widgets are rendered by dedicated React components in `JSON_RENDER_WIDGET_REGISTRY`.

## Widget Families

### 1. Display / content cards

- `widgetCatalog`
- `postCard`
- `linkPreview`
- `feedList`
- `chartBlock`
- `mediaBlock`
- `mapBlock`
- `calendarBlock`
- `timelineBlock`
- `galleryGrid`
- `dataTable`
- `themePreview`

These are already the best candidates for a shared renderer layer. Most are pure prop-to-UI transforms with no device or DB writes.

### 2. Assistant / control plane

- `assistantChat`
- `healthConnect`
- `schemaEditor`
- `permissionCard`
- `providerStatus`
- `themeDensitySelector`
- `aiProviderSettings`
- `dataHomeSettings`

These are mostly app-control widgets. They differ by side effects, but the shell, status, and action patterns repeat a lot.

### 3. Food domain surface

- `askFoodBar`

This is the remaining assistant-specific surface. Record presentation primitives are now shared and proven outside Food.

### 4. Record / workflow widgets

- `smartCapture`
- `formCard`
- `checklistCard`
- `pollCard`
- `kanbanBoard`
- `SearchableRecordListWidget`
- `RecordDetailWidget`

These are reusable in shape, but still coupled to Utopia record semantics and local database state.

### 5. Navigation chrome

- `ScreenHeaderWidget`
- `FloatingActionWidget`
- `WidgetShell`
- `MarkdownText`

These are shared primitives, not domain widgets. They should be extracted before any widget-specific split.

## Domain-Specific Widgets To Generalize First

Highest value first:

1. `foodHero`
1. `useFirstCarousel`
1. `askFoodBar`
1. `smartCapture`
1. `assistantChat`
1. `schemaEditor`
1. `dataHomeSettings`
1. `aiProviderSettings`
1. `providerStatus`
1. `healthConnect`

Why these first:

- They carry the most brand copy and domain vocabulary.
- They mix UI, routing, DB, native, and sync concerns.
- They block extraction of a stable generic widget package.

## Side-Effect Hooks

### React hooks that trigger side effects

- `Bubble`
  - `useCallback` for save and undo flows.
  - `useMemo` for markdown parsing and link extraction.
- `AssistantChatWidget`
  - `useEffect` for initial prompt and auto-submit.
  - `useEffect` for keyboard height on full-page chat.
  - `useCallback` around `sendChatMessage`.
- `HealthConnectWidget`
  - `useEffect` for initial status refresh.
  - `useCallback` around permission/status calls.
- `ThemeDensitySelectorWidget`
  - `useCallback` around settings save.
- `AiProviderProfileEditor`
  - `useEffect` to resync form state from props.
  - `useCallback` around provider save.
- `DataHomeEditor`
  - `useEffect` to resync source settings.
  - `useCallback` around provider save.
- `DataHomeSettingsWidget`
  - `useCallback` around source sync.
- `SchemaEditorWidget`
  - `useCallback` around preview and apply.
- `SmartCaptureWidget`
  - `useCallback` for camera/library pick, preview, save, and mode reset.
- `RecordDetailWidget`
  - `useEffect` to reload form state when record changes.
  - `useCallback` for save and undo.
- `SearchableRecordListWidget`
  - `useMemo` for collections and filtering.

### Non-React side effects

- Chat:
  - `sendChatMessage`
  - `undoChatAction`
  - `resolveChatServerConfig`
- Health:
  - `getUtopiaHealthStatus`
  - `requestUtopiaHealthPermissions`
  - `openUtopiaHealthSettings`
- Settings:
  - `saveUtopiaRuntimePreferences`
  - `saveUtopiaAiProviderProfile`
  - `saveUtopiaSourceProviderSettings`
  - `useUtopiaSettingsSnapshot`
- Sync and package control:
  - `syncConfiguredSources`
  - `getActiveAppPackage`
  - `previewAppPackageChange`
  - `activateApprovedAppPackageChange`
- Records:
  - `getRecord`
  - `upsertRecord`
  - `undoOperation`
- Native capture:
  - `ImagePicker`
  - `FileSystem`
- Navigation / browser:
  - `useRouter`
  - `Linking`
  - `Keyboard`
  - `Dimensions`

## Suggested Split Order

### Phase 1

- Extract shared helpers and chrome:
  - `WidgetShell`
  - `MarkdownText`
  - text/list/label/detail helpers
  - route helpers
  - permission helpers
  - `shortHash`
- Keep behavior unchanged.

### Phase 2

- Move the 12 standard display widgets out of the current registry file.
- Put them in a generic display module or surface-local widget package.
- Goal: `json-render-widgets.tsx` stops owning pure prop-to-UI cards.

### Phase 3

- Split control-plane widgets into a separate module:
  - `assistantChat`
  - `healthConnect`
  - `schemaEditor`
  - `permissionCard`
  - `providerStatus`
  - `themeDensitySelector`
  - `aiProviderSettings`
  - `dataHomeSettings`
- This is the highest side-effect density and the cleanest boundary.

### Phase 4

- Split food widgets into their own family module:
  - `askFoodBar`
  - `smartCapture`
- This removes the most domain-branded copy from the shared renderer.

### Phase 5

- Split record/workflow widgets:
  - `SearchableRecordListWidget`
  - `RecordDetailWidget`
  - `formCard`
  - `checklistCard`
  - `pollCard`
  - `kanbanBoard`
- These can become a reusable "records and workflows" package after the core primitives exist.

## Risks

- `assistantChat` is not just UI; it owns optimistic send, keyboard handling, and undo plumbing.
- `smartCapture` is tied to native picker and file persistence.
- `RecordDetailWidget` and `SearchableRecordListWidget` depend on the current local record model and routing conventions.
- `dataHomeSettings` and `aiProviderSettings` are generic-looking but still coupled to Utopia-specific settings storage.
- If the split happens before the helper layer is extracted, the same prop normalization and route logic will get duplicated.

## Bottom Line

- Best immediate generalization target: the 12 standard display widgets.
- Next best target: shared chrome/helpers.
- Highest-risk domain code: chat, capture, sync, and record mutation.
- Best long-term split: display widgets, control-plane widgets, food widgets, then record/workflow widgets.
