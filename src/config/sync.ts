import { fetchConfigSource, type ConfigFetcher } from '@/src/config/fetchers';
import { buildConfigProposal, type ConfigProposal } from '@/src/config/runtime';
import type {
  ConfigConflict,
  ConfigSource,
  ConfigSourceKind,
  ConfigSnapshot,
  ConfigValidationError,
  ControlPlaneState,
} from '@/src/config/types';

export type ConfigSyncStore = {
  saveSource: (source: ConfigSource) => Promise<void>;
  saveSnapshot: (snapshot: ConfigSnapshot) => Promise<void>;
  saveConflict: (conflict: ConfigConflict) => Promise<void>;
};

export type ConfigSyncResult = {
  proposal: ConfigProposal;
  fetched: ConfigSnapshot[];
  errors: ConfigValidationError[];
};

export async function syncConfigSources(input: {
  sources: ConfigSource[];
  store: ConfigSyncStore;
  previous?: ControlPlaneState;
  now?: string;
  fetcher?: ConfigFetcher;
  localFiles?: Record<string, string>;
  credentials?: Partial<Record<ConfigSourceKind, string>>;
}): Promise<ConfigSyncResult> {
  const fetched: ConfigSnapshot[] = [];
  const errors: ConfigValidationError[] = [];

  for (const source of input.sources) {
    await input.store.saveSource(source);
    if (!source.enabled) continue;

    const result = await fetchConfigSource({
      source,
      now: input.now,
      fetcher: input.fetcher,
      localFiles: input.localFiles,
      credentials: input.credentials,
    });
    if (result.ok) {
      fetched.push(result.snapshot);
      await input.store.saveSnapshot(result.snapshot);
    } else {
      errors.push({ ...result.error, path: source.id });
    }
  }

  const proposal = buildConfigProposal({
    previous: input.previous,
    now: input.now,
    snapshots: fetched.map((snapshot) => {
      const source = input.sources.find((candidate) => candidate.id === snapshot.source_id);
      if (!source) throw new Error(`Missing source for config snapshot ${snapshot.source_id}.`);
      return { source, snapshot };
    }),
  });

  const finalProposal = {
    ...proposal,
    errors: [...errors, ...proposal.errors],
  };
  for (const conflict of finalProposal.conflicts) {
    await input.store.saveConflict(conflict);
  }

  return {
    proposal: finalProposal,
    fetched,
    errors: finalProposal.errors,
  };
}
