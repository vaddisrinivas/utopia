import { describe, expect, it, vi } from "vitest";

import {
  externalUrlResultMessage,
  requestExternalUrlOpen,
  validateExternalUrl,
} from "@/src/domain/external-url-broker";

describe("external URL broker", () => {
  it("allows only HTTP(S) URLs without credentials or control characters", () => {
    expect(validateExternalUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    expect(validateExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(validateExternalUrl("javascript:alert(1)")).toBeNull();
    expect(validateExternalUrl("file:///tmp/secret")).toBeNull();
    expect(validateExternalUrl("https://user:pass@example.com")).toBeNull();
    expect(validateExternalUrl("https://example.com/a b")).toBeNull();
  });

  it("requires confirmation before invoking the injected opener", async () => {
    const confirm = vi.fn(async () => false);
    const open = vi.fn(async () => undefined);
    await expect(requestExternalUrlOpen("https://example.com", { confirm, open })).resolves.toEqual({
      status: "cancelled",
      url: "https://example.com/",
    });
    expect(confirm).toHaveBeenCalledWith("https://example.com/");
    expect(open).not.toHaveBeenCalled();
  });

  it("fails closed and reports opener failures", async () => {
    const confirm = vi.fn(async () => true);
    const open = vi.fn(async () => { throw new Error("blocked"); });
    await expect(requestExternalUrlOpen("data:text/plain,secret", { confirm, open })).resolves.toEqual({
      status: "invalid_url",
      url: "data:text/plain,secret",
    });
    await expect(requestExternalUrlOpen("https://example.com", { confirm, open })).resolves.toEqual({
      status: "open_failed",
      url: "https://example.com/",
    });
    expect(externalUrlResultMessage({ status: "open_failed", url: "https://example.com/" })).toBe("Could not open this link.");
  });
});
