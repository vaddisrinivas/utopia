# Utopia Platform Scorecard

Status values: `PROVEN`, `PARTIAL`, `BLOCKED`, `PARKED`, `UNPROVEN`.
`PROVEN` requires the named evidence, not source presence.

| Aspect | Status | Current evidence / next gate |
|---|---|---|
| Core contracts | PARTIAL | Shared AJV authority exists. NEXT-GATE: enforce the public Core boundary. |
| Compiler/runtime | PARTIAL | Compiler and expression corpus checks exist. NEXT-GATE: headless conformance across runtimes. |
| Renderer/widgets | PARTIAL | Generic extraction and debt ratchet exist. NEXT-GATE: eliminate Core domain references. |
| Capability safety | PARTIAL | Broker and install grants exist. NEXT-GATE: hostile revoke and update proof. |
| Storage | PARTIAL | SQLite reference behavior exists. NEXT-GATE: backup, restore, and device-loss proof. |
| Sync | BLOCKED | BLOCKED: local deterministic proof only; real multi-device provider proof is absent. |
| Android/iOS/web/macOS shells | PARTIAL | Exports and adapter checks exist. NEXT-GATE: signed physical-device parity proof. |
| Authoring | PARTIAL | CLI, factory, and builder exist. NEXT-GATE: novice completion evidence. |
| Apps | PARTIAL | Sentinel apps exist. NEXT-GATE: 20 usable proofs and 75 percent package-only evidence. |
| Registry | PARTIAL | Immutable/checksum/publish controls exist. NEXT-GATE: public availability evidence. |
| Hosted service | PARKED | NEXT-GATE: tenant, role, recovery, and SLO proof. |
| Security/privacy | PARTIAL | Telemetry contract exists. NEXT-GATE: real OSV/SBOM/provenance gate and external review. |
| Documentation/DX | PARTIAL | Guides and skills exist. NEXT-GATE: independent clean-machine reproduction. |
| Operations/release | BLOCKED | BLOCKED: signed physical release proof is parked. |
| Adoption | UNPROVEN | NEXT-GATE: external creator, install, and retention evidence. |

## Evidence Rules

- Local, mocked, export, simulator, and static-source checks cannot prove live,
  signed-device, hosted-service, or user outcomes.
- Every `BLOCKED` row names the next required evidence in its gate or launch
  readiness document.
- Updates must change the status only when the relevant gate passes.
