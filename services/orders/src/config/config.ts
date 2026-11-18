import { JWT_ALGORITHM } from '../constants/constants.js';

export const config = {
  port: Number(process.env.PORT ?? 3003),
  host: process.env.HOST ?? '127.0.0.1',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSsl: process.env.DATABASE_SSL === 'true',

  jwt: {
    publicKeyFile: process.env.JWT_PUBLIC_KEY_FILE ?? '',
    publicKey: (process.env.JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
    algorithm: process.env.JWT_ALG ?? JWT_ALGORITHM,
    issuer: process.env.JWT_ISSUER ?? '',
    audience: process.env.JWT_AUDIENCE ?? '',
  },
} as const;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
export function validateConfig(): void {
  const problems: string[] = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('PORT inválido');
  if (!LOG_LEVELS.includes(config.logLevel)) problems.push(`LOG_LEVEL debe ser ${LOG_LEVELS.join(', ')}`);
  if (!config.databaseUrl) problems.push('Falta DATABASE_URL');
  if (!config.jwt.publicKeyFile && !config.jwt.publicKey) problems.push('Falta JWT_PUBLIC_KEY_FILE o JWT_PUBLIC_KEY');
  if (config.jwt.algorithm !== JWT_ALGORITHM) problems.push(`JWT_ALG debe ser ${JWT_ALGORITHM}`);
  if (!config.jwt.issuer) problems.push('Falta JWT_ISSUER');
  if (!config.jwt.audience) problems.push('Falta JWT_AUDIENCE');
  if (problems.length) throw new Error(`${problems.join('; ')}. Revisa .env.example`);
}
