import {
  applyConfigProposal,
  buildConfigProposal,
  undoConfigProposal,
  type ConfigApplyResult,
  type ConfigProposal,
  type ConfigUndoReceipt,
} from '@/src/config/runtime';
import type { ConfigSource, ConfigSnapshot, ConfigValidationError, ControlPlaneState } from '@/src/config/types';

export type AiConfigDraft = {
  id: string;
  title: string;
  reason: string;
  raw: string;
};

export type AiConfigPreview = {
  proposal: ConfigProposal;
  added_keys: string[];
  changed_keys: string[];
  can_apply: boolean;
  errors: ConfigValidationError[];
};

export function previewAiConfigDraft(input: {
  draft: AiConfigDraft;
  previous?: ControlPlaneState;
  now?: string;
}): AiConfigPreview {
  const blocked = rejectDataPlaneCommands(input.draft.raw);
  const source = aiDraftSource(input.draft, input.now);
  const snapshot = aiDraftSnapshot(input.draft, source, input.now);
  const proposal = buildConfigProposal({
    previous: input.previous,
    now: input.now,
    snapshots: blocked
      ? []
      : [{ source, snapshot }],
  });
  const finalProposal = blocked
    ? { ...proposal, errors: [...proposal.errors, blocked] }
    : proposal;

  return {
    proposal: finalProposal,
    ...diffTopLevelKeys(input.previous?.manifests ?? {}, finalProposal.document),
    can_apply: finalProposal.errors.length === 0 && finalProposal.conflicts.length === 0,
    errors: finalProposal.errors,
  };
}

export function acceptAiConfigDraft(preview: AiConfigPreview): ConfigApplyResult {
  return applyConfigProposal(preview.proposal);
}

export function rollbackAiConfigDraft(receipt: ConfigUndoReceipt): ControlPlaneState {
  return undoConfigProposal(receipt);
}

function aiDraftSource(draft: AiConfigDraft, now?: string): ConfigSource {
  const timestamp = now ?? new Date().toISOString();
  return {
    id: `ai-draft:${draft.id}`,
    kind: 'local',
    label: draft.title,
    location: { path: `ai-drafts/${draft.id}.yaml` },
    enabled: true,
    auto_refresh: false,
    refresh_minutes: 0,
    precedence: 1000,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function aiDraftSnapshot(draft: AiConfigDraft, source: ConfigSource, now?: string): ConfigSnapshot {
  return {
    source_id: source.id,
    fetched_at: now ?? new Date().toISOString(),
    content_hash: `ai-draft:${draft.id}`,
    raw: draft.raw,
    validation_status: 'unvalidated',
  };
}

function rejectDataPlaneCommands(raw: string): ConfigValidationError | null {
  const normalized = raw.toLowerCase();
  const forbidden = [
    'insert into records',
    'update records',
    'delete from records',
    'create_record',
    'update_record',
    'archive_record',
    'delete_record',
    'source_provider:',
    '"source_provider"',
  ];
  const hit = forbidden.find((pattern) => normalized.includes(pattern));
  if (!hit) return null;
  return {
    code: 'CONFIG_AI_DATA_PLANE_COMMAND',
    message: `AI config draft contains a data-plane command: ${hit}`,
  };
}

function diffTopLevelKeys(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const added_keys: string[] = [];
  const changed_keys: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!(key in previous)) {
      added_keys.push(key);
      continue;
    }
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
      changed_keys.push(key);
    }
  }
  return { added_keys, changed_keys };
}
