import React, { useState, useEffect, useMemo } from 'react';
import {
  IonIcon,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
} from '@ionic/react';
import {
  videocamOutline,
  refreshOutline,
  warningOutline,
  chevronBackOutline,
  chevronForwardOutline,
  timeOutline
} from 'ionicons/icons';
import { WEBCAMS } from '../../constants/webcams';
import './WebcamFeedCard.css';

interface WebcamFeedCardProps {
  locationName: string;
  cameraId: string;
  targetTime: Date;
  isLive: boolean;
  onResetToLive?: () => void;
  onTimeChange?: (time: Date) => void;
  onCameraChange?: (cameraId: string) => void;
  imagery?: Record<string, string>;
  onClose?: () => void;
  loading?: boolean;
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

const FALLBACK_OFFSETS_MINUTES = [
  ...Array.from({ length: 60 }, (_, i) => i),
  ...Array.from({ length: 20 }, (_, i) => 12 * 60 + i),
  ...Array.from({ length: 20 }, (_, i) => 24 * 60 + i),
];

export const WebcamFeedCard: React.FC<WebcamFeedCardProps> = ({
  locationName,
  cameraId,
  targetTime,
  isLive,
  onResetToLive,
  onTimeChange,
  onCameraChange,
  imagery,
  onClose,
  loading = false,
}) => {
  const [attemptIdx, setAttemptIdx] = useState(0);
  const [apiFailed, setApiFailed] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);

  const MAX_ATTEMPTS = FALLBACK_OFFSETS_MINUTES.length;

  // Reset attempts when time, camera, or data-backed imagery changes.
  useEffect(() => {
    setAttemptIdx(0);
    setApiFailed(false);
    setHasError(false);
    setIsImageLoading(true);
  }, [targetTime, cameraId, imagery]);

  const isFuture = (targetTime.getTime() - Date.now()) > 60 * 1000;

  // 1. Try to find image in API response first
  const { imageUrl, finalImageDate, foundInApi } = useMemo(() => {
    let url = '';
    let date = new Date();
    let found = false;

    if (imagery && Object.keys(imagery).length > 0 && !apiFailed) {
      const targetMs = targetTime.getTime();
      const sortedTimes = Object.keys(imagery)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      for (const iso of sortedTimes) {
        const t = new Date(iso).getTime();
        if (t <= targetMs) {
          url = imagery[iso];
          date = new Date(iso);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      const baseDate = getBaseMinute(targetTime);
      const offsetMinutes = FALLBACK_OFFSETS_MINUTES[attemptIdx] || 0;
      date = new Date(baseDate.getTime() - offsetMinutes * 60 * 1000);
      const dateString = formatDateToIsoString(date);
      url = `https://wl.secoora.org/webcam/${cameraId}.${dateString}.jpg`;
    }

    return { imageUrl: url, finalImageDate: date, foundInApi: found };
  }, [imagery, targetTime, cameraId, apiFailed, attemptIdx]);

  const handleError = () => {
    if (foundInApi) {
      setApiFailed(true);
      setAttemptIdx(0);
    } else {
      if (attemptIdx < MAX_ATTEMPTS - 1) {
        setAttemptIdx(a => a + 1);
      } else {
        setHasError(true);
        setIsImageLoading(false);
      }
    }
  };

  const handleLoad = () => {
    setIsImageLoading(false);
  };

  const shiftTime = (hours: number) => {
    if (!onTimeChange) return;
    const newTime = new Date(targetTime.getTime() + hours * 3600 * 1000);
    // Don't go into the future more than 5 mins
    if (newTime.getTime() > Date.now() + 300000) {
      onResetToLive?.();
    } else {
      onTimeChange(newTime);
    }
  };

  return (
    <div className={`webcam-card-container premium-card ${loading ? 'is-loading' : ''}`}>
      <div className="webcam-header">
        <div className="webcam-header-main">
          <div className="webcam-title-group">
            <h3 className="webcam-title">
              <IonIcon icon={videocamOutline} className="title-icon" />
              {loading ? (
                <IonSkeletonText animated style={{ width: '150px', height: '24px', borderRadius: '4px', margin: '0 8px' }} />
              ) : (
                <IonSelect
                  value={cameraId}
                  interface="popover"
                  className="camera-selector"
                  onIonChange={e => onCameraChange?.(e.detail.value)}
                >
                  {WEBCAMS.map(cam => (
                    <IonSelectOption key={cam.id} value={cam.id}>
                      {cam.name}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              )}
            </h3>
          </div>

          <div className="webcam-header-actions">
            {loading ? (
              <IonSkeletonText animated style={{ width: '80px', height: '24px', borderRadius: '12px' }} />
            ) : (
              <div className={`webcam-status-pill ${isLive ? 'live' : 'history'}`}>
                <span className="pulse-dot"></span>
                {hasError ? 'OFFLINE' : isLive ? 'LIVE' : 'HISTORICAL'}
              </div>
            )}
            {onClose && !loading && (
              <IonButton fill="clear" color="light" onClick={onClose} className="webcam-close-btn">
                <span style={{ fontSize: '20px' }}>×</span>
              </IonButton>
            )}
          </div>
        </div>
      </div>
      
      <div className="webcam-image-container">
        <div className="webcam-aspect-ratio-box">
          {(loading || (isImageLoading && !hasError && !isFuture)) && (
            <div className="skeleton-overlay">
              <IonSkeletonText animated style={{ width: '100%', height: '100%', margin: 0 }} />
            </div>
          )}

          {!loading && (
            <>
              {isFuture ? (
                <div className="webcam-placeholder-glass">
                  <IonIcon icon={timeOutline} className="placeholder-icon" />
                  <h4>Future Forecast</h4>
                  <p>Visual feed is only available for live or historical data.</p>
                  <IonButton fill="outline" color="light" size="small" onClick={onResetToLive}>
                    <IonIcon slot="start" icon={refreshOutline} />
                    Back to Live
                  </IonButton>
                </div>
              ) : !hasError ? (
                <img
                  src={imageUrl}
                  alt={`Webcam feed from ${locationName}`}
                  className={`webcam-image ${isImageLoading ? 'loading' : 'loaded'}`}
                  onLoad={handleLoad}
                  onError={handleError}
                />
              ) : (
                <div className="webcam-placeholder-glass">
                  <IonIcon icon={warningOutline} color="warning" className="placeholder-icon" />
                  <h4>Feed Offline</h4>
                  <p>Unable to retrieve image for this timestamp.</p>
                </div>
              )}

              {/* Time Navigation Overlays */}
              {!isFuture && (
                <>
                  <div className="webcam-nav-overlay left">
                    <IonButton fill="clear" className="nav-fab" onClick={() => shiftTime(-1)} aria-label="Previous hour">
                      <IonIcon icon={chevronBackOutline} />
                    </IonButton>
                  </div>

                  {!isLive && (
                    <div className="webcam-nav-overlay right">
                      <IonButton fill="clear" className="nav-fab" onClick={() => shiftTime(1)} aria-label="Next hour">
                        <IonIcon icon={chevronForwardOutline} />
                      </IonButton>
                    </div>
                  )}

                  {!isLive && (
                    <IonButton
                      className="jump-to-live-btn"
                      size="small"
                      onClick={onResetToLive}
                    >
                      <IonIcon slot="start" icon={refreshOutline} />
                      Jump to Live
                    </IonButton>
                  )}

                  <div className="webcam-timestamp-badge">
                    <span className="timestamp-text">
                      {finalImageDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      <span className="separator">•</span>
                      {finalImageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WebcamFeedCard;
