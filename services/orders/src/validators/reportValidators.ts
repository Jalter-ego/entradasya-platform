import { z } from 'zod';

export const reportParamsSchema = z.object({
  eventId: z.string().uuid().transform((value) => value.toLowerCase()),
});
