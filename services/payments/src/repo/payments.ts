import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import { AppError } from '../http/errors.js';

/** Regla fija de demo (docs/database/README.md §6). Cualquier otro valor es 400 en la validación. */
export const DEMO_CARD = {
  METHOD: 'demo_card',
  APPROVE_LAST4: '1111',
  REJECT_LAST4: '0000',
} as const;

export const PAYMENT_REJECTED = 'PAYMENT_REJECTED';

export interface ChargeInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  method: typeof DEMO_CARD.METHOD;
  last4: typeof DEMO_CARD.APPROVE_LAST4 | typeof DEMO_CARD.REJECT_LAST4;
}

export interface Payment {
  transactionId: string;
  orderId: string;
  status: 'approved' | 'rejected';
  amountMinor: number;
  currency: string;
  method: string;
  last4: string;
  rejectionCode: string | null;
  createdAt: string;
}

interface PaymentRow {
  id: string;
  order_id: string;
  amount_minor: string; // bigint llega como texto desde pg
  currency: string;
  method: string;
  demo_last4: string;
  request_hash: string;
  status: 'approved' | 'rejected';
  rejection_code: string | null;
  created_at: Date;
}

/**
 * SHA-256 de importe, moneda y medio ficticio, con orden de claves fijo.
 * orderId no forma parte del hash: es la clave de idempotencia.
 */
export function requestHash(input: ChargeInput): string {
  const normalized = JSON.stringify({
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.method,
    last4: input.last4,
  });
  return createHash('sha256').update(normalized).digest('hex');
}

function toPayment(row: PaymentRow): Payment {
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor)) throw new Error('amount_minor fuera del rango entero seguro');
  return {
    transactionId: row.id,
    orderId: row.order_id,
    status: row.status,
    amountMinor,
    currency: row.currency,
    method: row.method,
    last4: row.demo_last4,
    rejectionCode: row.rejection_code,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Cobra (simula) una orden una sola vez.
 * - Primera vez: guarda el resultado definitivo y devuelve created=true.
 * - Repetición con el mismo cuerpo: devuelve el mismo transactionId y resultado (aprobado o rechazado).
 * - Mismo orderId con otro importe, moneda o medio: 409 IDEMPOTENCY_CONFLICT.
 *
 * INSERT ... ON CONFLICT DO NOTHING deja que PostgreSQL resuelva la carrera: si dos
 * peticiones llegan a la vez, la segunda espera el commit de la primera y luego lee su fila.
 */
export async function charge(db: Db, input: ChargeInput): Promise<{ created: boolean; payment: Payment }> {
  const hash = requestHash(input);
  const approved = input.last4 === DEMO_CARD.APPROVE_LAST4;

  const inserted = await db.query<PaymentRow>(
    `INSERT INTO payments
       (order_id, amount_minor, currency, method, demo_last4, request_hash, status, rejection_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [
      input.orderId,
      input.amountMinor,
      input.currency,
      input.method,
      input.last4,
      hash,
      approved ? 'approved' : 'rejected',
      approved ? null : PAYMENT_REJECTED,
    ],
  );
  if (inserted.rows[0]) return { created: true, payment: toPayment(inserted.rows[0]) };

  const existing = await findRow(db, input.orderId);
  if (!existing) {
    // Solo pasaría si alguien borró la fila entre ambas sentencias; los pagos no se borran.
    throw new AppError(503, 'PAYMENT_UNAVAILABLE', 'No se pudo confirmar el pago; reintentar');
  }
  if (existing.request_hash !== hash) {
    throw new AppError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'La orden ya tiene un pago con otro importe, moneda o medio de pago',
    );
  }
  return { created: false, payment: toPayment(existing) };
}

async function findRow(db: Db, orderId: string): Promise<PaymentRow | undefined> {
  const { rows } = await db.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  return rows[0];
}

export async function getByOrder(db: Db, orderId: string): Promise<Payment | undefined> {
  const row = await findRow(db, orderId);
  return row ? toPayment(row) : undefined;
}
