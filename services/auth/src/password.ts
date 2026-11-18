import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const params = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 ** 2 };
const format = `scrypt$${params.N}$${params.r}$${params.p}`;
const saltBytes = 16;
const keyBytes = 32;
const derive = promisify(
  (password: string, salt: Buffer, callback: (error: Error | null, key: Buffer) => void) =>
    scrypt(password, salt, keyBytes, params, callback),
);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes);
  const hash = await derive(password, salt);
  return `${format}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const [algorithm, n, r, p, saltHex, hashHex] = storedHash?.split('$') ?? [];
  const salt = Buffer.from(saltHex ?? '', 'hex');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  const validHash = [algorithm, n, r, p].join('$') === format
    && salt.length === saltBytes && expected.length === keyBytes;
  // Aplica el mismo costo de derivación si el correo no existe.
  const actual = await derive(password, validHash ? salt : Buffer.alloc(saltBytes));
  return validHash && timingSafeEqual(actual, expected);
}
