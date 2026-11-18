import type { TicketIssuePayload } from '../clients/ticketsClient.js';
import type { OrderRow } from '../types/order.js';


export function buildTicketIssuePayload(order: OrderRow): TicketIssuePayload {
  const snapshot = order.reservation_snapshot;
  if (!snapshot) throw new Error('No se puede emitir sin la reserva confirmada');
  return {
    orderId: order.id,
    customerId: order.customer_id,
    paymentStatus: 'approved',
    quantity: snapshot.reservation.quantity,
    unitPriceMinor: snapshot.reservation.unitPriceMinor,
    currency: snapshot.reservation.currency,
    event: {
      id: snapshot.event.id,
      title: snapshot.event.title,
      venue: snapshot.event.venue,
      startsAt: snapshot.event.startsAt,
      organizerId: snapshot.event.organizerId,
    },
    sector: {
      id: snapshot.sector.id,
      name: snapshot.sector.name,
    },
  };
}
