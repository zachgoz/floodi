import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IonButton, IonContent, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { notificationsOutline, mailOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { sendEmailVerification } from 'firebase/auth';
import { useCitizenAlerts } from 'src/components/alerts/useCitizenAlerts';
import * as citizenAlertsLib from 'src/lib/citizenAlerts';
import type {
  CitizenAlertPreferences,
  PublicFloodAdvisory,
} from 'src/lib/citizenAlerts';
import { trackEvent } from 'src/lib/analytics';
import 'src/components/alerts/Alerts.css';

const FALLBACK_PREFERENCES: CitizenAlertPreferences = {
  severities: { minor: true, moderate: true, major: true, extreme: true },
  categories: { upcomingWatch: true, imminentWarning: true, forecastChange: true, allClear: false },
};

const statusLabels = {
  'early-access': 'Early access saved',
  'verification-required': 'Verify your email',
  active: 'Alerts active',
  paused: 'Alerts paused',
  unsubscribed: 'Unsubscribed',
};

const states: Record<string, string> = {
  sent: 'Accepted by email service',
  queued: 'Queued',
  leased: 'Sending',
  retry: 'Retry scheduled',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  active: 'Active',
  'early-access': 'Early access',
  'verification-required': 'Verification pending',
  paused: 'Paused',
  unsubscribed: 'Unsubscribed',
};

const severityLabels = {
  minor: 'Minor Flood',
  moderate: 'Moderate Flood',
  major: 'Major Flood',
  extreme: 'Extreme Flood',
} as const;

const bulletinCategoryLabels: Record<string, string> = {
  upcoming_watch: 'Flood Watch',
  imminent_warning: 'Imminent Warning',
  forecast_escalation: 'Severity Escalated',
  forecast_change: 'Forecast Shift',
  all_clear: 'All Clear',
};

const timeLabel = (at: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));

function formatDurationMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return '< 30m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function prefsEqual(a: CitizenAlertPreferences, b: CitizenAlertPreferences): boolean {
  return (
    a.severities.minor === b.severities.minor &&
    a.severities.moderate === b.severities.moderate &&
    a.severities.major === b.severities.major &&
    a.severities.extreme === b.severities.extreme &&
    a.categories.upcomingWatch === b.categories.upcomingWatch &&
    a.categories.imminentWarning === b.categories.imminentWarning &&
    a.categories.forecastChange === b.categories.forecastChange &&
    a.categories.allClear === b.categories.allClear
  );
}

function topDriversForAdvisory(adv: PublicFloodAdvisory): Array<{ label: string; text: string }> {
  if (!adv.drivers) return [];
  const entries: Array<{ label: string; val: number }> = [
    { label: 'Ocean Surge', val: adv.drivers.oceanSurgeFt },
    { label: 'N/NE Wind', val: adv.drivers.windSetupFt },
    { label: 'Cape Fear River', val: adv.drivers.riverFlowFt },
    { label: 'Rainfall', val: adv.drivers.rainfallRunoffFt },
    { label: 'Estuarine Harmonics', val: adv.drivers.estuarineHarmonicFt },
  ];
  return entries
    .filter(e => Math.abs(e.val) >= 0.03)
    .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
    .slice(0, 3)
    .map(e => ({
      label: e.label,
      text: `${e.label} ${e.val >= 0 ? '+' : '−'}${Math.abs(e.val).toFixed(2)} ft`,
    }));
}

function getOptionalDefaultPrefs(): CitizenAlertPreferences {
  try {
    return citizenAlertsLib.DEFAULT_CITIZEN_ALERT_PREFERENCES ?? FALLBACK_PREFERENCES;
  } catch {
    return FALLBACK_PREFERENCES;
  }
}

function getOptionalChartUrl(generatedAt?: string): string {
  try {
    if (typeof citizenAlertsLib.citizenAlertChartUrl === 'function') {
      return citizenAlertsLib.citizenAlertChartUrl(generatedAt);
    }
  } catch {
    // Fallback when citizenAlerts module is partially mocked in tests
  }
  return '/api/alerts?chart=1';
}

