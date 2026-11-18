import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createSmtpMailer } from './email/mailer.js';
import { log } from './logger.js';

const config = loadConfig();
const mailer = createSmtpMailer(config.smtp, config.mailFrom);

const app = createApp({
  mailer,
  internalToken: config.internalTokenOrders,
  publicWebUrl: config.publicWebUrl,
  timezone: config.timezone,
});

const server = app.listen(config.port, config.host, () => {
  log('info', `notifications escuchando en http://${config.host}:${config.port}`, {
    smtp: `${config.smtp.host}:${config.smtp.port}`,
  });
});

function shutdown(signal: string) {
  log('info', `recibido ${signal}, cerrando`);
  server.close(() => {
    mailer.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
