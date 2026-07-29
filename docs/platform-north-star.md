# Platform North Star

## One-liner

Utopia is a package-driven platform for personal software: install an app package, connect real data, and safely evolve it with AI and shared contracts.

## Target Users

- Personal use: one person managing daily life, routines, and records.
- Family use: a household sharing plans, lists, chores, calendars, and inventories.
- Small company use: a tiny team running lightweight internal workflows and dashboards.
- Group use: a club, community, or project team coordinating shared records and actions.

## Non-Goals

- Not a generic app store for arbitrary native code.
- Not a one-off app factory for custom bespoke screens per request.
- Not a company-specific product centered on Food; Food is only the reference app.
- Not a rewrite of the shell for each new app.
- Not a place for unvalidated writes, hidden side effects, or unclear ownership.

## Core Loop

1. Choose a template or package.
2. Create an app.
3. Use records.
4. Edit the package.
5. Sync or share the result.
6. Install another app and repeat.

## Status Tiers

### Core

Must exist for the platform to feel real and reusable.

- package install and preview;
- validated records and canonical writes;
- generic renderer and widget registry;
- package edit flow;
- sync/share path;
- app launch and app switching;
- deterministic chat responses tied to contracts.

### Supporting

Should exist to make Core easier, safer, or faster.

- templates and starter packages;
- provider connections;
- package authoring tools;
- approvals and trust labels;
- exportable evidence and validation gates;
- reusable design tokens and layout helpers;
- import/export and backup flows.

### Experimental

Allowed to explore, but not to define the platform contract.

- new widget ideas;
- AI-assisted package generation;
- alternate provider homes;
- new shell surfaces;
- preview-only app ideas;
- opinionated domain helpers that may later become generic.

### Archive

Keep for reference only.

- one-off hacks;
- deprecated package shapes;
- obsolete UI flows;
- dead-end experiments;
- domain-specific code that no longer fits the platform model.

## Decision Rules

- Prefer generic platform capability over app-specific code.
- Add new UI only when the capability belongs in the reusable shell or renderer.
- Put product behavior in packages first, not in ad hoc native screens.
- If a feature helps only one app, keep it out of Core.
- If a feature repeats across apps, promote it toward Core or Supporting.
- If AI proposes changes, the contract decides whether they can run.
- If a change weakens determinism, validation, or source traceability, reject it.
- If a change improves Food but does not improve the platform, treat it as app-local only.
- If a change would require editing Expo UI files for a platform rule, stop and look for a package or server solution first.
- If a feature cannot survive install, edit, sync/share, and reinstall, it is not platform-grade yet.

## Product Boundaries

- Shell: small, stable, reusable.
- Packages: where app behavior lives.
- Records: the source of truth for user data.
- AI: helper for proposals and edits, never an unchecked writer.
- Food: the first bundled proof app, not the identity of the platform.
