import type { ForecastDocument } from "../../../functions/src/forecast/schema";
import type { ChallengerOutlookDocument } from "./useChallengerOutlook";
import { eventDate, eventTime, eventWindow, floodWindows } from "src/utils/waterForecast";
import type { SelectedWaterForecast } from "src/utils/selectWaterForecast";
import "./ForecastPanels.css";

export interface FloodThresholdSet {
  minor: number;
  moderate: number;
  major: number;
  extreme: number;
}

const DEFAULT_THRESHOLDS: FloodThresholdSet = {
  minor: 5.6,
  moderate: 7.0,
  major: 7.7,
  extreme: 8.5,
};

interface Props {
  outlook?: ForecastDocument | null;
  selection: SelectedWaterForecast;
  showComparison?: boolean;
  onToggle?: () => void;
  floodExpected?: boolean;
  floodPossible?: boolean;
  thresholdFt?: number;
  thresholds?: FloodThresholdSet;
  currentSurgeFt?: number | null;
  now?: Date;
  challenger?: ChallengerOutlookDocument | null;
  isTimesFmPrimary?: boolean;
}

export function FloodOutlook({
  outlook = null,
  selection,
  showComparison = false,
  onToggle,
  floodExpected,
  floodPossible,
  thresholdFt,
  thresholds = DEFAULT_THRESHOLDS,
  currentSurgeFt,
  now = new Date(),
  challenger,
  isTimesFmPrimary,
}: Props) {
  const effectiveMinorFt =
    typeof thresholdFt === "number" && Number.isFinite(thresholdFt)
      ? thresholdFt
      : thresholds.minor;
  const hasThreshold = Number.isFinite(effectiveMinorFt);
  const nextEvent = hasThreshold
    ? floodWindows(selection.totalPoints, effectiveMinorFt).find(
        (event) => +(event.endTime ?? event.lastSampleTime) > +now
      )
    : null;
  const horizon = selection.horizonEnd;
  const hasCoverage = selection.totalPoints.length > 1 && horizon && +horizon > +now;

  const headline =
    selection.method === "tide"
      ? nextEvent || floodExpected
        ? "Tide above flood stage"
        : "Tide forecast only"
      : nextEvent || floodExpected
      ? "Flooding forecast"
      : floodPossible
      ? "Flooding possible"
      : hasCoverage
      ? hasThreshold || floodExpected === false
        ? "No flooding forecast"
        : "Water-level outlook"
      : "Forecast unavailable";

  let period =
    horizon && +horizon > +now
      ? `Through ${eventDate(horizon)}, ${eventTime(horizon)} ET`
      : null;
  if (nextEvent) {
    let window = eventWindow(nextEvent.startTime, nextEvent.endTime);
    if (nextEvent.startClipped) {
      const start =
        nextEvent.startTime <= now ? "Already above threshold" : "Start unavailable";
      const end = nextEvent.endTime;
      const endTime =
        end &&
        `${eventDate(end) === eventDate(nextEvent.startTime) ? "" : `${eventDate(end)}, `}${eventTime(end)}`;
      window = `${start} · ${endTime ? `Until ${endTime}` : "End unavailable"}`;
    }
    period = `${eventDate(nextEvent.startTime)} · ${window}`;
  }

  const nextPeak = nextEvent
    ? {
        value: nextEvent.peakValue,
        time: nextEvent.peakTime,
        isFlood: true,
      }
    : selection.totalPoints.length > 0
    ? (() => {
        const futurePoints = selection.totalPoints.filter((p) => +new Date(p.t) >= +now);
        const pts = futurePoints.length > 0 ? futurePoints : selection.totalPoints;
        const highest = pts.reduce((max, p) => (p.v > max.v ? p : max), pts[0]);
        return {
          value: highest.v,
          time: new Date(highest.t),
          isFlood: hasThreshold && highest.v >= effectiveMinorFt,
        };
      })()
    : null;

  const resolvedSurgeFt =
    typeof currentSurgeFt === "number" && Number.isFinite(currentSurgeFt)
      ? currentSurgeFt
      : typeof challenger?.currentResidualFt === "number" &&
        Number.isFinite(challenger.currentResidualFt)
      ? challenger.currentResidualFt
      : typeof outlook?.currentResidualFt === "number" &&
        Number.isFinite(outlook.currentResidualFt)
      ? outlook.currentResidualFt
      : null;

  const operationalActive = Boolean(isTimesFmPrimary || challenger?.status === "available");
  const updatedAtIso = challenger?.generatedAt || outlook?.generatedAt || null;

  const displayLimitations = [
    "Water levels are predicted in feet MLLW at the Carolina Beach boat basin / Myrtle Grove Sound (gauge 30046).",
    "Forecasts combine NOAA harmonic tides (8658163), NOAA ETSS ocean & Cape Fear River storm surge guidance (ncwrit / ncwilm), directional N/NE Myrtle Grove Sound wind setup, USGS Lock #1 river discharge (02105769), and Google TimesFM AI.",
    "Extreme localized downpours or storm drain blockages during high tide can increase street ponding beyond basin water levels.",
  ];

  const operationalSources = [
    "NC FiMAN Carolina Beach Canal Gauge (30046)",
    "NOAA CO-OPS Astronomical Tides (8658163)",
    "NOAA MDL Extratropical Storm Surge (ETSS ncwrit & ncwilm)",
    "USGS Cape Fear River Lock #1 (02105769)",
    "NWS / Open-Meteo Atmospheric Wind & Barometric Pressure",
    "Google TimesFM Foundation Model",
  ];

  return (
    <section className="forecast-panel dashboard-outlook-card">
      <div className="forecast-panel-heading">
        <div>
          <h2>Flood Outlook</h2>
        </div>
        <span className="confidence-badge">
          {operationalActive
            ? "TimesFM AI + NOAA Operational"
            : selection.confidence === "limited"
            ? "Active 72-Hour Outlook"
            : "Outlook unavailable"}
        </span>
      </div>

      {/* Novice-Friendly Hero Status Alert */}
      <div
        className={`outlook-hero-card ${
          nextEvent || floodExpected
            ? "is-flooding"
            : floodPossible
            ? "is-possible"
            : "is-safe"
        }`}
      >
        <div className="hero-status-row">
          <span className="hero-status-indicator" />
          <p className="outlook-risk-label hero-status-headline">{headline}</p>
        </div>
        {period && <p className="outlook-period">{period}</p>}
        {!nextEvent && floodPossible && (
          <p className="forecast-caption">The forecast error range reaches flood stage.</p>
        )}
      </div>

      {/* Quick-Scan Metrics Grid for Residents & Novices */}
      {nextPeak && (
        <div className="outlook-metrics-grid">
          <div className="outlook-metric-card">
            <span className="metric-card-label">Next Peak Water Level</span>
            <div className="metric-card-val-row">
              <strong className="metric-card-value">{nextPeak.value.toFixed(2)}</strong>
              <span className="metric-card-unit">ft MLLW</span>
            </div>
            <span className={`metric-card-sub ${nextPeak.isFlood ? "sub-danger" : "sub-safe"}`}>
              {hasThreshold
                ? nextPeak.isFlood
                  ? `+${(nextPeak.value - effectiveMinorFt).toFixed(2)} ft above flood stage`
                  : `${(effectiveMinorFt - nextPeak.value).toFixed(2)} ft below flood stage`
                : "Carolina Beach Basin"}
            </span>
          </div>

          <div className="outlook-metric-card">
            <span className="metric-card-label">Peak Timing</span>
            <div className="metric-card-val-row">
              <strong className="metric-card-value">{eventTime(nextPeak.time)}</strong>
              <span className="metric-card-unit">ET</span>
            </div>
            <span className="metric-card-sub sub-neutral">{eventDate(nextPeak.time)}</span>
          </div>

          <div className="outlook-metric-card">
            <span className="metric-card-label">Water Anomaly (Surge)</span>
            <div className="metric-card-val-row">
              <strong className="metric-card-value">
                {resolvedSurgeFt !== null
                  ? `${resolvedSurgeFt >= 0 ? "+" : ""}${resolvedSurgeFt.toFixed(2)}`
                  : "Unavailable"}
              </strong>
              {resolvedSurgeFt !== null && <span className="metric-card-unit">ft surge</span>}
            </div>
            <span className="metric-card-sub sub-neutral">
              Ocean + N/NE wind + Cape Fear River anomaly
            </span>
          </div>
        </div>
      )}

      {/* Plain English Resident Overview */}
      <p className="outlook-plain-summary">
        {nextEvent || floodExpected
          ? `Water levels are projected to crest above the ${effectiveMinorFt.toFixed(1)} ft minor flood threshold during upcoming high tide windows. Low-lying roads along Canal Dr and Florida Ave may experience tidal inundation.`
          : floodPossible
          ? `Water levels are projected near flood stage during upcoming high tides. Monitor conditions closely if winds strengthen from the north or northeast.`
          : `Water levels are projected to remain safely below the ${effectiveMinorFt.toFixed(1)} ft minor flood stage across the active forecast horizon.`}
      </p>

      {updatedAtIso ? (
        <>
          <p className="forecast-caption">
            Updated {eventDate(new Date(updatedAtIso))}, {eventTime(new Date(updatedAtIso))} ET
          </p>
          <details>
            <summary>About this forecast &amp; methodology</summary>

            {/* Guide For Everyday Residents */}
            <div className="outlook-guide-section">
              <div className="outlook-section-header">
                <span className="section-dot" />
                How This Forecast Works
              </div>
              <div className="outlook-guide-grid">
                <div className="guide-item">
                  <span className="guide-icon">🌊</span>
                  <div className="guide-text">
                    <strong>Astronomical &amp; Estuarine Tides</strong>
                    <p>
                      NOAA Station 8658163 tide predictions calibrated with 48-hour shallow-water
                      estuarine harmonics (M₂, S₁, M₄) inside the Carolina Beach basin.
                    </p>
                  </div>
                </div>
                <div className="guide-item">
                  <span className="guide-icon">💨</span>
                  <div className="guide-text">
                    <strong>Ocean Surge &amp; N/NE Sound Wind</strong>
                    <p>
                      NOAA ETSS coastal storm surge combined with directional N/NE Myrtle Grove
                      Sound wind-fetch stress (25° axial + 70° onshore) and barometric pressure.
                    </p>
                  </div>
                </div>
                <div className="guide-item">
                  <span className="guide-icon">📡</span>
                  <div className="guide-text">
                    <strong>Cape Fear River &amp; Live Sensor</strong>
                    <p>
                      Wilmington River ETSS &amp; USGS Lock #1 discharge via Snow&apos;s Cut,
                      anchored live to Carolina Beach canal gauge 30046 (ft MLLW).
                    </p>
                  </div>
                </div>
              </div>

              {/* Flooding Impact Thresholds */}
              <div className="outlook-threshold-guide">
                <span className="threshold-guide-title">Carolina Beach Flood Levels (MLLW)</span>
                <div className="threshold-pills">
                  <span className="thresh-pill minor">
                    <strong>{thresholds.minor.toFixed(1)} ft</strong> Minor Stage (Canal Dr &amp;
                    Florida Ave)
                  </span>
                  <span className="thresh-pill moderate">
                    <strong>{thresholds.moderate.toFixed(1)} ft</strong> Moderate Stage (Road
                    Closures &amp; Structural Threat)
                  </span>
                  <span className="thresh-pill major">
                    <strong>{thresholds.major.toFixed(1)} ft</strong> Major Stage (Widespread
                    Hazard to Property)
                  </span>
                  <span className="thresh-pill extreme">
                    <strong>{thresholds.extreme.toFixed(1)} ft</strong> Extreme Stage (Severe
                    Coastal &amp; Hurricane Surge)
                  </span>
                </div>
              </div>
            </div>

            {onToggle && !operationalActive && (
              <div className="outlook-models-card">
                <div className="outlook-section-header">
                  <span className="section-dot" />
                  Forecast Model Overlays
                </div>
                <label className="forecast-toggle">
                  <input type="checkbox" checked={showComparison} onChange={onToggle} /> Compare
                  steady surge projection
                </label>
              </div>
            )}

            {/* Technical Provenance & Telemetry Sub-Drawer */}
            <details className="outlook-sub-details">
              <summary>Technical Data, Physics Provenance &amp; Sources</summary>
              <div className="sub-content">
                <div className="tech-reason-box">
                  <p>{selection.reason}</p>
                </div>

                {challenger ? (
                  <div className="tech-evidence-list">
                    <h5>Operational Physics &amp; Sensor Telemetry</h5>
                    <p className="tech-evidence-item">
                      Engine: {challenger.engine} ({challenger.covariatesUsed.join(", ")})
                    </p>
                    {challenger.metadata?.estuarineHarmonics && (
                      <p className="tech-evidence-item">
                        48h Estuarine Harmonic Fit: M₂{" "}
                        {challenger.metadata.estuarineHarmonics.m2AmpFt.toFixed(2)} ft · S₁{" "}
                        {challenger.metadata.estuarineHarmonics.s1AmpFt.toFixed(2)} ft · M₄{" "}
                        {challenger.metadata.estuarineHarmonics.m4AmpFt.toFixed(2)} ft (R² ={" "}
                        {challenger.metadata.estuarineHarmonics.rSquared.toFixed(2)})
                      </p>
                    )}
                    {typeof challenger.metadata?.usgsDischargeCfs === "number" && (
                      <p className="tech-evidence-item">
                        USGS Cape Fear River Lock #1 Discharge:{" "}
                        {Math.round(challenger.metadata.usgsDischargeCfs).toLocaleString()} cfs
                      </p>
                    )}
                  </div>
                ) : outlook?.evidence?.length ? (
                  <div className="tech-evidence-list">
                    <h5>Evaluated Evidence &amp; Sensor State</h5>
                    {outlook.evidence.map((e) => (
                      <p key={e.id} className="tech-evidence-item">
                        {e.text}
                      </p>
                    ))}
                  </div>
                ) : null}

                <ul className="clean-limitations-list">
                  {displayLimitations.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="sources-note">
                  Sources:{" "}
                  {(challenger ? operationalSources : outlook?.sources || operationalSources).join(
                    "; "
                  )}
                  .
                </p>
              </div>
            </details>
          </details>
        </>
      ) : (
        <details>
          <summary>Why is the outlook unavailable?</summary>
          <p>{selection.reason}</p>
          <p>
            The chart shows the available fallback. A current local forecast is not available.
          </p>
        </details>
      )}
    </section>
  );
}
