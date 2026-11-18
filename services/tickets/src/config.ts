import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSslRejectUnauthorized: boolean;
  dbSchema: string;
  storageDir: string;
  timeZone: string;
  jwt: { publicKeyPem: string; issuer: string; audience: string };
  internalTokenOrders: string;
  internalTokenCheckin: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}; revisa .env.example`);
  return value;
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT || 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválido');
  if ((process.env.JWT_ALG || 'RS256') !== 'RS256') throw new Error('El contrato JWT usa RS256');
  const timeZone = process.env.DISPLAY_TIME_ZONE || 'UTC';
  new Intl.DateTimeFormat('es-BO', { timeZone }).format();
  const dbSchema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
    throw new Error('DB_SCHEMA solo admite minúsculas, números y _');
  }
  const internalTokenOrders = required('INTERNAL_TOKEN_ORDERS');
  const internalTokenCheckin = required('INTERNAL_TOKEN_CHECKIN');
  if (Math.min(internalTokenOrders.length, internalTokenCheckin.length) < 24) {
    throw new Error('Las credenciales internas deben tener al menos 24 caracteres');
  }
  if (internalTokenOrders === internalTokenCheckin) {
    throw new Error('orders y checkin deben usar credenciales internas distintas');
  }
  const publicKeyPem = process.env.JWT_PUBLIC_KEY_FILE
    ? readFileSync(process.env.JWT_PUBLIC_KEY_FILE, 'utf8')
    : required('JWT_PUBLIC_KEY').replace(/\\n/g, '\n');
  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    databaseSslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    dbSchema,
    storageDir: resolve(required('TICKETS_STORAGE_DIR')),
    timeZone,
    jwt: { publicKeyPem, issuer: required('JWT_ISSUER'), audience: required('JWT_AUDIENCE') },
    internalTokenOrders,
    internalTokenCheckin,
  };
}
