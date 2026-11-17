import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ROLES, optionalAuth, requireRole, type VerifyToken } from '../http/auth.js';
import { AppError } from '../http/errors.js';
import * as repo from '../repo/events.js';

const MAX_PRICE_MINOR = 100_000_000;
const MAX_CAPACITY = 100_000;

const sectorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR),
  capacity: z.number().int().min(1).max(MAX_CAPACITY),
});

const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now(), 'la fecha debe ser futura');

const imageUrl = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), 'la imagen debe ser una URL http(s)');

const eventFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  venue: z.string().trim().min(1).max(200),
  startsAt: futureDate,
  imageUrl: imageUrl.nullable(),
};

const createEventSchema = z.object({
  ...eventFields,
  description: eventFields.description.default(''),
  imageUrl: eventFields.imageUrl.optional().transform((v) => v ?? null),
  sectors: z.array(sectorSchema).max(20).default([]),
});

const patchEventSchema = z
  .object(eventFields)
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'envía al menos un campo');

const patchSectorSchema = sectorSchema
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'envía al menos un campo');

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function eventsRouter(db: Db, verify: VerifyToken, currency: string): Router {
  const router = Router();
  const organizer = requireRole(verify, ROLES.ORGANIZER);

  // Cartelera pública: solo eventos publicados.
  router.get('/', async (req, res) => {
    const { limit, offset } = listQuery.parse(req.query);
    res.json({ items: await repo.listPublished(db, limit, offset), limit, offset });
  });

  // Eventos del organizador autenticado, incluidos borradores y cancelados.
  router.get('/mine', organizer, async (req, res) => {
    res.json({ items: await repo.listByOrganizer(db, req.user!.id) });
  });

  router.get('/:id', optionalAuth(verify), async (req, res) => {
    res.json(await repo.getVisible(db, String(req.params.id), req.user));
  });

  router.post('/', organizer, async (req, res) => {
    const input = createEventSchema.parse(req.body);
    const names = input.sectors.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'sectors: los nombres de sector deben ser distintos');
    }
    res.status(201).json(await repo.createEvent(db, req.user!, input, currency));
  });

  router.patch('/:id', organizer, async (req, res) => {
    res.json(await repo.updateEvent(db, req.user!, String(req.params.id), patchEventSchema.parse(req.body)));
  });

  router.post('/:id/publish', organizer, async (req, res) => {
    res.json(await repo.publishEvent(db, req.user!, String(req.params.id)));
  });

  router.post('/:id/cancel', organizer, async (req, res) => {
    res.json(await repo.cancelEvent(db, req.user!, String(req.params.id)));
  });

  router.post('/:id/sectors', organizer, async (req, res) => {
    const input = sectorSchema.parse(req.body);
    res.status(201).json(await repo.addSector(db, req.user!, String(req.params.id), input));
  });

  router.patch('/:id/sectors/:sectorId', organizer, async (req, res) => {
    const patch = patchSectorSchema.parse(req.body);
    res.json(await repo.updateSector(db, req.user!, String(req.params.id), String(req.params.sectorId), patch));
  });

  router.delete('/:id/sectors/:sectorId', organizer, async (req, res) => {
    res.json(await repo.deleteSector(db, req.user!, String(req.params.id), String(req.params.sectorId)));
  });

  return router;
}
