export async function readProviderTokenValue(_key: string): Promise<string | null> {
  return null;
}

export async function writeProviderTokenValue(_key: string, _value: string): Promise<void> {
  throw new Error('provider_token_storage_unavailable');
}

export async function deleteProviderTokenValue(_key: string): Promise<void> {}
