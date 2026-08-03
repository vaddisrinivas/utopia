import { describe, expect, it } from "vitest";
import { collectAndroidInputs, missingRequiredOperationIds, nextActionForAndroidBlock, validateGoldenLoopInputs } from "../../scripts/quality/android/run-golden-loop-android-lane.mjs";
import { redactSensitiveText } from "../../scripts/quality/android/run-golden-loop-android-lane.mjs";

describe("android lane input validation", () => {
  function collectWithEnv(overrides: Record<string, string>) {
    return collectAndroidInputs([], {
      ...process.env,
      ...overrides,
    } as NodeJS.ProcessEnv);
  }

  it("blocks when explicit opt-in is missing", () => {
    const inputs = collectWithEnv({
      UTOPIA_ANDROID_GOLDEN_LOOP: "0",
      UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS: "emulator-5554,emulator-5556",
      UTOPIA_ANDROID_PACKAGE_ID: "app.utopia.goldenloop",
      APK_PATH_V1: "/tmp/utopia-v1.apk",
      APK_PATH_V2: "/tmp/utopia-v2.apk",
    });

    const validated = validateGoldenLoopInputs(inputs, { requireApkFiles: false, source: { UTOPIA_ANDROID_GOLDEN_LOOP: "0" } });
    expect(validated.blockers).toContain("missing:android_golden_loop_opt_in");
  });

  it("blocks same APK hash pair", () => {
    const inputs = collectWithEnv({
      UTOPIA_ANDROID_GOLDEN_LOOP: "1",
      UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS: "emulator-5554,emulator-5556",
      UTOPIA_ANDROID_PACKAGE_ID: "app.utopia.goldenloop",
      APK_PATH_V1: "/tmp/utopia-v1.apk",
      APK_PATH_V2: "/tmp/utopia-v2.apk",
      APK_V1_SHA256: "a".repeat(64),
      APK_V2_SHA256: "a".repeat(64),
    });

    const validated = validateGoldenLoopInputs(inputs, { requireApkFiles: false });
    expect(validated.blockers).toContain("invalid:android_apk_hash_match");
  });

  it("blocks non-emulator serials", () => {
    const inputs = collectWithEnv({
      UTOPIA_ANDROID_GOLDEN_LOOP: "1",
      UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS: "device-abc,emulator-5554",
      UTOPIA_ANDROID_PACKAGE_ID: "app.utopia.goldenloop",
      APK_PATH_V1: "/tmp/utopia-v1.apk",
      APK_PATH_V2: "/tmp/utopia-v2.apk",
      APK_V1_SHA256: "a".repeat(64),
      APK_V2_SHA256: "b".repeat(64),
    });

    const validated = validateGoldenLoopInputs(inputs, { requireApkFiles: false });
    expect(validated.blockers).toContain("invalid:android_emulator_serial_format");
  });

  it("redacts sensitive command payload text", () => {
    const redacted = redactSensitiveText(
      "Authorization: Bearer abc123 token=xyz\nCookie: session=abc\nset-cookie: sid=secret; HttpOnly",
    );
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("session=abc");
    expect(redacted).toContain("[redacted]");
  });

  it("maps blocked states to concrete next action", () => {
    expect(nextActionForAndroidBlock("missing:android_emulator_serials")).toContain("UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS");
    expect(nextActionForAndroidBlock("missing:android_golden_loop_opt_in")).toContain("UTOPIA_ANDROID_GOLDEN_LOOP=1");
  });

  it("requires every dispatched operation to be observed by the app runtime", () => {
    expect(missingRequiredOperationIds(["debug-write-record"], ["debug-write-record", "debug-transport-reconnect"]))
      .toEqual(["debug-transport-reconnect"]);
    expect(missingRequiredOperationIds(["debug-write-record", "debug-write-record"], ["debug-write-record"]))
      .toEqual([]);
  });

  it("maps an absent first-command bridge to a BLOCKED next action", () => {
    expect(nextActionForAndroidBlock("missing:android_golden_loop_debug_bridge"))
      .toContain("UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN");
  });
});
