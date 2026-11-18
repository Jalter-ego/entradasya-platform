import type { ReservationResponse } from '../clients/eventsClient.js';
import type { TicketIssuePayload } from '../clients/ticketsClient.js';
import {
  ERROR_CODES, type ErrorStep, type NotificationStatus, type OrderStatus, type PaymentStatus,
  type ReservationStatus, type TicketStatus,
} from '../constants/constants.js';
import { transaction, type Db, type Tx } from '../database/database.js';
import type { OrderRow, OrderSelection } from '../types/order.js';
import { AppError } from '../utils/appError.js';

const ORDER_COLUMNS = `
  o.id, o.customer_id, o.customer_email, o.idempotency_key, o.request_hash, o.status,
  o.reservation_status, o.payment_status, o.ticket_status, o.notification_status,
  o.payment_request, o.payment_transaction_id, o.ticket_issue_payload,
  o.last_error_step, o.last_error_code, o.paid_at, o.created_at, o.updated_at,
  i.event_id, i.sector_id, i.quantity, i.organizer_id, i.unit_price_minor, i.currency, i.reservation_snapshot`;

const FROM_ORDERS = 'FROM orders o JOIN order_items i ON i.order_id = o.id';

export interface CreateOrderInput {
  id: string;
  customerId: string;
  customerEmail: string;
  idempotencyKey: string;
  requestHash: string;
  selection: OrderSelection;
}

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async createOrGet(input: CreateOrderInput): Promise<{ created: boolean; order: OrderRow }> {
    const created = await transaction(this.db, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO orders (id, customer_id, customer_email, idempotency_key, request_hash, payment_request)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (customer_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [input.id, input.customerId, input.customerEmail, input.idempotencyKey, input.requestHash,
          JSON.stringify(input.selection.payment)],
      );
      if (inserted.rowCount === 0) return false;
      await tx.query(
        `INSERT INTO order_items (order_id, event_id, sector_id, quantity) VALUES ($1, $2, $3, $4)`,
        [input.id, input.selection.eventId, input.selection.sectorId, input.selection.quantity],
      );
      return true;
    });

    if (created) return { created: true, order: await this.mustFind(input.id) };

    const existing = await this.findByIdempotencyKey(input.customerId, input.idempotencyKey);
    if (!existing) throw new Error('La orden idempotente no se encontró tras el conflicto');
    if (existing.request_hash !== input.requestHash) {
      throw new AppError(409, ERROR_CODES.IDEMPOTENCY_CONFLICT, 'Esa clave de compra ya se usó con otros datos');
    }
    return { created: false, order: existing };
  }

  async findById(id: string, client: Db | Tx = this.db): Promise<OrderRow | null> {
    const { rows } = await client.query<OrderRow>(`SELECT ${ORDER_COLUMNS} ${FROM_ORDERS} WHERE o.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findOwned(id: string, customerId: string): Promise<OrderRow | null> {
    const { rows } = await this.db.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} ${FROM_ORDERS} WHERE o.id = $1 AND o.customer_id = $2`, [id, customerId],
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<OrderRow | null> {
    const { rows } = await this.db.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} ${FROM_ORDERS} WHERE o.customer_id = $1 AND o.idempotency_key = $2`,
      [customerId, idempotencyKey],
    );
    return rows[0] ?? null;
  }

  async listByCustomer(customerId: string, page: number, perPage: number): Promise<{ rows: OrderRow[]; total: number }> {
    const [list, count] = await Promise.all([
      this.db.query<OrderRow>(
        `SELECT ${ORDER_COLUMNS} ${FROM_ORDERS}
         WHERE o.customer_id = $1
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT $2 OFFSET $3`,
        [customerId, perPage, (page - 1) * perPage],
      ),
      this.db.query<{ total: number }>('SELECT count(*)::int AS total FROM orders WHERE customer_id = $1', [customerId]),
    ]);
    return { rows: list.rows, total: count.rows[0]?.total ?? 0 };
  }

  async mustFind(id: string): Promise<OrderRow> {
    const order = await this.findById(id);
    if (!order) throw new Error('La orden no se encontró');
    return order;
  }

  async update(id: string, patch: OrderPatch, clearErrorFor?: ErrorStep): Promise<OrderRow> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    for (const [column, value] of Object.entries(patch)) {
      if (!PATCHABLE_COLUMNS.has(column)) throw new Error(`Columna no actualizable: ${column}`);
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (clearErrorFor) {
      values.push(clearErrorFor);
      const step = `$${values.length}`;
      sets.push(`last_error_step = CASE WHEN last_error_step = ${step} THEN NULL ELSE last_error_step END`);
      sets.push(`last_error_code = CASE WHEN last_error_step = ${step} THEN NULL ELSE last_error_code END`);
    }
    await this.db.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, values);
    return this.mustFind(id);
  }

  async confirmReservation(id: string, reservation: ReservationResponse): Promise<OrderRow> {
    await transaction(this.db, async (tx) => {
      await tx.query(
        `UPDATE order_items
         SET organizer_id = $2, unit_price_minor = $3, currency = $4, reservation_snapshot = $5
         WHERE order_id = $1 AND reservation_snapshot IS NULL`,
        [id, reservation.event.organizerId, reservation.reservation.unitPriceMinor,
          reservation.reservation.currency, JSON.stringify(reservation)],
      );
      await tx.query(
        `UPDATE orders SET reservation_status = 'active', updated_at = now(),
           last_error_code = CASE WHEN last_error_step = 'reservation' THEN NULL ELSE last_error_code END,
           last_error_step = CASE WHEN last_error_step = 'reservation' THEN NULL ELSE last_error_step END
         WHERE id = $1`,
        [id],
      );
    });
    return this.mustFind(id);
  }

  async saveTicketPayload(id: string, payload: TicketIssuePayload): Promise<OrderRow> {
    await this.db.query(
      `UPDATE orders
       SET ticket_issue_payload = COALESCE(ticket_issue_payload, $2), ticket_status = 'pending', updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(payload)],
    );
    return this.mustFind(id);
  }
}

export type OrderPatch = Partial<{
  status: OrderStatus;
  reservation_status: ReservationStatus;
  payment_status: PaymentStatus;
  ticket_status: TicketStatus;
  notification_status: NotificationStatus;
  payment_transaction_id: string;
  paid_at: Date;
  last_error_step: ErrorStep;
  last_error_code: string;
}>;

const PATCHABLE_COLUMNS = new Set([
  'status', 'reservation_status', 'payment_status', 'ticket_status', 'notification_status',
  'payment_transaction_id', 'paid_at', 'last_error_step', 'last_error_code',
]);
