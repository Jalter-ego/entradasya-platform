import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoPayment, startTestApp, type TestApp } from './helpers/testApp.js';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.truncate(); t.fake.reset(); });

async function purchase(last4: '0000' | '1111' = '1111', quantity = 2) {
  const { eventId, sectorId } = t.fake.addSector({ capacity: 10 });
  const token = await t.sign('customer');
  const res = await t.buy(token, 'k1', { eventId, sectorId, quantity, payment: demoPayment(last4) });
  const retry = () => t.http().post(`/api/orders/${res.body.data.id}/retry`).set('authorization', `Bearer ${token}`);
  return { res, retry, sectorId, token };
}

describe('respuestas inciertas y fallos parciales (V9, V10)', () => {
  it('timeout de la reserva: queda pendiente y el reintento la confirma sin reservar dos veces', async () => {
    t.fake.mode.events = 'timeout-once';
    const { res, retry, sectorId } = await purchase();
    expect(res.body.data).toMatchObject({ status: 'pending', progress: { reservation: 'pending' }, lastError: { code: 'TIMEOUT' } });
    expect(t.fake.calls.charge).toBe(0);

    const after = await retry();
    expect(after.body.data).toMatchObject({ status: 'paid', progress: { reservation: 'active', tickets: 'issued' }, lastError: null });
    expect(t.fake.reservations.size).toBe(1);
    expect(t.fake.reserved(sectorId)).toBe(2);
  });

  it('timeout del pago: unknown, nunca rechazado; cupos retenidos; el reintento no cobra dos veces', async () => {
    t.fake.mode.payments = 'timeout-once';
    const { res, retry, sectorId } = await purchase();
    expect(res.body.data).toMatchObject({
      status: 'pending', progress: { reservation: 'active', payment: 'unknown' }, lastError: { step: 'payment', code: 'TIMEOUT' },
    });
    expect(t.fake.calls.release).toBe(0);
    expect(t.fake.reserved(sectorId)).toBe(2);

    const after = await retry();
    expect(after.body.data).toMatchObject({ status: 'paid', progress: { payment: 'approved' } });
    expect(t.fake.chargeBodies[1]).toEqual(t.fake.chargeBodies[0]);
    expect(t.fake.payments.size).toBe(1);
  });

  it('payments caído: la orden queda pendiente, sin liberar cupos ni suponer rechazo', async () => {
    t.fake.mode.payments = 'down';
    const { res } = await purchase();
    expect(res.body.data).toMatchObject({ status: 'pending', progress: { payment: 'unknown' } });
    expect(t.fake.calls.release).toBe(0);
  });

  it('tickets falla: la compra sigue pagada y el reintento reenvía el MISMO cuerpo sin cobrar otra vez', async () => {
    t.fake.mode.tickets = 'fail-once';
    const { res, retry } = await purchase('1111', 3);
    expect(res.body.message).toBe('Compra pagada; tus entradas se están emitiendo');
    expect(res.body.data).toMatchObject({
      status: 'paid', progress: { tickets: 'pending', notification: 'not_started' }, lastError: { step: 'tickets', code: 'PDF_UNAVAILABLE' },
    });

    const after = await retry();
    expect(after.body.data).toMatchObject({ status: 'paid', progress: { tickets: 'issued', notification: 'sent' }, lastError: null });
    expect(t.fake.issueBodies).toHaveLength(2);
    expect(t.fake.issueBodies[1]).toEqual(t.fake.issueBodies[0]);
    expect(t.fake.calls.charge).toBe(1);
  });

  it('notifications caído: compra pagada con entradas y el fallo registrado', async () => {
    t.fake.mode.notifications = 'down';
    const { res, retry } = await purchase();
    expect(res.body.data).toMatchObject({
      status: 'paid', progress: { tickets: 'issued', notification: 'failed' }, lastError: { step: 'notification', code: 'SMTP_UNAVAILABLE' },
    });

    t.fake.mode.notifications = 'ok';
    const after = await retry();
    expect(after.body.data).toMatchObject({ progress: { notification: 'sent' }, lastError: null });
    expect(t.fake.calls.charge).toBe(1);
    expect(t.fake.calls.issue).toBe(1);
  });

  it('timeout de notifications queda unknown (el correo pudo enviarse)', async () => {
    t.fake.mode.notifications = 'timeout';
    const { res } = await purchase();
    expect(res.body.data).toMatchObject({ status: 'paid', progress: { notification: 'unknown' } });
  });

  it('pago rechazado con la liberación caída: release_pending y el reintento libera una vez', async () => {
    t.fake.mode.release = 'fail-once';
    const { res, retry, sectorId } = await purchase('0000');
    expect(res.body.data).toMatchObject({ status: 'rejected', progress: { reservation: 'release_pending' } });
    expect(t.fake.reserved(sectorId)).toBe(2);

    const after = await retry();
    expect(after.body.data.progress.reservation).toBe('released');
    expect(t.fake.reserved(sectorId)).toBe(0);
    await retry();
    expect(t.fake.reserved(sectorId)).toBe(0);
  });

  it('events caído: la orden queda pendiente y se recupera cuando vuelve', async () => {
    t.fake.mode.events = 'down';
    const { res, retry } = await purchase();
    expect(res.body.data).toMatchObject({ status: 'pending', progress: { reservation: 'pending' } });
    t.fake.mode.events = 'ok';
    expect((await retry()).body.data.status).toBe('paid');
  });

  it('reintentar la orden de otro comprador responde 404', async () => {
    const { res } = await purchase();
    const other = await t.http().post(`/api/orders/${res.body.data.id}/retry`).set('authorization', `Bearer ${await t.sign('customer')}`);
    expect(other.status).toBe(404);
  });
});
