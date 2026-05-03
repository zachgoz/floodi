import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar, 
  IonText, 
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
  cameraOutline
} from 'ionicons/icons';

import React from 'react';
import './Tab3.css';

/**
 * Tab3 Component (About Page)
 * 
 * A comprehensive informational page detailing the Floodi mission,
 * data sources, and scientific methodology.
 */
const Tab3: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>About Floodi</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      <IonContent fullscreen className="about-content">
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">About Floodi</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="about-container">
          {/* Hero Section */}
          <section className="hero-section">
            <img
              src={new URL('../assets/floodcast-logo.svg', import.meta.url).toString()}
              alt="Floodi"
              className="about-logo"
            />
            <IonText>
              <h2 className="hero-title">Hyperlocal Flood Intelligence</h2>
              <p className="hero-subtitle">
                Bridging the gap between regional tide tables and local reality in Carolina Beach.
              </p>
            </IonText>
          </section>

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
                Floodi was created to provide Carolina Beach residents with the most accurate, 
                up-to-the-minute flood intelligence possible. Traditional tide tables are based 
                on regional gauges (like Wrightsville Beach) and often fail to capture the 
                unique inundation patterns of our local canals and road crossings.
              </p>
              <p style={{ marginTop: '12px' }}>
                By combining astronomical predictions with real-time sensor data, we help you 
                know exactly when the water is coming—and when it's safe to travel.
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
              <IonCardTitle>Scientific Methodology</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <div className="method-item">
                <h4>Surge Analysis</h4>
                <p>
                  We calculate "live surge" by measuring the median deviation between real-time 
                  observations and astronomical predictions. This offset is applied to future 
                  forecasts for improved accuracy.
                </p>
              </div>
              <div className="method-item">
                <h4>Datum Alignment</h4>
                <p>
                  All data is normalized to the <strong>MLLW (Mean Lower Low Water)</strong> datum, 
                  ensuring consistency across different sensor types and historical records.
                </p>
              </div>
            </IonCardContent>
          </IonCard>

          <footer className="about-footer">
            <p>Built with ❤️ for the Carolina Beach community.</p>
            <p className="version-tag">Floodi v1.2.0 • Build 2026.05.02</p>
          </footer>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Tab3;
