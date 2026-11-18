import { z } from 'zod';
import { callService, type RemoteResult, type ServiceEndpoint } from './httpClient.js';

/**
 * PROVISIONAL hasta que P4 publique el contrato de notifications.
 * Basado en el plan §4: destinatario validado (del JWT) y resumen de la compra.
 * notifications arma el enlace a Mis entradas con su PUBLIC_WEB_URL; nunca se envía el JWT.
 */
export interface PurchaseNotification {
  orderId: string;
  to: string;
  event: { title: string; venue: string; startsAt: string };
  sector: { name: string };
  quantity: number;
  totalMinor: number;
  currency: string;
}

export const notificationResponseSchema = z.object({}).passthrough();

export class NotificationsClient {
  constructor(private readonly endpoint: ServiceEndpoint) {}

  sendPurchase(input: PurchaseNotification, requestId: string): Promise<RemoteResult<unknown>> {
    return callService(this.endpoint, {
      method: 'POST', path: '/internal/notifications/purchase', body: input, requestId, schema: notificationResponseSchema,
    });
  }
}
