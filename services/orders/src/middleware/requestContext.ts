import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { log } from '../utils/logger.js';

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  const started = performance.now();
  res.on('finish', () => log('info', 'request', {
    requestId: req.requestId, method: req.method, path: req.path,
    status: res.statusCode, ms: Math.round(performance.now() - started),
  }));
  next();
};
