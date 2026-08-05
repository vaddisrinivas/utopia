import type { AppComponent } from './schema';
import { CanvasSceneSchema, CanvasWidget } from './canvas-widget';
import type { Store } from './store';

export function CanvasRecordWidget({ component, runtime }: { component: AppComponent; runtime: Pick<Store, 'state' | 'dispatch'> }) {
  const { state, dispatch } = runtime;
  const props = component.props ?? {};
  const collection = typeof props.collection === 'string' ? props.collection : 'canvasDocuments';
  const recordId = typeof props.recordId === 'string' ? props.recordId : `${component.id ?? 'canvas'}-document`;
  const field = typeof props.sceneField === 'string' ? props.sceneField : 'scene';
  const stored = state.records.find((record) => record.id === recordId && record.collection === collection)?.values[field];
  const scene = CanvasSceneSchema.safeParse(stored).success ? stored : props.scene;
  return <CanvasWidget
    scene={scene}
    height={typeof props.height === 'number' || typeof props.height === 'string' ? props.height : undefined}
    snap={Number.isFinite(Number(props.snap)) ? Number(props.snap) : 0}
    onCommit={(next) => void dispatch({ kind: 'create', collection, recordId, values: { [field]: next } })}
  />;
}
