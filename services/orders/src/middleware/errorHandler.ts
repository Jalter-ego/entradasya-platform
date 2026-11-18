import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../constants/constants.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { AppError } from '../utils/appError.js';
import { log } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof AppError) {
    return ApiResponse.fail(res, error.status, error.code, error.message, error.details);
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ field: issue.path.join('.') || 'body', message: issue.message }));
    return ApiResponse.fail(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Los datos enviados no son válidos', details);
  }
  if (error?.type === 'entity.parse.failed') {
    return ApiResponse.fail(res, 400, ERROR_CODES.INVALID_JSON, 'El cuerpo no es JSON válido');
  }
  if (error?.type === 'entity.too.large') {
    return ApiResponse.fail(res, 413, ERROR_CODES.BODY_TOO_LARGE, 'La petición supera el tamaño permitido');
  }
  log('error', 'request_failed', { requestId: req.requestId, errorType: error?.name || 'Error' });
  return ApiResponse.fail(res, 500, ERROR_CODES.INTERNAL_ERROR, 'No se pudo completar la operación');
};
