import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createTokenSigner } from './jwt.js';
import { log } from './logger.js';
import { usersRepository } from './users.js';

try {
  const { port, host, database, jwt } = loadConfig();
  const signToken = createTokenSigner(jwt);
  const db = createPool(database);
  const server = createApp(usersRepository(db), signToken).listen(port, host, (error?: Error) => {
    if (error) {
      log('error', 'No se pudo escuchar en HOST y PORT');
      process.exitCode = 1;
      void db.end();
      return;
    }
    log('info', 'Servicio iniciado', { port });
  });
  const close = () => server.close(() => { void db.end(); });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  log('error', 'No se pudo iniciar auth. Revisa .env y la clave privada RSA');
  process.exitCode = 1;
}
