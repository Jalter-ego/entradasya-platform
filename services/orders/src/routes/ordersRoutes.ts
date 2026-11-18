import { Router } from 'express';
import { ROLES } from '../constants/constants.js';
import type { OrdersController } from '../controllers/ordersController.js';
import type { ReportsController } from '../controllers/reportsController.js';
import { requireRole } from '../middleware/auth.js';
import type { VerifyToken } from '../types/auth.js';

export interface OrdersRouteControllers {
  orders: OrdersController;
  reports: ReportsController;
}

/** Montado en /api/orders. `/me` y `/reports/...` van antes de `/:id` para no confundirse con un id. */
export function ordersRoutes({ orders, reports }: OrdersRouteControllers, verifyToken: VerifyToken): Router {
  const router = Router();
  const customer = requireRole(verifyToken, ROLES.CUSTOMER);
  const organizer = requireRole(verifyToken, ROLES.ORGANIZER);

  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'private, no-store');
    next();
  });

  router.post('/', customer, orders.create);
  router.get('/me', customer, orders.listMine);
  router.get('/reports/events/:eventId', organizer, reports.eventSales);
  router.get('/:id', customer, orders.getById);
  router.post('/:id/retry', customer, orders.retry);

  return router;
}
