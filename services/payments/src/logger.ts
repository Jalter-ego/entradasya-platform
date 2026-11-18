type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log en una línea JSON: fecha, nivel, servicio, mensaje y requestId (si lo hay).
 * Nunca registrar cuerpos de petición: no hay datos de tarjeta que proteger,
 * pero tampoco se deben acostumbrar los logs a llevarlos.
 */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    service: 'payments',
    msg,
    ...fields,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
