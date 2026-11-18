import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestService, type TestService } from './helpers.js';

let svc: TestService;

beforeAll(async () => {
  svc = await startTestService();
});
afterAll(async () => {
  await svc?.stop();
});
beforeEach(async () => {
  await svc.reset();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function chargeBody(overrides: Record<string, unknown> = {}) {
  return {
    orderId: randomUUID(),
    amountMinor: 10_000,
    currency: 'BOB',
    method: 'demo_card',
    last4: '1111',
    ...overrides,
  };
}

describe('salud', () => {
  it('responde 200 con base y migración disponibles', async () => {
    const res = await fetch(`${svc.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'payments' });
  });
});

describe('acceso interno (D7)', () => {
  it('rechaza sin token, con token incorrecto y con un JWT de cliente', async () => {
    const body = chargeBody();
    expect((await svc.call('POST', '/internal/payments', body, null)).status).toBe(401);
    expect((await svc.call('POST', '/internal/payments', body, 'otro-token-incorrecto-0123456789')).status).toBe(401);

    const res = await fetch(`${svc.baseUrl}/internal/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
    expect(await svc.count()).toBe(0);
  });

  it('no expone rutas públicas', async () => {
    const res = await fetch(`${svc.baseUrl}/api/payments`);
    expect(res.status).toBe(404);
  });
});

describe('cobro simulado (D2)', () => {
  it('1111 aprueba: 201 con transactionId', async () => {
    const body = chargeBody();
    const res = await svc.call('POST', '/internal/payments', body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orderId: body.orderId,
      status: 'approved',
      amountMinor: 10_000,
      currency: 'BOB',
      method: 'demo_card',
      last4: '1111',
      rejectionCode: null,
    });
    expect(res.body.transactionId).toMatch(UUID);
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it('0000 rechaza: también 2xx, status=rejected y PAYMENT_REJECTED', async () => {
    const res = await svc.call('POST', '/internal/payments', chargeBody({ last4: '0000' }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejectionCode).toBe('PAYMENT_REJECTED');
    expect(res.body.transactionId).toMatch(UUID);
  });

  it('otra terminación devuelve 400 sin crear un pago', async () => {
    for (const last4 of ['1234', '111', '11111', 1111]) {
      const res = await svc.call('POST', '/internal/payments', chargeBody({ last4 }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.requestId).toBeTruthy();
    }
    expect(await svc.count()).toBe(0);
  });

  it('rechaza datos de tarjeta reales o campos extra', async () => {
    const extras = [{ cardNumber: '4111111111111111' }, { cvv: '123' }, { customerId: randomUUID() }];
    for (const extra of extras) {
      const res = await svc.call('POST', '/internal/payments', chargeBody(extra));
      expect(res.status).toBe(400);
    }
    expect(await svc.count()).toBe(0);
  });

  it('valida medio, importe, moneda y orderId', async () => {
    const invalid = [
      { method: 'visa' },
      { amountMinor: -1 },
      { amountMinor: 10.5 },
      { amountMinor: '10000' },
      { currency: 'bob' },
      { currency: 'BOBS' },
      { orderId: 'no-es-uuid' },
    ];
    for (const override of invalid) {
      expect((await svc.call('POST', '/internal/payments', chargeBody(override))).status).toBe(400);
    }
    const res = await fetch(`${svc.baseUrl}/internal/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'test-internal-token-orders-payments-0123' },
      body: '{no es json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });
});

describe('idempotencia por orden (D3)', () => {
  it('repetir el mismo cobro devuelve la misma transacción (200)', async () => {
    const body = chargeBody();
    const first = await svc.call('POST', '/internal/payments', body);
    const second = await svc.call('POST', '/internal/payments', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await svc.count()).toBe(1);
  });

  it('repetir un rechazo conserva el rechazo y su transacción', async () => {
    const body = chargeBody({ last4: '0000' });
    const first = await svc.call('POST', '/internal/payments', body);
    const second = await svc.call('POST', '/internal/payments', body);
    expect(second.status).toBe(200);
    expect(second.body.transactionId).toBe(first.body.transactionId);
    expect(second.body.status).toBe('rejected');
  });

  it('mismo orderId con otro importe, moneda o tarjeta: 409 IDEMPOTENCY_CONFLICT', async () => {
    const body = chargeBody();
    await svc.call('POST', '/internal/payments', body);
    for (const change of [{ amountMinor: 9_999 }, { currency: 'USD' }, { last4: '0000' }]) {
      const res = await svc.call('POST', '/internal/payments', { ...body, ...change });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await svc.count()).toBe(1);
    const stored = await svc.call('GET', `/internal/payments/orders/${body.orderId}`);
    expect(stored.body.amountMinor).toBe(10_000);
    expect(stored.body.status).toBe('approved');
  });

  it('peticiones simultáneas de la misma orden crean una sola transacción', async () => {
    const body = chargeBody();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.call('POST', '/internal/payments', body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
    expect(await svc.count()).toBe(1);
  });

  it('acepta importes grandes sin perder precisión (bigint)', async () => {
    const body = chargeBody({ amountMinor: 600_000_000 });
    const res = await svc.call('POST', '/internal/payments', body);
    expect(res.status).toBe(201);
    expect(res.body.amountMinor).toBe(600_000_000);
  });
});

describe('consulta tras timeout', () => {
  it('devuelve el pago registrado de la orden', async () => {
    const body = chargeBody({ last4: '0000' });
    const created = await svc.call('POST', '/internal/payments', body);
    const res = await svc.call('GET', `/internal/payments/orders/${body.orderId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it('404 si la orden nunca se cobró o el id no es válido', async () => {
    expect((await svc.call('GET', `/internal/payments/orders/${randomUUID()}`)).status).toBe(404);
    expect((await svc.call('GET', '/internal/payments/orders/no-es-uuid')).status).toBe(404);
  });

  it('también exige el token interno', async () => {
    expect((await svc.call('GET', `/internal/payments/orders/${randomUUID()}`, undefined, null)).status).toBe(401);
  });
});
