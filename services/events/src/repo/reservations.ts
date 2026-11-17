import type pg from 'pg';
import { withTransaction, type Db } from '../db.js';
import { AppError } from '../http/errors.js';

type Queryable = Pick<pg.Pool, 'query'>;

export interface ReserveInput {
  orderId: string;
  eventId: string;
  sectorId: string;
  quantity: number;
}

/** Copia del evento y del sector fijada al reservar (columna reservations.snapshot). */
export interface ReservationSnapshot {
  event: {
    id: string;
    title: string;
    venue: string;
    city: string;
    startsAt: string;
    organizerId: string;
  };
  sector: { id: string; name: string };
}

interface ReservationRow {
  id: string;
  order_id: string;
  event_id: string;
  sector_id: string;
  quantity: number;
  unit_price_minor: number;
  currency: string;
  status: 'active' | 'released';
  created_at: Date;
  released_at: Date | null;
  snapshot: ReservationSnapshot;
}

/**
 * Respuesta para orders: la reserva más la copia de evento y sector guardada al reservar.
 * Esa copia no cambia aunque luego se edite el evento, así orders y tickets pueden
 * reintentar con los mismos datos sin volver a consultar a events.
 */
function toDto(r: ReservationRow) {
  return {
    reservation: {
      id: r.id,
      orderId: r.order_id,
      eventId: r.event_id,
      sectorId: r.sector_id,
      quantity: r.quantity,
      unitPriceMinor: r.unit_price_minor,
      totalMinor: r.unit_price_minor * r.quantity,
      currency: r.currency,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      releasedAt: r.released_at?.toISOString() ?? null,
    },
    event: { ...r.snapshot.event },
    sector: { ...r.snapshot.sector },
  };
}

export type ReservationDto = ReturnType<typeof toDto>;

async function findByOrder(db: Queryable, orderId: string): Promise<ReservationRow | undefined> {
  const { rows } = await db.query<ReservationRow>(`SELECT * FROM reservations WHERE order_id = $1`, [orderId]);
  return rows[0];
}

/** Repetición de una reserva ya existente: misma petición -> misma respuesta. */
function replay(existing: ReservationRow, input: ReserveInput) {
  const same =
    existing.event_id === input.eventId &&
    existing.sector_id === input.sectorId &&
    existing.quantity === input.quantity;
  if (!same) {
    throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'La orden ya tiene una reserva con otros datos');
  }
  if (existing.status === 'released') {
    throw new AppError(409, 'RESERVATION_RELEASED', 'La reserva de esta orden ya fue liberada');
  }
  return { created: false, data: toDto(existing) };
}

/**
 * Reserva cupos de forma atómica e idempotente por orderId.
 *
 * - La fila de la reserva se inserta primero: la unicidad de order_id hace que dos
 *   pedidos simultáneos de la misma orden se esperen, y solo uno descuenta cupo.
 * - El evento y el sector se leen bloqueados y su copia (snapshot) se guarda en la misma
 *   transacción: una edición simultánea del sector espera, y precio y nombre son coherentes.
 * - El descuento es un UPDATE condicional (capacity - reserved >= quantity): dos
 *   compras por el último cupo no pueden ganar ambas. Si no alcanza, ROLLBACK.
 */
export async function reserve(db: Db, input: ReserveInput) {
  const existing = await findByOrder(db, input.orderId);
  if (existing) return replay(existing, input);

  const outcome = await withTransaction(db, async (tx) => {
    // Orden de bloqueo: primero el evento y después el sector, igual que al borrar un sector,
    // para que dos transacciones no se esperen mutuamente.
    // FOR SHARE sobre el evento: una cancelación o edición simultánea espera a que terminemos.
    const { rows: events } = await tx.query<{
      status: string;
      starts_at: Date;
      currency: string;
      title: string;
      venue: string;
      city: string;
      organizer_id: string;
    }>(
      `SELECT e.status, e.starts_at, e.currency, e.title, e.venue, e.city, e.organizer_id
       FROM events e
       WHERE e.id = $2 AND EXISTS (SELECT 1 FROM sectors s WHERE s.id = $1 AND s.event_id = e.id)
       FOR SHARE`,
      [input.sectorId, input.eventId],
    );
    const event = events[0];
    if (!event) throw new AppError(404, 'NOT_FOUND', 'Evento o sector no encontrado');
    if (event.status !== 'published' || event.starts_at.getTime() <= Date.now()) {
      throw new AppError(409, 'EVENT_NOT_AVAILABLE', 'El evento no está a la venta');
    }

    // FOR NO KEY UPDATE sobre el sector: una edición de precio o nombre espera, así el precio
    // y el nombre guardados en la reserva son coherentes entre sí.
    const { rows: sectors } = await tx.query<{ name: string; price_minor: number }>(
      `SELECT name, price_minor FROM sectors WHERE id = $1 AND event_id = $2 FOR NO KEY UPDATE`,
      [input.sectorId, input.eventId],
    );
    const sector = sectors[0];
    if (!sector) throw new AppError(404, 'NOT_FOUND', 'Evento o sector no encontrado');

    const snapshot: ReservationSnapshot = {
      event: {
        id: input.eventId,
        title: event.title,
        venue: event.venue,
        city: event.city,
        startsAt: event.starts_at.toISOString(),
        organizerId: event.organizer_id,
      },
      sector: { id: input.sectorId, name: sector.name },
    };

    const inserted = await tx.query(
      `INSERT INTO reservations (order_id, event_id, sector_id, quantity, unit_price_minor, currency, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id`,
      [input.orderId, input.eventId, input.sectorId, input.quantity, sector.price_minor, event.currency, snapshot],
    );
    if (inserted.rowCount === 0) return 'race' as const; // otra petición de la misma orden ganó

    const taken = await tx.query(
      `UPDATE sectors SET reserved = reserved + $2, updated_at = now()
       WHERE id = $1 AND capacity - reserved >= $2`,
      [input.sectorId, input.quantity],
    );
    if (taken.rowCount === 0) {
      throw new AppError(409, 'SOLD_OUT', 'No quedan cupos suficientes en el sector');
    }
    return 'created' as const;
  });

  const saved = await findByOrder(db, input.orderId);
  if (!saved) throw new Error('reserva no encontrada después de crearla');
  if (outcome === 'race') return replay(saved, input);
  return { created: true, data: toDto(saved) };
}

export async function getReservation(db: Db, orderId: string) {
  const found = await findByOrder(db, orderId);
  if (!found) throw new AppError(404, 'NOT_FOUND', 'No hay reserva para esa orden');
  return toDto(found);
}

/**
 * Libera la reserva y devuelve los cupos. Idempotente: si ya estaba liberada,
 * responde igual y no suma cupos otra vez (la fila queda bloqueada con FOR UPDATE).
 */
export async function release(db: Db, orderId: string) {
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ sector_id: string; quantity: number; status: string }>(
      `SELECT sector_id, quantity, status FROM reservations WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    const r = rows[0];
    if (!r) throw new AppError(404, 'NOT_FOUND', 'No hay reserva para esa orden');
    if (r.status === 'released') return;
    await tx.query(
      `UPDATE reservations SET status = 'released', released_at = now() WHERE order_id = $1`,
      [orderId],
    );
    await tx.query(
      `UPDATE sectors SET reserved = reserved - $2, updated_at = now() WHERE id = $1`,
      [r.sector_id, r.quantity],
    );
  });
  return getReservation(db, orderId);
}
