import type { ForecastDocument } from "../../../functions/src/forecast/schema";
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
  return (
    <section className="forecast-panel dashboard-outlook-card">
      <div className="forecast-panel-heading">
        <div>
          <h2>Flood Outlook</h2>
          <p className="outlook-risk-label">{headline}</p>
        </div>
        <span className="confidence-badge">{selection.confidence === 'limited' ? 'Limited confidence' : 'Outlook unavailable'}</span>
      </div>
      {period && <p className="outlook-period">{period}</p>}
      {!nextEvent && floodPossible && <p className="forecast-caption">The forecast error range reaches flood stage.</p>}
      {outlook ? (
        <>
          <p className="forecast-caption">
            Updated {eventDate(new Date(outlook.generatedAt))}, {eventTime(new Date(outlook.generatedAt))} ET
          </p>
          <details>
            <summary>Forecast details</summary>
            <p>{selection.reason}</p>
            <p>{outlook.explanationSource === 'fallback' ? 'Calculated summary' : 'Gemini 3.8 Flash explanation'} · Limited confidence is not a calibrated probability of flooding.</p>
            {weatherSelected && <label className="forecast-toggle"><input type="checkbox" checked={showComparison} onChange={onToggle} /> Compare steady surge projection</label>}
            {outlook.validation && (
              <>
                <p>
                  Chronological holdout:{" "}
                  {outlook.validation.testStart.slice(0, 10)} to{" "}
                  {outlook.validation.testEnd.slice(0, 10)}.
                </p>
                {outlook.leadValidation && <div className="forecast-table-wrap"><table><thead><tr><th>Lead</th><th>Model error</th><th>Steady error</th></tr></thead><tbody>{outlook.leadValidation.map(p => <tr key={p.leadHours}><th>{p.leadHours}h</th><td>{p.modelMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td><td>{p.persistenceMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td></tr>)}</tbody></table></div>}
                {selection.extensionMethod && outlook.extension && !outlook.tail && <>
                  <p>Longer-range residual outlook</p>
                  <div className="forecast-table-wrap"><table><thead><tr><th>Lead</th><th>Forecast error</th><th>Steady error</th></tr></thead><tbody>{outlook.extension.leadValidation.map(p => <tr key={p.leadHours}><th>{p.leadHours}h{p.method === 'steady-residual' ? ' · Steady' : ''}</th><td>{p.modelMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td><td>{p.persistenceMaeFt?.toFixed(2) ?? 'Unavailable'} ft</td></tr>)}</tbody></table></div>
                </>}
                {selection.tailMethod && outlook.tail && <>
                  <p>History-based outlook through {eventDate(selection.totalPoints.at(-1)!.t)}, {eventTime(selection.totalPoints.at(-1)!.t)} ET. {outlook.tail.weatherSupportedUntil ? `Forecast weather contributes through ${eventDate(new Date(outlook.tail.weatherSupportedUntil))}.` : 'The longer outlook uses historical tide and residual patterns.'}</p>
                  <div className="forecast-table-wrap"><table><thead><tr><th>Ahead</th><th>History error</th><th>Weather error</th><th>Steady error</th></tr></thead><tbody>{outlook.tail.summary.validationLeads.filter(p => p.leadHours >= 24).map(p => <tr key={p.leadHours}><th>{p.leadHours}h</th><td>{p.historicalMaeFt === null ? 'Unavailable' : `${p.historicalMaeFt.toFixed(2)} ft`}</td><td>{p.weatherMaeFt === null ? 'Unavailable' : `${p.weatherMaeFt.toFixed(2)} ft`}</td><td>{p.persistenceMaeFt === null ? 'Unavailable' : `${p.persistenceMaeFt.toFixed(2)} ft`}</td></tr>)}</tbody></table></div>
                </>}
                {!outlook.leadValidation && <div className="forecast-table-wrap">
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
                          {(["model", "tideOnly", "persistence"] as const).map(
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
                </div>}
                <p>{outlook.validation.limitation}</p>
              </>
            )}
            {outlook.evidence
              .map((e) => (
                <p key={e.id}>{e.text}</p>
              ))}
            <ul>
              {outlook.limitations.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p>Sources: {outlook.sources.join("; ")}.</p>
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
