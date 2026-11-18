import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Clients } from '../../src/clients/clients.js';
import { EventsClient } from '../../src/clients/eventsClient.js';
import { NotificationsClient } from '../../src/clients/notificationsClient.js';
import { PaymentsClient } from '../../src/clients/paymentsClient.js';
import { TicketsClient } from '../../src/clients/ticketsClient.js';
import { createPool } from '../../src/database/database.js';
import { createJwtVerifier } from '../../src/utils/jwt.js';
import { startFakeServices } from './fakeServices.js';

/** Timeout corto para que los casos de timeout no alarguen la suite (los dobles tardan SLOW_MS). */
export const TEST_TIMEOUT_MS = 400;

/** Levanta orders sobre la base de pruebas y servicios dobles. Usa HTTP real: la concurrencia compite de verdad. */
export async function startTestApp() {
  const fake = await startFakeServices();
  const endpoint = (name: string) => ({ name, url: fake.url, token: `test-token-${name}-0123456789abcdef`, timeoutMs: TEST_TIMEOUT_MS });
  const clients: Clients = {
    events: new EventsClient(endpoint('events')),
    payments: new PaymentsClient(endpoint('payments')),
    tickets: new TicketsClient(endpoint('tickets')),
    notifications: new NotificationsClient(endpoint('notifications')),
  };
  const db = createPool();
  const app = createApp({ db, verifyToken: await createJwtVerifier(), clients });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const privateKey = await importPKCS8((globalThis as { testPrivateKeyPem?: string }).testPrivateKeyPem!, 'RS256');
  const sign = (role: 'customer' | 'organizer' | 'doorman', sub: string = randomUUID()) =>
    new SignJWT({ role, email: `${role}-${sub.slice(0, 8)}@test.local` })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(sub)
      .setIssuer('entradasya-auth')
      .setAudience('entradasya')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

  return {
    db, fake, baseUrl, sign,
    http: () => request(baseUrl),
    /** Compra con los valores por defecto; `key` es la Idempotency-Key. */
    buy(token: string, key: string, body: Record<string, unknown>) {
      return request(baseUrl).post('/api/orders')
        .set('authorization', `Bearer ${token}`).set('idempotency-key', key).send(body);
    },
    async truncate() { await db.query('TRUNCATE order_items, orders'); },
    async countOrders() { return (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM orders')).rows[0]!.n; },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fake.close();
      await db.end();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

export const demoPayment = (last4: '0000' | '1111' = '1111') => ({ method: 'demo_card', last4 });
