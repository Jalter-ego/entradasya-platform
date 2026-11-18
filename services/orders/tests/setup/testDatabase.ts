/** Lee TEST_DATABASE_URL y se niega a usar una base que no sea desechable. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Define TEST_DATABASE_URL en .env.test (ver .env.test.example y el README)');
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/^orders_test/.test(name)) {
    throw new Error(`Las pruebas borran datos: la base debe llamarse orders_test*, no "${name}"`);
  }
  return url;
}
