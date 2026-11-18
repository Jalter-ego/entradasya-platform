import type { RequestHandler } from 'express';
import { ERROR_CODES } from '../constants/constants.js';
import { AppError } from '../utils/appError.js';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, ERROR_CODES.NOT_FOUND, 'Ruta no encontrada'));
};
