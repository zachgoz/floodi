import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { trackWebcamChange, trackWebcamTimeShift } from 'src/lib/analytics';
import { getImageUrl } from 'src/lib/dataService';
import { formatWebcamCaptureTime, webcamFrameStatus } from './webcamFreshness';
import { buildWebcamCandidates, shouldUseSecooraGuessFallback } from './webcamCandidates';

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
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const MAX_ATTEMPTS = FALLBACK_OFFSETS_MINUTES.length;
  const isFuture = (targetTime.getTime() - Date.now()) > 60 * 1000;

  const apiCandidates = useMemo(
    () => buildWebcamCandidates(imagery, targetTime, { now: new Date(), allowAfterMs: isLive ? 0 : 60 * 60_000 }),
    [imagery, targetTime, isLive],
  );
  const allowSecooraGuess = useMemo(
    () => shouldUseSecooraGuessFallback(targetTime, clock),
    [targetTime, clock],
  );

  // Bind candidate cursor to the active target/camera/imagery scope so stale indices
  // from a previous timestamp can never leak into a new lookup.
  const scopeKey = useMemo(
    () => `${targetTime.getTime()}|${cameraId}|${apiCandidates.map(c => c.rawUrl).join('|')}`,
    [targetTime, cameraId, apiCandidates],
  );
  const [navState, setNavState] = useState({
    scopeKey,
    apiCandidateIdx: 0,
    attemptIdx: 0,
    hasError: false,
  });
  const activeNav = navState.scopeKey === scopeKey
    ? navState
    : { scopeKey, apiCandidateIdx: 0, attemptIdx: 0, hasError: false };
  const { apiCandidateIdx, attemptIdx, hasError } = activeNav;

  // 1. Walk ordered API/archived candidates first, then recent SECOORA minute guesses.
  const { rawImageUrl, finalImageDate, usingApiCandidate } = useMemo(() => {
    if (apiCandidateIdx < apiCandidates.length) {
      const candidate = apiCandidates[apiCandidateIdx];
      return {
        rawImageUrl: candidate.rawUrl,
        finalImageDate: candidate.date,
        usingApiCandidate: true,
      };
    }

    if (allowSecooraGuess && attemptIdx < MAX_ATTEMPTS) {
      const baseDate = getBaseMinute(targetTime);
      const offsetMinutes = FALLBACK_OFFSETS_MINUTES[attemptIdx] || 0;
      const date = new Date(baseDate.getTime() - offsetMinutes * 60 * 1000);
      const dateString = formatDateToIsoString(date);
      return {
        rawImageUrl: `https://wl.secoora.org/webcam/${cameraId}.${dateString}.jpg`,
        finalImageDate: date,
        usingApiCandidate: false,
      };
    }

    return {
      rawImageUrl: '',
      finalImageDate: targetTime,
      usingApiCandidate: false,
    };
  }, [apiCandidates, apiCandidateIdx, allowSecooraGuess, attemptIdx, MAX_ATTEMPTS, targetTime, cameraId]);

  const advanceCandidate = useCallback(() => {
    setNavState(prev => {
      const curr = prev.scopeKey === scopeKey
        ? prev
        : { scopeKey, apiCandidateIdx: 0, attemptIdx: 0, hasError: false };

      if (curr.apiCandidateIdx < apiCandidates.length) {
        if (curr.apiCandidateIdx + 1 < apiCandidates.length) {
          return { ...curr, apiCandidateIdx: curr.apiCandidateIdx + 1 };
        }
        if (allowSecooraGuess) {
          return { ...curr, apiCandidateIdx: apiCandidates.length, attemptIdx: 0 };
        }
        return { ...curr, hasError: true };
      }

      if (allowSecooraGuess && curr.attemptIdx < MAX_ATTEMPTS - 1) {
        return { ...curr, attemptIdx: curr.attemptIdx + 1 };
      }
      return { ...curr, hasError: true };
    });
  }, [scopeKey, apiCandidates.length, allowSecooraGuess, MAX_ATTEMPTS]);

  // Resolve storage:// URIs via Firebase Storage with stale-request cancellation.
  useEffect(() => {
    if (isFuture || loading) return;
    if (!rawImageUrl) {
      setResolvedUrl('');
      setNavState(prev => ({
        ...(prev.scopeKey === scopeKey ? prev : { scopeKey, apiCandidateIdx: 0, attemptIdx: 0 }),
        hasError: true,
      }));
      setIsImageLoading(false);
      return;
    }

    if (!rawImageUrl.startsWith('storage://')) {
      setResolvedUrl(rawImageUrl);
      setIsImageLoading(true);
      return;
    }

    let cancelled = false;
    setResolvedUrl('');
    setIsImageLoading(true);

    void getImageUrl(rawImageUrl).then(url => {
      if (cancelled) return;
      if (url) {
        setResolvedUrl(url);
      } else {
        advanceCandidate();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rawImageUrl, isFuture, loading, scopeKey, advanceCandidate]);

  const frameStatus = webcamFrameStatus(finalImageDate, clock, isLive);

  const handleError = () => {
    if (!usingApiCandidate && (!allowSecooraGuess || attemptIdx >= MAX_ATTEMPTS - 1)) {
      setIsImageLoading(false);
    }
    advanceCandidate();
  };

  const handleLoad = () => {
    setIsImageLoading(false);
  };

  const shiftTime = (hours: number) => {
    if (!onTimeChange) return;
    trackWebcamTimeShift(hours, cameraId);
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
                  aria-label="Webcam location"
                  value={cameraId}
                  interface="popover"
                  className="camera-selector"
                  onIonChange={e => {
                    const val = e.detail.value;
                    onCameraChange?.(val);
                    const name = WEBCAMS.find(c => c.id === val)?.name || val;
                    trackWebcamChange(val, name);
                  }}
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
              <div className={`webcam-status-pill ${frameStatus.stale ? 'stale' : 'history'}`} role="status">
                {hasError ? 'Image unavailable' : isFuture ? 'Future time' : isImageLoading ? 'Loading image' : frameStatus.label}
              </div>
            )}
            {onClose && !loading && (
              <IonButton fill="clear" color="light" onClick={onClose} className="webcam-close-btn" aria-label="Close webcam">
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
                resolvedUrl ? (
                  <img
                    src={resolvedUrl}
                    alt={`${locationName}, captured ${formatWebcamCaptureTime(finalImageDate)}`}
                    className={`webcam-image ${isImageLoading ? 'loading' : 'loaded'}`}
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                ) : null
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

                  {!hasError && !isImageLoading && <div className="webcam-timestamp-badge">
                    <span className="timestamp-text">
                      {formatWebcamCaptureTime(finalImageDate)}
                      <span className="separator">•</span>
                      {frameStatus.age}
                    </span>
                  </div>}
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
