import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Five pages, not one.
 *
 * `index.html` is the deck. `flash.html` and `draw.html` are the gallery. `matte.html`
 * and `key.html` are the composite plates, which re-run a gallery piece with the map
 * restyled. Each needs its own entry so it gets its own map and module graph, and so a
 * build ships all five — without listing them here, `vite build` emits only index.html
 * and the rest 404 in production while working perfectly in dev.
 */
export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        flash: resolve(__dirname, 'flash.html'),
        draw: resolve(__dirname, 'draw.html'),
        matte: resolve(__dirname, 'matte.html'),
        key: resolve(__dirname, 'key.html'),
      },
    },
  },
});
