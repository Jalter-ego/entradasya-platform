import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { log } from '../logger.js';

export type ValidateTicketResult =
  | {
      valid: true;
      ticket: {
        id: string;
        orderId: string;
        customerId: string;
        eventId: string;
        paymentStatus: 'approved';
      };
    }
  | {
      valid: false;
      reason: 'INVALID_TICKET' | 'WRONG_EVENT';
    };

export interface TicketsValidator {
  validate(input: { code: string; eventId: string }, requestId?: string): Promise<ValidateTicketResult>;
}

const validateResponseSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    ticket: z.object({
      id: z.string().uuid(),
      orderId: z.string().uuid(),
      customerId: z.string().uuid(),
      eventId: z.string().uuid(),
      paymentStatus: z.literal('approved'),
    }),
  }),
  z.object({
    valid: z.literal(false),
    reason: z.enum(['INVALID_TICKET', 'WRONG_EVENT']),
  }),
]);

export class HttpTicketsValidator implements TicketsValidator {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs: number,
  ) {}

  async validate(input: { code: string; eventId: string }, requestId?: string): Promise<ValidateTicketResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/tickets/validate`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Internal-Token': this.internalToken,
          ...(requestId ? { 'X-Request-Id': requestId } : {}),
        },
        body: JSON.stringify({ code: input.code, eventId: input.eventId }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      log('error', timedOut ? 'tickets_validate_timeout' : 'tickets_validate_network_error', {
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new AppError(
        503,
        'TICKETS_UNAVAILABLE',
        timedOut
          ? 'El servicio de entradas tardó demasiado en responder. Intenta nuevamente.'
          : 'No hay conexión con el servicio de entradas. Intenta nuevamente.',
      );
    }

    if (!response.ok) {
      log('error', 'tickets_validate_http_error', {
        requestId,
        status: response.status,
      });
      if (response.status === 400) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Código o evento inválido');
      }
      throw new AppError(
        503,
        'TICKETS_UNAVAILABLE',
        'El servicio de entradas no pudo validar el código en este momento.',
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      log('error', 'tickets_validate_invalid_json', { requestId });
      throw new AppError(503, 'TICKETS_UNAVAILABLE', 'Respuesta inválida del servicio de entradas.');
    }

    const parsed = validateResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log('error', 'tickets_validate_invalid_schema', { requestId });
      throw new AppError(503, 'TICKETS_UNAVAILABLE', 'Respuesta inesperada del servicio de entradas.');
    }

    return parsed.data;
  }
}
