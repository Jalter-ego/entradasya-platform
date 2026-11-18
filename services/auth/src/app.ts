import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { createTokenSigner } from './jwt.js';
import { log } from './logger.js';
import { hashPassword, verifyPassword } from './password.js';
import { demoUsers, type usersRepository } from './users.js';
import { loginBody, registerBody } from './validation.js';

const registerPath = '/api/auth/register';
const loginPath = '/api/auth/login';

class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const acceptJson: RequestHandler = (req, _res, next) => {
  if (req.is('application/json') === false) {
    throw new AuthError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envía el cuerpo como JSON UTF-8.');
  }
  next();
};
const parseJson = express.json({ limit: '4kb' });

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  const requestId = res.getHeader('x-request-id');
  let problem = error;
  if (error?.type === 'entity.parse.failed') {
    problem = new AuthError(400, 'INVALID_JSON', 'El cuerpo no es JSON válido.');
  } else if (error?.type === 'entity.too.large') {
    problem = new AuthError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el tamaño permitido.');
  } else if (error?.status === 415) {
    problem = new AuthError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envía el cuerpo como JSON UTF-8.');
  }
  if (!(problem instanceof AuthError)) {
    log('error', 'Error inesperado al procesar la petición', { requestId });
    problem = new AuthError(500, 'INTERNAL_ERROR', 'Error interno.');
  }
  res.status(problem.status).json({ error: { code: problem.code, message: problem.message }, requestId });
};

export function createApp(users: ReturnType<typeof usersRepository>, signToken: ReturnType<typeof createTokenSigner>) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const supplied = req.header('x-request-id');
    const requestId = supplied && /^[\w.-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    const started = performance.now();
    const path = ['/health', registerPath, loginPath].includes(req.path) ? req.path : undefined;
    res.set('x-request-id', requestId);
    res.set('Cache-Control', 'no-store');
    res.on('finish', () => {
      log('info', 'request', {
        requestId, path, method: req.method, status: res.statusCode, ms: Math.round(performance.now() - started),
      });
    });
    next();
  });
  app.get('/health', async (_req, res) => {
    try {
      await users.checkHealth();
    } catch {
      log('warn', 'Base de cuentas indisponible', { requestId: res.getHeader('x-request-id') });
      throw new AuthError(503, 'DB_UNAVAILABLE', 'La base de cuentas no está disponible.');
    }
    res.json({ status: 'ok', service: 'auth' });
  });

  app.post(registerPath, acceptJson, parseJson, async (req, res) => {
    const body = registerBody.safeParse(req.body);
    if (!body.success) {
      throw new AuthError(400, 'VALIDATION_ERROR', 'Envía nombre, correo válido y contraseña de 8 a 128 caracteres.');
    }
    const { name, email, password } = body.data;
    const duplicate = new AuthError(409, 'EMAIL_TAKEN', 'No se puede registrar ese correo.');
    if (demoUsers.some((user) => user.email === email)) throw duplicate;
    const user = await users.createCustomer(name, email, await hashPassword(password));
    if (!user) throw duplicate;
    res.status(201).json({ token: await signToken(user), user });
  });

  app.post(loginPath, acceptJson, parseJson, async (req, res) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) throw new AuthError(400, 'VALIDATION_ERROR', 'Envía un correo válido y tu contraseña.');
    const { email, password } = body.data;
    const account = await users.findByEmail(email);
    if (!await verifyPassword(password, account?.password_hash) || !account) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'El correo o la contraseña no son correctos.');
    }
    const { id, name, role } = account;
    const user = { id, name, email: account.email, role };
    res.json({ token: await signToken(user), user });
  });

  app.use(() => { throw new AuthError(404, 'NOT_FOUND', 'Ruta no encontrada.'); });
  app.use(handleError);
  return app;
}