export function Alerts() {
  const hookState = useCitizenAlerts();
  const { data, busy, error, refresh, change, user, authLoading } = hookState;
  const feed = 'feed' in hookState ? hookState.feed : null;

  const defaultPrefs = getOptionalDefaultPrefs();

  const [consent, setConsent] = useState(false);
  const [customizeBeforeEnroll, setCustomizeBeforeEnroll] = useState(false);
  const [prefs, setPrefs] = useState<CitizenAlertPreferences>(defaultPrefs);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const identity = useRef(user?.uid);
  identity.current = user?.uid;
  const verificationOperation = useRef(0);
  const subscription = data?.subscription;

  const serverPrefs = useMemo<CitizenAlertPreferences>(
    () => subscription?.preferences ?? defaultPrefs,
    [subscription?.preferences, defaultPrefs]
  );

  useEffect(() => {
    trackEvent('alert_setup_view');
  }, []);

  useEffect(() => {
    ++verificationOperation.current;
    setConsent(false);
    setCustomizeBeforeEnroll(false);
    setNotice(null);
    setVerificationBusy(false);
    setResendAfter(0);
  }, [user?.uid]);

  useEffect(() => {
    setPrefs(serverPrefs);
  }, [serverPrefs]);

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
    setVerificationBusy(true);
    setNotice(null);
    try {
      await sendEmailVerification(user, {
        url: new URL('/alerts', citizenAlertsLib.citizenPublicBaseUrl()).href,
      });
      if (!current()) return;
      setResendAfter(Date.now() + 60_000);
      setNotice('Verification link sent. Open it in your email, then return here.');
      trackEvent('alert_email_verification_requested');
    } catch {
      if (current()) {
        setNotice('The verification email could not be sent. Please wait a minute and try again.');
      }
    } finally {
      if (current()) setVerificationBusy(false);
    }
  };

  const recheck = async () => {
    if (!user || verificationBusy) return;
    const owner = user.uid;
    const operation = ++verificationOperation.current;
    const current = () => identity.current === owner && verificationOperation.current === operation;
    setVerificationBusy(true);
    setNotice(null);
    try {
      await user.reload();
      await user.getIdToken(true);
      if (current()) refresh();
    } catch {
      if (current()) setNotice('Could not check verification. Please try again.');
    } finally {
      if (current()) setVerificationBusy(false);
    }
  };

  const act = async (
    action: 'enroll' | 'resume' | 'pause' | 'unsubscribe' | 'test' | 'update_preferences'
  ) => {
    setNotice(null);
    const customEnrollPrefs =
      action === 'enroll' && !prefsEqual(prefs, defaultPrefs) ? prefs : undefined;
    const payloadPrefs = action === 'update_preferences' ? prefs : customEnrollPrefs;
    const value =
      payloadPrefs !== undefined ? await change(action, payloadPrefs) : await change(action);
    if (value) {
      setConsent(false);
      if (action === 'test') setNotice('Test email queued. Its status will appear below.');
      if (action === 'update_preferences') setNotice('Alert category preferences saved.');
      trackEvent('alert_setup_action', { action, state: value.subscription?.status ?? 'none' });
    }
  };

  const toggleSeverity = (tier: keyof CitizenAlertPreferences['severities']) => {
    setPrefs(prev => ({
      ...prev,
      severities: { ...prev.severities, [tier]: !prev.severities[tier] },
    }));
  };

  const toggleCategory = (cat: keyof CitizenAlertPreferences['categories']) => {
    setPrefs(prev => ({
      ...prev,
      categories: { ...prev.categories, [cat]: !prev.categories[cat] },
    }));
  };

  const enrolled = !!subscription && subscription.status !== 'unsubscribed';
  const prefsDirty = !prefsEqual(prefs, serverPrefs);
  const chartUrl = getOptionalChartUrl(feed?.generatedAt);

  const renderPreferenceControls = () => (
    <div className="alerts-pref-section">
      <fieldset className="alerts-pref-fieldset">
        <legend className="alerts-pref-legend">Flood Severity Tiers (ft MLLW)</legend>
        <div className="alerts-pref-grid">
          <div className="alerts-pref-option">
            <input
              id="pref-sev-minor"
              type="checkbox"
              checked={prefs.severities.minor}
              aria-describedby="pref-sev-minor-desc"
              onChange={() => toggleSeverity('minor')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-sev-minor">Minor Flood Alerts</label>
              <span id="pref-sev-minor-desc" className="alerts-pref-desc">
                5.6 – 6.9 ft MLLW · Canal Dr &amp; Florida Ave nuisance water
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-sev-moderate"
              type="checkbox"
              checked={prefs.severities.moderate}
              aria-describedby="pref-sev-moderate-desc"
              onChange={() => toggleSeverity('moderate')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-sev-moderate">Moderate Flood Alerts</label>
              <span id="pref-sev-moderate-desc" className="alerts-pref-desc">
                7.0 – 7.6 ft MLLW · Road closures &amp; structural threat
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-sev-major"
              type="checkbox"
              checked={prefs.severities.major}
              aria-describedby="pref-sev-major-desc"
              onChange={() => toggleSeverity('major')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-sev-major">Major Flood Alerts</label>
              <span id="pref-sev-major-desc" className="alerts-pref-desc">
                7.7 – 8.4 ft MLLW · Widespread inundation &amp; property hazard
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-sev-extreme"
              type="checkbox"
              checked={prefs.severities.extreme}
              aria-describedby="pref-sev-extreme-desc"
              onChange={() => toggleSeverity('extreme')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-sev-extreme">Extreme Flood Alerts</label>
              <span id="pref-sev-extreme-desc" className="alerts-pref-desc">
                8.5+ ft MLLW · Severe coastal &amp; hurricane storm surge
              </span>
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="alerts-pref-fieldset">
        <legend className="alerts-pref-legend">Alert Lifecycle Categories</legend>
        <div className="alerts-pref-grid">
          <div className="alerts-pref-option">
            <input
              id="pref-cat-watch"
              type="checkbox"
              checked={prefs.categories.upcomingWatch}
              aria-describedby="pref-cat-watch-desc"
              onChange={() => toggleCategory('upcomingWatch')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-cat-watch">Upcoming Flood Watch</label>
              <span id="pref-cat-watch-desc" className="alerts-pref-desc">
                First alert when a high-tide crest enters the 48-hour forecast
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-cat-imminent"
              type="checkbox"
              checked={prefs.categories.imminentWarning}
              aria-describedby="pref-cat-imminent-desc"
              onChange={() => toggleCategory('imminentWarning')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-cat-imminent">Imminent Flood Warning</label>
              <span id="pref-cat-imminent-desc" className="alerts-pref-desc">
                Final heads-up ~3 hours before water crosses flood stage
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-cat-change"
              type="checkbox"
              checked={prefs.categories.forecastChange}
              aria-describedby="pref-cat-change-desc"
              onChange={() => toggleCategory('forecastChange')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-cat-change">Forecast Change &amp; Escalation</label>
              <span id="pref-cat-change-desc" className="alerts-pref-desc">
                Severity tier upgrades or ≥0.30 ft / 60m shifts (6h anti-spam cooldown)
              </span>
            </div>
          </div>

          <div className="alerts-pref-option">
            <input
              id="pref-cat-clear"
              type="checkbox"
              checked={prefs.categories.allClear}
              aria-describedby="pref-cat-clear-desc"
              onChange={() => toggleCategory('allClear')}
            />
            <div className="alerts-pref-text">
              <label htmlFor="pref-cat-clear">All-Clear Advisories</label>
              <span id="pref-cat-clear-desc" className="alerts-pref-desc">
                Confirmation when a warned tide recedes below 5.45 ft MLLW
              </span>
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <div className="alerts-toolbar-row">
            <Link to="/tab2" className="alerts-back-link">
              ← Forecast
            </Link>
            <IonTitle>Flood Alerts</IonTitle>
          </div>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="alerts-page">
          <section className="alerts-hero">
            <IonIcon icon={notificationsOutline} aria-hidden="true" />
            <p className="alerts-eyebrow">Carolina Beach, NC</p>
            <h1>
              {subscription?.status === 'verification-required' && data?.emailVerified
                ? data.deliveryReady
                  ? 'Finish your alert setup'
                  : 'Early access saved'
                : subscription
                ? statusLabels[subscription.status]
                : 'Stay ahead of high water'}
            </h1>
            <p>
              Live in-app flood advisories and customizable email alerts with peak timing,
              48-hour hydrograph charts, wind setup, and street water estimates.
            </p>
            <span className="alerts-state">
              {data?.deliveryReady ? 'Email pilot' : 'Early access'}
            </span>
          </section>

          {/* Public In-App Live Advisories & 48h Hydrograph (No Login Required) */}
          {feed && (
            <section className="alerts-card" aria-label="Live Carolina Beach flood advisories">
              <div className="alerts-card-heading">
                <h2>Live 48-Hour Flood Advisories</h2>
                <span className="alerts-bulletin-time">
                  Updated {timeLabel(feed.generatedAt)} ET
                </span>
              </div>

              {feed.activeAdvisories.length > 0 ? (
                <ul className="alerts-advisory-list" role="list">
                  {feed.activeAdvisories.map(adv => {
                    const topDrivers = topDriversForAdvisory(adv);
                    const refNowMs = Date.parse(feed.generatedAt) || Date.now();
                    const hoursUntilStart = (Date.parse(adv.startAt) - refNowMs) / 3600_000;
                    const phaseText =
                      adv.startClipped || hoursUntilStart <= 0
                        ? 'Flooding Now'
                        : hoursUntilStart <= 3.5
                        ? `Imminent · In ${hoursUntilStart.toFixed(1)}h`
                        : `Upcoming · In ${Math.round(hoursUntilStart)}h`;
                    return (
                      <li
                        key={adv.episodeId}
                        className={`alerts-advisory-item sev-${adv.severity}`}
                      >
                        <div className="alerts-advisory-top">
                          <span className={`alerts-sev-pill ${adv.severity}`}>
                            {severityLabels[adv.severity]}
                          </span>
                          <span className="alerts-phase-tag">{phaseText}</span>
                        </div>

                        <div className="alerts-advisory-grid">
                          <div className="alerts-metric-box">
                            <span>Forecast Crest</span>
                            <strong>{adv.peakFt.toFixed(2)} ft MLLW</strong>
                          </div>
                          <div className="alerts-metric-box">
                            <span>Peak Timing</span>
                            <strong>{timeLabel(adv.peakAt)} ET</strong>
                          </div>
                          <div className="alerts-metric-box">
                            <span>Flood Duration</span>
                            <strong>{formatDurationMinutes(adv.durationMinutes)}</strong>
                          </div>
                          <div className="alerts-metric-box">
                            <span>Est. Low-Street Water</span>
                            <strong>~{adv.estimatedStreetDepthIn.toFixed(1)} in</strong>
                          </div>
                        </div>

                        {(adv.windSpeedMph !== null || adv.precipWindowIn > 0) && (
                          <p className="alerts-bulletin-summary">
                            Conditions at peak:{' '}
                            {adv.windSpeedMph !== null
                              ? `${adv.windCompass ?? ''} ${Math.round(adv.windSpeedMph)} mph wind`.trim()
                              : 'Wind unavailable'}
                            {adv.precipWindowIn > 0
                              ? ` · ${adv.precipWindowIn.toFixed(2)} in rain`
                              : ''}
                          </p>
                        )}

                        {topDrivers.length > 0 && (
                          <div className="alerts-driver-chips">
                            {topDrivers.map(d => (
                              <span key={d.label} className="alerts-driver-chip">
                                {d.text}
                              </span>
                            ))}
                          </div>
                        )}

                        <Link
                          className="alerts-deep-link"
                          to={`/tab2?t=${encodeURIComponent(adv.peakAt)}`}
                        >
                          View Peak on Live Hydrograph →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="alerts-calm-banner">
                  <div className="alerts-calm-header">
                    <span className="alerts-calm-pill">✓ Below 5.6 ft Flood Stage</span>
                    <span className="alerts-bulletin-time">Next 48 Hours Clear</span>
                  </div>
                  <div className="alerts-calm-metrics">
                    {feed.nextPeakFt !== null && feed.nextPeakAt && (
                      <span>
                        Next 48h Peak: <strong>{feed.nextPeakFt.toFixed(2)} ft MLLW</strong> (
                        {timeLabel(feed.nextPeakAt)} ET)
                      </span>
                    )}
                    {feed.currentSurgeFt !== null && (
                      <span>
                        Current Surge:{' '}
                        <strong>
                          {feed.currentSurgeFt >= 0 ? '+' : ''}
                          {feed.currentSurgeFt.toFixed(2)} ft
                        </strong>
                      </span>
                    )}
                  </div>
                  <Link className="alerts-deep-link" to="/tab2">
                    Open Interactive Hydrograph &amp; Street Map →
                  </Link>
                </div>
              )}

              <div className="alerts-chart-preview">
                <img
                  src={chartUrl}
                  alt="48-hour Carolina Beach operational water-level forecast hydrograph with 5.6, 7.0, and 7.7 ft MLLW flood thresholds"
                  className="alerts-chart-img"
                  loading="lazy"
                />
                <p className="alerts-chart-caption">
                  Live 48-hour operational forecast hydrograph (embedded automatically in FloodCast
                  email alerts)
                </p>
              </div>

              {feed.recentBulletins.length > 0 && (
                <>
                  <h3>Recent Advisory Bulletins</h3>
                  <ul className="alerts-bulletin-list" role="list">
                    {feed.recentBulletins.slice(0, 5).map(b => (
                      <li key={b.id} className="alerts-bulletin-item">
                        <div className="alerts-bulletin-head">
                          <div>
                            <span className={`alerts-sev-pill ${b.severity ?? 'minor'}`}>
                              {bulletinCategoryLabels[b.category] ?? b.category}
                            </span>{' '}
                            <strong>{b.headline}</strong>
                          </div>
                          <span className="alerts-bulletin-time">{timeLabel(b.issuedAt)} ET</span>
                        </div>
                        {b.whatChanged && (
                          <p className="alerts-bulletin-change">{b.whatChanged}</p>
                        )}
                        <p className="alerts-bulletin-summary">{b.summary}</p>
                        {b.peakAt && (
                          <Link
                            className="alerts-deep-link"
                            to={`/tab2?t=${encodeURIComponent(b.peakAt)}`}
                          >
                            Inspect on Hydrograph →
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {/* Account & Email Alert Preferences */}
          {!authLoading && !user ? (
            <section className="alerts-card">
              <h2>Set up personalized email alerts</h2>
              <p>
                Choose which flood severity tiers (5.6 Minor, 7.0 Moderate, 7.7 Major, 8.5 Extreme)
                and alert categories you want emailed to you. Live in-app advisories remain
                available without an account.
              </p>
              <IonButton expand="block" routerLink="/register?redirect=%2Falerts">
                Create account
              </IonButton>
              <IonButton expand="block" fill="outline" routerLink="/login?redirect=%2Falerts">
                Sign in
              </IonButton>
            </section>
          ) : user ? (
            <section className="alerts-card">
              <div className="alerts-card-heading">
                <h2>Your email</h2>
                <span className="alerts-state">
                  {data?.emailVerified ? 'Verified' : 'Verification required'}
                </span>
              </div>
              <p className="alerts-email">
                <IonIcon icon={mailOutline} aria-hidden="true" />
                {data?.email ?? user.email}
              </p>
              {data && !data.emailVerified && (
                <div className="alerts-actions">
                  <IonButton
                    onClick={verify}
                    disabled={verificationBusy || resendAfter > Date.now()}
                  >
                    {resendAfter > Date.now() ? 'Link sent' : 'Send verification link'}
                  </IonButton>
                  <IonButton fill="clear" onClick={recheck} disabled={verificationBusy}>
                    I’ve verified my email
                  </IonButton>
                </div>
              )}

              {data && !enrolled && (
                <>
                  <h2>Carolina Beach email advisories</h2>
                  <p>
                    Operational gauge &amp; surge forecast · 5.6 Minor / 7.0 Moderate / 7.7 Major /
                    8.5 Extreme ft MLLW
                  </p>
                  <div className="alerts-tier-summary">
                    <span className="alerts-sev-pill minor">Minor ≥ 5.6 ft</span>
                    <span className="alerts-sev-pill moderate">Moderate ≥ 7.0 ft</span>
                    <span className="alerts-sev-pill major">Major ≥ 7.7 ft</span>
                    <span className="alerts-sev-pill extreme">Extreme ≥ 8.5 ft</span>
                  </div>
                  <button
                    type="button"
                    className="alerts-customize-toggle"
                    aria-expanded={customizeBeforeEnroll}
                    onClick={() => setCustomizeBeforeEnroll(v => !v)}
                  >
                    {customizeBeforeEnroll
                      ? 'Hide alert category options ▴'
                      : 'Customize alert categories & severity tiers ▾'}
                  </button>
                  {customizeBeforeEnroll && renderPreferenceControls()}

                  <label className="alerts-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                    />
                    <span>
                      Email me flood advisories and important forecast updates for Carolina Beach.
                      I can unsubscribe at any time. <Link to="/privacy">Privacy</Link>
                    </span>
                  </label>
                  <IonButton
                    expand="block"
                    disabled={!consent || busy}
                    onClick={() => act('enroll')}
                  >
                    {busy
                      ? 'Saving…'
                      : data.deliveryReady
                      ? 'Enable email alerts'
                      : 'Join early access'}
                  </IonButton>
                </>
              )}

              {enrolled && (
                <>
                  <div className="alerts-coverage">
                    <IonIcon icon={checkmarkCircleOutline} aria-hidden="true" />
                    <div>
                      <strong>Carolina Beach operational flood alerts</strong>
                      <span>
                        Rich HTML email + 48h hydrograph chart · Anti-spam 6h cooldown &amp; 0.15 ft
                        hysteresis
                      </span>
                    </div>
                  </div>
                  {!data?.deliveryReady && (
                    <p className="alerts-notice">
                      Your preferences are saved. Flood email delivery is not active yet.
                    </p>
                  )}

                  {renderPreferenceControls()}

                  {prefsDirty && (
                    <div className="alerts-actions">
                      <IonButton
                        disabled={busy}
                        onClick={() => act('update_preferences')}
                      >
                        {busy ? 'Saving preferences…' : 'Save alert preferences'}
                      </IonButton>
                    </div>
                  )}

                  <div className="alerts-actions">
                    {subscription.status === 'active' && (
                      <>
                        <IonButton
                          fill="outline"
                          disabled={busy}
                          onClick={() => act('test')}
                        >
                          Send test email
                        </IonButton>
                        <IonButton
                          fill="clear"
                          disabled={busy}
                          onClick={() => act('pause')}
                        >
                          Pause alerts
                        </IonButton>
                      </>
                    )}
                    {data?.emailVerified &&
                      data.deliveryReady &&
                      ['early-access', 'verification-required'].includes(subscription.status) && (
                        <IonButton disabled={busy} onClick={() => act('resume')}>
                          Finish setup
                        </IonButton>
                      )}
                    {subscription.status === 'paused' && (
                      <IonButton disabled={busy} onClick={() => act('resume')}>
                        Resume email alerts
                      </IonButton>
                    )}
                    <IonButton
                      fill="clear"
                      disabled={busy}
                      onClick={() => act('unsubscribe')}
                    >
                      Unsubscribe
                    </IonButton>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {(busy || authLoading) && <p role="status">Loading alert preferences…</p>}
          {error && (
            <div className="alerts-error" role="alert">
              <p>{error}</p>
              <IonButton size="small" fill="outline" onClick={refresh}>
                Try again
              </IonButton>
            </div>
          )}
          {notice && (
            <p className="alerts-notice" role="status">
              {notice}
            </p>
          )}
          {data?.history.length ? (
            <section className="alerts-card">
              <div className="alerts-card-heading">
                <h2>Recent email activity</h2>
                <IonButton size="small" fill="clear" disabled={busy} onClick={refresh}>
                  Refresh
                </IonButton>
              </div>
              <ul className="alerts-history" role="list">
                {data.history.map(item => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.subject}</strong>
                      <span>{timeLabel(item.createdAt)} ET</span>
                    </div>
                    <span>{states[item.state] ?? item.state}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <details className="alerts-details">
            <summary>What these alerts cover</summary>
            <p>
              Advisories evaluate the unified Carolina Beach operational forecast against official
              local flood stages (5.6 Minor, 7.0 Moderate, 7.7 Major, and 8.5 Extreme ft MLLW).
              Anti-spam hysteresis (0.15 ft) and a 6-hour same-tier cooldown prevent repetitive
              notifications while ensuring severity upgrades notify you immediately.
            </p>
            <p>
              Advisories do not confirm exact water depth on every street or whether a road is safe
              to travel. Service acceptance of an email does not confirm inbox placement.
            </p>
          </details>
          <p className="alerts-support">
            <a href="mailto:floodcastapp@gmail.com">Contact support</a> ·{' '}
            <Link to="/tab2">View forecast</Link>
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
}

/** The first inline bootstrap removes capabilities before analytics initializes. */
function consumeUnsubscribeToken(): string {
  const browser = window as Window & { __floodcastUnsubscribeToken?: string };
  const token = browser.__floodcastUnsubscribeToken ?? '';
  return token;
}

export function UnsubscribeAlerts() {
  const [token] = useState(consumeUnsubscribeToken);
  useEffect(() => {
    delete (window as Window & { __floodcastUnsubscribeToken?: string }).__floodcastUnsubscribeToken;
  }, []);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await citizenAlertsLib.unsubscribeCitizenAlerts(token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Email preferences</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="alerts-page">
          <section className="alerts-card">
            <h1>{done ? 'Request processed' : 'Unsubscribe from flood emails'}</h1>
            {done ? (
              <p>
                The subscription link has been processed. If you signed up again after receiving
                this email, manage your current alerts below.
              </p>
            ) : token ? (
              <>
                <p>Turn off FloodCast emails for this subscription.</p>
                <IonButton expand="block" disabled={busy} onClick={confirm}>
                  {busy ? 'Updating…' : 'Unsubscribe from email alerts'}
                </IonButton>
              </>
            ) : (
              <p>
                Open the unsubscribe link from your email, or sign in to manage your preferences.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <Link to="/alerts">Manage alerts</Link>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
