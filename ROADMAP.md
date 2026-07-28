# Utopia roadmap

Roadmap order follows user risk and daily usefulness, not feature novelty.

## Alpha — coherent daily workspace

- Reconcile the authoritative Git history and publish the current Android tree.
- Finish the Now/Food/Week/Cart layouts and device-check empty, populated, error, and large-font states.
- Close receipt-to-Kitchen put-away gaps, including merchant, line price, storage, expiry, nutrition, and provenance.
- Complete deterministic identity/emoji/image parity across every intake route.
- Expand golden command parity across Kitchen, Shop, receipts, meals, plans, and recipes.
- Keep first-run data-home onboarding calm: Local, Google Sheets, Notion, and Postgres/Supabase must fail safe and preserve current data.

Exit: one user can run the complete food loop locally without configuring an LLM.

## Beta — dependable assistance and capture

- Validate Primary → Fallback AI routing against supported providers.
- Add production OCR and barcode providers behind existing interfaces.
- Strengthen allergy, preference, confidence, destructive merge, and bulk-command policy tests.
- Finish cooking deductions, leftovers, and recoverable shopping/put-away state.
- Validate share, notification, Samsung Routines, Google Assistant, and App Actions on physical devices.

Exit: every automated intake becomes the same editable, attributable proposal.

## 1.0 — trustworthy distribution

- Choose signing ownership and publish the certificate policy.
- Host production `assetlinks.json` for `utopia.app`.
- Configure Google OAuth for release builds without committing credentials.
- Prove release Google Sheets authorization on a physical device with the release signing certificate.
- Prove backend-switch rollback snapshot creation before a provider switch.
- Publish signed APKs with changelog, checksums, privacy notes, and migration notes.
- Prepare F-Droid metadata only after reproducible build and dependency review pass.

Exit: users can install, upgrade, back up, restore, and verify Utopia safely.

## Not roadmap items

- No mandatory cloud account.
- No AI-only core workflow.
- No direct unreviewed command mutations.
- No extra top-level AI, Health, or More destination.
