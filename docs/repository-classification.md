# Repository Directory Classification

Purpose: maintain a non-technical inventory of repository directories by ownership lane.

Allowed categories: Core, shell, authoring, service, app, test, generated, tooling.

| Directory | Category | Why |
|---|---|---|
| .github | tooling | CI workflows, issue/PR templates, and gate wiring |
| adapters | Core | platform adapters behind portable Core ports |
| agents | tooling | local agent runtime notes and prompts |
| android | shell | Android native shell project for app packaging |
| app | shell | Expo app shell and runtime entrypoints |
| apps | app | bundled reference apps and package examples |
| assets | tooling | static assets used by shell/app and docs |
| cloudflare | service | hosted registry worker and deployment surface |
| docs | tooling | architecture, policy, and scorecard evidence |
| fastlane | tooling | release helper scripts and automation glue |
| ios | shell | iOS native shell project |
| macos | shell | macOS native shell project |
| packages | Core | runtime packages and shared domain contracts |
| packages/app-compiler | authoring | app JSON package compiler and source transforms |
| packages/domain-config | Core | domain configuration model |
| packages/runtime-kernel | Core | shared expression/runtime primitives |
| packages/schemas | Core | schema registry and validator inputs |
| packages/shared | Core | shared runtime/domain helpers |
| research | tooling | research inputs, local evidence packets, and proof ledgers |
| requests | tooling | proposal and requirement payloads |
| schemas | Core | canonical schema inputs outside generated package output |
| scripts | tooling | repository quality and release scripts |
| server | service | hosted service APIs and sync backends |
| server-data | generated | local service runtime data, never authority |
| server/src | service | service implementation |
| src | Core | app runtime, workflow, and data models |
| tasks | tooling | task-driven development scaffolding |
| tests | test | automated proof and regression coverage |
| tests/fixtures | test | deterministic evidence fixtures and samples |
| tmp | generated | disposable local proof and test workspace; never authority |
| dist | generated | export output target (ignored until built) |
| build | generated | general build output target (ignored until built) |
| web-build | generated | Expo web output target (ignored until built) |
| outputs | generated | exported artifact outputs (ignored until built) |
| coverage | generated | coverage reports from local/lint/test runs |

Scope rule:

- Every repository root directory must appear in this table.
- Generated entries may be absent on clean trees.
