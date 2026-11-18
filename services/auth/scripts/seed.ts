import { databaseConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { demoUsers } from '../src/users.js';
import { newPassword } from '../src/validation.js';

async function seed() {
  const password = newPassword.safeParse(process.env.DEMO_PASSWORD);
  if (!password.success) throw new Error('Configura DEMO_PASSWORD con 8 a 128 caracteres.');

  const pool = createPool(databaseConfig());
  try {
    const hashes = await Promise.all(demoUsers.map(() => hashPassword(password.data)));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [index, { id, name, email, role }] of demoUsers.entries()) {
        await client.query(
          `INSERT INTO users (id, name, email, role, password_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [id, name, email, role, hashes[index]],
        );
        const { rowCount } = await client.query(
          'SELECT 1 FROM users WHERE id = $1 AND email = $2 AND role = $3',
          [id, email, role],
        );
        if (!rowCount) throw new Error('Un ID reservado de demo pertenece a otra cuenta.');
      }
      await client.query('COMMIT');
      console.log('Cuentas de demo verificadas. Se conservaron las contraseñas de cuentas existentes.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

try {
  await seed();
} catch {
  console.error('No se pudo sembrar auth. Revisa la migración, DEMO_PASSWORD y los IDs reservados.');
  process.exitCode = 1;
}
