import React, { useMemo } from 'react';
import { IonIcon } from '@ionic/react';
import { waterOutline, timeOutline, flagOutline } from 'ionicons/icons';
import type { AppConfiguration } from '../Tab2/types';
import './InundationSimulator.css';

interface InundationSimulatorProps {
  waterLevelFt: number;
  minLevelFt?: number;
  maxLevelFt?: number;
  onLevelChange: (level: number) => void;
  thresholds: AppConfiguration['thresholds'];
  simulationContext?: {
    time: Date;
    wind?: { speed: number; dir: number };
    precip?: number;
    source?: string;
  };
}



export const InundationSimulator: React.FC<InundationSimulatorProps> = ({
  waterLevelFt,
  minLevelFt = 0.0,
  maxLevelFt = 10.0,
  onLevelChange,
  thresholds,
  simulationContext,
}) => {
  const ticks = useMemo(() => [
    { label: 'Minor', ft: thresholds.minor, cls: 'sim-tick-minor' },
    { label: 'Moderate', ft: thresholds.moderate, cls: 'sim-tick-moderate' },
    { label: 'Major', ft: thresholds.major, cls: 'sim-tick-major' },
    { label: 'Extreme', ft: thresholds.extreme, cls: 'sim-tick-extreme' },
  ], [thresholds]);
  const pct = (ft: number) =>
    Math.max(0, Math.min(100, Math.round(((ft - minLevelFt) / (maxLevelFt - minLevelFt)) * 100)));

  const pMinor = pct(thresholds.minor);
  const pModerate = pct(thresholds.moderate);
  const pMajor = pct(thresholds.major);
  const pExtreme = pct(thresholds.extreme);

  const now = new Date();
  // Ensure we handle potential null/undefined context gracefully
  const simTime = simulationContext?.time ?? now;
  const diffMinutes = (simTime.getTime() - now.getTime()) / 60000;
  
  let dynamicTitle = "Water Level Simulation";
  if (simulationContext) {
    if (Math.abs(diffMinutes) < 5) {
      dynamicTitle = "Live Water Level";
    } else if (diffMinutes <= -5) {
      dynamicTitle = "Simulating Past Water Level";
    } else {
      dynamicTitle = "FloodCast Water Level";
    }
  }

  const displaySource = useMemo(() => {
    if (!simulationContext?.source) return null;
    // For future predictions, we want to label it as Predicted even if the underlying data source is the standard observed track
    if (diffMinutes > 5) {
      return '(Predicted)';
    }
    return `(${simulationContext.source})`;
  }, [simulationContext?.source, diffMinutes]);

  return (
    <div className="simulator-container" style={{
      ['--p-minor' as any]: `${pMinor}%`,
      ['--p-mod' as any]: `${pModerate}%`,
      ['--p-major' as any]: `${pMajor}%`,
      ['--p-ext' as any]: `${pExtreme}%`,
    }}>
      <div className="simulator-header">
        <div className="simulator-title-group">
          <h3 className="simulator-title">{dynamicTitle}</h3>
          {simulationContext && (
            <div className="simulator-context">
              <span className="context-item time">
                <IonIcon icon={timeOutline} />
                {simulationContext.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}
              </span>
              {displaySource && (
                <span className="context-source">{displaySource}</span>
              )}
              {simulationContext.precip !== undefined && simulationContext.precip > 0 && (
                <span className="context-item precip">
                  <IonIcon icon={waterOutline} />
                  {simulationContext.precip.toFixed(2)} in
                </span>
              )}
            </div>
          )}
        </div>
        <div className="simulator-readout">{waterLevelFt.toFixed(2)} ft MLLW</div>
      </div>

      <div className="simulator-slider-wrapper">
        <input
          type="range"
          min={minLevelFt}
          max={maxLevelFt}
          step={0.05}
          value={waterLevelFt}
          onChange={(e) => onLevelChange(parseFloat(e.target.value))}
          className="simulator-slider"
          aria-label="Adjust flood simulation water level (ft MLLW)"
        />



        <div className="simulator-labels">
          <div className="label-group">
            <span className="label-ft">{minLevelFt.toFixed(1)} ft</span>
            <span className="label-text">No Flooding</span>
          </div>
          <div className="label-group center">
            <span className="simulator-label-datum">ft MLLW</span>
          </div>
          <div className="label-group end extreme">
            <span className="label-ft">{maxLevelFt.toFixed(1)} ft</span>
            <span className="label-text extreme">Extreme Flooding</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InundationSimulator;
