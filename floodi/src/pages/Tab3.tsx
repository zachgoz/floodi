import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import ExploreContainer from '../components/ExploreContainer';
import './Tab3.css';

const Tab3: React.FC = () => {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>About FloodCast</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">FloodCast</IonTitle>
          </IonToolbar>
        </IonHeader>
        <div style={{ textAlign: 'center', padding: 16 }}>
          <img
            src={new URL('../assets/floodcast-logo.svg', import.meta.url).toString()}
            alt="FloodCast"
            style={{ width: 220, maxWidth: '60vw', height: 'auto', margin: '16px auto' }}
          />
          <p>
            FloodCast provides hyperlocal tide and flood insights to help you
            plan with confidence. This is an early build.
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Tab3;
