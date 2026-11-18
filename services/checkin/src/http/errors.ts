import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { log } from '../logger.js';

export interface AuthUser {
  id: string;
  role: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
    }
  }
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  const started = performance.now();
  res.on('finish', () => {
    log('info', 'request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    });
  });
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'No se pudo completar la operación';
  let details: Record<string, unknown> | undefined;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = err.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'El cuerpo no es JSON válido';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'BODY_TOO_LARGE';
    message = 'La petición supera el tamaño permitido';
  } else {
    log('error', 'request_failed', {
      requestId: req.requestId,
      errorType: err instanceof Error ? err.name : 'Error',
    });
  }

  const errorPayload: Record<string, unknown> = { code, message };
  if (details) errorPayload.details = details;
  res.status(status).json({ error: errorPayload, requestId: req.requestId });
};
