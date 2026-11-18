import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { databaseConfig } from '../src/config.js';

try {
  const { connection, schema } = databaseConfig();
  await runner({
    databaseUrl: connection,
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    count: Infinity,
    schema,
    createSchema: schema !== 'public',
    migrationsSchema: schema,
    migrationsTable: 'pgmigrations',
  });
} catch {
  console.error('No se pudo migrar auth. Revisa DATABASE_URL, DB_SCHEMA, SSL y los permisos.');
  process.exitCode = 1;
}
