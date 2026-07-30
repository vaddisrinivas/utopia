export const PUBLIC_UI_HOOKS = Object.freeze({
  createBoardRow: "public_ui_create_board_row",
  configureReferenceSync: "public_ui_configure_reference_sync",
});

export const REQUIRED_MISCONFIG_MARKERS = [
  "missing:public_ui_create_board_row",
  "missing:public_ui_configure_reference_sync",
];

/**
 * @param {Array<string | number | null | undefined>} serials
 * @returns {string[]}
 */
export function normalizeEmulatorSerials(serials = []) {
  const seen = new Set();
  const out = [];
  for (const serial of serials) {
    const value = `${serial || ""}`.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * @typedef {Object} AndroidLaneInput
 * @property {string[]} [emulatorSerials]
 * @property {string} [packageId]
 * @property {string} [apkV1Path]
 * @property {string} [apkV2Path]
 * @property {number} [relayPort]
 */

/**
 * @param {AndroidLaneInput} [options={}]
 * @returns {Array<{ phase: string; commands: string[][] }>}
 */
export function getDefaultAndroidCommands({
  emulatorSerials,
  packageId,
  apkV1Path,
  apkV2Path,
  relayPort = 3100,
} = /** @type {AndroidLaneInput} */ ({})) {
  const candidates = Array.isArray(emulatorSerials)
    ? emulatorSerials
    : [];
  const serials = normalizeEmulatorSerials(candidates);
  if (serials.length !== 2) {
    throw new Error("android lane plan requires exactly two explicit emulator serials");
  }

  const serialA = serials[0];
  const serialB = serials[1];
  if (!serialA.startsWith("emulator-") || !serialB.startsWith("emulator-")) {
    throw new Error("android lane plan requires emulator-* serials");
  }
  if (!packageId || !String(packageId).endsWith(".goldenloop")) {
    throw new Error("android lane plan requires dedicated packageId ending .goldenloop");
  }
  if (!packageId || !apkV1Path || !apkV2Path) {
    throw new Error("android lane plan requires packageId, apkV1Path, and apkV2Path");
  }

  const installArgs = ["-r", "-d", "-g"];

  return [
    {
      phase: "discover-emulators",
      commands: [["adb", ["devices"]]],
    },
    {
      phase: "install-update-rollback",
      commands: [
        ["adb", ["-s", serialA, "install", ...installArgs, apkV1Path]],
        ["adb", ["-s", serialB, "install", ...installArgs, apkV1Path]],
        ["adb", ["-s", serialA, "install", ...installArgs, apkV2Path]],
        ["adb", ["-s", serialB, "install", ...installArgs, apkV2Path]],
      ],
    },
    {
      phase: "identity-init",
      commands: [
        ["adb", ["-s", serialA, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://chat?prompt=golden-loop-identity&run=1"]],
        ["adb", ["-s", serialB, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://chat?prompt=golden-loop-identity&run=1"]],
      ],
    },
    {
      phase: "board-row-hook",
      commands: [
        ["adb", ["-s", serialA, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://chat?prompt=golden-loop-create-board-row&run=1"]],
        ["adb", ["-s", serialB, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://chat?prompt=golden-loop-create-board-row&run=1"]],
      ],
    },
    {
      phase: "reference-sync-hook",
      commands: [
        ["adb", ["-s", serialA, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://settings?run=1"]],
        ["adb", ["-s", serialB, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "utopia://settings?run=1"]],
      ],
    },
    {
      phase: "reference-sync-relay",
      commands: [["node", ["scripts/quality/reference-sync-transport-relay.ts", "--port", String(relayPort), "--host", "127.0.0.1"]]],
    },
    {
      phase: "rollback-attempt",
      commands: [
        ["adb", ["-s", serialA, "install", ...installArgs, apkV1Path]],
        ["adb", ["-s", serialB, "install", ...installArgs, apkV1Path]],
      ],
    },
  ];
}

export function parseAdbDevices(rawOutput) {
  if (typeof rawOutput !== "string") return [];
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .map((line) => /^([^\s]+)\s+(device|offline|unauthorized)/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

export function getHookBlockerIfMissing(beforeCount = 0, afterCount = 0, hookName = "") {
  if (afterCount > beforeCount) return null;
  return {
    status: "BLOCKED",
    reason: `missing:${hookName}`,
  };
}

export function deriveInstallationId(identity = []) {
  const preferredKeys = ["installation_id", "installationId", "id"];
  const ids = identity.flatMap((row) => {
    const entries = Object.entries(row || {});
    const direct = preferredKeys
      .map((key) => entries.find(([name]) => name === key))
      .filter(Boolean)
      .map(([, value]) => `${value}`.trim())
      .filter(Boolean);
    if (direct.length) return direct;
    return entries
      .filter(([name, value]) => /id/i.test(name) && value !== null && `${value}`.trim() !== "")
      .map(([, value]) => `${value}`.trim());
  });
  return ids[0] || null;
}

export function collectInstallationIdsFromStates(states = []) {
  const found = [];
  for (const state of states) {
    const packageRows = Array.isArray(state?.tables?.app_installation_package_state)
      ? state.tables.app_installation_package_state
      : [];
    const installRows = Array.isArray(state?.tables?.app_installations)
      ? state.tables.app_installations
      : [];
    const fallbackRows = Array.isArray(state?.installationRows) ? state.installationRows : [];
    const candidateRows = [...packageRows, ...installRows, ...fallbackRows];
    const id = deriveInstallationId(candidateRows);
    if (id) found.push(id);
  }
  return found;
}

export function areInstallationIdsDistinct(states = []) {
  const ids = collectInstallationIdsFromStates(states);
  const set = new Set(ids);
  return ids.length >= 2 && set.size === ids.length;
}
