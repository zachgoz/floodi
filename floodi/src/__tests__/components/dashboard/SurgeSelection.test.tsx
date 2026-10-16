import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurgeChart } from 'src/components/dashboard/SurgeChart';
import type { ForecastDocument } from '../../../../functions/src/forecast/schema';
const at = (h: number) => new Date(Date.UTC(2026, 9, 16) + h * 3600_000);
const forecast = [{ t: at(2), v: .4 }, { t: at(4), v: 1.7 }];
describe('surge selected-time UI', () => {
  it('updates the readout and selected point when shared chart focus moves', () => {
    const props = { now: at(1), points: [{ t: at(0), v: .1 }, { t: at(1), v: .2 }], forecast, viewport: { start: at(0), end: at(5) } };
    const { rerender, container } = render(<SurgeChart {...props} focusTime={at(1)} />);
    expect(container.querySelector('.surge-readout strong')).toHaveTextContent('+0.20 ft');
    rerender(<SurgeChart {...props} focusTime={at(4)} />);
    expect(container.querySelector('.surge-readout strong')).toHaveTextContent('+1.70 ft');
    expect(container.querySelector('.surge-readout')).toHaveTextContent('Forecast');
    expect(container.querySelector('.surge-readout')).not.toHaveTextContent('Stable');
    expect(screen.getByTestId('surge-selected-point')).toBeInTheDocument();
    rerender(<SurgeChart {...props} focusTime={at(6)} />);
    expect(container.querySelector('.surge-readout')).toHaveTextContent('Unavailable');
  });
  it('shows all model factors on demand without assuming wind or rain is the cause', () => {
    const document = { driverInfo: { version: 1 }, points: [{ t: at(4).toISOString(), residualFt: 1.5, drivers: { m: 'h', c: [.5, .1, .1, .3, 0, 0, 0, .5] } }] } as unknown as ForecastDocument;
    render(<SurgeChart points={[]} forecast={forecast} forecastDocument={document} now={at(1)} focusTime={at(4)} viewport={{ start: at(0), end: at(5) }} />);
    const panel = screen.getByLabelText('Selected forecast factors');
    expect(panel).toHaveTextContent('Measured water anomaly');
    expect(panel).toHaveTextContent('Historical tide pattern');
    expect(panel).toHaveTextContent('Tide reference adjustment');
    expect(panel).toHaveTextContent('Air pressure');
    expect(panel).toHaveTextContent('statistical associations');
    expect(panel).not.toHaveTextContent('6h wind:');
  });
});
