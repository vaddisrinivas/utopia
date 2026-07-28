import { DatabaseSync } from 'node:sqlite';

type SqlParams = any[] | Record<string, unknown>;

export class NodeSqliteDb {
  private readonly db = new DatabaseSync(':memory:');

  constructor() {
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async execAsync(sql: string) {
    this.db.exec(sql);
  }

  async withTransactionAsync(fn: () => Promise<void>) {
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after the original error.
      }
      throw error;
    }
  }

  async runAsync(sql: string, params: SqlParams = []) {
    const statement = this.db.prepare(sql);
    return Array.isArray(params) ? statement.run(...(params as any[])) : statement.run(params as Record<string, any>);
  }

  async getFirstAsync<T>(sql: string, params: SqlParams = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    const row = Array.isArray(params) ? statement.get(...(params as any[])) : statement.get(params as Record<string, any>);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return (Array.isArray(params) ? statement.all(...(params as any[])) : statement.all(params as Record<string, any>)) as T[];
  }

  close() {
    this.db.close();
  }
}
