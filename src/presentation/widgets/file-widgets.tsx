import type { ComponentRenderProps } from '@json-render/react-native';
import * as React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  DocumentPicker,
  FileSystem,
  Sharing,
  loadExpoFileSystem,
} from '@/src/presentation/widget-native-bridges';
import {
  requestWidgetCapability,
  type WidgetCapabilityRequest,
  type WidgetCapabilityRuntime,
} from '@/src/presentation/widgets/package-capability-broker';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

type PickedFileInfo = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

function requireFileCapability(
  runtime: WidgetCapabilityRuntime,
  request: WidgetCapabilityRequest,
  onDenied: (message: string) => void,
): boolean {
  const result = requestWidgetCapability(
    runtime,
    request,
  );
  if (!result.ok) {
    onDenied(result.error.message);
    return false;
  }
  return true;
}

export function FilePickerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [files, setFiles] = React.useState<PickedFileInfo[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const mimeTypes = stringList(props.mimeTypes, ['*/*']);
  const multiple = props.multiple === true;
  const copyToCacheDirectory = props.copyToCacheDirectory !== false && Platform.OS !== 'web';

  const chooseFile = React.useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      if (!requireFileCapability(
        runtime,
        {
          kind: 'file-picker',
          action: 'choose',
          mimeTypes,
          multiple,
          copyToCacheDirectory,
          declaredPurpose: 'choose local files for this package feature',
        },
        setError,
      )) return;
      const result = await DocumentPicker.getDocumentAsync({
        type: mimeTypes.length === 1 ? mimeTypes[0] : mimeTypes,
        multiple,
        copyToCacheDirectory,
        base64: false,
      });
      if (result.canceled) return;
      const nextFiles: PickedFileInfo[] = [];
      for (const asset of result.assets ?? []) {
        const info = await safeFileInfo(asset.uri);
        nextFiles.push({
          uri: asset.uri,
          name: String(asset.name ?? asset.uri.split('/').pop() ?? 'Picked file'),
          mimeType: String(asset.mimeType ?? 'unknown'),
          size: typeof asset.size === 'number' ? asset.size : info.size,
        });
      }
      setFiles(nextFiles);
    } catch {
      setError('File picker failed.');
    } finally {
      setBusy(false);
    }
  }, [copyToCacheDirectory, mimeTypes, multiple, runtime]);

  return (
    <WidgetShell title={text(props.title, 'File picker')} subtitle={text(props.subtitle, 'Pick local files without uploading them.')}>
      <View style={styles.previewBox}>
        <Text style={styles.previewTitle}>{files.length ? `${files.length} selected` : text(props.emptyTitle, 'No file selected')}</Text>
        <Text style={styles.previewText}>{mimeTypes.join(', ')}</Text>
        <View style={styles.providerActions}>
          <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={chooseFile} disabled={busy}>
            <Text style={styles.primaryButtonText}>{busy ? 'Opening…' : files.length ? 'Change' : 'Choose file'}</Text>
          </Pressable>
          {files.length ? <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setFiles([])}><Text style={styles.secondaryButtonText}>Clear</Text></Pressable> : null}
        </View>
        {error ? <Text style={styles.warning}>{error}</Text> : null}
      </View>
      {files.map((file) => (
        <View key={file.uri} style={styles.fileRow}>
          <View style={styles.fileIcon}><Text style={styles.fileIconText}>F</Text></View>
          <View style={styles.fileCopy}>
            <Text numberOfLines={1} style={styles.fileName}>{file.name}</Text>
            <Text style={styles.formHint}>{file.mimeType} · {formatFileSize(file.size)} · local only</Text>
            <Text numberOfLines={1} style={styles.previewText}>{file.uri}</Text>
          </View>
        </View>
      ))}
    </WidgetShell>
  );
}

export function FileExportWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');
  const fileName = sanitizeFileName(text(props.fileName, 'utopia-export.txt'));
  const mimeType = text(props.mimeType, 'text/plain');
  const content = exportContent(props.content, text(props.body, 'Created by Utopia.'));

  const exportFile = React.useCallback(async () => {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      if (!requireFileCapability(runtime, {
        kind: 'file-export',
        action: 'export',
        fileName,
        mimeType,
        declaredPurpose: 'export a local file from this package feature',
      }, setError)) return;
      if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof URL !== 'undefined') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        setStatus('Download started.');
        return;
      }
      const fileSystem = await loadExpoFileSystem();
      const base = fileSystem.cacheDirectory ?? fileSystem.documentDirectory;
      if (!base) throw new Error('missing_file_directory');
      const uri = `${base}${fileName}`;
      await fileSystem.writeAsStringAsync(uri, content, { encoding: fileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType, dialogTitle: text(props.shareTitle, 'Share file') });
        setStatus('Share sheet opened.');
      } else setStatus(`Saved locally: ${uri}`);
    } catch {
      setError('File export failed.');
    } finally {
      setBusy(false);
    }
  }, [content, fileName, mimeType, props.shareTitle, runtime]);

  return (
    <WidgetShell title={text(props.title, 'File export')} subtitle={text(props.subtitle, 'Create a local file and share or download it.')}>
      <View style={styles.previewBox}>
        <Text style={styles.previewTitle}>{fileName}</Text>
        <Text style={styles.previewText}>{mimeType} · {formatFileSize(content.length)}</Text>
        <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={exportFile} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Preparing…' : text(props.cta, 'Export')}</Text>
        </Pressable>
        {status ? <Text style={styles.success}>{status}</Text> : null}
        {error ? <Text style={styles.warning}>{error}</Text> : null}
      </View>
    </WidgetShell>
  );
}

function WidgetShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <View style={styles.card}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}{children}</View>;
}

async function safeFileInfo(uri: string): Promise<{ size?: number }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? { size: info.size } : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length ? items : fallback;
  }
  return typeof value === 'string' && value.trim() ? [value] : fallback;
}

function formatFileSize(size: number | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return 'size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 1024 * 10 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 1024 * 1024 * 10 ? 1 : 0)} MB`;
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
  return normalized || 'utopia-export.txt';
}

function exportContent(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value !== undefined) return JSON.stringify(value, null, 2);
  return fallback;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFCF5', borderRadius: 20, padding: 14, gap: 12 },
  title: { color: '#241C16', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  previewBox: { borderRadius: 18, backgroundColor: '#F6F1E8', padding: 14, gap: 6 },
  previewTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  previewText: { color: '#6D6257', fontSize: 12, fontWeight: '700' },
  providerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { backgroundColor: '#2F7448', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryButton: { backgroundColor: '#F6F1E8', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryButtonText: { color: '#241C16', fontWeight: '800' },
  disabled: { opacity: 0.5 },
  warning: { color: '#9A4B2E', fontSize: 12 },
  success: { color: '#2F7448', fontSize: 12, fontWeight: '800' },
  formHint: { color: '#6D6257', fontSize: 12 },
  fileRow: { alignItems: 'center', backgroundColor: '#F6F1E8', borderRadius: 16, flexDirection: 'row', gap: 10, padding: 12 },
  fileIcon: { alignItems: 'center', backgroundColor: '#E4F1E8', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  fileIconText: { color: '#2F7448', fontSize: 18, fontWeight: '900' },
  fileCopy: { flex: 1, gap: 3 },
  fileName: { color: '#241C16', fontSize: 15, fontWeight: '900' },
});
