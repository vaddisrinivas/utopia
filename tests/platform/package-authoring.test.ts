import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAppPackageSourceFolder } from '@/packages/app-compiler';
import {
  approvePackageAuthoringEvaluation,
  createPackageAuthoringChange,
  computePackageSourceRevision,
  evaluatePackageAuthoringChange,
} from '@/src/domain/package-authoring';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-source/reference-app');

function loadSource() {
  return readAppPackageSourceFolder(fixtureDir);
}

describe('package authoring', () => {
  it('evaluates bounded RFC6902 source proposals through the compiler and returns preview/diff', () => {
    const source = loadSource();
    const change = createPackageAuthoringChange({
      baseSourceRevision: computePackageSourceRevision(source),
      intent: 'Add grocery notes to chores',
      proposedBy: 'ai:wonder',
      proposals: [
        {
          op: 'add',
          path: '/collections/chore/fields/grocery_note',
          value: { type: 'text' },
        },
        {
          op: 'add',
          path: '/screens/chores/fields/-',
          value: 'grocery_note',
        },
      ],
    });

    const evaluation = evaluatePackageAuthoringChange(source, change);

    expect(evaluation.valid).toBe(true);
    if (!evaluation.valid) throw new Error(evaluation.errors.map((error) => error.message).join(', '));
    expect(evaluation.requiresApproval).toBe(true);
    expect(evaluation.diff.some((entry: any) => entry.kind === 'added')).toBe(true);
    expect((evaluation.preview as any).diffSummary.added).toBeGreaterThan(0);
    expect(evaluation.package.collections.chore.fields.grocery_note.type).toBe('text');
  });

  it('blocks stale base revisions and executable/SQL edits before compilation', () => {
    const source = loadSource();
    const stale = evaluatePackageAuthoringChange(source, {
      schemaVersion: 'utopia.authoring-change.v1',
      baseSourceRevision: 'sha256:deadbeef',
      intent: 'stale change',
      proposedBy: 'ai:wonder',
      proposals: [{ op: 'add', path: '/screens/stale', value: {} }],
      bounds: { maxOperations: 24, maxBytes: 32 * 1024, maxPointerDepth: 8 },
    });
    expect(stale.valid).toBe(false);
    if (stale.valid) throw new Error('expected stale proposal to fail');
    expect(stale.errors.some((error) => error.path === '/baseSourceRevision')).toBe(true);

    const executable = evaluatePackageAuthoringChange(source, {
      schemaVersion: 'utopia.authoring-change.v1',
      baseSourceRevision: computePackageSourceRevision(source),
      intent: 'run code',
      proposedBy: 'ai:wonder',
      proposals: [{ op: 'add', path: '/screens/hack.tsx', value: 'import fs from "node:fs"' }],
      bounds: { maxOperations: 24, maxBytes: 32 * 1024, maxPointerDepth: 8 },
    });
    expect(executable.valid).toBe(false);
    if (executable.valid) throw new Error('expected executable proposal to fail');
    expect(executable.errors.some((error) => error.message.includes('executable code or SQL'))).toBe(true);
  });

  it('requires non-self approval before activation receipt exists', () => {
    const source = loadSource();
    const evaluation = evaluatePackageAuthoringChange(source, createPackageAuthoringChange({
      baseSourceRevision: computePackageSourceRevision(source),
      intent: 'Add theme token',
      proposedBy: 'ai:wonder',
      proposals: [{ op: 'add', path: '/app/visualIdentity', value: { accent: '#7c6f57' } }],
    }));
    expect(evaluation.valid).toBe(true);
    if (!evaluation.valid) throw new Error(evaluation.errors.map((error) => error.message).join(', '));

    expect(() => approvePackageAuthoringEvaluation(evaluation, { approvedBy: 'ai:wonder' })).toThrow(/self-approved/);
    const receipt = approvePackageAuthoringEvaluation(evaluation, {
      approvedBy: 'user:srinivas',
      approvedAt: '2026-07-28T00:00:00.000Z',
    });

    expect(receipt.activationAllowed).toBe(true);
    expect(receipt.rollbackSourceRevision).toBe(evaluation.baseSourceRevision);
    expect(receipt.packageChecksum).toBe(evaluation.packageChecksum);
  });
});
