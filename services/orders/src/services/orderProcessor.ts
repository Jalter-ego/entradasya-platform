import { buildPurchaseNotification } from '../builders/purchaseNotification.js';
import { buildTicketIssuePayload } from '../builders/ticketIssuePayload.js';
import type { Clients } from '../clients/clients.js';
import type { ReservationResponse } from '../clients/eventsClient.js';
import type { RemoteResult } from '../clients/httpClient.js';
import type { PaymentResponse } from '../clients/paymentsClient.js';
import {
  ERROR_CODES, ERROR_STEP, NOTIFICATION_STATUS, ORDER_STATUS, PAYMENT_STATUS, PROGRESS_ERRORS,
  REMOTE_UNAVAILABLE, RESERVATION_REJECTIONS, RESERVATION_STATUS, TICKET_STATUS, type ErrorStep,
} from '../constants/constants.js';
import type { Db } from '../database/database.js';
import { withOrderLock } from '../database/orderLock.js';
import type { OrdersRepository } from '../repositories/ordersRepository.js';
import type { OrderRow } from '../types/order.js';
import { log } from '../utils/logger.js';


export class OrderProcessor {
  constructor(
    private readonly db: Db,
    private readonly repo: OrdersRepository,
    private readonly clients: Clients,
  ) {}

  async process(orderId: string, requestId: string): Promise<OrderRow> {
    const outcome = await withOrderLock(this.db, orderId, () => this.run(orderId, requestId));
    if (!outcome.acquired) {
      log('warn', 'order_busy', { requestId, orderId });
      return this.repo.mustFind(orderId);
    }
    return outcome.result;
  }

  private async run(orderId: string, requestId: string): Promise<OrderRow> {
    let order = await this.repo.mustFind(orderId);
    order = await this.reserve(order, requestId);
    order = await this.charge(order, requestId);
    order = await this.release(order, requestId);
    order = await this.issueTickets(order, requestId);
    order = await this.notify(order, requestId);
    return order;
  }

  private async reserve(order: OrderRow, requestId: string): Promise<OrderRow> {
    const pending = order.status === ORDER_STATUS.PENDING
      && (order.reservation_status === RESERVATION_STATUS.NOT_STARTED || order.reservation_status === RESERVATION_STATUS.PENDING);
    if (!pending) return order;

    order = await this.repo.update(order.id, { reservation_status: RESERVATION_STATUS.PENDING });
    const result = await this.clients.events.reserve(
      { orderId: order.id, eventId: order.event_id, sectorId: order.sector_id, quantity: order.quantity }, requestId,
    );

    if (result.kind === 'ok') {
      if (!reservationMatches(order, result.data)) {
        return this.stepError(order, ERROR_STEP.RESERVATION, PROGRESS_ERRORS.RESERVATION_MISMATCH, requestId);
      }
      this.trace(order, requestId, 'reservation_active');
      return this.repo.confirmReservation(order.id, result.data);
    }

    if (result.kind === 'rejected' && RESERVATION_REJECTIONS[result.code]) {
      const code = RESERVATION_REJECTIONS[result.code];
      this.trace(order, requestId, 'order_rejected', code);
      return this.repo.update(order.id, {
        status: ORDER_STATUS.REJECTED,
        reservation_status: result.code === 'RESERVATION_RELEASED' ? RESERVATION_STATUS.RELEASED : RESERVATION_STATUS.FAILED,
        last_error_step: ERROR_STEP.RESERVATION,
        last_error_code: code,
      });
    }

    return this.stepError(order, ERROR_STEP.RESERVATION, result.code, requestId);
  }

  private async charge(order: OrderRow, requestId: string): Promise<OrderRow> {
    const pending = order.status === ORDER_STATUS.PENDING
      && order.reservation_status === RESERVATION_STATUS.ACTIVE
      && (order.payment_status === PAYMENT_STATUS.NOT_STARTED
        || order.payment_status === PAYMENT_STATUS.PENDING
        || order.payment_status === PAYMENT_STATUS.UNKNOWN);
    if (!pending) return order;

    const amountMinor = order.unit_price_minor! * order.quantity;
    if (!Number.isSafeInteger(amountMinor)) {
      return this.stepError(order, ERROR_STEP.PAYMENT, PROGRESS_ERRORS.AMOUNT_OUT_OF_RANGE, requestId);
    }

    if (order.payment_status === PAYMENT_STATUS.NOT_STARTED) {
      order = await this.repo.update(order.id, { payment_status: PAYMENT_STATUS.PENDING });
    }
    const result: RemoteResult<PaymentResponse> = await this.clients.payments.charge({
      orderId: order.id,
      amountMinor,
      currency: order.currency!,
      method: order.payment_request.method,
      last4: order.payment_request.last4,
    }, requestId);

    if (result.kind === 'ok') {
      const payment = result.data;
      if (payment.orderId !== order.id || payment.amountMinor !== amountMinor || payment.currency !== order.currency) {
        return this.paymentUnknown(order, PROGRESS_ERRORS.PAYMENT_MISMATCH, requestId);
      }
      if (payment.status === 'approved') {
        this.trace(order, requestId, 'order_paid');
        return this.repo.update(order.id, {
          status: ORDER_STATUS.PAID,
          payment_status: PAYMENT_STATUS.APPROVED,
          payment_transaction_id: payment.transactionId,
          paid_at: new Date(),
        }, ERROR_STEP.PAYMENT);
      }
      return this.paymentRejected(order, payment.transactionId, requestId);
    }

    if (result.kind === 'rejected' && result.code === ERROR_CODES.PAYMENT_REJECTED) {
      return this.paymentRejected(order, null, requestId);
    }
    if (result.kind === 'rejected') {
      return this.stepError(order, ERROR_STEP.PAYMENT, result.code, requestId);
    }
    return this.paymentUnknown(order, result.code, requestId);
  }

