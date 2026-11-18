import { z } from 'zod';
import { DEMO_PAYMENT, MAX_TICKETS_PER_ORDER, PAGINATION } from '../constants/constants.js';

const uuid = z.string().uuid().transform((value) => value.toLowerCase());

/** Cuerpo de POST /api/orders. `.strict()`: el navegador no puede mandar precio, total ni comprador. */
export const createOrderSchema = z.object({
  eventId: uuid,
  sectorId: uuid,
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
  payment: z.object({
    method: z.literal(DEMO_PAYMENT.METHOD),
    last4: z.enum([DEMO_PAYMENT.REJECT_LAST4, DEMO_PAYMENT.APPROVE_LAST4]),
  }).strict(),
}).strict();

export const idempotencyKeySchema = z.string({ required_error: 'Falta el header Idempotency-Key' })
  .min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'Solo letras, números y . _ : -');

export const orderIdSchema = uuid;

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(PAGINATION.maxPerPage).default(PAGINATION.defaultPerPage),
}).strict();
