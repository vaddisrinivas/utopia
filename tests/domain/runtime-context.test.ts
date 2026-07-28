import { Fragment, createElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { AppRuntimeProvider, useAppRuntime } from '@/src/domain/runtime-context';

describe('AppRuntimeProvider', () => {
  it('keeps independent runtime contexts isolated', () => {
    const { renderToStaticMarkup } = require('react-dom/server') as {
      renderToStaticMarkup(node: ReturnType<typeof createElement>): string;
    };
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(
          AppRuntimeProvider,
          { db: null, initialPackage: makeReferencePackage('reference-app', '1.0.0', 'Reference App') },
          createElement(RuntimeProbe, { name: 'left' }),
        ),
        createElement(
          AppRuntimeProvider,
          { db: null, initialPackage: makeReferencePackage('second-app', '3.4.5', 'Second App') },
          createElement(RuntimeProbe, { name: 'right' }),
        ),
      ),
    );

    expect(html).toContain('left:reference-app:Reference App:reference-app');
    expect(html).toContain('right:second-app:Second App:second-app');
  });

  it('fails closed when a database-backed runtime is missing installation scope', async () => {
    let captured: ReturnType<typeof useAppRuntime> | undefined;

    const { renderToStaticMarkup } = require('react-dom/server') as {
      renderToStaticMarkup(node: ReturnType<typeof createElement>): string;
    };
    renderToStaticMarkup(
      createElement(
        AppRuntimeProvider,
        { db: {} as never },
        createElement(CaptureRuntime, { onCapture: (value) => { captured = value; } }),
      ),
    );

    expect(captured).toBeDefined();
    expect(captured!.installationId).toBeNull();
    await expect(captured!.refreshRuntime()).rejects.toThrow('app_runtime_installation_scope_required');
    await expect(captured!.activateAppPackage(makeReferencePackage('blocked', '1.0.0', 'Blocked'))).rejects.toThrow(
      'app_runtime_installation_scope_required',
    );
    await expect(captured!.rollbackAppPackage()).rejects.toThrow('app_runtime_installation_scope_required');
  });
});

function RuntimeProbe({ name }: { name: string }) {
  const runtime = useAppRuntime();
  return createElement(
    'div',
    null,
    `${name}:${runtime.activePackage?.id ?? 'none'}:${runtime.activeManifest?.label ?? 'none'}:${runtime.catalog?.activeDomainId ?? 'none'}`,
  );
}

function CaptureRuntime(
  { onCapture }: { onCapture(value: ReturnType<typeof useAppRuntime>): void },
) {
  onCapture(useAppRuntime());
  return null;
}

function makeReferencePackage(id: string, version: string, label: string): AppPackage {
  return {
    schemaVersion: 'wonder.app-package.v2',
    id,
    version,
    collections: {
      chore: {
        id: 'chore',
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          collection: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
          properties: { type: 'json', required: true },
        },
      },
    },
    queries: {
      chores: { from: 'records', where: { op: 'eq', field: 'collection', value: 'chore' } },
    },
    views: {
      chores: { id: 'chores', query: 'chores', mode: 'list', fields: ['title', 'updated_at'] },
    },
    presentation: {
      label,
      homeSurface: 'chores',
      surfaces: [
        { id: 'chores', label: 'Chores', collections: ['chore'], views: ['chores'] },
      ],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: ['runtime-context'],
  };
}
