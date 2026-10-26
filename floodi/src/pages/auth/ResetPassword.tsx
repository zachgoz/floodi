import React, { useState } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonPage,
  IonText,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';
import { Link, useHistory, useLocation } from 'react-router-dom';
import { useAuth } from 'src/contexts/AuthContext';
import { isValidEmail, formatFirebaseAuthError, getRedirectFromSearch } from 'src/utils/auth';

const ResetPassword: React.FC = () => {
  const { resetPassword, signInAnonymously, user } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const redirectTo = getRedirectFromSearch(location.search, '/tab2');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return setErrorMsg('Please enter a valid email.');
    try {
      setLoading(true);
      await resetPassword(email);
      setSuccessMsg('Password reset email sent. Check your inbox and spam folder.');
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
          <IonTitle>Reset Password</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <form onSubmit={handleSubmit} aria-label="Reset password form">
          <IonList>
            <IonItem>
              <IonInput label="Email" labelPlacement="stacked" type="email" autocomplete="email" inputmode="email" value={email} onIonChange={(e) => setEmail(e.detail.value || '')} required />
            </IonItem>
          </IonList>
          <div className="ion-padding-top">
            <IonButton type="submit" expand="block" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Email'}
            </IonButton>
            <IonButton type="button" expand="block" fill="outline" disabled={loading}
              onClick={async () => {
                try {
                  if (!user) { await signInAnonymously(); }
                  history.replace('/tab2');
                } catch (err: unknown) {
                  setErrorMsg(formatFirebaseAuthError(err).message);
                }
              }}
            >
              Continue as Guest
            </IonButton>
          </div>
        </form>
        <div className="ion-text-center ion-padding-top">
          <IonText>Remembered your password? </IonText>
          <Link to={`/login?redirect=${encodeURIComponent(redirectTo)}`}>Back to Login</Link>
        </div>
        <IonToast isOpen={!!errorMsg} message={errorMsg || ''} duration={2500} color="danger" onDidDismiss={() => setErrorMsg(null)} />
        <IonToast isOpen={!!successMsg} message={successMsg || ''} duration={3000} color="success" onDidDismiss={() => setSuccessMsg(null)} />
      </IonContent>
    </IonPage>
  );
};

export default ResetPassword;
