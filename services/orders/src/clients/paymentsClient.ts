import { z } from 'zod';
import { callService, type RemoteResult, type ServiceEndpoint } from './httpClient.js';

/**
 * PROVISIONAL hasta que P4 publique contracts/payments.openapi.yaml.
 * Basado en el plan §4 y docs/database/README.md §6:
 * - POST /internal/payments, idempotente por orderId; un rechazo también es 2xx con status=rejected.
 * - GET /internal/payments/orders/:orderId para confirmar tras un timeout (404 si no existe).
 * - 400 si last4 no es 0000/1111; 409 IDEMPOTENCY_CONFLICT si cambia importe, moneda o medio.
 */
export const paymentResponseSchema = z.object({
  transactionId: z.string().uuid(),
  orderId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  amountMinor: z.number().int().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/),
  rejectionCode: z.string().nullable().optional(),
}).passthrough();

export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

export interface ChargeInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  method: 'demo_card';
  last4: string;
}

export class PaymentsClient {
  constructor(private readonly endpoint: ServiceEndpoint) {}

  charge(input: ChargeInput, requestId: string): Promise<RemoteResult<PaymentResponse>> {
    return callService(this.endpoint, {
      method: 'POST', path: '/internal/payments', body: input, requestId, schema: paymentResponseSchema,
    });
  }

  getByOrder(orderId: string, requestId: string): Promise<RemoteResult<PaymentResponse>> {
    return callService(this.endpoint, {
      method: 'GET', path: `/internal/payments/orders/${orderId}`, requestId, schema: paymentResponseSchema,
    });
  }
}
