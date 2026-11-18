import { Router } from 'express';
import { z } from 'zod';
import { buildPurchaseEmail } from '../email/purchaseEmail.js';
import { SmtpError, type Mailer } from '../email/mailer.js';
import { AppError } from '../http/errors.js';
import { requireInternal } from '../http/internalAuth.js';
import { log } from '../logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Una sola línea: evita saltos de línea en el asunto u otras cabeceras. */
const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n]*$/, 'sin saltos de línea');

/** Cuerpo que envía orders (services/orders/src/clients/notificationsClient.ts). */
const purchaseSchema = z
  .object({
    orderId: z.string().regex(UUID_RE, 'debe ser un UUID'),
    to: z.string().trim().email().max(254),
    event: z
      .object({
        title: line(200),
        venue: line(200),
        startsAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    sector: z.object({ name: line(100) }).strict(),
    quantity: z.number().int().min(1).max(6),
    totalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/, 'código ISO de 3 letras en mayúsculas'),
  })
  .strict();

/** c***@demo.bo: suficiente para seguir un envío en los logs sin guardar el correo. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
}

export interface InternalDeps {
  mailer: Mailer;
  internalToken: string;
  publicWebUrl: string;
  timezone: string;
}

/** API interna: solo la usa orders con X-Internal-Token. Nginx no la publica. */
export function internalRouter({ mailer, internalToken, publicWebUrl, timezone }: InternalDeps): Router {
  const router = Router();
  router.use(requireInternal(internalToken));

  /**
   * 200 cuando el servidor SMTP aceptó el correo.
   * 503 SMTP_UNAVAILABLE si no se pudo entregar; 504 SMTP_TIMEOUT si no respondió a tiempo
   * (resultado desconocido: el correo podría haberse enviado).
   * Un reintento puede duplicar el correo; nunca duplica órdenes, cobros ni entradas.
   */
  router.post('/notifications/purchase', async (req, res) => {
    const input = purchaseSchema.parse(req.body);
    const email = buildPurchaseEmail(input, { publicWebUrl, timezone });
    const fields = { requestId: req.requestId, orderId: input.orderId, to: maskEmail(input.to) };

    try {
      const { messageId } = await mailer.send({
        to: input.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        // Mismo Message-ID en cada reenvío de la misma orden: un cliente de correo puede agruparlos.
        messageId: `<compra-${input.orderId}@entradasya.local>`,
        headers: { 'X-EntradasYa-Order': input.orderId },
      });
      log('info', 'purchase_email_sent', fields);
      res.json({ orderId: input.orderId, status: 'sent', messageId, sentAt: new Date().toISOString() });
    } catch (error) {
      if (!(error instanceof SmtpError)) throw error;
      log('warn', 'purchase_email_failed', { ...fields, reason: error.kind });
      throw error.kind === 'timeout'
        ? new AppError(504, 'SMTP_TIMEOUT', 'El servidor de correo no respondió a tiempo')
        : new AppError(503, 'SMTP_UNAVAILABLE', 'El servidor de correo no está disponible');
    }
  });

  return router;
}
