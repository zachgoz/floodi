import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IonAvatar,
  IonButton,
  IonContent,
  IonHeader,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonTitle,
  IonToast,
  IonToolbar,
  IonAlert,
} from '@ionic/react';
import { useAuth } from 'src/contexts/AuthContext';
import { isValidDisplayName, isValidAvatarUrl } from 'src/utils/auth';
import { IonBadge, IonAccordion, IonAccordionGroup } from '@ionic/react';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { UserRole } from 'src/types/user';
import { getUsersByRole } from 'src/lib/userService';

const Profile: React.FC = () => {
  const { user, isAnonymous, updateUserProfile, logout, userProfile, resetPassword } = useAuth();
  const perms = useUserPermissions();
  const location = useLocation();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [photoURL, setPhotoURL] = useState(user?.photoURL || '');
  const [loading, setLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [adminStats, setAdminStats] = useState<{ total: number; byRole: Record<UserRole, number>; recent: Array<{ email: string | null; displayName: string | null; role: UserRole; createdAt: string }>} | null>(null);

  const formatTs = (ts?: any) => {
    try {
      if (!ts) return '';
      const d = 'toDate' in ts ? (ts.toDate() as Date) : new Date(String(ts));
      return d.toLocaleString();
    } catch {
      return '';
    }
  };

  const created = useMemo(
    () =>
      userProfile?.createdAt
        ? formatTs(userProfile.createdAt)
        : user?.metadata?.creationTime
        ? new Date(user.metadata.creationTime).toLocaleString()
        : '',
    [userProfile?.createdAt, user?.metadata?.creationTime]
  );

  const lastSignIn = useMemo(
    () =>
      userProfile?.lastLoginAt
        ? formatTs(userProfile.lastLoginAt)
        : user?.metadata?.lastSignInTime
        ? new Date(user.metadata.lastSignInTime).toLocaleString()
        : '',
    [userProfile?.lastLoginAt, user?.metadata?.lastSignInTime]
  );

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Validate inputs before updating profile
    if (displayName && !isValidDisplayName(displayName)) {
      setErrorMsg('Display name must be 2–50 characters.');
      return;
    }
    if (photoURL && !isValidAvatarUrl(photoURL)) {
      setErrorMsg('Please enter a valid image URL.');
      return;
    }
    try {
      setLoading(true);
      await updateUserProfile({ displayName: displayName || undefined, photoURL: photoURL || undefined });
      setSuccessMsg('Profile updated');
    } catch (err: unknown) {
      const msg = (err as { message?: string } | null)?.message || 'Failed to update profile';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err: unknown) {
      const msg = (err as { message?: string } | null)?.message || 'Failed to logout';
      setErrorMsg(msg);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) {
      setErrorMsg('No email associated with this account.');
      return;
    }
    try {
      setLoading(true);
      await resetPassword(user.email);
      setSuccessMsg('Password reset email sent');
    } catch (err: unknown) {
      const msg = (err as { message?: string } | null)?.message || 'Failed to send reset email';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('error') === 'forbidden') {
      setErrorMsg('You do not have access to User Management.');
      // Optional: strip param to avoid repeat toasts
      // history.replace({ search: '' });
    }
  }, [location.search]);

  useEffect(() => {
    const loadAdminStats = async () => {
      if (!perms.isAdmin()) return;
      try {
        setAdminLoading(true);
        const [admins, moderators, usersRole] = await Promise.all([
          getUsersByRole(UserRole.Admin, { pageSize: 50 }),
          getUsersByRole(UserRole.Moderator, { pageSize: 50 }),
          getUsersByRole(UserRole.User, { pageSize: 50 }),
        ]);
        const all = [...admins, ...moderators, ...usersRole];
        const recent = all
          .slice()
          .sort((a: any, b: any) => {
            const ad = 'toDate' in (a.createdAt || {}) ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(String(a.createdAt)).getTime() : 0);
            const bd = 'toDate' in (b.createdAt || {}) ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(String(b.createdAt)).getTime() : 0);
            return bd - ad;
          })
          .slice(0, 5)
          .map((u) => ({
            email: u.email,
            displayName: u.displayName,
            role: u.role,
            createdAt: (() => {
              try {
                const d = 'toDate' in (u.createdAt || {}) ? u.createdAt.toDate() as Date : new Date(String(u.createdAt));
                return d.toLocaleString();
              } catch {
                return '—';
              }
            })(),
          }));
        setAdminStats({
          total: all.length,
          byRole: {
            [UserRole.Admin]: admins.length,
            [UserRole.Moderator]: moderators.length,
            [UserRole.User]: usersRole.length,
            [UserRole.Anonymous]: 0,
          } as Record<UserRole, number>,
          recent,
        });
      } catch (e: unknown) {
        setErrorMsg((e as { message?: string } | null)?.message || 'Failed to load admin stats');
      } finally {
        setAdminLoading(false);
      }
    };
    void loadAdminStats();
  }, [perms.role]);

  // Anonymous users see a prompt to create an account
  if (!user || isAnonymous) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Profile</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonList>
            <IonItem lines="none">
              <IonAvatar slot="start">
                <img src={'https://www.gravatar.com/avatar?d=mp'} alt="Guest avatar" />
              </IonAvatar>
              <IonLabel>
                <h2>Guest User</h2>
                <p>Browsing without an account</p>
              </IonLabel>
            </IonItem>
          </IonList>
          <div className="ion-padding-top">
            <IonButton expand="block" routerLink="/register">Create Account</IonButton>
            <IonButton expand="block" fill="outline" routerLink="/login">Sign In</IonButton>
            <IonButton expand="block" color="medium" routerLink="/tab2">Back to FloodCast</IonButton>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Profile</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Personal Profile Section */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>My Profile</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <form onSubmit={save} aria-label="Profile form">
              <IonList>
                <IonItem lines="none">
                  <IonAvatar slot="start">
                    <img src={photoURL || user?.photoURL || 'https://www.gravatar.com/avatar?d=mp'} alt="Avatar" />
                  </IonAvatar>
                  <IonLabel>
                    <h2>{user?.displayName || 'Unnamed User'}{' '}
                      {!!userProfile?.role && (
                        <IonBadge color={
                          userProfile.role === UserRole.Admin ? 'danger' :
                          userProfile.role === UserRole.Moderator ? 'warning' :
                          'primary'
                        }>{userProfile.role}</IonBadge>
                      )}
                    </h2>
                    <p>{user?.email}</p>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Display Name</IonLabel>
                  <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Avatar URL</IonLabel>
                  <IonInput value={photoURL} onIonChange={(e) => setPhotoURL(e.detail.value || '')} />
                </IonItem>
                <IonItem lines="full">
                  <IonNote color="medium">Account created: {created || '—'}</IonNote>
                </IonItem>
                <IonItem lines="none">
                  <IonNote color="medium">Last sign-in: {lastSignIn || '—'}</IonNote>
                </IonItem>
              </IonList>
              <div className="ion-padding-top">
                <IonButton expand="block" type="submit" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </IonButton>
                <IonButton expand="block" fill="outline" onClick={handlePasswordReset} disabled={loading}>
                  Send Password Reset Email
                </IonButton>
                <IonButton expand="block" color="medium" routerLink="/tab2">
                  Back to FloodCast
                </IonButton>
                <IonButton expand="block" color="danger" onClick={() => setConfirmLogout(true)}>
                  Logout
                </IonButton>
              </div>
            </form>
          </IonCardContent>
        </IonCard>

        {/* Role Information Section */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Role & Permissions</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonList>
              <IonItem lines="none">
                <IonLabel>
                  <h2>Current Role</h2>
                  <p>
                    <IonBadge color={
                      userProfile?.role === UserRole.Admin ? 'danger' :
                      userProfile?.role === UserRole.Moderator ? 'warning' :
                      'primary'
                    }>{userProfile?.role ?? UserRole.User}</IonBadge>
                  </p>
                </IonLabel>
              </IonItem>
            </IonList>
            <IonAccordionGroup>
              <IonAccordion value="perms">
                <IonItem slot="header">
                  <IonLabel>Permissions Summary</IonLabel>
                </IonItem>
                <div className="ion-padding" slot="content">
                  <ul>
                    <li>Create comments: {perms.canCreateComments() ? 'Yes' : 'No'}</li>
                    <li>Manage users: {perms.canManageUsers() ? 'Yes' : 'No'}</li>
                    <li>Moderator: {perms.isModerator() ? 'Yes' : 'No'}</li>
                    <li>Admin: {perms.isAdmin() ? 'Yes' : 'No'}</li>
                  </ul>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
            {!perms.isAdmin() && (
              <div className="ion-padding-top">
                <IonButton expand="block" fill="outline" onClick={() => setSuccessMsg('Role upgrade request sent')}>
                  Request Role Upgrade
                </IonButton>
              </div>
            )}
          </IonCardContent>
        </IonCard>

        {/* Admin Controls Section */}
        {perms.isAdmin() && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Admin Controls</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <div className="ion-padding-bottom">
                <IonButton routerLink="/admin/users">Open User Management</IonButton>
              </div>
              {adminLoading && <IonNote color="medium">Loading admin stats…</IonNote>}
              {!adminLoading && adminStats && (
                <div>
                  <p>Total loaded users: {adminStats.total}</p>
                  <ul>
                    <li>Admins: {adminStats.byRole[UserRole.Admin]}</li>
                    <li>Moderators: {adminStats.byRole[UserRole.Moderator]}</li>
                    <li>Users: {adminStats.byRole[UserRole.User]}</li>
                  </ul>
                  <div className="ion-padding-top">
                    <strong>Recent registrations</strong>
                    <ul>
                      {adminStats.recent.map((r, idx) => (
                        <li key={idx}>{r.displayName || r.email || 'Unnamed'} • {r.role} • {r.createdAt}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </IonCardContent>
          </IonCard>
        )}
        <IonToast isOpen={!!errorMsg} message={errorMsg || ''} duration={2500} color="danger" onDidDismiss={() => setErrorMsg(null)} />
        <IonToast isOpen={!!successMsg} message={successMsg || ''} duration={1500} color="success" onDidDismiss={() => setSuccessMsg(null)} />
        <IonAlert
          isOpen={confirmLogout}
          header="Logout"
          message="Are you sure you want to logout?"
          buttons={[
            { text: 'Cancel', role: 'cancel', handler: () => setConfirmLogout(false) },
            { text: 'Logout', role: 'destructive', handler: handleLogout },
          ]}
          onDidDismiss={() => setConfirmLogout(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Profile;
