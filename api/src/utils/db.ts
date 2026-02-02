/**
 * Database utility functions
 */

import { Env } from '../index';

export interface DbResult<T> {
  results: T[];
  success: boolean;
  meta?: any;
}

// Execute a query and return results
export async function query<T = any>(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all();
  return result.results as T[];
}

// Execute a query and return first result
export async function queryOne<T = any>(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first();
  return result as T | null;
}

// Execute an insert/update/delete query
export async function execute(
  db: D1Database,
  sql: string,
  params: any[] = []
): Promise<D1Response> {
  return await db.prepare(sql).bind(...params).run();
}

// Batch execute multiple queries
export async function batch(
  db: D1Database,
  statements: Array<{ sql: string; params?: any[] }>
): Promise<D1Response[]> {
  const prepared = statements.map(({ sql, params = [] }) =>
    db.prepare(sql).bind(...params)
  );
  return await db.batch(prepared);
}
