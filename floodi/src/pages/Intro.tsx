/**
 * @fileoverview Intro screen component for FloodCast onboarding
 *
 * This component provides a welcome screen for first-time users of the FloodCast app.
 * It serves as an onboarding experience that introduces the app's brand and purpose
 * before directing users to the main functionality.
 *
 * Features:
 * - One-time display using localStorage persistence
 * - Clean, centered design with app branding
 * - Smooth navigation to main app functionality
 * - Graceful fallback if localStorage is unavailable
 */

import React from 'react';
import { IonButton, IonContent, IonPage, IonText } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import './Intro.css';

/**
 * Intro Component
 *
 * A fullscreen welcome screen that introduces new users to FloodCast.
 * This component is displayed only once per device/browser session using
 * localStorage to track whether the user has seen the intro.
 *
 * User Flow:
 * 1. First-time users see this intro screen at app launch
 * 2. Clicking "Get Started" marks intro as seen and navigates to main app
 * 3. Subsequent app visits skip directly to main functionality
 *
 * Design Features:
 * - Fullscreen layout for immersive experience
 * - Centered content with app logo and branding
 * - Clear call-to-action button
 * - Professional typography hierarchy
 *
 * @component
 * @returns {JSX.Element} The intro screen with branding and navigation
 *
 * @example
 * // Rendered via routing when user hasn't seen intro before
 * <Route exact path="/intro">
 *   <Intro />
 * </Route>
 */
const Intro: React.FC = () => {
  const history = useHistory();

  /**
   * Handles the "Get Started" button click
   *
   * Marks the intro as seen in localStorage and navigates to the main app.
   * Uses history.replace() instead of push() to prevent users from navigating
   * back to the intro screen accidentally.
   *
   * Error Handling:
   * - Silently handles localStorage failures (privacy mode, storage quotas, etc.)
   * - App continues to function even if persistence fails
   *
   * @function handleContinue
   */
  const handleContinue = () => {
    try {
      // Mark intro as seen for future app launches
      localStorage.setItem('floodcast_intro_seen', '1');
    } catch {
      // Silently handle localStorage errors (privacy mode, quota exceeded, etc.)
      // App continues to work, user may see intro again on next visit
    }
    
    // Navigate to main app, replacing current history entry
    // This prevents back navigation to intro screen
    history.replace('/tab2');
  };

  return (
    <IonPage>
      {/* Fullscreen content with custom CSS class for styling */}
      <IonContent fullscreen className="intro-content">
        {/* Centered container for all intro elements */}
        <div className="intro-center">
          {/* App logo with responsive sizing via Vite's asset handling */}
          <img
            src={new URL('../assets/floodcast-logo.svg', import.meta.url).toString()}
            alt="FloodCast"
            className="intro-logo"
          />
          
          {/* Primary app title with light color for contrast */}
          <IonText color="light">
            <h1 className="intro-title">FloodCast</h1>
          </IonText>
          
          {/* App tagline/description with medium color for hierarchy */}
          <IonText color="medium">
            <p className="intro-sub">Hyperlocal tide and flood insights at a glance.</p>
          </IonText>
          
          {/* Primary call-to-action button */}
          <IonButton
            shape="round"
            size="large"
            onClick={handleContinue}
            className="intro-button"
          >
            Get Started
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Intro;

