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

export async function renderTicket(record: TicketRecord, timeZone: string): Promise<Buffer> {
  const input = record.snapshot;
  const qr = await QRCode.toBuffer(record.code, { type: 'png', width: 600, margin: 4, errorCorrectionLevel: 'M' });
  const doc = new PDFDocument({ size: 'A5', margins: { top: 32, bottom: 16, left: 32, right: 32 }, autoFirstPage: true, info: {
    Title: `Entrada ${record.ticket_number} - ${input.event.title}`, Author: 'EntradasYa',
  } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width;
  const contentWidth = width - 64;
  doc.rect(0, 0, width, 68).fill('#143B48');
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('ENTRADASYA', 32, 19);
  doc.font('Helvetica').fontSize(9).text('ENTRADA AL EVENTO', 32, 46);
  doc.fillColor('#143B48').font('Helvetica-Bold');
  let titleSize = 20;
  while (titleSize > 11) {
    doc.fontSize(titleSize);
    if (doc.heightOfString(input.event.title, { width: contentWidth }) <= 64) break;
    titleSize--;
  }
  doc.fontSize(titleSize).text(input.event.title, 32, 88, { width: contentWidth, height: 66 });

  const label = (name: string, x: number, y: number) => {
    doc.fillColor('#64747C').font('Helvetica-Bold').fontSize(8).text(name, x, y);
  };
  label('FECHA Y HORA', 32, 163);
  const startsAt = new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(new Date(input.event.startsAt));
  doc.fillColor('#172F39').font('Helvetica').fontSize(11).text(startsAt, 32, 178, { width: 215 });
  doc.fontSize(7).fillColor('#64747C').text(timeZone, 32, 194, { width: 215 });
  label('PRECIO', 270, 163);
  doc.font('Helvetica').fontSize(11).fillColor('#172F39')
    .text(`${input.currency} ${(input.unitPriceMinor / 100).toFixed(2)}`, 270, 178, { width: width - 302 });
  label('LUGAR', 32, 219);
  doc.font('Helvetica').fontSize(11).fillColor('#172F39')
    .text(input.event.venue, 32, 234, { width: contentWidth, height: 55 });
  label('SECTOR', 32, 292);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#172F39')
    .text(input.sector.name, 32, 306, { width: contentWidth, height: 34 });

  doc.image(qr, (width - 150) / 2, 347, { width: 150, height: 150 });
  doc.font('Courier').fontSize(8).fillColor('#172F39')
    .text(record.code, 32, 508, { width: contentWidth, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(10)
    .text(`Entrada ${record.ticket_number} de ${input.quantity}`, 32, 531, { width: contentWidth, align: 'center' });
  doc.font('Helvetica').fontSize(7).fillColor('#64747C')
    .text(`Orden: ${record.order_id}`, 32, 549, { width: contentWidth, align: 'center' });
  doc.fontSize(8).text('Presenta este QR o código para ingresar. Uso único.', 32, 568, {
    width: contentWidth, align: 'center', lineBreak: false,
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
    const finalPath = join(this.directory, `${record.id}.pdf`);
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
