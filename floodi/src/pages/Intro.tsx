import React from 'react';
import { IonButton, IonContent, IonPage, IonText } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import './Intro.css';

const Intro: React.FC = () => {
  const history = useHistory();

  const handleContinue = () => {
    try {
      localStorage.setItem('floodcast_intro_seen', '1');
    } catch {}
    history.replace('/tab2');
  };

  return (
    <IonPage>
      <IonContent fullscreen className="intro-content">
        <div className="intro-center">
          <img src={new URL('../assets/floodcast-logo.svg', import.meta.url).toString()} alt="FloodCast" className="intro-logo" />
          <IonText color="light">
            <h1 className="intro-title">FloodCast</h1>
          </IonText>
          <IonText color="medium">
            <p className="intro-sub">Hyperlocal tide and flood insights at a glance.</p>
          </IonText>
          <IonButton shape="round" size="large" onClick={handleContinue} className="intro-button">
            Get Started
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Intro;

