import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Los archivos comparten la base de pruebas: se ejecutan uno por vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Lee TEST_DATABASE_URL de .env.test si existe (o del entorno).
    env: { ...loadEnv('test', process.cwd(), ''), LOG_LEVEL: 'silent' },
  },
});
