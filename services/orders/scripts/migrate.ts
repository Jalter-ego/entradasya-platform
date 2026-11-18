import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { config } from '../src/config/config.js';

if (!config.databaseUrl) {
  console.error('Falta DATABASE_URL; revisa .env.example');
  process.exit(1);
}

const direction = process.argv[2] === 'down' ? 'down' : 'up';

try {
  await runner({
    databaseUrl: {
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
    },
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction,
    count: direction === 'down' ? 1 : Infinity,
    migrationsTable: 'pgmigrations',
    log: (message) => console.log(message),
  });
} catch {
  console.error('No se pudo migrar orders. Revisa la conexión y los permisos de su base exclusiva.');
  process.exitCode = 1;
}
