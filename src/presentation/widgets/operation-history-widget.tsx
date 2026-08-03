import type { ComponentRenderProps } from '@json-render/react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useUtopiaDatabase } from '@/src/db/provider';
import { subscribeToRecordChanges } from '@/src/db/record-change-events';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

export type OperationHistoryRow = Readonly<{
  op_id: string;
  kind: string;
  collection: string;
  record_id: string;
  actor: string;
  origin: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
}>;

export function normalizeOperationHistoryLimit(value: unknown, fallback = 20): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

export function buildOperationHistoryQuery(
  installationId: string,
  domain: string,
  props: Pick<WidgetProps, 'collection' | 'recordId' | 'limit'>,
) {
  const conditions = ['app_installation_id = ?', 'domain = ?'];
  const params: Array<string | number> = [installationId, domain];
  const collection = text(props.collection);
  const recordId = text(props.recordId);
  if (collection) {
    conditions.push('collection = ?');
    params.push(collection);
  }
  if (recordId) {
    conditions.push('record_id = ?');
    params.push(recordId);
  }
  params.push(normalizeOperationHistoryLimit(props.limit));
  return {
    sql: `SELECT op_id, kind, collection, record_id, actor, origin, status, reject_reason, created_at FROM operations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    params,
  } as const;
}

export function operationHistoryKindLabel(kind: string, labels?: unknown): string {
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    const entries = labels as Record<string, unknown>;
    const configured = entries[kind] ?? entries[`${kind}_record`];
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
  }
  return kind.trim().replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) || 'Operation';
}

export function operationHistoryStatusLabel(status: string): string {
  return status.trim().replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) || 'Unknown';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function OperationHistoryWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const [rows, setRows] = useState<OperationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const query = useMemo(
    () => (runtime.installationId && runtime.activeManifest?.id
      ? buildOperationHistoryQuery(runtime.installationId, runtime.activeManifest.id, props)
      : null),
    [props.collection, props.limit, props.recordId, runtime.activeManifest?.id, runtime.installationId],
  );

  const reload = useCallback(async () => {
    if (!db || !query) {
      setRows([]);
      setUnavailable(!db);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await db.getAllAsync<OperationHistoryRow>(query.sql, query.params));
      setUnavailable(false);
    } catch {
      setRows([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [db, query]);

  useEffect(() => {
    void reload();
    const unsubscribe = subscribeToRecordChanges((event) => {
      if (event.installationId !== runtime.installationId || event.domain !== runtime.activeManifest?.id) return;
      const collection = text(props.collection);
      const recordId = text(props.recordId);
      if ((collection && event.collection !== collection) || (recordId && event.recordId !== recordId)) return;
      void reload();
    });
    return unsubscribe;
  }, [props.collection, props.recordId, reload, runtime.activeManifest?.id, runtime.installationId]);

  const title = text(props.title, 'Operation history');
  const emptyText = text(props.emptyText, 'No changes yet.');
  return (
    <View accessibilityLabel={title} style={styles.surface}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Loading operation history" color="#2F7448" /> : null}
      {!loading && unavailable ? <Text accessibilityRole="alert" style={styles.empty}>Operation history is unavailable.</Text> : null}
      {!loading && !unavailable && rows.length === 0 ? <Text accessibilityLabel={emptyText} style={styles.empty}>{emptyText}</Text> : null}
      {!loading && !unavailable ? rows.map((row) => {
        const subject = row.record_id || row.collection;
        const status = operationHistoryStatusLabel(row.status);
        const kind = operationHistoryKindLabel(row.kind, props.eventLabels);
        return (
          <View key={row.op_id} accessible accessibilityLabel={`${kind} ${subject}, ${status}, ${formatTimestamp(row.created_at)}`} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{kind} · {subject}</Text>
              <Text style={styles.rowMeta}>{formatTimestamp(row.created_at)} · {row.actor} · {row.origin}</Text>
            </View>
            <Text style={[styles.status, row.status !== 'applied' && styles.statusMuted]}>{status}</Text>
          </View>
        );
      }) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: '#FFFCF5', borderRadius: 8, gap: 10, padding: 14 },
  title: { color: '#241C16', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  empty: { color: '#6D6257', fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  row: { alignItems: 'center', borderTopColor: '#E8DFD1', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 56, paddingVertical: 10 },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { color: '#241C16', fontSize: 14, fontWeight: '700' },
  rowMeta: { color: '#6D6257', fontSize: 12 },
  status: { color: '#2F7448', fontSize: 12, fontWeight: '800' },
  statusMuted: { color: '#9A4B2E' },
});
