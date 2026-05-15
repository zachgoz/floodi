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
import './NextFloodingEventsCard.css';

interface UpcomingFloodEvent {
  id: string;
  startTime: Date;
  endTime: Date;
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
}

const EVENT_WINDOW_DAYS = 14;
const MAX_EVENTS = 5;
const INITIAL_VISIBLE_EVENTS = 2;

function formatDateTime(date: Date): string {
  return date.toLocaleString([], {
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
  const windowEnd = new Date(now.getTime() + EVENT_WINDOW_DAYS * 24 * 3600_000);
  const sorted = points
    .filter(point => point.t >= now && point.t <= windowEnd)
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  const events: UpcomingFloodEvent[] = [];
  let active: { startTime: Date; peakTime: Date; peakValue: number } | null = null;

  for (const point of sorted) {
    const isFlooding = point.v >= thresholds.minor;
    if (isFlooding && !active) {
      active = { startTime: point.t, peakTime: point.t, peakValue: point.v };
      continue;
    }

    if (isFlooding && active) {
      if (point.v > active.peakValue) {
        active.peakTime = point.t;
        active.peakValue = point.v;
      }
      continue;
    }

    if (!isFlooding && active) {
      const severity = getFloodSeverityForLevel(active.peakValue, thresholds);
      if (severity) {
        events.push({
          id: `${active.startTime.toISOString()}-${active.peakTime.toISOString()}`,
          startTime: active.startTime,
          endTime: point.t,
          peakTime: active.peakTime,
          peakValue: active.peakValue,
          thresholdType: severity,
          duration: formatDuration(active.startTime, point.t),
        });
      }
      active = null;
    }
  }

  if (active) {
    const severity = getFloodSeverityForLevel(active.peakValue, thresholds);
    if (severity) {
      events.push({
        id: `${active.startTime.toISOString()}-${active.peakTime.toISOString()}`,
        startTime: active.startTime,
        endTime: windowEnd,
        peakTime: active.peakTime,
        peakValue: active.peakValue,
        thresholdType: severity,
        duration: formatDuration(active.startTime, windowEnd),
      });
    }
  }

  return events
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
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
}) => {
  const [selectedEvent, setSelectedEvent] = useState<UpcomingFloodEvent | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const forecastPoints = adjustedPoints.length > 0 ? adjustedPoints : predictedPoints;
  const upcomingEvents = useMemo(
    () => buildUpcomingFloodEvents(forecastPoints, thresholds, now),
    [forecastPoints, thresholds, now]
  );
  const visibleEvents = showAllEvents ? upcomingEvents : upcomingEvents.slice(0, INITIAL_VISIBLE_EVENTS);
  const hiddenEventCount = Math.max(0, upcomingEvents.length - visibleEvents.length);
  const similarEvents = useSimilarFloodEvents(floodEvents, selectedEvent?.peakValue ?? null, now);
  const selectedWind = selectedEvent ? nearestPoint(windPoints, selectedEvent.peakTime) : null;
  const selectedPrecip = selectedEvent ? nearestPoint(precipPoints, selectedEvent.peakTime) : null;
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
      </IonCardHeader>
      <IonCardContent className="next-flood-content">
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
                    <IonLabel>
                      <h3>{formatDateTime(event.startTime)}</h3>
                      <p>Peak {event.peakValue.toFixed(2)} ft at {formatDateTime(event.peakTime)}</p>
                      <p>{event.duration} above flood stage</p>
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
            <h3>No flooding predicted</h3>
            <p>No flood-stage water levels are forecast in the next 14 days.</p>
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
              floodEndTime={selectedEvent.endTime}
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
