# Dead Code And Gate Sprawl Audit

Date: 2026-07-28

Scope:

- Local repo only.
- No file deletions.
- No Expo UI file edits.
- No `packages/domain-shared` edits.

## Method

- Read `package.json`, `docs/gates.md`, `docs/release-security.md`, and
  `docs/archive/CODEBASE_FILE_BY_FILE_REVIEW.md`.
- Clustered npm scripts by purpose and duplicate command text.
- Tried `npx --yes knip --version` as a low-risk dead-code probe.

## Limit

- `npx knip` did not complete on this host because the downloaded `oxc-parser` native binding failed to load under system policy.
- Because of that, this pass does not claim exhaustive dead-code detection.
- No knip wrapper script was added. That kept the repo clean and avoided a brittle gate.

## Findings

### 1. Gate taxonomy is real, but package.json still mixes four different job types

Current sources already separate the intent:

- `docs/release-security.md:12-20` defines the release gate set.
- `docs/gates.md:3-11` says `scripts/gates/*` are the preferred wrappers and `scripts/quality/*` are proof/evidence checks and historical validators.

`package.json` still mixes:

- release gates
- product gates
- proof scripts
- historical helpers

That makes it hard to answer “what must pass before I ship?” without reading multiple layers.

### 2. Duplicate alias clusters are the main sprawl, not dead files

High-confidence duplication in `package.json`:

- `check:collaboration-membership`, `check:collaboration-policy`, `check:collaboration-stream`, `check:collaboration` all run the same test file.
- `check:composition-contracts`, `check:app-compositions`, `check:composition-writes`, `check:composition` all run the same test file.
- `android` and `android:release` are the same release command.
- `check:migrations` and `check:control-plane-c0` are the same test file.

That is not dead code, but it is gate noise.

### 3. Product gates are overloaded

`package.json:137-151` shows the big product paths:

- `check:utopia-debug`
- `check:product`
- `check:product:native`
- `check:product:full`
- `quality`

These commands bundle many checks together, but the naming does not clearly distinguish:

- day-to-day product confidence
- release readiness
- live-provider validation
- historical evidence checks

### 4. Proof scripts are valuable, but they read like a second release system

Examples in `package.json:138-171` and `package.json:172-195`:

- `check:utopia-single-shot`
- `check:utopia-connected`
- `check:utopia-h1-e2e`
- `check:provider-standalone-authority`
- `check:live-providers`
- `phase4:check:mcp`
- `phase5:check`
- `phase6:check`
- `phase7:check:workflow-resume-cancel`
- `phase8:*`
- `phase9:*`

These are useful proof scripts, but they should stay clearly labeled as evidence or scenario proofs, not release gate primitives.

### 5. Historical scripts should stay callable, but out of the release path

`scripts/quality/*` contains good historical and scenario material.

Keep these as historical unless they are explicitly promoted:

- provider live proofs
- Notion/sheets adapter checks
- MCP replay/tool contract checks
- cleanup and evidence writers
- completion audit / polish review scripts

## Recommendation

- Keep `docs/release-security.md` as the source of truth for release gates.
- Keep `docs/gates.md` as the taxonomy doc for wrappers vs proof checks.
- Do not add a knip wrapper until the local knip probe is stable on this machine.
- If gate cleanup continues, collapse only the alias clusters first.
- Do not delete scripts yet; classify them first.

## File References

- `package.json:67-195`
- `docs/gates.md:3-11`
- `docs/release-security.md:12-20`
- `docs/archive/CODEBASE_FILE_BY_FILE_REVIEW.md:21-24`
