import { describe, expect, it } from 'vitest';

import {
  activateAppPackage,
  activateApprovedAppPackageChange,
  bootstrapAppPackageRegistry,
  getActiveAppPackage,
  previewAppPackageChange,
  rollbackAppPackage,
  type AppPackageChangeRequest,
} from '@/src/db/app-package-registry';
import { buildAppPackageFromManifest } from '@/src/domain/app-package-bridge';
import { loadCatalog, setActivePackageOverride } from '@/src/domain/catalog';
import { buildSafePackageChangeRequest } from '@/src/domain/package-change-templates';
import { MemoryDb } from '@/tests/helpers/memory-db';
import type { AppPackage } from '@/packages/shared/contracts/package';

describe('app package SQLite registry', () => {
  it('bootstraps once, persists activation across reopen, and rolls back', async () => {
    setActivePackageOverride(null);
    const db = new MemoryDb() as any;
    const bootstrapped = await bootstrapAppPackageRegistry(db);

    expect(bootstrapped.id).toBe('food');
    expect(db.appPackages.size).toBe(1);
    expect(db.appPackageReceipts.map((row: any) => row.action)).toEqual(['bootstrap']);

    await bootstrapAppPackageRegistry(db);
    expect(db.appPackageReceipts.map((row: any) => row.action)).toEqual(['bootstrap']);

    const basePresentation = bootstrapped.presentation;
    expect(basePresentation).toBeDefined();
    const nextPackage: AppPackage = {
      ...bootstrapped,
      id: 'runtime-food',
      version: '2.0.0',
      presentation: {
        ...basePresentation!,
        label: 'Runtime Food',
        surfaces: basePresentation!.surfaces,
      },
    };

    await activateAppPackage(db, nextPackage, 'activate', {
      requestHash: 'sha256:request',
      packageHash: 'sha256:package',
      approvalHash: 'sha256:approval',
      approvedBy: 'test-user',
    });
    const reopened = reopen(db) as any;
    const active = await getActiveAppPackage(reopened);
    expect(active?.id).toBe('runtime-food');

    await bootstrapAppPackageRegistry(reopened);
    expect(loadCatalog().activeManifest.label).toBe('Runtime Food');

    const rolledBack = await rollbackAppPackage(reopened);
    expect(rolledBack?.id).toBe('food');
    expect(loadCatalog().activeManifest.id).toBe('food');
    expect(reopened.appPackageReceipts.map((row: any) => row.action)).toEqual(['bootstrap', 'activate', 'rollback']);
    expect(reopened.appPackageReceipts[1]).toMatchObject({
      request_hash: 'sha256:request',
      package_hash: 'sha256:package',
      approval_hash: 'sha256:approval',
      approved_by: 'test-user',
    });
  });

  it('fails closed for invalid package payloads', async () => {
    const db = new MemoryDb() as any;
    await expect(activateAppPackage(db, { schemaVersion: 'wonder.app-package.v2' } as any)).rejects.toThrow(/app_package_invalid/);
    expect(db.appPackageState).toBeNull();
  });

  it('does not silently bootstrap when installed packages exist without active state', async () => {
    const db = new MemoryDb() as any;
    const pkg = buildAppPackageFromManifest(loadCatalog().activeManifest).package;
    db.appPackages.set('food@1.0.0', {
      package_key: 'food@1.0.0',
      package_id: pkg.id,
      version: pkg.version,
      payload_json: JSON.stringify(pkg),
      created_at: '2026-07-24T00:00:00.000Z',
      updated_at: '2026-07-24T00:00:00.000Z',
    });

    await expect(bootstrapAppPackageRegistry(db)).rejects.toThrow(/app_package_active_missing/);
    expect(db.appPackageReceipts).toEqual([]);
  });

  it('uses bridged package presentation as catalog authority', async () => {
    const db = new MemoryDb() as any;
    const manifest = loadCatalog().activeManifest;
    const pkg = buildAppPackageFromManifest(manifest, { version: 'presentation-test' }).package;
    const activePackage: AppPackage = {
      ...pkg,
      id: 'chef-lab',
      presentation: {
        ...pkg.presentation!,
        label: 'Chef Lab',
      },
    };
    await activateAppPackage(db, activePackage);

    const catalog = loadCatalog();
    expect(catalog.activeDomainId).toBe('chef-lab');
    expect(catalog.activeManifest.label).toBe('Chef Lab');
    expect(catalog.activeManifest.surfaces.length).toBeGreaterThan(0);
  });

  it('previews and applies hash-bound package diffs through durable approval receipts', async () => {
    setActivePackageOverride(null);
    const db = new MemoryDb() as any;
    const bootstrapped = await bootstrapAppPackageRegistry(db);
    const request: AppPackageChangeRequest = {
      basePackageKey: `${bootstrapped.id}@${bootstrapped.version}`,
      requestedBy: 'test-package-editor',
      patch: [
        { op: 'replace', path: '/version', value: `${bootstrapped.version}+ai.test` },
        {
          op: 'add',
          path: '/collections/ai_notes',
          value: {
            id: 'ai_notes',
            fields: {
              id: { type: 'text', required: true, indexed: true },
              title: { type: 'text', required: true, indexed: true },
              body: { type: 'text' },
              updated_at: { type: 'timestamp', indexed: true },
            },
          },
        },
        { op: 'add', path: '/queries/ai_notes', value: { from: 'ai_notes', limit: 12 } },
        { op: 'add', path: '/views/ai_notes', value: { id: 'ai_notes', query: 'ai_notes', mode: 'list', fields: ['title', 'body'] } },
        { op: 'add', path: '/presentation/surfaces/-', value: { id: 'ai_notes', label: 'AI Notes', collections: ['ai_notes'], views: ['ai_notes'] } },
      ],
    };

    const preview = await previewAppPackageChange(db, request);
    expect(preview.status).toBe('valid');
    expect(preview.requestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(preview.packageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(preview.package?.collections.ai_notes.id).toBe('ai_notes');

    await expect(activateApprovedAppPackageChange(db, request, {
      schemaVersion: 'wonder.package-change-approval.v1',
      approved: true,
      requestHash: preview.requestHash,
      packageHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      approvedBy: 'tester',
      approvedAt: '2026-07-27T00:00:00.000Z',
    })).rejects.toThrow(/package_change_approval_mismatch/);

    const applied = await activateApprovedAppPackageChange(db, request, {
      schemaVersion: 'wonder.package-change-approval.v1',
      approved: true,
      requestHash: preview.requestHash,
      packageHash: preview.packageHash!,
      approvedBy: 'tester',
      approvedAt: '2026-07-27T00:00:00.000Z',
    });

    expect(applied.collections.ai_notes.id).toBe('ai_notes');
    expect(db.appPackageReceipts.at(-1)).toMatchObject({
      action: 'activate',
      request_hash: preview.requestHash,
      package_hash: preview.packageHash,
      approved_by: 'tester',
    });
  });

  it('blocks package diffs that try to change native dependency pins', async () => {
    setActivePackageOverride(null);
    const db = new MemoryDb() as any;
    await bootstrapAppPackageRegistry(db);

    await expect(previewAppPackageChange(db, {
      patch: [{ op: 'add', path: '/dependencyPins/-', value: { package: 'unsafe-native-package', version: '*' } }],
      requestedBy: 'test-package-editor',
    })).rejects.toThrow(/package_change_path_forbidden/);
  });

  it('fails closed when native capability lock content is forged', async () => {
    const db = new MemoryDb() as any;
    const pkg = buildAppPackageFromManifest(loadCatalog().activeManifest, { version: 'forged-native-lock' }).package;
    if (pkg.schemaVersion !== 'wonder.app-package.v3') throw new Error('expected V3 package');

    await expect(activateAppPackage(db, {
      ...pkg,
      nativeCapabilities: {
        ...pkg.nativeCapabilities,
        permissions: [
          ...(pkg.nativeCapabilities.permissions ?? []),
          {
            id: 'forged-camera',
            platform: 'android',
            permission: 'android.permission.CAMERA',
            reason: 'Forged runtime permission.',
            required: true,
          },
        ],
      },
    })).rejects.toThrow(/contractLock.nativeCapabilities must match nativeCapabilities/);

    await expect(activateAppPackage(db, {
      ...pkg,
      contractLock: {
        ...pkg.contractLock,
        checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    })).rejects.toThrow(/contractLock.checksum mismatch/);
  });

  it('builds safe package-edit templates for table, theme, workflow, and rich widget prompts', async () => {
    setActivePackageOverride(null);
    const db = new MemoryDb() as any;
    const active = await bootstrapAppPackageRegistry(db);

    const table = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add freezer ideas table'));
    expect(table.status).toBe('valid');
    expect(table.package?.collections.ai_freezer_ideas.id).toBe('ai_freezer_ideas');
    expect(table.package?.presentation?.ui?.screens?.ai_freezer_ideas.title).toBe('Freezer Ideas');

    const theme = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'make theme cuter cards'));
    expect(theme.status).toBe('valid');
    expect(theme.package?.presentation?.visualIdentity?.density).toBe('compact-cute');
    expect(theme.package?.presentation?.ui?.screens?.ai_cuter_cards_theme.components?.[0]).toMatchObject({
      widget: 'themePreview',
      id: 'ai_cuter_cards_theme_preview',
      title: 'Cuter Cards theme',
    });

    const workflow = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'when pantry expires suggest dinner'));
    expect(workflow.status).toBe('valid');
    expect(workflow.package?.rules.some((rule) => rule.id === 'ai_pantry_expires_dinner_workflow_rule')).toBe(true);
    expect(workflow.package?.rules.find((rule) => rule.id === 'ai_pantry_expires_dinner_workflow_rule')).toMatchObject({
      trigger: { kind: 'query_transition', query: 'expiring_inventory', transition: 'enter' },
      effect: { kind: 'propose_operation', operation: { kind: 'custom', tool: 'food.dinner.suggest' } },
      mode: 'suggest',
      maxRunsPerEvent: 1,
    });

    const field = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add spice level number field to recipe'));
    expect(field.status).toBe('valid');
    expect(field.package?.collections.recipe.fields.spice_level.type).toBe('number');
    expect(Object.values(field.package?.views ?? {}).some((view) => view.fields.includes('spice_level'))).toBe(true);
    expect(field.package?.presentation?.ui?.screens?.ai_recipe_spice_level_schema.components?.[0].widget).toBe('schemaEditor');

    const recipeBoardView = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'show recipe board view'));
    expect(recipeBoardView.status).toBe('valid');
    expect(recipeBoardView.package?.collections.ai_recipe).toBeUndefined();
    expect(recipeBoardView.package?.queries.ai_recipe_recipe_board_query).toMatchObject({
      from: 'records',
      where: { op: 'eq', field: 'collection', value: 'recipe' },
      limit: 24,
    });
    expect(recipeBoardView.package?.views.ai_recipe_recipe_board_view).toMatchObject({
      id: 'ai_recipe_recipe_board_view',
      query: 'ai_recipe_recipe_board_query',
      mode: 'board',
    });
    expect(recipeBoardView.package?.presentation?.ui?.screens?.ai_recipe_recipe_board_screen.components?.[0].widget).toBe('kanbanBoard');

    const overviewEdit = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'make overview smaller less dense'));
    expect(overviewEdit.status).toBe('valid');
    expect(overviewEdit.package?.collections.ai_overview).toBeUndefined();
    expect(overviewEdit.package?.presentation?.ui?.screens?.overview.subtitle).toContain('Compact by default');
    expect(overviewEdit.package?.presentation?.ui?.screens?.overview.components?.length).toBeLessThanOrEqual(5);
    expect(overviewEdit.package?.presentation?.ui?.screens?.overview.components?.[0].props).toMatchObject({
      density: 'compact',
      summaryFirst: true,
    });

    const movedWidget = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'move dinner vote first on overview'));
    expect(movedWidget.status).toBe('valid');
    expect(movedWidget.package?.collections.ai_dinner_vote).toBeUndefined();
    expect(movedWidget.package?.presentation?.ui?.screens?.overview.components?.[0].id).toBe('dinner_vote');
    expect(movedWidget.package?.presentation?.ui?.screens?.overview.components?.length)
      .toBe(active.presentation?.ui?.screens?.overview.components?.length);

    const renamedWidget = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'rename dinner vote to "Family vote"'));
    expect(renamedWidget.status).toBe('valid');
    const dinnerVote = renamedWidget.package?.presentation?.ui?.screens?.overview.components?.find((component) => component.id === 'dinner_vote');
    expect(dinnerVote?.title).toBe('Family vote');

    const controlRoom = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add settings control room'));
    expect(controlRoom.status).toBe('valid');
    expect(controlRoom.package?.collections.ai_settings_control).toBeUndefined();
    expect(controlRoom.package?.presentation?.surfaces.some((surface) => surface.id === 'ai_control_room')).toBe(true);
    const controlWidgets = controlRoom.package?.presentation?.ui?.screens?.ai_control_room.components?.map((component) => component.widget ?? component.id);
    expect(controlWidgets).toEqual(expect.arrayContaining([
      'assistantChat',
      'providerStatus',
      'control_connect_source',
      'control_verify_sync',
      'widgetCatalog',
      'schemaEditor',
      'permissionCard',
      'themePreview',
    ]));
    const widgetCatalog = controlRoom.package?.presentation?.ui?.screens?.ai_control_room.components?.find((component) => component.id === 'control_widget_catalog');
    expect(widgetCatalog?.props?.widgets).toEqual(expect.arrayContaining([
      'assistantChat',
      'healthConnect',
      'schemaEditor',
      'widgetCatalog',
      'postCard',
      'pollCard',
      'checklistCard',
      'linkPreview',
      'feedList',
      'kanbanBoard',
      'chartBlock',
      'mediaBlock',
      'mapBlock',
      'formCard',
      'calendarBlock',
      'timelineBlock',
      'galleryGrid',
      'dataTable',
      'permissionCard',
      'providerStatus',
      'themePreview',
    ]));

    const form = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add vendor intake form'));
    expect(form.status).toBe('valid');
    expect(form.package?.collections.ai_vendor_intake.fields.answers.type).toBe('json');
    expect(form.package?.presentation?.ui?.screens?.ai_vendor_intake.components?.[0].widget).toBe('formCard');

    const board = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'create catering kanban board'));
    expect(board.status).toBe('valid');
    expect(board.package?.views.ai_catering.mode).toBe('board');
    expect(board.package?.presentation?.ui?.screens?.ai_catering.components?.[0].widget).toBe('kanbanBoard');

    const poll = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add family dinner poll'));
    expect(poll.status).toBe('valid');
    expect(poll.package?.collections.ai_family_dinner.fields.options.type).toBe('json');
    expect(poll.package?.presentation?.ui?.screens?.ai_family_dinner.components?.[0].widget).toBe('pollCard');

    const checklist = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add catering checklist'));
    expect(checklist.status).toBe('valid');
    expect(checklist.package?.collections.ai_catering.fields.items.type).toBe('json');
    expect(checklist.package?.presentation?.ui?.screens?.ai_catering.components?.[0].widget).toBe('checklistCard');

    const calendar = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'create meal prep calendar'));
    expect(calendar.status).toBe('valid');
    expect(calendar.package?.views.ai_meal_prep.mode).toBe('calendar');
    expect(calendar.package?.presentation?.ui?.screens?.ai_meal_prep.components?.[0].widget).toBe('calendarBlock');

    const media = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add youtube recipe video page'));
    expect(media.status).toBe('valid');
    expect(media.package?.collections.ai_recipe.fields.media.type).toBe('json');
    expect(media.package?.presentation?.ui?.screens?.ai_recipe.components?.[0].widget).toBe('mediaBlock');

    const link = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add recipe bookmark link preview'));
    expect(link.status).toBe('valid');
    expect(link.package?.collections.ai_recipe.fields.preview.type).toBe('json');
    expect(link.package?.presentation?.ui?.screens?.ai_recipe.components?.[0].widget).toBe('linkPreview');

    const map = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'create grocery store map'));
    expect(map.status).toBe('valid');
    expect(map.package?.collections.ai_grocery_store.fields.location.type).toBe('json');
    expect(map.package?.presentation?.ui?.screens?.ai_grocery_store.components?.[0].widget).toBe('mapBlock');

    const chart = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add spending analytics chart'));
    expect(chart.status).toBe('valid');
    expect(chart.package?.views.ai_spending.mode).toBe('chart');
    expect(chart.package?.presentation?.ui?.screens?.ai_spending.components?.[0].widget).toBe('chartBlock');

    expect(() => buildSafePackageChangeRequest(active, 'add camera permission and voice shortcut')).toThrow(/native_capability_unsupported/);

    const native = await previewAppPackageChange(db, buildSafePackageChangeRequest(active, 'add camera permission and share intent'));
    expect(native.status).toBe('valid');
    if (native.package?.schemaVersion !== 'wonder.app-package.v3') throw new Error('expected V3 package');
    expect(native.package.nativeCapabilities.permissions?.some((permission) => (
      typeof permission !== 'string' && permission.id === 'camera-capture'
    ))).toBe(true);
    expect(native.package.nativeCapabilities.intents?.some((intent) => intent.id === 'receive-shared-content')).toBe(true);
    expect(native.package.contractLock.nativeCapabilities).toEqual(native.package.nativeCapabilities);
    expect(native.package.presentation?.ui?.screens?.ai_camera_share_permissions.components?.[0].widget).toBe('permissionCard');
    expect(native.package.presentation?.ui?.screens?.ai_camera_share_permissions.components?.some((component) => component.id === 'ai_camera_share_open_permissions')).toBe(true);
    expect(native.package.presentation?.ui?.screens?.ai_camera_share_permissions.components?.some((component) => component.id === 'ai_camera_share_test_intents')).toBe(true);
  });
});

function reopen(source: MemoryDb): MemoryDb {
  const db = new MemoryDb();
  db.appPackages = new Map(source.appPackages);
  db.appPackageState = source.appPackageState ? { ...source.appPackageState } : null;
  db.appPackageReceipts = source.appPackageReceipts.map((row) => ({ ...row }));
  return db;
}
