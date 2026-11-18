import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CoverStore, MAX_COVER_BYTES, imageFormat, parseCover } from '../src/covers.js';
import type { Db } from '../src/db.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGN8qpbFwMDAxMDAwMDAAAASIQF58UO/hgAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAABQAQCdASoCAAIAAUAmJaAABDOAAP7tTV//++gH/99AP/76Af18AAAA', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGoooqj9QP/9k=', 'base64');
const ID = '00000000-0000-4000-8000-000000000010';
const OWNER = '00000000-0000-4000-8000-000000000001';

async function multipart(bytes = PNG, mime = 'image/png', count = 1) {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append('image', new Blob([new Uint8Array(bytes)], { type: mime }), '../../portada.svg');
  const request = new Request('http://localhost/', { method: 'POST', body: form });
  return { body: Buffer.from(await request.arrayBuffer()), contentType: request.headers.get('content-type')! };
}

/** Ejecuta Express y sus parsers reales sin abrir puertos ni requerir Postgres. */
async function call(app: ReturnType<typeof createApp>, method: string, path: string,
  options: { body?: Buffer; contentType?: string; token?: string } = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const req = new IncomingMessage(socket as never);
  req.method = method; req.url = path;
  req.headers = { host: 'localhost', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...(options.contentType ? { 'content-type': options.contentType } : {}),
    ...(options.body ? { 'content-length': String(options.body.length) } : {}) };
  const res = new ServerResponse(req);
  res.assignSocket(socket as never);
  let timer: ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Express request timed out')), 3000);
      res.on('finish', resolve); res.on('error', reject);
      app.handle(req, res);
      if (options.body) req.push(options.body);
      req.complete = true;
      req.push(null);
    });
    const raw = Buffer.concat(chunks);
    const body = raw.subarray(raw.indexOf('\r\n\r\n') + 4);
    return { status: res.statusCode, headers: res.getHeaders(), body, json: () => JSON.parse(body.toString()) };
  } finally { clearTimeout(timer!); socket.destroy(); }
}

let directory: string;
let covers: CoverStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'entradasya-covers-')); covers = new CoverStore(directory); await covers.ready(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function service() {
  const date = new Date();
  let row = { id: ID, organizer_id: OWNER, title: 'Evento', description: '', venue: 'Teatro', city: 'La Paz',
    category: 'concierto', starts_at: date, image_url: null as string | null, currency: 'BOB', status: 'draft', created_at: date, updated_at: date };
  let snapshot = { ...row };
  let failUpdate = false;
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql === 'BEGIN') snapshot = { ...row };
    if (sql === 'ROLLBACK') row = { ...snapshot };
    if (sql.startsWith('UPDATE events')) {
      if (failUpdate) throw new Error('simulated database failure');
      if (sql.includes('image_url = $2')) row.image_url = args[1] as string | null;
    }
    return { rows: sql.startsWith('SELECT * FROM events') ? [{ ...row }] : [] };
  };
  const db = { query, connect: async () => ({ query, release() {} }) } as unknown as Db;
  const app = createApp({ db, covers, currency: 'BOB', internalToken: 'test', verifyToken: async (token) => ({
    id: token === 'other' ? 'another-organizer' : OWNER, role: token === 'customer' ? 'customer' : 'organizer',
  }) });
  return { app, row: () => row, fail: () => { failUpdate = true; } };
}

describe('validación y almacenamiento de portadas', () => {
  it.each([['png', PNG], ['jpg', JPEG], ['webp', WEBP]] as const)('reconoce el contenido real de una imagen %s', (extension, bytes) => {
    expect(imageFormat(bytes).extension).toBe(extension);
  });
  it('rechaza SVG, archivos truncados, MIME falso y dimensiones excesivas', async () => {
    for (const bytes of [Buffer.from('<svg/>'), PNG.subarray(0, 20), Buffer.from('not an image')]) expect(() => imageFormat(bytes)).toThrow();
    const large = Buffer.from(PNG); large.writeUInt32BE(20000, 16);
    expect(() => imageFormat(large)).toThrow();
    const form = await multipart(PNG, 'image/jpeg');
    await expect(parseCover(form.body, form.contentType)).rejects.toMatchObject({ status: 415 });
  });
  it('rechaza más de 3 MB, campos duplicados y multipart mal formado', async () => {
    const large = await multipart(Buffer.alloc(MAX_COVER_BYTES + 1));
    await expect(parseCover(large.body, large.contentType)).rejects.toMatchObject({ status: 413 });
    const duplicate = await multipart(PNG, 'image/png', 2);
    await expect(parseCover(duplicate.body, duplicate.contentType)).rejects.toMatchObject({ status: 400 });
    await expect(parseCover(Buffer.from('invalid'), 'multipart/form-data')).rejects.toMatchObject({ status: 400 });
  });
  it('genera nombres propios y bloquea rutas arbitrarias', async () => {
    const form = await multipart(); const url = await covers.save(await parseCover(form.body, form.contentType));
    expect(url).toMatch(/^\/api\/events\/covers\/[a-f0-9-]+\.png$/);
    expect((await covers.read(url.split('/').at(-1)!)).bytes).toEqual(PNG);
    await covers.remove('https://example.com/test.png');
    await covers.remove('/api/events/covers/../../test.png');
    expect(await readdir(directory)).toHaveLength(1);
    await expect(covers.read('../test.png')).rejects.toMatchObject({ status: 404 });
  });
});

