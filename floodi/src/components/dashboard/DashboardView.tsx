import React, { useState } from 'react';
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
  },
};

export const DashboardView: React.FC = () => {
  const [simulationLevel, setSimulationLevel] = useState<number>(3.5);
  const { processedData, loading } = useChartData(DEFAULT_CONFIG);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);

  const resetToLive = () => {
    setCenterRequest({ time: new Date(), id: Date.now() });
  };

  if (loading || !processedData) {
    return (
      <IonPage>
        <IonContent>
          <div className="flex-center" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const {
    observedPoints,
    predictedPoints,
    adjustedPoints,
    timeDomain,
    windPoints,
    precipPoints
  } = processedData;

  const { start, end, now } = timeDomain;

  // Find nearest wind point to 'now'
  const currentWind = windPoints.length > 0 
    ? windPoints.reduce((prev, curr) => 
        Math.abs(curr.t.getTime() - now.getTime()) < Math.abs(prev.t.getTime() - now.getTime()) ? curr : prev
      )
    : { t: now, speed: 0, dir: 0 };
    
  // Find nearest observed/predicted point to 'now'
  const lastObs = observedPoints.length > 0 ? observedPoints[observedPoints.length - 1] : null;
  const isPastHandover = now.getTime() > (lastObs?.t.getTime() || 0);

  const obsRes = findNearestPoint(observedPoints, now);
  const adjRes = findNearestPoint(adjustedPoints, now);
  const predRes = findNearestPoint(predictedPoints, now);
  const windRes = findNearestPoint(windPoints, now);
  const precipRes = findNearestPoint(precipPoints, now);

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
                  isLive={true}
                  targetTime={now}
                />
                
                <HydrographChart
                  locationId={DEFAULT_LOCATION_ID}
                  observedPoints={observedPoints}
                  predictedPoints={predictedPoints}
                  adjustedPoints={adjustedPoints}
                  deltaPoints={[]}
                  domainStart={start}
                  domainEnd={end}
                  now={now}
                  thresholds={DEFAULT_CONFIG.thresholds}
                  showDelta={false}
                  timezone="local"
                  showComments={true}
                  comments={[]}
                  centerRequest={centerRequest}
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
                  locationId={DEFAULT_LOCATION_ID}
                  waterLevelFt={simulationLevel}
                  roadData={undefined}
                  targetTime={now}
                  onResetToLive={resetToLive}
                />
              </APIProvider>

              <InundationSimulator 
                waterLevelFt={simulationLevel}
                onLevelChange={setSimulationLevel}
                thresholds={DEFAULT_CONFIG.thresholds}
              />
            </div>

            <div className="dashboard-sidebar">
              {WEBCAMS.map(cam => (
                <WebcamFeedCard 
                  key={cam.id}
                  cameraId={cam.id}
                  locationName={cam.name}
                  targetTime={now}
                  onResetToLive={resetToLive}
                />
              ))}
            </div>
          </div>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default DashboardView;
