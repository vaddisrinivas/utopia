import { describe, expect, it } from 'vitest';

import {
  acceptAiConfigDraft,
  previewAiConfigDraft,
  rollbackAiConfigDraft,
  type AiConfigDraft,
} from '@/src/config/ai';
import type { ControlPlaneState } from '@/src/config/types';

const now = '2026-07-23T04:00:00.000Z';

function draft(raw: string): AiConfigDraft {
  return {
    id: 'draft-1',
    title: 'Add health dashboard',
    reason: 'User asked to add Health as a Utopia domain.',
    raw,
  };
}

describe('AI config authoring', () => {
  it('previews and accepts additive config through the config proposal runtime', () => {
    const preview = previewAiConfigDraft({
      now,
      draft: draft('domains:\n  - health\nscreens:\n  - health-home'),
    });

    expect(preview.can_apply).toBe(true);
    expect(preview.added_keys).toEqual(['domains', 'screens']);
    const accepted = acceptAiConfigDraft(preview);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.state.manifests).toEqual({
      domains: ['health'],
      screens: ['health-home'],
    });
  });

  it('rolls back an accepted AI config proposal to the previous control plane', () => {
    const previous: ControlPlaneState = {
      sources: [],
      snapshots: [],
      conflicts: [],
      errors: [],
      manifests: { domains: ['food'] },
      mode: 'additive',
    };
    const preview = previewAiConfigDraft({
      now,
      previous,
      draft: draft('screens:\n  - food-home\n  - food-chat'),
    });
    const accepted = acceptAiConfigDraft(preview);

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(rollbackAiConfigDraft(accepted.undo)).toBe(previous);
  });

  it('rejects AI drafts that try to mutate household records', () => {
    const preview = previewAiConfigDraft({
      now,
      draft: draft('domain: food\ncreate_record: pantry-yogurt'),
    });

    expect(preview.can_apply).toBe(false);
    expect(preview.errors[0]).toMatchObject({
      code: 'CONFIG_AI_DATA_PLANE_COMMAND',
    });
    expect(acceptAiConfigDraft(preview).ok).toBe(false);
  });

  it('rejects destructive AI config migrations instead of silently applying them', () => {
    const previous: ControlPlaneState = {
      sources: [],
      snapshots: [],
      conflicts: [],
      errors: [],
      manifests: { activeDomain: 'food' },
      mode: 'additive',
    };
    const preview = previewAiConfigDraft({
      now,
      previous,
      draft: draft('remove:\n  - domains.food.collections.inventory'),
    });

    expect(preview.can_apply).toBe(false);
    expect(preview.proposal.conflicts[0]).toMatchObject({
      key: 'migration',
      status: 'needs_review',
    });
  });
});
