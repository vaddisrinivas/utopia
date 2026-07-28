import { AiProviderProfile, providerLabel } from '@/src/settings/utopia-settings';

type ModelTurn = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function trimSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function openAiEndpoint(profile: AiProviderProfile): string {
  const base = trimSlash(profile.baseUrl);
  if (profile.provider === 'azure_openai') {
    const version = profile.apiVersion || '2024-10-21';
    return `${base}/openai/deployments/${encodeURIComponent(profile.model)}/chat/completions?api-version=${encodeURIComponent(version)}`;
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function anthropicEndpoint(profile: AiProviderProfile): string {
  const base = trimSlash(profile.baseUrl);
  return base.endsWith('/v1/messages') ? base : `${base}/v1/messages`;
}

function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as { message?: { content?: unknown } }).message
    : null;
  if (typeof message?.content === 'string') return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map((item) => item && typeof item === 'object' && 'text' in item ? String(item.text) : '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function extractAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => item && typeof item === 'object' && 'text' in item ? String(item.text) : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function sendDirectModelMessage(input: {
  profile: AiProviderProfile;
  messages: ModelTurn[];
  signal?: AbortSignal;
}): Promise<{ text: string; provider: string }> {
  const { profile, messages, signal } = input;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let endpoint: string;
  let body: Record<string, unknown>;

  if (profile.provider === 'anthropic') {
    endpoint = anthropicEndpoint(profile);
    headers['x-api-key'] = profile.apiKey;
    headers['anthropic-version'] = profile.apiVersion || '2023-06-01';
    const system = messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n');
    body = {
      model: profile.model,
      max_tokens: 1600,
      ...(system ? { system } : {}),
      messages: messages
        .filter((item) => item.role !== 'system')
        .map((item) => ({ role: item.role, content: item.content })),
    };
  } else {
    endpoint = openAiEndpoint(profile);
    if (profile.provider === 'azure_openai') headers['api-key'] = profile.apiKey;
    else headers.authorization = `Bearer ${profile.apiKey}`;
    body = {
      ...(profile.provider === 'azure_openai' ? {} : { model: profile.model }),
      messages,
      ...(profile.provider === 'azure_openai' ? {} : { temperature: 0.2 }),
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`${providerLabel(profile)} returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const payload = await response.json() as unknown;
  const text = profile.provider === 'anthropic' ? extractAnthropicText(payload) : extractOpenAiText(payload);
  if (!text) throw new Error(`${providerLabel(profile)} returned no text.`);
  return { text, provider: providerLabel(profile) };
}

export async function testDirectModelProfile(profile: AiProviderProfile): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await sendDirectModelMessage({
      profile,
      signal: controller.signal,
      messages: [
        { role: 'system', content: 'Reply with exactly: Connected' },
        { role: 'user', content: 'Connection test.' },
      ],
    });
    return `${result.provider} connected.`;
  } finally {
    clearTimeout(timeout);
  }
}
