import React, { useState } from 'react';
import { IonPage, IonContent, IonHeader, IonToolbar, IonTitle, IonSpinner } from '@ionic/react';
import { APIProvider } from '@vis.gl/react-google-maps';

import HydrographChart from './HydrographChart';
import AtmosphericOverlay from './AtmosphericOverlay';
import InundationMap from './InundationMap';
import InundationSimulator from './InundationSimulator';
import WebcamFeedCard from './WebcamFeedCard';

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
  const { data, processedData, loading, error } = useChartData(DEFAULT_CONFIG);

  const {
    observedPoints,
    predictedPoints,
    adjustedPoints,
    timeDomain,
    windPoints,
    precipPoints
  } = processedData;

  const { start, end, now } = timeDomain;

  // Get current values from the processed data - find points nearest to 'now'
  const currentObserved = observedPoints.length > 0 ? observedPoints[observedPoints.length - 1].v : 0;
  
  // Find nearest wind point to 'now'
  const currentWind = windPoints.length > 0 
    ? windPoints.reduce((prev, curr) => 
        Math.abs(curr.t.getTime() - now.getTime()) < Math.abs(prev.t.getTime() - now.getTime()) ? curr : prev
      )
    : { speed: 0, dir: 0 };
    
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
              <WebcamFeedCard 
                imageUrl="https://wl.secoora.org/webcam/SUNNYD_CB_02.2026-04-21T13:42Z.jpg"
                locationName="Carolina Beach - Canal Dr"
                timestamp={new Date()}
              />
            </div>
          </div>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default DashboardView;
