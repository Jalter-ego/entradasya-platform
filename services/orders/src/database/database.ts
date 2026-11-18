import pg from 'pg';
import { config } from '../config/config.js';
import { DB_POOL } from '../constants/constants.js';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(): Db {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
    max: DB_POOL.max,
    connectionTimeoutMillis: DB_POOL.connectionTimeoutMillis,
    query_timeout: DB_POOL.queryTimeoutMillis,
    statement_timeout: DB_POOL.queryTimeoutMillis,
    idle_in_transaction_session_timeout: DB_POOL.idleInTransactionTimeoutMillis,
  });
}

export async function checkSchema(db: Db): Promise<void> {
  await db.query('SELECT 1 FROM orders o LEFT JOIN order_items i ON i.order_id = o.id LIMIT 1');
}

export async function transaction<T>(db: Db, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
