# FloodCast Dependencies Documentation

This document explains the key dependencies used in the FloodCast application and their purposes.

## Production Dependencies

### Core Framework
- **react (19.0.0)**: Latest React library with concurrent features and improved performance
- **react-dom (19.0.0)**: React DOM renderer for web applications

### Mobile & Native Features (Capacitor)
- **@capacitor/core (7.4.3)**: Core Capacitor runtime enabling native mobile app functionality
- **@capacitor/app (7.1.0)**: App lifecycle management and deep linking capabilities
- **@capacitor/haptics (7.0.2)**: Device haptic feedback (vibration) for enhanced user experience
- **@capacitor/keyboard (7.0.3)**: Keyboard behavior and event handling for mobile devices
- **@capacitor/status-bar (7.0.3)**: Status bar styling and behavior control

### UI Framework (Ionic)
- **@ionic/react (^8.5.0)**: Core Ionic React components providing native-style UI elements
- **@ionic/react-router (^8.5.0)**: Ionic-specific routing integration with navigation animations
- **ionicons (^7.4.0)**: Comprehensive icon library with thousands of icons

### Navigation & Routing
- **react-router (^5.3.4)**: Core client-side routing functionality
- **react-router-dom (^5.3.4)**: DOM bindings for React Router (v5 for Ionic compatibility)
- **@types/react-router (^5.1.20)**: TypeScript type definitions for React Router
- **@types/react-router-dom (^5.3.3)**: TypeScript type definitions for React Router DOM

### Backend Services
- **firebase (^12.2.1)**: Firebase SDK providing authentication, database, storage, and hosting services

## Development Dependencies

### Build Tools
- **@capacitor/cli (7.4.3)**: Command-line interface for building and managing native mobile apps
- **vite (~5.2.0)**: Fast build tool and development server with hot module replacement
- **@vitejs/plugin-react (^4.0.1)**: Vite plugin providing React support and fast refresh
- **@vitejs/plugin-legacy (^5.0.0)**: Vite plugin for legacy browser support and polyfills
- **terser (^5.4.0)**: JavaScript minification for optimized production builds

### TypeScript Support
- **typescript (^5.1.6)**: TypeScript compiler for static type checking
- **@types/react (19.0.10)**: TypeScript type definitions for React
- **@types/react-dom (19.0.4)**: TypeScript type definitions for React DOM
- **typescript-eslint (^8.24.0)**: ESLint rules and parser for TypeScript

### Testing Framework
- **vitest (^0.34.6)**: Fast unit testing framework with Vite integration
- **cypress (^13.5.0)**: End-to-end testing framework for comprehensive app testing
- **jsdom (^22.1.0)**: DOM environment simulation for testing
- **@testing-library/react (^16.2.0)**: Testing utilities for React components
- **@testing-library/dom (>=7.21.4)**: Core DOM testing utilities
- **@testing-library/jest-dom (^5.16.5)**: Custom Jest matchers for DOM elements
- **@testing-library/user-event (^14.4.3)**: User interaction simulation for testing

### Code Quality & Linting
- **eslint (^9.20.1)**: JavaScript and TypeScript linting for code quality
- **eslint-plugin-react (^7.32.2)**: React-specific linting rules
- **eslint-plugin-react-hooks (^5.1.0)**: Linting rules for React Hooks
- **eslint-plugin-react-refresh (^0.4.19)**: Linting support for React Fast Refresh
- **globals (^15.15.0)**: Global variable definitions for linting environments

## Package Overrides

- **rollup (4.44.0)**: Pinned version of Rollup (Vite's bundler) to ensure build stability and avoid compatibility issues

## Scripts Explanation

- **dev**: Starts the Vite development server with hot reload for rapid development
- **build**: Performs TypeScript compilation followed by production build optimization
- **preview**: Serves the production build locally for testing before deployment
- **test.e2e**: Runs end-to-end tests using Cypress for full application testing
- **test.unit**: Runs unit tests using Vitest for individual component testing
- **lint**: Runs ESLint to check code quality and enforce style guidelines

## Key Architecture Decisions

1. **React 19**: Latest version provides concurrent features and improved performance
2. **Ionic Framework**: Provides native-style UI components and mobile app capabilities
3. **Capacitor**: Enables deployment to iOS and Android with native functionality
4. **Vite**: Fast build tool chosen over Create React App for better performance
5. **TypeScript**: Provides static typing for better code quality and developer experience
6. **Firebase**: Cloud platform for backend services without server management
7. **React Router v5**: Maintained for Ionic compatibility instead of v6
8. **Vitest**: Modern testing framework that integrates well with Vite