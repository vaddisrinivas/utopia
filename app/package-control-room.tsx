import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { AppPackageChangeApprovalReceipt } from '@/src/db/app-package-registry';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  approveControlRoomPreview,
  indexPackageSourceTree,
  previewControlRoomChange,
  proposeAiScreenPatch,
  proposeCollectionFieldPatch,
  activateApprovedControlRoomChange,
  type ControlRoomPreview,
  type ControlRoomProposal,
} from '@/src/domain/package-control-room';
import { colors, radius, shadow } from '@/src/theme';

const FIELD_TYPES = ['text', 'number', 'boolean', 'timestamp', 'json'] as const;

type Mode = 'schema-form' | 'ai';

export default function PackageControlRoomScreen() {
  const db = useUtopiaDatabase();
  const { activePackage, installation, installationId, refreshRuntime, rollbackAppPackage } = useAppRuntime();
  const [mode, setMode] = useState<Mode>('schema-form');
  const [collectionId, setCollectionId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text');
  const [required, setRequired] = useState(false);
  const [indexed, setIndexed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [approvedBy, setApprovedBy] = useState('user:reviewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ControlRoomProposal | null>(null);
  const [preview, setPreview] = useState<ControlRoomPreview | null>(null);
  const [approval, setApproval] = useState<AppPackageChangeApprovalReceipt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const collectionIds = useMemo(
    () => activePackage ? Object.keys(activePackage.collections).sort() : [],
    [activePackage],
  );
  const activeTree = useMemo(
    () => activePackage ? indexPackageSourceTree(activePackage) : null,
    [activePackage],
  );

  async function runPreview(nextMode: Mode) {
    if (!db || !activePackage || !installationId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setApproval(null);
    try {
      const nextProposal = nextMode === 'schema-form'
        ? proposeCollectionFieldPatch(activePackage, {
          collectionId,
          fieldId,
          type: fieldType,
          required,
          indexed,
        })
        : proposeAiScreenPatch(activePackage, prompt);
      const nextPreview = await previewControlRoomChange(db, {
        installationId,
        request: nextProposal.request,
      });
      setMode(nextMode);
      setProposal(nextProposal);
      setPreview(nextPreview);
    } catch (nextError) {
      setProposal(null);
      setPreview(null);
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  function approvePreviewDraft() {
    if (!preview) return;
    setError(null);
    setNotice(null);
    try {
      const nextApproval = approveControlRoomPreview(preview, { approvedBy });
      setApproval(nextApproval);
      setNotice(`Approved ${nextApproval.packageHash.slice(0, 20)}...`);
    } catch (nextError) {
      setApproval(null);
      setError(errorMessage(nextError));
    }
  }

  async function activateApproved() {
    if (!db || !proposal || !approval || !installationId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const activated = await activateApprovedControlRoomChange(db, {
        installationId,
        request: proposal.request,
        approval,
      });
      await refreshRuntime();
      setPreview(null);
      setProposal(null);
      setApproval(null);
      setNotice(`Activated ${activated.package.version}`);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function rollbackActive() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const rolledBack = await rollbackAppPackage();
      await refreshRuntime();
      setPreview(null);
      setProposal(null);
      setApproval(null);
      setNotice(rolledBack ? `Rolled back to ${rolledBack.version}` : 'No previous package to roll back.');
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (!activePackage) {
    return (
      <View style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>No active package</Text>
      </View>
    );
  }

  const previewTree = preview?.status === 'valid' ? preview.sourceTree : null;
  const rollbackReady = Boolean(installation?.activation?.previousPackageKey);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>AI control room</Text>
          <Text style={styles.title}>Package control room</Text>
          <Text style={styles.subtitle}>{activePackage.id}@{activePackage.version}</Text>
        </View>
        <View style={styles.headerMeta}>
          <Meta label="Install" value={installationId ?? 'unscoped'} />
          <Meta label="Prev" value={installation?.activation?.previousPackageKey ?? 'none'} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Proposal mode</Text>
        <View style={styles.segmentRow}>
          <Segment active={mode === 'schema-form'} label="Schema form" onPress={() => setMode('schema-form')} />
          <Segment active={mode === 'ai'} label="AI prompt" onPress={() => setMode('ai')} />
        </View>
      </View>

      {mode === 'schema-form' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Add collection field</Text>
          <View style={styles.selectRow}>
            {collectionIds.map((item) => (
              <Chip key={item} active={collectionId === item} label={item} onPress={() => setCollectionId(item)} />
            ))}
          </View>
          <View style={styles.inputGrid}>
            <LabeledField label="Field id">
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setFieldId}
                placeholder="operator_note"
                style={styles.input}
                value={fieldId}
              />
            </LabeledField>
          </View>
          <View style={styles.selectRow}>
            {FIELD_TYPES.map((item) => (
              <Chip key={item} active={fieldType === item} label={item} onPress={() => setFieldType(item)} />
            ))}
          </View>
          <View style={styles.toggleRow}>
            <Toggle label="Required" value={required} onValueChange={setRequired} />
            <Toggle label="Indexed" value={indexed} onValueChange={setIndexed} />
          </View>
          <View style={styles.buttonRow}>
            <ActionButton label="Preview form patch" onPress={() => void runPreview('schema-form')} primary disabled={busy} />
          </View>
        </View>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>AI package prompt</Text>
          <TextInput
            multiline
            onChangeText={setPrompt}
            placeholder="Add a quiet review screen for package approvals and rollback status."
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
            value={prompt}
          />
          <View style={styles.buttonRow}>
            <ActionButton label="Preview AI patch" onPress={() => void runPreview('ai')} primary disabled={busy} />
          </View>
        </View>
      )}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Approval and activation</Text>
        <LabeledField label="Approved by">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApprovedBy}
            placeholder="user:reviewer"
            style={styles.input}
            value={approvedBy}
          />
        </LabeledField>
        <View style={styles.buttonRow}>
          <ActionButton
            label="Approve preview"
            onPress={approvePreviewDraft}
            disabled={busy || preview?.status !== 'valid'}
          />
          <ActionButton
            label="Activate approved"
            onPress={() => void activateApproved()}
            primary
            disabled={busy || !approval || !proposal}
          />
          <ActionButton
            label="Rollback"
            onPress={() => void rollbackActive()}
            disabled={busy || !rollbackReady}
          />
        </View>
      </View>

      {busy ? (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <Text style={styles.muted}>Working</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Proposal patch</Text>
        <Text style={styles.code}>{proposal ? JSON.stringify(proposal.request.patch, null, 2) : 'No draft yet.'}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Preview</Text>
        {preview ? (
          <>
            <Text style={preview.status === 'valid' ? styles.good : styles.errorText}>{preview.status}</Text>
            <Text style={styles.muted}>Request {preview.requestHash}</Text>
            {preview.packageHash ? <Text style={styles.muted}>Package {preview.packageHash}</Text> : null}
            {preview.errors.map((item) => (
              <Text key={item} style={styles.error}>- {item}</Text>
            ))}
            {preview.diff.length ? preview.diff.map((item) => (
              <View key={`${item.kind}:${item.path}`} style={styles.diffRow}>
                <Text style={styles.diffBadge}>{item.kind}</Text>
                <View style={styles.diffCopy}>
                  <Text style={styles.diffTitle}>{item.id}</Text>
                  <Text style={styles.muted}>{item.section} · {item.path}</Text>
                </View>
              </View>
            )) : <Text style={styles.muted}>No diff entries.</Text>}
          </>
        ) : (
          <Text style={styles.muted}>No preview yet.</Text>
        )}
      </View>

      <View style={styles.dualColumn}>
        <TreePanel title="Active tree" tree={activeTree} />
        <TreePanel title="Preview tree" tree={previewTree} />
      </View>
    </ScrollView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaBox}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Segment({ active, label, onPress }: { active: boolean; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active ? styles.chipActive : null]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function Toggle(
  { label, value, onValueChange }: { label: string; value: boolean; onValueChange(value: boolean): void },
) {
  return (
    <View style={styles.toggleItem}>
      <Text style={styles.label}>{label}</Text>
      <Switch onValueChange={onValueChange} value={value} />
    </View>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ActionButton(
  { label, onPress, primary, disabled }: { label: string; onPress(): void; primary?: boolean; disabled?: boolean },
) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={[styles.buttonText, primary ? styles.buttonPrimaryText : styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

function TreePanel(
  { title, tree }: { title: string; tree: ReturnType<typeof indexPackageSourceTree> | null },
) {
  return (
    <View style={[styles.panel, styles.treePanel]}>
      <Text style={styles.panelTitle}>{title}</Text>
      {tree ? tree.sections.map((section) => (
        <View key={section.id} style={styles.treeSection}>
          <Text style={styles.treeTitle}>{section.label}</Text>
          <Text style={styles.muted}>{section.children.length} items</Text>
          {section.children.slice(0, 6).map((child) => (
            <Text key={child.path || child.id} style={styles.treeItem}>{child.label}</Text>
          ))}
        </View>
      )) : <Text style={styles.muted}>No tree.</Text>}
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'control_room_failed';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: 12, padding: 16, paddingTop: 36, paddingBottom: 28 },
  emptyScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  header: { gap: 10, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.paper, padding: 14, ...shadow },
  headerCopy: { gap: 3 },
  eyebrow: { color: colors.moss, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 13 },
  headerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaBox: { minWidth: 132, gap: 2, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.canvas, padding: 10 },
  metaLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  metaValue: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  panel: { gap: 10, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.paper, padding: 12 },
  panelTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { borderColor: colors.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.canvas },
  segmentActive: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  segmentText: { color: colors.ink, fontWeight: '700' },
  segmentTextActive: { color: colors.moss },
  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderColor: colors.line, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.canvas },
  chipActive: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.blue },
  inputGrid: { gap: 10 },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  input: { minHeight: 42, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.canvas, color: colors.ink, paddingHorizontal: 10, paddingVertical: 10 },
  textarea: { minHeight: 110 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  toggleItem: { minWidth: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.canvas, paddingHorizontal: 10, paddingVertical: 8 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  buttonPrimary: { backgroundColor: colors.moss },
  buttonSecondary: { borderColor: colors.line, borderWidth: 1, backgroundColor: colors.canvas },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontWeight: '800' },
  buttonPrimaryText: { color: '#FFFFFF' },
  buttonSecondaryText: { color: colors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { color: colors.muted, fontSize: 12 },
  notice: { color: colors.moss, fontWeight: '800' },
  error: { color: colors.red, fontWeight: '700' },
  errorText: { color: colors.red, fontWeight: '800', textTransform: 'uppercase' },
  good: { color: colors.moss, fontWeight: '800', textTransform: 'uppercase' },
  code: { borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.canvas, color: colors.ink, padding: 10, fontFamily: 'monospace', fontSize: 12 },
  diffRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderColor: colors.line, borderWidth: 1, borderRadius: 8, backgroundColor: colors.canvas, padding: 10 },
  diffBadge: { minWidth: 62, color: colors.blue, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  diffCopy: { flex: 1, gap: 2 },
  diffTitle: { color: colors.ink, fontWeight: '800' },
  dualColumn: { gap: 12 },
  treePanel: { flex: 1 },
  treeSection: { gap: 3, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 8 },
  treeTitle: { color: colors.ink, fontWeight: '800' },
  treeItem: { color: colors.muted, fontSize: 12 },
});
