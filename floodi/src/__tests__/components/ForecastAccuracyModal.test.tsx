import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastAccuracyModal } from 'src/components/dashboard/ForecastAccuracyModal';

// Mock IonModal to render children directly when open (Ionic overlays don't mount in JSDOM)
vi.mock('@ionic/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ionic/react');
  return {
    ...actual,
    IonModal: ({ isOpen, children, className, 'aria-label': ariaLabel }: { isOpen: boolean; children: React.ReactNode; className?: string; 'aria-label'?: string }) => (
      isOpen ? (
        <div data-testid="ion-modal" className={className} aria-label={ariaLabel}>
          {children}
        </div>
      ) : null
    ),
  };
});

describe('ForecastAccuracyModal Component', () => {
  it('renders modal with empirical accuracy highlights when open', () => {
    const handleDismiss = vi.fn();
    render(
      <ForecastAccuracyModal
        isOpen={true}
        onDismiss={handleDismiss}
      />
    );

    // Title & subtitle
    expect(screen.getByText('Scientific Accuracy Audit')).toBeInTheDocument();
    expect(screen.getByText('FloodCast Forecast Accuracy')).toBeInTheDocument();

    // Key stat highlights
    expect(screen.getByText('2.4 in')).toBeInTheDocument();
    expect(screen.getByText('24-Hour Horizon MAE')).toBeInTheDocument();
    expect(screen.getByText('1.4 in')).toBeInTheDocument();
    expect(screen.getByText('1-Hour Lead MAE')).toBeInTheDocument();
    expect(screen.getByText('±26.8 min')).toBeInTheDocument();
    expect(screen.getByText('77%')).toBeInTheDocument();

    // Lead-time error breakdown
    expect(screen.getByText('Water-Level Error Profile by Lead Time')).toBeInTheDocument();
    expect(screen.getByText('0.199 ft (2.4 in)')).toBeInTheDocument();
    expect(screen.getByText('0.116 ft (1.4 in)')).toBeInTheDocument();

    // Model comparison benchmarks
    expect(screen.getByText('NOAA Tide Tables Only')).toBeInTheDocument();
    expect(screen.getByText('10.8 in MAE')).toBeInTheDocument();
    expect(screen.getByText('Raw Ocean Surge (ETSS)')).toBeInTheDocument();
    expect(screen.getByText('4.0 in MAE')).toBeInTheDocument();
    expect(screen.getByText('TimesFM + Basin Physics')).toBeInTheDocument();

    // Physical couplings
    expect(screen.getByText('Directional N/NE Wind Stress')).toBeInTheDocument();
    expect(screen.getByText('Cape Fear River Backwater Head')).toBeInTheDocument();
    expect(screen.getByText('Estuarine Shallow-Water Harmonics (M₂, S₁, M₄)')).toBeInTheDocument();

    // Flood stage calibration
    expect(screen.getByText('5.6 ft Minor')).toBeInTheDocument();
    expect(screen.getByText('7.0 ft Moderate')).toBeInTheDocument();
    expect(screen.getByText('7.7 ft Major')).toBeInTheDocument();
    expect(screen.getByText('8.5 ft Extreme')).toBeInTheDocument();
  });

  it('triggers onDismiss when close button is clicked', () => {
    const handleDismiss = vi.fn();
    render(
      <ForecastAccuracyModal
        isOpen={true}
        onDismiss={handleDismiss}
      />
    );

    const closeBtn = screen.getByLabelText('Close accuracy audit');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
