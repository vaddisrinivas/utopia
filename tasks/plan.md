# Implementation Plan: Cross-Platform Capability Runtime

## Overview
Add every missing non-payment capability needed for JSON apps to work across iOS, Android, web, and macOS. The main architecture rule is: JSON packages declare intent and configuration; platform runtimes provide capability adapters with identical behavior, preview/fallback states, permissions, and validation.

Payments/IAP are explicitly excluded.

## Architecture Decisions
- Keep app packages JSON-only: capabilities are referenced by widget/native capability declarations, not custom package code.
- Build a capability matrix first, then implement adapters one vertical slice at a time.
- Make macOS a first-class runtime by moving it toward generic JSON rendering instead of one-off package screens.
- Every capability gets a contract, renderer support, install-preview safety, focused tests, and platform export/build proof.
- Required capabilities block install when unsupported. Optional capabilities may install, but must render a disabled/fallback state and show support findings.
- Unknown capabilities always fail closed, even when marked optional.

## Phase 1: Capability Contract Foundation

### Task 1: Add Capability Matrix
Create a source-of-truth matrix for supported capabilities by platform.

Acceptance criteria:
- Matrix lists iOS, Android, web, macOS support for each capability.
- Install preview can report unsupported platform reasons.
- Required vs optional capability policy is enforced.
- Unknown capability declarations fail closed.
- Existing Audio Loop capability is represented.

Verification:
- `npm run typecheck`
- `npm run config:validate`
- focused package install tests

Files likely touched:
- `packages/shared/contracts/native-capabilities.ts`
- `packages/shared/contracts/native-capability-kinds.ts`
- `packages/shared/contracts/package-install.ts`
- `tests/domain/package-install.test.ts`

Estimated scope: M

### Task 2: Capability Test App Skeleton
Create one package-source fixture that grows with every capability slice.

Acceptance criteria:
- Capability Lab fixture compiles as a package.
- It declares optional file/deep-link/planned speech capabilities.
- It includes matrix and permission widgets as the release-smoke home.

Verification:
- `npm run check:package-compiler`
- focused package compiler tests

Files likely touched:
- `tests/fixtures/package-source/capability-lab/**`
- `tests/fixtures/package-source/manifest.json`

Estimated scope: S

### Task 3: Normalize Capability Permissions
Expand permission declarations beyond camera/photos/share/health/audio.

Acceptance criteria:
- Supported permissions include microphone, notifications, location, contacts, calendar, biometrics, file access, speech, sensors where applicable.
- Unsafe permissions still fail closed.
- Permission card renders declared capability permissions consistently.

Verification:
- `npm run check:native-capability-contract`
- `npm run typecheck`

Files likely touched:
- `packages/shared/contracts/native-capabilities.ts`
- `scripts/quality/check-native-capability-contract.mjs`
- `src/presentation/json-render-widgets.tsx`

Estimated scope: M

## Phase 2: macOS Generic Runtime

### Task 4: Generic Mac JSON Renderer
Replace hard-coded Mac package screens with a renderer that can display package surfaces/components from bundled JSON.

Acceptance criteria:
- Calculator and Audio Loop render from package JSON.
- Unknown widgets show a capability-aware install/runtime message.
- Food is not default; app picker remains default.

Verification:
- `npx tsc --noEmit` in `macos`
- `npm run macos:build`
- screenshot proof from `/Applications/UtopiaMac.app`

Files likely touched:
- `macos/App.tsx`
- `macos/app-packages/*.json`

Estimated scope: L, split if needed

### Task 5: Mac Capability Bridge Registry
Create one Mac native bridge registry instead of ad hoc modules.

Acceptance criteria:
- Audio, file picker, share, open URL, and future modules expose one typed JS boundary.
- Missing native modules report structured errors.
- Existing Audio Loop uses the registry.

Verification:
- `npx tsc --noEmit` in `macos`
- `npm run macos:build`

Files likely touched:
- `macos/App.tsx`
- `macos/macos/UtopiaMac-macOS/*`

Estimated scope: M

## Phase 3: Files And Media

### Task 6: Generic File Picker/Open/Save
Add a package-declared file capability for importing/exporting documents.

Progress:
- Expo `filePicker` widget now picks local files by MIME type, renders file metadata, and keeps selection local-only.
- Expo `fileExport` widget now writes local text content and uses download/share paths where available.
- Capability Lab includes the widget and compiler coverage.
- Mac native bridge now supports generic file pick and text-file save dialogs for JSON packages.

Acceptance criteria:
- JSON apps can request file pick by MIME type.
- Web/iOS/Android/macOS can pick files.
- Export/share path works for generated files.

Verification:
- `npm run typecheck`
- `npm run export:web`
- `npm run export:ios`
- `npm run export:android`
- `npm run macos:build`

Files likely touched:
- `src/presentation/json-render-widgets.tsx`
- `packages/shared/contracts/native-capabilities.ts`
- `macos/macos/UtopiaMac-macOS/*`

Estimated scope: M

### Task 7: Video Player And Capture
Add video playback and optional video capture.

Progress:
- Added `expo-video` and a declarative `videoPlayer` widget with native controls.
- Widget can play package/local URI sources and choose or record videos through Expo Image Picker.
- Capability Lab declares the widget plus optional camera/media-library capabilities.
- macOS has a native pick/open bridge that launches the selected video in the system player.

Acceptance criteria:
- JSON app can render video player for local/remote source.
- Video capture is gated by camera/mic permissions.
- Unsupported source types are blocked with clear validation.

Verification:
- platform exports
- focused widget test
- macOS build

Files likely touched:
- `package.json`
- `app.json`
- `src/presentation/json-render-widgets.tsx`
- `packages/shared/contracts/ui-widgets.ts`
- `macos/*`

