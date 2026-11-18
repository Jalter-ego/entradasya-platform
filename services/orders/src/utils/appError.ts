import type { ErrorCode } from '../constants/constants.js';

export interface ErrorDetail {
  field: string;
  message: string;
}

/** Error esperado: se lanza desde rutas o lógica y el errorHandler lo convierte en respuesta. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}
