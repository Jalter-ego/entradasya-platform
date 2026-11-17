/**
 * AUTH DE PRUEBA — solo en `npm run dev`, nunca en el build.
 *
 * Mientras el servicio auth (P1) no exista, este plugin de Vite responde
 * POST /dev-auth/login con un JWT firmado con services/events/keys/dev-private.pem,
 * igual al que emitirá auth. Las contraseñas de demo están aquí a la vista a propósito:
 * no hay usuarios reales. Cuando auth esté listo, la web llama a /api/auth/login
 * y este archivo se borra.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const DEMO_USERS = [
  {
    id: '00000000-0000-4000-8000-000000000001', // SEED_ORGANIZER_ID: dueño de los eventos de demo
    email: 'organizador@demo.bo',
    password: 'demo1234',
    role: 'organizer',
    name: 'Organizador de demo',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'cliente@demo.bo',
    password: 'demo1234',
    role: 'customer',
    name: 'Cliente de demo',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'portero@demo.bo',
    password: 'demo1234',
    role: 'doorman',
    name: 'Portero de demo',
  },
];

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

function signRs256(payload: Record<string, unknown>, privateKeyPem: string): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(signature)}`;
}

export function devAuth(): Plugin {
  const keyPath = resolve(process.env.DEV_JWT_PRIVATE_KEY ?? '../../services/events/keys/dev-private.pem');
  const issuer = process.env.JWT_ISSUER ?? 'entradasya-auth';
  const audience = process.env.JWT_AUDIENCE ?? 'entradasya';

  return {
    name: 'entradasya-dev-auth',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-auth/login', (req, res) => {
        const send = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        if (req.method !== 'POST') return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Usa POST' } });

        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          let email = '';
          let password = '';
          try {
            ({ email = '', password = '' } = JSON.parse(raw || '{}'));
          } catch {
            return send(400, { error: { code: 'INVALID_JSON', message: 'El cuerpo no es JSON válido' } });
          }
          const user = DEMO_USERS.find(
            (u) => u.email === String(email).trim().toLowerCase() && u.password === String(password),
          );
          if (!user) {
            return send(401, { error: { code: 'INVALID_CREDENTIALS', message: 'El correo o la contraseña no son correctos.' } });
          }

          let key: string;
          try {
            key = readFileSync(keyPath, 'utf8');
          } catch {
            return send(503, {
              error: {
                code: 'DEV_KEY_MISSING',
                message: 'Falta la clave de desarrollo (services/events/keys/dev-private.pem). Ver el README de events.',
              },
            });
          }

          const now = Math.floor(Date.now() / 1000);
          const token = signRs256(
            { sub: user.id, role: user.role, email: user.email, name: user.name, iss: issuer, aud: audience, iat: now, exp: now + 8 * 3600 },
            key,
          );
          send(200, { token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
        });
      });
    },
  };
}
