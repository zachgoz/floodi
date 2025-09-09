import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonDatetime,
  IonGrid,
  IonRow,
  IonCol,
  IonItem,
  IonLabel,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonNote,
  IonIcon,
} from '@ionic/react';
import { timeOutline } from 'ionicons/icons';
import { formatTimeRangeForDisplay, validateChartTimeRange } from 'src/utils/timeRangeHelpers';
import 'src/components/comments/styles/Comments.css';

/**
 * TimeRangePicker
 *
 * A comprehensive time range picker that integrates with chart time domains
 * to assist users in selecting a time interval for comments. Supports multiple
 * modes: current view, custom range, around point (duration), and preset durations.
 * Also includes event type selection.
 *
 * Usage:
 * <TimeRangePicker
 *   initialRange={{ start: isoString, end: isoString }}
 *   chartDomain={{ start: isoStart, end: isoEnd }}
 *   stationId={stationId}
 *   onChange={(r) => setRange(r)}
 * />
 */

export type TimeRangeMode = 'current-view' | 'custom-range' | 'around-point' | 'preset-durations';

export type CommentEventType = 'threshold-crossing' | 'surge-event' | 'normal-tide';

export interface TimeRange {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface TimeRangePickerProps {
  initialRange?: TimeRange;
  chartDomain?: TimeRange; // current chart domain [start, end]
  /** Callback invoked whenever the selected range or event type changes and is valid */
  onChange?: (payload: { range: TimeRange; eventType: CommentEventType }) => void;
}

const PRESETS: Array<{ key: string; label: string; minutes: number }> = [
  { key: '15m', label: '15 min', minutes: 15 },
  { key: '1h', label: '1 hr', minutes: 60 },
  { key: '6h', label: '6 hr', minutes: 360 },
  { key: '24h', label: '24 hr', minutes: 1440 },
];

function clampToDomain(range: TimeRange, domain?: TimeRange): TimeRange | undefined {
  if (!domain) return range;
  const s = new Date(range.start).getTime();
  const e = new Date(range.end).getTime();
  const ds = new Date(domain.start).getTime();
  const de = new Date(domain.end).getTime();
  const clampedStartMs = Math.max(s, ds);
  const clampedEndMs = Math.min(e, de);
  if (Number.isNaN(clampedStartMs) || Number.isNaN(clampedEndMs)) return undefined;
  if (clampedStartMs > clampedEndMs) return undefined; // non-overlapping
  return { start: new Date(clampedStartMs).toISOString(), end: new Date(clampedEndMs).toISOString() };
}

export const TimeRangePicker: React.FC<TimeRangePickerProps> = ({ initialRange, chartDomain, onChange }) => {
  const [mode, setMode] = useState<TimeRangeMode>('current-view');
  const [eventType, setEventType] = useState<CommentEventType>('normal-tide');

  // custom-range state
  const [customStart, setCustomStart] = useState<string | undefined>(initialRange?.start);
  const [customEnd, setCustomEnd] = useState<string | undefined>(initialRange?.end);

  // around-point state
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const [center, setCenter] = useState<string>(initialRange?.start ?? nowIso);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);

  // preset state
  const [presetKey, setPresetKey] = useState<string>('1h');

  const computedRange: TimeRange | undefined = useMemo(() => {
    try {
      if (mode === 'current-view' && chartDomain) {
        return { ...chartDomain };
      }
      if (mode === 'custom-range' && customStart && customEnd) {
        const s = new Date(customStart).toISOString();
        const e = new Date(customEnd).toISOString();
        return s <= e ? { start: s, end: e } : { start: e, end: s };
      }
      if (mode === 'around-point' && center) {
        const c = new Date(center).getTime();
        const half = (durationMinutes * 60 * 1000) / 2;
        return { start: new Date(c - half).toISOString(), end: new Date(c + half).toISOString() };
      }
      if (mode === 'preset-durations') {
        const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[1];
        const c = new Date(center).getTime();
        const half = (preset.minutes * 60 * 1000) / 2;
        return { start: new Date(c - half).toISOString(), end: new Date(c + half).toISOString() };
      }
      return initialRange ?? chartDomain;
    } catch {
      return undefined;
    }
  }, [mode, chartDomain, customStart, customEnd, center, durationMinutes, presetKey, initialRange]);

  const [error, setError] = useState<string>('');

  const validate = useCallback(
    (range?: TimeRange) => {
      if (!range) return 'Please select a valid time range.';
      try {
        const result = validateChartTimeRange(range, chartDomain);
        if (result && typeof result === 'object' && 'valid' in result) {
          return (result as any).valid ? '' : (result as any).message ?? 'Invalid time range.';
        }
        // If helper returns boolean
        if (result === true) return '';
        return typeof result === 'string' ? result : 'Invalid time range.';
      } catch {
        return '';
      }
    },
    [chartDomain]
  );

  useEffect(() => {
    const msg = validate(computedRange);
    setError(msg);
    if (!msg && computedRange && onChange) {
      const clamped = clampToDomain(computedRange, chartDomain);
      if (clamped) {
        onChange({ range: clamped, eventType });
      } else {
        setError('Selected range is outside the available domain.');
      }
    }
  }, [computedRange, eventType, chartDomain, onChange, validate]);

