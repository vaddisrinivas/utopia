function unavailable(): never {
  throw new Error('package_vault_crypto_unavailable_on_native');
}

export function buildRegistryInstallDescriptor(): never {
  return unavailable();
}

export function exportEncryptedPackageVault(): never {
  return unavailable();
}

export function parseVaultExport(): never {
  return unavailable();
}

export function previewEncryptedPackageVault(): never {
  return unavailable();
}

export function serializeVaultExport(): never {
  return unavailable();
}
