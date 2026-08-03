export type RecordChangeEvent = Readonly<{
  installationId: string;
  domain: string;
  collection: string;
  recordId: string;
  operationId: string;
}>;

type Listener = (event: RecordChangeEvent) => void;

const listeners = new Set<Listener>();

export function subscribeToRecordChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitRecordChange(event: RecordChangeEvent): void {
  for (const listener of [...listeners]) listener(event);
}
