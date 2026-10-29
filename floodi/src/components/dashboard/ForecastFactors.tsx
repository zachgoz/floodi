import { selectedForecastFactors, selectOperationalSurgeDrivers } from 'src/utils/surgeReadout';
import type { ChallengerOutlookDocument } from './useChallengerOutlook';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const feet = (value: number) => Math.abs(value) < .005 ? '0.00 ft' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)} ft`;

export function ForecastFactors({
  challenger,
  document,
  at,
  residual,
}: {
  challenger?: ChallengerOutlookDocument | null;
  document?: ForecastDocument | null;
  at: Date;
  residual: number;
}) {
  const operational = selectOperationalSurgeDrivers(challenger, at, residual);
  if (operational) {
    const ranked = operational.contributions
      .filter(p => Math.abs(p.value) >= 0.005)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const compass = operational.weather
      ? COMPASS_8[Math.round(((operational.weather.windDirectionDeg % 360) + 360) % 360 / 45) % 8]
      : '';
    return (
      <div className="surge-factors" aria-label="Selected forecast factors">
        <div className="surge-factor-preview">
          {(ranked.length ? ranked.slice(0, 3) : operational.contributions.slice(0, 2)).map(p => (
            <span key={p.id}>
              {p.label} <b>{feet(p.value)}</b>
            </span>
          ))}
        </div>
        <details key={operational.method}>
          <summary>
            Physical surge breakdown <span>{operational.method}</span>
          </summary>
          <dl>
            {operational.contributions.map(p => (
              <div key={p.id}>
                <dt title={p.source}>{p.label}</dt>
                <dd>{feet(p.value)}</dd>
              </div>
            ))}
          </dl>
          {operational.weather && (
            <p className="forecast-weather-context">
              Wind: {compass} {operational.weather.windSpeedMph.toFixed(0)} mph · Rain:{' '}
              {operational.weather.precipIn.toFixed(2)} in/hr
            </p>
          )}
          <p>
            Physical surge components at the selected forecast time across NOAA coastal ocean guidance,
            directional N/NE Myrtle Grove Sound wind setup, Cape Fear River / Snow&apos;s Cut hydraulic head,
            local rainfall runoff, and 48-hour shallow-water estuarine harmonics.
          </p>
        </details>
      </div>
    );
  }

  const breakdown = selectedForecastFactors(document, at, residual);
  if (!breakdown) return document?.tail && +at > Date.parse(document.points.at(-1)?.t ?? '') ? <div className="surge-factors"><span>Historical tide pattern</span><details><summary>Forecast factors</summary><p>This extension follows the historical residual pattern and the chart’s astronomical tide. Weather contributions are unavailable beyond the published forecast.</p></details></div> : null;
  const ranked = breakdown.contributions.filter(p => Math.abs(p.value) >= .005).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const direction = breakdown.weather ? COMPASS_8[Math.round(breakdown.weather.wind6FromDeg / 45) % 8] : '';
  return <div className="surge-factors" aria-label="Selected forecast factors">
    <div className="surge-factor-preview">{ranked.slice(0, 3).map(p => <span key={p.id}>{p.label} <b>{feet(p.value)}</b></span>)}</div>
    <details key={breakdown.method}>
      <summary>All forecast factors <span>{breakdown.method}</span></summary>
      <dl>{breakdown.contributions.map(p => <div key={p.id}><dt title={p.source}>{p.label}</dt><dd>{feet(p.value)}</dd></div>)}</dl>
      {breakdown.weather && <p className="forecast-weather-context">6h wind: {direction} {breakdown.weather.wind6Mph.toFixed(0)} mph · 24h rain: {breakdown.weather.rain24In.toFixed(2)} in · Pressure: {breakdown.weather.pressureHpa.toFixed(0)} hPa</p>}
      <p>Model contributions to the selected anomaly, relative to learned reference conditions. These are statistical associations; individual causes are uncertain. Contributions include model blending and reversion. Values are rounded.</p>
    </details>
  </div>;
}
