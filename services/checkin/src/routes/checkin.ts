import { Router } from 'express';
import { z } from 'zod';
import type { TicketsValidator } from '../clients/tickets.js';
import type { Db } from '../db.js';
import { ROLES, requireRole, type VerifyToken } from '../http/auth.js';
import { AppError } from '../http/errors.js';
import { log } from '../logger.js';
import { CheckinRepository } from '../repo/checkins.js';

const checkinBodySchema = z
  .object({
    code: z.string().trim().min(1, 'Ingresa el código de la entrada').max(128),
    eventId: z.string().uuid('El evento seleccionado no es válido'),
  })
  .strict();

const uuidParamSchema = z.string().uuid('Identificador de evento inválido');

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function checkinRouter(db: Db, ticketsValidator: TicketsValidator, verifyToken: VerifyToken): Router {
  const router = Router();
  const repo = new CheckinRepository(db);

  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'private, no-store');
    next();
  });

  router.post('/', requireRole(verifyToken, ROLES.DOORMAN), async (req, res) => {
    const { code, eventId } = checkinBodySchema.parse(req.body);
    const doormanId = req.user!.id;

    const validation = await ticketsValidator.validate({ code, eventId }, req.requestId);

    if (!validation.valid) {
      log('info', 'checkin_rejected', {
        requestId: req.requestId,
        eventId,
        doormanId,
        reason: validation.reason,
      });
      if (validation.reason === 'WRONG_EVENT') {
        throw new AppError(409, 'WRONG_EVENT', 'Esta entrada pertenece a otro evento');
      }
      throw new AppError(404, 'INVALID_TICKET', 'El código de entrada no es válido o no existe');
    }

    if (validation.ticket.eventId !== eventId) {
      log('warn', 'checkin_event_mismatch', { requestId: req.requestId, eventId, ticketEventId: validation.ticket.eventId });
      throw new AppError(409, 'WRONG_EVENT', 'Esta entrada pertenece a otro evento');
    }

    const result = await repo.register({
      ticketId: validation.ticket.id,
      eventId,
      doormanId,
    });

    if (!result.created) {
      log('info', 'checkin_already_used', {
        requestId: req.requestId,
        eventId,
        ticketId: validation.ticket.id,
        firstCheckedInAt: result.record.checkedInAt,
      });
      throw new AppError(
        409,
        'ALREADY_USED',
        `Esta entrada ya fue utilizada el ${result.record.checkedInAt}`,
        {
          checkedInAt: result.record.checkedInAt,
          firstEventId: result.record.eventId,
          ticketId: result.record.ticketId,
        },
      );
    }

    const eventCount = await repo.countByEvent(eventId);
    log('info', 'checkin_authorized', {
      requestId: req.requestId,
      checkinId: result.record.id,
      ticketId: result.record.ticketId,
      eventId,
      doormanId,
      eventCount,
    });

    res.status(201).json({
      checkin: result.record,
      eventCount,
    });
  });

  router.get(
    '/events/:eventId/count',
    requireRole(verifyToken, ROLES.DOORMAN, ROLES.ORGANIZER),
    async (req, res) => {
      const eventId = uuidParamSchema.parse(req.params.eventId);
      const count = await repo.countByEvent(eventId);
      res.json({ eventId, count });
    },
  );

  router.get(
    '/events/:eventId/recent',
    requireRole(verifyToken, ROLES.DOORMAN, ROLES.ORGANIZER),
    async (req, res) => {
      const eventId = uuidParamSchema.parse(req.params.eventId);
      const { limit } = recentQuerySchema.parse(req.query);
      const items = await repo.listRecentByEvent(eventId, limit);
      res.json({ eventId, items });
    },
  );

  return router;
}
