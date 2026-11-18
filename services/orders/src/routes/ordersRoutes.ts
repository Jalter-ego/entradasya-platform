import { Router } from 'express';
import { ROLES } from '../constants/constants.js';
import type { OrdersController } from '../controllers/ordersController.js';
import { requireRole } from '../middleware/auth.js';
import type { VerifyToken } from '../types/auth.js';

/** Montado en /api/orders. `/me` va antes de `/:id` para no confundirse con un id. */
export function ordersRoutes(controller: OrdersController, verifyToken: VerifyToken): Router {
  const router = Router();
  const customer = requireRole(verifyToken, ROLES.CUSTOMER);

  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'private, no-store');
    next();
  });

  router.post('/', customer, controller.create);
  router.get('/me', customer, controller.listMine);
  router.get('/:id', customer, controller.getById);
  router.post('/:id/retry', customer, controller.retry);

  return router;
}
