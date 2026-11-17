import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Los archivos comparten la base de pruebas: se ejecutan uno por vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