  private paymentRejected(order: OrderRow, transactionId: string | null, requestId: string): Promise<OrderRow> {
    this.trace(order, requestId, 'order_rejected', ERROR_CODES.PAYMENT_REJECTED);
    return this.repo.update(order.id, {
      status: ORDER_STATUS.REJECTED,
      payment_status: PAYMENT_STATUS.REJECTED,
      ...(transactionId ? { payment_transaction_id: transactionId } : {}),
      reservation_status: RESERVATION_STATUS.RELEASE_PENDING,
      last_error_step: ERROR_STEP.PAYMENT,
      last_error_code: ERROR_CODES.PAYMENT_REJECTED,
    });
  }

  private paymentUnknown(order: OrderRow, code: string, requestId: string): Promise<OrderRow> {
    this.trace(order, requestId, 'payment_unknown', code);
    return this.repo.update(order.id, {
      payment_status: PAYMENT_STATUS.UNKNOWN,
      last_error_step: ERROR_STEP.PAYMENT,
      last_error_code: code,
    });
  }

  private async release(order: OrderRow, requestId: string): Promise<OrderRow> {
    if (order.reservation_status !== RESERVATION_STATUS.RELEASE_PENDING) return order;
    const result = await this.clients.events.release(order.id, requestId);
    const gone = result.kind === 'rejected' && result.status === 404;
    if (result.kind === 'ok' || gone) {
      this.trace(order, requestId, 'reservation_released');
      // Se conserva last_error = PAYMENT_REJECTED: es el motivo que ve el comprador.
      return this.repo.update(order.id, { reservation_status: RESERVATION_STATUS.RELEASED });
    }
    log('warn', 'reservation_release_pending', { requestId, orderId: order.id, code: result.code });
    return order;
  }

  private async issueTickets(order: OrderRow, requestId: string): Promise<OrderRow> {
    const pending = order.status === ORDER_STATUS.PAID
      && (order.ticket_status === TICKET_STATUS.NOT_STARTED || order.ticket_status === TICKET_STATUS.PENDING);
    if (!pending) return order;

    if (!order.ticket_issue_payload) {
      order = await this.repo.saveTicketPayload(order.id, buildTicketIssuePayload(order));
    }
    const result = await this.clients.tickets.issue(order.ticket_issue_payload!, requestId);

    if (result.kind === 'ok') {
      if (result.data.orderId !== order.id || result.data.items.length !== order.quantity) {
        return this.stepError(order, ERROR_STEP.TICKETS, PROGRESS_ERRORS.TICKETS_MISMATCH, requestId);
      }
      this.trace(order, requestId, 'tickets_issued');
      return this.repo.update(order.id, { ticket_status: TICKET_STATUS.ISSUED }, ERROR_STEP.TICKETS);
    }
    return this.stepError(order, ERROR_STEP.TICKETS, result.code, requestId);
  }

  private async notify(order: OrderRow, requestId: string): Promise<OrderRow> {
    const pending = order.status === ORDER_STATUS.PAID
      && order.ticket_status === TICKET_STATUS.ISSUED
      && order.notification_status !== NOTIFICATION_STATUS.SENT;
    if (!pending) return order;

    order = await this.repo.update(order.id, { notification_status: NOTIFICATION_STATUS.PENDING });
    const result = await this.clients.notifications.sendPurchase(buildPurchaseNotification(order), requestId);

    if (result.kind === 'ok') {
      this.trace(order, requestId, 'notification_sent');
      return this.repo.update(order.id, { notification_status: NOTIFICATION_STATUS.SENT }, ERROR_STEP.NOTIFICATION);
    }
    // Un timeout no confirma si SMTP envió el correo: `unknown`. Lo demás es `failed`.
    const status = result.kind === 'unavailable' && result.code === REMOTE_UNAVAILABLE.TIMEOUT
      ? NOTIFICATION_STATUS.UNKNOWN
      : NOTIFICATION_STATUS.FAILED;
    this.trace(order, requestId, 'notification_failed', result.code);
    return this.repo.update(order.id, {
      notification_status: status,
      last_error_step: ERROR_STEP.NOTIFICATION,
      last_error_code: result.code,
    });
  }

  private stepError(order: OrderRow, step: ErrorStep, code: string, requestId: string): Promise<OrderRow> {
    this.trace(order, requestId, `${step}_pending`, code);
    return this.repo.update(order.id, { last_error_step: step, last_error_code: code });
  }

  private trace(order: OrderRow, requestId: string, event: string, code?: string): void {
    log(code ? 'warn' : 'info', event, { requestId, orderId: order.id, code });
  }
}

/** La reserva debe corresponder exactamente a la selección guardada de la orden. */
function reservationMatches(order: OrderRow, data: ReservationResponse): boolean {
  const r = data.reservation;
  return r.orderId === order.id
    && r.eventId === order.event_id && data.event.id === order.event_id
    && r.sectorId === order.sector_id && data.sector.id === order.sector_id
    && r.quantity === order.quantity
    && r.status === 'active'
    && Number.isSafeInteger(r.unitPriceMinor * r.quantity);
}
