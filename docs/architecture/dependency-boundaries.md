# Dependency Boundaries

## Goal

Keep the app split into clear layers:

- `src/presentation` stays UI-only.
- `server/src` stays server-only.
- `src/providers` stays isolated from UI and server entrypoints.
- `app/` stays mostly thin route glue.

## Enforced now

- `src/presentation` must not import `server/`.
- `server/src` must not import `app/`.
- `src/providers` and `server/src/providers` must not import UI entrypoints.

## Deferred

- A blanket app-route thinness rule.

Reason: several current route files do real screen work already, so forcing a hard rule now would be noisy. The follow-up is to peel those screens into feature modules first, then tighten the route rule.

## Runbook

- Use `npm run check:dependency-boundaries` for the automated layer check.
- Keep route files small when adding new screens; move data loading and business logic into `src/`.
