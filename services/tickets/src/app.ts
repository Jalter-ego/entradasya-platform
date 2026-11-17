import express from 'express';
import type { Db } from './db.js';
import { requireCustomer, requireInternal, type VerifyToken } from './http/auth.js';
import { AppError, errorHandler, requestContext } from './http/errors.js';
import { TicketRepository, toTicket } from './tickets/repository.js';
import { issueSchema, listSchema, uuid, validateSchema } from './tickets/validation.js';
import type { TicketPdf } from './tickets/pdf.js';

export interface AppDeps {
  db: Db;
  pdf: TicketPdf;
  verifyToken: VerifyToken;
  internalTokenOrders: string;
  internalTokenCheckin: string;
}

export function createApp(deps: AppDeps) {
  const app = express();
  const repository = new TicketRepository(deps.db);
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestContext);
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', async (req, res) => {
    try {
      await deps.db.query('SELECT 1 FROM ticket_orders o LEFT JOIN tickets t ON t.order_id = o.order_id LIMIT 1');
      await deps.pdf.ready();
      res.json({ status: 'ok', service: 'tickets' });
    } catch {
      res.status(503).json({
        status: 'unavailable', service: 'tickets', requestId: req.requestId,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Revisa la base, las migraciones y el almacenamiento de PDF' },
      });
    }
  });

  app.post('/internal/tickets/issue', requireInternal(deps.internalTokenOrders), async (req, res) => {
    const input = issueSchema.parse(req.body);
    const result = await repository.issue(input);
    // Los registros ya se confirmaron. Si falla un archivo, el reintento reutiliza códigos e IDs.
    await Promise.all(result.records.map((record) => deps.pdf.ensure(record)));
    res.setHeader('cache-control', 'no-store');
    res.status(result.created ? 201 : 200).json({ orderId: input.orderId, items: result.records.map(toTicket) });
  });

  app.post('/internal/tickets/validate', requireInternal(deps.internalTokenCheckin), async (req, res) => {
    const { code, eventId } = validateSchema.parse(req.body);
    const record = await repository.findByCode(code);
    res.setHeader('cache-control', 'no-store');
    if (!record) return res.json({ valid: false, reason: 'INVALID_TICKET' });
    if (record.snapshot.event.id !== eventId) return res.json({ valid: false, reason: 'WRONG_EVENT' });
    res.json({ valid: true, ticket: {
      id: record.id, orderId: record.order_id, customerId: record.customer_id, eventId,
      paymentStatus: 'approved',
    } });
  });

  const publicRoutes = express.Router();
  publicRoutes.use(requireCustomer(deps.verifyToken));
  publicRoutes.use((_req, res, next) => { res.setHeader('cache-control', 'private, no-store'); next(); });
  publicRoutes.get('/me', async (req, res) => {
    const filter = listSchema.parse(req.query);
    const records = await repository.list(req.user!.id, filter);
    res.json({ items: records.map(toTicket), limit: filter.limit, offset: filter.offset });
  });
  publicRoutes.get('/:id/pdf', async (req, res, next) => {
    const id = uuid.parse(req.params.id);
    const record = await repository.findOwned(id, req.user!.id);
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Entrada no encontrada');
    const file = await deps.pdf.ensure(record);
    res.download(file, `entrada-${record.id}.pdf`, (error) => { if (error) next(error); });
  });
  app.use('/api/tickets', publicRoutes);
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada')));
  app.use(errorHandler);
  return app;
}
