import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'customer' | 'organizer' | 'doorman';
}

interface UserWithHash extends User {
  password_hash: string;
}

export const demoUsers = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'organizador@demo.bo', name: 'Organizador de demo', role: 'organizer' },
  { id: '00000000-0000-4000-8000-000000000002', email: 'cliente@demo.bo', name: 'Cliente de demo', role: 'customer' },
  { id: '00000000-0000-4000-8000-000000000003', email: 'portero@demo.bo', name: 'Portero de demo', role: 'doorman' },
] as const satisfies readonly User[];

export function usersRepository(db: Pool) {
  return {
    async checkHealth() {
      await db.query('SELECT id FROM users LIMIT 0');
    },
    async createCustomer(name: string, email: string, passwordHash: string) {
      const { rows } = await db.query<User>(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, name, email, role`,
        [randomUUID(), name, email, passwordHash],
      );
      return rows[0];
    },
    async findByEmail(email: string) {
      const { rows } = await db.query<UserWithHash>(
        'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
        [email],
      );
      return rows[0];
    },
  };
}
