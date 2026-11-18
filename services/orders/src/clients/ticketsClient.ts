import { z } from 'zod';
import { callService, type RemoteResult, type ServiceEndpoint } from './httpClient.js';

/**
 * Cuerpo de emisión (contracts/tickets.openapi.yaml y docs/database/README.md §9).
 * tickets rechaza campos extra: no incluir event.city ni nada fuera de esta forma.
 */
export interface TicketIssuePayload {
  orderId: string;
  customerId: string;
  paymentStatus: 'approved';
  quantity: number;
  unitPriceMinor: number;
  currency: string;
  event: { id: string; title: string; venue: string; startsAt: string; organizerId: string };
  sector: { id: string; name: string };
}

export const issueResponseSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({
    id: z.string().uuid(),
    ticketNumber: z.number().int().min(1).max(6),
    pdfUrl: z.string(),
  }).passthrough()).min(1).max(6),
}).passthrough();

export type IssueResponse = z.infer<typeof issueResponseSchema>;

export class TicketsClient {
  constructor(private readonly endpoint: ServiceEndpoint) {}

  /**
   * 201 emitida, 200 repetida con los mismos códigos. 409 IDEMPOTENCY_CONFLICT / UNPAID_ORDER.
   * 503 PDF_UNAVAILABLE: los registros pueden existir; repetir con el MISMO cuerpo.
   */
  issue(payload: TicketIssuePayload, requestId: string): Promise<RemoteResult<IssueResponse>> {
    return callService(this.endpoint, {
      method: 'POST', path: '/internal/tickets/issue', body: payload, requestId, schema: issueResponseSchema,
    });
  }
}
