import { useEffect, useState } from 'react';
import type { Point } from 'src/components/Tab2/types';

import { currentGaugeStatus } from './currentGaugeStatus';

export function CurrentConditions({ location, points, thresholdFt, customView, onSettings }: { location: string; points: Point[]; thresholdFt: number; customView: boolean; onSettings: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const status = currentGaugeStatus(points, thresholdFt, now);
  return <div className="dashboard-current-conditions">
    <div><strong>{location}</strong><span className={status.above ? 'condition-elevated' : ''}>{status.label}</span></div>
    <div><small>{status.latest ? `Observed ${status.latest.v.toFixed(2)} ft · ${status.latest.t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET` : 'Waiting for a recent gauge reading'}</small>
      {customView && <button type="button" onClick={onSettings}>Custom chart view</button>}</div>
  </div>;
}
