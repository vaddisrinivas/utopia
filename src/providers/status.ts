export type UtopiaProviderStatus = {
  status: 'ok';
  authority: string;
  providers: {
    notion: {
      configured: boolean;
      data_source_id: string | null;
      api_version: string | null;
      webhook_configured: boolean;
    };
    google_sheets: {
      configured: boolean;
      spreadsheet_id: string | null;
      data_source_id: string | null;
      workbook_name: string | null;
    };
    openai: {
      configured: boolean;
      model: string;
    };
  };
  secrets_exposed: false;
};

export async function getUtopiaProviderStatus(input: {
  baseUrl: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<UtopiaProviderStatus | null> {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, '');
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/providers/status`, {
      headers: input.token?.trim() ? { Authorization: `Bearer ${input.token.trim()}` } : undefined,
      signal: input.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as UtopiaProviderStatus;
    if (payload.status !== 'ok' || payload.secrets_exposed !== false) return null;
    return payload;
  } catch {
    return null;
  }
}
