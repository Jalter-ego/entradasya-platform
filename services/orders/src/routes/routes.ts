import { Router } from 'express';
import type { Clients } from '../clients/clients.js';
import { ERROR_CODES, SERVICE_NAME } from '../constants/constants.js';
import { OrdersController } from '../controllers/ordersController.js';
import { checkSchema, type Db } from '../database/database.js';
import { OrdersRepository } from '../repositories/ordersRepository.js';
import { OrderProcessor } from '../services/orderProcessor.js';
import { PurchaseService } from '../services/purchaseService.js';
import type { VerifyToken } from '../types/auth.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ordersRoutes } from './ordersRoutes.js';

export interface RouteDeps {
  db: Db;
  verifyToken: VerifyToken;
  clients: Clients;
}

export function createRoutes({ db, verifyToken, clients }: RouteDeps): Router {
  const router = Router();

  const repo = new OrdersRepository(db);
  const purchases = new PurchaseService(repo, new OrderProcessor(db, repo, clients));
  const ordersController = new OrdersController(repo, purchases);

  router.get('/health', async (_req, res) => {
    try {
      await checkSchema(db);
      ApiResponse.ok(res, 'Servicio disponible', { status: 'ok', service: SERVICE_NAME });
    } catch {
      ApiResponse.fail(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Revisa la base de datos y las migraciones');
    }
  });

  router.use('/api/orders', ordersRoutes(ordersController, verifyToken));

  return router;
}
