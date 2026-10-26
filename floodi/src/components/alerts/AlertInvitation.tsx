import { Link } from 'react-router-dom';
import { IonIcon } from '@ionic/react';
import { notificationsOutline, chevronForwardOutline } from 'ionicons/icons';
import { useCitizenAlerts } from './useCitizenAlerts';
import './Alerts.css';

export function AlertInvitation() {
  // Public readiness is a lightweight, nonblocking read. Guests need the same
  // operational availability as the enrollment page before choosing its CTA.
  const { data } = useCitizenAlerts();
  const status = data?.subscription?.status;
  const enrolled = !!status && status !== 'unsubscribed';
  const detail = status === 'active' ? 'Email verified · Manage preferences'
    : status === 'paused' ? 'Paused · Manage preferences'
      : enrolled && !data?.emailVerified ? 'Verify your email to finish setup'
        : enrolled && data?.deliveryReady ? 'Finish setup · Enable email alerts'
          : enrolled ? 'Early access saved · View status'
            : data?.deliveryReady ? 'Email advisories · Set up alerts'
              : data ? 'Email advisories · Set up early access' : 'Email advisories · View alert options';
  return <Link className="alert-invitation" to="/alerts">
    <IonIcon icon={notificationsOutline} aria-hidden="true" />
    <span><strong>{status === 'active' ? 'Flood alerts on' : enrolled ? 'Your flood alerts' : 'Flood alerts for Carolina Beach'}</strong>
      <small>{detail}</small></span>
    <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
  </Link>;
}
