import express from 'express';
import type { TicketsValidator } from './clients/tickets.js';
import type { Db } from './db.js';
import type { VerifyToken } from './http/auth.js';
import { errorHandler, notFoundHandler, requestContext } from './http/errors.js';
import { checkinRouter } from './routes/checkin.js';

export interface AppDeps {
  db: Db;
  ticketsValidator: TicketsValidator;
  verifyToken: VerifyToken;
}

export function createApp({ db, ticketsValidator, verifyToken }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestContext);
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1 FROM checkins LIMIT 1');
      res.json({ status: 'ok', service: 'checkin' });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        service: 'checkin',
        error: { code: 'DB_UNAVAILABLE', message: 'La base de datos o sus migraciones no están disponibles' },
        requestId: req.requestId,
      });
    }
  });

  // Nginx conserva el prefijo /api.
  app.use('/api/checkin', checkinRouter(db, ticketsValidator, verifyToken));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
