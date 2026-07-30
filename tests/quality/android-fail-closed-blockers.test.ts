import { describe, expect, it } from "vitest";
import { getHookBlockerIfMissing, PUBLIC_UI_HOOKS, REQUIRED_MISCONFIG_MARKERS } from "../../scripts/quality/android/golden-loop-android-plan.mjs";

describe("android lane fail-closed blocker behavior", () => {
  it("flags missing public board-row hook as BLOCKED", () => {
    const blocker = getHookBlockerIfMissing(5, 5, PUBLIC_UI_HOOKS.createBoardRow);
    expect(blocker).toMatchObject({
      status: "BLOCKED",
      reason: "missing:public_ui_create_board_row",
    });
  });

  it("flags missing public reference-sync hook as BLOCKED", () => {
    const blocker = getHookBlockerIfMissing(1, 1, PUBLIC_UI_HOOKS.configureReferenceSync);
    expect(blocker).toMatchObject({
      status: "BLOCKED",
      reason: "missing:public_ui_configure_reference_sync",
    });
  });

  it("keeps miss markers aligned with expected hook strings", () => {
    expect(REQUIRED_MISCONFIG_MARKERS).toContain("missing:public_ui_create_board_row");
    expect(REQUIRED_MISCONFIG_MARKERS).toContain("missing:public_ui_configure_reference_sync");
  });
});
