import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': projectRoot },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
