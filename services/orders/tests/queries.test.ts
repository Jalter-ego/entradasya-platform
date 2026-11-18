import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoPayment, startTestApp, type TestApp } from './helpers/testApp.js';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.truncate(); t.fake.reset(); });

describe('mis compras', () => {
  it('lista solo las propias, de la más reciente a la más antigua, con meta de paginación', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const mine = await t.sign('customer');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await t.buy(mine, `k${i}`, { eventId, sectorId, quantity: 1, payment: demoPayment() })).body.data.id);
    }
    await t.buy(await t.sign('customer'), 'otro', { eventId, sectorId, quantity: 1, payment: demoPayment() });

    const page1 = await t.http().get('/api/orders/me?perPage=2').set('authorization', `Bearer ${mine}`);
    expect(page1.status).toBe(200);
    expect(page1.headers['cache-control']).toBe('private, no-store');
    expect(page1.body.meta).toEqual({ currentPage: 1, perPage: 2, total: 3, lastPage: 2 });
    expect(page1.body.data.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1]]);

    const page2 = await t.http().get('/api/orders/me?page=2&perPage=2').set('authorization', `Bearer ${mine}`);
    expect(page2.body.data.map((o: { id: string }) => o.id)).toEqual([ids[0]]);
  });

  it('valida perPage', async () => {
    const res = await t.http().get('/api/orders/me?perPage=500').set('authorization', `Bearer ${await t.sign('customer')}`);
    expect(res.status).toBe(400);
  });

  it('el detalle de una compra ajena o inexistente responde 404', async () => {
    const { eventId, sectorId } = t.fake.addSector();
    const mine = await t.sign('customer');
    const { body } = await t.buy(mine, 'k', { eventId, sectorId, quantity: 1, payment: demoPayment() });

    const own = await t.http().get(`/api/orders/${body.data.id}`).set('authorization', `Bearer ${mine}`);
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(body.data.id);
    expect(own.body.data).not.toHaveProperty('customerEmail');

    const foreign = await t.http().get(`/api/orders/${body.data.id}`).set('authorization', `Bearer ${await t.sign('customer')}`);
    expect(foreign.status).toBe(404);
    const invalid = await t.http().get('/api/orders/abc').set('authorization', `Bearer ${mine}`);
    expect(invalid.status).toBe(404);
  });
});

describe('reporte de ventas (V11)', () => {
  it('cuenta solo órdenes pagadas del organizador, por sector', async () => {
    const organizerId = randomUUID();
    const eventId = randomUUID();
    const vip = t.fake.addSector({ eventId, organizerId, name: 'VIP', priceMinor: 15000 });
    const general = t.fake.addSector({ eventId, organizerId, name: 'General', priceMinor: 5000 });
    const buyer = await t.sign('customer');
    await t.buy(buyer, 'a', { ...vip, quantity: 2, payment: demoPayment() });
    await t.buy(buyer, 'b', { ...general, quantity: 3, payment: demoPayment() });
    await t.buy(buyer, 'c', { ...general, quantity: 1, payment: demoPayment() });
    await t.buy(buyer, 'd', { ...vip, quantity: 6, payment: demoPayment('0000') });

    const res = await t.http().get(`/api/orders/reports/events/${eventId}`)
      .set('authorization', `Bearer ${await t.sign('organizer', organizerId)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      eventId, currency: 'BOB', ordersPaid: 3, ticketsSold: 6, revenueMinor: 50000,
      sectors: [
        { sectorId: general.sectorId, sectorName: 'General', ordersPaid: 2, ticketsSold: 4, revenueMinor: 20000 },
        { sectorId: vip.sectorId, sectorName: 'VIP', ordersPaid: 1, ticketsSold: 2, revenueMinor: 30000 },
      ],
    });
  });

  it('otro organizador recibe 403', async () => {
    const sector = t.fake.addSector({ organizerId: randomUUID() });
    await t.buy(await t.sign('customer'), 'a', { ...sector, quantity: 1, payment: demoPayment() });
    const res = await t.http().get(`/api/orders/reports/events/${sector.eventId}`)
      .set('authorization', `Bearer ${await t.sign('organizer')}`);
    expect(res.status).toBe(403);
  });

  it('un evento sin ventas devuelve ceros', async () => {
    const eventId = randomUUID();
    const res = await t.http().get(`/api/orders/reports/events/${eventId}`)
      .set('authorization', `Bearer ${await t.sign('organizer')}`);
    expect(res.body.data).toEqual({ eventId, currency: null, ordersPaid: 0, ticketsSold: 0, revenueMinor: 0, sectors: [] });
  });

  it('eventId inválido responde 400', async () => {
    const res = await t.http().get('/api/orders/reports/events/abc').set('authorization', `Bearer ${await t.sign('organizer')}`);
    expect(res.status).toBe(400);
  });
});
