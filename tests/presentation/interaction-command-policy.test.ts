import { describe, expect, it } from 'vitest';
import {
  confirmationAdvice,
  accessibleStatusFor,
  cancelled,
  createCommandState,
  error,
  undoEligibility,
  normalizeIntent,
  normalizeInteractionCommandPolicy,
  offlineExecutionProjection,
  pending,
  queued,
  saveOutcomeProjection,
  saved,
  transitionCommandState,
  undone,
} from '../../src/presentation/interaction-command-policy';

describe('normalizeInteractionCommandPolicy', () => {
  it('normalizes omitted policy to fail-closed defaults', () => {
    expect(normalizeInteractionCommandPolicy()).toEqual({
      autosave: 'manual',
      optimistic: false,
      undo: { enabled: false, windowMs: 5000 },
      confirmation: { required: false, message: 'Are you sure?' },
      offline: 'block',
      validation: { mode: 'none', requiredFields: [] },
      draftPersistence: { enabled: false, scope: 'memory' },
      restartRecovery: { enabled: false, maxAgeMs: 86400000 },
      accessibleStatus: {
        enabled: true,
        labels: {
          pending: 'Saving',
          saved: 'Saved',
          error: 'Save failed',
          queued: 'Queued for later',
          undone: 'Undone',
          cancelled: 'Cancelled',
        },
      },
    });
  });

  it('normalizes the complete declarative policy', () => {
    expect(normalizeInteractionCommandPolicy({
      autosave: { mode: 'blur' },
      optimistic: true,
      undo: { enabled: true, windowMs: 12_000 },
      confirmation: { required: true, message: 'Delete this item?' },
      offline: 'queue',
      validation: { mode: 'change', requiredFields: ['title', 'amount'] },
      draftPersistence: { enabled: true, scope: 'local' },
      restartRecovery: { enabled: true, maxAgeMs: 3_600_000 },
      accessibleStatus: { enabled: true, labels: { saved: 'All changes saved' } },
    })).toMatchObject({
      autosave: 'blur', optimistic: true,
      undo: { enabled: true, windowMs: 12000 },
      confirmation: { required: true, message: 'Delete this item?' },
      offline: 'queue',
      validation: { mode: 'change', requiredFields: ['title', 'amount'] },
      draftPersistence: { enabled: true, scope: 'local' },
      restartRecovery: { enabled: true, maxAgeMs: 3600000 },
    });
    expect(normalizeInteractionCommandPolicy({ accessibleStatus: { labels: { saved: 'All changes saved' } } }).accessibleStatus.labels.saved)
      .toBe('All changes saved');
  });

  it('supports compact boolean forms', () => {
    expect(normalizeInteractionCommandPolicy({
      autosave: 'change', optimistic: true, undo: true, confirmation: true,
      offline: 'local', draftPersistence: true, restartRecovery: true, accessibleStatus: false,
    })).toMatchObject({
      autosave: 'change', optimistic: true, undo: { enabled: true }, confirmation: { required: true },
      offline: 'local', draftPersistence: { enabled: true }, restartRecovery: { enabled: true },
      accessibleStatus: { enabled: false },
    });
  });

  it('rejects unknown values, keys, malformed objects, duplicates, and unsafe numbers', () => {
    const badPolicies: unknown[] = [
      { autosave: 'onBlur' }, { offline: 'sync' }, { optimistic: 'yes' },
      { undo: { enabled: true, windowMs: 0 } }, { validation: { mode: 'blur' } },
      { draftPersistence: { scope: 'disk' } }, { restartRecovery: { maxAgeMs: -1 } },
      { accessibleStatus: { labels: { unknown: 'x' } } }, { unknown: true },
      { validation: { requiredFields: ['title', 'title'] } },
    ];
    for (const policy of badPolicies) expect(() => normalizeInteractionCommandPolicy(policy as never)).toThrow(TypeError);
  });
});

