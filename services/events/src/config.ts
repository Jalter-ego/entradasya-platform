import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  databaseSsl: boolean;
  dbSchema: string;
  jwt: {
    publicKeyPem: string;
    algorithm: string;
    issuer: string;
    audience: string;
  };
  /** Token compartido solo entre orders y events para /internal/*. */
  internalTokenOrders: string;
  /** Moneda acordada por el equipo (ISO 4217). */
  currency: string;
  coverStorageDir: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return value;
}

function readPublicKey(): string {
  const file = process.env.JWT_PUBLIC_KEY_FILE;
  if (file) return readFileSync(file, 'utf8');
  // Permite escribir la clave en una sola línea dentro del .env usando \n.
  return required('JWT_PUBLIC_KEY').replace(/\\n/g, '\n');
}

export function loadConfig(): Config {
  const dbSchema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
    throw new Error('DB_SCHEMA solo admite minúsculas, números y _');
  }
  const currency = (process.env.CURRENCY || 'BOB').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('CURRENCY debe ser un código ISO de 3 letras');

  const internalTokenOrders = required('INTERNAL_TOKEN_ORDERS');
  if (internalTokenOrders.length < 24) {
    throw new Error('INTERNAL_TOKEN_ORDERS debe tener al menos 24 caracteres');
  }

  return {
    port: Number(process.env.PORT || 3002),
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    dbSchema,
    jwt: {
      publicKeyPem: readPublicKey(),
      algorithm: process.env.JWT_ALG || 'RS256',
      issuer: required('JWT_ISSUER'),
      audience: required('JWT_AUDIENCE'),
    },
    internalTokenOrders,
    currency,
    coverStorageDir: resolve(process.env.EVENTS_STORAGE_DIR || resolve(homedir(), '.local/share/entradasya/event-covers')),
  };
}
