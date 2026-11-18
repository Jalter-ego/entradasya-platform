import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPurchaseEmail, formatMinor, ticketsLink } from '../src/email/purchaseEmail.js';
import { maskEmail } from '../src/routes/internal.js';
import { closedPort, PUBLIC_WEB_URL, startFakeSmtp, startService, startSilentSmtp } from './helpers.js';

/** Mismo cuerpo que arma orders en src/builders/purchaseNotification.ts. */
function notification(overrides: Record<string, unknown> = {}) {
  return {
    orderId: randomUUID(),
    to: 'cliente@demo.bo',
    event: { title: 'Noche de Rock', venue: 'Estadio Central', startsAt: '2026-12-20T23:00:00.000Z' },
    sector: { name: 'General' },
    quantity: 2,
    totalMinor: 10_000,
    currency: 'BOB',
    ...overrides,
  };
}

describe('con el servidor SMTP disponible', () => {
  let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
  let svc: Awaited<ReturnType<typeof startService>>;

  beforeAll(async () => {
    smtp = await startFakeSmtp();
    svc = await startService(smtp.port);
  });
  afterAll(async () => {
    await svc?.stop();
    await smtp?.stop();
  });
  beforeEach(() => {
    smtp.inbox.length = 0;
  });

  it('/health responde 200', async () => {
    const res = await fetch(`${svc.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'notifications' });
  });

  it('exige el token interno de orders (D7)', async () => {
    expect((await svc.post(notification(), null)).status).toBe(401);
    expect((await svc.post(notification(), 'token-incorrecto-0123456789abcdef')).status).toBe(401);
    expect(smtp.inbox).toHaveLength(0);
  });

  it('no expone rutas públicas', async () => {
    expect((await fetch(`${svc.baseUrl}/api/notifications`)).status).toBe(404);
  });

  it('envía la confirmación con resumen y enlace a Mis entradas (D4)', async () => {
    const body = notification();
    const res = await svc.post(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId: body.orderId, status: 'sent' });
    expect(res.body.messageId).toBe(`<compra-${body.orderId}@entradasya.local>`);

    expect(smtp.inbox).toHaveLength(1);
    const mail = smtp.inbox[0];
    expect(mail.envelopeTo).toEqual(['cliente@demo.bo']);
    expect(mail.subject).toBe('Compra confirmada: Noche de Rock');
    expect(mail.headers.get('x-entradasya-order')).toBe(body.orderId);

    const link = `${PUBLIC_WEB_URL}/mis-entradas?orderId=${body.orderId}`;
    for (const content of [mail.text ?? '', String(mail.html)]) {
      expect(content).toContain('Noche de Rock');
      expect(content).toContain('Estadio Central');
      expect(content).toContain('General');
      expect(content).toContain('2 entradas');
      expect(content).toContain('100,00 BOB');
      expect(content).toContain(link);
    }
    // 23:00 UTC = 19:00 en La Paz.
    expect(mail.text).toMatch(/19:00/);
  });

  it('el correo no lleva JWT, token interno ni ruta directa al PDF', async () => {
    await svc.post(notification());
    const raw = `${smtp.inbox[0].text}\n${smtp.inbox[0].html}`;
    expect(raw).not.toMatch(/Bearer|eyJ|token|\.pdf|\/api\//i);
  });

  it('escapa el HTML de los datos del evento', async () => {
    await svc.post(notification({ event: { title: '<script>alert(1)</script>', venue: 'A & B', startsAt: '2026-12-20T23:00:00Z' } }));
    const html = String(smtp.inbox[0].html);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('rechaza cuerpos inválidos con 400 sin enviar nada', async () => {
    const invalid = [
      { to: 'no-es-correo' },
      { quantity: 0 },
      { quantity: 7 },
      { totalMinor: -1 },
      { totalMinor: 10.5 },
      { currency: 'bob' },
      { orderId: 'x' },
      { event: { title: 'A\r\nBcc: otro@x.com', venue: 'V', startsAt: '2026-12-20T23:00:00Z' } },
      { event: { title: 'A', venue: 'V', startsAt: 'mañana' } },
      { token: 'eyJhbGciOi...' },
    ];
    for (const override of invalid) {
      const res = await svc.post(notification(override));
      expect(res.status, JSON.stringify(override)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(smtp.inbox).toHaveLength(0);
  });

  it('un reenvío de la misma orden manda otro correo con el mismo Message-ID', async () => {
    const body = notification();
    await svc.post(body);
    await svc.post(body);
    expect(smtp.inbox).toHaveLength(2);
    expect(smtp.inbox[0].messageId).toBe(smtp.inbox[1].messageId);
  });
});

describe('con el servidor SMTP caído', () => {
  it('responde 503 SMTP_UNAVAILABLE y /health 503', async () => {
    const svc = await startService(await closedPort());
    try {
      const res = await svc.post(notification());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SMTP_UNAVAILABLE');
      expect((await fetch(`${svc.baseUrl}/health`)).status).toBe(503);
    } finally {
      await svc.stop();
    }
  });

  it('un SMTP colgado responde 504 SMTP_TIMEOUT dentro del límite', async () => {
    const silent = await startSilentSmtp();
    const svc = await startService(silent.port, 300);
    try {
      const started = Date.now();
      const res = await svc.post(notification());
      expect(res.status).toBe(504);
      expect(res.body.error.code).toBe('SMTP_TIMEOUT');
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await svc.stop();
      await silent.stop();
    }
  });
});

describe('utilidades', () => {
  it('formatea importes en unidades menores sin decimales binarios', () => {
    expect(formatMinor(0)).toBe('0,00');
    expect(formatMinor(5)).toBe('0,05');
    expect(formatMinor(10_000)).toBe('100,00');
    expect(formatMinor(123_456_789)).toBe('1.234.567,89');
  });

  it('arma el enlace sin barras duplicadas', () => {
    expect(ticketsLink('http://localhost:8080', 'abc')).toBe('http://localhost:8080/mis-entradas?orderId=abc');
  });

  it('usa singular para una entrada', () => {
    const email = buildPurchaseEmail(notification({ quantity: 1 }) as never, { publicWebUrl: PUBLIC_WEB_URL, timezone: 'America/La_Paz' });
    expect(email.text).toContain('1 entrada\n');
  });

  it('enmascara el correo en los logs', () => {
    expect(maskEmail('cliente@demo.bo')).toBe('c***@demo.bo');
  });
});
