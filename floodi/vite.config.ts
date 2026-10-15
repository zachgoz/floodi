/**
 * @fileoverview Vite Configuration for FloodCast
 */

/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFile, readdir, mkdir, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, dirname } from 'node:path'
import { validateForecast } from './functions/src/forecast/schema'
import { localForecastRefreshPlugin } from './dev/localForecastRefresh'

const appDirectory = fileURLToPath(new URL('.', import.meta.url))
const fingerprint = createHash('sha256')
const fingerprintSources = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) fingerprintSources(path)
    else if (entry.isFile()) {
      fingerprint.update(relative(appDirectory, path)).update(readFileSync(path))
    }
  }
}
fingerprintSources(join(appDirectory, 'src'))
// Numerical/schema modules are shared with the backend and are also bundled
// into the app. Their changes must produce a distinct diagnostic release ID.
fingerprintSources(join(appDirectory, 'functions', 'src'))
for (const file of ['package-lock.json', 'index.html', 'vite.config.ts']) fingerprint.update(readFileSync(join(appDirectory, file)))
const buildId = fingerprint.digest('hex').slice(0, 16)

// Hidden maps are archived outside Hosting's public directory. The matching
// build ID in error reports identifies the private maps needed for diagnosis.
const archiveSourceMaps = async (directory: string) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await archiveSourceMaps(path)
    else if (entry.name.endsWith('.map')) {
      const target = join(appDirectory, '.private-source-maps', buildId, relative(join(appDirectory, 'dist'), path))
      await mkdir(dirname(target), { recursive: true })
      await rename(path, target)
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: { 'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId) },
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
    sourcemap: 'hidden',
  },
  plugins: [
    react(),
    {
      name: 'archive-private-source-maps',
      apply: 'build',
      closeBundle: () => archiveSourceMaps(join(appDirectory, 'dist')),
    },
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
