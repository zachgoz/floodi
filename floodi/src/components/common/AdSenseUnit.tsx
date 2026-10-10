import { Capacitor } from '@capacitor/core';
import React, { useEffect } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export interface AdSenseUnitProps {
  /** The AdSense client ID (defaults to the user's publisher ID) */
  client?: string;
  /** The specific ad slot ID provided in the AdSense console */
  slot: string;
  /** Ad layout format, e.g., 'auto', 'fluid', 'horizontal', 'rectangle' */
  format?: string;
  /** Whether the ad should be responsive (defaults to true) */
  responsive?: boolean;
  /** Custom styles for the ad container */
  style?: React.CSSProperties;
  /** Whether ads are enabled. Defaults to false (VITE_ENABLE_ADS === 'true') */
  enabled?: boolean;
  /** Whether to show a visual placeholder in development mode. Defaults to false (VITE_SHOW_AD_PLACEHOLDER === 'true') */
  showPlaceholder?: boolean;
}

/**
 * Premium Google AdSense Component
 *
 * Safely displays Google AdSense ad units on web platforms while automatically
 * disabling them in Capacitor native mobile wrappers (iOS/Android) to comply
 * with Google AdSense policies.
 *
 * Configurable via `enabled` prop or `VITE_ENABLE_ADS` environment variable.
 * Defaults to hidden/disabled so unready ads and dev placeholders are not shown.
 */
export const AdSenseUnit: React.FC<AdSenseUnitProps> = ({
  client = 'ca-pub-7767091393137672',
  slot,
  format = 'auto',
  responsive = true,
  style = { display: 'block' },
  enabled = import.meta.env.VITE_ENABLE_ADS === 'true',
  showPlaceholder = import.meta.env.VITE_SHOW_AD_PLACEHOLDER === 'true',
}) => {
  const isNative = Capacitor.isNativePlatform();
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    // Only initialize AdSense script queue if ads are enabled on web and not in dev placeholder mode
    if (isNative || !enabled || isDev) return;

    // Initialize the AdSense unit once the component is mounted
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (error) {
      console.warn('AdSense ad unit initialization deferred or failed:', error);
    }
  }, [isNative, enabled, isDev, slot]);

  // Completely hidden on native platforms or when ads are disabled (default)
  if (isNative || !enabled) {
    return null;
  }

  // In development mode, only show placeholder if explicitly configured (default hidden)
  if (isDev) {
    if (!showPlaceholder) {
      return null;
    }

    return (
      <div 
        className="adsense-wrapper" 
        style={{ 
          margin: '24px auto', 
          width: '100%', 
          maxWidth: '1200px', 
          display: 'flex', 
          justifyContent: 'center',
          padding: '0 16px',
          boxSizing: 'border-box'
        }}
      >
        <div
          style={{
            width: '100%',
            minHeight: '100px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px dashed rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            color: 'var(--ion-color-step-600, #888)',
            fontFamily: 'var(--ion-font-family, sans-serif)',
            fontSize: '13px',
            backdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 4px 30px rgba(0, 0, 0, 0.1)',
            textAlign: 'center'
          }}
        >
          <strong style={{ color: 'var(--ion-color-primary, #3880ff)', marginBottom: '4px', fontSize: '14px' }}>
            Google AdSense Placeholder
          </strong>
          <span style={{ opacity: 0.7, marginBottom: '2px' }}>Client ID: {client}</span>
          <span style={{ opacity: 0.7 }}>Slot ID: {slot}</span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="adsense-wrapper" 
      style={{ 
        margin: '24px auto', 
        width: '100%', 
        maxWidth: '1200px', 
        display: 'flex', 
        justifyContent: 'center',
        padding: '0 16px',
        boxSizing: 'border-box'
      }}
    >
      <ins
        className="adsbygoogle"
        style={style}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />
    </div>
  );
};
