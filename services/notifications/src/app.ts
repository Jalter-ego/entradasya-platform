import express from 'express';
import type { Mailer } from './email/mailer.js';
import { errorHandler, notFoundHandler, requestContext } from './http/errors.js';
import { internalRouter } from './routes/internal.js';

export interface AppDeps {
  mailer: Mailer;
  internalToken: string;
  publicWebUrl: string;
  timezone: string;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(express.json({ limit: '16kb' }));

  // notifications no tiene base: su dependencia indispensable es el servidor SMTP (Mailpit).
  app.get('/health', async (req, res) => {
    try {
      await deps.mailer.verify();
      res.json({ status: 'ok', service: 'notifications' });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        service: 'notifications',
        error: { code: 'SMTP_UNAVAILABLE', message: 'El servidor SMTP no responde' },
        requestId: req.requestId,
      });
    }
  });

  // Sin API pública: todo es /internal y solo para orders.
  app.use('/internal', internalRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
