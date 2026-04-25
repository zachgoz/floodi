import React from 'react';
import { IonIcon } from '@ionic/react';
import { videocamOutline } from 'ionicons/icons';
import './WebcamFeedCard.css';

interface WebcamFeedCardProps {
  imageUrl: string;
  locationName: string;
  timestamp: Date;
  cameraId?: string;
}

export const WebcamFeedCard: React.FC<WebcamFeedCardProps> = ({
  imageUrl,
  locationName,
  timestamp,
  cameraId = "SUNNYD_CB_02"
}) => {
  return (
    <div className="webcam-card-container">
      <div className="webcam-header">
        <div className="webcam-title-group">
          <h3 className="webcam-title">
            <IonIcon icon={videocamOutline} />
            <span>Live Feed</span>
          </h3>
          <span className="webcam-location">{locationName}</span>
        </div>
        <div className="webcam-status-pill">
          <span className="webcam-live-indicator"></span>
          LIVE
        </div>
      </div>
      
      <div className="webcam-image-wrapper">
        <img 
          src={imageUrl} 
          alt={`Webcam feed from ${locationName}`} 
          className="webcam-image" 
          loading="lazy" 
        />
        <div className="webcam-overlay-badge">
          <span className="badge-time">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="badge-divider">|</span>
          <span className="badge-cam">CAM: {cameraId}</span>
        </div>
      </div>
    </div>
  );
};

export default WebcamFeedCard;
