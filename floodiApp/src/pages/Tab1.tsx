import React from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonSpinner } from '@ionic/react';
import { Line } from 'react-chartjs-2';
import { Chart, TimeScale, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { useFloodForecast } from '../hooks';
import { segments } from '../config';
import './Tab1.css';

Chart.register(TimeScale, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const Tab1: React.FC = () => {
  const segment = segments[0];
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { sensorQuery, observationsQuery, forecast, windows } = useFloodForecast(
    segment.stationId,
    segment.sensorPlatform!,
    start,
    end,
    segment.elevationFtMLLW
  );

  const chartData = React.useMemo(() => {
    if (!forecast) return undefined;
    const sensorData = sensorQuery.data || [];
    const obsData = observationsQuery.data || [];
    return {
      datasets: [
        {
          label: 'Predicted Level (ft)',
          data: forecast.map(p => ({ x: p.timestamp, y: p.predictedLevelFt })),
          borderColor: 'blue',
          fill: false
        },
        {
          label: 'Observed Level (ft)',
          data: obsData.map(d => ({ x: d.t + 'Z', y: parseFloat(d.v) })),
          borderColor: 'orange',
          fill: false
        },
        {
          label: 'Sensor Level (ft)',
          data: sensorData.map(d => ({ x: d.time, y: d.value })),
          borderColor: 'green',
          fill: false
        },
        {
          label: 'Road Elevation',
          data: forecast.map(p => ({ x: p.timestamp, y: segment.elevationFtMLLW })),
          borderColor: 'red',
          borderDash: [4, 4],
          fill: false
        }
      ]
    };
  }, [forecast, sensorQuery.data, observationsQuery.data, segment.elevationFtMLLW]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Flood Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="ion-padding">
        {chartData ? (
          <Line
            data={chartData}
            options={{
              responsive: true,
              scales: {
                x: { type: 'time' },
                y: { title: { display: true, text: 'Feet MLLW' } }
              }
            }}
          />
        ) : (
          <IonSpinner />
        )}
        <IonList>
          {(windows || []).map((w, idx) => (
            <IonItem key={idx}>
              {new Date(w.start).toLocaleString()} -
              {new Date(w.end).toLocaleString()}: {w.maxDepthFt.toFixed(2)} ft
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default Tab1;
