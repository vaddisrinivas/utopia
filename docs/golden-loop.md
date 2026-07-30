# Utopia Golden Loop

The Golden Loop is Utopia's active integration target. The larger master plan
remains an audit checklist; work counts only when it improves this vertical.

```text
natural-language request
  -> deterministic package
  -> review and approved install
  -> local records
  -> approved update
  -> rollback with data preserved
  -> signed registry and capability checks
  -> local conflict/recovery proof
  -> Android x2, web, and macOS execution receipts
```

Run:

```bash
npm run proof:golden-loop
```

Evidence is written to:

```text
app/build/evidence/golden-loop/golden-loop-proof.json
```

`local_platform_status=PASS` means all required local implementation stages
passed. `GOLDEN_LOOP=PASS` additionally requires the live multi-surface and
cross-runtime evidence stages. Missing receipts remain `BLOCKED`; they are
never converted into a local pass.

Required external receipts:

- one fresh, unaided creator run completed in 600 seconds or less;
- two distinct Android installations;
- one web installation;
- one macOS installation;
- one matching package checksum across all four installations;
- conflict detection, rollback replay, and convergence on every surface.

The reference package is `Shared Household Board`. It must use only generic
widgets and must require no app-specific runtime code.
