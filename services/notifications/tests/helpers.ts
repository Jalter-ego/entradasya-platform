import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { simpleParser, type ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { createApp } from '../src/app.js';
import { createSmtpMailer } from '../src/email/mailer.js';

export const INTERNAL_TOKEN = 'test-internal-token-orders-notifications-01';
export const PUBLIC_WEB_URL = 'http://localhost:8080';

const port = (server: { address(): unknown }) => (server.address() as AddressInfo).port;

/** Servidor SMTP real en memoria, como Mailpit: guarda cada correo recibido. */
export async function startFakeSmtp() {
  const inbox: (ParsedMail & { envelopeTo: string[] })[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((mail) => {
          inbox.push(Object.assign(mail, { envelopeTo: session.envelope.rcptTo.map((r) => r.address) }));
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: port(server.server),
    inbox,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Acepta la conexión TCP pero nunca saluda: simula un SMTP colgado. */
export async function startSilentSmtp() {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: port(server),
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Devuelve un puerto libre en el que no escucha nadie (SMTP apagado). */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const free = port(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return free;
}

export async function startService(smtpPort: number, timeoutMs = 2_000) {
  const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtpPort, secure: false, timeoutMs }, 'EntradasYa <no-reply@entradasya.local>');
  const app = createApp({ mailer, internalToken: INTERNAL_TOKEN, publicWebUrl: PUBLIC_WEB_URL, timezone: 'America/La_Paz' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${port(server)}`;

  async function post(body: unknown, token: string | null = INTERNAL_TOKEN) {
    const response = await fetch(`${baseUrl}/internal/notifications/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === null ? {} : { 'x-internal-token': token }) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  return {
    baseUrl,
    post,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      mailer.close();
    },
  };
}
