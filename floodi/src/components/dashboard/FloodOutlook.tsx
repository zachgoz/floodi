import type { ForecastDocument } from "../../../functions/src/forecast/schema";
import { eventDate, eventTime } from "src/utils/waterForecast";
import type { SelectedWaterForecast } from "src/utils/selectWaterForecast";
import "./ForecastPanels.css";
interface Props {
  outlook: ForecastDocument | null;
  selection: SelectedWaterForecast;
  showComparison: boolean;
  onToggle: () => void;
  floodExpected?: boolean;
  floodPossible?: boolean;
}
export function FloodOutlook({
  outlook,
  selection,
  showComparison,
  onToggle,
  floodExpected,
  floodPossible,
}: Props) {
  // Keep the mobile overview compact; complete evidence stays in the expander.
  const weatherSelected = selection.method === 'weather' || selection.method === 'learned';
  const suppliedSummary = outlook?.explanation.evidenceIds.filter(id => !['availability', 'validation', 'uncertainty'].includes(id)) || [];
  const summaryIds = weatherSelected ? suppliedSummary.includes('weather') ? ['weather'] : suppliedSummary.slice(0, 1) : [];
  return (
    <section className="forecast-panel dashboard-outlook-card">
      <div className="forecast-panel-heading">
        <div>
          <h2>Flood Outlook</h2>
          <p>
            {weatherSelected ? floodExpected ? 'Elevated flood risk' : floodPossible ? 'Flooding possible' : selection.tailMethod || selection.extensionMethod ? 'Extended outlook' : selection.method === 'learned' ? 'Short-range forecast' : 'Weather-aware forecast' : selection.method === 'steady' ? 'Steady projection' : 'Astronomical tide only'}
          </p>
        </div>
        <span className="confidence-badge">{selection.confidence === 'limited' ? 'Limited confidence' : 'Outlook unavailable'}</span>
      </div>
      {outlook ? (
        <>
          {summaryIds.map((id) => (
            <p key={id}>{outlook.evidence.find((e) => e.id === id)?.text}</p>
          ))}
          <p className="forecast-caption">
            Updated {eventTime(new Date(outlook.generatedAt))} ET ·{" "}
            {outlook.explanationSource === "fallback"
              ? "Calculated summary"
              : "Gemini 3.8 Flash explanation"}
          </p>
          <details>
            <summary>Model evaluation and data quality</summary>
            <p>{selection.reason}</p>
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
              .filter((e) => !summaryIds.includes(e.id))
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
          <p>Local sensor history, weather coverage and backend configuration must be verified before an intelligent outlook can be shown.</p>
        </details>
      )}
    </section>
  );
}
