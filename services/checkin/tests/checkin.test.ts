import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '../src/http/auth.js';
import { startTestService } from './helpers.js';

describe('checkin service', () => {
  let svc: Awaited<ReturnType<typeof startTestService>>;

  beforeAll(async () => {
    svc = await startTestService();
  });

  afterAll(async () => {
    await svc.stop();
  });

  beforeEach(async () => {
    await svc.reset();
  });

  it('responde /health ok con la base migrada', async () => {
    const res = await request(svc.baseUrl).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'checkin' });
  });

  it('exige JWT válido con rol doorman para registrar ingreso', async () => {
    const eventId = randomUUID();
    const customer = await svc.newUser(ROLES.CUSTOMER);
    const organizer = await svc.newUser(ROLES.ORGANIZER);

    const noAuth = await request(svc.baseUrl).post('/api/checkin').send({ code: 'abc', eventId });
    expect(noAuth.status).toBe(401);

    const asCustomer = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ code: 'abc', eventId });
    expect(asCustomer.status).toBe(403);

    const asOrganizer = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${organizer.token}`)
      .send({ code: 'abc', eventId });
    expect(asOrganizer.status).toBe(403);
  });

  it('autoriza el primer ingreso, incrementa conteo y rechaza el segundo con ALREADY_USED y hora', async () => {
    const eventId = randomUUID();
    const doorman = await svc.newUser(ROLES.DOORMAN);
    const ticket = svc.seedTicket('QR-VALID-001', eventId);

    const first = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'QR-VALID-001', eventId });

    expect(first.status).toBe(201);
    expect(first.body.eventCount).toBe(1);
    expect(first.body.checkin).toMatchObject({
      ticketId: ticket.id,
      eventId,
      doormanId: doorman.id,
    });
    expect(typeof first.body.checkin.checkedInAt).toBe('string');

    const second = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'QR-VALID-001', eventId });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_USED');
    expect(second.body.error.details.checkedInAt).toBe(first.body.checkin.checkedInAt);

    const countRes = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventId}/count`)
      .set('Authorization', `Bearer ${doorman.token}`);
    expect(countRes.status).toBe(200);
    expect(countRes.body).toEqual({ eventId, count: 1 });
  });

  it('garantiza un único ingreso ante 10 escaneos simultáneos del mismo código', async () => {
    const eventId = randomUUID();
    const doorman = await svc.newUser(ROLES.DOORMAN);
    svc.seedTicket('QR-RACE-001', eventId);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(svc.baseUrl)
          .post('/api/checkin')
          .set('Authorization', `Bearer ${doorman.token}`)
          .send({ code: 'QR-RACE-001', eventId }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    const firstTime = created[0].body.checkin.checkedInAt;
    for (const r of rejected) {
      expect(r.body.error.code).toBe('ALREADY_USED');
      expect(r.body.error.details.checkedInAt).toBe(firstTime);
    }

    const countRes = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventId}/count`)
      .set('Authorization', `Bearer ${doorman.token}`);
    expect(countRes.body.count).toBe(1);
  });

  it('rechaza código inexistente (INVALID_TICKET) y de otro evento (WRONG_EVENT) sin insertar', async () => {
    const eventA = randomUUID();
    const eventB = randomUUID();
    const doorman = await svc.newUser(ROLES.DOORMAN);
    svc.seedTicket('QR-EVENTO-A', eventA);

    const missing = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'NO-EXISTE', eventId: eventA });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('INVALID_TICKET');

    const wrongEvent = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'QR-EVENTO-A', eventId: eventB });
    expect(wrongEvent.status).toBe(409);
    expect(wrongEvent.body.error.code).toBe('WRONG_EVENT');

    const countA = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventA}/count`)
      .set('Authorization', `Bearer ${doorman.token}`);
    expect(countA.body.count).toBe(0);
  });

  it('devuelve 503 TICKETS_UNAVAILABLE si tickets está caído o excede el timeout', async () => {
    const eventId = randomUUID();
    const doorman = await svc.newUser(ROLES.DOORMAN);

    svc.setTicketsMode('down');
    const downRes = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'ANY', eventId });
    expect(downRes.status).toBe(503);
    expect(downRes.body.error.code).toBe('TICKETS_UNAVAILABLE');

    svc.setTicketsMode('slow');
    const slowRes = await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'ANY', eventId });
    expect(slowRes.status).toBe(503);
    expect(slowRes.body.error.code).toBe('TICKETS_UNAVAILABLE');
  });

  it('permite consultar conteo e ingresos recientes a doorman y organizer, pero no a customer', async () => {
    const eventId = randomUUID();
    const doorman = await svc.newUser(ROLES.DOORMAN);
    const organizer = await svc.newUser(ROLES.ORGANIZER);
    const customer = await svc.newUser(ROLES.CUSTOMER);

    svc.seedTicket('QR-REC-1', eventId);
    await request(svc.baseUrl)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${doorman.token}`)
      .send({ code: 'QR-REC-1', eventId });

    const orgCount = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventId}/count`)
      .set('Authorization', `Bearer ${organizer.token}`);
    expect(orgCount.status).toBe(200);
    expect(orgCount.body.count).toBe(1);

    const recent = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventId}/recent`)
      .set('Authorization', `Bearer ${doorman.token}`);
    expect(recent.status).toBe(200);
    expect(recent.body.items).toHaveLength(1);

    const custCount = await request(svc.baseUrl)
      .get(`/api/checkin/events/${eventId}/count`)
      .set('Authorization', `Bearer ${customer.token}`);
    expect(custCount.status).toBe(403);
  });
});
