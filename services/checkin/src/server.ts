import { createApp } from './app.js';
import { HttpTicketsValidator } from './clients/tickets.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createJwtVerifier } from './http/auth.js';
import { log } from './logger.js';

async function start() {
  const config = loadConfig();
  const db = createPool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
    schema: config.dbSchema,
  });
  db.on('error', () => log('error', 'database_pool_error'));

  try {
    const verifyToken = await createJwtVerifier({
      publicKey: config.jwt.publicKeyPem,
      algorithm: config.jwt.algorithm,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    await db.query('SELECT 1 FROM checkins LIMIT 1');
    const ticketsValidator = new HttpTicketsValidator(
      config.ticketsUrl,
      config.internalTokenCheckin,
      config.internalTimeoutMs,
    );

    const app = createApp({ db, ticketsValidator, verifyToken });
    const server = app.listen(config.port, config.host, () => {
      log('info', 'listening', { host: config.host, port: config.port });
    });

    server.on('error', () => {
      log('error', 'server_listen_failed');
      void db.end().finally(() => {
        process.exitCode = 1;
      });
    });

    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      log('info', 'stopping');
      const timeout = setTimeout(() => process.exit(1), 10_000).unref();
      server.close(() => {
        void db.end().finally(() => {
          clearTimeout(timeout);
        });
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    await db.end();
    throw error;
  }
}

start().catch((error) => {
  log('error', 'No se pudo iniciar checkin. Revisa .env, la clave pública de auth y ejecuta npm run migrate.', {
    reason: error instanceof Error ? error.message : 'Error desconocido',
  });
  process.exitCode = 1;
});
