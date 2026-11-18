import { createApp } from './app.js';
import { config, validateConfig } from './config/config.js';
import { SHUTDOWN_TIMEOUT_MS } from './constants/constants.js';
import { checkSchema, createPool } from './database/database.js';
import { log } from './utils/logger.js';

async function start() {
  validateConfig();
  const db = createPool();
  db.on('error', () => log('error', 'database_pool_error'));
  try {
    await checkSchema(db);
    const app = createApp({ db });
    const server = app.listen(config.port, config.host, () => log('info', 'listening', {
      host: config.host, port: config.port,
    }));
    server.on('error', () => {
      log('error', 'server_listen_failed');
      void db.end().finally(() => { process.exitCode = 1; });
    });
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      log('info', 'stopping');
      const timeout = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
      server.close(() => { void db.end().finally(() => { clearTimeout(timeout); }); });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    await db.end();
    throw error;
  }
}

start().catch((error) => {
  log('error', 'No se pudo iniciar orders. Revisa .env, la conexión a orders_db y ejecuta pnpm migrate.', {
    reason: error instanceof Error && error.message.includes('.env.example') ? error.message : undefined,
  });
  process.exitCode = 1;
});
