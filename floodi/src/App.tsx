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

import { Redirect, Route, useLocation } from 'react-router-dom';
import {
  IonApp,
  IonContent,
  IonPage,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { waterOutline, informationCircleOutline, notificationsOutline } from 'ionicons/icons';
import React, { Suspense, lazy } from 'react';
import Tab2 from './pages/Tab2';
import { PrivateRoute, AdminRoute } from 'src/components/routing';

import { markPerf } from 'src/lib/perfLogger';
import { trackScreenView } from 'src/lib/analytics';

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

const Intro = lazy(() => import('./pages/Intro'));
const Tab3 = lazy(() => import('./pages/Tab3'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Profile = lazy(() => import('./pages/auth/Profile'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const UserRoleManager = lazy(() => import('./components/admin/UserRoleManager').then(m => ({ default: m.UserRoleManager })));
const Alerts = lazy(() => import('./pages/Alerts').then(m => ({ default: m.Alerts })));
const UnsubscribeAlerts = lazy(() => import('./pages/Alerts').then(m => ({ default: m.UnsubscribeAlerts })));
const RouteLoading = () => <IonPage><IonContent><p role="status" className="ion-padding">Loading…</p></IonContent></IonPage>;
const DeferredRoute = ({ children }: React.PropsWithChildren) => <Suspense fallback={<RouteLoading />}>{children}</Suspense>;

// Initialize Ionic React with default configuration
setupIonicReact();

/**
 * InitialRoute Component
 *
 * Opens the public forecast immediately. The optional introduction remains
 * available from Help.
 *
 * @component
 * @returns {JSX.Element} A redirect to the public forecast
 *
 * @example
 * // All visitors are redirected to /tab2 (main FloodCast page)
 */
const InitialRoute: React.FC = () => {
  React.useEffect(() => {
    markPerf('route.initial.mounted');
  }, []);

  // First-time visitors see current conditions immediately. Help retains the optional tour.
  markPerf('route.initial.redirectTab2');
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
  root.classList.toggle('ion-palette-light', !shouldDark);
};

const AppTabs: React.FC = () => {
  const location = useLocation();
  const showTabBar = location.pathname !== '/intro';

  React.useEffect(() => {
    trackScreenView(location.pathname);
  }, [location.pathname]);

  return (
    <IonTabs>
      {/* Main content area with route-based page switching */}
      <IonRouterOutlet>
        {/* One-time intro screen route */}
        <Route exact path="/intro">
          <DeferredRoute><Intro /></DeferredRoute>
        </Route>
        {/* Auth routes */}
        <Route exact path="/login">
          <DeferredRoute><Login /></DeferredRoute>
        </Route>
        <Route exact path="/register">
          <DeferredRoute><Register /></DeferredRoute>
        </Route>
        <Route exact path="/reset-password">
          <DeferredRoute><ResetPassword /></DeferredRoute>
        </Route>
        {/* Primary FloodCast functionality - tide and flood data visualization */}
        <Route exact path="/tab2">
          <Tab2 />
        </Route>
        {/* App information and about page */}
        <Route path="/tab3">
          <DeferredRoute><Tab3 /></DeferredRoute>
        </Route>
        {/* Privacy Policy page */}
        <Route exact path="/privacy">
          <DeferredRoute><PrivacyPolicy /></DeferredRoute>
        </Route>
        {/* Profile route accessible to all; content adapts to auth state */}
        <PrivateRoute exact path="/profile" requireAuth={false}>
          <DeferredRoute><Profile /></DeferredRoute>
        </PrivateRoute>
        {/* Admin user management route - admin only */}
        <AdminRoute exact path="/admin/users" redirectTo="/profile">
          <DeferredRoute><UserRoleManager /></DeferredRoute>
        </AdminRoute>
        <Route exact path="/alerts/unsubscribe"><DeferredRoute><UnsubscribeAlerts /></DeferredRoute></Route>
        <Route exact path="/alerts"><DeferredRoute><Alerts /></DeferredRoute></Route>
        <Route exact path="/admin/bootstrap"><Redirect to="/profile" /></Route>
        {/* Root route with conditional intro/main app logic */}
        <Route exact path="/">
          <InitialRoute />
        </Route>
      </IonRouterOutlet>

      {showTabBar && (
        /* Bottom tab navigation bar - persistent across main app pages */
        <IonTabBar slot="bottom">
          {/* Primary FloodCast tab - main functionality */}
          <IonTabButton tab="tab2" href="/tab2">
            <IonIcon aria-hidden="true" icon={waterOutline} />
            <IonLabel>Forecast</IonLabel>
          </IonTabButton>
          <IonTabButton tab="alerts" href="/alerts">
            <IonIcon aria-hidden="true" icon={notificationsOutline} />
            <IonLabel>Alerts</IonLabel>
          </IonTabButton>
          {/* About and methodology remain available under Help. */}
          <IonTabButton tab="tab3" href="/tab3">
            <IonIcon aria-hidden="true" icon={informationCircleOutline} />
            <IonLabel>Help</IonLabel>
          </IonTabButton>
        </IonTabBar>
      )}
    </IonTabs>
  );
};

const App: React.FC = () => (
  <IonApp>
    <IonReactRouter>
      <AppTabs />
    </IonReactRouter>
  </IonApp>
);

export default App;

// Apply theme on load and when user/system preference changes
if (typeof window !== 'undefined') {
  const THEME_KEY = 'floodi.theme';
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const syncFromStorage = () => {
    try { applyTheme((localStorage.getItem(THEME_KEY) as 'auto' | 'light' | 'dark' | null) ?? 'auto'); }
    catch { applyTheme('auto'); }
  };
  const handleMql = () => {
    try { if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto'); }
    catch { applyTheme('auto'); }
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
