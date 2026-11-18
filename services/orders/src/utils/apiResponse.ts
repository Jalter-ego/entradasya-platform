import type { Response } from 'express';
import type { ErrorCode } from '../constants/constants.js';
import type { PaginationMeta } from '../builders/paginationMeta.js';
import type { ErrorDetail } from './appError.js';


export interface ApiBody<T> {
  success: boolean;
  message: string;
  data: T | null;
  error?: { code: ErrorCode; message: string; details?: ErrorDetail[] };
  errors?: null;
  meta: PaginationMeta | null;
  requestId: string;
}

function send<T>(res: Response, status: number, body: Omit<ApiBody<T>, 'requestId'>): Response {
  return res.status(status).json({ ...body, requestId: res.req.requestId } satisfies ApiBody<T>);
}

export const ApiResponse = {
  ok<T>(res: Response, message: string, data: T, meta: PaginationMeta | null = null): Response {
    return send(res, 200, { success: true, message, data, errors: null, meta });
  },

  created<T>(res: Response, message: string, data: T): Response {
    return send(res, 201, { success: true, message, data, errors: null, meta: null });
  },

  fail(res: Response, status: number, code: ErrorCode, message: string, details: ErrorDetail[] = []): Response {
    return send(res, status, {
      success: false,
      message,
      data: null,
      error: details.length ? { code, message, details } : { code, message },
      meta: null,
    });
  },
};
