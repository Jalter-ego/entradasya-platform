import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError, notFound } from './http/errors.js';
import { log } from './logger.js';

export const MAX_COVER_BYTES = 3 * 1024 * 1024;
export const COVER_BODY_LIMIT = MAX_COVER_BYTES + 64 * 1024;
const PREFIX = '/api/events/covers/';
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const invalid = () => new AppError(415, 'INVALID_IMAGE', 'Usa una imagen JPEG, PNG o WebP válida.');

/** Comprueba firma y dimensiones; no confía en la extensión del archivo. */
export function imageFormat(b: Buffer): { extension: string; mime: string } {
  let width = 0;
  let height = 0;
  let extension = '';
  let mime = '';
  if (b.length >= 45 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      b.readUInt32BE(8) === 13 && b.toString('ascii', 12, 16) === 'IHDR' &&
      b.subarray(-12, -4).equals(Buffer.from('0000000049454e44', 'hex'))) {
    width = b.readUInt32BE(16); height = b.readUInt32BE(20);
    extension = 'png'; mime = 'image/png';
  } else if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && b.readUInt32LE(16) === 10) {
      width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1;
    } else if (chunk === 'VP8 ' && b.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
      width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && b[20] === 0x2f) {
      const dimensions = b.readUInt32LE(21);
      width = (dimensions & 0x3fff) + 1; height = ((dimensions >>> 14) & 0x3fff) + 1;
    }
    extension = 'webp'; mime = 'image/webp';
  } else if (b.length > 4 && b.readUInt16BE(0) === 0xffd8 && b.readUInt16BE(b.length - 2) === 0xffd9) {
    let offset = 2;
    while (offset + 4 < b.length) {
      if (b[offset++] !== 0xff) break;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) break;
      const size = b.readUInt16BE(offset);
      if (size < 2 || offset + size > b.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
        height = b.readUInt16BE(offset + 3); width = b.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
    extension = 'jpg'; mime = 'image/jpeg';
  }
  if (!width || !height || width > 10000 || height > 10000 || width * height > 25_000_000) throw invalid();
  return { extension, mime };
}

/** El límite del cuerpo se aplica ANTES de invocar el parser multipart nativo. */
export async function parseCover(body: Buffer, contentType: string) {
  if (body.length > COVER_BODY_LIMIT) throw new AppError(413, 'IMAGE_TOO_LARGE', 'La portada no debe superar 3 MB.');
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw new AppError(400, 'INVALID_MULTIPART', 'El archivo no se recibió correctamente.');
  }
  const images = form.getAll('image');
  if (images.length !== 1 || typeof images[0] === 'string' || [...form.keys()].some((key) => key !== 'image')) {
    throw new AppError(400, 'INVALID_MULTIPART', 'Envía un solo archivo en el campo image.');
  }
  const image = images[0];
  if (image.size > MAX_COVER_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'La portada no debe superar 3 MB.');
  const bytes = Buffer.from(await image.arrayBuffer());
  const format = imageFormat(bytes);
  if (image.type && image.type !== format.mime && image.type !== 'application/octet-stream') throw invalid();
  return { bytes, ...format };
}

export class CoverStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }

  async ready() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }

  async save(image: Awaited<ReturnType<typeof parseCover>>) {
    const name = `${randomUUID()}.${image.extension}`;
    try {
      await writeFile(resolve(this.directory, name), image.bytes, { flag: 'wx', mode: 0o600 });
    } catch {
      await this.remove(`${PREFIX}${name}`);
      throw new AppError(503, 'COVER_STORAGE_UNAVAILABLE', 'No se pudo guardar la portada. Intenta de nuevo.');
    }
    return `${PREFIX}${name}`;
  }

  async read(name: string) {
    if (!NAME.test(name)) throw notFound('Portada');
    try {
      return {
        bytes: await readFile(resolve(this.directory, name)),
        mime: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : 'image/webp',
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('Portada');
      throw new AppError(503, 'COVER_STORAGE_UNAVAILABLE', 'La portada no está disponible.');
    }
  }

  /** Solo elimina archivos propios. Una URL externa nunca se usa como ruta. */
  async remove(url: string | null) {
    if (!url?.startsWith(PREFIX) || !NAME.test(url.slice(PREFIX.length))) return;
    try { await unlink(resolve(this.directory, url.slice(PREFIX.length))); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log('warn', 'cover_cleanup_failed');
    }
  }
}
