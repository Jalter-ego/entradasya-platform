import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protege /internal/*: solo orders conoce este token (par orders <-> payments).
 * Un JWT de cliente no sirve aquí. Header: X-Internal-Token: <INTERNAL_TOKEN_ORDERS>
 */
export function requireInternal(expectedToken: string): RequestHandler {
  const expected = digest(expectedToken);
  return (req, _res, next) => {
    const received = req.header('x-internal-token');
    if (!received || !timingSafeEqual(digest(received), expected)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Credencial interna inválida');
    }
    next();
  };
}
