# Reference Apps Strategy

Goal: prove the platform can ship many ordinary apps with the same small runtime surface.

Food is the stress test. The other four should feel boring:
- one primary job
- one core collection family
- one default screen
- one no-AI path
- one optional AI assist path
- one provider story

## Shared widget set

Use the same generic widgets everywhere:
- `metric`
- `recordList`
- `dataTable`
- `timeline`
- `form`
- `emptyState`
- `assistantChat` only where AI is optional, never required

## Design rules

- Start with local-first CRUD.
- Keep data models flat enough for JSON-render and SQLite.
- Avoid app-specific widgets unless a generic widget cannot express the job.
- Treat AI as a helper that can summarize, draft, or classify, not as the primary interaction.
- Every app must work without network AI.

## Reference apps

| App | Job | Generic widgets used | Data model size | No-AI path | AI optional path | Provider needs | Acceptance tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Food | Plan meals, track inventory, and close the loop from pantry to plate | `metric`, `recordList`, `dataTable`, `timeline`, `form`, `assistantChat` | Large: 4 to 8 collections, 12 to 20 key fields, multiple linked records | Browse inventory, plan meals, log consumption, create shopping list manually | Suggest meals from inventory, draft grocery list, summarize spoilage, classify receipts | Local storage first; optional recipes/content provider; optional shopping or email provider; optional AI provider | Renderer smoke, no-AI task completion, inventory-to-meal flow, shopping list creation, provider fallback, rollback/idempotency |
| Chores | Track household work and repeatable routines | `metric`, `recordList`, `form`, `emptyState` | Small: 1 to 2 collections, 5 to 8 fields | Add chore, assign owner, mark done, review list | Suggest next chore, group similar chores, draft weekly plan | Local storage only; optional calendar or reminders provider; optional AI provider | List render, add/edit/complete, recurrence behavior, empty state, rollback/idempotency |
| Subscriptions | Track renewal dates and avoid surprise spend | `metric`, `recordList`, `timeline`, `form` | Small: 1 to 2 collections, 5 to 8 fields | Add subscription, sort by renewal date, cancel or archive, review spend manually | Forecast renewals, draft cancel notes, flag duplicates, summarize monthly spend | Local storage first; optional email provider for receipts; optional payment/statement import; optional AI provider | Timeline render, renewal sorting, reminder surface, no-AI monthly review, rollback/idempotency |
| Plants | Track watering, care, and health at a glance | `metric`, `recordList`, `timeline`, `form` | Small: 1 to 2 collections, 5 to 7 fields | Log watering, view care schedule, note plant status | Suggest care cadence, flag likely overwatering, draft care notes | Local storage only; optional photo provider; optional AI provider | Table/list render, watering log, schedule aging, offline use, rollback/idempotency |
| Personal CRM | Keep lightweight relationship notes and follow-ups current | `metric`, `recordList`, `timeline`, `form` | Medium: 2 to 4 collections, 8 to 14 fields | Log contact, note last touch, schedule follow-up, search by name | Draft follow-up messages, summarize history, suggest next touchpoint, tag relationship type | Local storage first; optional email/calendar provider; optional AI provider | Search/list render, follow-up flow, note capture, contact timeline, rollback/idempotency |

## Food stress test

Food should stay the hardest app because it proves the runtime handles:
- multiple linked collections
- several screens
- mixed list, metric, timeline, and form layouts
- state that changes often
- optional provider-backed enrichment
- optional AI without breaking the non-AI path

If Food stays simple to author, the other four apps should be trivial.

## What each app proves

- Food proves the platform handles real multi-step household workflows.
- Chores proves recurring CRUD is easy.
- Subscriptions proves date-heavy tracking is easy.
- Plants proves the same UI can handle low-ceremony logging.
- Personal CRM proves relationship tracking does not need custom app plumbing.

## Acceptance bar

Each reference app is accepted only if all of these hold:
- It compiles with the shared package pipeline.
- Its default path works with no AI configured.
- Its UI uses only the shared widget set, plus `assistantChat` when explicitly optional.
- Its provider failures degrade to local-only behavior.
- Its rollback and resend behavior stays idempotent.
- Its fixtures can be rendered by the same reference renderer tests.

## Recommended test matrix

- Package compile test for each app fixture.
- Renderer smoke test for each default screen.
- Empty-state test for each list-heavy screen.
- No-AI path test for each primary user flow.
- Optional AI test for each app that declares one.
- Provider fallback test for each external dependency.
- Rollback/idempotency test for create, update, and resend.

## Bottom line

One strong runtime should make five different apps feel like the same boring product system.
