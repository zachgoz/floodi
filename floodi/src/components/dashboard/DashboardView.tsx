import React, { useState, useCallback } from 'react';
import { IonPage, IonContent, IonHeader, IonToolbar, IonTitle, IonSpinner } from '@ionic/react';
import { APIProvider } from '@vis.gl/react-google-maps';

import HydrographChart from './HydrographChart';
import AtmosphericOverlay from './AtmosphericOverlay';
import InundationMap from './InundationMap';
import InundationSimulator from './InundationSimulator';
import WebcamFeedCard from './WebcamFeedCard';
import { WEBCAMS } from '../../constants/webcams';
import { LOCATIONS, DEFAULT_LOCATION_ID } from '../../constants/locations';

import './DashboardView.css';

import { useChartData } from '../Tab2/hooks/useChartData';
import { findNearestPoint } from '../Tab2/hooks/useChartInteraction';
import type { AppConfiguration } from '../Tab2/types';

const LIVE_TOLERANCE_MS = 60 * 1000;

const DEFAULT_CONFIG: AppConfiguration = {
  locationId: DEFAULT_LOCATION_ID,
  location: {
    id: LOCATIONS[DEFAULT_LOCATION_ID].id,
    name: LOCATIONS[DEFAULT_LOCATION_ID].name,
    state: LOCATIONS[DEFAULT_LOCATION_ID].state,
  },
  station: {
    id: LOCATIONS[DEFAULT_LOCATION_ID].noaaStationId,
    name: LOCATIONS[DEFAULT_LOCATION_ID].name,
  },
  thresholds: {
    ...LOCATIONS[DEFAULT_LOCATION_ID].thresholds,
  },
  offset: {
    mode: 'auto',
    value: '0',
  },
  timeRange: {
    mode: 'relative',
    lookbackH: 24,
    lookaheadH: 48,
    absStart: '',
    absEnd: '',
  },
  display: {
    timezone: 'local',
    showDelta: false,
    viewMode: 'advanced',
    dataSource: 'auto',
  },
};

