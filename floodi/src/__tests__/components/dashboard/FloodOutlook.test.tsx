import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FloodOutlook } from 'src/components/dashboard/FloodOutlook';
import type { SelectedWaterForecast } from 'src/utils/selectWaterForecast';
import type { ChallengerOutlookDocument } from 'src/components/dashboard/useChallengerOutlook';

const now = new Date('2026-10-19T10:00:00Z');
const at = (minutes: number) => new Date(+now + minutes * 60_000);
const points = [4, 4, 6.24, 4, 4].map((v, index) => ({ t: at(index * 6), v }));

const selection: SelectedWaterForecast = {
  totalPoints: points,
  residualPoints: [],
  method: 'learned',
  confidence: 'limited',
  horizonEnd: at(24),
  reason: 'Multi-regime operational physics selection.',
};

const challenger: ChallengerOutlookDocument = {
  challengerId: 'timesfm-3',
  locationId: 'carolina-beach',
  generatedAt: now.toISOString(),
  expiresAt: at(60).toISOString(),
  status: 'available',
  engine: 'timesfm-3-vertex-etss-hybrid',
  horizonSteps: 96,
  thresholdFt: 5.6,
  currentResidualFt: 0.84,
  points: [],
  peak: {
    t: at(12).toISOString(),
    totalFt: 6.24,
    tideFt: 5.4,
    residualFt: 0.84,
    exceedsThreshold: true,
  },
  covariatesUsed: [
    'noaa-etss-ocean-surge',
    'noaa-etss-cape-fear-river',
    'directional-nne-sound-wind-stress',
    'usgs-lock1-discharge',
  ],
  metadata: {
    historyPointsCount: 96,
    noaaSurgeAvailable: true,
    riverSurgeAvailable: true,
    usgsFlowAvailable: true,
    usgsDischargeCfs: 18450,
    estuarineHarmonics: {
      subtidalMeanFt: 0.31,
      m2AmpFt: 0.24,
      s1AmpFt: 0.09,
      m4AmpFt: 0.06,
      rSquared: 0.78,
    },
    retrievedAt: now.toISOString(),
  },
};

describe('operational resident flood outlook', () => {
  afterEach(cleanup);

  it('uses exact threshold crossings, real surge readout, and never displays Planning Outlook or fake +0.60', () => {
    render(
      <FloodOutlook
        selection={selection}
        challenger={challenger}
        thresholdFt={5.6}
        thresholds={{ minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 }}
        floodExpected
        isTimesFmPrimary
        now={now}
      />
    );

    expect(screen.getByText('Flooding forecast')).toBeInTheDocument();
    expect(screen.queryByText(/planning outlook/i)).not.toBeInTheDocument();
    expect(screen.getByText('6.24')).toBeInTheDocument();
    expect(screen.getByText('+0.64 ft above flood stage')).toBeInTheDocument();
    expect(screen.getByText('+0.84')).toBeInTheDocument();
    expect(screen.queryByText('+0.60')).not.toBeInTheDocument();
  });

  it('renders Unavailable instead of inventing +0.60 when current surge residual is missing or NaN', () => {
    const noResidualChallenger = { ...challenger, currentResidualFt: undefined };
    render(
      <FloodOutlook
        selection={selection}
        challenger={noResidualChallenger}
        currentSurgeFt={Number.NaN}
        thresholdFt={5.6}
        now={now}
      />
    );

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('+0.60')).not.toBeInTheDocument();
  });

  it('renders all 4 canonical Carolina Beach flood stages (5.6 / 7.0 / 7.7 / 8.5) and operational physics provenance', () => {
    const { container } = render(
      <FloodOutlook
        selection={selection}
        challenger={challenger}
        thresholds={{ minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 }}
        isTimesFmPrimary
        now={now}
      />
    );

    const details = container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');

    const pills = Array.from(container.querySelectorAll('.thresh-pill strong')).map(el =>
      el.textContent?.trim()
    );
    expect(pills).toEqual(['5.6 ft', '7.0 ft', '7.7 ft', '8.5 ft']);

    expect(within(details).queryByText(/6\.2 ft/)).not.toBeInTheDocument();
    expect(within(details).queryByText(/6\.8\+ ft/)).not.toBeInTheDocument();
    expect(within(details).queryByText(/Gemini 3\.8 Flash/i)).not.toBeInTheDocument();
    expect(within(details).queryByText(/Compare TimesFM-3 Challenger/i)).not.toBeInTheDocument();

    expect(within(details).getByText(/18,450 cfs/)).toBeInTheDocument();
    expect(within(details).getByText(/R² = 0\.78/)).toBeInTheDocument();
    expect(within(details).getByText(/USGS Cape Fear River Lock #1 \(02105769\)/)).toBeInTheDocument();
  });

  it('shows the actual covered horizon for dry or possible flooding without inventing an event', () => {
    const dry = { ...selection, totalPoints: points.map(point => ({ ...point, v: 4.2 })) };
    const { rerender } = render(
      <FloodOutlook
        selection={dry}
        challenger={challenger}
        thresholdFt={5.6}
        floodExpected={false}
        now={now}
      />
    );
    expect(screen.getByText('No flooding forecast')).toBeInTheDocument();
    expect(screen.getByText('Through Monday, Oct 19, 6:24 AM ET')).toBeInTheDocument();
    expect(screen.getByText('1.40 ft below flood stage')).toBeInTheDocument();

    rerender(
      <FloodOutlook
        selection={dry}
        challenger={challenger}
        thresholdFt={5.6}
        floodExpected={false}
        floodPossible
        now={now}
      />
    );
    expect(screen.getByText('Flooding possible')).toBeInTheDocument();
    expect(screen.getByText('The forecast error range reaches flood stage.')).toBeInTheDocument();
  });

  it('distinguishes tide-only fallback from a local no-flooding forecast', () => {
    render(
      <FloodOutlook
        outlook={null}
        challenger={null}
        selection={{
          ...selection,
          method: 'tide',
          confidence: 'unavailable',
          totalPoints: points.map(point => ({ ...point, v: 4 })),
        }}
        thresholdFt={5.6}
        now={now}
      />
    );
    expect(screen.getByText('Tide forecast only')).toBeInTheDocument();
    expect(screen.queryByText('No flooding forecast')).not.toBeInTheDocument();
    expect(screen.getByText('Outlook unavailable')).toBeInTheDocument();
  });
});
