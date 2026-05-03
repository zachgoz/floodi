/**
 * @fileoverview Vite Configuration for FloodCast
 */

/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    react()
  ],
  server: {
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
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
  }
})
