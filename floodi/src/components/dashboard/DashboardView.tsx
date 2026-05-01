import React, { useState } from 'react';
import { IonPage, IonContent, IonHeader, IonToolbar, IonTitle, IonSpinner } from '@ionic/react';
import { APIProvider } from '@vis.gl/react-google-maps';

import HydrographChart from './HydrographChart';
import AtmosphericOverlay from './AtmosphericOverlay';
import InundationMap from './InundationMap';
import InundationSimulator from './InundationSimulator';
import WebcamFeedCard from './WebcamFeedCard';
import { WEBCAMS } from './constants/webcams';

import './DashboardView.css';

import { useChartData } from '../Tab2/hooks/useChartData';
import type { AppConfiguration } from '../Tab2/types';

const DEFAULT_CONFIG: AppConfiguration = {
  station: {
    id: '8658163',
    name: 'Wrightsville Beach',
    state: 'NC',
  },
  thresholds: {
    minor: 4.0,
    moderate: 5.0,
    major: 6.0,
    extreme: 7.0,
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
  },
};

export const DashboardView: React.FC = () => {
  const [simulationLevel, setSimulationLevel] = useState<number>(3.5);
  const { processedData, loading } = useChartData(DEFAULT_CONFIG);
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number } | undefined>(undefined);

  const resetToLive = () => {
    setCenterRequest({ time: new Date(), id: Date.now() });
  };

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
    : { speed: 0, dir: 0 };
    
  // Find nearest observed/predicted point to 'now'
  const currentObserved = observedPoints.length > 0
    ? observedPoints.reduce((prev, curr) =>
        Math.abs(curr.t.getTime() - now.getTime()) < Math.abs(prev.t.getTime() - now.getTime()) ? curr : prev
      ).v
    : predictedPoints.length > 0 
      ? predictedPoints.reduce((prev, curr) =>
          Math.abs(curr.t.getTime() - now.getTime()) < Math.abs(prev.t.getTime() - now.getTime()) ? curr : prev
        ).v 
      : 0;
    
  // Find nearest precip point to 'now'
  const currentPrecip = precipPoints.length > 0 
    ? precipPoints.reduce((prev, curr) => 
        Math.abs(curr.t.getTime() - now.getTime()) < Math.abs(prev.t.getTime() - now.getTime()) ? curr : prev
      ).value
    : 0;


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
                  observedWaterLevel={currentObserved}
                  isLive={true}
                  time={now}
                />
                
                <HydrographChart
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
                  waterLevelFt={simulationLevel}
                  roadData={undefined}
                  targetTime={now}
                  onResetToLive={resetToLive}
                />
              </APIProvider>

              <InundationSimulator 
                waterLevelFt={simulationLevel}
                onLevelChange={setSimulationLevel}
                thresholds={{
                  minor: 6.1,
                  moderate: 7.0,
                  major: 7.7,
                  extreme: 8.5,
                }}
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
