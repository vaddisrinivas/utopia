# Utopia Kernel V2 Migration

## Goal

Migrate proven Utopia behavior into a small JSON-native platform. Prefer mature
libraries over owned implementations. Preserve the old checkout as reference
and rollback; cut over only after behavioral and four-shell parity.

## Architecture

- Zod owns TypeScript runtime contracts and emits JSON Schema where possible.
- AJV validates external JSON Schema packages.
- JSON Render interprets package screens.
- Tamagui owns layout, controls, themes, sheets, dialogs, and responsive UI.
- Victory, SVG, and Skia own charts, vectors, gauges, canvas, and rich graphics.
- XState owns workflows and resumable state machines.
- Expo SQLite owns local persistence.
- Expo modules own native capabilities.
- RRule, JSON Logic, JSON Patch, canonicalize, and SHA libraries remain the
  canonical engines for their domains.
- Utopia owns only schemas, adapters, policy, persistence mapping, and package
  loading. Apps contain JSON and assets, never runtime branches.

## Migration Rules

1. Migrate tests before implementation.
2. Classify each test: retained behavior, compatibility, proof, or research-only.
3. Copy proven code only when a retained test requires it.
4. Replace custom equivalents with libraries before copying them.
5. Preserve observable behavior with old/new differential oracles.
6. No app-specific runtime code.
7. Count reachable owned production LOC; generated or relocated code still counts.

## Phases

### 1. Contract

- Inventory and classify existing tests.
- Define Zod package contract and JSON Schema export.
- Add lossless adapters for supported legacy package versions.
- Differentially validate canonical packages against the old runtime.

### 2. Runtime

- Migrate SQLite record and installation behavior.
- Migrate workflows to XState.
- Migrate expressions, recurrence, timing, undo, recovery, and offline behavior.
- Keep only capability adapters referenced by packages.

### 3. Presentation

- Build a small JSON Render registry.
- Back primitives with Tamagui.
- Back charts/vectors/canvas with Victory, SVG, and Skia.
- Replace shell administration screens with shell settings and a direct app launcher.

### 4. Gold Apps

- Prove 15 apps with non-overlapping capability coverage.
- Require arbitrary user data, navigation, restart, offline/error states,
  accessibility, and executable workflow oracles.
- Require zero app-specific runtime code.

### 5. Bulk Compatibility

- Compile every canonical package through legacy adapters.
- Classify failures by generic capability gap.
- Add only reusable adapters that unlock multiple packages.

### 6. Cutover

- Pass web, Android emulator, iOS simulator, and macOS shell checks.
- Pass required repository checks and differential tests.
- Require reachable owned production LOC below 20k; target 10k.
- Merge once, with the old platform retained as rollback history.

## Stop Conditions

- A library migration changes observable behavior without an accepted contract change.
- A proposed adapter is app-specific.
- A package requires private data, secrets, or fabricated provider/device evidence.
- LOC rises without unlocking a measured capability.

## Checkpoints

- Contract: all selected contract tests pass.
- Runtime: persistence/workflow/recovery tests pass.
- Presentation: 15 gold apps render and operate across four shells.
- Cutover: old/new oracle parity, required checks, LOC gate, and rollback plan pass.
