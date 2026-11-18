import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

export const ORGANIZER_ID = '00000000-0000-4000-8000-000000000001';
export const SLOW_MS = 800;

type Modes = {
  events: 'ok' | 'timeout-once' | 'down';
  release: 'ok' | 'fail-once';
  payments: 'ok' | 'timeout-once' | 'down';
  tickets: 'ok' | 'fail-once';
  notifications: 'ok' | 'down' | 'timeout';
};

interface SectorConfig { eventId: string; name: string; priceMinor: number; capacity: number; organizerId: string }

/**
 * Dobles de events, payments, tickets y notifications con el comportamiento de sus contratos:
 * idempotencia por orderId, rechazo por cupo, pago 0000/1111, emisión y correo.
 * `mode` permite simular timeouts y caídas; `calls` y los registros permiten afirmar efectos.
 */
export async function startFakeServices() {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const mode: Modes = { events: 'ok', release: 'ok', payments: 'ok', tickets: 'ok', notifications: 'ok' };
  const calls = { reserve: 0, release: 0, charge: 0, issue: 0, notify: 0 };
  const sectors = new Map<string, SectorConfig & { reserved: number }>();
  const reservations = new Map<string, any>();
  const payments = new Map<string, any>();
  const issueBodies: any[] = [];
  const chargeBodies: any[] = [];
  const notifications: any[] = [];

  const app = express();
  app.use(express.json());

  app.post('/internal/reservations', async (req, res) => {
    calls.reserve++;
    if (mode.events === 'down') return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } });
    const b = req.body;
    if (!reservations.has(b.orderId)) {
      const sector = sectors.get(b.sectorId);
      if (!sector || sector.eventId !== b.eventId) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Evento o sector no encontrado' } });
      if (sector.capacity - sector.reserved < b.quantity) return res.status(409).json({ error: { code: 'SOLD_OUT', message: 'No quedan cupos suficientes en el sector' } });
      sector.reserved += b.quantity;
      reservations.set(b.orderId, {
        reservation: {
          id: randomUUID(), orderId: b.orderId, eventId: b.eventId, sectorId: b.sectorId, quantity: b.quantity,
          unitPriceMinor: sector.priceMinor, totalMinor: sector.priceMinor * b.quantity, currency: 'BOB',
          status: 'active', createdAt: new Date().toISOString(), releasedAt: null,
        },
        event: { id: b.eventId, title: 'Noche de Rock', venue: 'Estadio Central', city: 'La Paz', startsAt: '2026-12-20T23:00:00.000Z', organizerId: sector.organizerId },
        sector: { id: b.sectorId, name: sector.name },
      });
    }
    if (mode.events === 'timeout-once') { mode.events = 'ok'; await sleep(SLOW_MS); }
    res.status(201).json(reservations.get(b.orderId));
  });

  app.post('/internal/reservations/:orderId/release', (req, res) => {
    calls.release++;
    if (mode.release === 'fail-once') { mode.release = 'ok'; return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }); }
    const r = reservations.get(req.params.orderId);
    if (!r) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'x' } });
    if (r.reservation.status === 'active') {
      r.reservation.status = 'released';
      sectors.get(r.reservation.sectorId)!.reserved -= r.reservation.quantity;
    }
    res.json(r);
  });

  app.post('/internal/payments', async (req, res) => {
    calls.charge++;
    chargeBodies.push(req.body);
    if (mode.payments === 'down') return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } });
    const b = req.body;
    if (!payments.has(b.orderId)) {
      const rejected = b.last4 === '0000';
      payments.set(b.orderId, {
        transactionId: randomUUID(), orderId: b.orderId, status: rejected ? 'rejected' : 'approved',
        amountMinor: b.amountMinor, currency: b.currency, rejectionCode: rejected ? 'PAYMENT_REJECTED' : null,
      });
    }
    if (mode.payments === 'timeout-once') { mode.payments = 'ok'; await sleep(SLOW_MS); }
    res.status(201).json(payments.get(b.orderId));
  });

  app.post('/internal/tickets/issue', (req, res) => {
    calls.issue++;
    issueBodies.push(req.body);
    if (mode.tickets === 'fail-once') { mode.tickets = 'ok'; return res.status(503).json({ error: { code: 'PDF_UNAVAILABLE', message: 'x' } }); }
    res.status(201).json({
      orderId: req.body.orderId,
      items: Array.from({ length: req.body.quantity }, (_, i) => ({ id: randomUUID(), ticketNumber: i + 1, pdfUrl: '/api/tickets/x/pdf' })),
    });
  });

  app.post('/internal/notifications/purchase', async (req, res) => {
    calls.notify++;
    if (mode.notifications === 'down') return res.status(503).json({ error: { code: 'SMTP_UNAVAILABLE', message: 'x' } });
    if (mode.notifications === 'timeout') await sleep(SLOW_MS);
    notifications.push(req.body);
    res.status(202).json({ status: 'sent' });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    mode, calls, reservations, payments, issueBodies, chargeBodies, notifications,
    /** Registra un sector a la venta y devuelve sus IDs. */
    addSector(options: Partial<SectorConfig> = {}) {
      const sectorId = randomUUID();
      const config = {
        eventId: options.eventId ?? randomUUID(), name: options.name ?? 'General', priceMinor: options.priceMinor ?? 5000,
        capacity: options.capacity ?? 100, organizerId: options.organizerId ?? ORGANIZER_ID,
      };
      sectors.set(sectorId, { ...config, reserved: 0 });
      return { eventId: config.eventId, sectorId };
    },
    reserved(sectorId: string) { return sectors.get(sectorId)!.reserved; },
    reset() {
      Object.assign(mode, { events: 'ok', release: 'ok', payments: 'ok', tickets: 'ok', notifications: 'ok' });
      for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
      for (const list of [issueBodies, chargeBodies, notifications]) list.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeServices = Awaited<ReturnType<typeof startFakeServices>>;
