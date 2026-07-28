import type { SharePayload } from 'expo-sharing';

const emptyPayloads: SharePayload[] = [];
const noop = () => {};

export function useIncomingShareSafe() {
  return {
    sharedPayloads: emptyPayloads,
    clearSharedPayloads: noop,
    refreshSharePayloads: noop,
  };
}
