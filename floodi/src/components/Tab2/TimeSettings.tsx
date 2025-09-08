import React from 'react';
import {
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonDatetime,
  IonIcon,
} from '@ionic/react';
import { calendarOutline } from 'ionicons/icons';
import type { TimeRange } from './types';

/**
 * Props for the TimeSettings component
 */
interface TimeSettingsProps {
  /** Current time range configuration */
  timeRange: TimeRange;
  /** Callback when time range configuration changes */
  onTimeRangeChange: (config: Partial<TimeRange>) => void;
  /** Current timezone setting */
  timezone: 'local' | 'gmt';
  /** Callback when timezone changes */
  onTimezoneChange: (timezone: 'local' | 'gmt') => void;
}

/**
 * Professional time settings component for managing time ranges and timezone
 * 
 * Provides controls for switching between relative (rolling window) and absolute
 * (fixed dates) time ranges, along with timezone selection.
 * 
 * @param props TimeSettingsProps
 * @returns JSX.Element
 */
export const TimeSettings: React.FC<TimeSettingsProps> = ({
  timeRange,
  onTimeRangeChange,
  timezone,
  onTimezoneChange,
}) => {
  /**
   * Handle time range mode changes
   */
  const handleModeChange = (event: CustomEvent) => {
    const mode = event.detail.value as 'relative' | 'absolute';
    onTimeRangeChange({ mode });
  };

  /**
   * Handle timezone selection
   */
  const handleTimezoneChange = (event: CustomEvent) => {
    const tz = event.detail.value as 'local' | 'gmt';
    onTimezoneChange(tz);
  };

  /**
   * Handle lookback hours change
   */
  const handleLookbackChange = (event: CustomEvent) => {
    const lookbackH = event.detail.value as number;
    onTimeRangeChange({ lookbackH });
  };

  /**
   * Handle lookahead hours change
   */
  const handleLookaheadChange = (event: CustomEvent) => {
    const lookaheadH = event.detail.value as number;
    onTimeRangeChange({ lookaheadH });
  };

  /**
   * Handle absolute start time change
   */
  const handleAbsStartChange = (event: CustomEvent) => {
    const absStart = event.detail.value as string;
    onTimeRangeChange({ absStart });
  };

  /**
   * Handle absolute end time change
   */
  const handleAbsEndChange = (event: CustomEvent) => {
    const absEnd = event.detail.value as string;
    onTimeRangeChange({ absEnd });
  };

  return (
    <IonList className="time-settings">
      <IonListHeader>
        <IonIcon icon={calendarOutline} slot="start" />
        <IonLabel>Time</IonLabel>
      </IonListHeader>

      {/* Timezone Section */}
      <IonItem lines="none">
        <IonNote color="medium">
          Controls how times are displayed; NOAA data is in GMT. This does not affect calculations.
        </IonNote>
      </IonItem>

      <IonItem>
        <div className="time-field">
          <IonLabel>Time Zone</IonLabel>
          <IonSegment value={timezone} onIonChange={handleTimezoneChange}>
            <IonSegmentButton value="local">
              <IonLabel>Local</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="gmt">
              <IonLabel>GMT</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>
      </IonItem>

      {/* Time Range Mode Section */}
      <IonItem lines="none">
        <IonNote color="medium">
          Choose a window around the current time (Relative) or a specific interval (Absolute).
        </IonNote>
      </IonItem>

      <IonItem>
        <div className="time-field">
          <IonLabel>Time Range</IonLabel>
          <IonSegment value={timeRange.mode} onIonChange={handleModeChange}>
            <IonSegmentButton value="relative">
              <IonLabel>Relative</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="absolute">
              <IonLabel>Absolute</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>
      </IonItem>

      {/* Relative Mode Settings */}
      {timeRange.mode === 'relative' ? (
        <div className="relative-time-controls">
          <IonItem>
            <div className="time-range-grid">
              <div className="time-field">
                <IonLabel position="stacked">Past Window</IonLabel>
                <IonSelect
                  value={timeRange.lookbackH}
                  onIonChange={handleLookbackChange}
                  interface="popover"
                  placeholder="Select hours"
                >
                  {[12, 24, 36, 48, 60].map(hours => (
                    <IonSelectOption key={hours} value={hours}>
                      {hours} hours
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>
              
              <div className="time-field">
                <IonLabel position="stacked">Future Window</IonLabel>
                <IonSelect
                  value={timeRange.lookaheadH}
                  onIonChange={handleLookaheadChange}
                  interface="popover"
                  placeholder="Select hours"
                >
                  {[24, 36, 48, 60, 72].map(hours => (
                    <IonSelectOption key={hours} value={hours}>
                      {hours} hours
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </div>
            </div>
          </IonItem>
          
          <IonItem lines="none">
            <IonNote color="medium">
              Data window moves with current time. Past: {timeRange.lookbackH}h back, 
              Future: {timeRange.lookaheadH}h ahead.
            </IonNote>
          </IonItem>
        </div>
      ) : (
        /* Absolute Mode Settings */
        <div className="absolute-time-controls">
          <IonItem>
            <IonLabel position="stacked">
              Start ({timezone === 'gmt' ? 'GMT' : 'Local'})
            </IonLabel>
            <IonDatetime
              value={timeRange.absStart}
              onIonChange={handleAbsStartChange}
              presentation="date-time"
              minuteValues="0,6,12,18,24,30,36,42,48,54"
              className="absolute-datetime"
            />
          </IonItem>

          <IonItem>
            <IonLabel position="stacked">
              End ({timezone === 'gmt' ? 'GMT' : 'Local'})
            </IonLabel>
            <IonDatetime
              value={timeRange.absEnd}
              onIonChange={handleAbsEndChange}
              presentation="date-time"
              minuteValues="0,6,12,18,24,30,36,42,48,54"
              className="absolute-datetime"
            />
          </IonItem>
          
          <IonItem lines="none">
            <IonNote color="medium">
              Fixed time range - data will not update automatically with current time.
            </IonNote>
          </IonItem>
        </div>
      )}
    </IonList>
  );
};

export default TimeSettings;