import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastAccuracyModal } from 'src/components/dashboard/ForecastAccuracyModal';

// Mock IonModal and IonSegment to render cleanly and dispatch onIonChange in JSDOM
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
    IonSegment: ({ value, onIonChange, children, className }: any) => (
      <div data-testid="ion-segment" className={className} data-value={value}>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<any>, {
                onClick: () => onIonChange?.({ detail: { value: (child.props as Record<string, any>)?.value } }),
              })
            : child
        )}
      </div>
    ),
    IonSegmentButton: ({ value, onClick, children }: any) => (
      <button type="button" data-testid={`segment-button-${value}`} onClick={onClick}>
        {children}
      </button>
    ),
  };
});

vi.mock('src/components/dashboard/useForecastDiagnostics', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('src/components/dashboard/useForecastDiagnostics');
  return {
    ...actual,
    useForecastDiagnostics: () => ({
      diagnostics: actual.AUDITED_BASELINE_DIAGNOSTICS,
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
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

    // Segment buttons
    expect(screen.getByText('Verification Audit')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics & Proposals')).toBeInTheDocument();

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

  it('switches to Diagnostics & Proposals tab and displays model governance metrics', () => {
    const handleDismiss = vi.fn();
    render(
      <ForecastAccuracyModal
        isOpen={true}
        onDismiss={handleDismiss}
      />
    );

    // Switch segment to diagnostics
    const diagBtn = screen.getByText('Diagnostics & Proposals');
    fireEvent.click(diagBtn);

    // Verify diagnostics view header & stats
    expect(screen.getByText('Model Diagnostics & Tuning')).toBeInTheDocument();
    expect(screen.getByText('Optimal Calibration')).toBeInTheDocument();
    expect(screen.getByText('✓ Zero Drift')).toBeInTheDocument();
    expect(screen.getByText('7-Day Rolling MAE')).toBeInTheDocument();
    expect(screen.getByText('30-Day Benchmark MAE')).toBeInTheDocument();

    // Weather regime error matrix
    expect(screen.getByText('Meteorological Regime Error Matrix')).toBeInTheDocument();
    expect(screen.getByText('Calm (< 10 mph)')).toBeInTheDocument();
    expect(screen.getByText('Squall / Gale (> 20 mph)')).toBeInTheDocument();
    expect(screen.getByText('Accuracy by Wind Fetch Quadrant')).toBeInTheDocument();

    // Autonomous proposals
    expect(screen.getByText(/Autonomous Improvement Proposals/)).toBeInTheDocument();
    expect(screen.getByText('basinPhysics.ts:directionalWindStress')).toBeInTheDocument();
    expect(screen.getByText(/Squall regime \(>20 mph\) MAE is 3.4"/)).toBeInTheDocument();

    // Recent error attribution
    expect(screen.getByText('Recent Event Error Attribution')).toBeInTheDocument();
    expect(screen.getByText("Nor'easter King Tide Shallow Setup")).toBeInTheDocument();
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
