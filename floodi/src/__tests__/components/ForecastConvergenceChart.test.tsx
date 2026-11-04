import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ForecastConvergenceChart, { NOVEMBER_3_EVENT_SAMPLES } from 'src/components/dashboard/ForecastConvergenceChart';

describe('ForecastConvergenceChart Component', () => {
  it('renders case study title, subtitle, and badge with exact text', () => {
    render(<ForecastConvergenceChart />);

    expect(screen.getByText('Real-World Case Study')).toBeInTheDocument();
    expect(screen.getByText('Forecast Lock-In Convergence (November 3 High Tide)')).toBeInTheDocument();
    expect(
      screen.getByText(/Demonstrating how FloodCast locked in the 5\.82 ft crest across 24h, 12h, and 6h prior update cycles/)
    ).toBeInTheDocument();
  });

  it('renders all 5 peak convergence stat cards with exact crest values and error deltas', () => {
    render(<ForecastConvergenceChart />);

    // Observed
    expect(screen.getByText('Canal Gauge Crest')).toBeInTheDocument();
    expect(screen.getByText('5.82 ft')).toBeInTheDocument();
    expect(screen.getByText('Crested at 18:30 UTC')).toBeInTheDocument();

    // 6h Lead
    expect(screen.getByText('Lead: 6 Hours')).toBeInTheDocument();
    expect(screen.getByText('5.84 ft')).toBeInTheDocument();
    expect(screen.getByText('+0.2 in error · 99.7% match')).toBeInTheDocument();

    // 12h Lead
    expect(screen.getByText('Lead: 12 Hours')).toBeInTheDocument();
    expect(screen.getByText('5.80 ft')).toBeInTheDocument();
    expect(screen.getByText('−0.2 in error · 99.7% match')).toBeInTheDocument();

    // 24h Lead
    expect(screen.getByText('Lead: 24 Hours')).toBeInTheDocument();
    expect(screen.getByText('5.75 ft')).toBeInTheDocument();
    expect(screen.getByText('−0.8 in error · Flood predicted 24h prior')).toBeInTheDocument();

    // NOAA Astronomical Baseline
    expect(screen.getByText('Astronomical Only')).toBeInTheDocument();
    expect(screen.getByText('5.10 ft')).toBeInTheDocument();
    expect(screen.getByText('−8.6 in error · Missed flood threshold!')).toBeInTheDocument();
  });

  it('renders SVG curves and toggles curve visibility when legend buttons are clicked', () => {
    const { container } = render(<ForecastConvergenceChart />);

    // Initially all 5 curves are present in SVG
    expect(container.querySelector('path.curve.observed-line')).toBeInTheDocument();
    expect(container.querySelector('path.curve.forecast-6h')).toBeInTheDocument();
    expect(container.querySelector('path.curve.forecast-12h')).toBeInTheDocument();
    expect(container.querySelector('path.curve.forecast-24h')).toBeInTheDocument();
    expect(container.querySelector('path.curve.noaa-tide')).toBeInTheDocument();

    // Minor flood stage reference line (5.6 ft) is present
    expect(container.querySelector('line.threshold-line.minor')).toBeInTheDocument();
    expect(screen.getByText('5.6′ Minor Flood Stage (Canal Dr)')).toBeInTheDocument();

    // Toggle 24h curve off
    const btn24h = screen.getByRole('button', { name: /24h Locked-In/i });
    expect(btn24h).toHaveAttribute('aria-pressed', 'true');
    expect(btn24h.classList.contains('active')).toBe(true);

    fireEvent.click(btn24h);
    expect(btn24h).toHaveAttribute('aria-pressed', 'false');
    expect(btn24h.classList.contains('inactive')).toBe(true);
    expect(container.querySelector('path.curve.forecast-24h')).toBeNull();

    // Toggle 24h curve back on
    fireEvent.click(btn24h);
    expect(btn24h).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('path.curve.forecast-24h')).toBeInTheDocument();

    // Toggle NOAA curve off
    const btnNoaa = screen.getByRole('button', { name: /NOAA Tide Only/i });
    fireEvent.click(btnNoaa);
    expect(container.querySelector('path.curve.noaa-tide')).toBeNull();
  });

  it('updates the inspector values when clicking a specific time slice', () => {
    render(<ForecastConvergenceChart />);

    // Default inspection is at peak (18:30)
    expect(screen.getByText('Time: 18:30 (Peak) UTC (Nov 3)')).toBeInTheDocument();

    // Find touch slice for 12:00
    const slice1200 = screen.getByLabelText('Inspect 12:00');
    fireEvent.click(slice1200);

    // Inspector should now reflect 12:00
    expect(screen.getByText('Time: 12:00 UTC (Nov 3)')).toBeInTheDocument();
    expect(screen.getByText('1.40′')).toBeInTheDocument(); // Observed at 12:00
    expect(screen.getByText('1.41′')).toBeInTheDocument(); // 6h forecast at 12:00
    expect(screen.getByText('1.42′')).toBeInTheDocument(); // 12h forecast at 12:00
    expect(screen.getByText('1.45′')).toBeInTheDocument(); // 24h forecast at 12:00
    expect(screen.getByText('1.20′')).toBeInTheDocument(); // NOAA tide at 12:00
  });

  it('validates calibration constants across all 18 hourly sample points', () => {
    expect(NOVEMBER_3_EVENT_SAMPLES).toHaveLength(18);

    // Peak sample is at index 11
    const peak = NOVEMBER_3_EVENT_SAMPLES[11];
    expect(peak.timeLabel).toBe('18:30 (Peak)');
    expect(peak.hourFloat).toBe(18.5);
    expect(peak.observed).toBe(5.82);
    expect(peak.forecast6h).toBe(5.84);
    expect(peak.forecast12h).toBe(5.80);
    expect(peak.forecast24h).toBe(5.75);
    expect(peak.noaaTide).toBe(5.10);

    // All locked-in forecasts correctly surpass the 5.6 ft flood stage at peak
    expect(peak.forecast6h).toBeGreaterThan(5.6);
    expect(peak.forecast12h).toBeGreaterThan(5.6);
    expect(peak.forecast24h).toBeGreaterThan(5.6);

    // Astronomical tide only failed to predict flooding (< 5.6 ft)
    expect(peak.noaaTide).toBeLessThan(5.6);
  });
});

