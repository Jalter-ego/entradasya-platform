import type pg from 'pg';
import { PG, pgCode, withTransaction, type Db, type Tx } from '../db.js';
import { AppError, notFound, type AuthUser } from '../http/errors.js';

type Queryable = Pick<pg.Pool, 'query'>;

export type EventStatus = 'draft' | 'published' | 'cancelled';

interface EventRow {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  starts_at: Date;
  image_url: string | null;
  currency: string;
  status: EventStatus;
  created_at: Date;
  updated_at: Date;
}

interface SectorRow {
  id: string;
  event_id: string;
  name: string;
  price_minor: number;
  capacity: number;
  reserved: number;
}

export interface SectorInput {
  name: string;
  priceMinor: number;
  capacity: number;
}

export interface EventInput {
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  startsAt: Date;
  imageUrl: string | null;
}

function toSectorDto(s: SectorRow) {
  return {
    id: s.id,
    name: s.name,
    priceMinor: s.price_minor,
    capacity: s.capacity,
    available: s.capacity - s.reserved,
  };
}

function toEventDto(e: EventRow, sectors: SectorRow[]) {
  return {
    id: e.id,
    organizerId: e.organizer_id,
    title: e.title,
    description: e.description,
    venue: e.venue,
    city: e.city,
    category: e.category,
    startsAt: e.starts_at.toISOString(),
    imageUrl: e.image_url,
    currency: e.currency,
    status: e.status,
    createdAt: e.created_at.toISOString(),
    updatedAt: e.updated_at.toISOString(),
    sectors: sectors.map(toSectorDto),
  };
}

export type EventDto = ReturnType<typeof toEventDto>;

async function withSectors(db: Queryable, events: EventRow[]): Promise<EventDto[]> {
  if (events.length === 0) return [];
  const { rows } = await db.query<SectorRow>(
    `SELECT * FROM sectors WHERE event_id = ANY($1::uuid[]) ORDER BY price_minor, name`,
    [events.map((e) => e.id)],
  );
  return events.map((e) => toEventDto(e, rows.filter((s) => s.event_id === e.id)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

// ---------------------------------------------------------------- lecturas

export interface PublicFilters {
  limit: number;
  offset: number;
  category?: string;
  city?: string;
  /** Por defecto solo eventos que todavía no comenzaron. */
  includePast?: boolean;
}

export async function listPublished(db: Db, f: PublicFilters) {
  const { rows } = await db.query<EventRow>(
    `SELECT * FROM events
     WHERE status = 'published'
       AND ($3::text IS NULL OR category = $3)
       AND ($4::text IS NULL OR city = $4)
       AND ($5::boolean OR starts_at > now())
     ORDER BY starts_at, id LIMIT $1 OFFSET $2`,
    [f.limit, f.offset, f.category ?? null, f.city ?? null, f.includePast ?? false],
  );
  return withSectors(db, rows);
}

export async function listByOrganizer(db: Db, organizerId: string) {
  const { rows } = await db.query<EventRow>(
    `SELECT * FROM events WHERE organizer_id = $1 ORDER BY starts_at DESC, id`,
    [organizerId],
  );
  return withSectors(db, rows);
}

/** Detalle: publicados y cancelados son visibles para todos; borradores solo para su dueño. */
export async function getVisible(db: Db, id: string, viewer?: AuthUser) {
  if (!isUuid(id)) throw notFound('Evento');
  const { rows } = await db.query<EventRow>(`SELECT * FROM events WHERE id = $1`, [id]);
  const event = rows[0];
  if (!event || (event.status === 'draft' && event.organizer_id !== viewer?.id)) {
    throw notFound('Evento');
  }
  const [dto] = await withSectors(db, [event]);
  return dto;
}

async function getById(db: Queryable, id: string) {
  const { rows } = await db.query<EventRow>(`SELECT * FROM events WHERE id = $1`, [id]);
  const [dto] = await withSectors(db, rows);
  return dto;
}

/**
 * Carga el evento comprobando que pertenece al organizador.
 * forUpdate bloquea la fila hasta el fin de la transacción.
 */
async function loadOwned(tx: Tx, id: string, user: AuthUser, forUpdate = false) {
  if (!isUuid(id)) throw notFound('Evento');
  const { rows } = await tx.query<EventRow>(
    `SELECT * FROM events WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  const event = rows[0];
  if (!event) throw notFound('Evento');
  if (event.organizer_id !== user.id) {
    throw new AppError(403, 'FORBIDDEN', 'Solo el organizador del evento puede modificarlo');
  }
  return event;
}

function assertNotCancelled(event: EventRow) {
  if (event.status === 'cancelled') {
    throw new AppError(409, 'EVENT_CANCELLED', 'El evento está cancelado y no admite cambios');
  }
}

function mapSectorErrors(err: unknown): never {
  if (pgCode(err) === PG.UNIQUE_VIOLATION) {
    throw new AppError(409, 'SECTOR_NAME_TAKEN', 'Ya existe un sector con ese nombre en el evento');
  }
  throw err;
}

// ---------------------------------------------------------------- escrituras

export async function createEvent(
  db: Db,
  user: AuthUser,
  input: EventInput & { sectors: SectorInput[] },
  currency: string,
) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO events (organizer_id, title, description, venue, city, category, starts_at, image_url, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        user.id,
        input.title,
        input.description,
        input.venue,
        input.city,
        input.category,
        input.startsAt,
        input.imageUrl,
        currency,
      ],
    );
    const eventId = rows[0].id;
    for (const s of input.sectors) {
      await tx
        .query(
          `INSERT INTO sectors (event_id, name, price_minor, capacity) VALUES ($1, $2, $3, $4)`,
          [eventId, s.name, s.priceMinor, s.capacity],
        )
        .catch(mapSectorErrors);
    }
    return getById(tx, eventId);
  });
}

const EVENT_COLUMNS: Record<keyof EventInput, string> = {
  title: 'title',
  description: 'description',
  venue: 'venue',
  city: 'city',
  category: 'category',
  startsAt: 'starts_at',
  imageUrl: 'image_url',
};

export async function updateEvent(db: Db, user: AuthUser, id: string, patch: Partial<EventInput>) {
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, id, user, true);
    assertNotCancelled(event);
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof EventInput, unknown][];
    const sets = entries.map(([k], i) => `${EVENT_COLUMNS[k]} = $${i + 2}`);
    await tx.query(
      `UPDATE events SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1`,
      [id, ...entries.map(([, v]) => v)],
    );
    return getById(tx, id);
  });
}

export async function publishEvent(db: Db, user: AuthUser, id: string) {
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, id, user, true);
    assertNotCancelled(event);
    if (event.status === 'draft') {
      const { rows } = await tx.query(`SELECT 1 FROM sectors WHERE event_id = $1 LIMIT 1`, [id]);
      if (rows.length === 0) {
        throw new AppError(409, 'NO_SECTORS', 'El evento necesita al menos un sector para publicarse');
      }
      if (event.starts_at.getTime() <= Date.now()) {
        throw new AppError(409, 'EVENT_IN_PAST', 'No se puede publicar un evento que ya comenzó');
      }
      await tx.query(`UPDATE events SET status = 'published', updated_at = now() WHERE id = $1`, [id]);
    }
    return getById(tx, id);
  });
}

/**
 * Cancela el evento. Bloquea la fila: una reserva en curso termina antes,
 * y las siguientes ya ven el estado cancelado y se rechazan.
 */
export async function cancelEvent(db: Db, user: AuthUser, id: string) {
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, id, user, true);
    if (event.status !== 'cancelled') {
      await tx.query(`UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    }
    return getById(tx, id);
  });
}

export async function addSector(db: Db, user: AuthUser, eventId: string, input: SectorInput) {
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, eventId, user);
    assertNotCancelled(event);
    await tx
      .query(`INSERT INTO sectors (event_id, name, price_minor, capacity) VALUES ($1, $2, $3, $4)`, [
        eventId,
        input.name,
        input.priceMinor,
        input.capacity,
      ])
      .catch(mapSectorErrors);
    return getById(tx, eventId);
  });
}

