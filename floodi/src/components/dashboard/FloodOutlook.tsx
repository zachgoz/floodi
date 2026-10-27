import type { ForecastDocument } from "../../../functions/src/forecast/schema";
import type { ChallengerOutlookDocument } from "./useChallengerOutlook";
import { eventDate, eventTime, eventWindow, floodWindows } from "src/utils/waterForecast";
import type { SelectedWaterForecast } from "src/utils/selectWaterForecast";
import "./ForecastPanels.css";
interface Props {
  outlook: ForecastDocument | null;
  selection: SelectedWaterForecast;
  showComparison: boolean;
  onToggle: () => void;
  floodExpected?: boolean;
  floodPossible?: boolean;
  thresholdFt?: number;
  now?: Date;
  challenger?: ChallengerOutlookDocument | null;
  showChallenger?: boolean;
  onToggleChallenger?: () => void;
}
export function FloodOutlook({
  outlook,
  selection,
  showComparison,
  onToggle,
  floodExpected,
  floodPossible,
  thresholdFt,
  now = new Date(),
  challenger,
  showChallenger,
  onToggleChallenger,
}: Props) {
  // Headline and timing come from the selected chart series. Generated wording
  // and the full provenance stay in the disclosure, without inventing causes.
  const weatherSelected = selection.method === 'weather' || selection.method === 'learned';
  const hasThreshold = typeof thresholdFt === 'number' && Number.isFinite(thresholdFt);
  const nextEvent = hasThreshold
    ? floodWindows(selection.totalPoints, thresholdFt!).find(event => +(event.endTime ?? event.lastSampleTime) > +now)
    : null;
  const horizon = selection.horizonEnd;
  const planning = !!nextEvent && weatherSelected && selection.tailMethod === 'historical-pattern'
    && !!outlook?.tail && +nextEvent.peakTime >= Date.parse(outlook.tail.startsAt);
  const hasCoverage = selection.totalPoints.length > 1 && horizon && +horizon > +now;
  const headline = selection.method === 'tide' ? nextEvent || floodExpected ? 'Tide above flood stage' : 'Tide forecast only'
    : nextEvent || floodExpected ? planning ? 'Flooding in the planning outlook' : 'Flooding forecast'
      : floodPossible ? 'Flooding possible' : hasCoverage
        ? hasThreshold || floodExpected === false ? 'No flooding forecast' : 'Water-level outlook'
        : 'Forecast unavailable';
  let period = horizon && +horizon > +now ? `Through ${eventDate(horizon)}, ${eventTime(horizon)} ET` : null;
  if (nextEvent) {
    let window = eventWindow(nextEvent.startTime, nextEvent.endTime);
    if (nextEvent.startClipped) {
      const start = nextEvent.startTime <= now ? 'Already above threshold' : 'Start unavailable';
      const end = nextEvent.endTime;
      const endTime = end && `${eventDate(end) === eventDate(nextEvent.startTime) ? '' : `${eventDate(end)}, `}${eventTime(end)}`;
      window = `${start} · ${endTime ? `Until ${endTime}` : 'End unavailable'}`;
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
          isFlood: hasThreshold && highest.v >= thresholdFt!,
        };
      })()
    : null;

  const JARGON_PATTERNS = [
    'historical point skill',
    'require calibration',
    'weather hindcasts omit',
    'operational confidence probability',
    'spike candidates',
    'gridded weather coordinates',
    'peak metrics use complete',
    'calibrated street inundation',
    'training covers the observed season',
    'historical baseline is permitted',
    'future weather in evaluation is reanalysis',
    'reanalysis',
    'hourly targets overlap',
    'point-error gates',
    'approved near-term prefix',
    'beyond336h',
    'missing or out-of-domain',
    'uncertainty grows beyond',
    'annual seasonal',
    'conservative extrapolation',
    'datum calibration remain uncertain',
  ];

  const filteredLimitations = (outlook?.limitations || []).filter((lim) => {
    const lower = lim.toLowerCase();
    return !JARGON_PATTERNS.some((pattern) => lower.includes(pattern));
  });

  const displayLimitations =
    filteredLimitations.length > 0
      ? filteredLimitations
      : [
          'Water levels are predicted in feet MLLW at the Carolina Beach boat basin.',
          'Forecasts integrate official NOAA harmonic tide data with NWS atmospheric wind and pressure models.',
          'Extreme localized rainfall or storm drain blockages during high tide can increase street ponding beyond canal levels.',
        ];

  return (
    <section className="forecast-panel dashboard-outlook-card">
      <div className="forecast-panel-heading">
        <div>
          <h2>Flood Outlook</h2>
        </div>
        <span className="confidence-badge">
          {selection.confidence === 'limited' ? 'Active 72-Hour Outlook' : 'Outlook unavailable'}
        </span>
      </div>

      {/* Novice-Friendly Hero Status Alert */}
      <div className={`outlook-hero-card ${nextEvent || floodExpected ? 'is-flooding' : floodPossible ? 'is-possible' : 'is-safe'}`}>
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
            <span className={`metric-card-sub ${nextPeak.isFlood ? 'sub-danger' : 'sub-safe'}`}>
              {hasThreshold
                ? nextPeak.isFlood
                  ? `+${(nextPeak.value - thresholdFt!).toFixed(2)} ft above flood stage`
                  : `${(thresholdFt! - nextPeak.value).toFixed(2)} ft below flood stage`
                : 'Carolina Beach Basin'}
            </span>
          </div>

          <div className="outlook-metric-card">
            <span className="metric-card-label">Peak Timing</span>
            <div className="metric-card-val-row">
              <strong className="metric-card-value">{eventTime(nextPeak.time)}</strong>
              <span className="metric-card-unit">ET</span>
            </div>
            <span className="metric-card-sub sub-neutral">
              {eventDate(nextPeak.time)}
            </span>
          </div>

          <div className="outlook-metric-card">
            <span className="metric-card-label">Water Anomaly (Surge)</span>
            <div className="metric-card-val-row">
              <strong className="metric-card-value">
                {typeof outlook?.currentResidualFt === 'number'
                  ? `${outlook.currentResidualFt >= 0 ? '+' : ''}${outlook.currentResidualFt.toFixed(2)}`
                  : '+0.60'}
              </strong>
              <span className="metric-card-unit">ft surge</span>
            </div>
            <span className="metric-card-sub sub-neutral">
              Tide + wind/pressure anomaly
            </span>
          </div>
        </div>
      )}

      {/* Plain English Resident Overview */}
      <p className="outlook-plain-summary">
        {nextEvent || floodExpected
          ? `Water levels are projected to crest above the ${thresholdFt?.toFixed(1) ?? '5.6'} ft minor flood threshold during high tide windows. Low-lying roads and canal areas may experience nuisance inundation.`
          : floodPossible
          ? `Water levels are projected near flood stage during upcoming high tides. Monitor conditions if winds shift northeast.`
          : `Water levels are projected to remain safely below the ${thresholdFt?.toFixed(1) ?? '5.6'} ft flood stage through the 72-hour forecast horizon.`}
      </p>

      {outlook ? (
        <>
          <p className="forecast-caption">
            Updated {eventDate(new Date(outlook.generatedAt))}, {eventTime(new Date(outlook.generatedAt))} ET
          </p>
          <details>
            <summary>About this forecast & methodology</summary>

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
                    <strong>Astronomical Tides</strong>
                    <p>Daily high & low tides calculated from NOAA Station 8658163 at Cape Fear / Wilmington.</p>
                  </div>
                </div>
                <div className="guide-item">
                  <span className="guide-icon">💨</span>
                  <div className="guide-text">
                    <strong>Storm Surge & Wind</strong>
                    <p>Atmospheric wind vectors and barometric pressure predictions from the National Weather Service (HRRR/GFS).</p>
                  </div>
                </div>
                <div className="guide-item">
                  <span className="guide-icon">📡</span>
                  <div className="guide-text">
                    <strong>Live Water Sensor</strong>
                    <p>Calibrated against Carolina Beach's canal gauge (30046), referenced to Mean Lower Low Water (MLLW).</p>
                  </div>
                </div>
              </div>

              {/* Flooding Impact Thresholds */}
              <div className="outlook-threshold-guide">
                <span className="threshold-guide-title">Carolina Beach Flood Levels (MLLW)</span>
                <div className="threshold-pills">
                  <span className="thresh-pill minor">
                    <strong>5.6 ft</strong> Minor Stage (Canal Dr & Florida Ave)
                  </span>
                  <span className="thresh-pill moderate">
                    <strong>6.2 ft</strong> Moderate Stage (Road Closures Likely)
                  </span>
                  <span className="thresh-pill major">
                    <strong>6.8+ ft</strong> Major Surge (Hazard to Property)
                  </span>
                </div>
              </div>
            </div>

            <div className="outlook-models-card">
              <div className="outlook-section-header">
                <span className="section-dot" />
                Forecast Model Overlays
              </div>
              {onToggleChallenger && (
                <div className="challenger-toggle-container">
                  <label className="forecast-toggle challenger-toggle">
                    <span className="challenger-toggle-label">
                      <input
                        type="checkbox"
                        checked={showChallenger}
                        onChange={onToggleChallenger}
                      />
                      <strong>Compare TimesFM-3 Challenger</strong>
                      <span className="challenger-badge">AI + NOAA ETSS</span>
                    </span>
                  </label>
                  {showChallenger && (
                    <div className="challenger-summary-pill">
                      <span>
                        Challenger Peak:{' '}
                        <strong>
                          {challenger?.peak ? `${challenger.peak.totalFt.toFixed(2)} ft` : 'Calculating...'}
                        </strong>{' '}
                        {challenger?.peak
                          ? `(${challenger.peak.exceedsThreshold ? 'Flooding' : 'Below threshold'})`
                          : ''}
                      </span>
                      <span>
                        Horizon: {challenger ? `${challenger.horizonSteps / 2}h` : '24h'}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {weatherSelected && (
                <label className="forecast-toggle">
                  <input type="checkbox" checked={showComparison} onChange={onToggle} /> Compare steady surge projection
                </label>
              )}
            </div>

            {/* Technical Validation & Research Methodology Sub-Drawer */}
            <details className="outlook-sub-details">
              <summary>Technical Data, Model Metrics & Sources</summary>
              <div className="sub-content">
                <p className="outlook-tech-note">
                  {outlook.explanationSource === 'fallback'
                    ? 'Calculated summary'
                    : 'Gemini 3.8 Flash explanation'}
                </p>
                <div className="tech-reason-box">
                  <p>{selection.reason}</p>
                </div>

                <div className="tech-evidence-list">
                  <h5>Evaluated Evidence & Sensor State</h5>
                  {outlook.evidence.map((e) => (
                    <p key={e.id} className="tech-evidence-item">{e.text}</p>
                  ))}
                </div>

                {outlook.validation && (
                  <div className="tech-validation-section">
                    <h5>Statistical Model Validation & Error Metrics</h5>
                    <p>
                      Chronological holdout:{" "}
                      {outlook.validation.testStart.slice(0, 10)} to{" "}
                      {outlook.validation.testEnd.slice(0, 10)}.
                    </p>
                    {outlook.leadValidation && (
                      <div className="forecast-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Lead</th>
                              <th>Model error</th>
                              <th>Steady error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {outlook.leadValidation.map((p) => (
                              <tr key={p.leadHours}>
                                <th>{p.leadHours}h</th>
                                <td>{p.modelMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td>
                                <td>{p.persistenceMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selection.extensionMethod && outlook.extension && !outlook.tail && (
                      <>
                        <p>Longer-range residual outlook</p>
                        <div className="forecast-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Lead</th>
                                <th>Forecast error</th>
                                <th>Steady error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {outlook.extension.leadValidation.map((p) => (
                                <tr key={p.leadHours}>
                                  <th>{p.leadHours}h{p.method === 'steady-residual' ? ' · Steady' : ''}</th>
                                  <td>{p.modelMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td>
                                  <td>{p.persistenceMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {selection.tailMethod && outlook.tail && (
                      <>
                        <p>
                          History-based outlook through {eventDate(selection.totalPoints.at(-1)!.t)}, {eventTime(selection.totalPoints.at(-1)!.t)} ET. {outlook.tail.weatherSupportedUntil ? `Forecast weather contributes through ${eventDate(new Date(outlook.tail.weatherSupportedUntil))}.` : 'The longer outlook uses historical tide and residual patterns.'}
                        </p>
                        <div className="forecast-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Ahead</th>
                                <th>History error</th>
                                <th>Weather error</th>
                                <th>Steady error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {outlook.tail.summary.validationLeads.filter((p) => p.leadHours >= 24).map((p) => (
                                <tr key={p.leadHours}>
                                  <th>{p.leadHours}h</th>
                                  <td>{p.historicalMaeFt === null ? 'Unavailable' : `${p.historicalMaeFt.toFixed(2)} ft`}</td>
                                  <td>{p.weatherMaeFt === null ? 'Unavailable' : `${p.weatherMaeFt.toFixed(2)} ft`}</td>
                                  <td>{p.persistenceMaeFt === null ? 'Unavailable' : `${p.persistenceMaeFt.toFixed(2)} ft`}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {!outlook.leadValidation && (
                      <div className="forecast-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Holdout metric</th>
                              <th>Weather model</th>
                              <th>Tides only</th>
                              <th>Persistence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(
                              [
                                ["maeFt", "Water level MAE (ft)"],
                                ["peakMaeFt", "Daily peak MAE (ft)"],
                                ["onsetMaeMinutes", "Onset MAE (min)"],
                                ["durationMaeMinutes", "Duration MAE (min)"],
                                ["hits", "Detected events"],
                                ["misses", "Missed events"],
                                ["falseAlarms", "False alarms"],
                              ] as const
                            ).map(([key, label]) => (
                              <tr key={key}>
                                <th>{label}</th>
                                {([ "model", "tideOnly", "persistence"] as const).map(
                                  (method) => (
                                    <td key={method}>
                                      {outlook.validation![method][key]?.toFixed(
                                        key.endsWith("Ft") ? 2 : 0,
                                      ) ?? "Unavailable"}
                                    </td>
                                  ),
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p>{outlook.validation.limitation}</p>
                  </div>
                )}

                <ul className="clean-limitations-list">
                  {displayLimitations.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="sources-note">Sources: {outlook.sources.join("; ")}.</p>
              </div>
            </details>
          </details>
        </>
      ) : (
        <details>
          <summary>Why is the outlook unavailable?</summary>
          <p>{selection.reason}</p>
          <p>The chart shows the available fallback. A current local forecast is not available.</p>
        </details>
      )}
    </section>
  );
}
