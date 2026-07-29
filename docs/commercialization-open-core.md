# Commercialization and Open-Core Strategy

Scope: this is a product and licensing strategy note for Utopia as it exists today. It does not change code or policy by itself.

## Positioning

Utopia is a package-driven app platform for personal software, built for one person, a family, a small group, or a small company.

The commercial shape should match that promise:

- the core stays useful, portable, and publishable;
- paid value comes from convenience, trust, and hosted operations, not from trapping user data;
- the platform should remain viable for self-hosted and local-first users even if they never pay.

## What stays OSS

Keep these in the open source core:

- the native shell;
- package validation and install flow;
- local SQLite storage and canonical operation handling;
- JSON package schema, widget registry, and renderers;
- provider adapters that let users connect their own homes;
- export paths, backup paths, and migration tooling;
- docs, examples, and starter packages;
- approval, rollback, and provenance mechanics;
- any code needed to run the product on a user-owned device or server.

Why:

- this is the platform moat;
- users must be able to inspect, fork, fix, and self-host;
- open code is the credibility layer for a personal software platform.

## What can be paid later

Charge for things that remove work, reduce risk, or add managed scale:

- hosted sync and always-on cloud identity;
- managed package registry and trust pipeline;
- private team registries and org controls;
- premium connectors or managed provider bridges;
- backup, recovery, device migration, and audit services;
- collaboration features that need shared infra;
- analytics, alerts, and admin dashboards for groups and companies;
- concierge onboarding, implementation, and support;
- branded distributions or white-label packaging;
- app marketplace distribution, curation, or verification.

Good rule:

- pay for operations and guarantees;
- do not paywall basic ownership of your own data.

## Apache-2.0: why it fits

Apache-2.0 is allowed if the intent is:

- maximize adoption;
- encourage external contributions;
- let people build on the platform without fear of copyleft contamination;
- preserve the right to sell hosted services and proprietary add-ons around the core.

Apache-2.0 is especially compatible with an open-core strategy because it:

- permits commercial use;
- permits redistribution and modification;
- includes an explicit patent grant;
- does not force downstream source disclosure in derivative products.

## Apache-2.0: where it is risky

Apache-2.0 also makes it easy for others to:

- fork the platform and offer a competing hosted version;
- repackage the core without giving much back;
- build a distribution that competes on convenience instead of code quality.

That is not a license bug; it is the tradeoff.

Main risks:

- weaker leverage over third-party hosted clones;
- less protection if a future business depends on code scarcity;
- no strong reciprocal pressure to keep improvements public;
- trademark confusion can become more important than code ownership.

Mitigations:

- keep the brand, logos, and product names controlled;
- use trademark policy, not source restriction, to protect identity;
- make the hosted service better, not merely different;
- own trust, sync, packaging, and support as the real business value.

## Alternative licensing decision points

Choose the license only after deciding which outcome matters most:

### 1. Apache-2.0

Best if:

- the goal is broad adoption and trust;
- community contribution matters more than code scarcity;
- self-hosting and forkability are product features.

Tradeoff:

- easiest to fork and commercialize against.

### 2. MPL-2.0

Best if:

- you want file-level copyleft on changes to existing source;
- you want more upstream pressure to share modifications;
- you still want reasonable commercial compatibility.

Tradeoff:

- more licensing friction for some partners and integrators.

### 3. AGPL-3.0

Best if:

- the main concern is SaaS cloning of a networked service;
- you want network copyleft to force service changes back upstream.

Tradeoff:

- higher adoption friction;
- can reduce enterprise comfort;
- can complicate ecosystem growth.

### 4. Dual licensing or source-available split

Best if:

- the business will rely on proprietary hosted features or embedded commercial modules;
- you need a hard line between community core and paid extensions.

Tradeoff:

- more legal and operational complexity;
- greater community skepticism;
- harder contributor story.

Decision point summary:

- if the product wins on trust and portability, Apache-2.0 is the cleanest default;
- if the product must defend against SaaS cloning, AGPL-3.0 deserves a hard look;
- if the product will sell enterprise rights or closed extensions, dual licensing becomes a serious option.

## Packaging by user type

### Personal

Package as:

- local-first app;
- one device, one account, or no account;
- simple import/export;
- optional paid sync and backup.

What to emphasize:

- privacy;
- speed;
- ownership;
- no lock-in.

### Family

Package as:

- shared homes with simple invitations;
- household-level sync and permissions;
- shared shopping, chores, schedules, and notes;
- easy recovery when a device is lost.

What to emphasize:

- shared truth;
- low setup burden;
- reliable sync;
- clear ownership of family data.

### Small company

Package as:

- team workspaces;
- admin and policy controls;
- private registry or curated packages;
- support, onboarding, and auditability;
- export and retention guarantees.

What to emphasize:

- control;
- predictable billing;
- recovery;
- compliance-friendly exports.

### Group users

Package as:

- lightweight org spaces;
- role-based access;
- shared templates and approved packages;
- optional hosted collaboration;
- easy offboarding and handoff.

What to emphasize:

- shared workflows without heavy admin;
- no forced centralization;
- easy migration out.

## Anti-lock-in promises

These should be explicit product promises:

- users can export their data;
- users can leave with a readable copy of their data;
- core apps keep working offline or in self-hosted modes where possible;
- package definitions stay documented and inspectable;
- no hidden format traps;
- no hostage pricing for basic recovery;
- no forced dependency on a single cloud provider;
- no deletion-only exit path;
- no breaking export without a migration path;
- no artificial data gravity that blocks migration.

Operational version of the promise:

- if we add a paid cloud feature, the user still owns the underlying data and can leave;
- if we add a proprietary service, it must not be the only way to read or recover core data.

## Recommended default strategy

If the goal is to grow Utopia without breaking trust:

- keep the core under Apache-2.0;
- monetize hosted convenience, collaboration, and support;
- keep local/self-hosted use first-class;
- treat the brand and the hosted service as the paid moat;
- avoid paywalling the basic right to run, inspect, and export the platform.

## Open questions to settle before launch

- Which features are truly platform core versus hosted convenience?
- Will the company ever need stronger anti-clone protection than Apache-2.0 gives?
- Which paid features are safe to ship without undermining self-hosted users?
- What exact export format guarantees will be promised at launch?
- What trademark policy is needed before any public hosted registry?

## Bottom line

Apache-2.0 is a good default if Utopia wants to be a trusted, forkable, user-owned platform with paid services around it.

It is risky only if the business later depends on code scarcity instead of service quality, brand trust, and operational convenience.
