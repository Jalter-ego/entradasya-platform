import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  /** Envía y devuelve el Message-ID aceptado por el servidor SMTP. */
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
  /** Comprueba que el servidor SMTP responde (para /health). */
  verify(): Promise<void>;
  close(): void;
}

/** Fallo del envío clasificado para responder a orders. */
export class SmtpError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ETIMEOUT']);

function classify(error: unknown): SmtpError {
  if (error instanceof SmtpError) return error;
  const code = (error as { code?: unknown })?.code;
  return TIMEOUT_CODES.has(String(code))
    ? new SmtpError('timeout', 'El servidor SMTP no respondió a tiempo')
    : new SmtpError('unavailable', 'El servidor SMTP no está disponible');
}

/** Corta cualquier operación que supere el límite, aunque el socket siga abierto. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError('timeout', 'El envío superó el tiempo máximo')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export function createSmtpMailer(smtp: Config['smtp'], from: string): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    // Mailpit local no usa TLS; con SMTP_SECURE=false tampoco se intenta STARTTLS.
    ignoreTLS: !smtp.secure,
    connectionTimeout: smtp.timeoutMs,
    greetingTimeout: smtp.timeoutMs,
    socketTimeout: smtp.timeoutMs,
    // Cada envío abre su conexión: si Mailpit se reinicia, el siguiente correo funciona.
    pool: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async send(mail) {
      try {
        const info = await withDeadline(
          transport.sendMail({
            from,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            messageId: mail.messageId,
            headers: mail.headers,
          }),
          smtp.timeoutMs,
        );
        return { messageId: info.messageId };
      } catch (error) {
        throw classify(error);
      }
    },
    async verify() {
      try {
        await withDeadline(transport.verify(), smtp.timeoutMs);
      } catch (error) {
        throw classify(error);
      }
    },
    close() {
      transport.close();
    },
  };
}
