// Ejecuta las migraciones contra DATABASE_URL (Postgres local o Supabase).
// Uso: npm run migrate            -> aplica las pendientes
//      npm run migrate -- down    -> revierte la última
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL; revisa .env.example');
  process.exit(1);
}

const schema = process.env.DB_SCHEMA || 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error('DB_SCHEMA solo admite minúsculas, números y _');
  process.exit(1);
}

const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
const direction = process.argv[2] === 'down' ? 'down' : 'up';

try {
  await runner({
    databaseUrl: { connectionString: databaseUrl, ssl },
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction,
    count: direction === 'down' ? 1 : Infinity,
    schema,
    createSchema: schema !== 'public',
    migrationsTable: 'pgmigrations',
    log: (msg) => console.log(msg),
  });
} catch {
  console.error('No se pudo migrar checkin. Revisa la conexión y los permisos de su base exclusiva.');
  process.exitCode = 1;
}
