import React, { useState } from 'react';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';
import { useAuth } from 'src/contexts/AuthContext';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { updateUserRole } from 'src/lib/userService';
import { UserRole } from 'src/types/user';

/**
 * AdminBootstrap
 * 
 * Temporary component to bootstrap the first admin user.
 * This allows a logged-in user to promote themselves to admin role
 * for initial setup purposes.
 */
export const AdminBootstrap: React.FC = () => {
  const { user, userProfile } = useAuth();
  const userPermissions = useUserPermissions();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdminUser = userPermissions.isAdmin();

  const promoteToAdmin = async () => {
    if (!user) {
      setError('No user logged in');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Update the user role to admin
      await updateUserRole(user.uid, UserRole.Admin);
      
      // Refresh the auth context to pick up the new role
      window.location.reload();
      
      setSuccess('Successfully promoted to admin! Page will refresh...');
    } catch (e: any) {
      setError(e?.message || 'Failed to promote to admin');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Admin Bootstrap</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Not Authenticated</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>Please log in first to use admin bootstrap.</p>
            </IonCardContent>
          </IonCard>
        </IonContent>
      </IonPage>
    );
  }

  if (isAdminUser) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Admin Bootstrap</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Already Admin</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>You already have admin privileges! You can now:</p>
              <ul>
                <li>Access the comments system</li>
                <li>Manage user roles via the admin interface</li>
                <li>Create and moderate comments</li>
              </ul>
              <IonButton routerLink="/tab4" color="primary" fill="solid">
                Go to Comments
              </IonButton>
            </IonCardContent>
          </IonCard>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Bootstrap</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Bootstrap First Admin</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote color="warning" className="ion-margin-bottom">
              <strong>Warning:</strong> This is a bootstrap utility for setting up the first admin user.
              Remove this component after initial setup for security.
            </IonNote>
            
            <p><strong>Current User:</strong> {userProfile?.displayName || user.email || user.uid}</p>
            <p><strong>Current Role:</strong> {userProfile?.role || 'user'}</p>
            
            <p>
              This utility allows you to promote yourself to admin role to access the comments system 
              and manage other users. After becoming admin, you can use the proper admin interface 
              to manage user roles.
            </p>
            
            <IonButton 
              onClick={promoteToAdmin}
              disabled={loading}
              color="danger"
              fill="solid"
              expand="block"
            >
              {loading ? 'Promoting...' : 'Promote to Admin'}
            </IonButton>
          </IonCardContent>
        </IonCard>

        <IonToast
          isOpen={!!error}
          message={error || ''}
          duration={3000}
          color="danger"
          onDidDismiss={() => setError(null)}
        />
        
        <IonToast
          isOpen={!!success}
          message={success || ''}
          duration={3000}
          color="success"
          onDidDismiss={() => setSuccess(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default AdminBootstrap;