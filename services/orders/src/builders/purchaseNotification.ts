import type { PurchaseNotification } from '../clients/notificationsClient.js';
import type { OrderRow } from '../types/order.js';

export function buildPurchaseNotification(order: OrderRow): PurchaseNotification {
  const snapshot = order.reservation_snapshot;
  if (!snapshot || order.unit_price_minor === null || order.currency === null) {
    throw new Error('No se puede notificar sin la reserva confirmada');
  }
  return {
    orderId: order.id,
    to: order.customer_email,
    event: { title: snapshot.event.title, venue: snapshot.event.venue, startsAt: snapshot.event.startsAt },
    sector: { name: snapshot.sector.name },
    quantity: order.quantity,
    totalMinor: order.unit_price_minor * order.quantity,
    currency: order.currency,
  };
}
