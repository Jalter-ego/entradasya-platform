import type { OrderSelection } from '../types/order.js';
import { sha256Hex } from '../utils/hash.js';

/**
 * Hash de la solicitud normalizada: eventId, sectorId, quantity y payment, con orden de claves fijo.
 * No incluye el JWT ni datos variables (hora del reintento), así un reintento legítimo da el mismo hash.
 */
export function buildRequestHash(selection: OrderSelection): string {
  const normalized = [
    selection.eventId.toLowerCase(),
    selection.sectorId.toLowerCase(),
    selection.quantity,
    selection.payment.method,
    selection.payment.last4,
  ];
  return sha256Hex(JSON.stringify(normalized));
}
