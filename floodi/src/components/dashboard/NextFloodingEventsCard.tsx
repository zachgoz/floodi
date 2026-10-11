import React, { useMemo, useState } from 'react';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSkeletonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { chevronForwardOutline, closeOutline, timeOutline, water } from 'ionicons/icons';
import type { FloodEvent } from 'src/types/data';
import type { Point, WindPoint, PrecipPoint, AppConfiguration } from 'src/components/Tab2/types';
import {
  getFloodSeverityColor,
  getFloodSeverityForLevel,
  getFloodSeverityLabel,
  type FloodSeverity,
} from 'src/utils/floodSeverity';
import { ViewingTimePill } from './ViewingTimePill';
import { HydrologicalInsightContent } from './HydrologicalInsightContent';
import { useSimilarFloodEvents } from './useSimilarFloodEvents';
import { ChartInfo } from './ChartInfo';
import './NextFloodingEventsCard.css';
import { floodWindows, inundation, eventDate, eventWindow, LOCAL_ZONE, type StreetCalibration } from 'src/utils/waterForecast';

interface UpcomingFloodEvent {
  id: string;
  startTime: Date;
  endTime: Date | null;
  startClipped: boolean;
  peakTime: Date;
  peakValue: number;
  thresholdType: FloodSeverity;
  duration: string;
}

interface NextFloodingEventsCardProps {
  adjustedPoints: Point[];
  predictedPoints: Point[];
  windPoints: WindPoint[];
  precipPoints: PrecipPoint[];
  floodEvents?: FloodEvent[];
  thresholds: AppConfiguration['thresholds'];
  now: Date;
  onTimeChange: (time: Date) => void;
  loading?: boolean;
  streetCalibration?: StreetCalibration;
  forecastHorizon?: Date | null;
  upperForecastPoints?: Point[];
}

const MAX_EVENTS = 5;
const INITIAL_VISIBLE_EVENTS = 2;

function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: LOCAL_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(start: Date, end: Date): string {
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const hours = Math.floor(durationMs / 3600_000);
  const mins = Math.round((durationMs % 3600_000) / 60_000);
  if (hours <= 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function floodWindowLabel(event: UpcomingFloodEvent, now: Date): string {
  if (!event.startClipped) return eventWindow(event.startTime, event.endTime);
  const status = event.startTime <= now ? 'Flooding now' : 'Start unavailable';
  if (!event.endTime) return `${status} · End unavailable`;
  const sameDate = eventDate(event.startTime) === eventDate(event.endTime);
  const end = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_ZONE, hour:'numeric', minute:'2-digit',
    ...(!sameDate ? { weekday:'short', month:'short', day:'numeric' } as const : {}),
  }).format(event.endTime);
  return `${status} · Until ${end}`;
}

function nearestPoint<T extends { t: Date }>(points: T[], time: Date): T | null {
  if (points.length === 0) return null;
  return points.reduce((best, point) => (
    Math.abs(point.t.getTime() - time.getTime()) < Math.abs(best.t.getTime() - time.getTime()) ? point : best
  ));
}

function buildUpcomingFloodEvents(
  points: Point[],
  thresholds: AppConfiguration['thresholds'],
  now: Date
): UpcomingFloodEvent[] {
  return floodWindows(points, thresholds.minor)
    .filter(event => (event.endTime || event.lastSampleTime) > now)
    .map(event => ({
      ...event,
      id: event.startTime.toISOString(),
      thresholdType: getFloodSeverityForLevel(event.peakValue, thresholds) || 'minor' as FloodSeverity,
      duration: event.endTime ? formatDuration(event.startTime, event.endTime) : 'End unavailable',
    }))
    .slice(0, MAX_EVENTS);
}

