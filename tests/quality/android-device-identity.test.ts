import { describe, expect, it } from "vitest";
import { areInstallationIdsDistinct, collectInstallationIdsFromStates } from "../../scripts/quality/android/golden-loop-android-plan.mjs";

describe("android lane two-device identity", () => {
  it("detects distinct installation ids from two real device states", () => {
    const states = [
      { installationRows: [{ installation_id: "id-device-a", created_at: "now" }] },
      { installationRows: [{ installationId: "id-device-b", token: "abc" }] },
    ];

    const ids = collectInstallationIdsFromStates(states);
    expect(ids).toEqual(["id-device-a", "id-device-b"]);
    expect(areInstallationIdsDistinct(states)).toBe(true);
  });

  it("fails when installation ids collapse to a single value", () => {
    const states = [
      { installationRows: [{ installation_id: "dup-id" }] },
      { installationRows: [{ installation_id: "dup-id" }] },
    ];

    const ids = collectInstallationIdsFromStates(states);
    expect(ids).toEqual(["dup-id", "dup-id"]);
    expect(areInstallationIdsDistinct(states)).toBe(false);
  });
});
