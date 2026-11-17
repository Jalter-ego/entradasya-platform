// Ejecuta las migraciones contra DATABASE_URL (Postgres local o Supabase).
// Uso: npm run migrate            -> aplica las pendientes
//      npm run migrate -- down    -> revierte la última
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL (ver .env.example)');
  process.exit(1);
}

const schema = process.env.DB_SCHEMA || 'public';
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
const direction = process.argv[2] === 'down' ? 'down' : 'up';

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
