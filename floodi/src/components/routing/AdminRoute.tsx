import React from 'react';
import { Redirect, Route, type RouteProps } from 'react-router-dom';
import { IonContent, IonSpinner, IonPage } from '@ionic/react';
import { useAuth } from 'src/contexts/AuthContext';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import type { Location as HistoryLocation } from 'history';

export type AdminRouteProps = RouteProps & {
  /** Where to redirect non-admin authenticated users (default '/profile'). */
  redirectTo?: string;
};

/**
 * AdminRoute wraps a Route and enforces both authentication and admin permission.
 * - Unauthenticated users are redirected to login with a `redirect` backref.
 * - Authenticated non-admin users are redirected to `redirectTo` (default '/profile') with `error=forbidden`.
 * - While auth/permissions load, shows an Ionic spinner.
 */
const Guard: React.FC<{ location: HistoryLocation; redirectTo: string }> = ({ location, redirectTo, children }) => {
  const { user, loading } = useAuth();
  const perms = useUserPermissions();

  if (loading || perms.loading) {
    return (
      <IonPage>
        <IonContent className="ion-text-center ion-padding">
          <IonSpinner name="crescent" />
        </IonContent>
      </IonPage>
    );
  }

  if (!user) {
    const path = (location.pathname || '/') + (location.search || '') + (location.hash || '');
    const search = path ? `?redirect=${encodeURIComponent(path)}` : '';
    return <Redirect to={`/login${search}`} />;
  }

  if (!perms.isAdmin()) {
    const path = (location.pathname || '/') + (location.search || '') + (location.hash || '');
    const delim = redirectTo.includes('?') ? '&' : '?';
    return <Redirect to={`${redirectTo}${delim}error=forbidden&from=${encodeURIComponent(path)}`} />;
  }

  return <>{children}</>;
};

export const AdminRoute: React.FC<AdminRouteProps> = ({ redirectTo = '/profile', children, ...rest }) => (
  <Route
    {...rest}
    render={({ location }) => (
      <Guard location={location} redirectTo={redirectTo}>
        {children}
      </Guard>
    )}
  />
);

export default AdminRoute;

