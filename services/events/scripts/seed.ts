// Datos de demo idempotentes: se puede ejecutar varias veces sin duplicar nada.
// Si un evento de demo ya existe, actualiza sus datos descriptivos (no toca cupos reservados).
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
const currency = (process.env.CURRENCY || 'BOB').toUpperCase();

/** Fecha dentro de `d` días a la hora local de Bolivia indicada (UTC-4). */
const inDays = (d: number, hour = 20, minute = 0) => {
  const date = new Date(Date.now() + d * 86_400_000);
  date.setUTCHours(hour + 4, minute, 0, 0);
  return date;
};
const poster = (seed: string) => `https://picsum.photos/seed/${seed}/900/1100`;

type Seed = {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  category: string;
  startsAt: Date;
  imageUrl: string | null;
  status: 'draft' | 'published';
  sectors: { id: string; name: string; priceMinor: number; capacity: number }[];
};

const s = (n: number, m: number) => `11000000-0000-4000-8000-${String(n * 100 + m).padStart(12, '0')}`;

const events: Seed[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Noche de Rock Nacional',
    description: 'Las bandas más queridas del rock boliviano en una sola noche.\n\nApertura de puertas 18:30.',
    venue: 'Teatro al Aire Libre',
    city: 'La Paz',
    category: 'concierto',
    startsAt: inDays(30),
    imageUrl: poster('rock-nacional'),
    status: 'published',
    sectors: [
      { id: s(1, 1), name: 'General', priceMinor: 12000, capacity: 200 },
      { id: s(1, 2), name: 'VIP', priceMinor: 29000, capacity: 80 },
      { id: s(1, 3), name: 'Fosa', priceMinor: 49000, capacity: 2 },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Festival de Jazz',
    description: 'Tres escenarios y artistas invitados de todo el continente.',
    venue: 'Teatro Municipal',
    city: 'Cochabamba',
    category: 'festival',
    startsAt: inDays(45, 19, 30),
    imageUrl: poster('jazz-fest'),
    status: 'published',
    sectors: [{ id: s(2, 1), name: 'General', priceMinor: 6500, capacity: 120 }],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    title: 'Stand-up (borrador)',
    description: 'Todavía sin publicar.',
    venue: 'Centro Cultural',
    city: 'Sucre',
    category: 'teatro',
    startsAt: inDays(60),
    imageUrl: null,
    status: 'draft',
    sectors: [{ id: s(3, 1), name: 'Sala', priceMinor: 4000, capacity: 50 }],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    title: 'Sunset Electrónico',
    description: 'DJs nacionales e internacionales desde el atardecer hasta la madrugada.',
    venue: 'Arena Santa Cruz',
    city: 'Santa Cruz de la Sierra',
    category: 'electronica',
    startsAt: inDays(5, 17),
    imageUrl: poster('sunset-electro'),
    status: 'published',
    sectors: [
      { id: s(4, 1), name: 'Pista', priceMinor: 15000, capacity: 500 },
      { id: s(4, 2), name: 'Backstage', priceMinor: 40000, capacity: 40 },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    title: 'Hilos de tango',
    description: 'Gala de fin de año con orquesta en vivo y parejas de baile invitadas.',
    venue: 'Teatro Doña Albina',
    city: 'La Paz',
    category: 'teatro',
    startsAt: inDays(12, 19),
    imageUrl: poster('tango-gala'),
    status: 'published',
    sectors: [
      { id: s(5, 1), name: 'Platea', priceMinor: 11000, capacity: 150 },
      { id: s(5, 2), name: 'Mezzanine', priceMinor: 8000, capacity: 60 },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    title: 'Clásico del Valle',
    description: 'El partido más esperado de la temporada.',
    venue: 'Estadio Félix Capriles',
    city: 'Cochabamba',
    category: 'deportes',
    startsAt: inDays(20, 16),
    imageUrl: poster('clasico-valle'),
    status: 'published',
    sectors: [
      { id: s(6, 1), name: 'Curva', priceMinor: 3500, capacity: 1000 },
      { id: s(6, 2), name: 'Preferencia', priceMinor: 9000, capacity: 400 },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    title: 'Taller de producción musical',
    description: 'Jornada práctica de grabación, mezcla y masterización. Cupos limitados.',
    venue: 'Casa de la Cultura',
    city: 'Tarija',
    category: 'capacitacion',
    startsAt: inDays(9, 9),
    imageUrl: poster('taller-produccion'),
    status: 'published',
    sectors: [{ id: s(7, 1), name: 'Participante', priceMinor: 25000, capacity: 25 }],
  },
];

await withTransaction(db, async (tx) => {
  for (const e of events) {
    await tx.query(
      `INSERT INTO events (id, organizer_id, title, description, venue, city, category, starts_at, image_url, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, venue = EXCLUDED.venue,
         city = EXCLUDED.city, category = EXCLUDED.category, starts_at = EXCLUDED.starts_at,
         image_url = EXCLUDED.image_url, currency = EXCLUDED.currency, updated_at = now()`,
      [e.id, organizerId, e.title, e.description, e.venue, e.city, e.category, e.startsAt, e.imageUrl, currency, e.status],
    );
    // Quita sectores de demo que ya no están en la lista (solo si nunca tuvieron reservas).
    await tx.query(
      `DELETE FROM sectors s
       WHERE s.event_id = $1 AND s.id <> ALL($2::uuid[])
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.sector_id = s.id)`,
      [e.id, e.sectors.map((sec) => sec.id)],
    );
    for (const sec of e.sectors) {
      // La capacidad nunca baja de lo ya reservado.
      await tx.query(
        `INSERT INTO sectors (id, event_id, name, price_minor, capacity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, price_minor = EXCLUDED.price_minor,
           capacity = GREATEST(EXCLUDED.capacity, sectors.reserved), updated_at = now()`,
        [sec.id, e.id, sec.name, sec.priceMinor, sec.capacity],
      );
    }
  }
});

console.log(`Semilla aplicada: ${events.length} eventos del organizador ${organizerId} (${currency})`);
await db.end();
