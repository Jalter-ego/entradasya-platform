import type { Order, OrderRow } from '../types/order.js';

export function toOrder(row: OrderRow): Order {
  const snapshot = row.reservation_snapshot;
  return {
    id: row.id,
    status: row.status,
    eventId: row.event_id,
    sectorId: row.sector_id,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    totalMinor: row.unit_price_minor === null ? null : row.unit_price_minor * row.quantity,
    currency: row.currency,
    event: snapshot
      ? {
          id: snapshot.event.id,
          title: snapshot.event.title,
          venue: snapshot.event.venue,
          city: snapshot.event.city,
          startsAt: snapshot.event.startsAt,
        }
      : null,
    sector: snapshot ? { id: snapshot.sector.id, name: snapshot.sector.name } : null,
    payment: {
      method: row.payment_request.method,
      last4: row.payment_request.last4,
      transactionId: row.payment_transaction_id,
    },
    progress: {
      reservation: row.reservation_status,
      payment: row.payment_status,
      tickets: row.ticket_status,
      notification: row.notification_status,
    },
    lastError: row.last_error_step ? { step: row.last_error_step, code: row.last_error_code ?? '' } : null,
    paidAt: row.paid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
