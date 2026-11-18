import pg from 'pg';
import type { databaseConfig } from './config.js';
import { log } from './logger.js';

export function createPool({ connection, schema }: ReturnType<typeof databaseConfig>) {
  const pool = new pg.Pool({
    ...connection,
    query_timeout: 5_000,
    options: `-c search_path=${schema}`,
  });
  pool.on('error', () => log('error', 'Se perdió una conexión inactiva a PostgreSQL'));
  return pool;
}
