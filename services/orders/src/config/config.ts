import { INTERNAL_TOKEN_MIN_LENGTH, JWT_ALGORITHM } from '../constants/constants.js';

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

  http: {
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 5_000),
    ticketsTimeoutMs: Number(process.env.TICKETS_TIMEOUT_MS ?? 20_000),
  },

  services: {
    events: {
      url: process.env.EVENTS_URL ?? '',
      token: process.env.EVENTS_INTERNAL_TOKEN ?? '',
    },
    payments: {
      url: process.env.PAYMENTS_URL ?? '',
      token: process.env.PAYMENTS_INTERNAL_TOKEN ?? '',
    },
    tickets: {
      url: process.env.TICKETS_URL ?? '',
      token: process.env.TICKETS_INTERNAL_TOKEN ?? '',
    },
    notifications: {
      url: process.env.NOTIFICATIONS_URL ?? '',
      token: process.env.NOTIFICATIONS_INTERNAL_TOKEN ?? '',
    },
  },
} as const;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
const isTimeout = (ms: number) => Number.isInteger(ms) && ms >= 100 && ms <= 120_000;

export function validateConfig(): void {
  const problems: string[] = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('PORT inválido');
  if (!LOG_LEVELS.includes(config.logLevel)) problems.push(`LOG_LEVEL debe ser ${LOG_LEVELS.join(', ')}`);
  if (!config.databaseUrl) problems.push('Falta DATABASE_URL');
  if (!config.jwt.publicKeyFile && !config.jwt.publicKey) problems.push('Falta JWT_PUBLIC_KEY_FILE o JWT_PUBLIC_KEY');
  if (config.jwt.algorithm !== JWT_ALGORITHM) problems.push(`JWT_ALG debe ser ${JWT_ALGORITHM}`);
  if (!config.jwt.issuer) problems.push('Falta JWT_ISSUER');
  if (!config.jwt.audience) problems.push('Falta JWT_AUDIENCE');
  if (!isTimeout(config.http.timeoutMs)) problems.push('HTTP_TIMEOUT_MS debe estar entre 100 y 120000');
  if (!isTimeout(config.http.ticketsTimeoutMs)) problems.push('TICKETS_TIMEOUT_MS debe estar entre 100 y 120000');

  for (const [name, service] of Object.entries(config.services)) {
    const prefix = name.toUpperCase();
    if (!URL.canParse(service.url)) problems.push(`${prefix}_URL inválida`);
    if (service.token.length < INTERNAL_TOKEN_MIN_LENGTH) {
      problems.push(`${prefix}_INTERNAL_TOKEN debe tener al menos ${INTERNAL_TOKEN_MIN_LENGTH} caracteres`);
    }
  }
  const tokens = Object.values(config.services).map((service) => service.token);
  if (new Set(tokens).size !== tokens.length) problems.push('Cada servicio interno debe usar un token distinto');

  if (problems.length) throw new Error(`${problems.join('; ')}. Revisa .env.example`);
}
