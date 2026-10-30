import React from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
} from '@ionic/react';
import { closeOutline, checkmarkCircleOutline, waterOutline, pulseOutline, compassOutline } from 'ionicons/icons';
import './ForecastAccuracyModal.css';

interface ForecastAccuracyModalProps {
  isOpen: boolean;
  onDismiss: () => void;
}

export const ForecastAccuracyModal: React.FC<ForecastAccuracyModalProps> = ({
  isOpen,
  onDismiss,
}) => {
  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onDismiss}
      className="forecast-accuracy-modal"
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>Scientific Accuracy Audit</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss} aria-label="Close accuracy audit">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="accuracy-modal-content">
        <div className="accuracy-modal-container">
          {/* Hero Header */}
          <header className="accuracy-hero-header">
            <div className="accuracy-tag">
              <span className="accuracy-tag-dot" />
              Empirically Verified
            </div>
            <h2 className="accuracy-title">FloodCast Forecast Accuracy</h2>
            <p className="accuracy-subtitle">
              Unlike generic tide tables, FloodCast operates with prospective, out-of-sample verification
              benchmarked against real Carolina Beach Yacht Basin water-level observations.
            </p>
          </header>

          {/* Key Stat Cards */}
          <div className="accuracy-stats-grid">
            <div className="accuracy-stat-card highlight">
              <span className="accuracy-stat-value">2.4 in</span>
              <span className="accuracy-stat-label">24-Hour Horizon MAE</span>
              <span className="accuracy-stat-sub">0.199 ft · Zero Drift</span>
            </div>
            <div className="accuracy-stat-card">
              <span className="accuracy-stat-value">1.4 in</span>
              <span className="accuracy-stat-label">1-Hour Lead MAE</span>
              <span className="accuracy-stat-sub">0.116 ft · Immediate Anchor</span>
            </div>
            <div className="accuracy-stat-card">
              <span className="accuracy-stat-value">±26.8 min</span>
              <span className="accuracy-stat-label">Crest Timing Accuracy</span>
              <span className="accuracy-stat-sub">High-tide peak timing</span>
            </div>
            <div className="accuracy-stat-card highlight">
              <span className="accuracy-stat-value">77%</span>
              <span className="accuracy-stat-label">Error Reduction</span>
              <span className="accuracy-stat-sub">vs. NOAA Astronomical Tables</span>
            </div>
          </div>

          {/* Section 1: Error Breakdown by Lead Time */}
          <section className="accuracy-section-card">
            <h3 className="accuracy-section-title">
              <IonIcon icon={pulseOutline} color="primary" />
              Water-Level Error Profile by Lead Time
            </h3>
            <p className="accuracy-section-desc">
              Scored across 190+ frozen operational forecasts against verified Carolina Beach Canal Gauge 30046 records.
              Errors represent Mean Absolute Error (MAE) in feet and equivalent inches.
            </p>
            <div className="accuracy-table-wrapper">
              <table className="accuracy-table">
                <thead>
                  <tr>
                    <th>Forecast Lead</th>
                    <th>FloodCast MAE</th>
                    <th>90th Percentile (P90)</th>
                    <th>Tide Tables Only</th>
                    <th>Flat Persistence</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>1 Hour</strong></td>
                    <td>0.116 ft (1.4 in)</td>
                    <td>0.231 ft (2.8 in)</td>
                    <td>0.853 ft (10.2 in)</td>
                    <td>0.103 ft (1.2 in)</td>
                  </tr>
                  <tr>
                    <td><strong>3 Hours</strong></td>
                    <td>0.183 ft (2.2 in)</td>
                    <td>0.342 ft (4.1 in)</td>
                    <td>0.864 ft (10.4 in)</td>
                    <td>0.185 ft (2.2 in)</td>
                  </tr>
                  <tr>
                    <td><strong>6 Hours</strong></td>
                    <td>0.187 ft (2.2 in)</td>
                    <td>0.371 ft (4.5 in)</td>
                    <td>0.876 ft (10.5 in)</td>
                    <td>0.219 ft (2.6 in)</td>
                  </tr>
                  <tr>
                    <td><strong>12 Hours</strong></td>
                    <td>0.181 ft (2.2 in)</td>
                    <td>0.385 ft (4.6 in)</td>
                    <td>0.896 ft (10.8 in)</td>
                    <td>0.251 ft (3.0 in)</td>
                  </tr>
                  <tr className="highlight-row">
                    <td><strong>24 Hours</strong> (Planning Horizon)</td>
                    <td>0.199 ft (2.4 in)</td>
                    <td>0.378 ft (4.5 in)</td>
                    <td>0.896 ft (10.8 in)</td>
                    <td>0.302 ft (3.6 in)</td>
                  </tr>
                  <tr>
                    <td><strong>48 Hours</strong> (Day 2)</td>
                    <td>0.221 ft (2.7 in)</td>
                    <td>0.467 ft (5.6 in)</td>
                    <td>0.953 ft (11.4 in)</td>
                    <td>0.425 ft (5.1 in)</td>
                  </tr>
                  <tr>
                    <td><strong>72 Hours</strong> (Day 3)</td>
                    <td>0.263 ft (3.2 in)</td>
                    <td>0.550 ft (6.6 in)</td>
                    <td>1.055 ft (12.7 in)</td>
                    <td>0.600 ft (7.2 in)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 2: Head-to-Head Model Comparison */}
          <section className="accuracy-section-card">
            <h3 className="accuracy-section-title">
              <IonIcon icon={checkmarkCircleOutline} color="success" />
              Model Architecture Comparison
            </h3>
            <p className="accuracy-section-desc">
              Why relying on published tide tables or open-ocean surge models causes severe underpredictions in Carolina Beach:
            </p>
            <div className="accuracy-compare-grid">
              <div className="compare-card">
                <span className="compare-badge">Standard Baseline</span>
                <h4 className="compare-name">NOAA Tide Tables Only</h4>
                <div className="compare-error">10.8 in MAE</div>
                <p className="compare-desc">
                  Station 8658163 astronomical tide tables ignore coastal winds, low-pressure suction, and inland river backwater.
                </p>
              </div>
              <div className="compare-card">
                <span className="compare-badge">Ocean Baseline</span>
                <h4 className="compare-name">Raw Ocean Surge (ETSS)</h4>
                <div className="compare-error">4.0 in MAE</div>
                <p className="compare-desc">
                  Open-coast ocean stations outside the barrier island fail to capture sound-side water pileup and Cape Fear backwater.
                </p>
              </div>
              <div className="compare-card winner">
                <span className="compare-badge">FloodCast Operational</span>
                <h4 className="compare-name">TimesFM + Basin Physics</h4>
                <div className="compare-error">2.4 in MAE</div>
                <p className="compare-desc">
                  <strong>31% error reduction</strong> over raw ocean surge and <strong>77% error reduction</strong> over tide tables by modeling sound wind fetch and river coupling.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3: The Science Behind the Accuracy */}
          <section className="accuracy-section-card">
            <h3 className="accuracy-section-title">
              <IonIcon icon={waterOutline} color="secondary" />
              The Science: 3 Physical Estuarine Couplings
            </h3>
            <div className="science-list">
              <div className="science-item">
                <div className="science-icon">💨</div>
                <div className="science-content">
                  <h5>Directional N/NE Wind Stress</h5>
                  <p>
                    Winds aligned along the 25° NNE axis force water across Myrtle Grove Sound and trap it against the Yacht Basin.
                    FloodCast calculates directional shear stress (τ = W² · cos(θ − 25°)) to model this localized water pileup.
                  </p>
                </div>
              </div>
              <div className="science-item">
                <div className="science-icon">🌊</div>
                <div className="science-content">
                  <h5>Cape Fear River Backwater Head</h5>
                  <p>
                    Upstream discharge from Lock #1 (USGS 02105769) entering via Snow's Cut elevates Carolina Beach water levels
                    independent of ocean tide or coastal swell, keeping water elevated even after ocean winds subside.
                  </p>
                </div>
              </div>
              <div className="science-item">
                <div className="science-icon">🔄</div>
                <div className="science-content">
                  <h5>Estuarine Shallow-Water Harmonics (M₂, S₁, M₄)</h5>
                  <p>
                    Shallow back-barrier lagoons distort tidal waves, producing overtides that standard harmonic tables flatten out.
                    FloodCast dynamically fits 48-hour localized shallow-water harmonics for precise peak crest height and timing.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Flood Stages & Safety */}
          <section className="accuracy-section-card">
            <h3 className="accuracy-section-title">
              <IonIcon icon={compassOutline} color="warning" />
              Carolina Beach Threshold Calibration (ft MLLW)
            </h3>
            <p className="accuracy-section-desc">
              All forecasts are calibrated to Mean Lower Low Water (MLLW) at Carolina Beach Canal Gauge 30046:
            </p>
            <div className="stages-pill-grid">
              <div className="stage-pill minor">
                <strong>5.6 ft Minor</strong>
                <span>Canal Dr &amp; Florida Ave nuisance flooding</span>
              </div>
              <div className="stage-pill moderate">
                <strong>7.0 ft Moderate</strong>
                <span>Road closures &amp; structural threat</span>
              </div>
              <div className="stage-pill major">
                <strong>7.7 ft Major</strong>
                <span>Widespread inundation &amp; hazard</span>
              </div>
              <div className="stage-pill extreme">
                <strong>8.5 ft Extreme</strong>
                <span>Severe storm surge &amp; hurricane benchmark</span>
              </div>
            </div>
          </section>

          {/* Footer note */}
          <footer className="accuracy-modal-footer">
            <p>
              Forecast levels represent gauge water height in ft MLLW at Carolina Beach Yacht Basin.
              The hydrograph displays P10/P90 confidence bounds to help anticipate marginal events within the error margin.
              Forecasts support personal planning; always heed official town emergency notices.
            </p>
          </footer>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default ForecastAccuracyModal;
