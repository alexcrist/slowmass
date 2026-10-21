import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'hashed-asset-headers',
      async writeBundle(options, bundle) {
        if (!options.dir) throw new Error('Asset output directory is required');
        // Exact emitted paths only: an absent chunk can fall back to HTML,
        // which must never inherit a wildcard immutable caching policy.
        const rules = Object.keys(bundle)
          .filter(
            (file) => file.startsWith('assets/') && /\.(js|css)$/.test(file),
          )
          .sort()
          .map(
            (file) =>
              `/${file}\n  Cache-Control: public, max-age=31536000, immutable\n`,
          )
          .join('\n');
        const headers = await readFile(
          new URL('./public/_headers', import.meta.url),
          'utf8',
        );
        await writeFile(
          resolve(options.dir, '_headers'),
          `${headers}\n# Generated content-hashed asset paths.\n${rules}`,
        );
      },
    },
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
      '/event/': 'http://localhost:8787',
    },
  },
});
