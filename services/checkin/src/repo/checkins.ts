import type { Db } from '../db.js';

export interface CheckinRecord {
  id: string;
  ticketId: string;
  eventId: string;
  doormanId: string;
  checkedInAt: string;
}

interface CheckinRow {
  id: string;
  ticket_id: string;
  event_id: string;
  doorman_id: string;
  checked_in_at: Date | string;
}

function toRecord(row: CheckinRow): CheckinRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventId: row.event_id,
    doormanId: row.doorman_id,
    checkedInAt: row.checked_in_at instanceof Date ? row.checked_in_at.toISOString() : new Date(row.checked_in_at).toISOString(),
  };
}

export class CheckinRepository {
  constructor(private readonly db: Db) {}

  /**
   * Inserta un único ingreso por ticket_id.
   * Si ya existe (incluso por carrera concurrente), lee el registro confirmado tras esperar el commit.
   */
  async register(input: {
    ticketId: string;
    eventId: string;
    doormanId: string;
  }): Promise<{ created: boolean; record: CheckinRecord }> {
    const inserted = await this.db.query<CheckinRow>(
      `INSERT INTO checkins (ticket_id, event_id, doorman_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (ticket_id) DO NOTHING
       RETURNING id, ticket_id, event_id, doorman_id, checked_in_at`,
      [input.ticketId, input.eventId, input.doormanId],
    );

    if (inserted.rows.length === 1) {
      return { created: true, record: toRecord(inserted.rows[0]) };
    }

    const existing = await this.db.query<CheckinRow>(
      `SELECT id, ticket_id, event_id, doorman_id, checked_in_at
       FROM checkins
       WHERE ticket_id = $1`,
      [input.ticketId],
    );

    if (existing.rows.length === 0) {
      throw new Error('Inconsistencia al consultar el ingreso existente');
    }

    return { created: false, record: toRecord(existing.rows[0]) };
  }

  async countByEvent(eventId: string): Promise<number> {
    const res = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM checkins WHERE event_id = $1`,
      [eventId],
    );
    return res.rows[0]?.count ?? 0;
  }

  async listRecentByEvent(eventId: string, limit = 20): Promise<CheckinRecord[]> {
    const res = await this.db.query<CheckinRow>(
      `SELECT id, ticket_id, event_id, doorman_id, checked_in_at
       FROM checkins
       WHERE event_id = $1
       ORDER BY checked_in_at DESC
       LIMIT $2`,
      [eventId, limit],
    );
    return res.rows.map(toRecord);
  }
}
