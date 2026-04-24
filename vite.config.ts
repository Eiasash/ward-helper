import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Pull version from package.json at build time so every version-aware
// artifact (UI footer, service worker cache key) matches what was shipped.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

/**
 * Rewrite `dist/sw.js` so its VERSION constant matches package.json.
 *
 * Motivation: if the SW cache-key doesn't change, existing PWA installs
 * continue serving the old `index.html` from cache — even after a deploy.
 * We saw real users stuck on v1.6.1 for multiple releases because the SW
 * was last touched at that version. Now the build bumps it automatically
 * on every release and old caches get purged in the SW's activate phase.
 *
 * Runs in `writeBundle` (after Vite copies /public to /dist), does a
 * single targeted string replace against the line
 *     const VERSION = 'ward-vX.Y.Z';
 * If the line isn't present, the plugin throws — because silently shipping
 * an out-of-sync SW would reintroduce the exact bug this plugin exists to
 * prevent.
 */
function swVersionSync(): Plugin {
  const VERSION_RE = /const VERSION = '[^']*';/;
  return {
    name: 'sw-version-sync',
    apply: 'build',
    async writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const swPath = path.join(outDir, 'sw.js');
      const { readFile, writeFile } = await import('node:fs/promises');
      const src = await readFile(swPath, 'utf8');
      if (!VERSION_RE.test(src)) {
        throw new Error(
          `sw-version-sync: could not find VERSION line in ${swPath}. ` +
            `If you renamed it, update the plugin — shipping an out-of-sync ` +
            `SW means PWA users stay on an old cached bundle.`,
        );
      }
      const next = src.replace(
        VERSION_RE,
        `const VERSION = 'ward-v${pkg.version}';`,
      );
      // No-op when sw.js VERSION already matches package.json — that's success,
      // not a failure. Only rewrite when the file actually needs to change.
      if (next !== src) {
        await writeFile(swPath, next, 'utf8');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), swVersionSync()],
  base: '/ward-helper/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
