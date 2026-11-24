import { useEffect, useState } from 'react';
import type { Point } from 'src/components/Tab2/types';
import type { NextTideInfo } from 'src/utils/tideExtrema';
import { currentGaugeStatus } from './currentGaugeStatus';

function formatShortThresholdLabel(status: ReturnType<typeof currentGaugeStatus>): string {
  if (!status.latest) return 'Unavailable';
  if (!status.fresh) return 'Out of date';
  return status.above ? 'Above threshold' : 'Below threshold';
}

export function CurrentConditions({
  points,
  thresholdFt,
  customView,
  onSettings,
  nextTideInfo,
  onNextTideClick,
}: {
  location?: string;
  points: Point[];
  thresholdFt: number;
  customView: boolean;
  onSettings: () => void;
  nextTideInfo?: NextTideInfo;
  onNextTideClick?: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const status = currentGaugeStatus(points, thresholdFt, now);
  const statusTone = status.above ? 'is-elevated' : status.fresh ? 'is-normal' : 'is-stale';
  const shortStatus = formatShortThresholdLabel(status);
  const timeText = status.latest
    ? status.latest.t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    : null;
  const fullGaugeAria = status.latest
    ? `Current gauge ${status.latest.v.toFixed(2)} feet at ${timeText} Eastern, ${status.label}`
    : `Current gauge ${status.label}`;

  return (
    <div className="dashboard-current-conditions">
      <div
        className={`cc-gauge-status-pill ${statusTone}`}
        aria-label={fullGaugeAria}
        title={fullGaugeAria}
      >
        <span className="cc-status-dot" aria-hidden="true" />
        {status.latest ? (
          <>
            <strong className="cc-gauge-val">{status.latest.v.toFixed(2)} ft</strong>
            <span className="cc-sep" aria-hidden="true">·</span>
            <span className="cc-threshold-label">{shortStatus}</span>
            {timeText && <span className="cc-gauge-time">{timeText} ET</span>}
          </>
        ) : (
          <span className="cc-threshold-label">{status.label}</span>
        )}
      </div>

      <div className="cc-actions-group">
        {nextTideInfo && (
          <button
            type="button"
            className={`cc-next-tide-pill ${nextTideInfo.type}`}
            data-tour-id="next-tide-badge"
            onClick={onNextTideClick}
            aria-label={`Next ${nextTideInfo.type} tide in ${
              nextTideInfo.minutesRemaining >= 60
                ? `${Math.floor(nextTideInfo.minutesRemaining / 60)} hours ${nextTideInfo.minutesRemaining % 60} minutes`
                : `${nextTideInfo.minutesRemaining} minutes`
            }`}
          >
            <span className="cc-tide-arrow" aria-hidden="true">
              {nextTideInfo.type === 'high' ? '▲' : '▼'}
            </span>
            <span>
              {nextTideInfo.type === 'high' ? 'High' : 'Low'} in{' '}
              {nextTideInfo.minutesRemaining >= 60
                ? `${Math.floor(nextTideInfo.minutesRemaining / 60)}h ${nextTideInfo.minutesRemaining % 60}m`
                : `${nextTideInfo.minutesRemaining}m`}
            </span>
            <span className="cc-tide-delta">
              ({nextTideInfo.heightDelta >= 0 ? '+' : ''}{nextTideInfo.heightDelta.toFixed(1)}&apos;)
            </span>
          </button>
        )}

        {customView && (
          <button type="button" className="cc-custom-btn" onClick={onSettings}>
            Custom
          </button>
        )}
      </div>
    </div>
  );
}
