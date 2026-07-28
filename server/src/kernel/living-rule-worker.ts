import type { AppPackage } from './package';
import { runReactiveCycle, type ReactiveCycleInput, type ReactiveCycleResult } from './reactive-cycle';

type RuleWorkerInput = Omit<ReactiveCycleInput, 'data'> & { data?: unknown };

type CanonicalRuleContext = Readonly<{
  packageId: string;
  packageVersion: string;
  causeId: string;
  records: {
    before: ReadonlyArray<Record<string, unknown>>;
    after: ReadonlyArray<Record<string, unknown>>;
  };
  inputData?: Record<string, unknown>;
}>;

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function runLivingRuleWorker(input: RuleWorkerInput): ReactiveCycleResult {
  const inputData = toRecord(input.data);
  const context: CanonicalRuleContext = {
    packageId: input.package.id,
    packageVersion: input.package.version,
    causeId: input.causeId,
    records: {
      before: input.beforeRows,
      after: input.afterRows,
    },
    ...(Object.keys(inputData).length ? { inputData } : {}),
  };

  return runReactiveCycle({
    ...input,
    data: {
      ...inputData,
      canonical: context,
    },
  });
}
