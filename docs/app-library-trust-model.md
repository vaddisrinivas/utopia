# App Library Trust Model

Scope: app registry and install flow only. This doc maps the app-library UX to the current package-install contracts and notes where trust is enforced today vs. still missing.

## Goals

- Make it obvious what an app is before install.
- Show why an app is trusted, blocked, or unknown.
- Keep install, open, remove, and update actions tied to a verifiable package identity.
- Make risky permissions and provider access visible before approval.

## Current Contract Anchors

These are the live contract points the app library should speak in:

- Registry manifest: `UtopiaRegistryManifest`
- Registry package entry: `UtopiaRegistryPackage`
- Install target parsing: `parsePackageInstallTarget()`
- Install preview: `buildPackageInstallPreview()`
- Trust state: `PackageInstallTrustStatus`
- Approval receipt: `buildPackageInstallApprovalReceipt()`
- Approval match check: `assertPackageInstallApprovalMatchesPreview()`
- App install record: `AppInstallation`
- Install execution: `installApprovedAppPackage()`
- Trust label copy: `packageInstallTrustLabel()`
- Preview row grouping: `packageInstallPreviewRows()`

Important enforcement today:

- Checksum verification is real.
- Publisher and signature metadata are part of the registry and preview contract.
- Registry signatures with public keys are cryptographically verified in the install fetch path.
- Missing signatures do not block old packages.
- Invalid signature metadata or failed signature verification blocks install review.
- Approval receipts are real.
- Runtime compatibility blocks install.
- Validation errors block install.
- Package descriptor identity mismatch blocks install.

## App Registry UX

The app library should behave like a curated shelf, not a raw file browser.

Recommended layout:

- Top area: search, registry source, and trust summary.
- Main grid or list: app cards with icon, name, version, short description, and trust badge.
- Detail panel: screenshots, categories, permissions, provider access, checksums, and install actions.
- Installed section: currently installed apps with open, update, and remove actions.

Card fields should prefer data already exposed by the registry and preview:

- `name`, `version`, `description`
- `icon` when present
- trust state from `PackageInstallTrustStatus`
- install compatibility state
- provider and permission summary

## Screenshots

Screenshots are a display aid, not a trust anchor.

Use screenshots to answer:

- What does the app look like?
- Which surfaces are included?
- Does the app feel like the thing the user expected?

Do not use screenshots as proof of integrity.

Recommended rules:

- Show screenshots after the trust summary, not before it.
- Label screenshots with the surface or screen name.
- Treat screenshots as optional assets.
- If screenshots are missing, say so clearly.
- If screenshots disagree with the previewed package surface list, prefer the package contract and flag the mismatch.

Contract mapping:

- `PackageInstallPreview.screensIncluded`
- `AppPackage.presentation.surfaces`
- `AppPackage.presentation.ui.screens`

## Categories

Categories help people sort the shelf and reason about risk.

Recommended category buckets:

- Personal
- Family
- Work
- Household
- Finance
- Health
- Productivity
- Experimental
- External / unverified

These categories are UX labels, not enforcement unless they are backed by policy.

Good category metadata can come from:

- Registry manifest description
- App package label and surface list
- Provider and permission mix
- Known publisher or team

## Install

Install is a two-step trust flow:

1. Parse the link or registry target.
2. Preview the package before approval.

The preview should surface:

- Source URL
- App name
- Package id and version
- Runtime compatibility
- Screens included
- Collections touched
- Providers requested
- Native permissions requested
- Widgets required
- Plugins required
- Fallbacks
- Trust state and checksum details
- Validation errors

Approval should only happen when:

- Preview status is `ready_for_review`
- Runtime compatibility is `compatible`
- Validation errors are empty
- Computed checksum is present
- Approval receipt matches the preview hash and payload

Signature metadata is checked during preview. In the app install fetch path, signed registry entries must verify against the package payload. Missing signature metadata is allowed for backward compatibility. Malformed signature metadata or failed verification blocks install review.

## Open

Open should mean "launch the installed package at its trusted launch path."

For installed apps, the user should see:

- Installed label
- Package id and version
- Source URL
- Approval actor
- Activation timestamp
- Launch path

Open should not silently switch to a different package identity.

Contract mapping:

- `AppInstallation.launchPath`
- `AppInstallation.approvalHash`
- `AppInstallation.approvedBy`
- `AppInstallation.packageBinding`

## Remove

Remove separates "hide from shelf" from "wipe app-scoped data."

Recommended UX:

- Default: archive the app from the library view.
- Advanced: delete app and data only after exact confirmation.

Safety notes:

- Removing an app should not rewrite the original approval evidence.
- If the package is still shared by other installations, warn before deleting shared data.
- `archiveAppInstallation()` preserves package state and approval evidence.
- `deleteAppInstallationAndData()` purges records, relations, operations, outbox, provider links, source snapshots, workflow runs, conversations, package state, and the installation row for one installation id.

## Update

Update should show diff, not just a version bump.

Show:

- Old version
- New version
- New checksum
- Changed screens
- Changed providers
- Changed permissions
- New or removed capabilities

Update reuses the same preview and approval gates as install.

`previewAppPackageUpdate()` computes capability/provider/native-permission/collection diff. `activateApprovedAppPackageUpdate()` requires a fresh approval receipt for the exact update preview before activation.

## Checksums

Checksums are the current integrity anchor.

Current rules:

- Registry entries may include a checksum.
- Preview computes a canonical checksum for the package.
- Verified checksum means descriptor checksum matches computed checksum.
- Missing checksum means trust is unknown and the user must review.
- Mismatch means block install.

