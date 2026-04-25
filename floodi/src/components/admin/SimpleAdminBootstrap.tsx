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
import { updateUserRole } from 'src/lib/userService';
import { UserRole } from 'src/types/user';

/**
 * SimpleAdminBootstrap
 * 
 * Simple utility to promote current user to admin role
 */
export const SimpleAdminBootstrap: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promoteToAdmin = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get current user from Firebase Auth directly
      const { auth } = await import('src/lib/firebase');
      const user = auth.currentUser;
      
      if (!user) {
        setError('No user logged in');
        return;
      }

      // Update the user role to admin
      await updateUserRole(user.uid, UserRole.Admin);
      
      setSuccess('Successfully promoted to admin! Please refresh the page.');
      
      // Optionally refresh after a delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (e: any) {
      setError(e?.message || 'Failed to promote to admin');
    } finally {
      setLoading(false);
    }
  };

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
            <IonCardTitle>Promote to Admin</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonNote color="warning" className="ion-margin-bottom">
              <strong>Bootstrap Utility:</strong> This allows you to promote yourself to admin role 
              to fix permission issues with the comments system.
            </IonNote>
            
            <p>
              Click the button below to promote your current account to admin role. 
              This will allow you to access the comments system and manage other users.
            </p>
            
            <IonButton 
              onClick={promoteToAdmin}
              disabled={loading}
              color="primary"
              fill="solid"
              expand="block"
            >
              {loading ? 'Promoting...' : 'Promote Current User to Admin'}
            </IonButton>
            
            {success && (
              <IonNote color="success" className="ion-margin-top">
                <p>{success}</p>
                <p>After the page refreshes, you should be able to access the comments system.</p>
              </IonNote>
            )}
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

export default SimpleAdminBootstrap;