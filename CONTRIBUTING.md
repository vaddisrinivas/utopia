# Contributing to Utopia

Contributions are welcome. Keep changes small, explain user-visible behavior, and add
tests for every changed command, persistence rule, parser, migration, or navigation path.

Before opening a pull request, run:

```bash
./scripts/quality/android-harness.sh local
```

When Android behavior or storage changes, also run:

```bash
./scripts/quality/android-harness.sh connected
```

Rules:

- Never commit real pantry data, receipts, health data, account identifiers, API keys,
  local databases, screenshots containing user data, or machine-specific paths.
- External and AI-originated changes must remain review-first.
- Bulk mutations must be atomic and idempotent.
- Preserve unknown nutrition values as unknown; do not invent defaults.
- New exported Android entry points require malformed-input and replay tests.
- Update the public contract docs when adding action types or fields.

By contributing, you agree that your contribution is licensed under Apache-2.0.

