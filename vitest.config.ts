import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.spec.ts'],
    testTimeout: 30_000, // integration tests may need more
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
  },
});
