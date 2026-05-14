import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        'tests/**',
        'src/**/*.test.{ts,tsx}',
        // Declaration files are types-only; rolldown (vitest 4 coverage
        // backend) otherwise parses `export const X: string;` ambient
        // decls as runtime ESM and emits a misleading RolldownError.
        '**/*.d.ts',
        '**/*.d.mts',
        '**/*.d.cts',
      ],
    },
  },
});
