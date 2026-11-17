// Datos de demo idempotentes: se puede ejecutar varias veces sin duplicar nada.
// Uso: npm run seed   (requiere DATABASE_URL y SEED_ORGANIZER_ID)
import { createPool, withTransaction } from '../src/db.js';

const organizerId = process.env.SEED_ORGANIZER_ID;
if (!process.env.DATABASE_URL || !organizerId) {
  console.error('Faltan DATABASE_URL o SEED_ORGANIZER_ID (ver .env.example)');
  process.exit(1);
}

const db = createPool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true',
  schema: process.env.DB_SCHEMA || 'public',
});
const currency = (process.env.CURRENCY || 'USD').toUpperCase();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

const events = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Noche de Rock Nacional',
    description: 'Las mejores bandas locales en una sola noche.',
    venue: 'Estadio Central',
    startsAt: inDays(30),
    imageUrl: 'https://picsum.photos/seed/rock/800/450',
    status: 'published',
    sectors: [
      { id: '11000000-0000-4000-8000-000000000001', name: 'Campo', priceMinor: 5000, capacity: 200 },
      { id: '11000000-0000-4000-8000-000000000002', name: 'Platea', priceMinor: 9000, capacity: 80 },
      { id: '11000000-0000-4000-8000-000000000003', name: 'VIP', priceMinor: 20000, capacity: 2 },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Festival de Jazz',
    description: 'Tres escenarios y artistas invitados.',
    venue: 'Teatro Municipal',
    startsAt: inDays(45),
    imageUrl: 'https://picsum.photos/seed/jazz/800/450',
    status: 'published',
    sectors: [{ id: '12000000-0000-4000-8000-000000000001', name: 'General', priceMinor: 6500, capacity: 120 }],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    title: 'Stand-up (borrador)',
    description: 'Todavía sin publicar.',
    venue: 'Centro Cultural',
    startsAt: inDays(60),
    imageUrl: null,
    status: 'draft',
    sectors: [{ id: '13000000-0000-4000-8000-000000000001', name: 'Sala', priceMinor: 4000, capacity: 50 }],
  },
];

await withTransaction(db, async (tx) => {
  for (const e of events) {
    await tx.query(
      `INSERT INTO events (id, organizer_id, title, description, venue, starts_at, image_url, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [e.id, organizerId, e.title, e.description, e.venue, e.startsAt, e.imageUrl, currency, e.status],
    );
    for (const s of e.sectors) {
      await tx.query(
        `INSERT INTO sectors (id, event_id, name, price_minor, capacity)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [s.id, e.id, s.name, s.priceMinor, s.capacity],
      );
    }
  }
});

console.log(`Semilla aplicada: ${events.length} eventos del organizador ${organizerId}`);
await db.end();
