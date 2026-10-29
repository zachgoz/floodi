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
}: {
  location: string;
  locationId?: string;
  points: Point[];
  thresholdFt: number;
  customView: boolean;
  onSettings: () => void;
  onLocationChange?: (locationId: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const status = currentGaugeStatus(points, thresholdFt, now);

  return (
    <div className="dashboard-current-conditions">
      <div>
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
          <strong>{location}</strong>
        )}
        <span className={status.above ? 'condition-elevated' : ''}>{status.label}</span>
      </div>
      <div>
        <small>
          {status.latest
            ? `Observed ${status.latest.v.toFixed(2)} ft · ${status.latest.t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`
            : 'Waiting for a recent gauge reading'}
        </small>
        {customView && <button type="button" onClick={onSettings}>Custom chart view</button>}
      </div>
    </div>
  );
}
