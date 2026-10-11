import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
