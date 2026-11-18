import type { Db } from '../database/database.js';
import type { SectorSalesRow } from '../types/report.js';

export class ReportsRepository {
  constructor(private readonly db: Db) {}

  /** ¿Hay líneas con reserva confirmada de este evento que pertenezcan a OTRO organizador? */
  async belongsToAnotherOrganizer(eventId: string, organizerId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ other: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM order_items
         WHERE event_id = $1 AND organizer_id IS NOT NULL AND organizer_id <> $2
       ) AS other`,
      [eventId, organizerId],
    );
    return rows[0]?.other ?? false;
  }

  /**
   * Ventas por sector, solo órdenes pagadas del organizador. Sumas en bigint.
   * El nombre del sector es el de la copia más reciente (un sector pudo renombrarse entre ventas).
   */
  async salesBySector(eventId: string, organizerId: string): Promise<SectorSalesRow[]> {
    const { rows } = await this.db.query<SectorSalesRow>(
      `SELECT i.sector_id,
              (array_agg(i.reservation_snapshot -> 'sector' ->> 'name' ORDER BY o.paid_at DESC))[1] AS sector_name,
              i.currency,
              count(*)::int AS orders_paid,
              sum(i.quantity)::bigint::text AS tickets_sold,
              sum(i.quantity::bigint * i.unit_price_minor)::text AS revenue_minor
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       WHERE i.event_id = $1 AND i.organizer_id = $2 AND o.status = 'paid'
       GROUP BY i.sector_id, i.currency
       ORDER BY sector_name, i.sector_id`,
      [eventId, organizerId],
    );
    return rows;
  }
}
