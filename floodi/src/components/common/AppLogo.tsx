import React from 'react';

interface LogoProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * AppLogo Component
 * 
 * A theme-aware SVG logo that adapts its colors based on the active theme.
 * Replaces the static SVG image to handle light/dark mode transitions gracefully.
 */
export const AppLogo: React.FC<LogoProps> = ({ className, style }) => {
  return (
    <svg 
      viewBox="0 0 600 160" 
      className={className} 
      style={{ ...style, borderRadius: '24px', overflow: 'hidden' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--ion-color-secondary, #00bcd4)"/>
          <stop offset="100%" stopColor="var(--ion-color-primary, #1976d2)"/>
        </linearGradient>
      </defs>
      
      {/* Background - using themed variable */}
      <rect 
        width="600" 
        height="160" 
        fill="var(--logo-bg, transparent)" 
        className="logo-background"
      />
      
      {/* Icon */}
      <g transform="translate(36,20)">
        <path 
          d="M64 0c-24 42-60 66-60 100 0 33 27 60 60 60s60-27 60-60C124 66 88 42 64 0z" 
          fill="url(#logo-grad)"
        />
        <g fill="none" stroke="var(--logo-text, #e3f2fd)" strokeWidth="6" strokeLinecap="round" style={{ transition: 'stroke 0.3s ease' }}>
          <path d="M64 40c20 0 36 16 36 36"/>
          <path d="M64 24c28 0 52 24 52 52" opacity=".7"/>
          <path d="M64 10c38 0 66 28 66 66" opacity=".4"/>
        </g>
        <circle cx="64" cy="78" r="12" fill="var(--logo-text, #e3f2fd)" style={{ transition: 'fill 0.3s ease' }} />
      </g>
      
      {/* Wordmark - Text based for better accessibility and theme rendering */}
      <text 
        x="180" 
        y="115" 
        fill="var(--logo-text, #e3f2fd)" 
        style={{ 
          fontSize: '96px', 
          fontWeight: 800, 
          fontFamily: "'Outfit', 'Inter', sans-serif",
          letterSpacing: '-0.04em',
          transition: 'fill 0.3s ease'
        }}
      >
        FloodCast
      </text>
    </svg>
  );
};
