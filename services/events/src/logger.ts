type Level = 'debug' | 'info' | 'warn' | 'error';

/** Log en una línea JSON: fecha, nivel, servicio, mensaje y requestId (si lo hay). */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: 'events',
    msg,
    ...fields,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
