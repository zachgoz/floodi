import { Capacitor } from '@capacitor/core';
import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let adScript: { element: HTMLScriptElement; promise: Promise<void> } | undefined;
const initializedUnits = new WeakSet<HTMLElement>();

/** One shared request across units and StrictMode effect replays. Failed loads
 * are removed so a bounded retry can issue a real fresh request. */
function loadAdSense(client: string): Promise<void> {
  if (adScript?.element.isConnected) return adScript.promise;
  const existing = document.querySelector<HTMLScriptElement>('script[data-floodcast-adsense]');
  const script = existing ?? document.createElement('script');
  if (script.dataset.floodcastLoaded === 'true') return Promise.resolve();
  if (!existing) {
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.floodcastAdsense = 'true';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); script.removeEventListener('load', loaded); script.removeEventListener('error', failed); };
    const loaded = () => { cleanup(); script.dataset.floodcastLoaded = 'true'; resolve(); };
    const failed = () => { cleanup(); script.remove(); reject(new Error('AdSense script unavailable')); };
    const timeout = setTimeout(failed, 15_000);
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) document.head.appendChild(script);
  });
  adScript = { element: script, promise };
  return promise;
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
  const validSlot = /^\d+$/.test(slot);
  const containerRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLModElement>(null);
  const identity = `${client}:${slot}`;
  const [nearIdentity, setNearIdentity] = useState<string | null>(null);
  const ready = nearIdentity === identity;

  useEffect(() => {
    if (isNative || !enabled || isDev || !validSlot) { setNearIdentity(null); return; }
    if (ready) return;
    const container = containerRef.current;
    if (!container) return;
    let observer: IntersectionObserver | undefined;
    const checkPosition = () => {
      const rect = container.getBoundingClientRect();
      if (rect.bottom >= -160 && rect.top <= window.innerHeight + 160) setNearIdentity(identity);
    };
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.target !== container) continue;
          if (entry.isIntersecting) setNearIdentity(identity);
        }
      }, { rootMargin: '160px 0px' });
      observer.observe(container);
    } else {
      // Older browsers still defer below-fold units until the user reaches them.
      checkPosition();
      window.addEventListener('scroll', checkPosition, { passive: true });
      window.addEventListener('resize', checkPosition);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', checkPosition);
      window.removeEventListener('resize', checkPosition);
    };
  }, [isNative, enabled, isDev, validSlot, identity, ready]);

  useEffect(() => {
    if (isNative || !enabled || isDev || !validSlot || !ready) return;
    const unit = unitRef.current;
    if (!unit) return;
    let active = true;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const initialize = () => {
      if (!active || initializedUnits.has(unit) || attempts >= 2) return;
      attempts++;
      void loadAdSense(client).then(() => {
        if (!active || !unit.isConnected || initializedUnits.has(unit)) return;
        // Google also marks filled units; preserve them across effect replays.
        if (unit.hasAttribute('data-adsbygoogle-status')) { initializedUnits.add(unit); return; }
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        initializedUnits.add(unit);
      }).catch(() => {
        if (active && attempts < 2) retry = setTimeout(initialize, 5_000);
      });
    };
    initialize();
    return () => { active = false; clearTimeout(retry); };
  }, [isNative, enabled, isDev, validSlot, client, identity, ready]);

  // Completely hidden on native platforms or when ads are disabled (default)
  if (isNative || !enabled || !isDev && !validSlot) {
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
      ref={containerRef}
      className="adsense-wrapper" 
      style={{ 
        margin: '24px auto', 
        width: '100%', 
        maxWidth: '1200px', 
        display: 'flex', 
        justifyContent: 'center',
        padding: '0 16px',
        boxSizing: 'border-box',
        minHeight: '100px'
      }}
    >
      {ready && <ins
        key={`${client}:${slot}`}
        ref={unitRef}
        className="adsbygoogle"
        style={{ width: '100%', ...style }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />}
    </div>
  );
};
