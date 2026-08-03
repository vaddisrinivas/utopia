import type { ComponentRenderProps } from '@json-render/react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getRecordForInstallation, upsertRecord } from '@/src/db/records';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import { checklistChecked, toggleChecklistChecked } from '@/src/presentation/widgets/checklist-state';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

type StaticChecklistItem = Readonly<{
  id?: unknown;
  title?: unknown;
  label?: unknown;
  subtitle?: unknown;
  detail?: unknown;
  checked?: unknown;
}>;

export function ChecklistRecordWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const records = Array.isArray(props.records) ? props.records as DomainRecordViewModel[] : [];
  const staticItems = Array.isArray(props.items) ? props.items as StaticChecklistItem[] : [];
  const checkedField = text(props.checkedField, 'checked');
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const recordChecked = useMemo(
    () => Object.fromEntries(records.map((record) => [record.id, checklistChecked(record.properties[checkedField])])),
    [checkedField, records],
  );

  useEffect(() => {
    setLocalChecked(Object.fromEntries(staticItems.map((item, index) => [
      staticItemKey(item, index),
      checklistChecked(item.checked),
    ])));
  }, [props.items]);

  const toggleRecord = useCallback(async (record: DomainRecordViewModel) => {
    if (!db || !runtime.activeManifest || !runtime.installationId) {
      setMessage('Checklist storage is not ready.');
      return;
    }
    setBusyId(record.id);
    setMessage('');
    try {
      const canonical = await getRecordForInstallation(db, runtime.installationId, record.id);
      if (!canonical) throw new Error('This checklist item no longer exists.');
      const now = new Date().toISOString();
      await upsertRecord(db, runtime.activeManifest, {
        id: canonical.id,
        collection: canonical.collection,
        title: canonical.title,
        properties: {
          ...canonical.properties,
          [checkedField]: toggleChecklistChecked(canonical.properties[checkedField]),
        },
        relations: canonical.relations.map(({ name, target_id }) => ({ name, target_id })),
        source: canonical.source,
        archived_at: canonical.archived_at,
        created_at: canonical.created_at,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'manual',
        operation_id: `op-check-${record.id.replace(/[^A-Za-z0-9_-]/g, '-')}-${Date.now().toString(36)}`,
        idempotency_key: `checklist:${record.id}:${checkedField}:${now}`,
        app_installation_id: runtime.installationId,
      });
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update this item.');
    } finally {
      setBusyId(null);
    }
  }, [checkedField, db, runtime.activeManifest, runtime.installationId]);

  const items = records.length
    ? records.map((record) => ({
      id: record.id,
      title: record.title,
      detail: checklistRecordDetail(record, checkedField),
      checked: recordChecked[record.id],
      record,
    }))
    : (staticItems.length ? staticItems : [{ title: 'First step' }, { title: 'Second step' }, { title: 'Done' }])
      .map((item, index) => ({
        id: staticItemKey(item, index),
        title: staticItemTitle(item),
        detail: staticItemDetail(item),
        checked: localChecked[staticItemKey(item, index)] ?? checklistChecked(item.checked),
        record: null,
      }));

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{text(props.title, 'Checklist')}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      {items.slice(0, 100).map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.checked, disabled: busyId === item.id }}
          aria-checked={item.checked}
          disabled={busyId === item.id}
          style={styles.row}
          onPress={() => {
            if (item.record) void toggleRecord(item.record);
            else setLocalChecked((current) => ({ ...current, [item.id]: !item.checked }));
          }}
        >
          <Text style={[styles.box, item.checked ? styles.boxChecked : null]}>{item.checked ? '✓' : ''}</Text>
          <View style={styles.copy}>
            <Text style={[styles.title, item.checked ? styles.titleChecked : null]}>{item.title}</Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          </View>
        </Pressable>
      ))}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

function staticItemKey(item: StaticChecklistItem, index: number): string {
  return text(item.id, text(item.title, text(item.label, `item-${index}`)));
}

function staticItemTitle(item: StaticChecklistItem): string {
  return text(item.title, text(item.label, 'Checklist item'));
}

function staticItemDetail(item: StaticChecklistItem): string {
  return text(item.subtitle, text(item.detail));
}

function checklistRecordDetail(record: DomainRecordViewModel, checkedField: string): string {
  return Object.entries(record.properties)
    .filter(([key, value]) => key !== checkedField && value !== null && value !== undefined && value !== '')
    .slice(0, 2)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)
    .join(' · ');
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFCF5', borderRadius: 8, gap: 8, padding: 16 },
  heading: { color: '#241C16', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  row: { alignItems: 'center', borderBottomColor: '#E7DED1', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 52, paddingVertical: 8 },
  box: { borderColor: '#9A8C7B', borderRadius: 4, borderWidth: 2, color: '#FFFFFF', fontSize: 16, fontWeight: '900', height: 24, lineHeight: 20, textAlign: 'center', width: 24 },
  boxChecked: { backgroundColor: '#2F7448', borderColor: '#2F7448' },
  copy: { flex: 1, gap: 2 },
  title: { color: '#241C16', fontSize: 15, fontWeight: '700' },
  titleChecked: { color: '#746A5E', textDecorationLine: 'line-through' },
  detail: { color: '#746A5E', fontSize: 12 },
  message: { color: '#2F7448', fontSize: 12, fontWeight: '700' },
});
