export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  databaseSsl: boolean;
  dbSchema: string;
  /** Token compartido solo entre orders y payments para /internal/*. */
  internalTokenOrders: string;
}

export const INTERNAL_TOKEN_MIN_LENGTH = 24;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT || 3004);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválido');

  const dbSchema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
    throw new Error('DB_SCHEMA solo admite minúsculas, números y _');
  }

  const internalTokenOrders = required('INTERNAL_TOKEN_ORDERS');
  if (internalTokenOrders.length < INTERNAL_TOKEN_MIN_LENGTH) {
    throw new Error(`INTERNAL_TOKEN_ORDERS debe tener al menos ${INTERNAL_TOKEN_MIN_LENGTH} caracteres`);
  }

  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    dbSchema,
    internalTokenOrders,
  };
}
