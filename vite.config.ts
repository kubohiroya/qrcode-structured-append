import { defineConfig } from 'vite';

/**
 * One ES module with the QR encoder inside it.
 *
 * `@nuintun/qrcode` is bundled rather than depended on, because Structured Append needs a change to
 * its encoder (`patches/`) that an npm dependency could not carry to consumers.
 */
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
});
