/**
 * @fileoverview About page component for FloodCast application
 *
 * This component renders the About page that provides users with information
 * about the FloodCast application, its purpose, and current development status.
 * It serves as both an informational page and branding opportunity.
 *
 * Features:
 * - Responsive branding with FloodCast logo
 * - Condensed header for better mobile UX
 * - Clear app description and value proposition
 * - Development status indicator for user expectations
 */

import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import ExploreContainer from '../components/ExploreContainer';
import './Tab3.css';

/**
 * Tab3 Component (About Page)
 *
 * Displays information about the FloodCast application including branding,
 * app description, and current development status. This page is accessible
 * via the bottom tab navigation and provides users context about the app.
 *
 * UI Structure:
 * - Fixed header with app title
 * - Collapsible large header for modern iOS-style navigation
 * - Centered content with logo and description
 * - Responsive design adapting to different screen sizes
 *
 * @component
 * @returns {JSX.Element} The About page with app information and branding
 *
 * @example
 * // Accessed via tab navigation at /tab3
 * <Tab3 />
 */
const Tab3: React.FC = () => {
  return (
    <IonPage>
      {/* Standard header visible when content is scrolled */}
      <IonHeader>
        <IonToolbar>
          <IonTitle>About FloodCast</IonTitle>
        </IonToolbar>
      </IonHeader>
      
      {/* Main content area with fullscreen layout */}
      <IonContent fullscreen>
        {/* Large header that collapses on scroll for modern mobile UX */}
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">FloodCast</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        {/* Centered content section with app branding and information */}
        <div style={{ textAlign: 'center', padding: 16 }}>
          {/* App logo with responsive sizing */}
          <img
            src={new URL('../assets/floodcast-logo.svg', import.meta.url).toString()}
            alt="FloodCast"
            style={{
              width: 220,
              maxWidth: '60vw', // Responsive: max 60% of viewport width
              height: 'auto',
              margin: '16px auto'
            }}
          />
          
          {/* App description highlighting value proposition and current status */}
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
