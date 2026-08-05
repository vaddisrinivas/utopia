const memory = new Map<string, string>();
const storage = {
  async getItem(key: string) { return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null; },
  async setItem(key: string, value: string) {
    if (globalThis.localStorage) globalThis.localStorage.setItem(key, value);
    else memory.set(key, value);
  },
  async removeItem(key: string) {
    if (globalThis.localStorage) globalThis.localStorage.removeItem(key);
    else memory.delete(key);
  },
};

export default storage;
