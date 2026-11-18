import type { RequestHandler } from 'express';
import { importSPKI, jwtVerify, type CryptoKey, type KeyObject } from 'jose';
import { z } from 'zod';
import { AppError, type AuthUser } from './errors.js';

export const ROLES = {
  CUSTOMER: 'customer',
  ORGANIZER: 'organizer',
  DOORMAN: 'doorman',
} as const;

export type VerifyToken = (token: string) => Promise<AuthUser>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifica localmente el JWT RS256 emitido por auth sin consultar a otros servicios.
 */
export async function createJwtVerifier(opts: {
  publicKey: string | CryptoKey | KeyObject;
  algorithm?: string;
  issuer: string;
  audience: string;
}): Promise<VerifyToken> {
  const algorithm = opts.algorithm || 'RS256';
  const key =
    typeof opts.publicKey === 'string'
      ? await importSPKI(opts.publicKey, algorithm)
      : opts.publicKey;

  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [algorithm],
      issuer: opts.issuer,
      audience: opts.audience,
      requiredClaims: ['sub', 'exp', 'role'],
    });
    const id = z.string().regex(UUID_RE).parse(payload.sub);
    const role = z.string().min(1).parse(payload.role);
    return {
      id,
      role,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  };
}

function bearer(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1];
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
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para esta operación');
    }
    next();
  };
}
