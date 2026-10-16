import { selectedForecastFactors } from 'src/utils/surgeReadout';
import type { ForecastDocument } from '../../../functions/src/forecast/schema';

const feet = (value: number) => Math.abs(value) < .005 ? '0.00 ft' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)} ft`;
export function ForecastFactors({ document, at, residual }: { document?: ForecastDocument | null; at: Date; residual: number }) {
  const breakdown = selectedForecastFactors(document, at, residual);
  if (!breakdown) return document?.tail && +at > Date.parse(document.points.at(-1)?.t ?? '') ? <div className="surge-factors"><span>Historical tide pattern</span><details><summary>Forecast factors</summary><p>This extension follows the historical residual pattern and the chart’s astronomical tide. Weather contributions are unavailable beyond the published forecast.</p></details></div> : null;
  const ranked = breakdown.contributions.filter(p => Math.abs(p.value) >= .005).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const direction = breakdown.weather ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(breakdown.weather.wind6FromDeg / 45) % 8] : '';
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
