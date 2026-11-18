import { ERROR_CODES } from '../constants/constants.js';
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

  /**
   * Crea la orden y su línea en una sola transacción, o devuelve la existente para la misma
   * (customer_id, idempotency_key). Un hash distinto es 409 IDEMPOTENCY_CONFLICT.
   * Dos peticiones simultáneas con la misma clave: ON CONFLICT espera a la otra y solo una crea.
   */
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

  /** Una orden de otro comprador se trata como inexistente. */
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

  /** Mis compras, de la más reciente a la más antigua (usa el índice customer_id, created_at DESC). */
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

  private async mustFind(id: string): Promise<OrderRow> {
    const order = await this.findById(id);
    if (!order) throw new Error('La orden recién creada no se encontró');
    return order;
  }
}
