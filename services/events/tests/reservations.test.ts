import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '../src/http/auth.js';
import { eventBody, INTERNAL_TOKEN, startTestService, type TestService } from './helpers.js';

let svc: TestService;
const api = () => request(svc.baseUrl);

beforeAll(async () => {
  svc = await startTestService();
});
afterAll(() => svc.stop());
beforeEach(() => svc.reset());

/** Crea y publica un evento con un único sector de la capacidad indicada. */
async function publishedSector(capacity: number, priceMinor = 5000) {
  const owner = await svc.newUser();
  const auth = { Authorization: `Bearer ${owner.token}` };
  const created = await api()
    .post('/api/events')
    .set(auth)
    .send(eventBody({ sectors: [{ name: 'Campo', priceMinor, capacity }] }));
  expect(created.status).toBe(201);
  await api().post(`/api/events/${created.body.id}/publish`).set(auth).expect(200);
  return { eventId: created.body.id as string, sectorId: created.body.sectors[0].id as string, owner };
}

const reserve = (body: object) =>
  api().post('/internal/reservations').set('X-Internal-Token', INTERNAL_TOKEN).send(body);
const release = (orderId: string) =>
  api().post(`/internal/reservations/${orderId}/release`).set('X-Internal-Token', INTERNAL_TOKEN);

async function available(sectorId: string) {
  const { rows } = await svc.db.query('SELECT capacity - reserved AS available FROM sectors WHERE id = $1', [sectorId]);
  return Number(rows[0].available);
}

describe('API interna', () => {
  it('exige el token interno; un JWT de cliente no sirve', async () => {
    const customer = await svc.newUser(ROLES.CUSTOMER);
    const body = { orderId: randomUUID(), eventId: randomUUID(), sectorId: randomUUID(), quantity: 1 };

    expect((await api().post('/internal/reservations').send(body)).status).toBe(401);
    const withJwt = await api()
      .post('/internal/reservations')
      .set('Authorization', `Bearer ${customer.token}`)
      .send(body);
    expect(withJwt.status).toBe(401);
    const wrong = await api().post('/internal/reservations').set('X-Internal-Token', 'otro').send(body);
    expect(wrong.status).toBe(401);
  });
});

describe('reservar', () => {
  it('devuelve la reserva con la copia de evento, sector y precio', async () => {
    const { eventId, sectorId, owner } = await publishedSector(10, 7500);
    const orderId = randomUUID();
    const res = await reserve({ orderId, eventId, sectorId, quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({
      orderId,
      eventId,
      sectorId,
      quantity: 3,
      unitPriceMinor: 7500,
      totalMinor: 22500,
      currency: 'USD',
      status: 'active',
      releasedAt: null,
    });
    expect(res.body.event).toMatchObject({ id: eventId, title: 'Concierto de prueba', organizerId: owner.id });
    expect(res.body.sector).toEqual({ id: sectorId, name: 'Campo' });
    expect(await available(sectorId)).toBe(7);

    const get = await api().get(`/internal/reservations/${orderId}`).set('X-Internal-Token', INTERNAL_TOKEN);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(res.body);
  });

  it('valida la cantidad (1 a 6) y los ids', async () => {
    const { eventId, sectorId } = await publishedSector(10);
    for (const quantity of [0, 7, 1.5]) {
      const res = await reserve({ orderId: randomUUID(), eventId, sectorId, quantity });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await reserve({ orderId: 'x', eventId, sectorId, quantity: 1 })).status).toBe(400);

    const missing = await reserve({ orderId: randomUUID(), eventId, sectorId: randomUUID(), quantity: 1 });
    expect(missing.status).toBe(404);
  });

  it('sin cupo suficiente responde SOLD_OUT y no descuenta nada', async () => {
    const { eventId, sectorId } = await publishedSector(2);
    const res = await reserve({ orderId: randomUUID(), eventId, sectorId, quantity: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SOLD_OUT');
    expect(await available(sectorId)).toBe(2);
  });

  it('repetir la misma reserva no descuenta otra vez', async () => {
    const { eventId, sectorId } = await publishedSector(10);
    const body = { orderId: randomUUID(), eventId, sectorId, quantity: 2 };
    const first = await reserve(body);
    const second = await reserve(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await available(sectorId)).toBe(8);

    const changed = await reserve({ ...body, quantity: 3 });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('concurrencia (sin sobreventa)', () => {
  it('dos compras por el último cupo: solo una lo obtiene', async () => {
    const { eventId, sectorId } = await publishedSector(1);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserve({ orderId: randomUUID(), eventId, sectorId, quantity: 1 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'SOLD_OUT')).toHaveLength(9);
    expect(await available(sectorId)).toBe(0);
  });

  it('muchas compras simultáneas nunca superan la capacidad', async () => {
    const capacity = 15;
    const { eventId, sectorId } = await publishedSector(capacity);
    const requests = Array.from({ length: 30 }, (_, i) => ({
      orderId: randomUUID(),
      eventId,
      sectorId,
      quantity: (i % 6) + 1,
    }));
    const results = await Promise.all(requests.map((b) => reserve(b)));

    const sold = results.reduce((sum, r, i) => (r.status === 201 ? sum + requests[i].quantity : sum), 0);
    expect(results.every((r) => r.status === 201 || r.body.error.code === 'SOLD_OUT')).toBe(true);
    expect(sold).toBeLessThanOrEqual(capacity);
    expect(await available(sectorId)).toBe(capacity - sold);
  });

  it('la misma orden enviada en paralelo reserva una sola vez', async () => {
    const { eventId, sectorId } = await publishedSector(10);
    const body = { orderId: randomUUID(), eventId, sectorId, quantity: 4 };
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(body)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.reservation.id)).size).toBe(1);
    expect(await available(sectorId)).toBe(6);
  });
});

describe('liberar', () => {
  it('devuelve exactamente los cupos y repetir no suma otra vez', async () => {
    const { eventId, sectorId } = await publishedSector(5);
    const orderId = randomUUID();
    await reserve({ orderId, eventId, sectorId, quantity: 3 }).expect(201);
    expect(await available(sectorId)).toBe(2);

    const first = await release(orderId);
    expect(first.status).toBe(200);
    expect(first.body.reservation.status).toBe('released');
    expect(first.body.reservation.releasedAt).toBeTruthy();
    expect(await available(sectorId)).toBe(5);

    const again = await release(orderId);
    expect(again.status).toBe(200);
    expect(await available(sectorId)).toBe(5);

    // Una orden liberada no vuelve a reservar con el mismo id.
    const reReserve = await reserve({ orderId, eventId, sectorId, quantity: 3 });
    expect(reReserve.status).toBe(409);
    expect(reReserve.body.error.code).toBe('RESERVATION_RELEASED');
  });

  it('liberaciones simultáneas de la misma orden suman una sola vez', async () => {
    const { eventId, sectorId } = await publishedSector(5);
    const orderId = randomUUID();
    await reserve({ orderId, eventId, sectorId, quantity: 5 }).expect(201);

    const results = await Promise.all(Array.from({ length: 6 }, () => release(orderId)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await available(sectorId)).toBe(5);
  });

  it('liberar una orden sin reserva responde 404', async () => {
    expect((await release(randomUUID())).status).toBe(404);
    expect((await release('no-es-uuid')).status).toBe(404);
  });
});
