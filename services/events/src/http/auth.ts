import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { importSPKI, jwtVerify, type CryptoKey, type KeyObject } from 'jose';
import { AppError, type AuthUser } from './errors.js';

export const ROLES = {
  CUSTOMER: 'customer',
  ORGANIZER: 'organizer',
  DOORMAN: 'doorman',
} as const;

export type VerifyToken = (token: string) => Promise<AuthUser>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifica localmente el JWT emitido por auth (firma asimétrica, iss, aud, exp).
 * No consulta al servicio auth.
 */
export async function createJwtVerifier(opts: {
  publicKey: string | CryptoKey | KeyObject;
  algorithm: string;
  issuer: string;
  audience: string;
}): Promise<VerifyToken> {
  const key =
    typeof opts.publicKey === 'string'
      ? await importSPKI(opts.publicKey, opts.algorithm)
      : opts.publicKey;

  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [opts.algorithm],
      issuer: opts.issuer,
      audience: opts.audience,
      requiredClaims: ['sub', 'exp'],
    });
    if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) {
      throw new Error('sub inválido');
    }
    if (typeof payload.role !== 'string') throw new Error('role ausente');
    return {
      id: payload.sub,
      role: payload.role,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  };
}

function bearer(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/** Si llega un token válido completa req.user; si no llega, sigue como anónimo. */
export function optionalAuth(verify: VerifyToken): RequestHandler {
  return async (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token) return next();
    try {
      req.user = await verify(token);
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o vencido');
    }
    next();
  };
}

export function requireRole(verify: VerifyToken, ...roles: string[]): RequestHandler {
  return async (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Falta el token de acceso');
    try {
      req.user = await verify(token);
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o vencido');
    }
    if (roles.length && !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para esta operación');
    }
    next();
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protege /internal/*: solo orders conoce este token. Un JWT de cliente no sirve aquí.
 * Header: X-Internal-Token: <INTERNAL_TOKEN_ORDERS>
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
