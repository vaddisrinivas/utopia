import { describe, expect, it } from "vitest";
import { PUBLIC_UI_HOOKS, getDefaultAndroidCommands } from "../../scripts/quality/android/golden-loop-android-plan.mjs";

describe("android quality lane command planning", () => {
  it("builds two-device lane plan with required adb deep link phases", () => {
    const plan = getDefaultAndroidCommands({
      emulatorSerials: ["emulator-5554", "emulator-5556"],
      packageId: "app.utopia.goldenloop",
      apkV1Path: "/tmp/utopia-v1.apk",
      apkV2Path: "/tmp/utopia-v2.apk",
      relayPort: 3123,
    });

    expect(plan).toBeDefined();
    expect(plan?.length).toBeGreaterThan(0);
    expect(plan?.map((step) => step.phase)).toEqual(
      expect.arrayContaining([
        "discover-emulators",
        "install-update-rollback",
        "identity-init",
        "board-row-hook",
        "reference-sync-hook",
        "reference-sync-relay",
        "rollback-attempt",
      ]),
    );

    const identity = plan?.find((step) => step.phase === "identity-init");
    const boardHook = plan?.find((step) => step.phase === "board-row-hook");
    const syncHook = plan?.find((step) => step.phase === "reference-sync-hook");
    const updateRollback = plan?.find((step) => step.phase === "install-update-rollback");
    const rollback = plan?.find((step) => step.phase === "rollback-attempt");
    expect(identity?.commands.length).toBe(2);
    expect(boardHook?.commands.length).toBe(2);
    expect(syncHook?.commands.length).toBe(2);
    expect(updateRollback?.commands.length).toBe(4);
    expect(rollback?.commands.length).toBe(2);
    expect(rollback?.commands.every((cmd) => cmd[0] === "adb")).toBe(true);
    const uninstallCommands = plan?.flatMap((step) =>
      step.commands.filter((cmd) => cmd[1]?.includes("uninstall")),
    );
    expect(uninstallCommands.length).toBe(0);
  });

  it("requires exactly two explicit emulator serials", () => {
    expect(() =>
      getDefaultAndroidCommands({
        emulatorSerials: ["emulator-5554"],
        packageId: "app.utopia.goldenloop",
        apkV1Path: "/tmp/utopia-v1.apk",
        apkV2Path: "/tmp/utopia-v2.apk",
      }),
    ).toThrow("android lane plan requires exactly two explicit emulator serials");

    expect(() =>
      getDefaultAndroidCommands({
        emulatorSerials: ["emulator-5554", "emulator-5556", "emulator-5557"],
        packageId: "app.utopia.goldenloop",
        apkV1Path: "/tmp/utopia-v1.apk",
        apkV2Path: "/tmp/utopia-v2.apk",
      }),
    ).toThrow("android lane plan requires exactly two explicit emulator serials");
  });

  it("enforces dedicated .goldenloop package id", () => {
    expect(() =>
      getDefaultAndroidCommands({
        emulatorSerials: ["emulator-5554", "emulator-5556"],
        packageId: "com.example.app",
        apkV1Path: "/tmp/utopia-v1.apk",
        apkV2Path: "/tmp/utopia-v2.apk",
      }),
    ).toThrow("android lane plan requires dedicated packageId ending .goldenloop");
  });

  it("uses public UI hook names that map to fail-closed blockers", () => {
    expect(PUBLIC_UI_HOOKS.createBoardRow).toBe("public_ui_create_board_row");
    expect(PUBLIC_UI_HOOKS.configureReferenceSync).toBe("public_ui_configure_reference_sync");
  });
});
