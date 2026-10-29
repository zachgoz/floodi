import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar, 
  IonButtons, 
  IonBackButton, 
  IonCard, 
  IonCardHeader, 
  IonCardTitle, 
  IonCardContent 
} from '@ionic/react';
import React from 'react';
import './PrivacyPolicy.css';

/**
 * PrivacyPolicy Page Component
 *
 * Describes the app's actual data processing and support options.
 */
export const PrivacyPolicy: React.FC = () => {
  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tab3" />
          </IonButtons>
          <IonTitle>Privacy Policy</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      <IonContent className="privacy-content">
        <div className="privacy-container">
          <div className="privacy-header-section">
            <h1 className="privacy-title">Privacy Policy</h1>
            <p className="privacy-subtitle">Last Updated: October 17, 2026</p>
          </div>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>1. Introduction</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                At FloodCast, accessible from our website, one of our main priorities is the privacy of our visitors. 
                This Privacy Policy document contains types of information that is collected and recorded by FloodCast 
                and how we use it. If you have additional questions or require more information about our Privacy Policy, 
                contact <a href="mailto:floodcastapp@gmail.com">floodcastapp@gmail.com</a>.
              </p>
            </IonCardContent>
          </IonCard>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>2. Google AdSense & Third-Party Cookies</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                We use Google AdSense to serve advertisements on our website to support the operation of this service. 
                Google, as a third-party vendor, uses cookies to serve ads on our site.
              </p>
              <p style={{ marginTop: '12px' }}>
                Google's use of advertising cookies enables it and its partners to serve ads to our users based on their 
                visit to FloodCast and/or other sites on the Internet.
              </p>
              <p style={{ marginTop: '12px' }}>
                Users may opt out of personalized advertising by visiting the Google Ads Settings page:
              </p>
              <p style={{ marginTop: '8px', fontWeight: 'bold' }}>
                👉 <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">Google Ads Settings</a>
              </p>
              <p style={{ marginTop: '12px' }}>
                Alternatively, you can opt out of a third-party vendor's use of cookies for personalized advertising by visiting 
                <a href="https://www.aboutads.info" target="_blank" rel="noopener noreferrer"> www.aboutads.info</a>.
              </p>
            </IonCardContent>
          </IonCard>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>3. Local Storage and Data Collection</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                FloodCast utilizes browser local storage to save your preference settings (such as theme mode, offset configurations, 
                and threshold adjustments) locally on your device. Account information and comments are processed separately from these
                device preferences.
              </p>
              <p style={{ marginTop: '12px' }}>
                We fetch real-time public water level predictions and measurements from regional networks (like NOAA and NC FiMAN) 
                to construct localized flood warnings. Any user input (such as comments) is stored securely in our database.
              </p>
            </IonCardContent>
          </IonCard>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>4. Reliability Diagnostics</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                We collect limited application error reports to detect crashes and unavailable data. Reports include a fixed error category,
                app version, a general page name, service status codes, and application script locations. They exclude comment text,
                account identifiers, email addresses, credentials, full page URLs, and arbitrary error messages. A temporary counter in
                browser session storage limits reporting; reports are not saved on your device for later upload.
                A sample of dashboard visits also reports aggregate loading durations, app version, and whether the app script was cached.
                These timing reports contain no visitor identifier or browsing history.
              </p>
              <p style={{ marginTop: '12px' }}>
                Reports are processed using Google Cloud Logging under the project’s configured retention. Our hosting and cloud providers
                also maintain standard request and security logs, which may include network metadata such as IP addresses.
              </p>
            </IonCardContent>
          </IonCard>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>5. Accounts and flood alert preferences</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                Public in-app flood advisories and 48-hour hydrograph bulletins are viewable without creating
                an account. If you opt in to personalized email flood alerts, we store your account email,
                verification status, selected coverage, consent timestamp, and granular notification
                preferences (such as Minor, Moderate, Major, and Extreme severity tiers and Watch, Imminent
                Warning, Forecast Change, and All-Clear categories).
              </p>
              <p style={{ marginTop: '12px' }}>
                Transactional flood alert emails are delivered via Resend and include a signed one-click
                unsubscribe token (`List-Unsubscribe` header and footer link) so you can pause or unsubscribe
                at any time without logging in. Creating an account alone never activates email notifications
                without your explicit consent. For account deletion, data access, or privacy questions, email{' '}
                <a href="mailto:floodcastapp@gmail.com">floodcastapp@gmail.com</a>.
              </p>
            </IonCardContent>
          </IonCard>

          <IonCard className="glass-card">
            <IonCardHeader>
              <IonCardTitle>6. Your choices</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>
                Flood alert consent is collected separately from account creation. You can use
                the public forecast without subscribing to alerts. Advertising choices are linked above.
              </p>
            </IonCardContent>
          </IonCard>

          <footer className="privacy-footer">
            <p>FloodCast Privacy Policy • Built for the community.</p>
          </footer>
        </div>
      </IonContent>
    </IonPage>
  );
};
