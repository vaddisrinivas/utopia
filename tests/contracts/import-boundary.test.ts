import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AppPackageV2,
  type CanonicalRecord,
  type OperationProposal,
  type OperationResult,
  type QuerySpec,
  type ReactiveProposalExecutionReceipt,
  type WorkflowReceiptSummary,
} from '@/packages/shared/contracts';

describe('shared contracts boundary', () => {
  it('rejects imports outside contract layer', () => {
    const contractsDir = resolve(process.cwd(), 'packages/shared/contracts');
    const files = readdirSync(contractsDir).filter((file) => file.endsWith('.ts'));
    const allowedExternal = new Set(['js-sha256', 'json-canonicalize', 'zod']);
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(resolve(contractsDir, file), 'utf8');
      const imports = Array.from(source.matchAll(/^\s*import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm))
        .map((match) => match[1]);

      for (const specifier of imports) {
        if (
          specifier.startsWith('./') ||
          specifier.startsWith('../') ||
          specifier.startsWith('@/packages/shared/contracts') ||
          allowedExternal.has(specifier)
        ) {
          continue;
        }
        violations.push(`${file} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('supports compile-time import of stable contract surface', () => {
    type SharedContractTypeMap = {
      package: AppPackageV2;
      record: CanonicalRecord;
      operation: OperationResult;
      proposal: OperationProposal;
      query: QuerySpec;
      receipt: ReactiveProposalExecutionReceipt;
      workflow: WorkflowReceiptSummary;
    };
    expectTypeOf<SharedContractTypeMap>().toBeObject();
  });
});
