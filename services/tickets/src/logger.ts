const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
type Level = Exclude<keyof typeof levels, 'silent'>;

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const configured = process.env.LOG_LEVEL as keyof typeof levels | undefined;
  if (levels[level] < (levels[configured || 'info'] ?? levels.info)) return;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'tickets', message, ...fields }));
}
