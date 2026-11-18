import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoPayment, startTestApp, type TestApp } from './helpers/testApp.js';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.truncate(); t.fake.reset(); });

describe('compra completa', () => {
  it('reserva, cobra, emite y notifica una sola vez', async () => {
    const { eventId, sectorId } = t.fake.addSector({ priceMinor: 5000 });
    const res = await t.buy(await t.sign('customer'), 'k1', { eventId, sectorId, quantity: 2, payment: demoPayment() });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Compra realizada');
    expect(res.body.data).toMatchObject({
      status: 'paid', quantity: 2, unitPriceMinor: 5000, totalMinor: 10000, currency: 'BOB',
      event: { id: eventId, title: 'Noche de Rock', city: 'La Paz' },
      sector: { id: sectorId, name: 'General' },
      progress: { reservation: 'active', payment: 'approved', tickets: 'issued', notification: 'sent' },
      lastError: null,
    });
    expect(res.body.data.payment.transactionId).toEqual(expect.any(String));
    expect(res.body.data.paidAt).toEqual(expect.any(String));
    expect(t.fake.calls).toEqual({ reserve: 1, release: 0, charge: 1, issue: 1, notify: 1 });
  });

  it('el cobro usa el precio de events, no el del navegador', async () => {
    const { eventId, sectorId } = t.fake.addSector({ priceMinor: 12345 });
    await t.buy(await t.sign('customer'), 'k1', { eventId, sectorId, quantity: 3, payment: demoPayment() });
    expect(t.fake.chargeBodies[0]).toMatchObject({ amountMinor: 37035, currency: 'BOB', method: 'demo_card', last4: '1111' });
  });

  it('envía a tickets el cuerpo del README §9, sin city, y lo persiste', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const customerId = '00000000-0000-4000-8000-000000000002';
    const res = await t.buy(await t.sign('customer', customerId), 'k1', { eventId, sectorId, quantity: 2, payment: demoPayment() });

    const sent = t.fake.issueBodies[0];
    expect(sent).toEqual({
      orderId: res.body.data.id, customerId, paymentStatus: 'approved', quantity: 2, unitPriceMinor: 5000, currency: 'BOB',
      event: { id: eventId, title: 'Noche de Rock', venue: 'Estadio Central', startsAt: '2026-12-20T23:00:00.000Z', organizerId: expect.any(String) },
      sector: { id: sectorId, name: 'General' },
    });
    const stored = await t.db.query('SELECT ticket_issue_payload FROM orders WHERE id = $1', [res.body.data.id]);
    expect(stored.rows[0].ticket_issue_payload).toEqual(sent);
  });

  it('el correo va al email del JWT, no a uno del cuerpo', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const token = await t.sign('customer');
    await t.buy(token, 'k1', { eventId, sectorId, quantity: 1, payment: demoPayment() });
    expect(t.fake.notifications[0].to).toMatch(/^customer-.*@test\.local$/);
  });
});

describe('sin cupo y pago rechazado (V6, V7)', () => {
  it('agotado: orden rechazada sin llamar a payments', async () => {
    const { eventId, sectorId } = t.fake.addSector({ capacity: 1 });
    const res = await t.buy(await t.sign('customer'), 'k1', { eventId, sectorId, quantity: 2, payment: demoPayment() });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('No quedan cupos suficientes en el sector');
    expect(res.body.data).toMatchObject({ status: 'rejected', lastError: { step: 'reservation', code: 'SOLD_OUT' } });
    expect(t.fake.calls.charge).toBe(0);
  });

  it('dos compradores por el último cupo: una pagada, otra agotada, un solo cobro', async () => {
    const { eventId, sectorId } = t.fake.addSector({ capacity: 1 });
    const [a, b] = await Promise.all([
      t.buy(await t.sign('customer'), 'k', { eventId, sectorId, quantity: 1, payment: demoPayment() }),
      t.buy(await t.sign('customer'), 'k', { eventId, sectorId, quantity: 1, payment: demoPayment() }),
    ]);
    expect([a.body.data.status, b.body.data.status].sort()).toEqual(['paid', 'rejected']);
    expect(t.fake.calls.charge).toBe(1);
  });

  it('pago rechazado: libera los cupos una sola vez y el reintento no vuelve a liberar', async () => {
    const { eventId, sectorId } = t.fake.addSector({ capacity: 10 });
    const token = await t.sign('customer');
    const res = await t.buy(token, 'k1', { eventId, sectorId, quantity: 4, payment: demoPayment('0000') });

    expect(res.body.message).toBe('El pago fue rechazado');
    expect(res.body.data).toMatchObject({
      status: 'rejected', progress: { reservation: 'released', payment: 'rejected', tickets: 'not_started' },
      lastError: { step: 'payment', code: 'PAYMENT_REJECTED' },
    });
    expect(t.fake.reserved(sectorId)).toBe(0);

    const retry = await t.http().post(`/api/orders/${res.body.data.id}/retry`).set('authorization', `Bearer ${token}`);
    expect(retry.status).toBe(200);
    expect(t.fake.calls.release).toBe(1);
    expect(t.fake.calls.issue).toBe(0);
  });
});

describe('idempotencia (V8)', () => {
  it('repetir la misma clave devuelve la misma orden con 200 y sin llamadas nuevas', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const token = await t.sign('customer');
    const body = { eventId, sectorId, quantity: 2, payment: demoPayment() };
    const first = await t.buy(token, 'k1', body);
    t.fake.reset();
    const again = await t.buy(token, 'k1', body);

    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(t.fake.calls).toEqual({ reserve: 0, release: 0, charge: 0, issue: 0, notify: 0 });
    expect(await t.countOrders()).toBe(1);
  });

  it('la misma clave con otros datos responde 409 IDEMPOTENCY_CONFLICT', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const token = await t.sign('customer');
    await t.buy(token, 'k1', { eventId, sectorId, quantity: 2, payment: demoPayment() });
    const res = await t.buy(token, 'k1', { eventId, sectorId, quantity: 3, payment: demoPayment() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await t.countOrders()).toBe(1);
  });

  it('la misma clave de otro comprador es otra compra', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const body = { eventId, sectorId, quantity: 1, payment: demoPayment() };
    await t.buy(await t.sign('customer'), 'k1', body);
    const res = await t.buy(await t.sign('customer'), 'k1', body);
    expect(res.status).toBe(201);
    expect(await t.countOrders()).toBe(2);
  });

  it('5 peticiones simultáneas con la misma clave: una orden, una reserva, un cobro, una emisión', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const token = await t.sign('customer');
    const body = { eventId, sectorId, quantity: 2, payment: demoPayment() };
    const results = await Promise.all(Array.from({ length: 5 }, () => t.buy(token, 'k1', body)));

    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await t.countOrders()).toBe(1);
    expect(t.fake.calls).toMatchObject({ reserve: 1, charge: 1, issue: 1, notify: 1 });
  });
});
