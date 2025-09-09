import React, { useMemo, useState } from 'react';
import {
  IonAvatar,
  IonButton,
  IonContent,
  IonHeader,
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

const Profile: React.FC = () => {
  const { user, isAnonymous, updateUserProfile, logout } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [photoURL, setPhotoURL] = useState(user?.photoURL || '');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const created = useMemo(() => (user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleString() : ''), [user]);
  const lastSignIn = useMemo(() => (user?.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString() : ''), [user]);

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
        <form onSubmit={save} aria-label="Profile form">
        <IonList>
          <IonItem lines="none">
            <IonAvatar slot="start">
              <img src={photoURL || user?.photoURL || 'https://www.gravatar.com/avatar?d=mp'} alt="Avatar" />
            </IonAvatar>
            <IonLabel>
              <h2>{user?.displayName || 'Unnamed User'}</h2>
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
          <IonButton expand="block" color="medium" routerLink="/tab2">
            Back to FloodCast
          </IonButton>
          <IonButton expand="block" color="danger" onClick={() => setConfirmLogout(true)}>
            Logout
          </IonButton>
        </div>
        </form>
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
