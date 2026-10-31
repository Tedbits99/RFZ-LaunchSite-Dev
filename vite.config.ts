import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

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
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
