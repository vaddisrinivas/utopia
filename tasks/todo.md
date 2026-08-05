# Kernel V2 Checklist

## Contract

- [ ] Classify the existing test suite.
- [ ] Freeze retained behavior tests.
- [ ] Define the Zod package contract.
- [ ] Generate external JSON Schema.
- [ ] Build legacy package adapters.
- [ ] Pass package differential tests.

## Runtime

- [x] Replace workflow transition table with XState.
- [ ] Migrate SQLite records and installations.
- [ ] Migrate expression, recurrence, and timing engines.
- [ ] Migrate undo, recovery, and offline behavior.
- [ ] Remove unused providers and duplicate validators.

## Presentation

- [ ] Add Tamagui/Victory/SVG/Skia dependencies.
- [ ] Build the library-backed JSON component registry.
- [ ] Replace custom shell controls.
- [ ] Add direct app launcher and shell-level settings.
- [ ] Delete replaced renderer code.

## Proof

- [ ] Prove 15 capability-distinct gold apps.
- [ ] Compile all canonical packages.
- [ ] Pass web export and runtime.
- [ ] Pass Android emulator.
- [ ] Pass iOS simulator.
- [ ] Pass macOS shell.
- [ ] Pass accessibility, persistence, offline, and error-path oracles.
- [ ] Reach under 20k owned reachable LOC; target 10k.
