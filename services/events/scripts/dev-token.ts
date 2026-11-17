// SOLO DESARROLLO: firma un JWT de prueba con keys/dev-private.pem mientras auth (P1) no exista.
// Uso: npm run dev-token -- organizer [uuid]     (roles: customer | organizer | doorman)
// La clave pública correspondiente debe ser la de JWT_PUBLIC_KEY_FILE.
import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';

const role = process.argv[2] ?? 'organizer';
// Por defecto, el mismo organizador de la semilla: así ve los eventos de demo.
const sub = process.argv[3] ?? process.env.SEED_ORGANIZER_ID ?? '00000000-0000-4000-8000-000000000001';
const alg = process.env.JWT_ALG || 'RS256';

let pem: string;
try {
  pem = readFileSync(process.env.DEV_PRIVATE_KEY_FILE ?? './keys/dev-private.pem', 'utf8');
} catch {
  console.error('No encuentro keys/dev-private.pem. Genera un par de claves de desarrollo (ver README).');
  process.exit(1);
}

const token = await new SignJWT({ role, email: `${role}@demo.local` })
  .setProtectedHeader({ alg })
  .setSubject(sub)
  .setIssuer(process.env.JWT_ISSUER ?? 'entradasya-auth')
  .setAudience(process.env.JWT_AUDIENCE ?? 'entradasya')
  .setIssuedAt()
  .setExpirationTime('8h')
  .sign(await importPKCS8(pem, alg));

console.log(token);
