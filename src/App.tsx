import { IonApp, IonContent, IonHeader, IonTitle, IonToolbar, IonButton, IonList, IonItem } from '@ionic/react';
import React, { useState } from 'react';
import { fetchNoaaPredictions } from './api/noaa';
import { calculateFloodForecast, summarizeFloodWindows } from './prediction';

interface FloodWindow {
  start: string;
  end: string;
  maxDepthFt: number;
}

const App: React.FC = () => {
  const [windows, setWindows] = useState<FloodWindow[]>([]);

  const handleFetch = async () => {
    try {
      const preds = await fetchNoaaPredictions('8658163', '20250722', '20250725');
      const forecast = calculateFloodForecast(preds, 1.0);
      setWindows(summarizeFloodWindows(forecast, 'segment1'));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Floodi</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonButton onClick={handleFetch}>Predict Floods</IonButton>
        <IonList>
          {windows.map((w, idx) => (
            <IonItem key={idx}>
              {w.start} - {w.end}: {w.maxDepthFt.toFixed(2)} ft
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonApp>
  );
};

export default App;