describe('command state transitions', () => {
  it('provides deterministic pending, saved, error, queued, undone, and cancelled transitions', () => {
    const initial = createCommandState('cmd-1', 10);
    const queue = queued(initial, 11);
    const retry = pending(queue, 12);
    const success = saved(retry, 13);
    const reverted = undone(success, 14);
    const cancelledState = cancelled(success, 15);
    expect(reverted).toEqual({ id: 'cmd-1', status: 'undone', revision: 4, updatedAt: 14 });
    expect(cancelledState).toEqual({ id: 'cmd-1', status: 'cancelled', revision: 4, updatedAt: 15 });
    expect(error(initial, 11, 'network unavailable')).toEqual({
      id: 'cmd-1', status: 'error', revision: 1, updatedAt: 11, error: 'network unavailable',
    });
  });

  it('allows retry after errors and clears stale error text', () => {
    const failed = error(createCommandState('cmd-2'), 1, 'bad input');
    expect(pending(failed, 2)).toEqual({ id: 'cmd-2', status: 'pending', revision: 2, updatedAt: 2 });
  });

  it('rejects invalid transitions and backwards time', () => {
    const savedState = saved(createCommandState('cmd-3'), 2);
    expect(() => queued(savedState, 3)).toThrow('Invalid command transition');
    expect(() => cancelled(savedState, 1)).toThrow('must not move backwards');
    expect(() => transitionCommandState(savedState, { type: 'saved', at: 3 })).not.toThrow();
    expect(() => undone(cancelled(savedState, 3), 4)).toThrow('Invalid command transition');
  });

  it('projects accessible status labels and live politeness deterministically', () => {
    const policy = normalizeInteractionCommandPolicy({ accessibleStatus: { labels: { error: 'Could not save' } } });
    expect(accessibleStatusFor(error(createCommandState('cmd-4'), 1, 'failure'), policy)).toEqual({
      status: 'error', message: 'Could not save', live: 'assertive',
    });
    expect(accessibleStatusFor(saved(createCommandState('cmd-5'), 1), policy)).toEqual({
      status: 'saved', message: 'Saved', live: 'polite',
    });
    expect(accessibleStatusFor(saved(createCommandState('cmd-6'), 1), normalizeInteractionCommandPolicy({ accessibleStatus: false })))
      .toEqual({ status: 'saved', message: '', live: 'off' });
  });

  it('builds generic interaction kernel hints for confirmation, offline, and undo', () => {
    const policy = normalizeInteractionCommandPolicy({
      confirmation: { required: true, message: 'Remove' },
      undo: { enabled: true, windowMs: 3000 },
      offline: 'queue',
    });
    const intent = normalizeIntent('delete');
    const confirmation = confirmationAdvice(policy, intent, { subject: 'Item A' });
    expect(confirmation).toEqual({
      required: true,
      message: 'Remove Item A?',
    });

    const networkBlocked = offlineExecutionProjection(policy, { online: false, queuedCount: 1 });
    expect(networkBlocked).toEqual({
      status: 'queued',
      canExecute: true,
      live: 'polite',
      message: 'Queued for sync when network returns.',
      queuedCount: 1,
    });

    const state = saved(createCommandState('cmd-undo', 1_000), 2_500);
    expect(undoEligibility(state, policy, 4_900)).toEqual({
      available: true,
      reason: 'Undo available.',
      remainingMs: 600,
    });
    expect(undoEligibility(state, policy, 5_500).available).toBe(false);
  });

  it('projects offline-blocked policy as an error gate', () => {
    const blockPolicy = normalizeInteractionCommandPolicy({ offline: 'block' });
    expect(offlineExecutionProjection(blockPolicy, { online: false, queuedCount: 0 }))
      .toEqual({
        status: 'error',
        canExecute: false,
        live: 'assertive',
        message: 'Offline actions blocked by package policy.',
        queuedCount: 0,
      });
    expect(normalizeIntent('archive').destructive).toBe(true);
  });

  it('projects package-defined accessible save outcomes for online and offline writes', () => {
    const policy = normalizeInteractionCommandPolicy({
      offline: 'queue',
      accessibleStatus: { labels: { saved: 'Changes saved', queued: 'Saved offline' } },
    });
    expect(saveOutcomeProjection(policy, { online: true })).toMatchObject({
      status: 'saved', canExecute: true, message: 'Changes saved', queuedCount: 0,
    });
    expect(saveOutcomeProjection(policy, { online: false, queuedCount: 1 })).toMatchObject({
      status: 'queued', canExecute: true, message: 'Saved offline', queuedCount: 1,
    });
    expect(saveOutcomeProjection(normalizeInteractionCommandPolicy(), { online: false })).toMatchObject({
      status: 'error', canExecute: false, message: 'Save failed',
    });
  });
});
