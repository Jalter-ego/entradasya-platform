import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, SignJWT } from 'jose';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { HttpTicketsValidator } from '../src/clients/tickets.js';
import { createPool } from '../src/db.js';
import { createJwtVerifier, ROLES } from '../src/http/auth.js';

export const INTERNAL_TOKEN_CHECKIN = 'test-internal-token-checkin-0123456789';
const ISSUER = 'entradasya-auth';
const AUDIENCE = 'entradasya';
const SCHEMA = 'checkin_test';

export interface MockTicketRecord {
  id: string;
  orderId: string;
  customerId: string;
  eventId: string;
  paymentStatus: 'approved';
}

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

  // Servidor HTTP real simulando /internal/tickets/validate de P5.
  const tickets = new Map<string, MockTicketRecord>();
  let ticketServerMode: 'normal' | 'down' | 'slow' = 'normal';

  const ticketsServer = http.createServer((req, res) => {
    if (req.url !== '/internal/tickets/validate' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers['x-internal-token'] !== INTERNAL_TOKEN_CHECKIN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Credencial inválida' }, requestId: 'test' }));
      return;
    }
    if (ticketServerMode === 'down') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Caído' }, requestId: 'test' }));
      return;
    }
    if (ticketServerMode === 'slow') {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: false, reason: 'INVALID_TICKET' }));
        }
      }, 1500);
      return;
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as { code: string; eventId: string };
      const found = tickets.get(body.code);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!found) {
        res.end(JSON.stringify({ valid: false, reason: 'INVALID_TICKET' }));
        return;
      }
      if (found.eventId !== body.eventId) {
        res.end(JSON.stringify({ valid: false, reason: 'WRONG_EVENT' }));
        return;
      }
      res.end(JSON.stringify({ valid: true, ticket: found }));
    });
  });

  await new Promise<void>((resolve) => ticketsServer.listen(0, '127.0.0.1', resolve));
  const ticketsBaseUrl = `http://127.0.0.1:${(ticketsServer.address() as AddressInfo).port}`;

  const ticketsValidator = new HttpTicketsValidator(ticketsBaseUrl, INTERNAL_TOKEN_CHECKIN, 800);
  const app = createApp({ db, ticketsValidator, verifyToken });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
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
    newUser: async (role: string = ROLES.DOORMAN) => {
      const id = randomUUID();
      return { id, token: await sign(role, id) };
    },
    seedTicket: (code: string, eventId: string, overrides: Partial<MockTicketRecord> = {}) => {
      const record: MockTicketRecord = {
        id: randomUUID(),
        orderId: randomUUID(),
        customerId: randomUUID(),
        eventId,
        paymentStatus: 'approved',
        ...overrides,
      };
      tickets.set(code, record);
      return record;
    },
    setTicketsMode: (mode: 'normal' | 'down' | 'slow') => {
      ticketServerMode = mode;
    },
    reset: async () => {
      tickets.clear();
      ticketServerMode = 'normal';
      await db.query('TRUNCATE checkins');
    },
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => ticketsServer.close(resolve));
      await db.end();
    },
  };
}
