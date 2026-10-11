/**
 * @fileoverview Vite Configuration for FloodCast
 */

/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { validateForecast } from './functions/src/forecast/schema'
import { localForecastRefreshPlugin } from './dev/localForecastRefresh'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      src: '/src',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
    },
  },
  build: {
    target: 'es2020',
  },
  plugins: [
    react(),
    localForecastRefreshPlugin(),
    {
      name: 'local-cached-flood-outlook',
      apply: 'serve',
      configureServer(server) {
        // Public numerical preview only. This route cannot train, call Gemini,
        // read a user-specified file, or expose ADC/environment credentials.
        server.middlewares.use('/api/outlook', async (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          if (req.method !== 'GET') { res.statusCode = 405; res.end('{"error":"Method not allowed"}'); return; }
          try {
            const text = await readFile(new URL('./functions/evaluation/outlook.json', import.meta.url), 'utf8');
            const value = JSON.parse(text);
            if (!validateForecast(value) || Date.parse(value.generatedAt) > Date.now() || Date.parse(value.expiresAt) <= Date.now()) throw new Error('Invalid or expired preview');
            res.end(text);
          } catch { res.statusCode = 503; res.end('{"error":"Current evaluated outlook unavailable"}'); }
        });
      },
    },
  ],
  server: {
    // Keep local ADC private keys inaccessible to the development browser.
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/service-account*.json', '**/functions/evaluation/**'],
    },
    proxy: {
      // Proxy FiMAN requests to avoid CORS issues in development
      '/api/fiman': {
        target: 'https://data.sunnydayflooding.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/fiman/, ''),
      },
    },
  },
  test: {
    // App tests use Vitest; Functions tests run separately with Node's test runner.
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
  }
})
