import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Pull version from package.json at build time so the UI footer always
// matches what was shipped. This is the only place __APP_VERSION__ is set.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  base: '/ward-helper/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
