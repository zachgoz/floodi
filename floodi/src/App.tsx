/**
 * @fileoverview Main application component for FloodCast - an Ionic React app
 * providing hyperlocal tide and flood insights through NOAA data integration.
 *
 * This file sets up the core app structure including:
 * - React Router configuration for navigation
 * - Tab-based navigation system
 * - Initial route handling with intro screen logic
 * - Ionic framework initialization and theming
 */

import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { ellipse, informationCircleOutline, chatbubblesOutline } from 'ionicons/icons';
import Intro from './pages/Intro';
import React from 'react';
import Tab2 from './pages/Tab2';
import Tab3 from './pages/Tab3';
import Tab4 from './pages/Tab4';
import { Login, Register, ResetPassword, Profile } from 'src/pages/auth';
import { PrivateRoute, AdminRoute } from 'src/components/routing';
import { UserRoleManager } from 'src/components/admin';
import { SimpleAdminBootstrap } from 'src/components/admin/SimpleAdminBootstrap';
import { useAuth } from 'src/contexts/AuthContext';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utilities for layout and styling */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode Configuration
 * -----------------------------------------------------
 * Using system-based dark mode detection which automatically switches
 * theme based on the user's system preference (OS dark/light mode setting).
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */ // Always dark
import '@ionic/react/css/palettes/dark.class.css';  // Toggle via class on document
/* import '@ionic/react/css/palettes/dark.system.css'; */        // System preference

/* Custom theme variables and app-specific styling */
import './theme/variables.css';

// Initialize Ionic React with default configuration
setupIonicReact();

/**
 * InitialRoute Component
 *
 * Handles the initial routing logic for the application by checking if the user
 * has previously seen the intro screen. This provides a better user experience
 * by showing the intro only once per device/browser.
 *
 * @component
 * @returns {JSX.Element} A redirect component that routes to either intro or main app
 *
 * @example
 * // First time users are redirected to /intro
 * // Returning users are redirected to /tab2 (main FloodCast page)
 */
const InitialRoute: React.FC = () => {
  const { loading } = useAuth();
  // Check localStorage to determine if user has seen intro before
  const seen = (() => {
    try {
      return localStorage.getItem('floodcast_intro_seen') === '1';
    } catch {
      // If localStorage is unavailable (privacy mode, etc.), skip intro
      // This ensures the app still works in restrictive environments
      return true;
    }
  })();
  
  // Route based on intro and auth state
  if (!seen) return <Redirect to={'/intro'} />;
  // While auth state is being determined, show a minimal spinner
  if (loading) {
    return (
      <div className="ion-padding ion-text-center">
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  // After intro, everyone goes to main tab regardless of authentication
  return <Redirect to={'/tab2'} />;
};

/**
 * Main App Component
 *
 * The root component of the FloodCast application that sets up the overall
 * app structure with tab-based navigation and routing system.
 *
 * App Architecture:
 * - Uses Ionic's tab-based navigation pattern
 * - Implements React Router for client-side routing
 * - Provides persistent bottom tab bar for main navigation
 * - Handles special intro flow for first-time users
 *
 * Navigation Structure:
 * - / (root): InitialRoute logic determines intro vs main app
 * - /intro: One-time intro screen for new users
 * - /tab2: Main FloodCast functionality (tide/flood data)
 * - /tab3: About page with app information
 *
 * @component
 * @returns {JSX.Element} The complete app component with navigation
 */
const applyTheme = (mode: 'auto' | 'light' | 'dark') => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldDark = mode === 'dark' || (mode === 'auto' && prefersDark);
  root.classList.toggle('ion-palette-dark', shouldDark);
};

const App: React.FC = () => (
  <IonApp>
    <IonReactRouter>
      <IonTabs>
        {/* Main content area with route-based page switching */}
        <IonRouterOutlet>
          {/* One-time intro screen route */}
          <Route exact path="/intro">
            <Intro />
          </Route>
          {/* Auth routes */}
          <Route exact path="/login">
            <Login />
          </Route>
          <Route exact path="/register">
            <Register />
          </Route>
          <Route exact path="/reset-password">
            <ResetPassword />
          </Route>
          {/* Primary FloodCast functionality - tide and flood data visualization */}
          <Route exact path="/tab2">
            <Tab2 />
          </Route>
          {/* Dedicated Comments tab */}
          <Route path="/tab4">
            <Tab4 />
          </Route>
          {/* App information and about page */}
          <Route path="/tab3">
            <Tab3 />
          </Route>
          {/* Profile route accessible to all; content adapts to auth state */}
          <PrivateRoute exact path="/profile" requireAuth={false}>
            <Profile />
          </PrivateRoute>
          {/* Admin user management route - admin only */}
          <AdminRoute exact path="/admin/users" redirectTo="/profile">
            <UserRoleManager />
          </AdminRoute>
          {/* Admin bootstrap route - for first-time admin setup */}
          <PrivateRoute exact path="/admin/bootstrap" requireAuth={true}>
            <SimpleAdminBootstrap />
          </PrivateRoute>
          {/* Root route with conditional intro/main app logic */}
          <Route exact path="/">
            <InitialRoute />
          </Route>
        </IonRouterOutlet>
        
        {/* Bottom tab navigation bar - persistent across main app pages */}
        <IonTabBar slot="bottom">
          {/* Primary FloodCast tab - main functionality */}
          <IonTabButton tab="tab2" href="/tab2">
            <IonIcon aria-hidden="true" icon={ellipse} />
            <IonLabel>FloodCast</IonLabel>
          </IonTabButton>
          {/* Comments tab - standalone comment management */}
          <IonTabButton tab="tab4" href="/tab4" aria-label="Comments">
            <IonIcon aria-hidden="true" icon={chatbubblesOutline} />
            <IonLabel>Comments</IonLabel>
          </IonTabButton>
          {/* About tab - app information and help */}
          <IonTabButton tab="tab3" href="/tab3">
            <IonIcon aria-hidden="true" icon={informationCircleOutline} />
            <IonLabel>About</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>
    </IonReactRouter>
  </IonApp>
);

export default App;

// Apply theme on load and when user/system preference changes
if (typeof window !== 'undefined') {
  const THEME_KEY = 'floodi.theme';
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const syncFromStorage = () => {
    const stored = localStorage.getItem(THEME_KEY) as 'auto' | 'light' | 'dark' | null;
    applyTheme(stored ?? 'auto');
  };
  const handleMql = () => {
    const mode = (localStorage.getItem(THEME_KEY) as 'auto' | 'light' | 'dark' | null) || 'auto';
    if (mode === 'auto') applyTheme('auto');
  };
  // Initial
  syncFromStorage();
  // React to storage changes (e.g., settings modal updates)
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) syncFromStorage();
  });
  // React to system changes when in auto
  if (mql && mql.addEventListener) mql.addEventListener('change', handleMql);
}
