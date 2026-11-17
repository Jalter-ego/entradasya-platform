import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { requireInternal } from '../http/auth.js';
import { AppError } from '../http/errors.js';
import { isUuid } from '../repo/events.js';
import * as reservations from '../repo/reservations.js';

const reserveSchema = z.object({
  orderId: z.string().uuid(),
  eventId: z.string().uuid(),
  sectorId: z.string().uuid(),
  quantity: z.number().int().min(1).max(6),
});

function orderIdParam(value: string): string {
  if (!isUuid(value)) throw new AppError(404, 'NOT_FOUND', 'No hay reserva para esa orden');
  return value;
}

/** API interna: solo la usa orders, con X-Internal-Token. Nginx no la publica. */
export function internalRouter(db: Db, internalToken: string): Router {
  const router = Router();
  router.use(requireInternal(internalToken));

  // 201 si se creó; 200 si es la repetición de una reserva ya hecha.
  router.post('/reservations', async (req, res) => {
    const { created, data } = await reservations.reserve(db, reserveSchema.parse(req.body));
    res.status(created ? 201 : 200).json(data);
  });

  // Para que orders confirme el estado tras un timeout.
  router.get('/reservations/:orderId', async (req, res) => {
    res.json(await reservations.getReservation(db, orderIdParam(req.params.orderId)));
  });

  router.post('/reservations/:orderId/release', async (req, res) => {
    res.json(await reservations.release(db, orderIdParam(req.params.orderId)));
  });

  return router;
}
