export type SqlValue = string | number | null | boolean | Uint8Array | ArrayBuffer;
export type SqlParams = Readonly<Record<string, SqlValue>> | readonly SqlValue[];

/** Minimal database surface consumed by portable domain code. */
export interface DatabasePort {
  execAsync(source: string): Promise<void>;
  runAsync(source: string): Promise<unknown>;
  runAsync(source: string, params: SqlParams): Promise<unknown>;
  runAsync(source: string, ...params: SqlValue[]): Promise<unknown>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  getFirstAsync<T>(source: string, params: SqlParams): Promise<T | null>;
  getFirstAsync<T>(source: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string): Promise<T[]>;
  getAllAsync<T>(source: string, params: SqlParams): Promise<T[]>;
  getAllAsync<T>(source: string, ...params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
