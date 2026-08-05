# Utopia Tracked-File Scope Index

Generated: 2026-07-30
Commit: `0b340b1`
Documentation refreshed: 2026-07-31
Coverage after this refresh: 1228 tracked files; original index, 51
post-`bf0efff` additions, the archived historical audit, and removal of one
private workspace setup script.

This is the exhaustive scope ledger supporting `docs/CODEBASE_DEEP_REVIEW_2026-07-30.md`. It assigns every tracked file an ownership role and next-review scope. It is not a claim that every line has equal risk. Manual findings in the companion report take precedence over these mechanical classifications.

| File | Lines | Role | Improvement scope |
|---|---:|---|---|
| `.dependency-cruiser.cjs` | 71 | Repository support | Keep reviewed and covered by its owning gate. |
| `.github/CODEOWNERS` | 2 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/ISSUE_TEMPLATE/bug.yml` | 39 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/ISSUE_TEMPLATE/config.yml` | 6 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/ISSUE_TEMPLATE/feature.yml` | 34 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/ISSUE_TEMPLATE/utopia-app-request.yml` | 20 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/actions/publish-utopia-package/action.yml` | 53 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/dependabot.yml` | 32 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/pull_request_template.md` | 23 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/workflows/expo-quality.yml` | 102 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/workflows/generate-utopia-app.yml` | 131 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/workflows/golden-loop-clean-checkout.yml` | 34 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.github/workflows/scorecard.yml` | 44 | GitHub automation/governance | Pin actions, minimize permissions, add concurrency/timeouts, preserve proof boundaries. |
| `.gitignore` | 95 | Repository support | Keep reviewed and covered by its owning gate. |
| `.gitleaks.toml` | 13 | Repository support | Keep reviewed and covered by its owning gate. |
| `.spectral.yaml` | 39 | Repository support | Keep reviewed and covered by its owning gate. |
| `AGENTS.md` | 20 | Repository support | Keep reviewed and covered by its owning gate. |
| `CHANGELOG.md` | 161 | Repository support | Keep reviewed and covered by its owning gate. |
| `CODE_OF_CONDUCT.md` | 27 | Repository support | Keep reviewed and covered by its owning gate. |
| `CONTRIBUTING.md` | 30 | Repository support | Keep reviewed and covered by its owning gate. |
| `FEATURES.md` | 41 | Repository support | Keep reviewed and covered by its owning gate. |
| `LICENSE` | 78 | Repository support | Keep reviewed and covered by its owning gate. |
| `PRIVACY.md` | 38 | Repository support | Keep reviewed and covered by its owning gate. |
| `README.md` | 384 | Repository support | Keep reviewed and covered by its owning gate. |
| `ROADMAP.md` | 44 | Repository support | Keep reviewed and covered by its owning gate. |
| `SECURITY.md` | 53 | Repository support | Keep reviewed and covered by its owning gate. |
| `SUPPORT.md` | 21 | Repository support | Keep reviewed and covered by its owning gate. |
| `adapters/health-connect-ports.ts` | 56 | Repository support | Keep reviewed and covered by its owning gate. |
| `adapters/runtime-context-ports.ts` | 26 | Repository support | Keep reviewed and covered by its owning gate. |
| `adapters/runtime-context-provider.tsx` | 159 | Repository support | Keep reviewed and covered by its owning gate. |
| `agents/utopia-package-builder/SKILL.md` | 79 | Repository support | Keep reviewed and covered by its owning gate. |
| `android/.gitignore` | 20 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/build.gradle` | 204 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/proguard-rules.pro` | 15 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/debug/AndroidManifest.xml` | 8 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/debugOptimized/AndroidManifest.xml` | 8 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/AndroidManifest.xml` | 67 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/java/app/utopia/MainActivity.kt` | 85 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/java/app/utopia/MainApplication.kt` | 47 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable-hdpi/splashscreen_logo.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable-mdpi/splashscreen_logo.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable-xhdpi/splashscreen_logo.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable/ic_launcher_background.xml` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/drawable/rn_edit_text_material.xml` | 38 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_background.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_background.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_background.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_background.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_background.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/values-night/colors.xml` | 1 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/values/colors.xml` | 5 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/values/strings.xml` | 5 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/app/src/main/res/values/styles.xml` | 14 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/build.gradle` | 25 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/gradle.properties` | 63 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/gradle/wrapper/gradle-wrapper.jar` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/gradle/wrapper/gradle-wrapper.properties` | 8 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/gradlew` | 249 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/gradlew.bat` | 99 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `android/settings.gradle` | 40 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `app.json` | 111 | Repository support | Keep reviewed and covered by its owning gate. |
| `app/(tabs)/_layout.tsx` | 127 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/(tabs)/chat.tsx` | 11 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/(tabs)/food.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/(tabs)/index.tsx` | 13 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/(tabs)/settings.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/(tabs)/sources.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/+html.tsx` | 50 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/+native-intent.ts` | 18 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/+not-found.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/_layout.tsx` | 110 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/account.tsx` | 326 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/apps/[installationId].tsx` | 592 | Expo route/UI shell | Split/review hotspot: Keep route thin; move policy, storage, and effects behind ports. |
| `app/capture.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/collection.tsx` | 23 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/collection/[id].tsx` | 23 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/config.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/health-diagnostics.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/install.tsx` | 719 | Expo route/UI shell | Split/review hotspot: Keep route thin; move policy, storage, and effects behind ports. |
| `app/package-control-room.tsx` | 439 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/record.tsx` | 10 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/record/[id].tsx` | 10 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/search.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/system.tsx` | 6 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/vault.tsx` | 42 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `app/vault.web.tsx` | 288 | Expo route/UI shell | Keep route thin; move policy, storage, and effects behind ports. |
| `apps/audio-loop-108/audio-loop-108.v1.json` | 443 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/preview.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/acceptance/schema-native.json` | 12 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/app.json` | 14 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/capabilities/native.json` | 41 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/collections/session.json` | 19 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/queries/recent-sessions.json` | 7 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/screens/history.json` | 9 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/screens/home.json` | 61 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/screens/library.json` | 9 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/screens/playlist.json` | 9 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/audio-loop-108/source/screens/record.json` | 9 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/capability-lab.v1.json` | 599 | Bundled app/package fixture | Split/review hotspot: Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/acceptance/capability-matrix.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/app.json` | 8 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/capabilities/dependency-pins.json` | 8 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/capabilities/native.json` | 119 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/capabilities/package.json` | 6 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/capabilities/pinned-at.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/collections/capability.json` | 16 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/queries/capabilities.json` | 5 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/capability-lab/source/screens/matrix.json` | 227 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/expense-splitter/expense-splitter.v1.json` | 199 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/focus-intervals/focus-intervals.v1.json` | 179 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/food.v1.json` | 2976 | Bundled app/package fixture | Rewrite boundary candidate: Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/00-schema.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/01-schema-version.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/02-id.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/03-label.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/04-home-surface.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/05-surfaces.json` | 78 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/06-collections.json` | 32 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/07-rich-detail-schema.json` | 2 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/08-provider-template-fields.json` | 24 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/09-visual-identity.json` | 293 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/10-ui.json` | 2029 | Bundled app/package fixture | Rewrite boundary candidate: Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/11-relations.json` | 218 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/12-skills.json` | 4 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/13-workflows.json` | 8 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/14-data-homes.json` | 7 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/15-dependency-pins.json` | 28 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/16-native-capabilities.json` | 122 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/17-render.json` | 119 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/chunks/18-mcp.json` | 18 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/food/source/index.json` | 121 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/habit-grid/habit-grid.v1.json` | 181 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/recurring-bills/recurring-bills.v1.json` | 131 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/preview.json` | 74 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/scientific-calculator.v1.json` | 386 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/acceptance/schema-native.json` | 5 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/app.json` | 14 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/collections/calculation.json` | 14 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/queries/history.json` | 7 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/screens/functions.json` | 33 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/screens/history.json` | 21 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/scientific-calculator/source/screens/home.json` | 80 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/spaced-repetition/spaced-repetition.v1.json` | 133 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/split-rent/split-rent.v1.json` | 123 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `apps/workout-logger/workout-logger.v1.json` | 260 | Bundled app/package fixture | Classify proven/partial/boundary; require source round-trip and zero hidden runtime debt. |
| `assets/fonts/SpaceMono-Regular.ttf` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/android-icon-background.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/android-icon-foreground.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/android-icon-monochrome.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/favicon.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/icon.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `assets/images/splash-icon.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `cloudflare/README.md` | 90 | Registry/edge service | Serialize writes; enforce trust, rate, size, secret, and privacy boundaries. |
| `cloudflare/utopia-registry-worker.ts` | 613 | Registry/edge service | Split/review hotspot: Serialize writes; enforce trust, rate, size, secret, and privacy boundaries. |
| `cloudflare/wrangler.toml` | 38 | Registry/edge service | Serialize writes; enforce trust, rate, size, secret, and privacy boundaries. |
| `docs/adversarial-app-matrix.json` | 628 | Documentation | Split/review hotspot: Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/adversarial-app-tests.md` | 83 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/app-library-trust-model.md` | 398 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/architecture/dependency-boundaries.md` | 28 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/archive/CODEBASE_FILE_BY_FILE_REVIEW.md` | 5070 | Documentation | Rewrite boundary candidate: Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/audio-loop-media-session-intent-contract.md` | 32 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/browser-builder.md` | 41 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/capability-consent-ledger.md` | 67 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/cloudflare-registry-launch.md` | 184 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/commercialization-open-core.md` | 272 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/conformance.md` | 39 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/contracts-source-of-truth.md` | 72 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/core-boundary.md` | 73 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/custom-gpt-action.openapi.yaml` | 78 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/custom-gpt-utopia-builder.md` | 82 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/dead-code-and-gate-sprawl-audit.md` | 115 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/emulator-sync-proof.md` | 59 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/food-package-source.md` | 30 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/gates.md` | 20 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/github-app-factory.md` | 62 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/golden-loop.md` | 46 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/launch-readiness.md` | 81 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/operations-observability.md` | 41 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/package-authoring-experience.md` | 255 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/package-browser-builder.md` | 52 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/platform-generalization-scorecard.md` | 78 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/platform-north-star.md` | 98 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/platform-proof-verdicts.md` | 88 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/platform-release-contract.md` | 117 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/platform-scorecard.md` | 31 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/play-store-launch-readiness.md` | 58 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/provider-live-proof.md` | 51 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/reference-apps-strategy.md` | 85 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/registry-package-signing.md` | 39 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/registry-trust.md` | 77 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/release-migration-notes.md` | 9 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/release-security.md` | 50 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/repository-classification.md` | 48 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/schema-authority.md` | 43 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/store-policy-remote-packages.md` | 74 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/sync-transport.md` | 56 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/telemetry-and-privacy-contract.md` | 90 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `docs/widget-generalization-audit.md` | 256 | Documentation | Refresh against executable evidence; remove stale claims and archive superseded plans. |
| `eas.json` | 32 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/changelogs/1.txt` | 2 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/changelogs/3.txt` | 2 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/changelogs/4.txt` | 2 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/full_description.txt` | 10 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/images/phoneScreenshots/01-today.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/images/phoneScreenshots/02-kitchen.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/images/phoneScreenshots/03-shop.png` | binary | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/short_description.txt` | 2 | Repository support | Keep reviewed and covered by its owning gate. |
| `fastlane/metadata/android/en-US/title.txt` | 2 | Repository support | Keep reviewed and covered by its owning gate. |
| `ios/.gitignore` | 31 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/.xcode.env` | 12 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Podfile` | 70 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Podfile.lock` | 2691 | Native shell/project | Rewrite boundary candidate: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Podfile.properties.json` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia.xcodeproj/project.pbxproj` | 573 | Native shell/project | Split/review hotspot: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia.xcodeproj/xcshareddata/xcschemes/Utopia.xcscheme` | 89 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia.xcworkspace/contents.xcworkspacedata` | 11 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/AppDelegate.swift` | 70 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/AppIcon.appiconset/Contents.json` | 14 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/Contents.json` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/SplashScreenBackground.colorset/Contents.json` | 20 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/SplashScreenLogo.imageset/Contents.json` | 23 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/SplashScreenLogo.imageset/image.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/SplashScreenLogo.imageset/image@2x.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Images.xcassets/SplashScreenLogo.imageset/image@3x.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Info.plist` | 90 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/PrivacyInfo.xcprivacy` | 38 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/SplashScreen.storyboard` | 46 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Supporting/Expo.plist` | 14 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Utopia-Bridging-Header.h` | 4 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `ios/Utopia/Utopia.entitlements` | 5 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/.bundle/config` | 3 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/.eslintrc.js` | 5 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/.gitignore` | 75 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/.prettierrc.js` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/.watchmanconfig` | 2 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/App.tsx` | 1425 | Native shell/project | Rewrite boundary candidate: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/Gemfile` | 17 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/README.md` | 98 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/__tests__/App.test.tsx` | 14 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/build.gradle` | 120 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/proguard-rules.pro` | 11 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/AndroidManifest.xml` | 28 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/java/com/utopiamac/MainActivity.kt` | 23 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/java/com/utopiamac/MainApplication.kt` | 39 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/drawable/rn_edit_text_material.xml` | 38 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/values/strings.xml` | 4 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/app/src/main/res/values/styles.xml` | 10 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/build.gradle` | 22 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/gradle.properties` | 45 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/gradle/wrapper/gradle-wrapper.jar` | binary | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/gradle/wrapper/gradle-wrapper.properties` | 8 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/gradlew` | 252 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/gradlew.bat` | 100 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/android/settings.gradle` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/app-packages/audio-loop-108.v1.json` | 283 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/app-packages/scientific-calculator.v1.json` | 386 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/app.json` | 5 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/babel.config.js` | 4 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/index.js` | 10 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/.xcode.env` | 12 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/Podfile` | 36 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac.xcodeproj/project.pbxproj` | 472 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac.xcodeproj/xcshareddata/xcschemes/UtopiaMac.xcscheme` | 89 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/AppDelegate.swift` | 49 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/Images.xcassets/AppIcon.appiconset/Contents.json` | 54 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/Images.xcassets/Contents.json` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/Info.plist` | 53 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/LaunchScreen.storyboard` | 48 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/ios/UtopiaMac/PrivacyInfo.xcprivacy` | 38 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/jest.config.js` | 4 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/.gitignore` | 3 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/.xcode.env` | 2 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/Podfile` | 29 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/Podfile.lock` | 2624 | Native shell/project | Rewrite boundary candidate: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/PrivacyInfo.xcprivacy` | 38 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/AppDelegate.h` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/AppDelegate.mm` | 48 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/Assets.xcassets/AppIcon.appiconset/Contents.json` | 59 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/Assets.xcassets/Contents.json` | 7 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/Base.lproj/Main.storyboard` | 685 | Native shell/project | Split/review hotspot: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/Info.plist` | 50 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/UtopiaMac.entitlements` | 13 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/UtopiaMacAudioPlayer.h` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/UtopiaMacAudioPlayer.mm` | 332 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac-macOS/main.m` | 6 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac.xcodeproj/project.pbxproj` | 600 | Native shell/project | Split/review hotspot: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac.xcodeproj/xcshareddata/xcschemes/UtopiaMac-macOS.xcscheme` | 79 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/macos/UtopiaMac.xcworkspace/contents.xcworkspacedata` | 11 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/metro.config.js` | 13 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/package-lock.json` | 12097 | Native shell/project | Rewrite boundary candidate: Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/package.json` | 47 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `macos/tsconfig.json` | 9 | Native shell/project | Separate generated project files from owned bridges; prove shell receipts on CI. |
| `metro.config.js` | 10 | Repository support | Keep reviewed and covered by its owning gate. |
| `package-lock.json` | 10899 | Repository support | Rewrite boundary candidate: Keep reviewed and covered by its owning gate. |
| `package.json` | 275 | Repository support | Keep reviewed and covered by its owning gate. |
| `packages/app-compiler/index.ts` | 1163 | Package/compiler module | Rewrite boundary candidate: Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/conformance/src/conformance-harness.ts` | 532 | Package/compiler module | Split/review hotspot: Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/agents/registry.v1.json` | 112 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/chat/chat-send-request.v1.schema.json` | 77 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/chat/chat-stream-event.v1.schema.json` | 67 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/domain-catalog.v1.json` | 41 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/domains/food.v1.json` | 2976 | Package/compiler module | Rewrite boundary candidate: Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/domains/health.v1.json` | 372 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/domains/plants.v1.json` | 366 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/providers/notion/metadata.v1.json` | 43 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/providers/notion/surface.v1.json` | 29 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/action-event.v1.schema.json` | 92 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/agent-handoff.v1.schema.json` | 80 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/agent-registry.v1.schema.json` | 54 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/REPORT.md` | 59 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/accept.json` | 50 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/action-binding.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/ai-sdk-approval.json` | 26 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/capability-escalation.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/expired.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/replay.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/revision-drift.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/tampered-idempotency-key.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/tampered-operation-hash.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/tampered-proposal-hash.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/wrong-actor.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/fixtures/wrong-workspace.json` | 49 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/approval/reactive-proposal-approval.v1.schema.json` | 257 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/command.v1.schema.json` | 88 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/domain-catalog.v1.schema.json` | 43 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/domain.v1.schema.json` | 783 | Package/compiler module | Split/review hotspot: Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/food-detail.v1.schema.json` | 424 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/record.v1.schema.json` | 57 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/source-snapshot.v1.schema.json` | 17 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/undo.v1.schema.json` | 45 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/schemas/workflow.v1.schema.json` | 18 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/skills/food.md` | 43 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/skills/health.md` | 8 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/skills/plants.md` | 8 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/notion-import.md` | 229 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/home.csv` | 5 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/household.csv` | 6 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/kitchen.csv` | 8 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/meals.csv` | 7 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/purchases.csv` | 5 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/recipes.csv` | 7 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/records.csv` | 31 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/relations.csv` | 45 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/schema.csv` | 31 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/shopping.csv` | 6 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/sources.csv` | 4 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/sheets/visual-identity.csv` | 71 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/generated/template-summary.json` | 24 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/package-change-templates/package-change-blueprints.v1.json` | 85 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/package-change-templates/package-change-blueprints.v1.schema.json` | 214 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/package-change-templates/widget-screen-intents.v1.json` | 176 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/package-change-templates/widget-screen-intents.v1.schema.json` | 179 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/utopia-data-plane-template.v1.json` | 324 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/templates/utopia-data-plane-template.v1.schema.json` | 64 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/workflows/meal-plan-to-shopping.v1.json` | 14 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/workflows/phase4_compensation_probe.v1.json` | 33 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/workflows/phase4_replay_workflow.v1.json` | 34 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/workflows/receipt-to-kitchen.v1.json` | 14 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/domain-config/workflows/weekly-food-reset.v1.json` | 15 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/computed-fields.ts` | 313 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/decimal.ts` | 124 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/expression.ts` | 526 | Package/compiler module | Split/review hotspot: Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/query.ts` | 130 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/recurrence.ts` | 483 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/runtime-kernel/timed-flow.ts` | 375 | Package/compiler module | Prevent duplicate authority; add round-trip, property, and compatibility tests. |
| `packages/schemas/src/app-package-schemas.ts` | 471 | Canonical schema surface | Make JSON Schema authoritative; generate types; run upstream conformance corpus. |
| `packages/schemas/src/index.ts` | 31 | Canonical schema surface | Make JSON Schema authoritative; generate types; run upstream conformance corpus. |
| `packages/schemas/src/package-registry.ts` | 97 | Canonical schema surface | Make JSON Schema authoritative; generate types; run upstream conformance corpus. |
| `packages/schemas/src/package-validation.ts` | 263 | Canonical schema surface | Make JSON Schema authoritative; generate types; run upstream conformance corpus. |
| `packages/shared/contracts/app-installation.ts` | 97 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/canonical-json.ts` | 11 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/capability-consent-ledger.ts` | 206 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/confidence.ts` | 74 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/extension-trust.ts` | 790 | Shared public contract | Split/review hotspot: Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/index.ts` | 38 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/native-capabilities.ts` | 286 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/native-capability-kinds.ts` | 18 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/operation.ts` | 44 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package-authoring.ts` | 220 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package-change.ts` | 24 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package-install.ts` | 621 | Shared public contract | Split/review hotspot: Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package-registry.ts` | 9 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package-trust.ts` | 71 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/package.ts` | 573 | Shared public contract | Split/review hotspot: Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/plugin.ts` | 435 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/query.ts` | 31 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/receipts.ts` | 51 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/records.ts` | 40 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/recurrence.ts` | 147 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/rules.ts` | 89 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/schema/ajv-authority.ts` | 69 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/sync-transport.ts` | 55 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/telemetry.ts` | 172 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/ui-primitives.ts` | 24 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/ui-widgets.ts` | 59 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `packages/shared/contracts/workflow.ts` | 62 | Shared public contract | Keep shell-neutral, generated where possible, versioned, and conformance-tested. |
| `requests/app-idea.md` | 8 | Repository support | Keep reviewed and covered by its owning gate. |
| `requests/examples/family-minesweeper.md` | 6 | Repository support | Keep reviewed and covered by its owning gate. |
| `requests/examples/habit-graph.md` | 6 | Repository support | Keep reviewed and covered by its owning gate. |
| `requests/examples/timer-tool.md` | 6 | Repository support | Keep reviewed and covered by its owning gate. |
| `scripts/adb-direct-actions.sh` | 28 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/android/install-play-proof-pack.sh` | 38 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/domain-config-validator.mjs` | 335 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/factory/generate-app-from-prompt.ts` | 708 | Build/authoring automation | Split/review hotspot: Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/factory/run-generate-app-from-prompt.mjs` | 18 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/dev-fast.sh` | 32 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/platform-android.sh` | 20 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/platform-ios.sh` | 21 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/platform-web.sh` | 20 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/release-local.sh` | 23 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/release-proof-exports.sh` | 24 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/release-proof-physical-device.sh` | 58 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/gates/release-proof-signed-android.sh` | 84 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/package/browser-package-builder.html` | 1561 | Build/authoring automation | Rewrite boundary candidate: Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/package/browser-package-builder.ts` | 1978 | Build/authoring automation | Rewrite boundary candidate: Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/package/create-utopia-app.ts` | 196 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/package/tsconfig.json` | 15 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/quality/android-harness.sh` | 56 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/android/golden-loop-android-plan.mjs` | 175 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/android/run-golden-loop-android-lane.mjs` | 1193 | Quality/proof gate | Rewrite boundary candidate: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/apply-utopia-product-surface.py` | 694 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-accessibility-smoke.mjs` | 243 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-adversarial-app-matrix.mjs` | 122 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-android-release-artifacts.sh` | 179 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-app-installation-foundation.ts` | 195 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-audio-loop-package-source-roundtrip.ts` | 41 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-chat-product-language.ts` | 31 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-cloud-portability.mjs` | 100 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-conformance.ts` | 30 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-control-plane-separation.sh` | 18 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-core-boundaries.mjs` | 192 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-core-port-boundaries.mjs` | 100 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-cross-platform-behavior-parity.mjs` | 111 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-data-plane-template.mjs` | 140 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-disposable-lane-guards.mjs` | 92 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-emulator-sync-proof.mjs` | 232 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-food-app-vibe.mjs` | 104 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-food-golden-path.ts` | 328 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-food-package-source-roundtrip.ts` | 20 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-food-schema-depth.mjs` | 78 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-golden-loop-runtime-code.mjs` | 67 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-health-connect-android.sh` | 43 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-ios-export.mjs` | 63 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-json-render-only-ui.mjs` | 43 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-kernel-boundaries.ts` | 257 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-launch-readiness.mjs` | 188 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-live-provider-readiness.mjs` | 157 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-live-provider-writeback.ts` | 618 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-local-query-contract.ts` | 15 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-local-query-server-contract.ts` | 62 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-mcp-official-only.mjs` | 71 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-multi-surface-sync-proof.mjs` | 251 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-native-capability-contract.mjs` | 149 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-native-visual-matrix.sh` | 228 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-no-spike-artifacts.mjs` | 23 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-operation-boundary-grep.sh` | 27 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-package-builder-api.ts` | 280 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-package-owned-routes.mjs` | 66 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-performance-budget.mjs` | 91 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase1-sqlite-runtime.sh` | 278 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase3-chat-rollback-idempotency.ts` | 186 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase3-chat-send.ts` | 281 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase3-chat-undo.ts` | 202 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase4-mcp-tool-contract.ts` | 586 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase4-mcp-workflow-replay-http.ts` | 628 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase4-mcp-workflow-replay.ts` | 293 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase5-notion-adapter.ts` | 407 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase6-sheets-adapter.ts` | 66 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-phase7-chat-client-cross-surface.ts` | 112 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-platform-generalization.mjs` | 250 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-platform-package-portability.mjs` | 88 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-product-polish-review.mjs` | 124 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-provider-clear-restore.ts` | 269 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-reactive-provider-writeback.ts` | 200 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-reference-sync-transport.ts` | 595 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-release-readiness.mjs` | 119 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-repository-classification.mjs` | 185 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-responsive-visual-matrix.mjs` | 135 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-roundtrip.ts` | 266 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-shared-state-sync.ts` | 115 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-sync-merge.ts` | 225 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-sync-transport.mjs` | 125 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-utopia-completion-audit.mjs` | 222 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-visual-state-matrix.mjs` | 86 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-web-product-smoke.mjs` | 185 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-widget-capability-broker.mjs` | 76 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-widget-catalog-env-assertions.mjs` | 38 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-widget-catalog.mjs` | 192 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/check-workflow-resume-cancel.ts` | 353 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/cleanup-notion-proof-artifacts.mjs` | 129 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/collect-device-evidence.sh` | 36 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/collect-physical-device-release-evidence.sh` | 106 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/collect-release-evidence.sh` | 163 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/emulator-sync/emulator-sync-plan.mjs` | 294 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/evidence-provenance.mjs` | 347 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/generate-data-plane-artifacts.mjs` | 222 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/check-creator-study-receipt.mjs` | 155 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/check-multi-surface-receipts.mjs` | 273 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/debug-automation-protocol.mjs` | 189 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/debug-bridge-commands.mjs` | 157 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/receipt-adapter.mjs` | 227 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/run-clean-snapshot-candidate.mjs` | 99 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/run-virtual-lab.mjs` | 378 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/shell-proof-protocol.mjs` | 564 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/web-execution-receipt.mjs` | 1787 | Quality/proof gate | Rewrite boundary candidate: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/web-package-artifacts.mjs` | 378 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/golden-loop/web-package-compile-bridge.mjs` | 103 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/inventory-dirty-tree.mjs` | 67 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/macos/build-macos-app.mjs` | 204 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/macos/check-shared-household-runtime.mjs` | 325 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/macos/run-golden-loop-debug-bridge.mjs` | 158 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/materialize-adversarial-apps.mjs` | 241 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/physical-device-release-evidence.mjs` | 93 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/platform-generalization-baseline.json` | 40 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/reference-sync-transport-relay.ts` | 261 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/refresh-assetlinks-fingerprint.sh` | 42 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/require-disposable-lane.mjs` | 105 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-android-utopia-e2e-proof.sh` | 177 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-clean-checkout-proof.mjs` | 397 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-emulatorx-health-connect.sh` | 111 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-golden-loop-local-guarantees.mjs` | 16 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-golden-loop-proof.mjs` | 269 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-google-sheets-live-proof.sh` | 225 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-google-sheets-scenario-proof.sh` | 389 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-launch-proof.mjs` | 110 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-local-postgres-live-proof.sh` | 168 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-local-postgres-scenario-proof.sh` | 322 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-notion-live-proof.sh` | 19 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-notion-scenario-proof.sh` | 479 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-platform-day1.mjs` | 123 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-postgres-live-proof.sh` | 24 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-provider-live-proofs.sh` | 138 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-provider-standalone-visual-proof.sh` | 206 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-utopia-acceptance.mjs` | 107 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-utopia-connected.ts` | 809 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/run-utopia-h1-e2e.ts` | 602 | Quality/proof gate | Split/review hotspot: Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/sbom/check-sbom-gate.mjs` | 118 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/sbom/sbom-policy.json` | 20 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/security/check-npm-audit-gate.mjs` | 126 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/security/check-osv-gate.mjs` | 145 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/security/check-telemetry-privacy-boundaries.mjs` | 87 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/security/npm-audit-gate-policy.json` | 7 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/security/osv-gate-policy.json` | 19 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/smoke-ai-providers.py` | 361 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/split-food-package-source.mjs` | 72 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/test-evidence-provenance.mjs` | 88 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/utopia-acceptance-registry.mjs` | 55 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/validate-external-automation.sh` | 111 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/verify-release-assetlinks.sh` | 97 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/web-static-server.mjs` | 89 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/write-android-release-build-receipt.mjs` | 43 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/quality/write-release-supply-chain-manifest.mjs` | 126 | Quality/proof gate | Reject synthetic evidence; pin tools; fail on warnings and stale artifacts. |
| `scripts/registry/create-signing-key.mjs` | 50 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/registry/publish-package.mjs` | 81 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/registry/sign-package.mjs` | 62 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/schema/fixtures/app-package-schema-suite.json` | 224 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/schema/schema-test-harness.ts` | 74 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `scripts/validate-domain-config.mjs` | 14 | Build/authoring automation | Keep deterministic, bounded, secret-safe, and covered by fixture contracts. |
| `server/package-lock.json` | 1807 | Server/service | Rewrite boundary candidate: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/package.json` | 25 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/chat-agent.ts` | 424 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/domain.ts` | 32 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/executor.ts` | 976 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/planner.ts` | 24 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/retrieval.ts` | 761 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/agents/verifier.ts` | 184 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/chat-runtime-state.ts` | 397 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/chat-runtime.ts` | 205 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/chat-storage.ts` | 9 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/chat.ts` | 635 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/conversations.ts` | 282 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/health/snapshots.ts` | 156 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/hono-read-routes.ts` | 63 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/http-utils.ts` | 169 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/index.ts` | 1334 | Server/service | Rewrite boundary candidate: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/computed-fields.ts` | 12 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/decision-ledger.ts` | 149 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/expression.ts` | 7 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/install-reactive-runtime.ts` | 575 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/living-rule-worker.ts` | 43 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/operation-observer.ts` | 82 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/package-registry.ts` | 515 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/package-schema.ts` | 9 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/package.ts` | 458 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/query-sql.ts` | 99 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/query-transition.ts` | 43 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/query.ts` | 12 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-cycle.ts` | 361 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-observer.ts` | 83 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-outbox.ts` | 475 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-proposal-command.ts` | 84 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-proposal-executor.ts` | 669 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-proposal-policy.ts` | 137 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-proposal-schema.ts` | 133 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-proposal-verification.ts` | 134 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/reactive-receipts.ts` | 199 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/recurrence.ts` | 7 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/rules.ts` | 63 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/runtime.ts` | 60 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/validation.ts` | 122 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/kernel/view.ts` | 24 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/mcp/official-server.ts` | 95 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/mcp/scoped-access.ts` | 279 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/mcp/sdk-server.ts` | 116 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/provenance.ts` | 57 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/provider-webhook-response.ts` | 111 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/contracts.ts` | 47 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/json-state.ts` | 158 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/citations.ts` | 40 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/client.ts` | 303 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/discovery.ts` | 45 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/port.ts` | 178 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/projection.ts` | 54 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/pull.ts` | 417 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/push.ts` | 574 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/notion/webhook.ts` | 244 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/client.ts` | 193 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/health.ts` | 39 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/port.ts` | 156 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/projection.ts` | 147 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/pull.ts` | 495 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/push.ts` | 739 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sheets/workbook.ts` | 86 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sync/notion.ts` | 179 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/sync/sheets.ts` | 300 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/undo-worker.ts` | 21 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/undo.ts` | 236 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/webhooks/notion.ts` | 236 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/providers/webhooks/sheets.ts` | 360 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/resources/catalog.ts` | 475 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/responses.ts` | 29 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/routes/chat-control-routes.ts` | 283 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/routes/chat-routes.ts` | 125 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/routes/health-connect.ts` | 84 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/routes/mcp-routes.ts` | 10 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/routes/package-routes.ts` | 122 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/routes/provider-routes.ts` | 448 | Server route family | Keep transport-only; delegate policy and execution; add exact-prefix contract tests. |
| `server/src/runtime/state-records.ts` | 119 | Server runtime state | Replace global/file state and sync subprocesses with repositories and durable jobs. |
| `server/src/runtime/state-store.ts` | 82 | Server runtime state | Replace global/file state and sync subprocesses with repositories and durable jobs. |
| `server/src/runtime/state-types.ts` | 217 | Server runtime state | Replace global/file state and sync subprocesses with repositories and durable jobs. |
| `server/src/runtime/state.ts` | 2001 | Server runtime state | Rewrite boundary candidate: Replace global/file state and sync subprocesses with repositories and durable jobs. |
| `server/src/runtime/workflows.ts` | 149 | Server runtime state | Replace global/file state and sync subprocesses with repositories and durable jobs. |
| `server/src/security/auth.ts` | 508 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/security/policy.ts` | 189 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/server.ts` | 2 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/tools/catalog.ts` | 3654 | Server tool catalog | Rewrite boundary candidate: Split schemas, policy, execution, receipts, and provider adapters. |
| `server/src/tools/tool-validation.ts` | 119 | Server tool catalog | Split schemas, policy, execution, receipts, and provider adapters. |
| `server/src/types/command.ts` | 59 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/types/json-logic-js.d.ts` | 7 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/types/local-query.ts` | 522 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflow-checkpoint.ts` | 2 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflows/checkpoint.ts` | 319 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflows/compensation.ts` | 271 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflows/control-machine.ts` | 3 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflows/index.ts` | 6 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/src/workflows/runner.ts` | 6 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/app-installation-foundation.ts` | 89 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/approval-schema-contract.ts` | 144 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/canonical-verification.ts` | 138 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/canonical-writer-concurrency.ts` | 61 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-agent-contract.ts` | 131 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-idempotency-request-concurrency.ts` | 98 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-idempotency-reservation-concurrency.ts` | 49 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-isolation-contract.ts` | 198 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-restart-replay.ts` | 122 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-runtime-contract.ts` | 33 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/chat-runtime-state-contract.ts` | 46 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/computed-fields-replay.ts` | 141 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/decision-ledger.ts` | 107 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/fixtures/canonical-writer-process.ts` | 39 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/fixtures/chat-idempotency-reservation-worker.ts` | 20 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/fixtures/json-state-concurrency-worker.ts` | 26 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/fixtures/operation-commit-outbox-process.ts` | 60 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/fixtures/reactive-lease-worker-process.ts` | 26 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/health-connect-route-contract.ts` | 164 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/health-snapshot-sync.ts` | 39 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/ingress-parity-boundary.ts` | 198 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/ingress-security.ts` | 227 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/json-state-concurrency.ts` | 54 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/kernel-validation.ts` | 31 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/living-rule-worker.ts` | 188 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/local-query-contract.ts` | 251 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/mcp-official-security.ts` | 416 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/mcp-resource-contract.ts` | 20 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/mcp-review-approval.ts` | 106 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/multiturn-conversation-contract.ts` | 85 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/notion/contract-notion-webhook.ts` | 361 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/notion/unit-notion-adapter.ts` | 322 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/operation-commit-transactional-outbox.ts` | 64 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/operation-observer.ts` | 91 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-contract.ts` | 330 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-registry-computed-fields.ts` | 111 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-registry-persistence.ts` | 67 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-routes-contract.ts` | 151 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-runtime.ts` | 41 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/package-validation.ts` | 55 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-persistence-contract.ts` | 40 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-retry-pagination-contract.ts` | 243 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-routes-contract.ts` | 155 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-sync-sheets.ts` | 223 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-undo-authority-contract.ts` | 459 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-webhook-ingress.ts` | 107 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/provider-webhook-retry.ts` | 71 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/query-kernel.ts` | 70 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/query-parity.ts` | 287 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/query-sql.ts` | 96 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/query-transition.ts` | 26 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-cycle-replay.ts` | 270 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-observer-failure-receipt.ts` | 53 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-observer.ts` | 75 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-outbox.ts` | 282 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-proposal-command.ts` | 53 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-proposal-executor.ts` | 909 | Server/service | Split/review hotspot: Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-proposal-verification.ts` | 90 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-receipts.ts` | 69 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-runtime-drain.ts` | 125 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-runtime-package-registry.ts` | 66 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/reactive-runtime-worker.ts` | 265 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/retrieval-contract.ts` | 59 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/retrieval-runtime-controls.ts` | 97 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/route-ownership-regression-contract.ts` | 353 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/rule-engine.ts` | 32 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/sheets-adapter-contract.ts` | 239 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/startup-security.ts` | 63 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/state-causal-contract.ts` | 46 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/state-persistence-contract.ts` | 50 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/undo-lifecycle-contract.ts` | 80 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/view-and-package-registry.ts` | 41 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/workflow-checkpoint-contract.ts` | 65 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/workflow-control-machine.ts` | 12 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/workflow-document-contract.ts` | 32 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `server/test/workflow-input-binding.ts` | 125 | Server/service | Reduce entrypoint ownership; enforce typed boundaries, auth, idempotency, and observability. |
| `src/actions/engine.ts` | 268 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/actions/policy.ts` | 84 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/actions/undo.ts` | 173 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/ai/runtime.ts` | 165 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/chat/citations.ts` | 80 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/chat/client.ts` | 1039 | Repository support | Rewrite boundary candidate: Keep reviewed and covered by its owning gate. |
| `src/chat/direct-provider.ts` | 122 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/chat/local-query.ts` | 303 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/chat/types.ts` | 116 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/config/ai.ts` | 122 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/config/fetchers.ts` | 217 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/config/runtime.ts` | 330 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/config/sync.ts` | 79 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/config/types.ts` | 67 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/data/sample.ts` | 603 | Repository support | Split/review hotspot: Keep reviewed and covered by its owning gate. |
| `src/db/actions.ts` | 158 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/app-package-registry.ts` | 1184 | SQLite persistence | Rewrite boundary candidate: Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/capability-consent-ledger.ts` | 369 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/config.ts` | 81 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/conversations.ts` | 203 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/migrations.ts` | 1075 | SQLite persistence | Rewrite boundary candidate: Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/outbox.ts` | 153 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/provider-status.ts` | 187 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/provider.native.tsx` | 131 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/provider.tsx` | 2 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/provider.web.tsx` | 62 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/records.ts` | 463 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/recovery.ts` | 93 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/seed.ts` | 65 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/sources.ts` | 214 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/undo.ts` | 57 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/db/workflows.ts` | 120 | SQLite persistence | Add migration, integrity, recovery, tenancy, and corruption-path tests. |
| `src/domain/account-cloud.ts` | 385 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/app-package-bridge.ts` | 193 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/canonical-json.ts` | 2 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/catalog.ts` | 820 | Domain/runtime core | Split/review hotspot: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/cloud-portability.ts` | 139 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/cloud-vault-storage.ts` | 178 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/cloud-vault.ts` | 1061 | Domain/runtime core | Rewrite boundary candidate: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/collaboration.ts` | 422 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/composition.ts` | 393 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/extension-trust.ts` | 120 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-authoring.ts` | 191 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-change-templates.ts` | 1345 | Domain/runtime core | Rewrite boundary candidate: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-control-room.native.ts` | 39 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-control-room.ts` | 899 | Domain/runtime core | Split/review hotspot: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-install.ts` | 585 | Domain/runtime core | Split/review hotspot: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-loader.ts` | 19 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-migrations.ts` | 1493 | Domain/runtime core | Rewrite boundary candidate: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-registry.ts` | 10 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-runtime.ts` | 20 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-sharing.native.ts` | 24 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/package-sharing.ts` | 990 | Domain/runtime core | Split/review hotspot: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/plugin-resolver.ts` | 60 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/publisher-trust-persistence.ts` | 15 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/publisher-trust-store.ts` | 866 | Domain/runtime core | Split/review hotspot: Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/queries.ts` | 142 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/renderer.tsx` | 79 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/runtime-context.ports.ts` | 25 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/runtime-context.tsx` | 2 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/runtime.ts` | 227 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/surface.ts` | 30 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/domain/visual-identity.ts` | 83 | Domain/runtime core | Remove React, Expo, Node, and storage imports; preserve deterministic contracts. |
| `src/health/connect.ports.ts` | 52 | Native capability adapter | Broker every call; keep native modules outside Core; add real-shell tests. |
| `src/health/connect.ts` | 393 | Native capability adapter | Broker every call; keep native modules outside Core; add real-shell tests. |
| `src/ops/apply.ts` | 355 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/ops/inverse.ts` | 39 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/ops/operation.ts` | 10 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/ops/plan.ts` | 203 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/ops/undo.ts` | 62 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/platform/incoming-audio-loop.ts` | 120 | Native capability adapter | Broker every call; keep native modules outside Core; add real-shell tests. |
| `src/platform/incoming-share.native.ts` | 2 | Native capability adapter | Broker every call; keep native modules outside Core; add real-shell tests. |
| `src/platform/incoming-share.ts` | 13 | Native capability adapter | Broker every call; keep native modules outside Core; add real-shell tests. |
| `src/presentation/computed-records.ts` | 52 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/json-render-domain-widgets.tsx` | 227 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/json-render-route.tsx` | 121 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/json-render-surface.tsx` | 963 | Renderer/presentation | Split/review hotspot: Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/json-render-widgets.tsx` | 3967 | Renderer/presentation | Rewrite boundary candidate: Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/lifecycle-confirmation.ts` | 42 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/markdown.ts` | 133 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widget-native-bridges.ts` | 292 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/audio-loop-contract.ts` | 139 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/audio-loop-engine.ts` | 45 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/audio-loop-persistence.ts` | 48 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/audio-loop-state.ts` | 998 | Renderer/presentation | Split/review hotspot: Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/audio-loop-storage-bridge.ts` | 151 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/generic-record-list-widgets.tsx` | 132 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/metric-chart-table-widget-family.ts` | 153 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/package-capability-broker.ts` | 250 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/panel-widget-family.tsx` | 291 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/scientific-calculator-engine.ts` | 174 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/timed-flow-widgets.tsx` | 320 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/presentation/widgets/widget-sdk.ts` | 180 | Renderer/presentation | Split large modules; inject effects; verify accessibility and cross-shell behavior. |
| `src/providers/data-home-adapter.ts` | 353 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/data-home-contract.ts` | 130 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/data-home-selection.ts` | 444 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/direct-source-sync.ts` | 518 | Provider/sync adapter | Split/review hotspot: Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/google-sheets-data-home.ts` | 1002 | Provider/sync adapter | Rewrite boundary candidate: Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/merge.ts` | 306 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/notion-data-home.ts` | 647 | Provider/sync adapter | Split/review hotspot: Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/provider-local-copy.ts` | 186 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/provider-token-storage.native.ts` | 16 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/provider-token-storage.ts` | 10 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/provider-token-storage.web.ts` | 10 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/reference-sync-transport.ts` | 157 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/shared-state-sync.ts` | 1354 | Provider/sync adapter | Rewrite boundary candidate: Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/status.ts` | 46 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/sync.ts` | 51 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/vendor-sync-compatibility.ts` | 182 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/providers/writeback.ts` | 407 | Provider/sync adapter | Separate pure protocol from transport; prove live failure and convergence paths. |
| `src/quality/GoldenLoopDebugBridge.tsx` | 83 | Proof/test bridge | Fail closed; require observed artifacts; compile debug surfaces out of release builds. |
| `src/quality/golden-loop-debug-handler.ts` | 410 | Proof/test bridge | Fail closed; require observed artifacts; compile debug surfaces out of release builds. |
| `src/quality/golden-loop-debug-protocol.ts` | 87 | Proof/test bridge | Fail closed; require observed artifacts; compile debug surfaces out of release builds. |
| `src/settings/audio-loop-state-storage.native.ts` | 14 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/audio-loop-state-storage.ts` | 11 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/audio-loop-state-storage.web.ts` | 12 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/settings-storage.native.ts` | 14 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/settings-storage.ts` | 6 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/settings-storage.web.ts` | 12 | Settings/secrets boundary | Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/settings/utopia-settings.ts` | 625 | Settings/secrets boundary | Split/review hotspot: Separate preferences from credentials; prohibit plaintext browser persistence. |
| `src/theme.ts` | 64 | Repository support | Keep reviewed and covered by its owning gate. |
| `src/workflows/control-machine.ts` | 35 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/workflows/runtime.ts` | 517 | Operation/workflow engine | Split/review hotspot: Keep deterministic and idempotent; isolate DB and clock through ports. |
| `src/workflows/timed-flow-runtime.ts` | 110 | Operation/workflow engine | Keep deterministic and idempotent; isolate DB and clock through ports. |
| `tasks/plan.md` | 344 | Repository support | Keep reviewed and covered by its owning gate. |
| `tasks/todo.md` | 113 | Repository support | Keep reviewed and covered by its owning gate. |
| `tests/ai/runtime.test.ts` | 131 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/agent-continuation.test.ts` | 65 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/direct-context.test.ts` | 76 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/direct-provider.test.ts` | 36 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/local-query.test.ts` | 141 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/local-undo.test.ts` | 104 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/chat/render.test.ts` | 55 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/config/ai.test.ts` | 96 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/config/domain-config-validator.test.ts` | 93 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/config/fetchers.test.ts` | 142 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/config/runtime.test.ts` | 175 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/config/sync.test.ts` | 150 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/conformance.test.ts` | 25 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/fixtures/app-lifecycle.json` | 212 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/fixtures/canonical.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/fixtures/capability-denial.json` | 22 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/fixtures/expression-corpus.json` | 427 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/conformance/fixtures/package-validation.json` | 133 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/capability-consent-ledger.test.ts` | 114 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/confidence-contract.test.ts` | 46 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/extension-trust-tuf-contract.test.ts` | 451 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/golden-loop-privacy.test.ts` | 89 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/import-boundary.test.ts` | 57 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/contracts/native-capabilities.test.ts` | 133 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/package-validation.test.ts` | 84 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/contracts/schema-authority.test.ts` | 48 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/schema-registry.test.ts` | 42 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/telemetry.test.ts` | 92 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/w1-kernel-boundary-fixtures.json` | 224 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/contracts/w1-kernel-contracts.test.ts` | 332 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/db/app-installation-data.test.ts` | 188 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/app-installation-secondary.test.ts` | 239 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/app-package-activation.test.ts` | 182 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/capability-consent-ledger.test.ts` | 238 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/cloud-account-foundation.test.ts` | 59 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/migrations.test.ts` | 336 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/provider-status.test.ts` | 56 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/db/sqlite-persistence.test.ts` | 122 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/account-cloud.test.ts` | 129 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/app-package-bridge.test.ts` | 108 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/app-package-registry.test.ts` | 583 | Automated test | Split/review hotspot: Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/cloud-portability.test.ts` | 35 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/cloud-vault-data-controls.test.ts` | 86 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/cloud-vault-storage.test.ts` | 89 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/cloud-vault.test.ts` | 114 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/collaboration.test.ts` | 174 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/composition.test.ts` | 103 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/extension-trust.test.ts` | 301 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/package-control-room.test.ts` | 190 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/package-install.test.ts` | 728 | Automated test | Split/review hotspot: Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/package-loader.test.ts` | 80 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/package-migrations.test.ts` | 498 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/publisher-trust-store.test.ts` | 943 | Automated test | Split/review hotspot: Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/registry-scale.test.ts` | 183 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/runtime-context.test.ts` | 108 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/runtime.test.ts` | 45 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/domain/sharing-bootstrap.test.ts` | 73 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/domain/vault.test.ts` | 348 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/fixtures/adversarial-apps/aquarium-chemistry-log/aquarium-chemistry-log.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/barcode-pantry-gun/barcode-pantry-gun.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/beehive-inspection/beehive-inspection.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/bicycle-cadence-trainer/bicycle-cadence-trainer.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/bird-call-identifier/bird-call-identifier.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/breath-pacer/breath-pacer.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/car-maintenance-mileage-time/car-maintenance-mileage-time.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/chess-clock/chess-clock.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/climbing-grade-progression/climbing-grade-progression.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/compound-recurring-chores/compound-recurring-chores.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/conway-game-of-life/conway-game-of-life.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/couples-chore-ledger/couples-chore-ledger.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/expense-splitter/expense-splitter.v1.json` | 256 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/family-location-board/family-location-board.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/fantasy-league-scorer/fantasy-league-scorer.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/genealogy-tree/genealogy-tree.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/geofenced-reminders/geofenced-reminders.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/handwriting-note-capture/handwriting-note-capture.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/household-voting-decision/household-voting-decision.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/knitting-pattern-tracker/knitting-pattern-tracker.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/language-conjugation-drill/language-conjugation-drill.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/lightning-distance-counter/lightning-distance-counter.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/liturgical-lunar-calendar/liturgical-lunar-calendar.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/live-shared-shopping-list/live-shared-shopping-list.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/loan-amortization-planner/loan-amortization-planner.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/macro-calorie-budget-rollover/macro-calorie-budget-rollover.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/menstrual-fertility-tracker/menstrual-fertility-tracker.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/metronome-polyrhythms/metronome-polyrhythms.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/music-practice-sheet-regions/music-practice-sheet-regions.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/nfc-tag-actions/nfc-tag-actions.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/package-that-edits-packages/package-that-edits-packages.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/photo-exif-trip-reconstructor/photo-exif-trip-reconstructor.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/reaction-time-tester/reaction-time-tester.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/recipe-scaler-unit-algebra/recipe-scaler-unit-algebra.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/scorecard-dashboard-package/scorecard-dashboard-package.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/seed-germination-matrix/seed-germination-matrix.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/shared-trip-budget/shared-trip-budget.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/shift-roster-rotating-patterns/shift-roster-rotating-patterns.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/sleep-tracker/sleep-tracker.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/sound-level-meter/sound-level-meter.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/sourdough-feeding-calculator/sourdough-feeding-calculator.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/spaced-repetition-flashcards/spaced-repetition-flashcards.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/split-rent-weighted-allocation/split-rent-weighted-allocation.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/star-chart/star-chart.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/tide-clock/tide-clock.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/tournament-bracket/tournament-bracket.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/turn-based-game-friend/turn-based-game-friend.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/watering-schedule-seasonal/watering-schedule-seasonal.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/whistle-find-phone/whistle-find-phone.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/adversarial-apps/wine-cellar-3d-bins/wine-cellar-3d-bins.v1.json` | 449 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-factory-prompts/manifest.json` | 376 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/README.md` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/authoring/locales/README.md` | 2 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/authoring/schemas/README.md` | 2 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/authoring/workflows/README.md` | 2 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/compiled/reference-app-1.0.0.package.json` | 215 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/compiled/reference-app-1.1.0.package.json` | 216 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/app-packages/reference-app/fixtures/records.json` | 210 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/duplicate-agent-id/agents-registry.patch.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/invalid-capability-op/agents-registry.patch.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/invalid-ref/domains-food.patch.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/missing-canonical/domain-catalog.patch.json` | 7 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/unknown-field/agents-registry.patch.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/domain-config/unknown-field/domain-catalog.patch.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/expression-runtime/corpus.json` | 427 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/golden-loop/shared-household-board.source.json` | 114 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-install/registry.json` | 22 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-install/valid-package.json` | 61 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/README.md` | 16 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/acceptance/capability-matrix.json` | 2 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/capabilities/dependency-pins.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/capabilities/native.json` | 133 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/capabilities/package.json` | 6 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/capabilities/pinned-at.json` | 2 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/collections/capability.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/queries/capabilities.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/capability-lab/screens/matrix.json` | 133 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/chores-lite/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/chores-lite/collections/chore.json` | 11 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/chores-lite/queries/today.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/chores-lite/screens/today.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/manifest.json` | 28 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/personal-crm-lite/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/personal-crm-lite/collections/contact.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/personal-crm-lite/queries/contacts.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/personal-crm-lite/screens/contacts.json` | 9 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/plants-lite/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/plants-lite/collections/plant.json` | 11 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/plants-lite/queries/plants.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/plants-lite/screens/plants.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/acceptance/reference-renderer.json` | 3 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/collections/assignment.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/collections/chore.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/collections/completion.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/collections/household_member.json` | 13 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/queries/chore_list.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/queries/completion_log.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/queries/household_roster.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/queries/today_assignments.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/screens/chores.json` | 22 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/screens/household.json` | 29 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/screens/review.json` | 21 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/reference-app/screens/today.json` | 29 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/subscriptions-lite/app.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/subscriptions-lite/collections/subscription.json` | 11 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/subscriptions-lite/queries/renewals.json` | 5 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-source/subscriptions-lite/screens/renewals.json` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/collection-id-mismatch.json` | 40 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/invalid-contract-checksum.json` | 108 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/invalid-native-capability.json` | 108 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/manifest.json` | 56 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/ui-unknown-collection.json` | 68 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/unknown-widget.json` | 63 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/v3-missing-collections.json` | 97 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/v3-missing-queries.json` | 102 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/v3-missing-views.json` | 98 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/valid-v2.json` | 71 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/valid-v3.json` | 139 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/view-id-mismatch.json` | 40 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/package-validation/view-unknown-query.json` | 40 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/build-requires-new-build.json` | 28 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/invalid-record-write-capability.json` | 18 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/manifest.json` | 34 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/runtime-compatible.json` | 28 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/runtime-fallback.json` | 58 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/server-unsupported.json` | 29 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/plugins/specialized-unsupported.json` | 28 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/recurrence-runtime/corpus.json` | 187 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/utopia-completion-audit/debug-app-blocked.json` | 34 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/fixtures/utopia-completion-audit/debug-app-pass.json` | 40 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/helpers/memory-db.ts` | 588 | Automated test | Split/review hotspot: Keep behavior-focused and add negative/failure-path coverage. |
| `tests/helpers/node-sqlite-db.ts` | 51 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/mocks/expo-crypto.ts` | 8 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/mocks/react-native.ts` | 4 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/W1-KERNEL-REPORT.md` | 35 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/apply.test.ts` | 446 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/plan.test.ts` | 128 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/undo.test.ts` | 97 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/writer-boundary-sqlite.test.ts` | 147 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/ops/writer-boundary.test.ts` | 141 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/platform/app-factory-examples.test.ts` | 158 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/audio-loop-intent.test.ts` | 86 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/platform/create-utopia-app.test.ts` | 49 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/food-package-source-roundtrip.test.ts` | 29 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/github-app-factory.test.ts` | 190 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/golden-loop-creator.test.ts` | 134 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/golden-loop-registry.test.ts` | 269 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/platform/golden-loop.test.ts` | 435 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/package-authoring.test.ts` | 100 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/platform/package-browser-builder.test.ts` | 446 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/package-compiler.test.ts` | 377 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/package-install-flow.test.ts` | 379 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/plugin-compatibility-expanded.test.ts` | 125 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/platform/plugin-compatibility.test.ts` | 123 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/platform/registry-worker.test.ts` | 374 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/audio-loop-contract.test.ts` | 249 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/presentation/audio-loop-persistence.test.ts` | 110 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/audio-loop-recorder-bridge.test.ts` | 41 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/audio-loop-state.test.ts` | 532 | Automated test | Split/review hotspot: Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/computed-records.test.ts` | 101 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/json-render-reference-app.test.ts` | 757 | Automated test | Split/review hotspot: Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/presentation/lifecycle-confirmation.test.ts` | 100 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/markdown.test.ts` | 37 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/presentation/widget-capability-broker.test.ts` | 171 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/data-home-adapter.test.ts` | 287 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/data-home-screen-source-contract.test.ts` | 39 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/providers/data-home-selection.test.ts` | 490 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/direct-source-sync.test.ts` | 147 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/golden-loop-sync.test.ts` | 62 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/google-sheets-data-home.test.ts` | 706 | Automated test | Split/review hotspot: Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/merge.test.ts` | 139 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/notion-data-home.test.ts` | 360 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/reference-sync-transport.test.ts` | 75 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/providers/shared-state-sync.test.ts` | 104 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/vendor-sync-compatibility.test.ts` | 49 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/providers/writeback.test.ts` | 470 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/android-command-planning.test.ts` | 81 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/android-device-identity.test.ts` | 27 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/android-fail-closed-blockers.test.ts` | 26 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/android-input-validation.test.ts` | 65 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/android-shell-proof-protocol.test.ts` | 246 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/ci-release-gates.test.ts` | 82 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/completion-audit.test.ts` | 31 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/core-boundaries.test.ts` | 73 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/core-port-boundaries.test.ts` | 24 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/dirty-tree-inventory.test.ts` | 20 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/emulator-sync-proof.test.ts` | 57 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/golden-loop-clean-checkout.test.ts` | 116 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-clean-snapshot-candidate.test.ts` | 53 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-creator-receipt.test.ts` | 120 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-debug-automation-protocol.test.ts` | 90 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/golden-loop-debug-bridge.test.ts` | 195 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-debug-driver.test.ts` | 77 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/golden-loop-local-guarantees.test.ts` | 348 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-multi-surface-receipts.test.ts` | 574 | Automated test | Split/review hotspot: Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/golden-loop-proof.test.ts` | 43 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/golden-loop-virtual-lab.test.ts` | 102 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/launch-proof.test.ts` | 38 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/macos-shared-household-runtime.test.ts` | 461 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/multi-surface-sync-proof.test.ts` | 240 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/physical-device-release-evidence.test.ts` | 298 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/providers/live-provider-readiness.test.ts` | 129 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/receipt-adapter.test.ts` | 122 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/repository-classification.test.ts` | 28 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/security-gates.test.ts` | 203 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/shell-proof-protocol.test.ts` | 374 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/standalone-quality-installation-scoping.test.ts` | 179 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/quality/sync-transport.test.ts` | 124 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/web-execution-receipt.test.ts` | 402 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/quality/web-package-artifacts.test.ts` | 89 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/expression-conformance.test.ts` | 244 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/expression-proof-apps.test.ts` | 85 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/focus-intervals-flow-app.test.ts` | 108 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/recurrence-proof-apps.test.ts` | 160 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/recurrence-runtime.test.ts` | 102 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/runtime/timed-flow.test.ts` | 146 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/runtime/workout-logger-flow-app.test.ts` | 179 | Automated test | Prefer behavior assertions; retain source-shape checks only as secondary ratchets. |
| `tests/settings/utopia-settings.test.ts` | 94 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/workflows/control-machine.test.ts` | 33 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/workflows/runtime.test.ts` | 415 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tests/workflows/timed-flow-runtime.test.ts` | 59 | Automated test | Keep behavior-focused and add negative/failure-path coverage. |
| `tsconfig.json` | 24 | Repository support | Keep reviewed and covered by its owning gate. |
| `vitest.config.ts` | 20 | Repository support | Keep reviewed and covered by its owning gate. |

