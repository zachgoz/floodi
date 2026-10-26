import { liveViewport } from 'src/utils/waterForecast';
import './ForecastPanels.css';

interface Props {
  viewport: { start: Date; end: Date };
  now: Date;
  focusRatio: number;
  forecastEndAt?: Date | null;
  isLive: boolean;
  onViewportChange: (start: Date, end: Date) => void;
  onReturnToLive: () => void;
}

/** One toolbar for both plots; viewport ownership stays in the tide chart. */
export function ForecastTimeControls({ viewport, now, focusRatio, forecastEndAt, isLive, onViewportChange, onReturnToLive }: Props) {
  const span = +viewport.end - +viewport.start;
  // The shorter buttons describe total chart width. This preset specifically
  // shows three future days while retaining the configured live-line position.
  const futureRatio = 1 - focusRatio;
  const threeDayHours = futureRatio > 0 ? 72 / futureRatio : NaN;
  const sevenDayHours = futureRatio > 0 ? 168 / futureRatio : NaN;
  const fullHours = forecastEndAt && Number.isFinite(+forecastEndAt) && +forecastEndAt > +now && futureRatio > 0
    ? (+forecastEndAt - +now) / 3600_000 / futureRatio : NaN;
  const select = (hours: number) => {
    const next = liveViewport(new Date(+now - hours * 3600_000), now, now, focusRatio);
    onViewportChange(next.start, next.end);
  };
  const zoom = (factor: number) => {
    const maximum = Math.max(span, (Number.isFinite(sevenDayHours) ? sevenDayHours : 168) * 3600_000,
      Number.isFinite(fullHours) ? fullHours * 3600_000 : 0);
    const duration = Math.max(3600_000, Math.min(maximum, span * factor));
    const focus = +viewport.start + span * focusRatio;
    onViewportChange(new Date(focus - duration * focusRatio), new Date(focus + duration * (1 - focusRatio)));
  };
  return <div className="forecast-time-controls" role="group" aria-label="Shared chart time window">
    <div className="forecast-time-presets">
      {[{ hours: 12, label: '12h', accessible: '12 hours' }, { hours: 24, label: '24h', accessible: '24 hours' },
        { hours: 48, label: '48h', accessible: '48 hours' }, { hours: threeDayHours, label: '3d', accessible: 'Next 3 days' },
        { hours: sevenDayHours, label: '7d', accessible: 'Next 7 days' },
        { hours: fullHours, label: 'All', accessible: 'Full forecast' }].map(({ hours, label, accessible }) => <button type="button" key={accessible}
        aria-label={`${label} — ${accessible}`}
        disabled={!Number.isFinite(hours) || hours <= 0}
        aria-pressed={Math.abs(span / 3600_000 - hours) < .01}
        onClick={() => select(hours)}>{label}</button>)}
    </div>
    <div className="forecast-time-actions">
      <button type="button" aria-label="Previous time window on both charts" onClick={() => onViewportChange(new Date(+viewport.start - span / 4), new Date(+viewport.end - span / 4))}>←</button>
      <button type="button" aria-label="Next time window on both charts" onClick={() => onViewportChange(new Date(+viewport.start + span / 4), new Date(+viewport.end + span / 4))}>→</button>
      <button type="button" aria-label="Zoom out both charts" onClick={() => zoom(2)}>−</button>
      <button type="button" aria-label="Zoom in both charts" onClick={() => zoom(.5)}>+</button>
      <button type="button" className="forecast-return-live" aria-label="Live — Return to Live" disabled={isLive} onClick={onReturnToLive}>
        <span aria-hidden="true">↺</span> Live
      </button>
    </div>
  </div>;
}
