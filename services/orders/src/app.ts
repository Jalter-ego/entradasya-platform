import express from 'express';
import { BODY_LIMIT } from './constants/constants.js';
import type { Db } from './database/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestContext } from './middleware/requestContext.js';
import { createRoutes } from './routes/routes.js';

export interface AppDeps {
  db: Db;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestContext);
  app.use(express.json({ limit: BODY_LIMIT }));

  app.use(createRoutes(deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
