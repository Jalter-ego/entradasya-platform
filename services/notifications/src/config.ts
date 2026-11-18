export interface Config {
  port: number;
  host: string;
  /** Token compartido solo entre orders y notifications para /internal/*. */
  internalTokenOrders: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    /** Límite de cada envío; debe ser menor que el timeout de orders (HTTP_TIMEOUT_MS). */
    timeoutMs: number;
  };
  mailFrom: string;
  /** URL pública de la web (Nginx). El correo enlaza a <PUBLIC_WEB_URL>/mis-entradas. */
  publicWebUrl: string;
  /** Zona horaria para mostrar la fecha del evento en el correo. */
  timezone: string;
}

export const INTERNAL_TOKEN_MIN_LENGTH = 24;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return value;
}

export function loadConfig(): Config {
  const internalTokenOrders = required('INTERNAL_TOKEN_ORDERS');
  if (internalTokenOrders.length < INTERNAL_TOKEN_MIN_LENGTH) {
    throw new Error(`INTERNAL_TOKEN_ORDERS debe tener al menos ${INTERNAL_TOKEN_MIN_LENGTH} caracteres`);
  }

  const publicWebUrl = required('PUBLIC_WEB_URL');
  if (!/^https?:\/\//.test(publicWebUrl) || !URL.canParse(publicWebUrl)) {
    throw new Error('PUBLIC_WEB_URL debe ser una URL http(s), p. ej. http://localhost:8080');
  }

  const timezone = process.env.MAIL_TIMEZONE || 'America/La_Paz';
  try {
    new Intl.DateTimeFormat('es-BO', { timeZone: timezone });
  } catch {
    throw new Error(`MAIL_TIMEZONE inválida: ${timezone}`);
  }

  const user = process.env.SMTP_USER || undefined;
  const password = process.env.SMTP_PASSWORD || undefined;
  if (Boolean(user) !== Boolean(password)) throw new Error('SMTP_USER y SMTP_PASSWORD van juntos');

  return {
    port: integer('PORT', 3006, 1, 65535),
    host: process.env.HOST || '127.0.0.1',
    internalTokenOrders,
    smtp: {
      host: process.env.SMTP_HOST || '127.0.0.1',
      port: integer('SMTP_PORT', 1025, 1, 65535),
      secure: process.env.SMTP_SECURE === 'true',
      user,
      password,
      timeoutMs: integer('SMTP_TIMEOUT_MS', 4_000, 100, 60_000),
    },
    mailFrom: process.env.MAIL_FROM || 'EntradasYa <no-reply@entradasya.local>',
    publicWebUrl: publicWebUrl.replace(/\/+$/, ''),
    timezone,
  };
}
