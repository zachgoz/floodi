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
import { useHistory, useLocation, Link } from 'react-router-dom';
import { useAuth } from 'src/contexts/AuthContext';
import { isValidEmail, isValidPassword, getRedirectFromSearch, formatFirebaseAuthError } from 'src/utils/auth';

const Login: React.FC = () => {
  const { login, user, isAnonymous, signInAnonymously } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const redirectTo = useMemo(() => getRedirectFromSearch(location.search, '/tab2'), [location.search]);

  useEffect(() => {
    if (user && !isAnonymous) {
      history.replace(redirectTo);
    }
  }, [user, isAnonymous, history, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!isValidPassword(password)) {
      setErrorMsg('Password must be greater than 6 characters.');
      return;
    }
    try {
      setLoading(true);
      await login(email, password);
      history.replace(redirectTo);
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
          <IonTitle>Login</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <form onSubmit={handleSubmit} aria-label="Login form">
          <IonList>
            <IonItem>
              <IonLabel position="stacked">Email</IonLabel>
              <IonInput
                type="email"
                value={email}
                onIonChange={(e) => setEmail(e.detail.value || '')}
                required
                aria-label="Email"
                autocomplete="email"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Password</IonLabel>
              <IonInput
                type="password"
                value={password}
                onIonChange={(e) => setPassword(e.detail.value || '')}
                required
                aria-label="Password"
                autocomplete="current-password"
              />
            </IonItem>
          </IonList>
          <div className="ion-padding-top">
            <IonButton type="submit" expand="block" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
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
          <p>
            <Link to="/reset-password">Forgot Password?</Link>
          </p>
          <p>
            <IonText>Don’t have an account? </IonText>
            <Link to="/register">Create Account</Link>
          </p>
        </div>
        <IonToast
          isOpen={!!errorMsg}
          message={errorMsg || ''}
          duration={2500}
          color="danger"
          onDidDismiss={() => setErrorMsg(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Login;
