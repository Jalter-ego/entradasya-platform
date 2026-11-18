import { readFileSync } from 'node:fs';

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
  ticketsUrl: string;
  internalTimeoutMs: number;
  internalTokenCheckin: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}; revisa .env.example`);
  return value;
}

function readPublicKey(): string {
  const file = process.env.JWT_PUBLIC_KEY_FILE?.trim();
  if (file) return readFileSync(file, 'utf8');
  return required('JWT_PUBLIC_KEY').replace(/\\n/g, '\n');
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT || 3007);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT inválido');
  }

  const algorithm = process.env.JWT_ALG || 'RS256';
  if (algorithm !== 'RS256') {
    throw new Error('El contrato JWT usa RS256');
  }

  const dbSchema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
    throw new Error('DB_SCHEMA solo admite minúsculas, números y _');
  }

  const internalTokenCheckin = required('INTERNAL_TOKEN_CHECKIN');
  if (internalTokenCheckin.length < 24) {
    throw new Error('INTERNAL_TOKEN_CHECKIN debe tener al menos 24 caracteres');
  }

  const ticketsUrl = (process.env.TICKETS_URL?.trim() || 'http://127.0.0.1:3005').replace(/\/+$/, '');
  let parsedTicketsUrl: URL;
  try {
    parsedTicketsUrl = new URL(ticketsUrl);
  } catch {
    throw new Error('TICKETS_URL inválida');
  }
  if (!['http:', 'https:'].includes(parsedTicketsUrl.protocol)) {
    throw new Error('TICKETS_URL debe usar http o https');
  }

  const internalTimeoutMs = Number(process.env.INTERNAL_TIMEOUT_MS || 5000);
  if (!Number.isInteger(internalTimeoutMs) || internalTimeoutMs < 500 || internalTimeoutMs > 30_000) {
    throw new Error('INTERNAL_TIMEOUT_MS debe estar entre 500 y 30000 ms');
  }

  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    dbSchema,
    jwt: {
      publicKeyPem: readPublicKey(),
      algorithm,
      issuer: required('JWT_ISSUER'),
      audience: required('JWT_AUDIENCE'),
    },
    ticketsUrl,
    internalTimeoutMs,
    internalTokenCheckin,
  };
}
