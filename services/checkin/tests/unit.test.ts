import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { HttpTicketsValidator } from '../src/clients/tickets.js';
import type { Db } from '../src/db.js';
import { createJwtVerifier, ROLES } from '../src/http/auth.js';

interface StoredCheckin {
  id: string;
  ticket_id: string;
  event_id: string;
  doorman_id: string;
  checked_in_at: Date;
}

/** Db en memoria para validar rutas, JWT, cliente HTTP a tickets y reglas sin Postgres. */
function createInMemoryDb() {
  const rows = new Map<string, StoredCheckin>();
  let failHealth = false;

  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT 1 FROM checkins')) {
        if (failHealth) throw new Error('DB down');
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO checkins')) {
        const [ticketId, eventId, doormanId] = params as [string, string, string];
        if (rows.has(ticketId)) return { rows: [], rowCount: 0 };
        const rec: StoredCheckin = {
          id: randomUUID(),
          ticket_id: ticketId,
          event_id: eventId,
          doorman_id: doormanId,
          checked_in_at: new Date(),
        };
        rows.set(ticketId, rec);
        return { rows: [rec], rowCount: 1 };
      }
      if (sql.includes('WHERE ticket_id = $1')) {
        const [ticketId] = params as [string];
        const found = rows.get(ticketId);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (sql.includes('COUNT(*)::int AS count')) {
        const [eventId] = params as [string];
        const count = Array.from(rows.values()).filter((r) => r.event_id === eventId).length;
        return { rows: [{ count }], rowCount: 1 };
      }
      if (sql.includes('ORDER BY checked_in_at DESC')) {
        const [eventId, limit] = params as [string, number];
        const items = Array.from(rows.values())
          .filter((r) => r.event_id === eventId)
          .sort((a, b) => b.checked_in_at.getTime() - a.checked_in_at.getTime())
          .slice(0, limit);
        return { rows: items, rowCount: items.length };
      }
      throw new Error(`Query no soportada en mock: ${sql}`);
    },
  } as unknown as Db;

  return {
    db,
    reset: () => {
      rows.clear();
      failHealth = false;
    },
    setFailHealth: (v: boolean) => {
      failHealth = v;
    },
  };
}

describe('checkin unit (sin Postgres)', () => {
  const INTERNAL_TOKEN = 'unit-test-internal-token-0123456789';
  const ISSUER = 'entradasya-auth';
  const AUDIENCE = 'entradasya';
  const mem = createInMemoryDb();
  const mockTickets = new Map<string, { id: string; orderId: string; customerId: string; eventId: string; paymentStatus: 'approved' }>();
  let mode: 'normal' | 'down' | 'slow' = 'normal';

  let ticketsServer: http.Server;
  let appServer: http.Server;
  let baseUrl: string;
  let sign: (role: string, sub?: string) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const verifyToken = await createJwtVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });

    ticketsServer = http.createServer((req, res) => {
      if (req.url !== '/internal/tickets/validate' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'no' } }));
        return;
      }
      if (mode === 'down') {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'DOWN', message: 'down' } }));
        return;
      }
      if (mode === 'slow') {
        setTimeout(() => {
          if (!res.destroyed) res.writeHead(200).end('{}');
        }, 1200);
        return;
      }

      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const { code, eventId } = JSON.parse(raw) as { code: string; eventId: string };
        const found = mockTickets.get(code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!found) return res.end(JSON.stringify({ valid: false, reason: 'INVALID_TICKET' }));
        if (found.eventId !== eventId) return res.end(JSON.stringify({ valid: false, reason: 'WRONG_EVENT' }));
        res.end(JSON.stringify({ valid: true, ticket: found }));
      });
    });

    await new Promise<void>((resolve) => ticketsServer.listen(0, '127.0.0.1', resolve));
    const ticketsUrl = `http://127.0.0.1:${(ticketsServer.address() as AddressInfo).port}`;

    const app = createApp({
      db: mem.db,
      ticketsValidator: new HttpTicketsValidator(ticketsUrl, INTERNAL_TOKEN, 500),
      verifyToken,
    });
    appServer = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => appServer.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

    sign = (role, sub = randomUUID()) =>
      new SignJWT({ role, email: `${role}@demo.bo` })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
  });

  afterAll(async () => {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => ticketsServer.close(resolve));
  });

  beforeEach(() => {
    mem.reset();
    mockTickets.clear();
    mode = 'normal';
  });

  it('reporta /health 200 y 503 cuando la base falla', async () => {
    const ok = await request(baseUrl).get('/health');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ status: 'ok', service: 'checkin' });

    mem.setFailHealth(true);
    const down = await request(baseUrl).get('/health');
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('valida roles, entrada, rechazo de duplicado con hora y errores de tickets', async () => {
    const eventA = randomUUID();
    const eventB = randomUUID();
    const doormanToken = await sign(ROLES.DOORMAN);
    const customerToken = await sign(ROLES.CUSTOMER);
    const organizerToken = await sign(ROLES.ORGANIZER);

    expect((await request(baseUrl).post('/api/checkin').send({ code: 'X', eventId: eventA })).status).toBe(401);
    expect(
      (await request(baseUrl).post('/api/checkin').set('Authorization', `Bearer ${customerToken}`).send({ code: 'X', eventId: eventA })).status,
    ).toBe(403);
    expect(
      (await request(baseUrl).post('/api/checkin').set('Authorization', `Bearer ${doormanToken}`).send({ code: '', eventId: 'no-uuid' })).status,
    ).toBe(400);

    mockTickets.set('CODE-1', {
      id: randomUUID(),
      orderId: randomUUID(),
      customerId: randomUUID(),
      eventId: eventA,
      paymentStatus: 'approved',
    });

    const invalid = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'NOPE', eventId: eventA });
    expect(invalid.status).toBe(404);
    expect(invalid.body.error.code).toBe('INVALID_TICKET');

    const wrong = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'CODE-1', eventId: eventB });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('WRONG_EVENT');

    const ok = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'CODE-1', eventId: eventA });
    expect(ok.status).toBe(201);
    expect(ok.body.eventCount).toBe(1);

    const dup = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'CODE-1', eventId: eventA });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_USED');
    expect(dup.body.error.details.checkedInAt).toBe(ok.body.checkin.checkedInAt);

    const countOrg = await request(baseUrl)
      .get(`/api/checkin/events/${eventA}/count`)
      .set('Authorization', `Bearer ${organizerToken}`);
    expect(countOrg.status).toBe(200);
    expect(countOrg.body.count).toBe(1);

    const recentDoor = await request(baseUrl)
      .get(`/api/checkin/events/${eventA}/recent`)
      .set('Authorization', `Bearer ${doormanToken}`);
    expect(recentDoor.status).toBe(200);
    expect(recentDoor.body.items).toHaveLength(1);

    mode = 'down';
    const downRes = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'CODE-1', eventId: eventA });
    expect(downRes.status).toBe(503);
    expect(downRes.body.error.code).toBe('TICKETS_UNAVAILABLE');

    mode = 'slow';
    const slowRes = await request(baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doormanToken}`)
      .send({ code: 'CODE-1', eventId: eventA });
    expect(slowRes.status).toBe(503);
    expect(slowRes.body.error.code).toBe('TICKETS_UNAVAILABLE');
  });
});
