import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';

export const INTERNAL_TOKEN = 'test-internal-token-orders-payments-0123';
const SCHEMA = 'payments_test';

/**
 * Levanta payments contra TEST_DATABASE_URL en un schema propio recién migrado.
 * Usa HTTP real, así las peticiones concurrentes compiten de verdad en PostgreSQL.
 */
export async function startTestService() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Define TEST_DATABASE_URL (ver .env.test.example y el README)');

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();

  await runner({
    databaseUrl: url,
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    count: Infinity,
    schema: SCHEMA,
    createSchema: true,
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });

  const db = createPool({ connectionString: url, schema: SCHEMA });
  const app = createApp({ db, internalToken: INTERNAL_TOKEN });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, token: string | null = INTERNAL_TOKEN) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === null ? {} : { 'x-internal-token': token }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  return {
    db,
    baseUrl,
    call,
    reset: () => db.query('TRUNCATE payments'),
    count: async () => Number((await db.query('SELECT count(*) FROM payments')).rows[0].count),
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}

export type TestService = Awaited<ReturnType<typeof startTestService>>;
