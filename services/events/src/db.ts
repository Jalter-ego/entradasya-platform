import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export interface DbOptions {
  connectionString: string;
  ssl?: boolean;
  schema?: string;
}

export function createPool({ connectionString, ssl, schema = 'public' }: DbOptions): Db {
  const pool = new pg.Pool({
    connectionString,
    // Supabase exige SSL; en local normalmente no.
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    // El schema se fija al abrir cada conexión (nombre ya validado: solo [a-z0-9_]).
    options: schema !== 'public' ? `-c search_path=${schema}` : undefined,
  });
  return pool;
}

/** Ejecuta fn dentro de una transacción; hace ROLLBACK si fn lanza un error. */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Códigos de error de PostgreSQL que se traducen a respuestas de negocio. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
