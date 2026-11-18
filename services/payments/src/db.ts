import pg from 'pg';

export type Db = pg.Pool;

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
    // Nombre ya validado en config: solo [a-z0-9_].
    options: schema !== 'public' ? `-c search_path=${schema}` : undefined,
  });
}

export const PG = {
  UNIQUE_VIOLATION: '23505',
} as const;
