import type { ComponentRenderProps } from '@json-render/react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getRecordForInstallation, upsertRecord } from '@/src/db/records';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import { undoOperation } from '@/src/ops/undo';
import {
  formatValueControlValue,
  nextValueControlValue,
  normalizeValueControlConfig,
} from '@/src/presentation/widgets/value-control-engine';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

export function ValueControlWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const records = Array.isArray(props.records) ? props.records : [];
  const record = (records[0] ?? null) as DomainRecordViewModel | null;
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const valueField = text(props.valueField, 'value');
  const collection = text(props.collection);
  const configuredRecordId = text(props.recordId, collection ? `${collection}-primary` : '');
  const configuredRecordTitle = text(props.recordTitle, text(props.title, 'Value'));
  const defaultProperties = useMemo(
    () => propertyValues(props.defaultProperties),
    [props.defaultProperties],
  );
  const config = useMemo(() => normalizeValueControlConfig(props), [
    props.max,
    props.min,
    props.precision,
    props.resetValue,
    props.step,
  ]);
  const recordValue = record?.properties[valueField] ?? props.initialValue ?? 0;
  const [value, setValue] = useState(() => nextValueControlValue(recordValue, 'set', config, recordValue));
  const [input, setInput] = useState(() => formatValueControlValue(value, config.precision));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastOperationId, setLastOperationId] = useState<string | null>(null);

  useEffect(() => {
    const next = nextValueControlValue(recordValue, 'set', config, recordValue);
    setValue(next);
    setInput(formatValueControlValue(next, config.precision));
  }, [config, record?.id, recordValue]);

  const apply = useCallback(async (
    action: 'increment' | 'decrement' | 'reset' | 'set',
    explicitValue?: unknown,
  ) => {
    if (!db || !runtime.activeManifest || !runtime.installationId || (!record && (!collection || !configuredRecordId))) {
      setMessage('Value storage is not ready.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const canonical = record
        ? await getRecordForInstallation(db, runtime.installationId, record.id)
        : null;
      if (record && !canonical) throw new Error('This item no longer exists.');
      const currentValue = canonical?.properties[valueField] ?? props.initialValue ?? config.resetValue;
      const next = nextValueControlValue(currentValue, action, config, explicitValue);
      const now = new Date().toISOString();
      const targetId = canonical?.id ?? configuredRecordId;
      const operationId = `op-value-${targetId.replace(/[^A-Za-z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
      await upsertRecord(db, runtime.activeManifest, {
        id: targetId,
        collection: canonical?.collection ?? collection,
        title: canonical?.title ?? configuredRecordTitle,
        properties: {
          ...resolveDynamicProperties(defaultProperties, now),
          ...(canonical?.properties ?? {}),
          [valueField]: next,
        },
        relations: canonical?.relations.map(({ name, target_id }) => ({ name, target_id })) ?? [],
        source: canonical?.source ?? {
          provider: 'user',
          external_id: targetId,
          url: null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: canonical?.archived_at ?? null,
        created_at: canonical?.created_at ?? now,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'manual',
        operation_id: operationId,
        idempotency_key: `value-control:${targetId}:${valueField}:${now}`,
        app_installation_id: runtime.installationId,
      });
      setValue(next);
      setInput(formatValueControlValue(next, config.precision));
      setLastOperationId(operationId);
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this value.');
    } finally {
      setBusy(false);
    }
  }, [collection, config, configuredRecordId, configuredRecordTitle, db, defaultProperties, props.initialValue, record, runtime.activeManifest, runtime.installationId, valueField]);

  const undo = useCallback(async () => {
    if (!db || !runtime.activeManifest || !runtime.installationId || !record || !lastOperationId) return;
    setBusy(true);
    try {
      const result = await undoOperation(db, runtime.activeManifest, lastOperationId, {
        appInstallationId: runtime.installationId,
      });
      if (result.status !== 'applied' && result.status !== 'duplicate') {
        throw new Error(result.reject_reason ?? 'Undo failed.');
      }
      const restored = await getRecordForInstallation(db, runtime.installationId, record.id);
      const next = nextValueControlValue(restored?.properties[valueField], 'set', config, restored?.properties[valueField]);
      setValue(next);
      setInput(formatValueControlValue(next, config.precision));
      setLastOperationId(null);
      setMessage('Undone.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not undo.');
    } finally {
      setBusy(false);
    }
  }, [config, db, lastOperationId, record, runtime.activeManifest, runtime.installationId, valueField]);

  const title = text(props.title, record?.title ?? 'Value');
  const unit = text(props.unit);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      <Text accessibilityLiveRegion="polite" style={styles.value}>
        {formatValueControlValue(value, config.precision)}{unit ? ` ${unit}` : ''}
      </Text>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${title}`} disabled={busy || (!record && !collection)} style={styles.control} onPress={() => void apply('decrement')}>
          <Text style={styles.controlText}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={`${title} value`}
          keyboardType="decimal-pad"
          value={input}
          editable={!busy && Boolean(record || collection)}
          onChangeText={setInput}
          onSubmitEditing={() => void apply('set', input)}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${title}`} disabled={busy || (!record && !collection)} style={styles.control} onPress={() => void apply('increment')}>
          <Text style={styles.controlText}>+</Text>
        </Pressable>
      </View>
      <View style={styles.secondaryRow}>
        <Pressable accessibilityRole="button" disabled={busy || (!record && !collection)} style={styles.secondary} onPress={() => void apply('reset')}>
          <Text style={styles.secondaryText}>Reset</Text>
        </Pressable>
        {lastOperationId ? (
          <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void undo()}>
            <Text style={styles.secondaryText}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

function propertyValues(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveDynamicProperties(
  properties: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value === '$now' ? now : value === '$today' ? now.slice(0, 10) : value,
    ]),
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFCF5', borderRadius: 8, gap: 12, padding: 16 },
  title: { color: '#241C16', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  value: { color: '#182019', fontSize: 36, fontWeight: '900', textAlign: 'center' },
  controls: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center' },
  control: { alignItems: 'center', backgroundColor: '#2F7448', borderRadius: 8, height: 48, justifyContent: 'center', width: 48 },
  controlText: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  input: { backgroundColor: '#F6F1E8', borderRadius: 8, color: '#241C16', fontSize: 20, fontWeight: '800', minHeight: 48, minWidth: 96, paddingHorizontal: 12, textAlign: 'center' },
  secondaryRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  secondary: { borderColor: '#CABFAF', borderRadius: 8, borderWidth: 1, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9 },
  secondaryText: { color: '#3D4B40', fontWeight: '700' },
  message: { color: '#2F7448', fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
