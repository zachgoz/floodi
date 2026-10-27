import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloodOutlook } from 'src/components/dashboard/FloodOutlook';
import type { SelectedWaterForecast } from 'src/utils/selectWaterForecast';
import type { ForecastDocument } from '../../../../functions/src/forecast/schema';

const now = new Date('2026-10-19T10:00:00Z');
const at = (minutes: number) => new Date(+now + minutes * 60_000);
const points = [4, 4, 6, 4, 4].map((v, index) => ({ t: at(index * 6), v }));
const outlook: ForecastDocument = {
  version: 1, status: 'available', method: 'residual-response', confidence: 'limited', validationStage: 'historical-hindcast',
  generatedAt: now.toISOString(), expiresAt: at(30).toISOString(), locationId: 'carolina-beach', sensor: '30046', tideStation: '8658163',
  datum: 'MLLW', units: 'ft', phaseMinutes: 60, thresholdFt: 5, currentResidualFt: .2, trend: 'Stable', points: [], validation: null,
  evidence: [{ id: 'weather', text: 'Technical weather relationship text.' }, { id: 'validation', text: 'Source evaluation detail.' }],
  explanation: { headline: 'Elevated flood risk', evidenceIds: ['weather'] }, explanationSource: 'gemini-3.8-flash',
  sources: ['Synthetic gauge fixture'], limitations: ['Synthetic test only.'],
};
const selection: SelectedWaterForecast = { totalPoints: points, residualPoints: [], method: 'learned', confidence: 'limited', horizonEnd: at(24), reason: 'Technical selection reason.' };
const props = { outlook, selection, showComparison: false, onToggle: vi.fn(), thresholdFt: 5, now };

describe('compact resident flood outlook', () => {
  afterEach(cleanup);
  it('uses the actual threshold crossings for its next-event period', () => {
    render(<FloodOutlook {...props} floodExpected />);
    expect(screen.getByText('Flooding forecast')).toBeInTheDocument();
    expect(screen.getByText('Monday, Oct 19 · 6:09 AM – 6:15 AM')).toBeInTheDocument();
    expect(screen.queryByText(/Net increase/)).not.toBeInTheDocument();
  });
  it('keeps provider, raw evidence, comparison and source provenance inside the closed disclosure', () => {
    const { container } = render(<FloodOutlook {...props} />);
    const details = container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText(/Gemini 3.8 Flash explanation/)).toBeInTheDocument();
    expect(within(details).getByText('Technical weather relationship text.')).toBeInTheDocument();
    expect(within(details).getByText('Source evaluation detail.')).toBeInTheDocument();
    expect(within(details).getByText(/Synthetic gauge fixture/)).toBeInTheDocument();
    fireEvent.click(within(details).getByLabelText('Compare steady surge projection'));
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(container.querySelector('.outlook-risk-label')).not.toHaveTextContent(/Gemini|Technical/);
  });
  it('marks historical-pattern events as planning outlooks using supplied method timing', () => {
    const tail = { method: 'historical-pattern', startsAt: at(6).toISOString(), endsAt: at(24).toISOString(), weatherSupportedUntil: null, summary: { validationLeads: [] } } as unknown as NonNullable<ForecastDocument['tail']>;
    render(<FloodOutlook {...props} outlook={{ ...outlook, tail }} selection={{ ...selection, tailMethod: 'historical-pattern' }} />);
    expect(screen.getByText('Flooding in the planning outlook')).toBeInTheDocument();
  });
  it('shows the actual covered horizon for dry or possible flooding without inventing an event', () => {
    const dry = { ...selection, totalPoints: points.map(point => ({ ...point, v: 4 })) };
    const { rerender } = render(<FloodOutlook {...props} selection={dry} floodExpected={false} />);
    expect(screen.getByText('No flooding forecast')).toBeInTheDocument();
    expect(screen.getByText('Through Monday, Oct 19, 6:24 AM ET')).toBeInTheDocument();
    rerender(<FloodOutlook {...props} selection={dry} floodExpected={false} floodPossible />);
    expect(screen.getByText('Flooding possible')).toBeInTheDocument();
    expect(screen.getByText('The forecast error range reaches flood stage.')).toBeInTheDocument();
  });
  it('distinguishes tide-only fallback from a local no-flooding forecast', () => {
    render(<FloodOutlook {...props} outlook={null} selection={{ ...selection, method: 'tide', confidence: 'unavailable', totalPoints: points.map(point => ({ ...point, v: 4 })) }} />);
    expect(screen.getByText('Tide forecast only')).toBeInTheDocument();
    expect(screen.queryByText('No flooding forecast')).not.toBeInTheDocument();
    expect(screen.getByText('Outlook unavailable')).toBeInTheDocument();
  });
  it('renders and toggles challenger comparison when challenger outlook is available', () => {
    const onToggleChallenger = vi.fn();
    const challenger = {
      challengerId: 'timesfm-3',
      locationId: 'carolina-beach',
      generatedAt: now.toISOString(),
      expiresAt: at(60).toISOString(),
      status: 'available' as const,
      engine: 'timesfm-3-vertex-etss-hybrid',
      horizonSteps: 48,
      thresholdFt: 5.6,
      points: [],
      peak: {
        t: at(12).toISOString(),
        totalFt: 5.82,
        tideFt: 4.1,
        residualFt: 1.72,
        exceedsThreshold: true,
      },
      covariatesUsed: ['noaa-etss-surge'],
    };
    const { container, rerender } = render(
      <FloodOutlook
        {...props}
        challenger={challenger}
        showChallenger={false}
        onToggleChallenger={onToggleChallenger}
      />
    );
    const details = container.querySelector('details')!;
    expect(within(details).getByText('Compare TimesFM-3 Challenger')).toBeInTheDocument();
    expect(within(details).getByText('AI + NOAA ETSS')).toBeInTheDocument();
    expect(within(details).queryByText(/Challenger Peak/)).not.toBeInTheDocument();

    fireEvent.click(within(details).getByLabelText(/Compare TimesFM-3 Challenger/));
    expect(onToggleChallenger).toHaveBeenCalledOnce();

    rerender(
      <FloodOutlook
        {...props}
        challenger={challenger}
        showChallenger={true}
        onToggleChallenger={onToggleChallenger}
      />
    );
    expect(within(details).getByText(/5.82 ft/)).toBeInTheDocument();
    expect(within(details).getByText(/(Flooding)/)).toBeInTheDocument();
    expect(within(details).getByText(/Horizon: 24h/)).toBeInTheDocument();
  });
});

