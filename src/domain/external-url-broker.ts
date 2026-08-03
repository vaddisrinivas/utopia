export type ExternalUrlOpenResult =
  | { status: "opened"; url: string }
  | { status: "invalid_url"; url: string }
  | { status: "cancelled"; url: string }
  | { status: "open_failed"; url: string };

export type ExternalUrlOpenDependencies = Readonly<{
  confirm: (url: string) => Promise<boolean>;
  open: (url: string) => Promise<void>;
}>;

export function validateExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\u007f\s]/.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export async function requestExternalUrlOpen(
  value: unknown,
  dependencies: ExternalUrlOpenDependencies,
): Promise<ExternalUrlOpenResult> {
  const url = validateExternalUrl(value);
  if (!url) return { status: "invalid_url", url: typeof value === "string" ? value : "" };

  let confirmed = false;
  try {
    confirmed = await dependencies.confirm(url);
  } catch {
    return { status: "cancelled", url };
  }
  if (!confirmed) return { status: "cancelled", url };

  try {
    await dependencies.open(url);
    return { status: "opened", url };
  } catch {
    return { status: "open_failed", url };
  }
}

export function externalUrlResultMessage(result: ExternalUrlOpenResult): string {
  switch (result.status) {
    case "opened":
      return "Opened link.";
    case "cancelled":
      return "Link opening cancelled.";
    case "open_failed":
      return "Could not open this link.";
    case "invalid_url":
      return "This link is not a valid HTTP or HTTPS URL.";
  }
}
