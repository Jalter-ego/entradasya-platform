import type { Request, Response } from 'express';
import { buildPaginationMeta } from '../builders/paginationMeta.js';
import { ERROR_CODES, IDEMPOTENCY_KEY_HEADER } from '../constants/constants.js';
import { toOrder } from '../mappers/orderMapper.js';
import { toOrderMessage } from '../mappers/orderMessage.js';
import type { OrdersRepository } from '../repositories/ordersRepository.js';
import type { PurchaseService } from '../services/purchaseService.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { AppError } from '../utils/appError.js';
import {
  createOrderSchema, idempotencyKeySchema, listOrdersQuerySchema, orderIdSchema,
} from '../validators/orderValidators.js';

function parseOrderId(value: unknown): string {
  const parsed = orderIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Compra no encontrada');
  return parsed.data;
}

function parseIdempotencyKey(req: Request): string {
  const parsed = idempotencyKeySchema.safeParse(req.header(IDEMPOTENCY_KEY_HEADER));
  if (!parsed.success) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Falta o es inválido el header Idempotency-Key', [
      { field: 'Idempotency-Key', message: parsed.error.issues[0]?.message ?? 'Inválido' },
    ]);
  }
  return parsed.data;
}

export class OrdersController {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly purchases: PurchaseService,
  ) {}

  create = async (req: Request, res: Response) => {
    const idempotencyKey = parseIdempotencyKey(req);
    const selection = createOrderSchema.parse(req.body);
    const { created, order } = await this.purchases.purchase(req.user!, idempotencyKey, selection, req.requestId);
    const respond = created ? ApiResponse.created : ApiResponse.ok;
    respond(res, toOrderMessage(order), toOrder(order));
  };

  listMine = async (req: Request, res: Response) => {
    const { page, perPage } = listOrdersQuerySchema.parse(req.query);
    const { rows, total } = await this.repo.listByCustomer(req.user!.id, page, perPage);
    ApiResponse.ok(res, 'Compras obtenidas correctamente', rows.map(toOrder), buildPaginationMeta(page, perPage, total));
  };

  getById = async (req: Request, res: Response) => {
    const order = await this.repo.findOwned(parseOrderId(req.params.id), req.user!.id);
    if (!order) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Compra no encontrada');
    ApiResponse.ok(res, toOrderMessage(order), toOrder(order));
  };

  retry = async (req: Request, res: Response) => {
    const order = await this.purchases.retry(parseOrderId(req.params.id), req.user!.id, req.requestId);
    ApiResponse.ok(res, toOrderMessage(order), toOrder(order));
  };
}
