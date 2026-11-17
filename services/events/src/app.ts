import express from 'express';
import type { Db } from './db.js';
import type { VerifyToken } from './http/auth.js';
import { errorHandler, notFoundHandler, requestContext } from './http/errors.js';
import { eventsRouter } from './routes/events.js';
import { internalRouter } from './routes/internal.js';

export interface AppDeps {
  db: Db;
  verifyToken: VerifyToken;
  internalToken: string;
  currency: string;
}

export function createApp({ db, verifyToken, internalToken, currency }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestContext);
  app.use(express.json({ limit: '100kb' }));

  // 200 si puede atender (incluye su base); 503 si la base no responde.
  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', service: 'events' });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        service: 'events',
        error: { code: 'DB_UNAVAILABLE', message: 'La base de datos no responde' },
        requestId: req.requestId,
      });
    }
  });

  // Nginx conserva el prefijo /api (proxy_pass sin barra final).
  app.use('/api/events', eventsRouter(db, verifyToken, currency));
  app.use('/internal', internalRouter(db, internalToken));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
