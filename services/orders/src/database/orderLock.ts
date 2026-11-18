import { setTimeout as sleep } from 'node:timers/promises';
import { ORDER_LOCK } from '../constants/constants.js';
import { log } from '../utils/logger.js';
import type { Db } from './database.js';

export async function withOrderLock<T>(
  db: Db, orderId: string, fn: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const client = await db.connect();
  let locked = false;
  let broken = false;
  try {
    const deadline = Date.now() + ORDER_LOCK.waitMs;
    while (!locked) {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [orderId],
      );
      locked = rows[0]?.ok === true;
      if (!locked) {
        if (Date.now() >= deadline) return { acquired: false };
        await sleep(ORDER_LOCK.pollMs);
      }
    }
    return { acquired: true, result: await fn() };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [orderId]);
      } catch {
        broken = true;
        log('error', 'order_unlock_failed', { orderId });
      }
    }
    client.release(broken);
  }
}
