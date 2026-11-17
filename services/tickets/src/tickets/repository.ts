import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { transaction, type Db } from '../db.js';
import { AppError } from '../http/errors.js';
import type { IssueInput } from './validation.js';

export interface TicketRecord extends QueryResultRow {
  id: string;
  order_id: string;
  ticket_number: number;
  code: string;
  created_at: Date;
  customer_id: string;
  snapshot: IssueInput;
}

const selectTicket = `SELECT t.*, o.customer_id, o.snapshot
  FROM tickets t JOIN ticket_orders o ON o.order_id = t.order_id`;

export function toTicket(record: TicketRecord) {
  return {
    id: record.id,
    orderId: record.order_id,
    customerId: record.customer_id,
    ticketNumber: record.ticket_number,
    quantity: record.snapshot.quantity,
    code: record.code,
    event: record.snapshot.event,
    sector: record.snapshot.sector,
    unitPriceMinor: record.snapshot.unitPriceMinor,
    currency: record.snapshot.currency,
    paymentStatus: 'approved' as const,
    pdfUrl: `/api/tickets/${record.id}/pdf`,
    createdAt: record.created_at.toISOString(),
  };
}

export class TicketRepository {
  constructor(private readonly db: Db) {}

  async issue(input: IssueInput): Promise<{ created: boolean; records: TicketRecord[] }> {
    if (input.paymentStatus !== 'approved') {
      throw new AppError(409, 'UNPAID_ORDER', 'Solo se emiten entradas de un pago aprobado');
    }
    const snapshot = JSON.stringify(input);
    const hash = createHash('sha256').update(snapshot).digest('hex');
    return transaction(this.db, async (tx) => {
      // La clave primaria serializa también dos primeras emisiones concurrentes.
      const inserted = await tx.query(
        `INSERT INTO ticket_orders (order_id, customer_id, payment_status, payload_hash, snapshot)
         VALUES ($1, $2, 'approved', $3, $4::jsonb)
         ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
        [input.orderId, input.customerId, hash, snapshot],
      );
      const previous = await tx.query<{ payload_hash: string }>(
        'SELECT payload_hash FROM ticket_orders WHERE order_id = $1 FOR UPDATE', [input.orderId],
      );
      if (previous.rows[0].payload_hash !== hash) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Esta orden ya tiene una emisión con otros datos');
      }
      if (inserted.rowCount) {
        for (let number = 1; number <= input.quantity; number++) {
          await tx.query(
            'INSERT INTO tickets (id, order_id, ticket_number, code) VALUES ($1, $2, $3, $4)',
            [randomUUID(), input.orderId, number, randomBytes(32).toString('base64url')],
          );
        }
      }
      const { rows } = await tx.query<TicketRecord>(
        `${selectTicket} WHERE t.order_id = $1 ORDER BY t.ticket_number`, [input.orderId],
      );
      return { created: Boolean(inserted.rowCount), records: rows };
    });
  }

  async list(customerId: string, filter: { limit: number; offset: number; orderId?: string }) {
    const { rows } = await this.db.query<TicketRecord>(
      `${selectTicket} WHERE o.customer_id = $1 AND ($2::uuid IS NULL OR t.order_id = $2)
       ORDER BY t.created_at DESC, t.id LIMIT $3 OFFSET $4`,
      [customerId, filter.orderId || null, filter.limit, filter.offset],
    );
    return rows;
  }

  async findOwned(ticketId: string, customerId: string) {
    const { rows } = await this.db.query<TicketRecord>(
      `${selectTicket} WHERE t.id = $1 AND o.customer_id = $2`, [ticketId, customerId],
    );
    return rows[0];
  }

  async findByCode(code: string) {
    const { rows } = await this.db.query<TicketRecord>(`${selectTicket} WHERE t.code = $1`, [code]);
    return rows[0];
  }
}