Estimated scope: L

### Task 8: Camera Scanner
Add barcode/QR/document scanning as a native widget.

Progress:
- Added `cameraScanner` widget using Expo Camera barcode scanning.
- Capability Lab declares camera scanner coverage.

Acceptance criteria:
- JSON can declare scanner mode: qr, barcode, document.
- Permission preview shows camera requirement.
- Results return to package-defined action/record flow.

Verification:
- platform exports
- Android/iOS native smoke where available

Estimated scope: L

## Phase 4: Location, Maps, Sensors

### Task 9: Location And Map Runtime
Upgrade `mapBlock` from display-only to real maps/location.

Progress:
- Added `locationMap` widget with foreground location request and system map open path.

Acceptance criteria:
- JSON apps can show coordinates, request current location, and pick/search a place where supported.
- Permission preview shows location permission.
- macOS/web have usable map fallback or supported map renderer.

Verification:
- `npm run typecheck`
- platform exports
- focused map/location tests

Estimated scope: L

### Task 10: Sensors Capability
Add optional sensor widgets for motion/orientation/light where available.

Progress:
- Added `sensorReadout` widget for accelerometer, gyroscope, and magnetometer samples.

Acceptance criteria:
- JSON declares sensor type and sampling mode.
- Unsupported platforms are blocked before install or show non-recording preview.
- Battery/permission constraints are visible.

Verification:
- platform exports
- capability matrix tests

Estimated scope: M

## Phase 5: System Services

### Task 11: Notifications, Timers, Background
Add local notifications, keep-awake/session timer, and background task primitives.

Progress:
- Added `notificationScheduler` widget for reviewed local notification scheduling/cancel.
- Added Expo notifications/task-manager capability declarations.

Acceptance criteria:
- JSON apps can schedule/cancel local notifications.
- Audio Loop can optionally notify on completion.
- Background support is platform-scoped and accurately previewed.

Verification:
- platform exports
- permission contract tests
- native smoke where possible

Estimated scope: L

### Task 12: Contacts And Calendar
Add contact picker and calendar/reminder event creation.

Progress:
- Added `contactPicker` widget using one-contact picker, not bulk import.
- Added `calendarEvent` widget for one reviewed local calendar event.

Acceptance criteria:
- JSON apps can pick contacts without bulk leaking data.
- JSON apps can propose calendar/reminder writes before execution.
- Permissions and write operations are review-gated.

Verification:
- typecheck
- platform exports
- package install safety tests

Estimated scope: L

### Task 13: Biometrics And Secure Actions
Add Face ID/Touch ID/local auth capability.

Progress:
- Added `biometricGate` widget using Expo Local Authentication.

Acceptance criteria:
- JSON apps can require local auth before sensitive action.
- SecureStore-backed settings remain separate from package secrets.
- macOS uses local authentication where available.

Verification:
- typecheck
- platform exports
- auth fallback tests

Estimated scope: M

## Phase 6: Health And Voice

### Task 14: Apple Health
Add iOS Apple Health parity for Health Connect-backed package flows.

Progress:
- Added `healthKitStatus` package widget as an honest iOS bridge/entitlement placeholder.
- Live Apple Health reads remain blocked on native HealthKit entitlement and module choice.

Acceptance criteria:
- Health capability matrix distinguishes Android Health Connect and iOS HealthKit.
- Food/health package views can read supported Apple Health metrics.
- Permission preview is platform-specific.

Verification:
- iOS export/build
- health contract tests

Estimated scope: L

### Task 15: Speech
Add speech-to-text and text-to-speech primitives.

Progress:
- Added `speechTool` widget using Expo Speech text-to-speech.
- Speech-to-text remains a planned native permission path.

Acceptance criteria:
- JSON apps can dictate text into fields/actions.
- JSON apps can speak text content.
- Mic/speech permissions are declared and previewed.

Verification:
- platform exports
- capability tests

Estimated scope: L

## Phase 7: Polish And Release Gate

### Task 16: Cross-Platform Capability Test App
Promote the Capability Lab fixture into a bundled JSON app that exercises all non-payment capabilities.

Acceptance criteria:
- One app shows every capability with pass/fail state.
- Works as a release smoke test.
- Every unsupported platform state is intentional and documented.

Verification:
- `npm run typecheck`
- `npm run config:validate`
- `npm run doctor`
- `npm run export:web`
- `npm run export:ios`
- `npm run export:android`
- `npm run macos:build`

Estimated scope: M

## Checkpoints

### Checkpoint A: Contract Safe
- Capability matrix exists.
- Install preview blocks unsupported capabilities.
- Existing apps still install.

### Checkpoint B: Mac Real Runtime
- Mac can render generic JSON app surfaces.
- Calculator and Audio Loop still work.

### Checkpoint C: Core Device IO
- Files, media, camera scanner, maps/location work across target platforms.

### Checkpoint D: System Services
- Notifications, contacts/calendar, biometrics, health, speech are integrated and gated.

### Checkpoint E: Release Proof
- Capability test app passes all configured platform gates.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| macOS Expo parity is limited | High | Keep explicit React Native macOS native bridge registry. |
| Platform APIs differ deeply | High | Capability matrix drives install compatibility per platform. |
| Permissions become too broad | High | Fail closed and require per-capability allowlist/tests. |
| Background behavior varies | Medium | Mark background support per platform and test foreground path separately. |
| Capability widgets sprawl | Medium | One typed runtime adapter boundary, JSON config only. |

## Open Questions
- Should unsupported platform capability block install, or allow install with disabled widget?
- Should each capability be a widget, an action, or both?
- Which platform is release-critical first after Mac: iPhone physical device or Android physical device?
