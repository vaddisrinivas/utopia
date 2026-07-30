import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const boundaryScript = await import(pathToFileURL(resolve(root, 'scripts/quality/check-core-boundaries.mjs')).href);
const { collectCoreBoundaryViolationsFromSourceFiles, formatCoreBoundaryViolations } = boundaryScript;
const requireRootConfig = createRequire(import.meta.url);

describe('core boundary documentation and rules', () => {
  it('documents each core authority surface and gate intent', () => {
    const markdown = readFileSync(resolve(root, 'docs/core-boundary.md'), 'utf8');
    for (const heading of [
      '## Package authority',
      '## Runtime authority',
      '## Renderer authority',
      '## Capability authority',
      '## Storage authority',
      '## Sync authority',
      '## Gate rules (enforce now)',
      '## Known gaps (snapshot)',
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it('flags forbidden imports in sample core-facing modules', () => {
    const violations = collectCoreBoundaryViolationsFromSourceFiles([
      {
        filePath: resolve(root, 'src/domain/runtime-context.tsx'),
        content: 'import { createContext } from "react";\n',
      },
      {
        filePath: resolve(root, 'src/workflows/runtime.ts'),
        content: 'import { transitionWorkflow } from "@/server/src/workflows/control-machine";\n',
      },
      {
        filePath: resolve(root, 'src/domain/queries.ts'),
        content: 'import { getProviderStatus } from "@/src/providers/provider-status";\n',
      },
      {
        filePath: resolve(root, 'src/domain/queries.ts'),
        content: 'import { canonicalJson } from "@/packages/shared/contracts/canonical-json";\n',
      },
    ]);

    expect(formatCoreBoundaryViolations(violations)).toEqual(
      expect.arrayContaining([
        'src/domain/runtime-context.tsx -> react (forbid-react-native-or-ui-frontend)',
        'src/workflows/runtime.ts -> @/server/src/workflows/control-machine (forbid-core-import-of-server)',
        'src/domain/queries.ts -> @/src/providers/provider-status (forbid-core-import-of-providers)',
      ]),
    );
  });

  it('keeps dependency cruiser config aligned with core boundary rules', () => {
    const config = requireRootConfig(resolve(root, '.dependency-cruiser.cjs'));
    const ruleNames = new Set(config.forbidden.map((rule: { name: string }) => rule.name));
    for (const name of [
      'core-no-server-imports',
      'core-no-app-imports',
      'core-no-provider-imports',
      'core-no-cloudflare-runtime',
      'core-no-react-or-expo-ui',
    ]) {
      expect(ruleNames.has(name)).toBe(true);
    }
  });
});
