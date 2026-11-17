import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '../src/http/auth.js';
import { eventBody, inDays, INTERNAL_TOKEN, startTestService, type TestService } from './helpers.js';

let svc: TestService;
const api = () => request(svc.baseUrl);

beforeAll(async () => {
  svc = await startTestService();
});
afterAll(() => svc.stop());
beforeEach(() => svc.reset());

async function createEvent(token: string, body = eventBody()) {
  const res = await api().post('/api/events').set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function publish(token: string, id: string) {
  const res = await api().post(`/api/events/${id}/publish`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('health', () => {
  it('responde 200 cuando la base está disponible', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'events' });
  });
});

describe('acceso', () => {
  it('crear un evento exige token de organizador', async () => {
    const anon = await api().post('/api/events').send(eventBody());
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe('UNAUTHORIZED');
    expect(anon.body.requestId).toBeTruthy();

    const customer = await svc.newUser(ROLES.CUSTOMER);
    const res = await api()
      .post('/api/events')
      .set('Authorization', `Bearer ${customer.token}`)
      .send(eventBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rechaza tokens vencidos o de otro emisor', async () => {
    const expired = await svc.sign(ROLES.ORGANIZER, crypto.randomUUID(), { exp: '-1m' });
    const foreign = await svc.sign(ROLES.ORGANIZER, crypto.randomUUID(), { issuer: 'otro' });
    for (const token of [expired, foreign, 'no-es-un-jwt']) {
      const res = await api().get('/api/events/mine').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('un organizador no puede modificar eventos ajenos', async () => {
    const owner = await svc.newUser();
    const other = await svc.newUser();
    const event = await createEvent(owner.token);

    const attempts = [
      api().patch(`/api/events/${event.id}`).send({ title: 'Hackeado' }),
      api().post(`/api/events/${event.id}/publish`),
      api().post(`/api/events/${event.id}/cancel`),
      api().post(`/api/events/${event.id}/sectors`).send({ name: 'X', priceMinor: 1, capacity: 1 }),
    ];
    for (const attempt of attempts) {
      const res = await attempt.set('Authorization', `Bearer ${other.token}`);
      expect(res.status).toBe(403);
    }
    const mine = await api().get('/api/events/mine').set('Authorization', `Bearer ${owner.token}`);
    expect(mine.body.items[0].title).toBe('Concierto de prueba');
    expect(mine.body.items[0].status).toBe('draft');
  });
});

describe('ciclo de vida del evento', () => {
  it('un borrador no aparece en la cartelera ni lo ve otro usuario', async () => {
    const owner = await svc.newUser();
    const event = await createEvent(owner.token);
    expect(event.status).toBe('draft');
    expect(event.currency).toBe('USD');
    expect(event.organizerId).toBe(owner.id);
    expect(event.sectors).toHaveLength(2);

    expect((await api().get('/api/events')).body.items).toHaveLength(0);
    expect((await api().get(`/api/events/${event.id}`)).status).toBe(404);

    const asOwner = await api().get(`/api/events/${event.id}`).set('Authorization', `Bearer ${owner.token}`);
    expect(asOwner.status).toBe(200);
  });

  it('al publicar aparece en la cartelera con los cupos disponibles', async () => {
    const owner = await svc.newUser();
    const event = await createEvent(owner.token);
    await publish(owner.token, event.id);
    await publish(owner.token, event.id); // publicar dos veces no falla

    const list = await api().get('/api/events');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const general = list.body.items[0].sectors.find((s: { name: string }) => s.name === 'General');
    expect(general).toMatchObject({ priceMinor: 5000, capacity: 100, available: 100 });
  });

  it('no publica un evento sin sectores', async () => {
    const owner = await svc.newUser();
    const event = await createEvent(owner.token, eventBody({ sectors: [] }));
    const res = await api().post(`/api/events/${event.id}/publish`).set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_SECTORS');
  });

  it('edita los datos del evento y valida la entrada', async () => {
    const owner = await svc.newUser();
    const event = await createEvent(owner.token);
    const auth = { Authorization: `Bearer ${owner.token}` };

    const ok = await api().patch(`/api/events/${event.id}`).set(auth).send({ title: 'Nuevo título', imageUrl: null });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ title: 'Nuevo título', imageUrl: null, venue: 'Estadio Central' });

    const invalid = [
      { startsAt: inDays(-1) },
      { imageUrl: 'javascript:alert(1)' },
      { title: '' },
      {},
      { status: 'published' }, // el estado solo cambia con publish/cancel
    ];
    for (const body of invalid) {
      const res = await api().patch(`/api/events/${event.id}`).set(auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const badJson = await api()
      .post('/api/events')
      .set(auth)
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('INVALID_JSON');
  });

  it('rechaza sectores con nombre repetido', async () => {
    const owner = await svc.newUser();
    const auth = { Authorization: `Bearer ${owner.token}` };
    const dup = eventBody({
      sectors: [
        { name: 'General', priceMinor: 1, capacity: 1 },
        { name: 'general', priceMinor: 2, capacity: 2 },
      ],
    });
    expect((await api().post('/api/events').set(auth).send(dup)).status).toBe(400);

    const event = await createEvent(owner.token);
    const res = await api()
      .post(`/api/events/${event.id}/sectors`)
      .set(auth)
      .send({ name: 'General', priceMinor: 1, capacity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SECTOR_NAME_TAKEN');
  });

  it('la capacidad no baja de los cupos comprometidos', async () => {
    const owner = await svc.newUser();
    const auth = { Authorization: `Bearer ${owner.token}` };
    const event = await createEvent(owner.token);
    await publish(owner.token, event.id);
    const vip = event.sectors.find((s: { name: string }) => s.name === 'VIP');

    const reserve = await api()
      .post('/internal/reservations')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({ orderId: crypto.randomUUID(), eventId: event.id, sectorId: vip.id, quantity: 4 });
    expect(reserve.status).toBe(201);

    const tooLow = await api().patch(`/api/events/${event.id}/sectors/${vip.id}`).set(auth).send({ capacity: 3 });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.error.code).toBe('CAPACITY_BELOW_COMMITTED');

    const exact = await api()
      .patch(`/api/events/${event.id}/sectors/${vip.id}`)
      .set(auth)
      .send({ capacity: 4, priceMinor: 20000 });
    expect(exact.status).toBe(200);
    const updated = exact.body.sectors.find((s: { id: string }) => s.id === vip.id);
    expect(updated).toMatchObject({ capacity: 4, available: 0, priceMinor: 20000 });

    // Un sector con reservas no se puede borrar.
    const del = await api().delete(`/api/events/${event.id}/sectors/${vip.id}`).set(auth);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('SECTOR_HAS_RESERVATIONS');
  });

  it('un evento cancelado no admite cambios ni reservas', async () => {
    const owner = await svc.newUser();
    const auth = { Authorization: `Bearer ${owner.token}` };
    const event = await createEvent(owner.token);
    await publish(owner.token, event.id);

    const cancel = await api().post(`/api/events/${event.id}/cancel`).set(auth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    expect((await api().get('/api/events')).body.items).toHaveLength(0);
    expect((await api().get(`/api/events/${event.id}`)).body.status).toBe('cancelled');

    const edit = await api().patch(`/api/events/${event.id}`).set(auth).send({ title: 'x' });
    expect(edit.body.error.code).toBe('EVENT_CANCELLED');

    const reserve = await api()
      .post('/internal/reservations')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({ orderId: crypto.randomUUID(), eventId: event.id, sectorId: event.sectors[0].id, quantity: 1 });
    expect(reserve.status).toBe(409);
    expect(reserve.body.error.code).toBe('EVENT_NOT_AVAILABLE');
  });

  it('ids inválidos o inexistentes devuelven 404', async () => {
    expect((await api().get('/api/events/no-es-uuid')).status).toBe(404);
    expect((await api().get(`/api/events/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await api().get('/api/ruta-inexistente')).status).toBe(404);
  });
});
