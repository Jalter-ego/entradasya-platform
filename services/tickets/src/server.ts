import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createJwtVerifier } from './http/auth.js';
import { log } from './logger.js';
import { FileTicketPdf } from './tickets/pdf.js';

async function start() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl, config.databaseSsl);
  db.on('error', () => log('error', 'database_pool_error'));
  const pdf = new FileTicketPdf(config.storageDir, config.timeZone);
  try {
    const verifyToken = await createJwtVerifier(config.jwt);
    await db.query('SELECT 1 FROM ticket_orders LIMIT 1');
    await pdf.ready();
    const app = createApp({ ...config, db, pdf, verifyToken });
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
      const timeout = setTimeout(() => process.exit(1), 10_000).unref();
      server.close(() => { void db.end().finally(() => { clearTimeout(timeout); }); });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    await db.end();
    throw error;
  }
}

start().catch(() => {
  log('error', 'No se pudo iniciar tickets. Revisa .env, la clave pública de auth, la carpeta de PDF y ejecuta pnpm migrate.');
  process.exitCode = 1;
});
