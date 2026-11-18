import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL; revisa .env.example');
  process.exit(1);
}

const schema = process.env.DB_SCHEMA || 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error('DB_SCHEMA solo admite minúsculas, números y _');
  process.exit(1);
}

try {
  await runner({
    databaseUrl: {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
          : undefined,
    },
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    count: Infinity,
    schema,
    createSchema: schema !== 'public',
    migrationsTable: 'pgmigrations',
    log: (message) => console.log(message),
  });
} catch {
  console.error('No se pudo migrar tickets. Revisa la conexión y los permisos de su base exclusiva.');
  process.exitCode = 1;
}
