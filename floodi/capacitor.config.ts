/**
 * @fileoverview Capacitor Configuration for FloodCast
 *
 * This configuration file defines how the FloodCast web application is packaged
 * and deployed as a native mobile application using Capacitor. Capacitor acts
 * as a bridge between the web app and native mobile platforms (iOS/Android).
 *
 * Key Configuration Areas:
 * - App identification and metadata
 * - Build output directory specification
 * - Native platform settings
 * - Plugin configurations (when needed)
 *
 * @see {@link https://capacitorjs.com/docs/config} Capacitor Configuration Documentation
 */

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor Configuration
 *
 * Defines the essential settings for converting the FloodCast web application
 * into native iOS and Android apps. This configuration is used by the Capacitor
 * CLI during the build and sync processes.
 *
 * Configuration Details:
 * - appId: Unique identifier for the mobile app (reverse domain notation)
 * - appName: Display name shown to users on their devices
 * - webDir: Directory containing the built web application files
 *
 * @type {CapacitorConfig}
 */
const config: CapacitorConfig = {
  /**
   * Unique application identifier in reverse domain notation
   *
   * This ID is used by mobile operating systems to uniquely identify the app.
   * It should follow reverse domain naming convention and remain consistent
   * across app updates to maintain user data and app store listings.
   *
   * Note: Currently using Ionic starter template default - should be updated
   * to a proper domain when publishing (e.g., 'com.floodcast.app')
   */
  appId: 'io.ionic.starter',
  
  /**
   * Application display name
   *
   * This name appears on the user's device home screen, app drawer, and
   * in app stores. It should be concise and recognizable to users.
   */
  appName: 'FloodCast',
  
  /**
   * Web application build output directory
   *
   * Points to the directory containing the compiled/built web application files.
   * Vite outputs the production build to 'dist' by default. Capacitor copies
   * these files into the native app containers during the sync process.
   */
  webDir: 'dist'
};

export default config;
