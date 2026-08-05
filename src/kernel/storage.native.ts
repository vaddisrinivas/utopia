type KvStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync?: (key: string) => Promise<void>;
  removeItemAsync?: (key: string) => Promise<void>;
};

const kv = require('expo-sqlite/kv-store') as KvStore;
const remove = kv.deleteItemAsync ?? kv.removeItemAsync ?? (() => Promise.resolve());

const storage = {
  getItem: kv.getItemAsync,
  setItem: kv.setItemAsync,
  removeItem: (key: string) => remove.call(kv, key),
};

export default storage;
