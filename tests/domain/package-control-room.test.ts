import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAppPackageSourceFolder } from '@/packages/app-compiler';
import { createPackageAuthoringChange, computePackageSourceRevision } from '@/src/domain/package-authoring';
import { bootstrapAppPackageRegistry, rollbackAppPackage } from '@/src/db/app-package-registry';
import {
  activateApprovedControlRoomChange,
  approveControlRoomPreview,
  approveControlRoomSourcePreview,
  buildCollectionFieldFormSchema,
  createControlRoomSourceState,
  indexPackageSourceTree,
  previewControlRoomChange,
  previewControlRoomSourceProposal,
  activateControlRoomSourceProposal,
  rollbackControlRoomSource,
  proposeCollectionFieldPatch,
} from '@/src/domain/package-control-room';
import { MemoryDb } from '@/tests/helpers/memory-db';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-source/reference-app');

function loadSource() {
  return readAppPackageSourceFolder(fixtureDir);
}

describe('package control room source state', () => {
  it('previews, approves, activates, and rolls back immutable source revisions', () => {
    const source = loadSource();
    const state = createControlRoomSourceState({
      installationId: 'control-a',
      workspaceId: 'ws-control',
      source,
      createdBy: 'user:bootstrap',
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    const active = state.revisions[state.activeRevision];
    const sourceTree = indexPackageSourceTree(active.package);
    expect(sourceTree.sections.map((section) => section.id)).toEqual([
      'app',
      'collections',
      'screens',
      'queries',
      'rules',
      'workflows',
      'providers',
      'theme',
      'capabilities',
    ]);
    expect(sourceTree.sections.find((section) => section.id === 'collections')?.children.map((child) => child.id))
      .toContain('chore');

    const formSchema = buildCollectionFieldFormSchema(active.package);
    expect(formSchema.jsonSchema.properties.collectionId).toMatchObject({
      enum: expect.arrayContaining(['chore']),
    });

    const proposal = {
      schemaVersion: 'wonder.package-control-room.source-proposal.v1' as const,
      kind: 'schema-form' as const,
      change: createPackageAuthoringChange({
        baseSourceRevision: computePackageSourceRevision(source),
        intent: 'Add grocery note to chores',
        proposedBy: 'ai:wonder',
        proposals: [
          { op: 'add', path: '/collections/chore/fields/grocery_note', value: { type: 'text' } },
          { op: 'add', path: '/screens/chores/fields/-', value: 'grocery_note' },
        ],
      }),
    };

    const preview = previewControlRoomSourceProposal(state, proposal);
    expect(preview.status).toBe('valid');
    if (preview.status !== 'valid') throw new Error(preview.errors.join('|'));
    expect(preview.package.collections.chore.fields.grocery_note).toEqual({ type: 'text' });
    expect(preview.diff).toContainEqual(expect.objectContaining({
      section: 'collections',
      kind: 'added',
      path: expect.stringContaining('/collections/chore/fields/grocery_note'),
    }));

    const approval = approveControlRoomSourcePreview(state, proposal, preview, {
      approvedBy: 'user:reviewer',
      policyCategory: 'standard',
      approvedAt: '2026-07-28T00:01:00.000Z',
      expiresAt: '2026-07-28T01:01:00.000Z',
      nonce: 'nonce-1',
    });
    expect(approval.operationsHash).toBeTruthy();
    expect(approval.rollbackSourceRevision).toBe(state.activeRevision);

    const activated = activateControlRoomSourceProposal(state, proposal, approval, {
      activatedBy: 'user:operator',
      activatedAt: '2026-07-28T00:02:00.000Z',
    });
    const activeAfter = activated.state.revisions[activated.state.activeRevision];
    expect(activeAfter.source.collections?.chore.fields.grocery_note).toEqual({ type: 'text' });
    expect(activated.receipt.previousSourceRevision).toBe(state.activeRevision);
    expect(activated.state.approvals['nonce-1']?.consumedAt).toBe('2026-07-28T00:02:00.000Z');

    expect(() => activateControlRoomSourceProposal(activated.state, proposal, approval, {
      activatedBy: 'user:operator',
      activatedAt: '2026-07-28T00:03:00.000Z',
    })).toThrow(/consumed|moved/);

    const rolledBack = rollbackControlRoomSource(activated.state, {
      targetRevision: state.activeRevision,
      rolledBackBy: 'user:operator',
      rolledBackAt: '2026-07-28T00:04:00.000Z',
    });
    expect(rolledBack.state.activeRevision).toBe(state.activeRevision);
    expect(rolledBack.receipt.toSourceRevision).toBe(state.activeRevision);
  });

  it('rejects stale or oversized proposals without mutating active source', () => {
    const source = loadSource();
    const state = createControlRoomSourceState({
      installationId: 'control-b',
      source,
      createdBy: 'user:bootstrap',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    const preview = previewControlRoomSourceProposal(state, {
      schemaVersion: 'wonder.package-control-room.source-proposal.v1',
      kind: 'manual',
      change: {
        schemaVersion: 'utopia.authoring-change.v1',
        baseSourceRevision: 'sha256:deadbeef',
        intent: 'bad change',
        proposedBy: 'ai:wonder',
        proposals: Array.from({ length: 25 }, (_, index) => ({
          op: 'add' as const,
          path: `/screens/overflow_${index}`,
          value: { label: 'Overflow', collections: ['chore'], query: 'all_chores', mode: 'list', fields: ['title'] },
        })),
        bounds: { maxOperations: 24, maxBytes: 32 * 1024, maxPointerDepth: 8 },
      },
    });

    expect(preview.status).toBe('invalid');
    if (preview.status !== 'invalid') throw new Error('expected invalid preview');
    expect(preview.errors.join('|')).toMatch(/baseSourceRevision|proposal count exceeds 24/);
    expect(state.revisions[state.activeRevision].revision).toBe(computePackageSourceRevision(source));
  });

  it('previews, approves, activates, and rolls back package-level control-room patches', async () => {
    const db = new MemoryDb() as any;
    const active = await bootstrapAppPackageRegistry(db);
    const proposal = proposeCollectionFieldPatch(active, {
      collectionId: 'meal_log',
      fieldId: 'operator_note',
      type: 'text',
      indexed: true,
    });

    const preview = await previewControlRoomChange(db, {
      installationId: 'default',
      request: proposal.request,
    });

    expect(preview.status).toBe('valid');
    if (preview.status !== 'valid') throw new Error(preview.errors.join('|'));
    expect(preview.diff).toContainEqual(expect.objectContaining({
      section: 'collections',
      kind: 'added',
      id: 'meal_log.operator_note',
    }));

    const approval = approveControlRoomPreview(preview, {
      approvedBy: 'user:reviewer',
      approvedAt: '2026-07-28T02:00:00.000Z',
    });
    expect(approval.requestHash).toBe(preview.requestHash);

    const activated = await activateApprovedControlRoomChange(db, {
      installationId: 'default',
      request: proposal.request,
      approval,
    });
    expect(activated.package.collections.meal_log.fields.operator_note).toEqual({ type: 'text', indexed: true });

    const rolledBack = await rollbackAppPackage(db);
    expect(rolledBack?.collections.meal_log.fields.operator_note).toBeUndefined();
  });
});
