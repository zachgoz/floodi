import React from 'react';
import { Redirect, Route, type RouteProps } from 'react-router-dom';
import { IonContent, IonSpinner, IonPage } from '@ionic/react';
import { useAuth } from 'src/contexts/AuthContext';

export type PrivateRouteProps = RouteProps & {
  requireAuth?: boolean;
  redirectTo?: string;
};

/**
 * Route wrapper with optional authentication requirement (React Router v5).
 * - When `requireAuth` is true and unauthenticated, redirects to `redirectTo`.
 * - Preserves intended destination via `redirect` query param.
 * - Shows an Ionic spinner while auth state loads.
 */
const Guard: React.FC<{ location: Location; redirectTo: string; requireAuth: boolean }> = ({ location, redirectTo, requireAuth, children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <IonPage>
        <IonContent className="ion-text-center ion-padding">
          <IonSpinner name="crescent" />
        </IonContent>
      </IonPage>
    );
  }
  if (requireAuth && !user) {
    const path = (location.pathname || '/') + (location.search || '') + (location.hash || '');
    const search = path ? `?redirect=${encodeURIComponent(path)}` : '';
    return <Redirect to={`${redirectTo}${search}`} />;
  }
  return <>{children}</>;
};

export const PrivateRoute: React.FC<PrivateRouteProps> = ({ requireAuth = false, redirectTo = '/login', children, ...rest }) => (
  <Route
    {...rest}
    render={({ location }) => (
      <Guard location={location} redirectTo={redirectTo} requireAuth={requireAuth}>
        {children}
      </Guard>
    )}
  />
);
