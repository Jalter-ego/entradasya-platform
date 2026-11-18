import { config } from '../config/config.js';
import { SERVICE_NAME } from '../constants/constants.js';

const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
type Level = Exclude<keyof typeof levels, 'silent'>;

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const configured = levels[config.logLevel as keyof typeof levels] ?? levels.info;
  if (levels[level] < configured) return;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: SERVICE_NAME, message, ...fields }));
}
