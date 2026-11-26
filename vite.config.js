import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    target: ['chrome61', 'es2017'],
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tututype: resolve(__dirname, 'tututype.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'minitool-classic-bundle',
      generateBundle(options, bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName.endsWith('.js') && chunk.type === 'chunk') {
            chunk.code = `(function(){\n${chunk.code}\n})();`;
          }
        }
      },
      transformIndexHtml(html) {
        return html
          .replace(/<script\s+type="module"\s+crossorigin\s+src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
          .replace(/<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
      },
    },
  ],
});
