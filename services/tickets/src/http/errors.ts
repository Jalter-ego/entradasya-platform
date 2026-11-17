import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { log } from '../logger.js';

export interface AuthUser { id: string; role: string }

declare global {
  namespace Express {
    interface Request { requestId: string; user?: AuthUser }
  }
}

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

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

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'No se pudo completar la operación';
  if (error instanceof AppError) {
    ({ status, code, message } = error);
  } else if (error instanceof ZodError) {
    status = 400; code = 'VALIDATION_ERROR';
    message = error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
  } else if (error?.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'El cuerpo no es JSON válido';
  } else if (error?.type === 'entity.too.large') {
    status = 413; code = 'BODY_TOO_LARGE'; message = 'La petición supera el tamaño permitido';
  } else {
    // No imprimir mensajes de drivers ni cuerpos: pueden contener datos privados.
    log('error', 'request_failed', { requestId: req.requestId, errorType: error?.name || 'Error' });
  }
  res.status(status).json({ error: { code, message }, requestId: req.requestId });
};
