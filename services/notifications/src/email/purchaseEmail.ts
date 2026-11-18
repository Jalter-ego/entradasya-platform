export interface PurchaseNotification {
  orderId: string;
  to: string;
  event: { title: string; venue: string; startsAt: string };
  sector: { name: string };
  quantity: number;
  totalMinor: number;
  currency: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
  ticketsUrl: string;
}

/** 123456 -> "1.234,56" sin pasar por números decimales. */
export function formatMinor(amountMinor: number): string {
  const units = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped},${cents}`;
}

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-BO', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Enlace público a Mis entradas filtrado por la orden. No lleva JWT ni ruta al PDF:
 * el comprador inicia sesión y tickets comprueba que las entradas son suyas.
 */
export function ticketsLink(publicWebUrl: string, orderId: string): string {
  const url = new URL('/mis-entradas', `${publicWebUrl}/`);
  url.searchParams.set('orderId', orderId);
  return url.toString();
}

export function buildPurchaseEmail(
  input: PurchaseNotification,
  options: { publicWebUrl: string; timezone: string },
): EmailContent {
  const ticketsUrl = ticketsLink(options.publicWebUrl, input.orderId);
  const when = formatDate(input.event.startsAt, options.timezone);
  const total = `${formatMinor(input.totalMinor)} ${input.currency}`;
  const entries = input.quantity === 1 ? '1 entrada' : `${input.quantity} entradas`;

  const rows: [string, string][] = [
    ['Evento', input.event.title],
    ['Fecha', when],
    ['Lugar', input.event.venue],
    ['Sector', input.sector.name],
    ['Cantidad', entries],
    ['Total pagado', total],
    ['N.º de orden', input.orderId],
  ];

  const subject = `Compra confirmada: ${input.event.title}`;

  const text = [
    '¡Gracias por tu compra en EntradasYa!',
    '',
    'Tu pago fue aprobado y tus entradas ya están listas.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Descarga tus entradas (PDF con código QR) desde Mis entradas:',
    ticketsUrl,
    '',
    'Inicia sesión con la misma cuenta con la que compraste. Cada entrada es válida para un solo ingreso.',
    '',
    'Correo de demostración: no se cobró dinero real.',
  ].join('\n');

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#111827;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#4f46e5;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:700">EntradasYa</td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 8px;font-size:20px;color:#111827">¡Compra confirmada!</h1>
      <p style="margin:0 0 16px;color:#374151">Tu pago fue aprobado y tus entradas ya están listas.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;margin-bottom:20px">${htmlRows}</table>
      <p style="margin:0 0 20px">
        <a href="${escapeHtml(ticketsUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Ver mis entradas</a>
      </p>
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Descarga el PDF con código QR desde Mis entradas. Inicia sesión con la misma cuenta con la que compraste; cada entrada es válida para un solo ingreso.</p>
      <p style="margin:0;color:#9ca3af;font-size:12px">Correo de demostración: no se cobró dinero real.</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html, ticketsUrl };
}
