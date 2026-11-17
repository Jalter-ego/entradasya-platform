import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { importSPKI, jwtVerify } from 'jose';
import { z } from 'zod';
import { AppError, type AuthUser } from './errors.js';

export type VerifyToken = (token: string) => Promise<AuthUser>;

export async function createJwtVerifier(options: {
  publicKeyPem: string; issuer: string; audience: string;
}): Promise<VerifyToken> {
  const key = await importSPKI(options.publicKeyPem, 'RS256');
  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'], issuer: options.issuer, audience: options.audience,
      requiredClaims: ['sub', 'exp', 'role'],
    });
    return { id: z.string().uuid().parse(payload.sub), role: z.string().parse(payload.role) };
  };
}

export function requireCustomer(verify: VerifyToken): RequestHandler {
  return async (req, _res, next) => {
    const token = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Falta el token de acceso');
    try { req.user = await verify(token); }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Token inválido o vencido'); }
    if (req.user.role !== 'customer') throw new AppError(403, 'FORBIDDEN', 'Esta operación requiere un cliente');
    next();
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

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
