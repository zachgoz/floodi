import React, { useState } from 'react';
import {
  IonAvatar,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPopover,
  IonText,
} from '@ionic/react';
import { logOutOutline, personCircleOutline, personOutline } from 'ionicons/icons';
import { useAuth } from 'src/contexts/AuthContext';

type UserMenuProps = {
  onNavigate?: (path: string) => void;
};

export const UserMenu: React.FC<UserMenuProps> = ({ onNavigate }) => {
  const { user, isAnonymous, logout } = useAuth();
  const [open, setOpen] = useState<boolean>(false);
  const [event, setEvent] = useState<Event | undefined>(undefined);

  if (!user) {
    return (
      <div className="ion-padding-bottom">
        <IonButton expand="block" onClick={() => onNavigate?.('/login')}>Login</IonButton>
        <IonButton expand="block" color="medium" onClick={() => onNavigate?.('/register')}>Create Account</IonButton>
      </div>
    );
  }

  if (isAnonymous) {
    return (
      <div className="ion-padding-bottom">
        <IonItem lines="none">
          <IonAvatar slot="start">
            <img src={'https://www.gravatar.com/avatar?d=mp'} alt="Guest avatar" />
          </IonAvatar>
          <IonLabel>
            <h2>Guest User</h2>
            <p>Limited personalization</p>
          </IonLabel>
        </IonItem>
        <IonButton expand="block" onClick={() => onNavigate?.('/register')}>Create Account</IonButton>
        <IonButton expand="block" fill="outline" onClick={() => onNavigate?.('/login')}>Sign In</IonButton>
      </div>
    );
  }

  return (
    <div className="ion-padding-bottom">
      <IonItem
        button
        detail
        onClick={(e) => {
          setOpen(true);
          // use nativeEvent for proper popover anchoring
          setEvent(e.nativeEvent as Event);
        }}
      >
        <IonAvatar slot="start">
          <img src={user.photoURL || 'https://www.gravatar.com/avatar?d=mp'} alt="User avatar" />
        </IonAvatar>
        <IonLabel>
          <h2>{user.displayName || 'Account'}</h2>
          <p>{user.email}</p>
        </IonLabel>
        <IonIcon icon={personCircleOutline} slot="end" />
      </IonItem>
      <IonPopover isOpen={open} onDidDismiss={() => setOpen(false)} event={event}>
        <IonList>
          <IonItem button onClick={() => { setOpen(false); onNavigate?.('/profile'); }}>
            <IonIcon icon={personOutline} slot="start" />
            <IonLabel>Profile</IonLabel>
          </IonItem>
          <IonItem button color="danger" onClick={() => { setOpen(false); void logout(); }}>
            <IonIcon icon={logOutOutline} slot="start" />
            <IonLabel>Logout</IonLabel>
          </IonItem>
        </IonList>
      </IonPopover>
      <div className="ion-text-center ion-padding-top">
        <IonText color="medium">Signed in</IonText>
      </div>
    </div>
  );
};

export default UserMenu;