export const DashboardView: React.FC = () => {
  const [simulationLevel, setSimulationLevel] = useState<number>(3.5);
  const { processedData, loading } = useChartData(DEFAULT_CONFIG);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(WEBCAMS[0].id);
  const liveTimeMs = processedData?.timeDomain.now.getTime();

  const resetToLive = useCallback(() => {
    setSelectedTime(null);
    setCenterRequest({ time: new Date(), id: Date.now() });
  }, []);

  const handleTimeChange = useCallback((newTime: Date) => {
    // Round to nearest minute for stability
    const rounded = new Date(newTime);
    rounded.setSeconds(0, 0);
    setSelectedTime(rounded);

    // Unified sync: Ensure hydrograph centers on this specific time
    // whenever it is changed via an external control (Webcam, Map, or Pill).
    setCenterRequest({ time: rounded, id: Date.now() });
  }, []);

  const handleViewportChange = useCallback((start: Date, end: Date, focusTime: Date) => {
    // Round to nearest minute for stability
    const rounded = new Date(focusTime);
    rounded.setSeconds(0, 0);

    // Update selectedTime to sync labels and webcam, but DO NOT set centerRequest
    // because the chart is already being moved by the user.
    const isNearLive = liveTimeMs !== undefined && Math.abs(rounded.getTime() - liveTimeMs) < LIVE_TOLERANCE_MS;
    setSelectedTime(isNearLive ? null : rounded);
  }, [liveTimeMs]);

  const {
    observedPoints = [],
    predictedPoints = [],
    adjustedPoints = [],
    timeDomain = { start: new Date(), end: new Date(), now: new Date() },
    windPoints = [],
    precipPoints = []
  } = processedData || {};

  const { start, end, now } = timeDomain;
  const isLive = !selectedTime || Math.abs(selectedTime.getTime() - (now?.getTime() || Date.now())) < LIVE_TOLERANCE_MS;
  const targetTime = isLive ? (now || new Date()) : selectedTime;

  // Find nearest wind point to targetTime
  const currentWind = (windPoints && windPoints.length > 0)
    ? windPoints.reduce((prev, curr) =>
        Math.abs(curr.t.getTime() - targetTime.getTime()) < Math.abs(prev.t.getTime() - targetTime.getTime()) ? curr : prev
      )
    : { t: targetTime, speed: 0, dir: 0 };

  // Find nearest observed/predicted point to targetTime
  const lastObs = (observedPoints && observedPoints.length > 0) ? observedPoints[observedPoints.length - 1] : null;
  const isPastHandover = targetTime.getTime() > (lastObs?.t.getTime() || 0);

  const obsRes = observedPoints ? findNearestPoint(observedPoints, targetTime) : null;
  const adjRes = adjustedPoints ? findNearestPoint(adjustedPoints, targetTime) : null;
  const predRes = predictedPoints ? findNearestPoint(predictedPoints, targetTime) : null;
  const precipRes = precipPoints ? findNearestPoint(precipPoints, targetTime) : null;

  const isObserved = !!(obsRes && obsRes.dtMin < 60 && !isPastHandover);
  const isAdjusted = !!(adjRes && adjRes.dtMin < 60 && isPastHandover);
  const isPredicted = !isObserved && !isAdjusted && !!(predRes && predRes.dtMin < 60);

  const wl = isObserved ? obsRes!.point.v :
             isAdjusted ? adjRes!.point.v :
             isPredicted ? predRes!.point.v : 0;

  const statusLabel = isObserved ? 'Observed' : 'Predicted';
  const sourceLabel = isAdjusted ? 'FloodCast' : 
                      isObserved ? 'Fiman' : 'NOAA';

  const surge = (() => {
    if (!predRes || predRes.dtMin > 60) return null;
    return wl - predRes.point.v;
  })();

  const currentPrecip = precipRes && precipRes.dtMin < 60 ? precipRes.point.value : 0;

  const sourceId = isObserved ? 'noaa' : 
                   isAdjusted ? 'floodcast' :
                   isPredicted ? 'noaa' : 'live';

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonTitle>FloodCast Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <div className="dashboard-scroll-container">
          
          <div className="dashboard-header">
            <h1>Carolina Beach</h1>
            <p>Real-time monitoring and flood simulation.</p>
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-main-col">
              <div style={{ position: 'relative' }}>
                <AtmosphericOverlay 
                  precipitationAccumulation={currentPrecip}
                  windSpeed={currentWind.speed}
                  windDirection={currentWind.dir}
                  observedWaterLevel={wl}
                  source={sourceLabel}
                  sourceId={sourceId}
                  statusLabel={statusLabel}
                  surge={surge}
                  prediction={predRes?.point.v}
                  isLive={isLive}
                  targetTime={targetTime}
                  loading={loading}
                />
                
                <HydrographChart
                  locationId={DEFAULT_LOCATION_ID}
                  observedPoints={observedPoints || []}
                  predictedPoints={predictedPoints || []}
                  adjustedPoints={adjustedPoints || []}
                  deltaPoints={[]}
                  domainStart={start || new Date(Date.now() - 24 * 3600 * 1000)}
                  domainEnd={end || new Date(Date.now() + 48 * 3600 * 1000)}
                  now={now || new Date()}
                  isLive={isLive}
                  time={targetTime}
                  selectedTime={selectedTime}
                  timeRange={DEFAULT_CONFIG.timeRange}
                  thresholds={DEFAULT_CONFIG.thresholds}
                  showDelta={false}
                  timezone="local"
                  showComments={true}
                  comments={[]}
                  centerRequest={centerRequest}
                  onViewportChange={handleViewportChange}
                  onResetToLive={resetToLive}
                  loading={loading}
                />
                
                {loading && (
                  <div className="dashboard-loading-overlay">
                    <IonSpinner name="crescent" />
                  </div>
                )}
              </div>

              {/* Secure Google Maps wrapper */}
              <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}>
                <InundationMap
                  waterLevelFt={simulationLevel}
                  roadData={undefined}
                  targetTime={targetTime}
                  onResetToLive={resetToLive}
                  onTimeChange={handleTimeChange}
                  loading={loading}
                />
              </APIProvider>

              <InundationSimulator 
                waterLevelFt={simulationLevel}
                onLevelChange={setSimulationLevel}
                thresholds={DEFAULT_CONFIG.thresholds}
              />
            </div>

            <div className="dashboard-sidebar">
              <WebcamFeedCard
                cameraId={selectedCameraId}
                locationName={WEBCAMS.find(c => c.id === selectedCameraId)?.name || ''}
                targetTime={targetTime}
                isLive={isLive}
                onResetToLive={resetToLive}
                onTimeChange={handleTimeChange}
                onCameraChange={setSelectedCameraId}
                imagery={processedData?.imagery?.[selectedCameraId]}
                loading={loading}
              />
            </div>
          </div>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default DashboardView;