## Post-Commit Additions (0b340b1)

These files were added after the original `bf0efff` review. They are listed
separately so the original alphabetical index remains stable while the review
still covers the current commit.

| File | Lines | Role | Improvement scope |
|---|---:|---|---|
| `.github/workflows/golden-loop-all-surfaces.yml` | 395 | GitHub workflow | Keep permissions narrow; require real evidence and preserve fail-closed blockers. |
| `.github/workflows/golden-loop-android-emulators.yml` | 342 | GitHub workflow | Keep permissions narrow; require real evidence and preserve fail-closed blockers. |
| `.github/workflows/golden-loop-macos.yml` | 57 | GitHub workflow | Keep permissions narrow; require real evidence and preserve fail-closed blockers. |
| `.github/workflows/golden-loop-web.yml` | 54 | GitHub workflow | Keep permissions narrow; require real evidence and preserve fail-closed blockers. |
| `adapters/core-crypto.ts` | 27 | Shell adapter | Own concrete runtime dependencies behind Core ports. |
| `docs/CODEBASE_DEEP_REVIEW_2026-07-30.md` | 135 | Documentation | Keep only current findings, statuses, evidence, and release-profile blockers. |
| `docs/CODEBASE_FILE_SCOPE_INDEX_2026-07-30.md` | 1250 | Documentation | Keep claims tied to current artifacts; distinguish local readiness from external proof. |
| `docs/archive/CODEBASE_DEEP_REVIEW_BASELINE_BF0EFFF_2026-07-30.md` | 1429 | Documentation archive | Preserve historical findings for provenance; never present them as current without reconfirmation. |
| `docs/chat-control-decomposition.md` | 25 | Documentation | Keep claims tied to current artifacts; distinguish local readiness from external proof. |
| `schemas/utopia-spectral-rules.json` | 8 | Schema authority | Validate through canonical JSON Schema and keep generated consumers aligned. |
| `scripts/factory/run-creator-proof-harness.ts` | 216 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/check-dependency-dead-code-ownership.mjs` | 111 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/check-release-debug-bridge-exclusion.mjs` | 48 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/check-renderer-server-size-ratchet.mjs` | 41 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/check-schema-conformance.ts` | 57 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/dependency-dead-code-ownership-baseline.json` | 13 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/golden-loop/check-constrained-creator-agents.mjs` | 75 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/golden-loop/cross-runtime-conformance.ts` | 489 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/golden-loop/run-web-lane-b.mjs` | 78 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/macos/run-golden-loop-macos-lane.mjs` | 327 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/renderer-server-size-baseline.json` | 13 | Quality/factory tooling | Use observed artifacts; never convert blocked, synthetic, or stale evidence into PASS. |
| `scripts/quality/security/check-action-permissions-gate.mjs` | 55 | Security gate | Keep scanner output redacted, deterministic, and blocking on missing tooling or findings. |
| `scripts/quality/security/check-gitleaks-gate.mjs` | 47 | Security gate | Keep scanner output redacted, deterministic, and blocking on missing tooling or findings. |
| `scripts/quality/security/security-artifact.mjs` | 28 | Security gate | Keep scanner output redacted, deterministic, and blocking on missing tooling or findings. |
| `server/src/repositories/chat-control-repository.ts` | 98 | Server runtime | Keep route/service/repository ownership explicit and preserve auth, idempotency, streaming, retry, and undo semantics. |
| `server/src/repositories/chat-runtime-job-repository.ts` | 425 | Server runtime | Keep route/service/repository ownership explicit and preserve auth, idempotency, streaming, retry, and undo semantics. |
| `server/src/services/chat-control-service.ts` | 342 | Server runtime | Keep route/service/repository ownership explicit and preserve auth, idempotency, streaming, retry, and undo semantics. |
| `server/src/tools/policy-receipts.ts` | 359 | Server runtime | Keep route/service/repository ownership explicit and preserve auth, idempotency, streaming, retry, and undo semantics. |
| `server/test/chat-control-boundary-contract.ts` | 20 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `server/test/chat-control-service-contract.ts` | 119 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `server/test/chat-runtime-job-repository-contract.ts` | 98 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `src/domain/crypto-port.ts` | 18 | Core port | Keep the domain headless and make shell/database/crypto dependencies explicit ports. |
| `src/domain/database-port.ts` | 17 | Core port | Keep the domain headless and make shell/database/crypto dependencies explicit ports. |
| `src/presentation/widgets/file-widgets.tsx` | 231 | Renderer/widget | Keep widget families generic, capability-brokered, and shell-safe. |
| `src/presentation/widgets/navigation-widget-family.tsx` | 60 | Renderer/widget | Keep widget families generic, capability-brokered, and shell-safe. |
| `src/quality/DevelopmentGoldenLoopBridge.tsx` | 1 | Proof bridge | Keep debug-only bridges excluded from release and require observed operations. |
| `src/quality/ReleaseNoopGoldenLoopBridge.tsx` | 3 | Proof bridge | Keep debug-only bridges excluded from release and require observed operations. |
| `tests/conformance/fixtures/schema-corpus.json` | 7 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/conformance/schema-conformance.test.ts` | 57 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/contracts/registry-trust-lifecycle.test.ts` | 24 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/contracts/schema-conformance.test.ts` | 42 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/db/records.test.ts` | 61 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/db/recovery.test.ts` | 111 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/constrained-creator-agent-proof.test.ts` | 27 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/creator-proof-harness.test.ts` | 49 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/cross-runtime-conformance.test.ts` | 53 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/golden-loop-macos-lane-c.test.ts` | 53 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/golden-loop-web-lane-b.test.ts` | 33 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/google-sheets-live-proof.test.ts` | 147 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/release-debug-bridge-exclusion.test.ts` | 26 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/static-quality-gates.test.ts` | 38 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
| `tests/quality/widget-capability-boundaries.test.ts` | 48 | Automated test | Prefer behavior and failure-path assertions; retain provenance checks. |
