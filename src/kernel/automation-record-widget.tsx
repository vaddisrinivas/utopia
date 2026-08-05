import { AutomationConfigSchema, AutomationWidget } from './automation-widget';
import type { AppComponent } from './schema';
import type { Store } from './store';

export function AutomationRecordWidget({ component, runtime }: { component: AppComponent; runtime: Pick<Store, 'state' | 'dispatch'> }) {
  const { state, dispatch } = runtime;
  const props = component.props ?? {};
  const collection = typeof props.collection === 'string' ? props.collection : 'automations';
  const recordId = typeof props.recordId === 'string' ? props.recordId : `${component.id ?? 'automation'}-flow`;
  const field = typeof props.configField === 'string' ? props.configField : 'config';
  const stored = state.records.find((record) => record.id === recordId && record.collection === collection)?.values[field];
  const config = AutomationConfigSchema.safeParse(stored).success ? stored : props.config;
  return <AutomationWidget
    component={{ ...component, props: { ...props, config } }}
    onChange={(next) => void dispatch({ kind: 'create', collection, recordId, values: { [field]: next } })}
  />;
}
