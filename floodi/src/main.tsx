/**
 * @fileoverview Application entry point for FloodCast
 *
 * This file handles the initialization and bootstrapping of the React application.
 * It sets up the React 18 concurrent features with createRoot and enables
 * strict mode for enhanced development debugging.
 *
 * Key responsibilities:
 * - Creates the React root container using React 18's createRoot API
 * - Enables React.StrictMode for development-time checks
 * - Mounts the main App component to the DOM
 *
 * @see {@link https://react.dev/reference/react-dom/client/createRoot} React 18 createRoot API
 * @see {@link https://react.dev/reference/react/StrictMode} React StrictMode documentation
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/**
 * Initialize and mount the FloodCast React application
 *
 * Uses React 18's createRoot API for concurrent features and improved performance.
 * The application is wrapped in StrictMode to enable additional development-time
 * checks and warnings that help identify potential problems.
 *
 * StrictMode benefits:
 * - Identifies components with unsafe lifecycles
 * - Warns about legacy string ref API usage
 * - Warns about deprecated findDOMNode usage
 * - Detects unexpected side effects
 * - Detects legacy context API
 */

// Get the root DOM element where the app will be mounted
const container = document.getElementById('root');

// Create React 18 root with concurrent features enabled
const root = createRoot(container!);

// Render the application with StrictMode enabled for development benefits
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);