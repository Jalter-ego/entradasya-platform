import { z } from 'zod';
import { callService, type RemoteResult, type ServiceEndpoint } from './httpClient.js';

const uuid = z.string().uuid();

/** Respuesta de events (contracts/events.openapi.yaml, schema Reservation). Se conservan campos extra. */
export const reservationResponseSchema = z.object({
  reservation: z.object({
    id: uuid,
    orderId: uuid,
    eventId: uuid,
    sectorId: uuid,
    quantity: z.number().int().min(1).max(6),
    unitPriceMinor: z.number().int().min(0),
    totalMinor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['active', 'released']),
    createdAt: z.string(),
    releasedAt: z.string().nullable(),
  }).passthrough(),
  event: z.object({
    id: uuid,
    title: z.string(),
    venue: z.string(),
    city: z.string(),
    startsAt: z.string(),
    organizerId: uuid,
  }).passthrough(),
  sector: z.object({
    id: uuid,
    name: z.string(),
  }).passthrough(),
}).passthrough();

export type ReservationResponse = z.infer<typeof reservationResponseSchema>;

export interface ReserveInput {
  orderId: string;
  eventId: string;
  sectorId: string;
  quantity: number;
}

export class EventsClient {
  constructor(private readonly endpoint: ServiceEndpoint) {}

  /** 201 nueva, 200 repetida. 409 SOLD_OUT / EVENT_NOT_AVAILABLE / IDEMPOTENCY_CONFLICT / RESERVATION_RELEASED; 404 NOT_FOUND. */
  reserve(input: ReserveInput, requestId: string): Promise<RemoteResult<ReservationResponse>> {
    return callService(this.endpoint, {
      method: 'POST', path: '/internal/reservations', body: input, requestId, schema: reservationResponseSchema,
    });
  }

  /** Para confirmar una reserva tras un timeout. 404 NOT_FOUND si nunca se creó. */
  getReservation(orderId: string, requestId: string): Promise<RemoteResult<ReservationResponse>> {
    return callService(this.endpoint, {
      method: 'GET', path: `/internal/reservations/${orderId}`, requestId, schema: reservationResponseSchema,
    });
  }

  /** Idempotente: repetirla no devuelve cupos dos veces. */
  release(orderId: string, requestId: string): Promise<RemoteResult<ReservationResponse>> {
    return callService(this.endpoint, {
      method: 'POST', path: `/internal/reservations/${orderId}/release`, requestId, schema: reservationResponseSchema,
    });
  }
}
