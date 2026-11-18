import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { testDatabaseUrl } from './testDatabase.js';

/** Una vez por ejecución: aplica las migraciones pendientes en la base de pruebas. */
export default async function setup(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: fileURLToPath(new URL('../../migrations', import.meta.url)),
    direction: 'up',
    count: Infinity,
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}
