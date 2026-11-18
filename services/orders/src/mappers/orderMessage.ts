import { ORDER_STATUS, TICKET_STATUS } from '../constants/constants.js';
import type { OrderRow } from '../types/order.js';

const REJECTION_MESSAGES: Record<string, string> = {
  SOLD_OUT: 'No quedan cupos suficientes en el sector',
  EVENT_NOT_AVAILABLE: 'El evento no está a la venta',
  EVENT_NOT_FOUND: 'Evento o sector no encontrado',
  PAYMENT_REJECTED: 'El pago fue rechazado',
};

export function toOrderMessage(order: OrderRow): string {
  if (order.status === ORDER_STATUS.PAID) {
    return order.ticket_status === TICKET_STATUS.ISSUED
      ? 'Compra realizada'
      : 'Compra pagada; tus entradas se están emitiendo';
  }
  if (order.status === ORDER_STATUS.REJECTED) {
    return REJECTION_MESSAGES[order.last_error_code ?? ''] ?? 'La compra no se pudo completar';
  }
  if (order.status === ORDER_STATUS.CANCELLED) return 'Compra cancelada';
  return 'La compra está en proceso; consulta su estado o reintenta';
}
