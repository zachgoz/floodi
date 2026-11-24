import { useEffect, useState } from 'react';
import type { Point } from 'src/components/Tab2/types';
import { LOCATIONS } from 'src/constants/locations';
import { currentGaugeStatus } from './currentGaugeStatus';

export function CurrentConditions({
  location,
  locationId,
  points,
  thresholdFt,
  customView,
  onSettings,
  onLocationChange,
  onAccuracyClick,
  maeInches = 2.4,
}: {
  location: string;
  locationId?: string;
  points: Point[];
  thresholdFt: number;
  customView: boolean;
  onSettings: () => void;
  onLocationChange?: (locationId: string) => void;
  onAccuracyClick?: () => void;
  maeInches?: number;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const status = currentGaugeStatus(points, thresholdFt, now);
  const statusTone = status.above ? 'is-elevated' : status.fresh ? 'is-normal' : 'is-stale';

  return (
    <div className="dashboard-current-conditions">
      <div className="cc-station-group">
        {onLocationChange && locationId ? (
          <label className="location-select-label">
            <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Monitoring Station</span>
            <select
              aria-label="Select monitoring station"
              className="location-select"
              value={locationId}
              onChange={e => onLocationChange(e.target.value)}
            >
              {Object.values(LOCATIONS).map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}, {loc.state}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <strong className="cc-location-name">{location}</strong>
        )}
        <span className={`cc-status-badge ${statusTone}`}>
          <span className="cc-status-dot" aria-hidden="true" />
          {status.label}
        </span>
      </div>

      <div className="cc-telemetry-group">
        <div className="cc-gauge-chip" aria-label="Latest observed canal gauge reading">
          <span className="cc-chip-kicker">Gauge</span>
          {status.latest ? (
            <>
              <strong className="cc-chip-val">{status.latest.v.toFixed(2)} ft</strong>
              <span className="cc-chip-time">
                {status.latest.t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET
              </span>
            </>
          ) : (
            <span className="cc-chip-time">Waiting for reading</span>
          )}
        </div>

        {onAccuracyClick && (
          <button
            type="button"
            className="accuracy-pill-trigger"
            onClick={onAccuracyClick}
            aria-label={`View forecast accuracy audit, average error plus or minus ${maeInches.toFixed(1)} inches`}
          >
            <span className="accuracy-pill-dot" aria-hidden="true" />
            <span className="cc-chip-kicker">Accuracy</span>
            <strong>±{maeInches.toFixed(1)}&quot;</strong>
            <span className="cc-chip-chevron" aria-hidden="true">›</span>
          </button>
        )}

        {customView && (
          <button type="button" className="cc-custom-btn" onClick={onSettings}>
            Custom view
          </button>
        )}
      </div>
    </div>
  );
}
