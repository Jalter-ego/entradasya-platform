import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export interface DbOptions {
  connectionString: string;
  ssl?: boolean;
  schema?: string;
}

export function createPool({ connectionString, ssl, schema = 'public' }: DbOptions): Db {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    options: schema !== 'public' ? `-c search_path=${schema}` : undefined,
  });
}
