import express from 'express';
import type { Db } from './db.js';
import { errorHandler, notFoundHandler, requestContext } from './http/errors.js';
import { internalRouter } from './routes/internal.js';

export interface AppDeps {
  db: Db;
  internalToken: string;
}

export function createApp({ db, internalToken }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(express.json({ limit: '16kb' }));

  // 200 si puede registrar pagos: base accesible y migración aplicada. 503 si no.
  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1 FROM payments LIMIT 0');
      res.json({ status: 'ok', service: 'payments' });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        service: 'payments',
        error: { code: 'DB_UNAVAILABLE', message: 'La base no responde o faltan migraciones' },
        requestId: req.requestId,
      });
    }
  });

  // payments no tiene API pública: todo es /internal y solo para orders.
  app.use('/internal', internalRouter(db, internalToken));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
