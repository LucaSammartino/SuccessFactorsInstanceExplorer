import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze';

  return {
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:5174',
          changeOrigin: true
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@ui5/webcomponents-icons')) return 'ui5-icons';
            if (id.includes('@ui5/webcomponents-fiori')) return 'ui5-fiori';
            if (id.includes('@ui5/webcomponents')) return 'ui5-core';
            if (id.includes('node_modules/d3')) return 'd3';
            if (id.includes('elkjs')) return 'elkjs';
            if (id.includes('node_modules/react-dom')) return 'react-dom';
            if (id.includes('node_modules/react/')) return 'react';
          }
        }
      }
    },
    resolve: {
      alias: {
        elkjs: 'elkjs/lib/elk.bundled.js',
        '@pm/ingest': path.resolve(__dirname, '../src/ingest')
      }
    },
    plugins: [
      react(),
      ...(analyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              open: false,
              template: 'treemap'
            })
          ]
        : [])
    ]
  };
});
