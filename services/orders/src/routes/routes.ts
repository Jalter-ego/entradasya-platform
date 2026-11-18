import { Router } from 'express';
import { ERROR_CODES, SERVICE_NAME } from '../constants/constants.js';
import { checkSchema, type Db } from '../database/database.js';
import { ApiResponse } from '../utils/apiResponse.js';

export interface RouteDeps {
  db: Db;
}

export function createRoutes({ db }: RouteDeps): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await checkSchema(db);
      ApiResponse.ok(res, 'Servicio disponible', { status: 'ok', service: SERVICE_NAME });
    } catch {
      ApiResponse.fail(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Revisa la base de datos y las migraciones');
    }
  });


  return router;
}
