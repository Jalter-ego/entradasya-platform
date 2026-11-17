import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createJwtVerifier } from './http/auth.js';
import { log } from './logger.js';

const config = loadConfig();

const db = createPool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  schema: config.dbSchema,
});

const verifyToken = await createJwtVerifier({
  publicKey: config.jwt.publicKeyPem,
  algorithm: config.jwt.algorithm,
  issuer: config.jwt.issuer,
  audience: config.jwt.audience,
});

const app = createApp({
  db,
  verifyToken,
  internalToken: config.internalTokenOrders,
  currency: config.currency,
});

const server = app.listen(config.port, config.host, () => {
  log('info', `events escuchando en http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  log('info', `recibido ${signal}, cerrando`);
  server.close(() => {
    db.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
