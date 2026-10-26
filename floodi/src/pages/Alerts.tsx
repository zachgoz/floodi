import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IonButton, IonContent, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { notificationsOutline, mailOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { sendEmailVerification } from 'firebase/auth';
import { useCitizenAlerts } from 'src/components/alerts/useCitizenAlerts';
import { unsubscribeCitizenAlerts, citizenPublicBaseUrl } from 'src/lib/citizenAlerts';
import { trackEvent } from 'src/lib/analytics';
import 'src/components/alerts/Alerts.css';

const statusLabels = { 'early-access': 'Early access saved', 'verification-required': 'Verify your email', active: 'Alerts active', paused: 'Alerts paused', unsubscribed: 'Unsubscribed' };
const states: Record<string, string> = { sent: 'Accepted by email service', queued: 'Queued', leased: 'Sending', retry: 'Retry scheduled', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled', active: 'Active', 'early-access': 'Early access', 'verification-required': 'Verification pending', paused: 'Paused', unsubscribed: 'Unsubscribed' };
const timeLabel = (at: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at));

export function Alerts() {
  const { data, busy, error, refresh, change, user, authLoading } = useCitizenAlerts();
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const identity = useRef(user?.uid);
  identity.current = user?.uid;
  const verificationOperation = useRef(0);
  const subscription = data?.subscription;
  useEffect(() => { trackEvent('alert_setup_view'); }, []);
  useEffect(() => {
    ++verificationOperation.current;
    setConsent(false); setNotice(null); setVerificationBusy(false); setResendAfter(0);
  }, [user?.uid]);
  useEffect(() => {
    if (!resendAfter) return;
    const timer = setTimeout(() => setResendAfter(0), Math.max(0, resendAfter - Date.now()));
    return () => clearTimeout(timer);
  }, [resendAfter]);

  const verify = async () => {
    if (!user || verificationBusy) return;
    const owner = user.uid;
    const operation = ++verificationOperation.current;
    const current = () => identity.current === owner && verificationOperation.current === operation;
    setVerificationBusy(true); setNotice(null);
    try {
      await sendEmailVerification(user, { url: new URL('/alerts', citizenPublicBaseUrl()).href });
      if (!current()) return;
      setResendAfter(Date.now() + 60_000);
      setNotice('Verification link sent. Open it in your email, then return here.');
      trackEvent('alert_email_verification_requested');
    } catch { if (current()) setNotice('The verification email could not be sent. Please wait a minute and try again.'); }
    finally { if (current()) setVerificationBusy(false); }
  };
  const recheck = async () => {
    if (!user || verificationBusy) return;
    const owner = user.uid;
    const operation = ++verificationOperation.current;
    const current = () => identity.current === owner && verificationOperation.current === operation;
    setVerificationBusy(true); setNotice(null);
    try { await user.reload(); await user.getIdToken(true); if (current()) refresh(); }
    catch { if (current()) setNotice('Could not check verification. Please try again.'); }
    finally { if (current()) setVerificationBusy(false); }
  };
  const act = async (action: 'enroll' | 'resume' | 'pause' | 'unsubscribe' | 'test') => {
    setNotice(null);
    const value = await change(action);
    if (value) {
      setConsent(false);
      if (action === 'test') setNotice('Test email queued. Its status will appear below.');
      trackEvent('alert_setup_action', { action, state: value.subscription?.status ?? 'none' });
    }
  };
  const enrolled = !!subscription && subscription.status !== 'unsubscribed';
  return <IonPage>
    <IonHeader><IonToolbar><IonTitle>Flood Alerts</IonTitle></IonToolbar></IonHeader>
    <IonContent><div className="alerts-page">
      <section className="alerts-hero">
        <IonIcon icon={notificationsOutline} aria-hidden="true" />
        <p className="alerts-eyebrow">Carolina Beach, NC</p>
        <h1>{subscription?.status === 'verification-required' && data?.emailVerified ? data.deliveryReady ? 'Finish your alert setup' : 'Early access saved' : subscription ? statusLabels[subscription.status] : 'Stay ahead of high water'}</h1>
        <p>Email advisories for upcoming water-level flooding and meaningful forecast changes.</p>
        <span className="alerts-state">{data?.deliveryReady ? 'Email pilot' : 'Early access'}</span>
      </section>
      {!authLoading && !user ? <section className="alerts-card">
        <h2>Set up your alerts</h2><p>Save your preferences and verify your email. The public forecast remains available without an account.</p>
        <IonButton expand="block" routerLink="/register?redirect=%2Falerts">Create account</IonButton>
        <IonButton expand="block" fill="outline" routerLink="/login?redirect=%2Falerts">Sign in</IonButton>
      </section> : user ? <section className="alerts-card">
        <div className="alerts-card-heading"><h2>Your email</h2><span className="alerts-state">{data?.emailVerified ? 'Verified' : 'Verification required'}</span></div>
        <p className="alerts-email"><IonIcon icon={mailOutline} aria-hidden="true" />{data?.email ?? user.email}</p>
        {data && !data.emailVerified && <div className="alerts-actions">
          <IonButton onClick={verify} disabled={verificationBusy || resendAfter > Date.now()}>{resendAfter > Date.now() ? 'Link sent' : 'Send verification link'}</IonButton>
          <IonButton fill="clear" onClick={recheck} disabled={verificationBusy}>I’ve verified my email</IonButton>
        </div>}
        {data && !enrolled && <>
          <h2>Carolina Beach advisory</h2><p>Local gauge forecast · Email · 5.6 ft MLLW flood threshold</p>
          <label className="alerts-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>Email me flood advisories and important forecast updates for Carolina Beach. I can unsubscribe at any time. <Link to="/privacy">Privacy</Link></span>
          </label>
          <IonButton expand="block" disabled={!consent || busy} onClick={() => act('enroll')}>{busy ? 'Saving…' : data.deliveryReady ? 'Enable email alerts' : 'Join early access'}</IonButton>
        </>}
        {enrolled && <>
          <div className="alerts-coverage"><IonIcon icon={checkmarkCircleOutline} aria-hidden="true" /><div><strong>Carolina Beach advisory</strong><span>Local gauge forecast · Email</span></div></div>
          {!data?.deliveryReady && <p className="alerts-notice">Your preferences are saved. Flood email delivery is not active yet.</p>}
          <div className="alerts-actions">
            {subscription.status === 'active' && <><IonButton fill="outline" disabled={busy} onClick={() => act('test')}>Send test email</IonButton><IonButton fill="clear" disabled={busy} onClick={() => act('pause')}>Pause alerts</IonButton></>}
            {data?.emailVerified && data.deliveryReady && ['early-access', 'verification-required'].includes(subscription.status) && <IonButton disabled={busy} onClick={() => act('resume')}>Finish setup</IonButton>}
            {subscription.status === 'paused' && <IonButton disabled={busy} onClick={() => act('resume')}>Resume email alerts</IonButton>}
            <IonButton fill="clear" disabled={busy} onClick={() => act('unsubscribe')}>Unsubscribe</IonButton>
          </div>
        </>}
      </section> : null}
      {(busy || authLoading) && <p role="status">Loading alert preferences…</p>}
      {error && <div className="alerts-error" role="alert"><p>{error}</p><IonButton size="small" fill="outline" onClick={refresh}>Try again</IonButton></div>}
      {notice && <p className="alerts-notice" role="status">{notice}</p>}
      {data?.history.length ? <section className="alerts-card"><div className="alerts-card-heading"><h2>Recent activity</h2><IonButton size="small" fill="clear" disabled={busy} onClick={refresh}>Refresh</IonButton></div>
        <ul className="alerts-history">{data.history.map(item => <li key={item.id}><div><strong>{item.subject}</strong><span>{timeLabel(item.createdAt)} ET</span></div><span>{states[item.state] ?? item.state}</span></li>)}</ul>
      </section> : null}
      <details className="alerts-details"><summary>What these alerts cover</summary><p>Advisories concern the Carolina Beach gauge threshold. They do not confirm water depth on your street or whether a road is safe. Timing can change as new observations arrive. Service acceptance of an email does not confirm it reached your inbox.</p><p>The pilot has no paid subscription. Email delivery starts only after the service is enabled and your email is verified. Personal chart settings do not change the alert threshold.</p></details>
      <p className="alerts-support"><a href="mailto:floodcastapp@gmail.com">Contact support</a> · <Link to="/tab2">View forecast</Link></p>
    </div></IonContent>
  </IonPage>;
}

/** The first inline bootstrap removes capabilities before analytics initializes. */
function consumeUnsubscribeToken(): string {
  const browser = window as Window & { __floodcastUnsubscribeToken?: string };
  const token = browser.__floodcastUnsubscribeToken ?? '';
  return token;
}
export function UnsubscribeAlerts() {
  const [token] = useState(consumeUnsubscribeToken);
  useEffect(() => { delete (window as Window & { __floodcastUnsubscribeToken?: string }).__floodcastUnsubscribeToken; }, []);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true); setError(null);
    try { await unsubscribeCitizenAlerts(token); setDone(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <IonPage><IonHeader><IonToolbar><IonTitle>Email preferences</IonTitle></IonToolbar></IonHeader><IonContent>
    <div className="alerts-page"><section className="alerts-card">
      <h1>{done ? 'Request processed' : 'Unsubscribe from flood emails'}</h1>
      {done ? <p>The subscription link has been processed. If you signed up again after receiving this email, manage your current alerts below.</p> : token ? <><p>Turn off FloodCast emails for this subscription.</p><IonButton expand="block" disabled={busy} onClick={confirm}>{busy ? 'Updating…' : 'Unsubscribe from email alerts'}</IonButton></> : <p>Open the unsubscribe link from your email, or sign in to manage your preferences.</p>}
      {error && <p role="alert">{error}</p>}<Link to="/alerts">Manage alerts</Link>
    </section></div>
  </IonContent></IonPage>;
}