/**
 * Edita un sector. La capacidad nunca baja del cupo ya comprometido: la condición
 * va en el mismo UPDATE, que bloquea la fila frente a reservas simultáneas.
 */
export async function updateSector(
  db: Db,
  user: AuthUser,
  eventId: string,
  sectorId: string,
  patch: Partial<SectorInput>,
) {
  if (!isUuid(sectorId)) throw notFound('Sector');
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, eventId, user);
    assertNotCancelled(event);
    const { rows } = await tx
      .query<SectorRow & { fits: boolean }>(
        `UPDATE sectors SET
           name        = COALESCE($3, name),
           price_minor = COALESCE($4, price_minor),
           capacity    = CASE WHEN $5::int IS NULL OR $5::int >= reserved THEN COALESCE($5, capacity) ELSE capacity END,
           updated_at  = now()
         WHERE id = $1 AND event_id = $2
         RETURNING *, ($5::int IS NULL OR $5::int >= reserved) AS fits`,
        [sectorId, eventId, patch.name ?? null, patch.priceMinor ?? null, patch.capacity ?? null],
      )
      .catch(mapSectorErrors);
    const sector = rows[0];
    if (!sector) throw notFound('Sector');
    if (!sector.fits) {
      throw new AppError(
        409,
        'CAPACITY_BELOW_COMMITTED',
        `La capacidad no puede ser menor a los ${sector.reserved} cupos ya comprometidos`,
      );
    }
    return getById(tx, eventId);
  });
}

export async function deleteSector(db: Db, user: AuthUser, eventId: string, sectorId: string) {
  if (!isUuid(sectorId)) throw notFound('Sector');
  return withTransaction(db, async (tx) => {
    const event = await loadOwned(tx, eventId, user, true);
    assertNotCancelled(event);
    const { rows: sectors } = await tx.query<{ id: string }>(
      `SELECT id FROM sectors WHERE event_id = $1`,
      [eventId],
    );
    if (!sectors.some((s) => s.id === sectorId)) throw notFound('Sector');
    if (event.status === 'published' && sectors.length === 1) {
      throw new AppError(409, 'LAST_SECTOR', 'Un evento publicado debe conservar al menos un sector');
    }
    try {
      await tx.query(`DELETE FROM sectors WHERE id = $1`, [sectorId]);
    } catch (err) {
      if (pgCode(err) === PG.FOREIGN_KEY_VIOLATION) {
        throw new AppError(409, 'SECTOR_HAS_RESERVATIONS', 'El sector ya tiene reservas y no se puede borrar');
      }
      throw err;
    }
    return getById(tx, eventId);
  });
}
