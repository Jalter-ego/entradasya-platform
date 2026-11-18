/** Convierte una suma bigint de PostgreSQL (texto) a number, solo si cabe como entero seguro en JSON. */
export function toSafeInteger(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('La suma excede el rango entero seguro de JSON');
  return parsed;
}
