import type { ReservationResponse } from '../clients/eventsClient.js';
import type { TicketIssuePayload } from '../clients/ticketsClient.js';
import type {
  ErrorStep, NotificationStatus, OrderStatus, PaymentStatus, ReservationStatus, TicketStatus,
} from '../constants/constants.js';

export interface DemoPayment {
  method: 'demo_card';
  last4: '0000' | '1111';
}

/** Selección validada del comprador; nunca incluye precio. */
export interface OrderSelection {
  eventId: string;
  sectorId: string;
  quantity: number;
  payment: DemoPayment;
}

/** Fila de orders + order_items (una línea por orden en v1), tal como la devuelve pg. */
export interface OrderRow {
  id: string;
  customer_id: string;
  customer_email: string;
  idempotency_key: string;
  request_hash: string;
  status: OrderStatus;
  reservation_status: ReservationStatus;
  payment_status: PaymentStatus;
  ticket_status: TicketStatus;
  notification_status: NotificationStatus;
  payment_request: DemoPayment;
  payment_transaction_id: string | null;
  ticket_issue_payload: TicketIssuePayload | null;
  last_error_step: ErrorStep | null;
  last_error_code: string | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
  event_id: string;
  sector_id: string;
  quantity: number;
  organizer_id: string | null;
  unit_price_minor: number | null;
  currency: string | null;
  reservation_snapshot: ReservationResponse | null;
}

/** Orden expuesta por HTTP (contracts/orders.openapi.yaml, schema Order). */
export interface Order {
  id: string;
  status: OrderStatus;
  eventId: string;
  sectorId: string;
  quantity: number;
  unitPriceMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
  event: { id: string; title: string; venue: string; city: string; startsAt: string } | null;
  sector: { id: string; name: string } | null;
  payment: { method: 'demo_card'; last4: string; transactionId: string | null };
  progress: {
    reservation: ReservationStatus;
    payment: PaymentStatus;
    tickets: TicketStatus;
    notification: NotificationStatus;
  };
  lastError: { step: ErrorStep; code: string } | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}
