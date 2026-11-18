import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { AppError } from '../http/errors.js';
import { requireInternal } from '../http/internalAuth.js';
import { log } from '../logger.js';
import * as payments from '../repo/payments.js';
import { DEMO_CARD } from '../repo/payments.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cuerpo exacto que envía orders. `.strict()` rechaza cualquier dato extra:
 * así nunca llega (ni se guarda) un número de tarjeta, CVV u otro dato real.
 */
const chargeSchema = z
  .object({
    orderId: z.string().regex(UUID_RE, 'debe ser un UUID'),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/, 'código ISO de 3 letras en mayúsculas'),
    method: z.literal(DEMO_CARD.METHOD),
    last4: z.enum([DEMO_CARD.APPROVE_LAST4, DEMO_CARD.REJECT_LAST4], {
      errorMap: () => ({ message: 'tarjeta de demo: usar 1111 (aprueba) o 0000 (rechaza)' }),
    }),
  })
  .strict();

/** API interna: solo la usa orders con X-Internal-Token. Nginx no la publica. */
export function internalRouter(db: Db, internalToken: string): Router {
  const router = Router();
  router.use(requireInternal(internalToken));

  // 201 si se registró el resultado; 200 si es la repetición del mismo cobro.
  // Un rechazo también es 2xx: es un resultado de negocio, con status=rejected.
  router.post('/payments', async (req, res) => {
    const input = chargeSchema.parse(req.body);
    const { created, payment } = await payments.charge(db, input);
    log('info', created ? 'payment_recorded' : 'payment_repeated', {
      requestId: req.requestId,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      status: payment.status,
    });
    res.status(created ? 201 : 200).json(payment);
  });

  // Para que orders confirme el resultado tras un timeout. 404 si nunca se registró.
  router.get('/payments/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const payment = UUID_RE.test(orderId) ? await payments.getByOrder(db, orderId) : undefined;
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'No hay pago para esa orden');
    res.json(payment);
  });

  return router;
}
