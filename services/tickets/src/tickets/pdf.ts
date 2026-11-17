import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, stat, unlink, writeFile, constants } from 'node:fs/promises';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { AppError } from '../http/errors.js';
import { log } from '../logger.js';
import type { TicketRecord } from './repository.js';

export interface TicketPdf {
  ensure(record: TicketRecord): Promise<string>;
  ready(): Promise<void>;
}

// Cambiar la versión al modificar la plantilla para regenerar también entradas ya emitidas.
export const PDF_LAYOUT_VERSION = 2;

// Paleta de apps/web/src/styles/global.css. El cuerpo claro permite imprimir el QR sin perder contraste.
const colors = {
  ink: '#16131F',
  surface: '#211D2C',
  accent: '#E5266A',
  accentText: '#FF7AA6',
  paper: '#F4F2F9',
  line: '#DDD7E7',
  muted: '#6A627C',
  white: '#FFFFFF',
};

export async function renderTicket(record: TicketRecord, timeZone: string): Promise<Buffer> {
  const input = record.snapshot;
  const qr = await QRCode.toBuffer(record.code, {
    type: 'png', width: 720, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const doc = new PDFDocument({ size: 'A5', margin: 0, autoFirstPage: true, info: {
    Title: `Entrada ${record.ticket_number} - ${input.event.title}`, Author: 'EntradasYa',
    Subject: `Entrada digital - diseño ${PDF_LAYOUT_VERSION}`,
  } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const { width, height } = doc.page;
  const left = 42;
  const contentWidth = width - left * 2;
  const card = { x: 20, y: 20, width: width - 40, height: height - 40 };

  // Ajustar la fuente por medición real, sin cortar nombres de evento, lugares ni sectores.
  const textBlock = (text: string, x: number, y: number, w: number, h: number, size: number, font = 'Helvetica', color = colors.ink) => {
    doc.font(font).fillColor(color);
    let fitted = size;
    while (fitted > 7) {
      doc.fontSize(fitted);
      if (doc.heightOfString(text, { width: w, lineGap: 2 }) <= h && doc.widthOfString(text) <= w * Math.max(1, Math.floor(h / (fitted + 2)))) break;
      fitted -= 0.5;
    }
    doc.fontSize(fitted).text(text, x, y, { width: w, height: h, lineGap: 2 });
  };
  const label = (text: string, x: number, y: number, w = contentWidth) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.muted)
      .text(text, x, y, { width: w, characterSpacing: 0.8, lineBreak: false });
  };

  doc.rect(0, 0, width, height).fill(colors.paper);
  doc.roundedRect(card.x, card.y, card.width, card.height, 18).fillAndStroke(colors.white, colors.line);
  doc.save().roundedRect(card.x, card.y, card.width, card.height, 18).clip();
  doc.rect(card.x, card.y, card.width, 180).fill(colors.ink);
  doc.rect(card.x, card.y, card.width, 4).fill(colors.accent);
  doc.restore();

  // Misma silueta de entrada que la marca del encabezado web.
  doc.save().translate(left - 3, 41).scale(0.9)
    .path('M4 8h24v5a3 3 0 0 0 0 6v5H4v-5a3 3 0 0 0 0-6z').fill(colors.accent).restore();
  doc.font('Helvetica-Bold').fontSize(23).fillColor(colors.white)
    .text('EntradasYa', left + 32, 44, { width: 195, lineBreak: false });

  const badgeX = width - 114;
  doc.roundedRect(badgeX, 40, 72, 35, 9).fill(colors.surface);
  doc.font('Helvetica-Bold').fontSize(6).fillColor(colors.accentText)
    .text('ENTRADA', badgeX, 46, { width: 72, align: 'center', characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.white)
    .text(`${String(record.ticket_number).padStart(2, '0')} / ${String(input.quantity).padStart(2, '0')}`, badgeX, 57, { width: 72, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.accentText)
    .text('ENTRADA DIGITAL', left, 87, { width: contentWidth, characterSpacing: 1.8 });
  textBlock(input.event.title, left, 107, contentWidth, 78, 25, 'Helvetica-Bold', colors.white);

  const date = new Date(input.event.startsAt);
  const dateLabel = new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date);
  const timeLabel = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  const price = `${input.currency} ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.unitPriceMinor / 100)}`;
  const priceX = width - 147;
  label('FECHA Y HORA', left, 220, 205);
  textBlock(dateLabel, left, 234, 200, 20, 15, 'Helvetica-Bold');
  textBlock(`${timeLabel} h / ${timeZone}`, left, 256, 205, 24, 8, 'Helvetica', colors.muted);
  label('PRECIO UNITARIO', priceX, 220, 105);
  textBlock(price, priceX, 235, 105, 35, 15, 'Helvetica-Bold');
  label('LUGAR', left, 289);
  textBlock(input.event.venue, left, 302, contentWidth, 40, 12.5);
  label('SECTOR', left, 353);
  textBlock(input.sector.name, left, 366, contentWidth, 29, 13, 'Helvetica-Bold');

  // Perforación y muescas: el talón de acceso tiene su propio espacio.
  doc.save().strokeColor(colors.line).lineWidth(1).dash(3, { space: 4 })
    .moveTo(card.x + 12, 409).lineTo(width - card.x - 12, 409).stroke().restore();
  doc.circle(card.x, 409, 6).fill(colors.paper);
  doc.circle(width - card.x, 409, 6).fill(colors.paper);

  // QR sin tintes ni fondos oscuros; incluye cuatro módulos de zona de silencio.
  doc.image(qr, left - 2, 422, { width: 128, height: 128 });
  const stubX = left + 145;
  const stubWidth = contentWidth - 145;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(colors.accent)
    .text('ACCESO AL EVENTO', stubX, 429, { width: stubWidth, characterSpacing: 0.8 });
  textBlock('Tu código\nde ingreso', stubX, 446, stubWidth, 44, 19, 'Helvetica-Bold');
  label('CÓDIGO ALTERNATIVO', stubX, 500, stubWidth);
  // Dos líneas, sin añadir separadores que cambien el código real.
  doc.font('Courier').fontSize(8).fillColor(colors.ink)
    .text(`${record.code.slice(0, 22)}\n${record.code.slice(22)}`, stubX, 513, { width: stubWidth, lineGap: 2 });
  doc.font('Helvetica').fontSize(7).fillColor(colors.muted)
    .text(`Orden: ${record.order_id}`, left, 558, { width: contentWidth, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6.5).fillColor(colors.muted)
    .text('Presenta este PDF en pantalla o impreso. Cada entrada permite un único ingreso.', card.x, height - 13, {
      width: card.width, align: 'center', lineBreak: false,
  });
  doc.end();
  return result;
}

export class FileTicketPdf implements TicketPdf {
  constructor(private readonly directory: string, private readonly timeZone: string) {}

  async ready() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await access(this.directory, constants.R_OK | constants.W_OK);
  }

  async ensure(record: TicketRecord): Promise<string> {
    // El nombre proviene del UUID persistido, nunca de una ruta enviada por el cliente.
    const finalPath = join(this.directory, `${record.id}.v${PDF_LAYOUT_VERSION}.pdf`);
    try {
      if ((await stat(finalPath)).size > 0) return finalPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return this.unavailable(error);
    }
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    try {
      const bytes = await renderTicket(record, this.timeZone);
      await writeFile(temporaryPath, bytes, { mode: 0o600, flag: 'wx' });
      // Un lector nunca recibe un archivo a medio generar, incluso con reintentos concurrentes.
      await rename(temporaryPath, finalPath);
      return finalPath;
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      return this.unavailable(error);
    }
  }

  private unavailable(error: unknown): never {
    log('error', 'pdf_generation_failed', { errorType: error instanceof Error ? error.name : 'Error' });
    throw new AppError(503, 'PDF_UNAVAILABLE', 'No se pudo preparar el PDF; reintenta la misma orden');
  }
}
