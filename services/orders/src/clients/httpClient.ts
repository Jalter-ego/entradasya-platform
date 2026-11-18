import type { ZodType, ZodTypeDef } from 'zod';
import { INTERNAL_TOKEN_HEADER, REMOTE_UNAVAILABLE } from '../constants/constants.js';
import { log } from '../utils/logger.js';

/**
 * Resultado de una llamada interna:
 * - ok: 2xx con un cuerpo válido.
 * - rejected: 4xx; el servicio decidió y respondió un código de negocio (SOLD_OUT, IDEMPOTENCY_CONFLICT...).
 * - unavailable: timeout, red, 5xx o respuesta inválida. El efecto remoto es DESCONOCIDO:
 *   no asumir que falló; consultar o repetir idempotentemente.
 */
export type RemoteResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'rejected'; status: number; code: string; message: string }
  | { kind: 'unavailable'; status: number | null; code: string };

export interface ServiceEndpoint {
  name: string;
  url: string;
  token: string;
  timeoutMs: number;
}

export interface CallOptions<T> {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  requestId: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  timeoutMs?: number;
}

function errorFields(body: unknown, status: number): { code: string; message: string } {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return {
    code: typeof error?.code === 'string' ? error.code : `HTTP_${status}`,
    message: typeof error?.message === 'string' ? error.message : '',
  };
}

export async function callService<T>(endpoint: ServiceEndpoint, options: CallOptions<T>): Promise<RemoteResult<T>> {
  const started = performance.now();
  const result = await send(endpoint, options);
  log(result.kind === 'ok' ? 'info' : 'warn', 'remote_call', {
    requestId: options.requestId,
    service: endpoint.name,
    method: options.method,
    path: options.path,
    status: result.status,
    outcome: result.kind,
    code: result.kind === 'ok' ? undefined : result.code,
    ms: Math.round(performance.now() - started),
  });
  return result;
}

async function send<T>(endpoint: ServiceEndpoint, options: CallOptions<T>): Promise<RemoteResult<T>> {
  let response: Response;
  try {
    response = await fetch(new URL(options.path, endpoint.url), {
      method: options.method,
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        [INTERNAL_TOKEN_HEADER]: endpoint.token,
        'x-request-id': options.requestId,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? endpoint.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return { kind: 'unavailable', status: null, code: timedOut ? REMOTE_UNAVAILABLE.TIMEOUT : REMOTE_UNAVAILABLE.NETWORK_ERROR };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { kind: 'unavailable', status: response.status, code: REMOTE_UNAVAILABLE.TIMEOUT };
    }
    if (response.ok) return { kind: 'unavailable', status: response.status, code: REMOTE_UNAVAILABLE.INVALID_RESPONSE };
  }

  if (response.ok) {
    const parsed = options.schema.safeParse(body);
    return parsed.success
      ? { kind: 'ok', status: response.status, data: parsed.data }
      : { kind: 'unavailable', status: response.status, code: REMOTE_UNAVAILABLE.INVALID_RESPONSE };
  }
  const { code, message } = errorFields(body, response.status);
  if (response.status >= 400 && response.status < 500) {
    return { kind: 'rejected', status: response.status, code, message };
  }
  return { kind: 'unavailable', status: response.status, code };
}
