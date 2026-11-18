import { z } from 'zod';

export const newPassword = z.string().min(8).max(128);

const email = z.string().trim().toLowerCase().max(254).email();

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
}).strict();

export const registerBody = loginBody.extend({
  name: z.string().trim().min(1).max(120).refine((value) => !value.includes('\0')),
  password: newPassword,
});
