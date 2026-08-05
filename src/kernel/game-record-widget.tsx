import { GameSnapshotSchema, GameWidget } from './game-widget';
import type { AppComponent } from './schema';
import type { Store } from './store';

export function GameRecordWidget({ component, runtime }: { component: AppComponent; runtime: Pick<Store, 'state' | 'dispatch'> }) {
  const { state, dispatch } = runtime;
  const props = component.props ?? {};
  const collection = typeof props.collection === 'string' ? props.collection : 'gameSessions';
  const recordId = typeof props.recordId === 'string' ? props.recordId : `${component.id ?? 'game'}-session`;
  const field = typeof props.snapshotField === 'string' ? props.snapshotField : 'snapshot';
  const stored = state.records.find((record) => record.id === recordId && record.collection === collection)?.values[field];
  const snapshot = GameSnapshotSchema.safeParse(stored).success ? stored : undefined;
  const config = typeof props.config === 'object' && props.config ? { ...(props.config as Record<string, unknown>), snapshot } : props.config;
  return <GameWidget
    component={{ ...component, props: { ...props, config } }}
    onChange={(next) => void dispatch({ kind: 'create', collection, recordId, values: { [field]: next } })}
  />;
}
