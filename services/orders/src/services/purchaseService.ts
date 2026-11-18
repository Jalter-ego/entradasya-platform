import { randomUUID } from 'node:crypto';
import { buildRequestHash } from '../builders/requestHash.js';
import { ERROR_CODES } from '../constants/constants.js';
import type { OrdersRepository } from '../repositories/ordersRepository.js';
import type { AuthUser } from '../types/auth.js';
import type { OrderRow, OrderSelection } from '../types/order.js';
import { AppError } from '../utils/appError.js';
import type { OrderProcessor } from './orderProcessor.js';

export class PurchaseService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly processor: OrderProcessor,
  ) {}

  async purchase(
    user: AuthUser, idempotencyKey: string, selection: OrderSelection, requestId: string,
  ): Promise<{ created: boolean; order: OrderRow }> {
    const { created, order } = await this.repo.createOrGet({
      id: randomUUID(),
      customerId: user.id,
      customerEmail: user.email,
      idempotencyKey,
      requestHash: buildRequestHash(selection),
      selection,
    });
    return { created, order: await this.processor.process(order.id, requestId) };
  }

  async retry(orderId: string, customerId: string, requestId: string): Promise<OrderRow> {
    const order = await this.repo.findOwned(orderId, customerId);
    if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Compra no encontrada');
    return this.processor.process(order.id, requestId);
  }
}
