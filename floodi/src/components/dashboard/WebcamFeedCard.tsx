import React, { useState, useEffect } from 'react';
import { IonIcon, IonButton } from '@ionic/react';
import { videocamOutline, refreshOutline, warningOutline, closeOutline } from 'ionicons/icons';
import './WebcamFeedCard.css';

interface WebcamFeedCardProps {
  locationName: string;
  cameraId: string;
  targetTime: Date;
  onResetToLive?: () => void;
  onClose?: () => void;
  imagery?: Record<string, string>;
  isScrolling?: boolean;
}

// Helper to truncate seconds/milliseconds to start exactly on the minute
function getBaseMinute(date: Date): Date {
  const d = new Date(date);
  d.setUTCSeconds(0);
  d.setUTCMilliseconds(0);
  return d;
}

function formatDateToIsoString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}Z`;
}

// Smart lookup table: probe every minute for 60 minutes to catch any camera drift (since cameras take photos every 6 mins but drift, and also drop frames).
// Then jump to previous likely daylight hours and probe 20-minute clusters to find the current drift.
const FALLBACK_OFFSETS_MINUTES = [
  // First 60 minutes minute-by-minute (guarantees finding an interval regardless of drift and dropped frames)
  ...Array.from({ length: 60 }, (_, i) => i),
  // Probe 1-hour increments up to 12 hours to catch intermittent availability
  ...Array.from({ length: 11 }, (_, i) => (i + 1) * 60),
  // Final probe around the 12-hour mark
  ...Array.from({ length: 20 }, (_, i) => 12 * 60 + i),
];

export const WebcamFeedCard: React.FC<WebcamFeedCardProps> = ({
  locationName,
  cameraId,
  targetTime,
  onResetToLive,
  onClose,
  imagery,
  isScrolling = false,
}) => {
  const [stableTime, setStableTime] = useState(targetTime);
  const [attemptIdx, setAttemptIdx] = useState(0);
  const [apiFailed, setApiFailed] = useState(false);
  const [hasError, setHasError] = useState(false);
  const MAX_ATTEMPTS = FALLBACK_OFFSETS_MINUTES.length;

  // Reset attempts when time or camera changes
  useEffect(() => {
    if (!isScrolling) {
      setStableTime(targetTime);
      setAttemptIdx(0);
      setApiFailed(false);
      setHasError(false);
    }
  }, [targetTime, cameraId, imagery, isScrolling]);

  const activeTime = isScrolling ? stableTime : targetTime;
  const isFuture = (activeTime.getTime() - Date.now()) > 10 * 60 * 1000;
  
  // 1. Try to find image in API response first
  let imageUrl = '';
  let finalImageDate = new Date();
  let foundInApi = false;

  if (imagery && Object.keys(imagery).length > 0 && !apiFailed && !hasError) {
    const targetMs = activeTime.getTime();
    const sortedTimes = Object.keys(imagery)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // Latest first
    
    // Find nearest point <= targetTime
    for (const iso of sortedTimes) {
      const t = new Date(iso).getTime();
      if (t <= targetMs) {
        imageUrl = imagery[iso];
        finalImageDate = new Date(iso);
        foundInApi = true;
        break;
      }
    }
  }

  // 2. Fallback to manual URL construction if not found in API or if specifically failed
  if (!foundInApi) {
    const baseDate = getBaseMinute(activeTime);
    const offsetMinutes = FALLBACK_OFFSETS_MINUTES[attemptIdx] || 0;
    finalImageDate = new Date(baseDate.getTime() - offsetMinutes * 60 * 1000);
    const dateString = formatDateToIsoString(finalImageDate);
    imageUrl = `https://wl.secoora.org/webcam/${cameraId}.${dateString}.jpg`;
  }
  
  const isStale = (activeTime.getTime() - finalImageDate.getTime()) > 60 * 60 * 1000; // > 1h diff
  const isHistorical = (Date.now() - finalImageDate.getTime()) > 60 * 60 * 1000;

  const handleError = () => {
    if (foundInApi) {
      setApiFailed(true);
      setAttemptIdx(0); 
    } else {
      if (attemptIdx < MAX_ATTEMPTS - 1) {
        setAttemptIdx(a => a + 1);
      } else {
        setHasError(true);
      }
    }
  };

  return (
    <div className="webcam-card-container">
      <div className="webcam-header">
        <div className="webcam-header-main">
          <div className="webcam-title-group">
            <h3 className="webcam-title">
              <IonIcon icon={videocamOutline} />
              <span>
                {isHistorical 
                  ? finalImageDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'Live Feed'}
              </span>
            </h3>
            <span className="webcam-location">{locationName}</span>
          </div>
          {!isFuture && (
            <div className="webcam-status-pill">
              <span className={`webcam-live-indicator ${(isStale || isHistorical) && !hasError ? 'stale' : ''}`} style={{ backgroundColor: hasError ? 'red' : undefined }}></span>
              {hasError ? 'OFFLINE' : isStale ? 'STALE' : isHistorical ? 'HISTORY' : 'LIVE'}
            </div>
          )}
        </div>
        {onClose && (
          <IonButton fill="clear" color="medium" onClick={onClose} className="webcam-close-button">
            <IonIcon slot="icon-only" icon={closeOutline} />
          </IonButton>
        )}
      </div>
      
      <div className={`webcam-image-wrapper ${isScrolling ? 'is-scrolling' : ''}`}>
        {isFuture ? (
          <div className="webcam-image-placeholder">
            <div className="placeholder-content">
              <span className="placeholder-text">No Image Available</span>
              <span className="placeholder-subtext">Webcams only show live or historical data</span>
              {onResetToLive && (
                <IonButton 
                  onClick={onResetToLive}
                  className="webcam-reset-button"
                  size="small"
                  mode="ios"
                >
                  <IonIcon slot="start" icon={refreshOutline} />
                  Return to Live
                </IonButton>
              )}
            </div>
          </div>
        ) : !hasError ? (
          <img 
            src={imageUrl} 
            alt={`Webcam feed from ${locationName}`} 
            key={imageUrl}
            className="webcam-image" 
            loading="lazy"
            onError={handleError}
          />
        ) : (
          <div className="webcam-image-placeholder error-state">
            <div className="placeholder-content">
              <IonIcon icon={warningOutline} className="placeholder-icon" style={{ fontSize: '2rem', marginBottom: '8px', opacity: 0.5 }} />
              <span className="placeholder-text">No Image Available</span>
              <span className="placeholder-subtext">No capture found within 12 hours of this time.</span>
              {onResetToLive && (
                <IonButton 
                  onClick={onResetToLive}
                  className="webcam-reset-button"
                  size="small"
                  mode="ios"
                  style={{ marginTop: '12px' }}
                >
                  <IonIcon slot="start" icon={refreshOutline} />
                  Return to Live
                </IonButton>
              )}
            </div>
          </div>
        )}
        {!isFuture && (
          <div className={`webcam-overlay-badge ${isStale && !hasError ? 'stale-badge' : ''}`}>
            <span className="badge-time">
              {isStale && !hasError && <IonIcon icon={warningOutline} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
              {isStale && !hasError ? finalImageDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' : ''}
              {finalImageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="badge-divider">|</span>
            <span className="badge-cam">CAM: {cameraId}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebcamFeedCard;
