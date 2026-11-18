import { generateKeyPairSync } from 'node:crypto';
import { testDatabaseUrl } from './testDatabase.js';

/**
 * Antes de cada archivo de prueba (y antes de que se importe src/config): variables de entorno
 * de prueba y un par RSA temporal. No se usa la clave de desarrollo ni el .env real.
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

Object.assign(process.env, {
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl(),
  DATABASE_SSL: 'false',
  JWT_PUBLIC_KEY_FILE: '',
  JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  JWT_ALG: 'RS256',
  JWT_ISSUER: 'entradasya-auth',
  JWT_AUDIENCE: 'entradasya',
});

(globalThis as { testPrivateKeyPem?: string }).testPrivateKeyPem =
  privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
