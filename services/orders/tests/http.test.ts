import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoPayment, startTestApp, type TestApp } from './helpers/testApp.js';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.truncate(); t.fake.reset(); });

describe('salud y formato de respuesta', () => {
  it('GET /health responde 200 con el envoltorio', async () => {
    const res = await t.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', service: 'orders' }, meta: null });
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('errors');
  });

  it('los errores cumplen la convención del plan { error: { code, message }, requestId }', async () => {
    const res = await t.http().get('/no-existe').set('x-request-id', 'req-123');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false, message: 'Ruta no encontrada', data: null,
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' }, meta: null, requestId: 'req-123',
    });
  });
});

describe('autenticación y roles', () => {
  it('sin token responde 401', async () => {
    const res = await t.http().get('/api/orders/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('un token mal firmado responde 401', async () => {
    const res = await t.http().get('/api/orders/me').set('authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('un organizador no puede comprar (403)', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const res = await t.buy(await t.sign('organizer'), 'k', { eventId, sectorId, quantity: 1, payment: demoPayment() });
    expect(res.status).toBe(403);
    expect(await t.countOrders()).toBe(0);
  });

  it('un cliente no puede ver reportes (403)', async () => {
    const { eventId } = t.fake.addSector();
    const res = await t.http().get(`/api/orders/reports/events/${eventId}`).set('authorization', `Bearer ${await t.sign('customer')}`);
    expect(res.status).toBe(403);
  });
});

describe('validación de la compra (V3)', () => {
  it('rechaza cantidad 7, un precio enviado por el navegador y last4 desconocido', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const res = await t.buy(await t.sign('customer'), 'k', {
      eventId, sectorId, quantity: 7, unitPriceMinor: 1, payment: { method: 'demo_card', last4: '2222' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['quantity', 'payment.last4', 'body']));
    expect(t.fake.calls.reserve).toBe(0);
  });

  it.each([1, 6])('acepta %i entradas', async (quantity) => {
    const { eventId, sectorId } = t.fake.addSector();
    const res = await t.buy(await t.sign('customer'), `k-${quantity}`, { eventId, sectorId, quantity, payment: demoPayment() });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'paid', quantity, totalMinor: 5000 * quantity });
  });

  it('exige el header Idempotency-Key', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const res = await t.http().post('/api/orders').set('authorization', `Bearer ${await t.sign('customer')}`)
      .send({ eventId, sectorId, quantity: 1, payment: demoPayment() });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('Idempotency-Key');
  });

  it('JSON inválido responde 400 INVALID_JSON', async () => {
    const res = await t.http().post('/api/orders').set('authorization', `Bearer ${await t.sign('customer')}`)
      .set('idempotency-key', 'k').set('content-type', 'application/json').send('{malo');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
