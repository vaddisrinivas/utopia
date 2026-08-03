import { emitRecordChange, subscribeToRecordChanges } from '@/src/db/record-change-events';
import { describe, expect, it, vi } from 'vitest';

describe('record change events', () => {
  it('notifies active subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecordChanges(listener);
    const event = {
      installationId: 'install-a',
      domain: 'shopping-list',
      collection: 'shopping_item',
      recordId: 'milk',
      operationId: 'op-1',
    };
    emitRecordChange(event);
    unsubscribe();
    emitRecordChange({ ...event, operationId: 'op-2' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });
});
