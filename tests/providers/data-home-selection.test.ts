import { describe, expect, it } from 'vitest';

import {
  createDataHomeAdapterRegistry,
  DATA_HOME_COPY,
  DEFAULT_DATA_HOME_ADAPTER_ID,
  previewDataHomeSwitch,
  resolveDataHomeSelectionContract,
  resolveDataHomeSelection,
  SUPPORTED_DATA_HOME_ADAPTER_IDS,
} from '@/src/providers/data-home-selection';

describe('data home selection', () => {
  it('defaults to local sqlite when no runtime selection is stored', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync', 'import', 'export'],
      },
    ]);

    const selection = resolveDataHomeSelection({
      installationId: 'app-a',
      declaredAdapterIds: ['notion'],
      registry,
    });

    expect(selection).toMatchObject({
      schemaVersion: 'utopia.data-home-selection.v1',
      installationId: 'app-a',
      requestedAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
      effectiveAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
      fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
      status: 'ready',
      readiness: 'ready',
      kind: 'local',
      declared: true,
      supported: true,
      reason: 'default_local_sqlite',
    });
    expect(selection.capabilities).toContain('local');
    expect(SUPPORTED_DATA_HOME_ADAPTER_IDS).toEqual(['sqlite', 'notion', 'google_sheets']);
  });

  it('builds a data-home availability contract for sqlite/notion/google sheets', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
      {
        id: 'google_sheets',
        kind: 'remote',
        readiness: 'requires_auth',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);
    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-a',
      declaredAdapterIds: ['notion'],
      registry,
    });

    const sqlite = contract.options.find((option) => option.adapterId === 'sqlite');
    const notion = contract.options.find((option) => option.adapterId === 'notion');
    const sheets = contract.options.find((option) => option.adapterId === 'google_sheets');

    expect(sqlite).toEqual({
      adapterId: 'sqlite',
      label: 'Local SQLite',
      availability: 'available',
      canSelect: true,
      declared: true,
      readiness: 'ready',
      reason: 'Local SQLite is available.',
    });
    expect(notion).toMatchObject({ availability: 'available', canSelect: true, declared: true, readiness: 'ready' });
    expect(sheets).toMatchObject({ availability: 'unconfigured', canSelect: false, declared: false, readiness: 'requires_auth' });
    expect(sheets?.reason).toContain('not configured');
  });

  it('only exposes selectable rows for declared and ready adapters', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'requires_auth',
        capabilities: ['read', 'write', 'sync'],
      },
      {
        id: 'google_sheets',
        kind: 'remote',
        readiness: 'offline',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);
    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-a',
      declaredAdapterIds: ['notion', 'google_sheets'],
      registry,
    });

    const notion = contract.options.find((option) => option.adapterId === 'notion');
    const sheets = contract.options.find((option) => option.adapterId === 'google_sheets');

    expect(notion).toMatchObject({
      availability: 'not_ready',
      canSelect: false,
      declared: true,
      readiness: 'requires_auth',
      reason: 'Notion needs sign-in before use.',
    });
    expect(sheets).toMatchObject({
      availability: 'not_ready',
      canSelect: false,
      declared: true,
      readiness: 'offline',
      reason: 'Google Sheets is currently offline.',
    });
  });

  it('only allows remote adapters that are both declared and ready', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
      {
        id: 'google_sheets',
        kind: 'remote',
        readiness: 'requires_auth',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);

    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-a',
      declaredAdapterIds: ['notion', 'google_sheets'],
      registry,
    });

    const notion = contract.options.find((option) => option.adapterId === 'notion');
    const sheets = contract.options.find((option) => option.adapterId === 'google_sheets');
    expect(notion).toMatchObject({
      availability: 'available',
      canSelect: true,
      declared: true,
      readiness: 'ready',
      reason: 'Notion is available.',
    });
    expect(sheets).toMatchObject({
      availability: 'not_ready',
      canSelect: false,
      declared: true,
      readiness: 'requires_auth',
      reason: 'Google Sheets needs sign-in before use.',
    });

    const notionSelection = resolveDataHomeSelection({
      installationId: 'app-a',
      declaredAdapterIds: ['notion', 'google_sheets'],
      selection: {
        installationId: 'app-a',
        adapterId: 'notion',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });
    expect(notionSelection).toMatchObject({
      status: 'ready',
      effectiveAdapterId: 'notion',
      reason: 'adapter_ready',
    });

    const sheetsSelection = resolveDataHomeSelection({
      installationId: 'app-a',
      declaredAdapterIds: ['notion', 'google_sheets'],
      selection: {
        installationId: 'app-a',
        adapterId: 'google_sheets',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });
    expect(sheetsSelection).toMatchObject({
      status: 'blocked',
      requestedAdapterId: 'google_sheets',
      effectiveAdapterId: null,
      readiness: 'requires_auth',
      declared: true,
      supported: true,
      reason: 'adapter_requires_auth:google_sheets',
    });
  });

  it('keeps disabled data-home options visible with explicit reasons', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
      {
        id: 'google_sheets',
        kind: 'remote',
        readiness: 'offline',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);

    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-a',
      declaredAdapterIds: ['notion'],
      registry,
    });

    const disabledOptions = contract.options.filter((option) => !option.canSelect);
    expect(disabledOptions.length).toBeGreaterThan(0);
    expect(disabledOptions.every((option) => option.reason.length > 0)).toBe(true);
  });

  it('requires declared and ready for a selectable remote adapter', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'requires_auth',
        capabilities: ['read', 'write', 'sync'],
      },
      {
        id: 'google_sheets',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);
    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-a',
      declaredAdapterIds: ['google_sheets'],
      registry,
    });

    const notion = contract.options.find((option) => option.adapterId === 'notion');
    const sheets = contract.options.find((option) => option.adapterId === 'google_sheets');
    expect(notion).toMatchObject({ canSelect: false, declared: false, availability: 'unconfigured' });
    expect(sheets).toMatchObject({ canSelect: true, declared: true, availability: 'available' });
  });

  it('keeps data-home migration text source-neutral without live-provider proof language', () => {
    const proofLanguage = /live|proof|verified|connected proof/i;
    expect(DATA_HOME_COPY.localDefaultHint).toMatch(/manual export, import/);
    expect(DATA_HOME_COPY.remoteMigrationHint).toMatch(/manual export, import/);
    expect(DATA_HOME_COPY.previewRemoteMigrationHint).toMatch(/manual export, import/);
    expect(DATA_HOME_COPY.localDefaultHint).not.toMatch(proofLanguage);
    expect(DATA_HOME_COPY.remoteMigrationHint).not.toMatch(proofLanguage);
    expect(DATA_HOME_COPY.previewRemoteMigrationHint).not.toMatch(proofLanguage);
  });

  it('marks declared adapters as unsupported when runtime does not register them', () => {
    const registry = createDataHomeAdapterRegistry([]);
    const contract = resolveDataHomeSelectionContract({
      installationId: 'app-b',
      declaredAdapterIds: ['notion'],
      registry,
    });
    const notion = contract.options.find((option) => option.adapterId === 'notion');

    expect(notion).toMatchObject({
      adapterId: 'notion',
      availability: 'unsupported',
      canSelect: false,
      declared: true,
      readiness: 'unsupported',
    });
    expect(notion?.reason).toContain('not supported');
  });

  it('fails closed for unknown adapters and keeps the fallback explicit', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync', 'import', 'export'],
      },
    ]);

    const selection = resolveDataHomeSelection({
      installationId: 'app-a',
      declaredAdapterIds: ['notion'],
      selection: {
        installationId: 'app-a',
        adapterId: 'oracle',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(selection).toMatchObject({
      status: 'blocked',
      requestedAdapterId: 'oracle',
      effectiveAdapterId: null,
      fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
      declared: false,
      supported: false,
      readiness: 'blocked',
      reason: 'unknown_adapter:oracle',
    });
    expect(selection.capabilities).toEqual([]);
  });

  it('fails closed when a declared adapter is not ready', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'requires_auth',
        capabilities: ['read', 'write'],
      },
    ]);

    const selection = resolveDataHomeSelection({
      installationId: 'app-b',
      declaredAdapterIds: ['notion'],
      selection: {
        installationId: 'app-b',
        adapterId: 'notion',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(selection).toMatchObject({
      status: 'blocked',
      requestedAdapterId: 'notion',
      effectiveAdapterId: null,
      fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
      declared: true,
      supported: true,
      readiness: 'requires_auth',
      reason: 'adapter_requires_auth:notion',
    });
    expect(selection).toHaveProperty('reason', 'adapter_requires_auth:notion');
  });

  it('accepts injected future adapters without schema changes', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'airtable',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);

    const selection = resolveDataHomeSelection({
      installationId: 'app-a',
      declaredAdapterIds: ['sqlite', 'airtable'],
      selection: {
        installationId: 'app-a',
        adapterId: 'airtable',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(selection).toMatchObject({
      status: 'ready',
      requestedAdapterId: 'airtable',
      effectiveAdapterId: 'airtable',
      readiness: 'ready',
      kind: 'remote',
      declared: true,
      supported: true,
      reason: 'adapter_ready',
    });
    expect(selection.capabilities).toEqual(['read', 'write', 'sync']);
  });

  it('resolves a ready remote provider when declared', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync'],
      },
    ]);

    const selection = resolveDataHomeSelection({
      installationId: 'app-c',
      declaredAdapterIds: ['sqlite', 'notion'],
      selection: {
        installationId: 'app-c',
        adapterId: 'notion',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(selection).toMatchObject({
      status: 'ready',
      requestedAdapterId: 'notion',
      effectiveAdapterId: 'notion',
      readiness: 'ready',
      kind: 'remote',
      reason: 'adapter_ready',
    });
  });

  it('describes switch work as explicit export, import, and migration steps', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync', 'import', 'export'],
      },
    ]);

    const preview = previewDataHomeSwitch({
      installationId: 'app-a',
      declaredAdapterIds: ['sqlite', 'notion'],
      currentSelection: {
        installationId: 'app-a',
        adapterId: 'sqlite',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      nextAdapterId: 'notion',
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    expect(preview).toMatchObject({
      schemaVersion: 'utopia.data-home-selection.v1',
      installationId: 'app-a',
      status: 'ready',
      reason: 'manual_export_import_required',
      exportRequired: true,
      importRequired: true,
      migrationRequired: true,
      silentCopyAllowed: false,
      fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
    });
    expect(preview.current.effectiveAdapterId).toBe('sqlite');
    expect(preview.next.effectiveAdapterId).toBe('notion');
  });

  it('never exposes secrets in switch previews', () => {
    const registry = createDataHomeAdapterRegistry([
      {
        id: 'notion',
        kind: 'remote',
        readiness: 'ready',
        capabilities: ['read', 'write', 'sync', 'export', 'import', 'migrate'],
      },
    ]);

    const preview = previewDataHomeSwitch({
      installationId: 'app-a',
      declaredAdapterIds: ['sqlite', 'notion'],
      currentSelection: {
        installationId: 'app-a',
        adapterId: 'sqlite',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      nextAdapterId: 'notion',
      registry,
      now: '2026-07-29T00:00:00.000Z',
    });

    const payload = JSON.stringify(preview);
    expect(payload).not.toContain('token-');
    expect(preview.reason).toBe('manual_export_import_required');
  });
});
