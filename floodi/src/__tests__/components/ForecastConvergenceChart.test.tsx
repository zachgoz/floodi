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
      screen.getByText(/Demonstrating how FloodCast locked in the 4\.91 ft crest across 24h, 12h, and 6h prior update cycles/)
    ).toBeInTheDocument();
  });

  it('renders all 5 peak convergence stat cards with exact hydrograph water levels and error deltas', () => {
    render(<ForecastConvergenceChart />);

    // Observed (Gauge 8658163 / Carolina Beach)
    expect(screen.getByText('Canal Gauge Crest')).toBeInTheDocument();
    expect(screen.getByText('4.91 ft')).toBeInTheDocument();
    expect(screen.getByText('Crested at 19:24 UTC · Gauge 8658163')).toBeInTheDocument();

    // 6h Lead
    expect(screen.getByText('Lead: 6 Hours')).toBeInTheDocument();
    expect(screen.getByText('4.88 ft')).toBeInTheDocument();
    expect(screen.getByText('−0.4 in error · 99.4% match')).toBeInTheDocument();

    // 12h Lead
    expect(screen.getByText('Lead: 12 Hours')).toBeInTheDocument();
    expect(screen.getByText('4.85 ft')).toBeInTheDocument();
    expect(screen.getByText('−0.7 in error · 98.8% match')).toBeInTheDocument();

    // 24h Lead
    expect(screen.getByText('Lead: 24 Hours')).toBeInTheDocument();
    expect(screen.getByText('4.80 ft')).toBeInTheDocument();
    expect(screen.getByText('−1.3 in error · Outperformed tide tables')).toBeInTheDocument();

    // NOAA Astronomical Baseline
    expect(screen.getByText('Astronomical Only')).toBeInTheDocument();
    expect(screen.getByText('4.46 ft')).toBeInTheDocument();
    expect(screen.getByText('−5.4 in error · Missed coastal surge!')).toBeInTheDocument();
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

    // Default inspection is at peak (19:24)
    expect(screen.getByText('Time: 19:24 (Peak) UTC (Nov 3)')).toBeInTheDocument();

    // Find touch slice for 12:00
    const slice1200 = screen.getByLabelText('Inspect 12:00');
    fireEvent.click(slice1200);

    // Inspector should now reflect 12:00
    expect(screen.getByText('Time: 12:00 UTC (Nov 3)')).toBeInTheDocument();
    expect(screen.getByText('1.49′')).toBeInTheDocument(); // Observed at 12:00
    expect(screen.getByText('1.48′')).toBeInTheDocument(); // 6h forecast at 12:00
    expect(screen.getByText('1.45′')).toBeInTheDocument(); // 12h forecast at 12:00
    expect(screen.getByText('1.42′')).toBeInTheDocument(); // 24h forecast at 12:00
    expect(screen.getByText('1.10′')).toBeInTheDocument(); // NOAA tide at 12:00
  });

  it('validates calibration constants across all 15 sample points matching verified hydrograph records', () => {
    expect(NOVEMBER_3_EVENT_SAMPLES).toHaveLength(15);

    // Peak sample is at index 9
    const peak = NOVEMBER_3_EVENT_SAMPLES[9];
    expect(peak.timeLabel).toBe('19:24 (Peak)');
    expect(peak.hourFloat).toBe(19.4);
    expect(peak.observed).toBe(4.91);
    expect(peak.forecast6h).toBe(4.88);
    expect(peak.forecast12h).toBe(4.85);
    expect(peak.forecast24h).toBe(4.80);
    expect(peak.noaaTide).toBe(4.46);

    // Trough sample at index 3
    const trough = NOVEMBER_3_EVENT_SAMPLES[3];
    expect(trough.timeLabel).toBe('14:00 (Trough)');
    expect(trough.hourFloat).toBe(14.0);
    expect(trough.observed).toBe(1.21);
    expect(trough.noaaTide).toBe(0.78);
  });
});
