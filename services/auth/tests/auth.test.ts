import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { createTokenSigner } from '../src/jwt.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import { demoUsers, usersRepository } from '../src/users.js';

process.env.LOG_LEVEL = 'silent';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'entradasya-auth';
const audience = 'entradasya';
const ttlSeconds = 60;
const signToken = createTokenSigner({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), issuer, audience, ttlSeconds });

async function serve(t: { after: (close: () => Promise<void>) => void }, users: ReturnType<typeof usersRepository>) {
  const server = createApp(users, signToken).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function post(url: string, action: 'register' | 'login', body: unknown) {
  return fetch(`${url}/api/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('scrypt almacena hashes distintos para la misma contraseña y verifica de forma exacta', async () => {
  const password = ' una frase con ñ ';
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.match(first, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword(password), false);
});

test('HTTP valida entrada y correlaciona errores sin almacenar ni buscar cuentas', async (t) => {
  const url = await serve(t, {
    checkHealth: async () => { throw new Error('detalle privado'); },
    createCustomer: async () => { throw new Error('No debería crear la cuenta'); },
    findByEmail: async () => { throw new Error('No debería buscar la cuenta'); },
  });
  const credentials = { name: 'Cuenta', email: 'cuenta@example.com', password: 'demo-password' };
  const escalation = await post(url, 'register', { ...credentials, role: 'organizer' });
  assert.equal(escalation.status, 400);
  assert.equal((await escalation.json()).error.code, 'VALIDATION_ERROR');
  assert.equal((await post(url, 'register', { ...credentials, password: '1234' })).status, 400);
  assert.equal((await post(url, 'login', { email: 'invalido', password: 'demo-password' })).status, 400);
  assert.equal((await post(url, 'register', { ...credentials, email: ' PORTERO@DEMO.BO ' })).status, 409);
  const wrongFormat = await fetch(`${url}/api/auth/login`, { method: 'POST', body: 'correo y contraseña' });
  assert.equal(wrongFormat.status, 415);
  assert.equal((await wrongFormat.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  const tooLarge = await post(url, 'register', { ...credentials, name: 'x'.repeat(5000) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, 'PAYLOAD_TOO_LARGE');

  const invalid = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'p1-test' },
    body: '{',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('x-request-id'), 'p1-test');
  assert.deepEqual(await invalid.json(), {
    error: { code: 'INVALID_JSON', message: 'El cuerpo no es JSON válido.' },
    requestId: 'p1-test',
  });
  assert.equal((await fetch(`${url}/dev-auth/login`)).status, 404);
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 503);
  assert.equal((await health.json()).error.code, 'DB_UNAVAILABLE');
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('migración, registro concurrente, login RS256 y semilla contra PostgreSQL', {
  skip: testDatabaseUrl ? false : 'Define TEST_DATABASE_URL para probar PostgreSQL',
}, async (t) => {
  const connectionString = testDatabaseUrl!;
  assert.match(decodeURIComponent(new URL(connectionString).pathname), /^\/auth_test(?:_[a-z0-9_]+)?$/);
  const schema = `auth_test_${randomUUID().replace(/-/g, '')}`;
  const demoPassword = 'demo-local-password';
  const env = { ...process.env, DATABASE_URL: connectionString, DATABASE_SSL: 'false', DB_SCHEMA: schema, DEMO_PASSWORD: demoPassword };
  const db = createPool({ connection: { connectionString, ssl: undefined, connectionTimeoutMillis: 5000, statement_timeout: 5000 }, schema });
  t.after(async () => {
    try {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.end();
    }
  });

  function run(script: string, extraEnv: Record<string, string> = {}) {
    execFileSync(process.execPath, ['--import', 'tsx', `scripts/${script}.ts`], { env: { ...env, ...extraEnv }, timeout: 15_000 });
  }

  const url = await serve(t, usersRepository(db));
  assert.equal((await fetch(`${url}/health`)).status, 503);
  run('migrate');
  run('migrate');
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { status: 'ok', service: 'auth' });

  const credentials = { name: ' Cliente ', email: ' CLIENTE@EXAMPLE.COM ', password: 'contraseña de prueba' };
  const registrations = await Promise.all([post(url, 'register', credentials), post(url, 'register', credentials)]);
  assert.deepEqual(registrations.map((response) => response.status).sort(), [201, 409]);
  const created = registrations.find((response) => response.status === 201)!;
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const { token, user } = await created.json();
  assert.deepEqual(user, { id: user.id, role: 'customer', email: 'cliente@example.com', name: 'Cliente' });

  const verification = { algorithms: ['RS256'], issuer, audience, requiredClaims: ['sub', 'role', 'email', 'iat', 'exp'] };
  const { payload } = await jwtVerify(token, publicKey, verification);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.email, user.email);
  assert.equal(payload.role, user.role);
  assert.equal(payload.exp! - payload.iat!, ttlSeconds);
  await assert.rejects(jwtVerify(token, publicKey, { ...verification, currentDate: new Date(payload.exp! * 1000) }), { code: 'ERR_JWT_EXPIRED' });

  const stored = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  assert.match(stored.rows[0].password_hash, /^scrypt\$/);
  assert.equal(await verifyPassword(credentials.password, stored.rows[0].password_hash), true);
  const login = await post(url, 'login', { email: credentials.email, password: credentials.password });
  assert.equal(login.status, 200);
  const loggedIn = await login.json();
  assert.deepEqual(loggedIn.user, user);
  assert.equal((await jwtVerify(loggedIn.token, publicKey, verification)).payload.sub, user.id);

  const [wrong, missing] = await Promise.all([
    post(url, 'login', { email: user.email, password: 'incorrecta' }),
    post(url, 'login', { email: 'nadie@example.com', password: 'incorrecta' }),
  ]);
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual((await wrong.json()).error, (await missing.json()).error);

  run('seed');
  run('seed', { DEMO_PASSWORD: 'otra clave local' });
  for (const demo of demoUsers) {
    const response = await post(url, 'login', { email: demo.email, password: demoPassword });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user, demo);
  }
  assert.equal((await db.query('SELECT count(*) FROM users')).rows[0].count, '4');
});
