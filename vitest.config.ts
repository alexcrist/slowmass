import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    // Each integration file runs its own workerd processes. Locally, use half
    // the cores so the suite does not saturate the machine; CI uses the default.
    maxWorkers: process.env.CI ? undefined : '50%',
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
