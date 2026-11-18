export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: 'auth', msg, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
}