export const NextFloodingEventsCard: React.FC<NextFloodingEventsCardProps> = ({
  adjustedPoints,
  predictedPoints,
  windPoints,
  precipPoints,
  floodEvents,
  thresholds,
  now,
  onTimeChange,
  loading = false,
  streetCalibration,
  forecastHorizon,
  upperForecastPoints = [],
}) => {
  const [selectedEvent, setSelectedEvent] = useState<UpcomingFloodEvent | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const forecastPoints = adjustedPoints.length > 0 ? adjustedPoints : predictedPoints;
  const forecastAvailable = useMemo(() => {
    const times = [...new Set(forecastPoints
      .filter(point => Number.isFinite(+point.t) && Number.isFinite(point.v))
      .map(point => +point.t))];
    return times.length >= 2 && times.some(time => time > +now);
  }, [forecastPoints, now]);
  const upcomingEvents = useMemo(
    () => buildUpcomingFloodEvents(forecastPoints, thresholds, now),
    [forecastPoints, thresholds, now]
  );
  const visibleEvents = showAllEvents ? upcomingEvents : upcomingEvents.slice(0, INITIAL_VISIBLE_EVENTS);
  const floodPossible = useMemo(() => buildUpcomingFloodEvents(upperForecastPoints, thresholds, now).length > 0, [upperForecastPoints, thresholds, now]);
  const hiddenEventCount = Math.max(0, upcomingEvents.length - visibleEvents.length);
  const similarEvents = useSimilarFloodEvents(floodEvents, selectedEvent?.peakValue ?? null, now);
  const selectedWind = selectedEvent ? nearestPoint(windPoints, selectedEvent.peakTime) : null;
  const selectedPrecip = selectedEvent ? nearestPoint(precipPoints, selectedEvent.peakTime) : null;
  const hasStreetCalibration = inundation(0, thresholds.minor, 'MLLW', streetCalibration).label === 'Max Street Inundation';
  const selectedColor = getFloodSeverityColor(selectedEvent?.thresholdType ?? null);

  const handleSimilarSelect = (event: FloodEvent) => {
    const peakTime = new Date(event.peakTime);
    onTimeChange(peakTime);
    setSelectedEvent(null);
  };

  return (
    <IonCard className="next-flood-card">
      <IonCardHeader>
        <IonCardTitle>Next Flooding Events</IonCardTitle>
        <ChartInfo label="About street flooding estimates">
          <p>{hasStreetCalibration ? 'Maximum estimated depth above the calibrated street elevation, using the forecast peak.' : 'Max Street Flooding is an estimate using water above the flood threshold. Street elevations have not been calibrated; actual depth varies by street.'}</p>
          {upperForecastPoints.length > 1 && <p>Flooding is possible when the historical error bound crosses flood stage, even if the central forecast remains lower. These bounds are not a calibrated probability; recorded backtests include missed events.</p>}
        </ChartInfo>
      </IonCardHeader>
      <IonCardContent className="next-flood-content">
        {forecastHorizon && !loading && <p className="forecast-caption">Forecast through {formatDateTime(forecastHorizon)} ET</p>}
        {loading ? (
          <IonList className="next-flood-list" lines="none">
            {[1, 2].map((i) => (
              <IonItem key={i} className="next-flood-item skeleton">
                <div className="flood-timeline-slot" slot="start">
                  <span className="flood-timeline-line" aria-hidden="true" />
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(var(--ion-text-color-rgb, 0,0,0), 0.1)' }} />
                </div>
                <IonLabel>
                  <h3><IonSkeletonText animated style={{ width: '60%' }} /></h3>
                  <p><IonSkeletonText animated style={{ width: '80%' }} /></p>
                  <p><IonSkeletonText animated style={{ width: '40%' }} /></p>
                </IonLabel>
                <div slot="end" style={{ width: '60px', height: '20px', borderRadius: '4px', background: 'rgba(var(--ion-text-color-rgb, 0,0,0), 0.1)' }} />
              </IonItem>
            ))}
          </IonList>
        ) : upcomingEvents.length > 0 ? (

          <>
            <IonList className="next-flood-list" lines="none">
              {visibleEvents.map((event, index) => {
                const severityColor = getFloodSeverityColor(event.thresholdType);
                return (
                  <IonItem
                    key={event.id}
                    button
                    detail={false}
                    className="next-flood-item"
                    style={{ '--event-color': severityColor } as React.CSSProperties}
                    onClick={() => setSelectedEvent(event)}
                  >
                    <div className="flood-timeline-slot" slot="start">
                      <span className="flood-timeline-line" aria-hidden="true" />
                      <IonBadge className="flood-timeline-badge">{index + 1}</IonBadge>
                    </div>
                    <IonLabel className="ion-text-wrap">
                      <h3>{eventDate(event.startTime)}</h3>
                      <p className="event-flood-window">{floodWindowLabel(event, now)}</p>
                      <div className="event-level-metrics">
                        <div><span>Peak Water Level</span><strong>{event.peakValue.toFixed(2)} <small>ft</small></strong></div>
                        <div><span>Max Street Flooding{!hasStreetCalibration && <sup aria-label="Estimated">*</sup>}</span><strong>{inundation(event.peakValue, thresholds.minor, 'MLLW', streetCalibration).inches.toFixed(1)} <small>in</small></strong></div>
                      </div>
                    </IonLabel>
                    <IonBadge className="severity-badge" slot="end">
                      {getFloodSeverityLabel(event.thresholdType)}
                    </IonBadge>
                    <IonIcon icon={chevronForwardOutline} slot="end" className="next-flood-chevron" />
                  </IonItem>
                );
              })}
            </IonList>
            {upcomingEvents.length > INITIAL_VISIBLE_EVENTS && (
              <IonButton
                expand="block"
                fill="clear"
                size="small"
                className="next-flood-view-more"
                onClick={() => setShowAllEvents(value => !value)}
              >
                {showAllEvents ? 'Show fewer' : `View ${hiddenEventCount} more`}
              </IonButton>
            )}
          </>
        ) : (
          <div className="next-flood-empty">
            <div className="next-flood-empty-icon">
              <IonIcon icon={water} />
            </div>
            <h3>{floodPossible ? 'Flooding possible' : forecastAvailable ? 'No flooding predicted' : 'Forecast unavailable'}</h3>
            <p>{floodPossible ? 'Within the forecast error range.' : forecastAvailable ? 'No threshold exceedance in the available forecast.' : 'Waiting for water level predictions.'}</p>
          </div>
        )}
      </IonCardContent>

      <IonModal
        isOpen={Boolean(selectedEvent)}
        onDidDismiss={() => setSelectedEvent(null)}
        className="datum-info-modal next-flood-modal"
        breakpoints={[0, 0.5, 1.0]}
        initialBreakpoint={1.0}
        handle={true}
      >
        <IonHeader className="ion-no-border">
          <IonToolbar>
            <IonTitle>
              <div className="insight-modal-title is-historical">
                <span>Flood Insight</span>
                <ViewingTimePill time={selectedEvent?.peakTime} fallbackLabel="Forecast" />
              </div>
            </IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setSelectedEvent(null)}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          {selectedEvent && (
            <HydrologicalInsightContent
              precipitationAccumulation={selectedPrecip?.value ?? 0}
              windSpeed={selectedWind?.speed ?? 0}
              windDirection={selectedWind?.dir ?? 0}
              targetTime={selectedEvent.peakTime}
              isLive={false}
              observedWaterLevel={selectedEvent.peakValue}
              source="FloodCast"
              fullSource="FloodCast Water Level"
              sourceId="floodcast"
              prediction={selectedEvent.peakValue}
              viewMode="advanced"
              thresholds={thresholds}
              floodStartTime={selectedEvent.startTime}
              floodEndTime={selectedEvent.endTime ?? undefined}
              floodDuration={selectedEvent.duration}
              maxRoadFloodDepth={Math.max(0, selectedEvent.peakValue - thresholds.minor)}
              maxWaterLevel={selectedEvent.peakValue}
              maxWaterLevelTime={selectedEvent.peakTime}
              statusLabel="Predicted"
              onClose={() => setSelectedEvent(null)}
            >
              <div className="similar-events-section">
                <div className="similar-events-header">
                  <IonIcon icon={timeOutline} />
                  <h3>View Similar Past Events</h3>
                </div>
                {similarEvents.length > 0 ? (
                  <div className="similar-events-actions">
                    {similarEvents.map(event => (
                      <IonButton
                        key={`${event.peakTime}-${event.peakValue}`}
                        expand="block"
                        fill="outline"
                        className="similar-event-button"
                        style={{ '--event-color': selectedColor } as React.CSSProperties}
                        onClick={() => handleSimilarSelect(event)}
                      >
                        {formatDateTime(new Date(event.peakTime))} - {event.peakValue.toFixed(2)}'
                      </IonButton>
                    ))}
                  </div>
                ) : (
                  <p className="similar-events-empty">No historical flood peaks within 1 inch of this forecast peak.</p>
                )}
              </div>
            </HydrologicalInsightContent>
          )}
        </IonContent>
      </IonModal>
    </IonCard>
  );
};

export default NextFloodingEventsCard;
