import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, SignJWT } from 'jose';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { createJwtVerifier, ROLES } from '../src/http/auth.js';

export const INTERNAL_TOKEN = 'test-internal-token-orders-0123456789';
const ISSUER = 'entradasya-auth';
const AUDIENCE = 'entradasya';
const SCHEMA = 'events_test';

/**
 * Levanta el servicio contra TEST_DATABASE_URL en un schema propio recién migrado.
 * Las pruebas usan HTTP real, así las peticiones concurrentes compiten de verdad.
 */
export async function startTestService() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Define TEST_DATABASE_URL para ejecutar las pruebas (ver README)');

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
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const verifyToken = await createJwtVerifier({
    publicKey,
    algorithm: 'RS256',
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const app = createApp({ db, verifyToken, internalToken: INTERNAL_TOKEN, currency: 'USD' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  function sign(role: string, sub: string, opts: { issuer?: string; exp?: string } = {}) {
    return new SignJWT({ role, email: `${role}@test.local` })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(sub)
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '10m')
      .sign(privateKey);
  }

  return {
    db,
    baseUrl,
    sign,
    newUser: async (role: string = ROLES.ORGANIZER) => {
      const id = randomUUID();
      return { id, token: await sign(role, id) };
    },
    reset: () => db.query('TRUNCATE reservations, sectors, events CASCADE'),
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}

export type TestService = Awaited<ReturnType<typeof startTestService>>;

/** Fecha futura para eventos de prueba. */
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Concierto de prueba',
    description: 'Descripción',
    venue: 'Estadio Central',
    startsAt: inDays(30),
    imageUrl: 'https://example.com/poster.jpg',
    sectors: [
      { name: 'General', priceMinor: 5000, capacity: 100 },
      { name: 'VIP', priceMinor: 15000, capacity: 10 },
    ],
    ...overrides,
  };
}
