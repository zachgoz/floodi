/**
 * @fileoverview Vite Configuration for FloodCast
 *
 * This configuration file sets up Vite as the build tool and development server
 * for the FloodCast application. Vite provides fast development with hot module
 * replacement (HMR) and optimized production builds.
 *
 * Key Features Configured:
 * - React support with fast refresh
 * - Legacy browser compatibility
 * - Unit testing with Vitest
 * - TypeScript integration
 * - Modern ES modules with fallbacks
 *
 * @see {@link https://vitejs.dev/config/} Vite Configuration Documentation
 * @see {@link https://vitest.dev/config/} Vitest Configuration Documentation
 */

/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite Configuration
 *
 * Configures Vite for both development and production builds of FloodCast.
 * The setup prioritizes fast development experience while ensuring broad
 * browser compatibility for the production application.
 *
 * Plugin Stack:
 * - React plugin: Enables React Fast Refresh and JSX transformation
 * - Legacy plugin: Provides compatibility with older browsers
 *
 * Testing Integration:
 * - Vitest configuration for unit testing
 * - JSDOM environment for DOM testing
 * - Global test utilities setup
 */
// https://vitejs.dev/config/
export default defineConfig({
  /**
   * Vite Plugins Configuration
   *
   * Plugins extend Vite's functionality to support React and legacy browsers.
   * The order of plugins can matter for certain transformations.
   */
  plugins: [
    /**
     * React Plugin
     *
     * Enables React support with features:
     * - Fast Refresh for instant component updates during development
     * - JSX transformation for React components
     * - Automatic React import injection (React 17+ style)
     * - Development-time error boundary improvements
     */
    react(),
    
    /**
     * Legacy Plugin
     *
     * Ensures compatibility with older browsers by:
     * - Generating legacy bundles for browsers without ES module support
     * - Automatic polyfill injection for missing modern features
     * - Dual build strategy: modern for new browsers, legacy for old ones
     * - Dynamic import() polyfills for code splitting
     *
     * This is crucial for FloodCast's accessibility across different devices
     * and browser versions, especially on older mobile devices.
     */
    legacy()
  ],
  
  /**
   * Vitest Testing Configuration
   *
   * Configures the integrated unit testing framework that works seamlessly
   * with Vite's build pipeline. Vitest provides Jest-compatible APIs with
   * better performance and Vite integration.
   */
  test: {
    /**
     * Enable global test functions
     *
     * Makes describe, it, expect, etc. available globally in test files
     * without explicit imports, matching Jest's default behavior.
     */
    globals: true,
    
    /**
     * Test environment simulation
     *
     * Uses jsdom to simulate a browser DOM environment for testing React
     * components. This allows testing of component rendering, DOM interactions,
     * and browser APIs without a real browser.
     */
    environment: 'jsdom',
    
    /**
     * Test setup configuration
     *
     * Points to a setup file that runs before each test suite.
     * Typically used for:
     * - Custom matchers (e.g., @testing-library/jest-dom)
     * - Global test utilities
     * - Mock configurations
     * - Test environment initialization
     */
    setupFiles: './src/setupTests.ts',
  }
})
