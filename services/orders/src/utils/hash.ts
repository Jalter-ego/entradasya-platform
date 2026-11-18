import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal de 64 caracteres (convención del README de bases). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
