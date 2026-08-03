import { useEffect, useState } from 'react';

import { useUtopiaDatabase } from '@/src/db/provider';
import { getProviderSyncSummary, type ProviderSyncSummary } from '@/src/db/provider-status';
import { listRecordsForDomainAndInstallation } from '@/src/db/records';
import { subscribeToRecordChanges } from '@/src/db/record-change-events';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import type { PresentationDataState } from '@/packages/shared/contracts/package';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { recordsToComputedViews } from '@/src/presentation/computed-records';
import { JsonRenderSurface } from '@/src/presentation/json-render-surface';

type JsonRenderRouteProps = {
  screen: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  emptyTitle?: string;
  recordId?: string;
  collectionIds?: string[];
  recordMatch?: string;
  screenTitle?: string;
  screenSubtitle?: string;
  initialPrompt?: string;
  autoSubmitPrompt?: boolean;
  showBack?: boolean;
  localeOverride?: string;
  screenRouteBase?: string;
};

function matchesRouteRecord(record: DomainRecordViewModel, match?: string) {
  const needle = match?.trim().toLowerCase();
  if (!needle) return true;
  return [
    record.title,
    record.body,
    record.meta,
    record.status,
    record.collection,
    record.source,
    ...Object.values(record.properties).map((value) => String(value ?? '')),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function JsonRenderRoute({
  screen,
  eyebrow,
  title,
  subtitle,
  emptyTitle,
  recordId,
  collectionIds,
  recordMatch,
  screenTitle,
  screenSubtitle,
  initialPrompt,
  autoSubmitPrompt,
  showBack,
  localeOverride,
  screenRouteBase,
}: JsonRenderRouteProps) {
  const db = useUtopiaDatabase();
  const { activeManifest, activePackage, catalog, installationId } = useAppRuntime();
  const [records, setRecords] = useState<DomainRecordViewModel[]>([]);
  const [recordsState, setRecordsState] = useState<PresentationDataState>('loading');
  const [recordsError, setRecordsError] = useState<string | undefined>();
  const [providerSync, setProviderSync] = useState<ProviderSyncSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const domainId = catalog?.activeDomainId ?? activeManifest?.id ?? null;
    if (!db || !domainId || !installationId) {
      setRecords([]);
      setRecordsState('error');
      setRecordsError('App data is unavailable.');
      return () => {
        cancelled = true;
      };
    }
    setRecordsState('loading');
    setRecordsError(undefined);
    const reload = () => listRecordsForDomainAndInstallation(db, installationId, domainId).then((items) => {
      if (!cancelled) {
        const next = recordsToComputedViews(items, activePackage);
        setRecords(next.filter((item) => {
          if (recordId && item.id !== recordId) return false;
          if (collectionIds?.length && !collectionIds.includes(item.collection)) return false;
          return matchesRouteRecord(item, recordMatch);
        }));
        setRecordsState('ready');
      }
    }).catch(() => {
      if (!cancelled) {
        setRecords([]);
        setRecordsState('error');
        setRecordsError('Unable to load app data.');
      }
    });
    void reload();
    const unsubscribe = subscribeToRecordChanges((event) => {
      if (event.installationId === installationId && event.domain === domainId) void reload();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeManifest?.id, activePackage, catalog?.activeDomainId, collectionIds?.join(','), db, installationId, recordId, recordMatch]);

  useEffect(() => {
    let cancelled = false;
    void getProviderSyncSummary(db).then((summary) => {
      if (!cancelled) setProviderSync(summary);
    }).catch(() => {
      if (!cancelled) setProviderSync(null);
    });
    return () => {
      cancelled = true;
    };
  }, [db, screen]);
  return (
    <JsonRenderSurface
      eyebrow={eyebrow}
      title={title ?? activeManifest?.label ?? 'App'}
      subtitle={subtitle}
      ui={activeManifest?.ui}
      screen={screen}
      records={records}
      nativePermissions={activePackage?.schemaVersion === 'wonder.app-package.v3'
        ? activePackage.nativeCapabilities.permissions
        : activeManifest?.native_capabilities?.permissions}
      providerSync={providerSync}
      emptyTitle={emptyTitle}
      screenTitle={screenTitle}
      screenSubtitle={screenSubtitle}
      initialPrompt={initialPrompt}
      autoSubmitPrompt={autoSubmitPrompt}
      showBack={showBack}
      localeOverride={localeOverride}
      recordsState={recordsState}
      recordsError={recordsError}
      screenRouteBase={screenRouteBase}
    />
  );
}
