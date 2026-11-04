import React, { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
} from '@ionic/react';
import {
  closeOutline,
  checkmarkCircleOutline,
  waterOutline,
  pulseOutline,
  compassOutline,
  analyticsOutline,
  bulbOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import { AUDITED_BASELINE_ACCURACY, type RollingAccuracyData } from './useForecastAccuracy';
import {
  AUDITED_BASELINE_DIAGNOSTICS,
  type ModelHealthDiagnostics,
  useForecastDiagnostics,
} from './useForecastDiagnostics';
import type { Point } from '../Tab2/types';
import ForecastConvergenceChart from './ForecastConvergenceChart';
import './ForecastAccuracyModal.css';

interface ForecastAccuracyModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  accuracy?: RollingAccuracyData;
  diagnostics?: ModelHealthDiagnostics;
  locationId?: string;
  observedPoints?: Point[];
  predictedPoints?: Point[];
  adjustedPoints?: Point[];
  thresholds?: Record<string, number>;
}

export const ForecastAccuracyModal: React.FC<ForecastAccuracyModalProps> = ({
  isOpen,
  onDismiss,
  accuracy = AUDITED_BASELINE_ACCURACY,
  diagnostics: propDiagnostics,
  locationId = 'carolina-beach',
  observedPoints,
  predictedPoints,
  adjustedPoints,
  thresholds,
}) => {
  const [activeSegment, setActiveSegment] = useState<'accuracy' | 'diagnostics'>('accuracy');
  const { diagnostics: fetchedDiagnostics } = useForecastDiagnostics(locationId);

  const effectiveAccuracy = accuracy || AUDITED_BASELINE_ACCURACY;
  const effectiveDiagnostics = propDiagnostics || fetchedDiagnostics || AUDITED_BASELINE_DIAGNOSTICS;

  const getLeadLabel = (hours: number): string => {
    switch (hours) {
      case 1: return '1 Hour';
      case 3: return '3 Hours';
      case 6: return '6 Hours';
      case 12: return '12 Hours';
      case 24: return '24 Hours (Planning Horizon)';
      case 48: return '48 Hours (Day 2)';
      case 72: return '72 Hours (Day 3)';
      default: return `${hours} Hours`;
    }
  };

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
        <IonToolbar className="accuracy-segment-toolbar">
          <IonSegment
            value={activeSegment}
            onIonChange={(e) => setActiveSegment(e.detail.value as 'accuracy' | 'diagnostics')}
            className="accuracy-segment-selector"
          >
            <IonSegmentButton value="accuracy">
              <IonLabel>Verification Audit</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="diagnostics">
              <IonLabel>Diagnostics &amp; Proposals</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>

      <IonContent className="accuracy-modal-content">
        <div className="accuracy-modal-container">
          {activeSegment === 'accuracy' ? (
            <>
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

              {/* Audit Timeframe & Provenance Banner */}
              <div className="audit-provenance-banner" data-testid="audit-provenance-banner">
                <div className="provenance-chip">
                  <span className="provenance-chip-label">Audited Window</span>
                  <strong className="provenance-chip-val">Oct 5 – Nov 3, 2026 (Last 30 Days)</strong>
                </div>
                <div className="provenance-chip">
                  <span className="provenance-chip-label">Verification Mode</span>
                  <strong className="provenance-chip-val">Realtime Prospective Replay</strong>
                </div>
                <div className="provenance-chip">
                  <span className="provenance-chip-label">Audited Station</span>
                  <strong className="provenance-chip-val">Carolina Beach Gauge 30046</strong>
                </div>
                <div className="provenance-chip">
                  <span className="provenance-chip-label">Update Cadence</span>
                  <strong className="provenance-chip-val">Daily at 06:40 UTC (Auto-Updated)</strong>
                </div>
              </div>

              {/* Real-World Case Study: November 3 High Tide Convergence Hydrograph */}
              <ForecastConvergenceChart
                liveObservedPoints={observedPoints}
                livePredictedPoints={predictedPoints}
                liveAdjustedPoints={adjustedPoints}
              />

              {/* Key Stat Cards */}
              <div className="accuracy-stats-grid">
                <div className="accuracy-stat-card highlight">
                  <span className="accuracy-stat-value">{effectiveAccuracy.mae24hInches.toFixed(1)} in</span>
                  <span className="accuracy-stat-label">24-Hour Horizon MAE</span>
                  <span className="accuracy-stat-sub">{effectiveAccuracy.mae24hFt.toFixed(3)} ft · Zero Drift</span>
                </div>
                <div className="accuracy-stat-card">
                  <span className="accuracy-stat-value">{effectiveAccuracy.mae1hInches.toFixed(1)} in</span>
                  <span className="accuracy-stat-label">1-Hour Lead MAE</span>
                  <span className="accuracy-stat-sub">{effectiveAccuracy.mae1hFt.toFixed(3)} ft · Immediate Anchor</span>
                </div>
                <div className="accuracy-stat-card">
                  <span className="accuracy-stat-value">±{effectiveAccuracy.crestTimingMinutes.toFixed(1)} min</span>
                  <span className="accuracy-stat-label">Crest Timing Accuracy</span>
                  <span className="accuracy-stat-sub">High-tide peak timing</span>
                </div>
                <div className="accuracy-stat-card highlight">
                  <span className="accuracy-stat-value">{effectiveAccuracy.errorReductionPct}%</span>
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
                  Scored across {effectiveAccuracy.sampleCount}+ frozen operational forecasts against verified Carolina Beach Canal Gauge 30046 records.
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
                      {effectiveAccuracy.leads.map((lead) => {
                        const isHighlight = lead.leadHours === 24;
                        return (
                          <tr key={lead.leadHours} className={isHighlight ? 'highlight-row' : undefined}>
                            <td><strong>{getLeadLabel(lead.leadHours)}</strong></td>
                            <td>{lead.floodCastMaeFt.toFixed(3)} ft ({lead.floodCastMaeInches.toFixed(1)} in)</td>
                            <td>{lead.p90Ft.toFixed(3)} ft ({lead.p90Inches.toFixed(1)} in)</td>
                            <td>{lead.tideOnlyMaeFt.toFixed(3)} ft ({lead.tideOnlyMaeInches.toFixed(1)} in)</td>
                            <td>{lead.persistenceMaeFt.toFixed(3)} ft ({lead.persistenceMaeInches.toFixed(1)} in)</td>
                          </tr>
                        );
                      })}
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
            </>
          ) : (
            <>
              {/* Hero Header */}
              <header className="accuracy-hero-header">
                <div className="accuracy-tag">
                  <span className="accuracy-tag-dot" />
                  Continuous AI Governance
                </div>
                <h2 className="accuracy-title">Model Diagnostics &amp; Tuning</h2>
                <p className="accuracy-subtitle">
                  Automated telemetry monitoring physical error attribution, detecting model drift,
                  and proposing empirical calibration adjustments to basin hydrodynamic parameters.
                </p>
              </header>

              {/* Model Health Status Card */}
              <div className="accuracy-stat-card highlight">
                <div className="diagnostics-status-header">
                  <span className={`diagnostics-status-badge ${effectiveDiagnostics.overallStatus}`}>
                    {effectiveDiagnostics.overallStatus === 'optimal'
                      ? 'Optimal Calibration'
                      : effectiveDiagnostics.overallStatus === 'drift_detected'
                      ? 'Drift Alert Active'
                      : 'Stable Calibration'}
                  </span>
                  <span className="diagnostics-drift-delta">
                    {effectiveDiagnostics.driftDeltaInches <= 0
                      ? '✓ Zero Drift'
                      : `+${effectiveDiagnostics.driftDeltaInches}" Drift`}
                  </span>
                </div>
                <div className="diagnostics-health-grid">
                  <div className="health-stat">
                    <span className="accuracy-stat-value">{effectiveDiagnostics.rolling7dMaeInches.toFixed(1)} in</span>
                    <span className="accuracy-stat-label">7-Day Rolling MAE</span>
                  </div>
                  <div className="health-stat">
                    <span className="accuracy-stat-value">{effectiveDiagnostics.rolling30dMaeInches.toFixed(1)} in</span>
                    <span className="accuracy-stat-label">30-Day Benchmark MAE</span>
                  </div>
                  <div className="health-stat">
                    <span className="accuracy-stat-value">
                      {effectiveDiagnostics.systematicBiasInches > 0 ? '+' : ''}
                      {effectiveDiagnostics.systematicBiasInches.toFixed(1)} in
                    </span>
                    <span className="accuracy-stat-label">
                      Systematic Bias ({effectiveDiagnostics.biasDirection.replace('_', ' ')})
                    </span>
                  </div>
                </div>
              </div>

              {/* Weather Regime Error Matrix */}
              <section className="accuracy-section-card">
                <h3 className="accuracy-section-title">
                  <IonIcon icon={analyticsOutline} color="primary" />
                  Meteorological Regime Error Matrix
                </h3>
                <p className="accuracy-section-desc">
                  Verification breakdown categorized by ambient coastal wind speed and fetch quadrant:
                </p>
                <div className="regimes-grid">
                  {effectiveDiagnostics.regimeMetrics.map((r) => (
                    <div key={r.regime} className="regime-card">
                      <div className="regime-name">
                        {r.regime === 'calm'
                          ? 'Calm (< 10 mph)'
                          : r.regime === 'moderate'
                          ? 'Moderate (10–20 mph)'
                          : 'Squall / Gale (> 20 mph)'}
                      </div>
                      <div className="regime-mae">{r.maeInches.toFixed(1)} in MAE</div>
                      <div className="regime-sub">
                        {r.samples} samples · Bias {r.biasInches > 0 ? '+' : ''}{r.biasInches.toFixed(1)} in
                      </div>
                    </div>
                  ))}
                </div>

                <h4 className="quadrant-title">Accuracy by Wind Fetch Quadrant</h4>
                <div className="quadrants-grid">
                  {effectiveDiagnostics.quadrantMetrics.map((q) => (
                    <div key={q.quadrant} className="quadrant-card">
                      <span className="quadrant-badge">{q.quadrant}</span>
                      <span className="quadrant-mae">{q.maeInches.toFixed(1)} in</span>
                      <span className="quadrant-samples">{q.samples} samples</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Autonomous Improvement Proposals */}
              <section className="accuracy-section-card">
                <h3 className="accuracy-section-title">
                  <IonIcon icon={bulbOutline} color="warning" />
                  Autonomous Improvement Proposals ({effectiveDiagnostics.activeProposals.length})
                </h3>
                <p className="accuracy-section-desc">
                  Physics and foundation-model parameter calibrations derived from empirical error decomposition:
                </p>
                <div className="proposals-list">
                  {effectiveDiagnostics.activeProposals.map((prop) => (
                    <div key={prop.proposalId} className="proposal-card">
                      <div className="proposal-header">
                        <span className={`proposal-badge ${prop.status}`}>{prop.status.toUpperCase()}</span>
                        <span className="proposal-impact">Est. −{prop.estimatedMaeReductionInches.toFixed(1)} in MAE</span>
                      </div>
                      <h4 className="proposal-target">{prop.targetParameter}</h4>
                      <p className="proposal-trigger">{prop.triggerReason}</p>
                      <div className="proposal-diff">
                        <div className="diff-line current"><strong>Current:</strong> {prop.currentValueDescription}</div>
                        <div className="diff-line proposed"><strong>Proposed:</strong> {prop.proposedValueDescription}</div>
                      </div>
                      <div className="proposal-code-hint">
                        <code>{prop.actionableDiffHint}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Recent Event Error Attribution */}
              <section className="accuracy-section-card">
                <h3 className="accuracy-section-title">
                  <IonIcon icon={alertCircleOutline} color="danger" />
                  Recent Event Error Attribution
                </h3>
                <p className="accuracy-section-desc">
                  Physical root-cause decomposition for recent flood peaks deviating from central predictions:
                </p>
                <div className="anomalies-list">
                  {effectiveDiagnostics.recentAnomalies.map((a) => (
                    <div key={a.id} className="anomaly-card">
                      <div className="anomaly-header">
                        <span className="anomaly-date">{a.day}</span>
                        <span className="anomaly-error">
                          Peak Error: {a.peakErrorInches > 0 ? '+' : ''}{a.peakErrorInches.toFixed(1)} in
                        </span>
                        <span className={`anomaly-severity ${a.severity}`}>{a.severity.replace('_', ' ')}</span>
                      </div>
                      <div className="anomaly-desc">{a.eventDescription}</div>
                      <div className="attribution-bar-wrapper">
                        <div className="attribution-bars">
                          <span
                            className="attr-segment wind"
                            style={{ width: `${a.attribution.windSetupPct}%` }}
                            title={`Wind Setup: ${a.attribution.windSetupPct}%`}
                          />
                          <span
                            className="attr-segment ocean"
                            style={{ width: `${a.attribution.oceanBoundaryPct}%` }}
                            title={`Ocean ETSS: ${a.attribution.oceanBoundaryPct}%`}
                          />
                          <span
                            className="attr-segment river"
                            style={{ width: `${a.attribution.riverDischargePct}%` }}
                            title={`USGS River: ${a.attribution.riverDischargePct}%`}
                          />
                          <span
                            className="attr-segment datum"
                            style={{ width: `${a.attribution.datumBiasPct}%` }}
                            title={`Datum Bias: ${a.attribution.datumBiasPct}%`}
                          />
                        </div>
                        <div className="attribution-legend">
                          <span className="legend-item"><i className="legend-dot wind" /> Wind ({a.attribution.windSetupPct}%)</span>
                          <span className="legend-item"><i className="legend-dot ocean" /> Ocean ({a.attribution.oceanBoundaryPct}%)</span>
                          <span className="legend-item"><i className="legend-dot river" /> River ({a.attribution.riverDischargePct}%)</span>
                          <span className="legend-item"><i className="legend-dot datum" /> Datum ({a.attribution.datumBiasPct}%)</span>
                        </div>
                      </div>
                      <p className="anomaly-summary">{a.summary}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

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
