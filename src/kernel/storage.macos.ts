type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
const storage = require('@react-native-async-storage/async-storage').default as Storage;
export default storage;