Contract mapping:

- `UtopiaRegistryPackage.checksum`
- `PackageInstallPreview.trust.status`
- `PackageInstallPreview.trust.checksum`
- `PackageInstallPreview.trust.computedChecksum`
- `hashPackageInstallPreview()`
- `hashPackageInstallApprovalReceipt()`

## Signatures

Signature metadata and cryptographic verification are implemented in the current registry and preview contracts.

Current contract shape:

- Registry entries may include `publisher`.
- Registry entries may include `signature`.
- Preview exposes `trust.publisher`.
- Preview exposes `trust.signatureStatus`.
- Preview exposes signature algorithm, key id, and signed time when present.
- Missing signature means `signature_missing`.
- Present well-formed signature metadata means `signature_present`.
- Cryptographically verified signature means `signature_verified`.
- Malformed signature metadata means `signature_invalid` and blocks review.
- Failed cryptographic verification means `signature_invalid` and blocks review.
- Keep checksum verification even if signatures exist.
- For curated registries, resolve `publisher.id + signature.keyId + algorithm` against `UtopiaTrustPolicy` before treating a signature as trusted.
- A package-provided public key is acceptable for verification only when it matches a trusted policy key.

Why both matter:

- Checksums detect payload drift.
- Signatures answer "who published this?"

Only describe a package as crypto-verified when the preview status is `signature_verified`; `signature_present` means metadata exists but was not verified in that path.

## Risky Permissions

Any permission that can touch user data, device data, or other apps should be shown explicitly.

The preview already exposes:

- `nativePermissionsRequested`
- `providersRequested`
- `pluginsRequired`

Risky permission categories to call out:

- Camera
- Photos
- Health data
- Location
- Files
- Sharing intents
- Background work
- External provider writeback

UX rule:

- Put risky permissions in a warning block.
- Explain why each permission exists.
- Do not bury permissions inside the install button.

## Provider Access

Provider access is a trust boundary, not just a feature list.

The app library should distinguish:

- Read-only provider access
- Writeback provider access
- Multi-provider access
- External MCP or plugin access

The preview already exposes provider requests via capabilities and provider lists. The UI should translate that into plain language like:

- "Reads from X"
- "Writes back to X"
- "Needs access to provider Y"

Contract mapping:

- `PackageInstallPreview.providersRequested`
- `AppPackage.capabilities`
- `AppPackage.presentation.providerTemplateFields`

## Unknown Source Warnings

Unknown source means the app came from outside a registry entry or from a registry entry with no checksum.

Use strong warnings for:

- Raw package URL installs
- Missing registry checksum
- Checksum mismatch
- Unsupported runtime capability
- Invalid validation result

Suggested copy:

- "Unknown remote package. Review required."
- "Source is not verified."
- "This app requests access we cannot currently validate."

Current copy hook:

- `packageInstallTrustLabel()` returns "Unknown remote package - review required" for missing checksums.

## Family And Small-Company Trust Scenarios

### Family

- Prefer simple names and clear publisher labels.
- Show "who can see what" before install.
- Make permission prompts human-readable.
- Keep rollback or removal obvious and local.

Typical trust model:

- Known household publisher
- Shared registry
- Limited provider access
- Conservative permission set

### Small company

- Prefer a curated internal registry.
- Make package identity and version mandatory.
- Show checksum and approval actor.
- Keep install records auditable.
- Separate internal apps from third-party apps.

Typical trust model:

- Curated registry manifest
- Per-release checksum
- Named reviewer or approver
- Versioned rollouts
- Clear rollback path

### Mixed trust

If a company or family uses both trusted internal apps and unknown external apps:

- Label the source clearly.
- Never blend unknown apps into the trusted shelf.
- Use different badges for "internal", "verified", and "unknown".

## Contract Mapping Table

| UX piece | Current contract |
| --- | --- |
| Registry list | `UtopiaRegistryManifest.packages` |
| App card title | `UtopiaRegistryPackage.name`, `PackageInstallPreview.appName` |
| App card version | `UtopiaRegistryPackage.version`, `PackageInstallPreview.version` |
| App card source | `UtopiaRegistryPackage.url`, `PackageInstallPreview.sourceUrl` |
| Trust badge | `PackageInstallTrustStatus`, `packageInstallTrustLabel()` |
| Screenshot section | `PackageInstallPreview.screensIncluded` |
| Category chips | derived from registry/package metadata and policy |
| Install preview | `PackageInstallPreview` |
| Install approval | `PackageInstallApprovalReceipt` |
| Open action | `AppInstallation.launchPath` |
| Remove action | local installation state and package state |
| Update action | new preview + new approval + new install record |
| Checksum proof | `trust.checksum`, `trust.computedChecksum` |
| Signature proof | `trust.signatureStatus`, `UtopiaTrustPolicy`, `resolveRegistrySignatureTrust()` |

## Risks

- Public trust-root distribution still needs a real hosted policy and key rotation process.
- Provider and permission wording can drift from the underlying contract if the UI invents labels.
- Screenshot-first layouts can overstate trust if the warning state is not prominent.
- Unknown-source installs must stay visibly different from registry-backed installs.
- Family and small-company scenarios need policy labels, not just a prettier card grid.

## Bottom Line

The app library should be a trust surface first and a catalog second.

If an app is installed, the user should be able to answer:

- Where did it come from?
- Who approved it?
- What did it ask for?
- What changed since last time?
- Can I trust the checksum?
- Is the source known, unknown, or blocked?
