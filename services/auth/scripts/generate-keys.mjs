import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const directory = new URL('../keys/', import.meta.url);
const privateFile = new URL('auth-private.pem', directory);
const publicFile = new URL('auth-public.pem', directory);
if (existsSync(privateFile) || existsSync(publicFile)) {
  console.error('Ya existe una clave de auth en keys/. Conserva el par existente.');
  process.exitCode = 1;
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(privateFile, privateKey, { flag: 'wx', mode: 0o600 });
  writeFileSync(publicFile, publicKey, { flag: 'wx' });
  console.log('Par RSA generado en keys/. Comparte únicamente auth-public.pem.');
}