  const preview = useMemo(() => {
    if (!computedRange) return '';
    try {
      return formatTimeRangeForDisplay(computedRange);
    } catch {
      const s = new Date(computedRange.start).toLocaleString();
      const e = new Date(computedRange.end).toLocaleString();
      return `${s} – ${e}`;
    }
  }, [computedRange]);

  return (
    <IonCard className="comments-card comments-range-picker" aria-label="Time range picker">
      <IonCardHeader>
        <IonCardTitle>
          <IonIcon icon={timeOutline} style={{ verticalAlign: 'text-bottom' }} /> Select Time Range
        </IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <IonGrid>
          <IonRow>
            <IonCol size="12">
              <IonSegment
                value={mode}
                onIonChange={(e) => setMode(e.detail.value as TimeRangeMode)}
                aria-label="Time range selection mode"
              >
                <IonSegmentButton value="current-view">Current View</IonSegmentButton>
                <IonSegmentButton value="custom-range">Custom</IonSegmentButton>
                <IonSegmentButton value="around-point">Around Point</IonSegmentButton>
                <IonSegmentButton value="preset-durations">Presets</IonSegmentButton>
              </IonSegment>
            </IonCol>
          </IonRow>

          {mode === 'custom-range' && (
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Start</IonLabel>
                  <IonDatetime
                    value={customStart}
                    onIonChange={(e) => setCustomStart(e.detail.value as string)}
                    presentation="date-time"
                    aria-label="Start date time"
                  />
                </IonItem>
              </IonCol>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">End</IonLabel>
                  <IonDatetime
                    value={customEnd}
                    onIonChange={(e) => setCustomEnd(e.detail.value as string)}
                    presentation="date-time"
                    aria-label="End date time"
                  />
                </IonItem>
              </IonCol>
            </IonRow>
          )}

          {mode === 'around-point' && (
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Center</IonLabel>
                  <IonDatetime
                    value={center}
                    onIonChange={(e) => setCenter((e.detail.value as string) ?? nowIso)}
                    presentation="date-time"
                    aria-label="Center date time"
                  />
                </IonItem>
              </IonCol>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Duration (minutes)</IonLabel>
                  <IonRange
                    min={5}
                    max={720}
                    step={5}
                    value={durationMinutes}
                    onIonChange={(e) => setDurationMinutes(Number(e.detail.value))}
                    aria-label="Duration in minutes"
                  >
                    <IonLabel slot="start">5</IonLabel>
                    <IonLabel slot="end">720</IonLabel>
                  </IonRange>
                </IonItem>
              </IonCol>
            </IonRow>
          )}

          {mode === 'preset-durations' && (
            <IonRow>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Center</IonLabel>
                  <IonDatetime
                    value={center}
                    onIonChange={(e) => setCenter((e.detail.value as string) ?? nowIso)}
                    presentation="date-time"
                    aria-label="Center date time"
                  />
                </IonItem>
              </IonCol>
              <IonCol size="12" sizeMd="6">
                <IonItem>
                  <IonLabel position="stacked">Preset Duration</IonLabel>
                  <IonSelect
                    value={presetKey}
                    onIonChange={(e) => setPresetKey(e.detail.value as string)}
                    aria-label="Preset duration"
                  >
                    {PRESETS.map((p) => (
                      <IonSelectOption key={p.key} value={p.key}>
                        {p.label}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              </IonCol>
            </IonRow>
          )}

          <IonRow>
            <IonCol size="12" sizeMd="6">
              <IonItem>
                <IonLabel position="stacked">Event Type</IonLabel>
                <IonSelect
                  value={eventType}
                  onIonChange={(e) => setEventType(e.detail.value as CommentEventType)}
                  aria-label="Event type"
                >
                  <IonSelectOption value="threshold-crossing">Threshold crossing</IonSelectOption>
                  <IonSelectOption value="surge-event">Surge event</IonSelectOption>
                  <IonSelectOption value="normal-tide">Normal tide</IonSelectOption>
                </IonSelect>
              </IonItem>
            </IonCol>
            <IonCol size="12" sizeMd="6">
              <div className="comments-range-preview" role="status" aria-live="polite">
                <IonLabel>
                  <strong>Preview:</strong> {preview}
                </IonLabel>
                {!!error && (
                  <IonNote color="danger" className="comments-error-text">
                    {error}
                  </IonNote>
                )}
                <div className="comments-mini-timeline" aria-hidden="true">
                  <div className="axis" />
                  {chartDomain && computedRange && (
                    <MiniTimelineBar domain={chartDomain} range={computedRange} />
                  )}
                </div>
              </div>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonCardContent>
    </IonCard>
  );
};

const MiniTimelineBar: React.FC<{ domain: TimeRange; range: TimeRange }> = ({ domain, range }) => {
  const ds = new Date(domain.start).getTime();
  const de = new Date(domain.end).getTime();
  const rs = new Date(range.start).getTime();
  const re = new Date(range.end).getTime();
  const width = Math.max(0, de - ds) || 1;
  const leftPct = Math.max(0, Math.min(1, (rs - ds) / width)) * 100;
  const rightPct = Math.max(0, Math.min(1, (re - ds) / width)) * 100;
  const spanPct = Math.max(1, rightPct - leftPct);
  return <div className="bar" style={{ left: `${leftPct}%`, width: `${spanPct}%` }} />;
};

export default TimeRangePicker;
