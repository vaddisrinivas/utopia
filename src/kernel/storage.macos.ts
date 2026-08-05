type StorageModule = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const store = require('@react-native-async-storage/async-storage').default as StorageModule;
const remove = store.removeItem ?? ((key: string) => Promise.resolve());

export default { getItem: store.getItem, setItem: store.setItem, removeItem: remove };
