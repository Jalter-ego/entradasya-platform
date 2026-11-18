export const config = {
  port: Number(process.env.PORT ?? 3003),
  host: process.env.HOST ?? '127.0.0.1',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
} as const;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
export function validateConfig(): void {
  const problems: string[] = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('PORT inválido');
  if (!LOG_LEVELS.includes(config.logLevel)) problems.push(`LOG_LEVEL debe ser ${LOG_LEVELS.join(', ')}`);
  if (!config.databaseUrl) problems.push('Falta DATABASE_URL');
  if (problems.length) throw new Error(`${problems.join('; ')}. Revisa .env.example`);
}
