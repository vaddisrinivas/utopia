import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  buildRegistryInstallDescriptor,
  exportEncryptedPackageVault,
  parseVaultExport,
  previewEncryptedPackageVault,
  serializeVaultExport,
} from '@/src/domain/package-sharing';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { colors } from '@/src/theme';

type RestorePreviewState = Readonly<{
  serialized: string;
  preview: ReturnType<typeof previewEncryptedPackageVault>;
}>;

export default function VaultScreen() {
  const { activePackage, activateAppPackage, installation, refreshRuntime } = useAppRuntime();
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importText, setImportText] = useState('');
  const [exportedText, setExportedText] = useState('');
  const [previewState, setPreviewState] = useState<RestorePreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sourceUrl = installation?.packageBinding?.sourceUrl ?? null;
  const canExport = Boolean(activePackage && sourceUrl && exportPassphrase.trim().length >= 12);
  const exportFileName = useMemo(() => {
    const packageId = activePackage?.id?.replace(/[^a-zA-Z0-9._-]/g, '-') || 'package';
    return `${packageId}-vault.json`;
  }, [activePackage?.id]);

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  function createVaultJson() {
    if (!activePackage) throw new Error('vault_active_package_required');
    if (!sourceUrl) throw new Error('vault_source_url_missing');
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: activePackage,
      name: installation?.label || activePackage.presentation?.label || activePackage.id,
      url: sourceUrl,
    });
    return serializeVaultExport(exportEncryptedPackageVault({
      packageJson: activePackage,
      installDescriptor: descriptor,
      passphrase: exportPassphrase,
      workspaceId: installation?.workspaceId,
    }));
  }

  async function generateVault() {
    setBusy(true);
    resetMessages();
    try {
      const serialized = createVaultJson();
      setExportedText(serialized);
      setNotice('Vault ready.');
    } catch (vaultError) {
      setError(errorMessage(vaultError));
    } finally {
      setBusy(false);
    }
  }

  async function downloadVault() {
    setBusy(true);
    resetMessages();
    try {
      const serialized = exportedText || createVaultJson();
      setExportedText(serialized);
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${exportFileName}.`);
    } catch (vaultError) {
      setError(errorMessage(vaultError));
    } finally {
      setBusy(false);
    }
  }

  async function copyVault() {
    resetMessages();
    try {
      const serialized = exportedText || createVaultJson();
      setExportedText(serialized);
      await navigator.clipboard.writeText(serialized);
      setNotice('Vault copied.');
    } catch (vaultError) {
      setError(errorMessage(vaultError));
    }
  }

  async function pickVaultFile() {
    resetMessages();
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        setImportText(await file.text());
        setNotice(`Loaded ${file.name}.`);
      };
      input.click();
    } catch (pickError) {
      setError(errorMessage(pickError));
    }
  }

  function previewRestore() {
    resetMessages();
    try {
      const vault = parseVaultExport(importText);
      const preview = previewEncryptedPackageVault({
        vault,
        passphrase: importPassphrase,
      });
      setPreviewState({
        serialized: importText.trim(),
        preview,
      });
      setNotice('Restore preview ready.');
    } catch (previewError) {
      setPreviewState(null);
      setError(errorMessage(previewError));
    }
  }

  async function approveRestore() {
    if (!previewState) return;
    setBusy(true);
    resetMessages();
    try {
      await activateAppPackage(previewState.preview.packageJson);
      await refreshRuntime();
      setPreviewState(null);
      setImportText(previewState.serialized);
      setNotice('Package restored.');
    } catch (restoreError) {
      setError(errorMessage(restoreError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Utopia vault</Text>
        <Text style={styles.title}>Offline backup restore</Text>
        <Text style={styles.muted}>Encrypted package vault for the active install.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Export</Text>
        <Text style={styles.meta}>{activePackage?.id ?? 'No active package'}{activePackage ? `@${activePackage.version}` : ''}</Text>
        <TextInput
          value={exportPassphrase}
          onChangeText={setExportPassphrase}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Passphrase (12+ chars)"
          style={styles.input}
        />
        <View style={styles.row}>
          <Pressable style={[styles.primaryButton, !canExport ? styles.disabled : null]} disabled={!canExport || busy} onPress={() => void generateVault()}>
            <Text style={styles.primaryText}>Build vault</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, !canExport ? styles.disabled : null]} disabled={!canExport || busy} onPress={() => void downloadVault()}>
            <Text style={styles.secondaryText}>Download</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, !canExport ? styles.disabled : null]} disabled={!canExport || busy} onPress={() => void copyVault()}>
            <Text style={styles.secondaryText}>Copy</Text>
          </Pressable>
        </View>
        <TextInput
          value={exportedText}
          onChangeText={setExportedText}
          multiline
          textAlignVertical="top"
          placeholder="Encrypted vault JSON"
          style={styles.textarea}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Restore</Text>
        <TextInput
          value={importPassphrase}
          onChangeText={setImportPassphrase}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Passphrase"
          style={styles.input}
        />
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void pickVaultFile()}>
            <Text style={styles.secondaryText}>Pick file</Text>
          </Pressable>
          <Pressable style={[styles.primaryButton, !importText.trim() || !importPassphrase.trim() ? styles.disabled : null]} disabled={busy || !importText.trim() || !importPassphrase.trim()} onPress={previewRestore}>
            <Text style={styles.primaryText}>Preview restore</Text>
          </Pressable>
        </View>
        <TextInput
          value={importText}
          onChangeText={setImportText}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste encrypted vault JSON"
          style={styles.textarea}
        />
        {previewState ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>{previewState.preview.installDescriptor.name}</Text>
            <Text style={styles.meta}>{previewState.preview.installDescriptor.id}@{previewState.preview.installDescriptor.version}</Text>
            <Text style={styles.meta}>{previewState.preview.installDescriptor.url}</Text>
            <View style={styles.row}>
              <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void approveRestore()}>
                <Text style={styles.primaryText}>Approve restore</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setPreviewState(null)}>
                <Text style={styles.secondaryText}>Clear</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.muted}>Working</Text>
        </View>
      ) : null}
      {notice ? <Text style={styles.ready}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'vault_action_failed';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: 16, padding: 18, paddingTop: 48 },
  header: { gap: 4 },
  eyebrow: { color: colors.plum, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  section: { gap: 10, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  input: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, minHeight: 44, paddingHorizontal: 10 },
  textarea: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, minHeight: 180, padding: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { borderRadius: 8, backgroundColor: colors.plum, paddingHorizontal: 14, paddingVertical: 11 },
  secondaryButton: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  secondaryText: { color: colors.ink, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  preview: { gap: 8, borderColor: colors.plum, borderRadius: 8, borderWidth: 1, backgroundColor: colors.plumSoft, padding: 12 },
  previewTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 12 },
  muted: { color: colors.muted },
  ready: { color: colors.moss, fontWeight: '900' },
  error: { color: colors.red, fontWeight: '700' },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
