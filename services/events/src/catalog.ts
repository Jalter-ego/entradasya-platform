/**
 * Valores permitidos para categoría y ciudad. La web muestra las mismas listas
 * (apps/web/src/features/events/catalog.ts): si agregas uno aquí, agrégalo allá.
 */
export const CATEGORIES = [
  'concierto',
  'electronica',
  'teatro',
  'festival',
  'deportes',
  'fiesta',
  'capacitacion',
  'otros',
] as const;

/** Capitales de departamento de Bolivia y El Alto. */
export const CITIES = [
  'La Paz',
  'El Alto',
  'Santa Cruz de la Sierra',
  'Cochabamba',
  'Sucre',
  'Oruro',
  'Potosí',
  'Tarija',
  'Trinidad',
  'Cobija',
] as const;
