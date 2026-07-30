import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  compileBuilderSource,
  generateArchetypeSource,
  parseBuilderImportPayload,
  getBuilderAdapterContracts,
  getBuilderComponentRegistry,
  getBuilderInfo,
  getArchetypeCapabilityStatuses,
  parseBrowserBuilderArgs,
  ALLOWED_CREATOR_FAILURE_CATEGORIES,
  buildCreatorStudyReceipt,
  normalizeCreatorFailureCategories,
  readStarterSource,
} from '@/scripts/package/browser-package-builder';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const browserBuilderHtmlPath = path.resolve(process.cwd(), 'scripts/package/browser-package-builder.html');

function readBrowserBuilderHtml(): string {
  return readFileSync(browserBuilderHtmlPath, 'utf8');
}

function extractCreatorBuilderFunction(
  source: string,
  startMarker: string,
  nextMarker: string,
): string {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(nextMarker, start + 1);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

describe('package browser builder', () => {
  const starters = getBuilderInfo().starters;

  it('loads a deterministic starter manifest', () => {
    expect(starters.length).toBeGreaterThan(0);
    expect(starters[0]?.id).toBe('chores-lite');
    expect(starters.find((starter) => starter.id === 'capability-lab')?.label).toBe('Capability Lab');
  });

  it('parses port override from args', () => {
    expect(parseBrowserBuilderArgs([])).toEqual({ host: '127.0.0.1', port: 4173 });
    expect(parseBrowserBuilderArgs(['--port', '4444'])).toEqual({ host: '127.0.0.1', port: 4444 });
  });

  it('compiles starter sources through builder contract', () => {
    const source = readStarterSource(starters[0]?.id ?? 'chores-lite');
    const result = compileBuilderSource(source);

    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.package.id).toBe(starters[0]?.id ?? 'chores-lite');
      expect(result.preview.sourceCounts.screens).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    }
  });

  it('imports package-source payloads directly', () => {
    const source = readStarterSource('plants-lite');
    const result = parseBuilderImportPayload(source);

    expect(result.status).toBe('source');
    if (result.status === 'source') {
      expect(result.mode).toBe('package-source');
      expect(result.source.app.id).toBe(source.app.id);
    }
  });

  it('imports compiled payloads when conversion is lossless', () => {
    const source = readStarterSource(starters[0]?.id ?? 'chores-lite');
    const compiled = compileBuilderSource(source);

    expect(compiled.status).toBe('valid');
    if (compiled.status !== 'valid') {
      return;
    }

    const imported = parseBuilderImportPayload(compiled.package);
    expect(imported.status).toBe('compiled');
    if (imported.status !== 'compiled') {
      return;
    }

    expect(imported.mode).toBe('compiled-package');
    expect(imported.source.app.id).toBe(source.app.id);
    expect(imported.sourceChecksum).toBe(compiled.checksum);
    expect(imported.packageChecksum).toBe(compiled.checksum);

    const roundtrip = compileBuilderSource(imported.source);
    expect(roundtrip.status).toBe('valid');
    if (roundtrip.status === 'valid') {
      expect(roundtrip.checksum).toBe(compiled.checksum);
    }
  });

  it('imports generated source with preferredDataHome and validates deterministically', () => {
    const generated = generateArchetypeSource({
      appName: 'Notes with notion',
      appPurpose: 'Daily notes',
      screenCount: 2,
      archetype: 'media',
      targetPlatforms: ['web'],
      demoData: true,
      selectedCapabilityIds: ['media-gallery'],
      preferredDataHome: 'Notion',
    });

    expect(generated.status).toBe('ok');
    if (generated.status !== 'ok') {
      return;
    }

    expect(generated.source.app.providerTemplateFields?.preferredDataHome).toBe('notion');
    expect(generated.source.capabilities?.package).toContain('data-home:notion');

    const imported = parseBuilderImportPayload(generated.source);
    expect(imported.status).toBe('source');
    if (imported.status !== 'source') {
      return;
    }

    expect(imported.source.app.providerTemplateFields?.preferredDataHome).toBe('notion');
    expect(imported.source.capabilities?.package).toContain('data-home:notion');

    const recompiled = compileBuilderSource(imported.source);
    expect(recompiled.status).toBe('valid');
    if (recompiled.status === 'valid') {
      expect(recompiled.package.id).toBe('notes-with-notion-media');
      expect(recompiled.checksum).toBeTruthy();
    }
  });

  it('converts supported JSON Forms payloads to canonical package-source', () => {
    const adapters = getBuilderAdapterContracts().adapters.filter((contract) => contract.id !== 'package-source');
    const jsonForms = adapters.find((adapter) => adapter.id === 'json-forms');

    const invalidJsonForms = {
      $schema: jsonForms?.schemaUrl ?? 'https://schemas.utopia.dev/editors/json-forms.v1.schema.json',
      schema: {
        type: 'object',
        title: 'Task form',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          completed: { type: 'boolean' },
        },
      },
      uischema: {
        type: 'VerticalLayout',
        elements: [
          { type: 'Control', scope: '#/properties/title' },
          { type: 'Control', scope: '#/properties/completed' },
        ],
      },
    };
    const converted = parseBuilderImportPayload(invalidJsonForms);
    expect(converted.status).toBe('source');
    if (converted.status !== 'source') {
      return;
    }
    expect(converted.mode).toBe('package-source');
    expect(converted.source.app.schemaVersion).toBe('wonder.package-source.v1');
    expect(converted.source.app.id).toBe('task-form');
    expect(converted.source.collections?.form?.fields).toEqual({
      title: { type: 'text', required: true },
      completed: { type: 'boolean', required: false },
    });
    expect(converted.source.screens?.['form-home']?.fields).toEqual(['title', 'completed']);

    const compiled = compileBuilderSource(converted.source);
    expect(compiled.status).toBe('valid');
  });

  it('reports unsupported JSON Forms payloads when outside the documented subset', () => {
    const jsonForms = {
      $schema: 'https://schemas.utopia.dev/editors/json-forms.v1.schema.json',
      schema: { type: 'array', title: 'Tasks', items: {} },
      uischema: {},
    };
    const converted = parseBuilderImportPayload(jsonForms);
    expect(converted.status).toBe('unsupported');
    if (converted.status !== 'unsupported') {
      return;
    }
    expect(converted.mode).toBe('unsupported');
    expect(converted.reason).toBe('json-forms payload is outside supported conversion subset');
    expect(converted.warnings).toContain('canonical persistence is package-source only');
  });

  it('keeps puck unsupported and rejected with explicit boundary reasons', () => {
    const puck = getBuilderAdapterContracts().adapters.find((adapter) => adapter.id === 'puck');

    const puckPayload = {
      $schema: puck?.schemaUrl ?? 'https://schemas.utopia.dev/editors/puck.v1.schema.json',
      root: {},
    };
    const convertedPuck = parseBuilderImportPayload(puckPayload);
    expect(convertedPuck.status).toBe('unsupported');
    if (convertedPuck.status !== 'unsupported') {
      return;
    }

    expect(convertedPuck.mode).toBe('unsupported');
    expect(convertedPuck.reason).toBe('adapter import/export is not yet supported');
    expect(convertedPuck.warnings).toContain('canonical persistence is package-source only');
  });

  it('rejects non-lossless adapter payload import details', () => {
    const malformed = { $schema: 'https://schemas.utopia.dev/editors/json-forms.v1.schema.json', schema: true };

    const imported = parseBuilderImportPayload(malformed);
    expect(imported.status).toBe('unsupported');
    if (imported.status !== 'unsupported') {
      return;
    }

    expect(imported.mode).toBe('unsupported');
    expect(imported.reason).toBe('json-forms payload is outside supported conversion subset');
    expect(imported).toHaveProperty('warnings');
    expect(imported.warnings).toContain('canonical persistence is package-source only');
  });

  it('returns warnings array on unsupported import payloads', () => {
    const imported = parseBuilderImportPayload({ schemaVersion: 'unsupported.schema' });
    expect(imported.status).toBe('unsupported');
    if (imported.status !== 'unsupported') {
      return;
    }

    expect(imported.mode).toBe('unsupported');
    expect(imported.warnings).toEqual([]);
  });

  it('reports invalid source changes as expected', () => {
    const source = clone(readStarterSource('plants-lite'));
    source.app.homeSurface = 'missing_screen';

    const result = compileBuilderSource(source);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.errors.some((error) => error.path === '/app/homeSurface')).toBe(true);
    }
  });

  it('reports archetype capability truth with target platforms', () => {
    const statuses = getArchetypeCapabilityStatuses(['web']);
    const contacts = statuses.find((capability) => capability.id === 'contacts-access');
    expect(contacts).toBeTruthy();
    expect(contacts?.supported).toBe(false);
    expect(contacts?.exportable).toBe(false);
    expect(contacts?.deviceProofRequired).toBe(true);
    expect(contacts?.blocked).toBe(true);
    expect(contacts?.support).toContainEqual({ platform: 'web', state: 'unsupported' });

    const records = statuses.find((capability) => capability.id === 'records-read');
    expect(records?.supported).toBe(true);
    expect(records?.exportable).toBe(true);
    expect(records?.blocked).toBe(false);
  });

  it('generates archetype source and rejects blocked capability choices', () => {
    const blocked = generateArchetypeSource({
      appName: 'Media blocked',
      appPurpose: 'Media with blocked camera',
      screenCount: 2,
      archetype: 'media',
      targetPlatforms: ['web'],
      demoData: false,
      selectedCapabilityIds: ['contacts-access'],
    });

    expect(blocked.status).toBe('error');
    if (blocked.status === 'error') {
      expect(blocked.blockedCapabilityIds).toContain('contacts-access');
      expect(blocked.reason).toContain('blocked');
    }

    const generated = generateArchetypeSource({
      appName: 'Media with demo',
      appPurpose: 'Daily clips',
      screenCount: 2,
      archetype: 'media',
      targetPlatforms: ['web'],
      demoData: true,
      selectedCapabilityIds: ['media-gallery'],
    });

    expect(generated.status).toBe('ok');
    if (generated.status === 'ok') {
      expect(generated.source.app.label).toBe('Media with demo - Daily clips');
      expect(generated.source.collections).toBeDefined();
      expect(generated.source.queries).toBeDefined();
      expect(generated.source.capabilities?.package).toContain('media.gallery');

      const compiled = compileBuilderSource(generated.source);
      expect(compiled.status).toBe('valid');
      if (compiled.status === 'valid') {
        expect(compiled.package.id).toBe('media-with-demo-media');
        expect(compiled.checksum).toBeTruthy();
      }
    }
  });

  it('includes preferred data home in source metadata and package capabilities', () => {
    const generated = generateArchetypeSource({
      appName: 'Notes with notion',
      appPurpose: 'Daily notes',
      screenCount: 2,
      archetype: 'media',
      targetPlatforms: ['web'],
      demoData: true,
      selectedCapabilityIds: ['media-gallery'],
      preferredDataHome: 'Notion',
    });

    expect(generated.status).toBe('ok');
    if (generated.status === 'ok') {
      expect(generated.source.app.providerTemplateFields?.preferredDataHome).toBe('notion');
      expect(generated.source.capabilities?.package).toContain('data-home:notion');
    }
  });

  it('warns when selected capabilities require native bridge support', () => {
    const generated = generateArchetypeSource({
      appName: 'Media with native',
      appPurpose: 'Daily clips',
      screenCount: 2,
      archetype: 'media',
      targetPlatforms: ['web'],
      demoData: false,
      selectedCapabilityIds: ['media-gallery'],
    });

    expect(generated.status).toBe('ok');
    if (generated.status === 'ok') {
      expect(generated.warnings).toEqual(expect.arrayContaining([
        'media-gallery requires native bridge support and will include native capability declarations',
      ]));
      const mediaGallery = generated.capabilityStatuses.find((item) => item.id === 'media-gallery');
      expect(mediaGallery?.requiresNativeBridge).toBe(true);
    }
  });

  it('publishes editor contracts and widget registry mapping', () => {
    const contracts = getBuilderAdapterContracts().adapters;
    const registry = getBuilderComponentRegistry();

    const sourceContract = contracts.find((contract) => contract.id === 'package-source');
    expect(sourceContract?.canonical).toBe(true);
    expect(sourceContract?.persisted).toBe(true);

    const jsonForms = contracts.find((contract) => contract.id === 'json-forms');
    const puck = contracts.find((contract) => contract.id === 'puck');
    expect(jsonForms?.importSupported).toBe(true);
    expect(jsonForms?.exportSupported).toBe(false);
    expect(puck?.importSupported).toBe(false);
    expect(puck?.exportSupported).toBe(false);
    expect(jsonForms?.schemaUrl).toBe('https://schemas.utopia.dev/editors/json-forms.v1.schema.json');
    expect(puck?.schemaUrl).toBe('https://schemas.utopia.dev/editors/puck.v1.schema.json');

    const firstRegistryEntry = registry[0];
    expect(firstRegistryEntry?.canonicalWidgetKind).toBeTruthy();
    expect(firstRegistryEntry?.jsonFormsKind).toContain('jsonForms:');
    expect(firstRegistryEntry?.puckKind).toContain('puck:');
  });

  it('normalizes creator failure categories against allowlist', () => {
    const categories = normalizeCreatorFailureCategories([
      'validation_failed',
      'receipt_not_generated',
      'unknown_failure',
      'source_invalid',
      'receipt_not_generated',
    ]);

    expect(categories).toEqual([
      'validation_failed',
      'receipt_not_generated',
      'source_invalid',
    ]);
  });

  it('builds creator study receipt with truthful duration and redacted categories', () => {
    const receipt = buildCreatorStudyReceipt({
      durationMs: 901_000,
      packageId: 'shared-household-board',
      packageVersion: '1.0.0',
      packageValid: true,
      installOpened: true,
      failureCategories: ['validation_failed', 'unknown', 'source_invalid'],
    });

    expect(receipt.proof).toBe('creator_study_receipt');
    expect(receipt.duration_seconds).toBe(901);
    expect(receipt.failure_categories).toEqual([
      'validation_failed',
      'source_invalid',
    ]);
    expect(receipt.package_valid).toBe(true);
    expect(receipt.package).toEqual({ id: 'shared-household-board', version: '1.0.0', valid: true });
    expect(ALLOWED_CREATOR_FAILURE_CATEGORIES).toContain('install_review_blocked');
  });

  it('does not persist creator AI key in fetch payloads or storage-backed sinks', () => {
    const html = readBrowserBuilderHtml();
    const serializedBodies = Array.from(html.matchAll(/body:\s*JSON\.stringify\(([\s\S]*?)\)/g));

    expect(serializedBodies.every((entry) => !entry[1].includes('creatorAiKey'))).toBe(true);
    expect(html).not.toContain('localStorage.');
    expect(html).not.toContain('sessionStorage.');
  });

  it('opens creator install review via /install handoff only when package URL is https', () => {
    const html = readBrowserBuilderHtml();
    const openReviewBlock = extractCreatorBuilderFunction(
      html,
      '      async function openCreatorInstallReview()',
      '\n      async function downloadCreatorReceipt()',
    );
    const installUrlBlock = extractCreatorBuilderFunction(
      html,
      '      function buildCreatorInstallReviewUrl(sourceUrl) {',
      '\n      function serializeCreatorReceiptPayload(source, packageNode, durationMs) {',
    );

    expect(openReviewBlock).toContain('buildCreatorInstallReviewUrl');
    expect(openReviewBlock).toContain('window.open(installReviewUrl');
    expect(openReviewBlock).toContain('lastCreatorReview.preview?.sourceUrl');
    expect(openReviewBlock).not.toContain('lastCreatorReview.sourceUrl');
    expect(installUrlBlock).toContain('new URL(\'/install\', window.location.origin)');
    expect(installUrlBlock).toContain('searchParams.set(\'url\'');
    expect(openReviewBlock).toContain('setCreatorFailure(\'install_review_blocked\')');
    expect(openReviewBlock).not.toContain('createObjectURL');
  });
});
