import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar, 
  IonCard, 
  IonCardHeader, 
  IonCardTitle, 
  IonCardContent, 
  IonIcon, 
  IonButton
} from '@ionic/react';
import { 
  waterOutline, 
  earthOutline, 
  cloudyOutline, 
  pulseOutline, 
  linkOutline,
  informationCircleOutline,
  cameraOutline,
  playCircleOutline
} from 'ionicons/icons';

import { AppLogo } from 'src/components/common/AppLogo';
import React from 'react';
import { useHistory, Link } from 'react-router-dom';
import { AdSenseUnit } from 'src/components/common/AdSenseUnit';
import { INTRO_STORAGE_KEY } from 'src/components/onboarding/IntroTourOverlay';
import './Tab3.css';

/**
 * Tab3 Component (About Page)
 * 
 * A comprehensive informational page detailing the FloodCast mission,
 * data sources, and scientific methodology.
 */
const Tab3: React.FC = () => {
  const history = useHistory();

  const handleReplayIntro = () => {
    try {
      localStorage.removeItem(INTRO_STORAGE_KEY);
    } catch {
      // Intro is still reachable if storage is unavailable.
    }

    history.push('/intro');
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonTitle>About FloodCast</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      <IonContent className="about-content">
        <div className="about-container">
          {/* Hero Branding */}
          <div className="hero-section">
            <AppLogo className="about-logo" />
            <h1 className="hero-title">Hyperlocal Flood Intelligence</h1>
            <p className="hero-subtitle">
              Bridging the gap between regional tide tables and local reality in Carolina Beach.
            </p>
            <IonButton
              fill="outline"
              shape="round"
              className="replay-intro-button"
              onClick={handleReplayIntro}
            >
              <IonIcon icon={playCircleOutline} slot="start" />
              Replay Intro
            </IonButton>
          </div>

          {/* Mission Section */}
          <IonCard className="glass-card">
            <IonCardHeader>
              <div className="card-header-icon-wrap">
                <IonIcon icon={informationCircleOutline} color="primary" className="header-icon" />
                <IonCardTitle>Our Mission</IonCardTitle>
              </div>
            </IonCardHeader>
            <IonCardContent>
              <p>
                FloodCast helps Carolina Beach residents anticipate coastal flooding by combining
                local water-level observations, astronomical tides and weather information.
              </p>
              <p style={{ marginTop: '12px' }}>
                Forecasts and estimated street impacts support planning. Conditions can change,
                and a forecast does not establish whether a road is safe to travel.
              </p>
            </IonCardContent>
          </IonCard>

          {/* Data Sources Section */}
          <h3 className="section-divider">Data Sources</h3>
          
          <div className="source-grid">
            <IonCard className="source-card">
              <IonCardHeader>
                <IonIcon icon={pulseOutline} className="source-icon" />
                <IonCardTitle>FiMAN Sensors</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>
                  Real-time water level data from the NC FiMAN network, including sensors 
                  maintained by the Sunny Day Flooding project in Carolina Beach.
                </p>
                <IonButton fill="clear" size="small" href="https://fiman.nc.gov/?id=30046" target="_blank">
                  Visit FiMAN <IonIcon icon={linkOutline} slot="end" />
                </IonButton>
              </IonCardContent>
            </IonCard>

            <IonCard className="source-card">
              <IonCardHeader>

                <IonIcon icon={waterOutline} className="source-icon" />
                <IonCardTitle>NOAA Tides</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>Astronomical tide predictions and regional observations from NOAA Station 8658163.</p>
                <IonButton fill="clear" size="small" href="https://tidesandcurrents.noaa.gov/stationhome.html?id=8658163" target="_blank">
                  Visit NOAA <IonIcon icon={linkOutline} slot="end" />
                </IonButton>
              </IonCardContent>
            </IonCard>

            <IonCard className="source-card">
              <IonCardHeader>
                <IonIcon icon={cloudyOutline} className="source-icon" />
                <IonCardTitle>NWS Weather</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>Wind and precipitation forecasts used to analyze meteorological surge impacts.</p>
                <IonButton fill="clear" size="small" href="https://www.weather.gov/ilm/" target="_blank">
                  Visit NWS <IonIcon icon={linkOutline} slot="end" />
                </IonButton>
              </IonCardContent>
            </IonCard>

            <IonCard className="source-card">
              <IonCardHeader>
                <IonIcon icon={earthOutline} className="source-icon" />
                <IonCardTitle>Open-Meteo</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>Historical weather archives used for deep-trend analysis and reporting.</p>
                <IonButton fill="clear" size="small" href="https://open-meteo.com/" target="_blank">
                  Visit Open-Meteo <IonIcon icon={linkOutline} slot="end" />
                </IonButton>
              </IonCardContent>
            </IonCard>

            <IonCard className="source-card">
              <IonCardHeader>

                <IonIcon icon={cameraOutline} className="source-icon" />
                <IonCardTitle>Sunny Day Flooding</IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>
                  Special thanks to the Sunny Day Flooding project for providing the live 
                  webcam images used for visual flood monitoring.
                </p>
                <IonButton fill="clear" size="small" href="https://sunnydayflooding.org/" target="_blank">
                  Visit Sunny Day <IonIcon icon={linkOutline} slot="end" />
                </IonButton>
              </IonCardContent>
            </IonCard>
          </div>
          {/* Methodology Section */}
          <IonCard className="methodology-card">
            <IonCardHeader>
              <IonCardTitle>Scientific Methodology &amp; Flood Stages</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <div className="method-item">
                <h4>Multi-Regime Estuarine Surge &amp; AI Forecasting</h4>
                <p>
                  FloodCast synthesizes NOAA astronomical tide predictions (Station 8658163) with
                  NOAA Extratropical Storm Surge ocean guidance (Wrightsville Beach) and Cape Fear
                  River surge (Wilmington), directional N/NE Myrtle Grove Sound wind-fetch setup
                  (25° axial + 70° onshore), USGS Cape Fear River Lock #1 discharge (02105769)
                  entering via Snow&apos;s Cut, Google TimesFM foundation-model inference, and
                  48-hour shallow-water estuarine tidal harmonics (M₂, S₁, M₄).
                </p>
              </div>
              <div className="method-item">
                <h4>Carolina Beach Flood Thresholds (ft MLLW)</h4>
                <p>
                  All water-level charts and FloodCast Alerts 2.0 advisories are referenced to{' '}
                  <strong>MLLW (Mean Lower Low Water)</strong> at Carolina Beach Canal Gauge 30046:{' '}
                  <strong>5.6 ft Minor</strong> (Canal Dr &amp; Florida Ave nuisance flooding),{' '}
                  <strong>7.0 ft Moderate</strong> (road closures &amp; structural threat),{' '}
                  <strong>7.7 ft Major</strong> (widespread inundation &amp; property hazard), and{' '}
                  <strong>8.5 ft Extreme</strong> (severe coastal &amp; hurricane storm surge).
                </p>
              </div>
            </IonCardContent>
          </IonCard>

          {/* About page ad unit. Replace the slot ID with your actual AdSense ad unit slot ID */}
          <AdSenseUnit slot={import.meta.env.VITE_ADSENSE_ABOUT_SLOT || ''} />

          <footer className="about-footer">
            <p>Built with ❤️ for the Carolina Beach community.</p>
            <p className="version-tag">
              <Link to="/privacy" className="privacy-link">Privacy Policy</Link>
              {' · '}Release {import.meta.env.VITE_APP_BUILD_ID || 'development'}
            </p>
          </footer>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Tab3;
