import { describe, expect, it } from 'vitest';

import {
  compileBuilderSource,
  generateArchetypeSource,
  parseBuilderImportPayload,
  getBuilderInfo,
  getArchetypeCapabilityStatuses,
  parseBrowserBuilderArgs,
  readStarterSource,
} from '@/scripts/package/browser-package-builder';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

  it('imports compiled package payloads when conversion is lossless', () => {
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
    expect(imported.sourceChecksum).toBe(compiled.checksum);
    expect(imported.packageChecksum).toBe(compiled.checksum);

    const roundtrip = compileBuilderSource(imported.source);
    expect(roundtrip.status).toBe('valid');
    if (roundtrip.status === 'valid') {
      expect(roundtrip.checksum).toBe(compiled.checksum);
    }
  });

  it('imports generated source with preferredDataHome and hydrates deterministically', () => {
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

    const compiled = compileBuilderSource(generated.source);
    expect(compiled.status).toBe('valid');
    if (compiled.status !== 'valid') {
      return;
    }

    const imported = parseBuilderImportPayload(compiled.package);
    expect(imported.status).toBe('compiled');
    if (imported.status !== 'compiled') {
      return;
    }

    expect(imported.source.app.providerTemplateFields?.preferredDataHome).toBe('notion');
    expect(imported.source.capabilities?.package).toContain('data-home:notion');

    const recompiled = compileBuilderSource(imported.source);
    expect(recompiled.status).toBe('valid');
    if (recompiled.status === 'valid') {
      expect(recompiled.checksum).toBe(compiled.checksum);
    }
  });

  it('rejects non-lossless compiled payload import', () => {
    const source = readStarterSource(starters[0]?.id ?? 'chores-lite');
    const compiled = compileBuilderSource(source);

    expect(compiled.status).toBe('valid');
    if (compiled.status !== 'valid') {
      return;
    }

    const malformed = JSON.parse(JSON.stringify(compiled.package));
    const firstSurface = malformed.presentation?.surfaces?.[0];
    if (firstSurface && Array.isArray(firstSurface.views)) {
      firstSurface.views.push(`${firstSurface.views[0]}-extra`);
    }

    const imported = parseBuilderImportPayload(malformed);
    expect(imported.status).toBe('unsupported');
    if (imported.status !== 'unsupported') {
      return;
    }

    expect(imported.mode).toBe('unsupported');
    expect(imported.reason).toBeTruthy();
    expect(imported).toHaveProperty('warnings');
    expect(imported.warnings).toEqual([]);
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
});
