import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonAlert,
  IonButton,
  IonContent,
  IonHeader,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonToggle,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToast,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
} from '@ionic/react';
import { refresh as refreshIcon, personCircle } from 'ionicons/icons';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { getUsersByRole, getUsersByRolePage, updateUserRole, updateUserProfile } from 'src/lib/userService';
import { UserRole, type UserProfile } from 'src/types/user';

const ROLES: UserRole[] = [UserRole.User, UserRole.Moderator, UserRole.Admin];

/** Admin-only UI for viewing and updating user roles. */
export const UserRoleManager: React.FC = () => {
  const { isAdmin } = useUserPermissions();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<UserRole, any>>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ uid: string; role: UserRole } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [admins, moderators, usersRole] = await Promise.all([
        getUsersByRolePage(UserRole.Admin),
        getUsersByRolePage(UserRole.Moderator),
        getUsersByRolePage(UserRole.User),
      ]);
      setUsers([...(admins.items), ...(moderators.items), ...(usersRole.items)]);
      setCursors({
        [UserRole.Admin]: admins.nextCursor,
        [UserRole.Moderator]: moderators.nextCursor,
        [UserRole.User]: usersRole.nextCursor,
      });
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin()) void load();
  }, [isAdmin, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.email || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const submitRoleChange = async (uid: string, role: UserRole) => {
    setConfirm({ uid, role });
  };

  const confirmRoleChange = async () => {
    if (!confirm) return;
    try {
      await updateUserRole(confirm.uid, confirm.role);
      setSuccess('Role updated');
      await load();
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'Failed to update role');
    } finally {
      setConfirm(null);
    }
  };

  const loadMore = async (role: UserRole) => {
    try {
      setLoading(true);
      const page = await getUsersByRolePage(role, { cursor: cursors[role] || null });
      setUsers((prev) => [...prev, ...page.items]);
      setCursors((prev) => ({ ...prev, [role]: page.nextCursor }));
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'Failed to load more');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (u: UserProfile, isActive: boolean) => {
    try {
      await updateUserProfile(u.uid, { isActive });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, isActive } : x)));
      setSuccess(isActive ? 'User activated' : 'User deactivated');
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'Failed to update user');
    }
  };

  const formatTs = (ts?: any) => {
    try {
      if (!ts) return '—';
      const d = 'toDate' in ts ? ts.toDate() as Date : new Date(String(ts));
      return d.toLocaleString();
    } catch {
      return '—';
    }
  };

  if (!isAdmin()) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/profile" />
            </IonButtons>
            <IonTitle>User Management</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          Admin access required.
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/profile" />
          </IonButtons>
          <IonTitle>User Management</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="ion-padding-bottom" aria-label="breadcrumb">Profile &gt; User Management</div>
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Summary</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <p>Total loaded users: {users.length}</p>
            <ul>
              <li>Admins: {users.filter((u) => u.role === UserRole.Admin).length}</li>
              <li>Moderators: {users.filter((u) => u.role === UserRole.Moderator).length}</li>
              <li>Users: {users.filter((u) => u.role === UserRole.User).length}</li>
            </ul>
            <div className="ion-padding-top">
              <strong>Recent activity</strong>
              <ul>
                {users
                  .slice()
                  .sort((a: any, b: any) => {
                    const ad = 'toDate' in (a.createdAt || {}) ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(String(a.createdAt)).getTime() : 0);
                    const bd = 'toDate' in (b.createdAt || {}) ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(String(b.createdAt)).getTime() : 0);
                    return bd - ad;
                  })
                  .slice(0, 5)
                  .map((u) => (
                    <li key={u.uid}>{u.displayName || u.email || 'Unnamed'} • {u.role} • {formatTs(u.createdAt)}</li>
                  ))}
              </ul>
            </div>
          </IonCardContent>
        </IonCard>
        <IonSearchbar value={search} onIonInput={(e) => setSearch(e.detail.value || '')} placeholder="Search by email or name" />
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent pullingIcon={refreshIcon} refreshingSpinner="circles" />
        </IonRefresher>
        <IonList>
          {([UserRole.Admin, UserRole.Moderator, UserRole.User] as const).map((role) => (
            <React.Fragment key={role}>
              {filtered.filter((u) => u.role === role).map((u) => (
                <IonItem key={u.uid}>
                  <IonIcon icon={personCircle} slot="start" />
                  <IonLabel>
                    <h2>{u.displayName || 'Unnamed'}</h2>
                    <p>{u.email || 'No email'} • {u.role}</p>
                    <p>Created: {formatTs(u.createdAt)} • Last login: {formatTs(u.lastLoginAt)}</p>
                  </IonLabel>
                  <IonToggle
                    checked={!!u.isActive}
                    onIonChange={(e) => toggleActive(u, !!e.detail.checked)}
                    aria-label={`Active status for ${u.email || u.uid}`}
                  />
                  <IonSelect
                    labelPlacement="stacked"
                    aria-label={`Role for ${u.email || u.uid}`}
                    interface="popover"
                    value={u.role}
                    onIonChange={(e) => submitRoleChange(u.uid, e.detail.value as UserRole)}
                    disabled={loading}
                  >
                    {ROLES.map((r) => (
                      <IonSelectOption key={r} value={r}>{r}</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              ))}
              {cursors[role] ? (
                <IonButton onClick={() => loadMore(role)} disabled={loading}>
                  Load more {role}s
                </IonButton>
              ) : null}
            </React.Fragment>
          ))}
        </IonList>
        <IonButton onClick={() => load()} disabled={loading}>
          <IonIcon icon={refreshIcon} slot="start" />
          Refresh
        </IonButton>
        <IonToast isOpen={!!error} color="danger" message={error || ''} duration={2500} onDidDismiss={() => setError(null)} />
        <IonToast isOpen={!!success} color="success" message={success || ''} duration={1500} onDidDismiss={() => setSuccess(null)} />
        <IonAlert
          isOpen={!!confirm}
          header="Change role"
          message={`Change this user's role to ${confirm?.role}?`}
          buttons={[
            { text: 'Cancel', role: 'cancel', handler: () => setConfirm(null) },
            { text: 'Change', role: 'confirm', handler: confirmRoleChange },
          ]}
          onDidDismiss={() => setConfirm(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default UserRoleManager;