describe('HTTP de portadas con transacciones simuladas', () => {
  it('exige sesión, rol y propiedad antes de recibir el archivo; bloquea cancelados', async () => {
    const svc = service();
    for (const [token, status] of [[undefined, 401], ['customer', 403], ['other', 403]] as const) {
      expect((await call(svc.app, 'POST', `/api/events/${ID}/cover`, { token })).status).toBe(status);
    }
    svc.row().status = 'cancelled';
    expect((await call(svc.app, 'POST', `/api/events/${ID}/cover`, { token: 'owner' })).status).toBe(409);
    expect(await readdir(directory)).toHaveLength(0);
  });
  it('sube, sirve sin JWT, reemplaza y quita una portada', async () => {
    const svc = service(); const form = await multipart();
    const upload = () => call(svc.app, 'POST', `/api/events/${ID}/cover`, { ...form, token: 'owner' });
    const first = await upload(); expect(first.status).toBe(200);
    const firstUrl = first.json().imageUrl;
    const image = await call(svc.app, 'GET', firstUrl);
    expect(image.status).toBe(200); expect(image.body).toEqual(PNG);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    const second = await upload(); expect(second.status).toBe(200);
    expect(second.json().imageUrl).not.toBe(firstUrl);
    expect((await call(svc.app, 'GET', firstUrl)).status).toBe(404);
    expect(await readdir(directory)).toHaveLength(1);
    const remove = await call(svc.app, 'PATCH', `/api/events/${ID}`, { token: 'owner', contentType: 'application/json', body: Buffer.from('{"imageUrl":null}') });
    expect(remove.status).toBe(200); expect(remove.json().imageUrl).toBeNull();
    expect(await readdir(directory)).toHaveLength(0);
  });
  it('limpia la nueva imagen si la base falla y conserva la anterior', async () => {
    const svc = service(); const form = await multipart();
    const first = await call(svc.app, 'POST', `/api/events/${ID}/cover`, { ...form, token: 'owner' });
    svc.fail();
    const failure = await call(svc.app, 'POST', `/api/events/${ID}/cover`, { ...form, token: 'owner' });
    expect(failure.status).toBe(500);
    expect(svc.row().image_url).toBe(first.json().imageUrl);
    expect(await readdir(directory)).toHaveLength(1);
    expect((await call(svc.app, 'GET', first.json().imageUrl)).status).toBe(200);
  });
  it('conserva enlaces externos y borra solo archivos propios al sustituir por URL', async () => {
    const svc = service();
    const form = await multipart();
    svc.row().image_url = 'https://example.com/existing.png';
    expect((await call(svc.app, 'POST', `/api/events/${ID}/cover`, { ...form, token: 'owner' })).status).toBe(200);
    const updated = await call(svc.app, 'PATCH', `/api/events/${ID}`, { token: 'owner', contentType: 'application/json', body: Buffer.from('{"imageUrl":"https://example.com/new.jpg"}') });
    expect(updated.status).toBe(200);
    expect(updated.json().imageUrl).toBe('https://example.com/new.jpg');
    expect(await readdir(directory)).toHaveLength(0);
  });
  it('no cambia la base cuando el almacenamiento no está disponible', async () => {
    const svc = service();
    await rm(directory, { recursive: true });
    const form = await multipart();
    const result = await call(svc.app, 'POST', `/api/events/${ID}/cover`, { ...form, token: 'owner' });
    expect(result.status).toBe(503);
    expect(svc.row().image_url).toBeNull();
  });
  it('rechaza cuerpo demasiado grande y rutas locales en JSON', async () => {
    const svc = service();
    const tooLarge = await call(svc.app, 'POST', `/api/events/${ID}/cover`, { token: 'owner', contentType: 'multipart/form-data; boundary=test', body: Buffer.alloc(MAX_COVER_BYTES + 100000) });
    expect(tooLarge.status).toBe(413);
    const localPath = await call(svc.app, 'PATCH', `/api/events/${ID}`, { token: 'owner', contentType: 'application/json', body: Buffer.from('{"imageUrl":"/api/events/covers/another.png"}') });
    expect(localPath.status).toBe(400);
    expect(await readdir(directory)).toHaveLength(0);
  });
});
