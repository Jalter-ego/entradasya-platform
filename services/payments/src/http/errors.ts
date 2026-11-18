import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { log } from '../logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Asigna un requestId (o reutiliza el que manda orders) y registra cada petición. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    log('info', 'request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
    });
  });
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, 'NOT_FOUND', 'Ruta no encontrada'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Error interno';

  if (err instanceof AppError) {
    ({ status, code, message } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = err.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'El cuerpo no es JSON válido';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'BODY_TOO_LARGE';
    message = 'El cuerpo es demasiado grande';
  } else {
    log('error', 'unhandled error', {
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  res.status(status).json({ error: { code, message }, requestId: req.requestId });
};
