import { z } from 'zod';

export const uuid = z.string().uuid();

export const issueSchema = z.object({
  orderId: uuid,
  customerId: uuid,
  paymentStatus: z.enum(['approved', 'rejected', 'pending']),
  quantity: z.number().int().min(1).max(6),
  unitPriceMinor: z.number().int().min(0).max(Math.floor(Number.MAX_SAFE_INTEGER / 6)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  event: z.object({
    id: uuid,
    title: z.string().trim().min(1).max(200),
    venue: z.string().trim().min(1).max(200),
    startsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
    organizerId: uuid.optional(),
  }).strict(),
  sector: z.object({ id: uuid, name: z.string().trim().min(1).max(100) }).strict(),
}).strict();

export type IssueInput = z.infer<typeof issueSchema>;

export const validateSchema = z.object({
  code: z.string().trim().min(1).max(128),
  eventId: uuid,
}).strict();

export const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  orderId: uuid.optional(),
}).strict();
