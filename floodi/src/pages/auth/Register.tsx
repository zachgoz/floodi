import React, { useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';
import { Link, useHistory, useLocation } from 'react-router-dom';
import { useAuth } from 'src/contexts/AuthContext';
import { isValidEmail, isValidPassword, isValidDisplayName, isValidAvatarUrl, getRedirectFromSearch, formatFirebaseAuthError } from 'src/utils/auth';

const Register: React.FC = () => {
  const { register, convertAnonymousToRegistered, signInAnonymously, user, isAnonymous } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const redirectTo = useMemo(() => getRedirectFromSearch(location.search, '/tab2'), [location.search]);

  useEffect(() => {
    if (user && !isAnonymous) {
      history.replace(redirectTo);
    }
  }, [user, isAnonymous, history, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return setErrorMsg('Please enter a valid email address.');
    if (!isValidPassword(password)) return setErrorMsg('Password must be greater than 6 characters.');
    if (password !== confirm) return setErrorMsg('Passwords do not match.');
    if (displayName && !isValidDisplayName(displayName)) return setErrorMsg('Display name must be 2–50 characters.');
    if (photoURL && !isValidAvatarUrl(photoURL)) return setErrorMsg('Please enter a valid image URL.');
    try {
      setLoading(true);
      if (isAnonymous) {
        await convertAnonymousToRegistered(email, password, displayName || undefined, photoURL || undefined);
      } else {
        await register(email, password, displayName || undefined, photoURL || undefined);
      }
      setSuccessMsg('Account created! Redirecting...');
      setTimeout(() => history.replace(redirectTo), 1000);
    } catch (err: unknown) {
      setErrorMsg(formatFirebaseAuthError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Create Account</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <form onSubmit={handleSubmit} aria-label="Register form">
          <IonList>
            <IonItem>
              <IonLabel position="stacked">Email</IonLabel>
              <IonInput type="email" value={email} onIonChange={(e) => setEmail(e.detail.value || '')} required />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Password</IonLabel>
              <IonInput type="password" value={password} onIonChange={(e) => setPassword(e.detail.value || '')} required />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Confirm Password</IonLabel>
              <IonInput type="password" value={confirm} onIonChange={(e) => setConfirm(e.detail.value || '')} required />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Display Name (optional)</IonLabel>
              <IonInput value={displayName} onIonChange={(e) => setDisplayName(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Avatar URL (optional)</IonLabel>
              <IonInput value={photoURL} onIonChange={(e) => setPhotoURL(e.detail.value || '')} />
            </IonItem>
          </IonList>
          <div className="ion-padding-top">
            <IonButton type="submit" expand="block" disabled={loading}>
              {loading ? 'Creating...' : 'Create Account'}
            </IonButton>
            <IonButton type="button" expand="block" fill="outline" disabled={loading}
              onClick={async () => {
                try {
                  setLoading(true);
                  if (!user) { await signInAnonymously(); }
                  history.replace(redirectTo);
                } catch (err: unknown) {
                  setErrorMsg(formatFirebaseAuthError(err).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              Continue as Guest
            </IonButton>
          </div>
        </form>
        <div className="ion-text-center ion-padding-top">
          <IonText>Already have an account? </IonText>
          <Link to="/login">Sign in</Link>
        </div>
        <IonToast isOpen={!!errorMsg} message={errorMsg || ''} duration={2500} color="danger" onDidDismiss={() => setErrorMsg(null)} />
        <IonToast isOpen={!!successMsg} message={successMsg || ''} duration={1500} color="success" onDidDismiss={() => setSuccessMsg(null)} />
      </IonContent>
    </IonPage>
  );
};

export default Register;
