import { readFileSync } from 'node:fs';

export const JWT_ALGORITHM = 'RS256';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

function integer(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} debe ser un entero entre 1 y ${maximum}`);
  }
  return value;
}

export function databaseConfig() {
  const schema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('DB_SCHEMA inválido');

  return {
    schema,
    connection: {
      connectionString: required('DATABASE_URL'),
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
    },
  };
}

export function loadConfig() {
  if ((process.env.JWT_ALG || JWT_ALGORITHM) !== JWT_ALGORITHM) {
    throw new Error('JWT_ALG debe ser RS256');
  }
  const keyFile = process.env.JWT_PRIVATE_KEY_FILE?.trim();
  return {
    host: process.env.HOST || '127.0.0.1',
    port: integer('PORT', 3001, 65_535),
    database: databaseConfig(),
    jwt: {
      privateKeyPem: keyFile ? readFileSync(keyFile, 'utf8') : required('JWT_PRIVATE_KEY').replace(/\\n/g, '\n'),
      issuer: process.env.JWT_ISSUER?.trim() || 'entradasya-auth',
      audience: process.env.JWT_AUDIENCE?.trim() || 'entradasya',
      ttlSeconds: integer('JWT_TTL_SECONDS', 28_800, 86_400),
    },
  };
}
