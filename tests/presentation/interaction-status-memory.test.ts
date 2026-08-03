import { beforeEach, describe, expect, it } from "vitest";
import {
  clearInteractionStatusMemory,
  recallInteractionStatus,
  rememberInteractionStatus,
} from "../../src/presentation/widgets/interaction-status-memory";

describe("interaction status memory", () => {
  beforeEach(() => clearInteractionStatusMemory());

  it("survives a component remount within the bounded TTL", () => {
    rememberInteractionStatus("installation:list", "Queued for later", 1_000);
    expect(recallInteractionStatus("installation:list", 30_999)).toBe("Queued for later");
  });

  it("expires and isolates status by installation and collection", () => {
    rememberInteractionStatus("one:list", "Saved", 1_000);
    expect(recallInteractionStatus("two:list", 1_001)).toBe("");
    expect(recallInteractionStatus("one:list", 31_000)).toBe("");
  });

  it("clears empty status instead of preserving stale feedback", () => {
    rememberInteractionStatus("one:list", "Saved", 1_000);
    rememberInteractionStatus("one:list", "", 1_100);
    expect(recallInteractionStatus("one:list", 1_101)).toBe("");
  });
});
