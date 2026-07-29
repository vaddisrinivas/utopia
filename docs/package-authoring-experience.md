# Package Authoring Experience

Goal: let a creator go from a fresh template to a trusted install in about 10 minutes, without touching Expo UI files.

## 10-minute path

1. Start from `create-utopia-app/template`.
2. Edit the source folders.
3. Compile the package.
4. Preview the package diff and runtime shape.
5. Install the package.
6. Review trust and approval.
7. Update or remove with rollback safety.

## GitHub natural-language path

This is the fork-first workflow for non-technical creators:

1. Add `OPENAI_API_KEY` as a GitHub Actions repository secret.
2. Edit `requests/app-idea.md` in plain English.
3. Run `Generate Utopia App`.
4. Download the generated artifact.
5. Review `source/`, `package.json`, `preview.json`, and `manifest.json`.
6. Install only after the local trust preview is acceptable.

This path is intentionally review-only. AI generates package source; Utopia contracts decide whether it can compile and be reviewed. If the key is missing, the workflow skips generation cleanly and reports the missing secret in the run summary.

## Exact file layout

Use the same source contract that `readAppPackageSourceFolder()` already reads.

```text
create-utopia-app/
  template/
    app.json
    collections/
      *.json
    queries/
      *.json
    screens/
      *.json
    rules/
      *.json
    workflows/
      *.json
    providers/
      *.json
    theme/
      *.json
    fixtures/
      *.json
    acceptance/
      *.json
    capabilities/
      package.json | packages.json
      dependency-pins.json
      native.json
      pinned-at.json
```

### Folder rules

- `app.json` is required.
- `collections`, `queries`, `screens`, and `rules` are object maps keyed by file name.
- `workflows`, `providers`, `theme`, `fixtures`, and `acceptance` are optional object maps.
- `capabilities/` is optional, but when present it owns package pins, native capability data, and the pinned timestamp.
- The reference shape already exists in `tests/fixtures/package-source/reference-app/`.

### Minimum starter set

```text
create-utopia-app/template/
  app.json
  collections/
    assignment.json
    chore.json
    completion.json
    household_member.json
  queries/
    chore_list.json
    completion_log.json
    household_roster.json
    today_assignments.json
  screens/
    chores.json
    household.json
    review.json
    today.json
  acceptance/
    reference-renderer.json
```

## Source folders

- `app.json`: package id, version, label, home surface.
- `collections/`: canonical data model.
- `queries/`: read models and filters.
- `screens/`: presentation surface and widget wiring.
- `rules/`: automation rules.
- `workflows/`: multi-step actions.
- `providers/`: external home settings and source mappings.
- `theme/`: visual tokens.
- `fixtures/`: seeded local test data.
- `acceptance/`: package-level checks and renderer expectations.
- `capabilities/`: package pins, dependency pins, native capabilities, and the pin date.

## Compiler

The compiler already gives the right backbone:

- `readAppPackageSourceFolder()` loads the template tree.
- `compileAppPackageSource()` validates shape, normalizes it, builds the package, and emits preview metadata.
- `collectSourceIssues()` enforces folder-level shape and reference integrity.
- `collectPackageIssues()` enforces compiled package validity.

What the creator sees:

- source errors before compile;
- package checksum;
- semantic diff;
- preview metadata:
  - collection ids;
  - query ids;
  - rule ids;
  - widgets;
  - acceptance tests;
  - source counts;
  - native capability summary when present.

## Preview

Show two previews, not one:

- Authoring preview: compile the source tree and show validation, diff, checksum, and risk.
- Install preview: show screens, collections, providers, permissions, widgets, plugins, fallbacks, and trust.

Trust labels already exist:

- `Checksum verified`
- `Checksum mismatch`
- `Unknown remote package - review required`

## Install

Install should stay review-gated.

Current flow:

1. fetch package or registry entry;
2. build install preview;
3. require approval receipt;
4. install the approved package;
5. activate the installation.

The approval path must keep:

- package id and version;
- checksum;
- preview hash;
- approval actor;
- approval time.

## Trust

Trust is the thing that stops a package from becoming "just code from the internet".

Minimum trust rules:

- checksum present and matching when a registry provides one;
- checksum missing is allowed only with explicit review;
- checksum mismatch blocks install;
- approval must be explicit;
- the proposer cannot self-approve;
- approval and activation receipts must be hashable and auditable.

## Update / remove

Update path:

1. load the current source;
2. compute `baseSourceRevision`;
3. apply a bounded RFC6902 patch;
4. recompile;
5. preview the diff and risk;
6. require approval;
7. publish `nextSourceRevision`.

Remove path:

- treat remove as a review-gated destructive change, not a silent delete;
- preserve `rollbackSourceRevision`;
- keep rollback available until a real uninstall flow exists;
- use the same approval and receipt rules as update.

## Commands to add later

Add these only when the matching behavior exists:

| Command | Purpose |
|---|---|
| `npm run check:package-template` | Validate the template tree and required files. |
| `npm run check:package-template-preview` | Validate compile output, preview metadata, and trust labels. |
| `npm run check:package-template-install` | Validate install preview, approval, and activation. |
| `npm run check:package-template-update-remove` | Validate update, remove, and rollback behavior. |

Keep the current gates in place:

- `npm run check:package-authoring`
- `npm run check:package-compiler`
- `npm run check:link-install`
- `npm run check:package-control-room`

## Acceptance tests

Current tests that already anchor this experience:

- `tests/platform/package-authoring.test.ts`
- `tests/platform/package-compiler.test.ts`
- `tests/platform/package-install-flow.test.ts`

Add next:

- template scaffold test for exact folder layout;
- preview snapshot test for compile metadata;
- update/remove test for rollback-safe source changes;
- install trust test for checksum verified vs missing vs mismatch;
- rejection test for self-approval and stale base revision.

## First implementation PR

Title:

- `feat(package-authoring): scaffold create-utopia-app template and preview path`

Scope:

- add `create-utopia-app/template` with the minimum starter set;
- wire the template through the existing source loader and compiler;
- expose preview metadata for authoring and install trust;
- add tests for layout, compile, preview, and approval gating;
- do not touch Expo UI files;
- do not expand into unrelated package editing.

Good stop point:

- a creator can clone the template, compile it, preview it, and install it with trust checks;
- update/remove still uses rollback-safe receipts, even if the UI is simple.

## Risks

- Empty optional folders can look like missing features unless the preview makes them explicit.
- Remove can be mistaken for uninstall; call it rollback until a real uninstall contract exists.
- Trust labels are easy to overstate; only claim "verified" when checksum and approval both line up.
- Keep this slice server/runtime only for now.
