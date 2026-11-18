import type { RequestHandler } from 'express';
import { ERROR_CODES, type Role } from '../constants/constants.js';
import type { VerifyToken } from '../types/auth.js';
import { AppError } from '../utils/appError.js';

function bearer(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1];
}

/** Exige un JWT válido y uno de los roles indicados; deja el usuario en req.user. */
export function requireRole(verify: VerifyToken, ...roles: Role[]): RequestHandler {
  return async (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Falta el token de acceso');
    try {
      req.user = await verify(token);
    } catch {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Token inválido o vencido');
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, 'No tienes permiso para esta operación');
    }
    next();
  };
}
