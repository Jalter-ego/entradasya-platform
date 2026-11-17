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

interface ReservationView {
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
  event_title: string;
  event_venue: string;
  event_starts_at: Date;
  organizer_id: string;
  sector_name: string;
}

/**
 * Respuesta para orders: la reserva más una copia de los datos del evento y del sector
 * que orders, tickets y notifications necesitan sin volver a consultar a events.
 */
function toDto(r: ReservationView) {
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
    event: {
      id: r.event_id,
      title: r.event_title,
      venue: r.event_venue,
      startsAt: r.event_starts_at.toISOString(),
      organizerId: r.organizer_id,
    },
    sector: { id: r.sector_id, name: r.sector_name },
  };
}

export type ReservationDto = ReturnType<typeof toDto>;

async function findByOrder(db: Queryable, orderId: string): Promise<ReservationView | undefined> {
  const { rows } = await db.query<ReservationView>(
    `SELECT r.*, e.title AS event_title, e.venue AS event_venue, e.starts_at AS event_starts_at,
            e.organizer_id, s.name AS sector_name
     FROM reservations r
     JOIN events e ON e.id = r.event_id
     JOIN sectors s ON s.id = r.sector_id
     WHERE r.order_id = $1`,
    [orderId],
  );
  return rows[0];
}

/** Repetición de una reserva ya existente: misma petición -> misma respuesta. */
function replay(existing: ReservationView, input: ReserveInput) {
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
 * - El descuento es un UPDATE condicional (capacity - reserved >= quantity): dos
 *   compras por el último cupo no pueden ganar ambas. Si no alcanza, ROLLBACK.
 */
export async function reserve(db: Db, input: ReserveInput) {
  const existing = await findByOrder(db, input.orderId);
  if (existing) return replay(existing, input);

  const outcome = await withTransaction(db, async (tx) => {
    // FOR SHARE sobre el evento: una cancelación simultánea espera a que terminemos.
    const { rows } = await tx.query<{
      status: string;
      starts_at: Date;
      currency: string;
      price_minor: number;
    }>(
      `SELECT e.status, e.starts_at, e.currency, s.price_minor
       FROM sectors s JOIN events e ON e.id = s.event_id
       WHERE s.id = $1 AND s.event_id = $2
       FOR SHARE OF e`,
      [input.sectorId, input.eventId],
    );
    const target = rows[0];
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Evento o sector no encontrado');
    if (target.status !== 'published' || target.starts_at.getTime() <= Date.now()) {
      throw new AppError(409, 'EVENT_NOT_AVAILABLE', 'El evento no está a la venta');
    }

    const inserted = await tx.query(
      `INSERT INTO reservations (order_id, event_id, sector_id, quantity, unit_price_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id`,
      [input.orderId, input.eventId, input.sectorId, input.quantity, target.price_minor, target.currency],
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
