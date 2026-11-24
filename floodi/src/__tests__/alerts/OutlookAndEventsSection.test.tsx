import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { OutlookAndEventsSection } from 'src/components/alerts/OutlookAndEventsSection';
import type { AppConfiguration } from 'src/components/Tab2/types';

vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>();
  return {
    ...actual,
    IonModal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});

const config: AppConfiguration = {
  locationId: 'carolina-beach',
  location: { id: 'carolina-beach', name: 'Carolina Beach', state: 'NC' },
  station: { id: '8658163', name: 'Carolina Beach' },
  thresholds: { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 },
  offset: { mode: 'auto', value: '' },
  timeRange: { mode: 'relative', lookbackH: 36, lookaheadH: 48, absStart: '', absEnd: '' },
  display: { timezone: 'local', dataSource: 'fiman', showDelta: false, viewMode: 'basic' },
};

const now = new Date('2026-10-16T12:00:00Z');
const pt = (min: number, v: number) => ({ t: new Date(+now + min * 60_000), v });
const floodCurve = [
  pt(0, 4.4),
  pt(60, 5.4),
  pt(120, 6.25),
  pt(180, 5.2),
];

const mockUseOperationalForecast = vi.fn();
vi.mock('src/components/Tab2/hooks/useSettingsStorage', () => ({
  useSettingsStorage: () => ({ config }),
}));
vi.mock('src/components/dashboard/useOperationalForecast', () => ({
  useOperationalForecast: () => mockUseOperationalForecast(),
}));

describe('OutlookAndEventsSection (combined Outlook & Alerts tab)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOperationalForecast.mockReturnValue({
      loading: false,
      processedData: {
        observedPoints: [pt(0, 4.4)],
        predictedPoints: floodCurve,
        adjustedPoints: floodCurve,
        deltaPoints: [pt(0, 0.55)],
        windPoints: [ { t: pt(120, 0).t, speed: 18, dir: 45 } ],
        precipPoints: [ { t: pt(120, 0).t, value: 0.2 } ],
        floodEvents: [],
        timeDomain: { start: pt(-60, 0).t, end: pt(360, 0).t, now },
      },
      challenger: null,
      selectedForecast: {
        method: 'steady',
        totalPoints: floodCurve,
        residualPoints: [pt(0, 0.55), pt(120, 0.65)],
        horizonEnd: pt(180, 0).t,
        reason: 'Steady forecast',
      },
      isTimesFmPrimary: false,
      operationalForecastPoints: floodCurve,
      operationalSurgePoints: [pt(0, 0.55), pt(120, 0.65)],
      operationalUpper: [],
      operationalForecastDescription: 'Steady forecast',
    });
  });

  it('renders both Next Flooding Events and Flood Outlook and deep-links event peaks back to /tab2?t=...', () => {
    const history = createMemoryHistory({ initialEntries: ['/alerts'] });
    const { container } = render(
      <Router history={history}>
        <OutlookAndEventsSection />
      </Router>,
    );

    // Next Flooding Events card displays peak 6.25 ft
    const eventsCard = container.querySelector('.next-flood-card')!;
    expect(eventsCard).not.toBeNull();
    expect(eventsCard.textContent).toContain('Next Flooding Events');
    expect(eventsCard.textContent).toContain('6.25');

    // Flood Outlook card renders alongside it in the combined section
    const outlookCard = container.querySelector('.dashboard-outlook-card')!;
    expect(outlookCard).not.toBeNull();
    expect(outlookCard.textContent).toContain('Flooding forecast');
    expect(outlookCard.textContent).toContain('6.25');

    // Opening the event modal and jumping to the peak navigates to /tab2?t=<peakISO>
    fireEvent.click(eventsCard.querySelector('.next-flood-item')!);
    const viewOnChartBtn = screen.getByText('View Peak on Hydrograph');
    fireEvent.click(viewOnChartBtn);
    expect(history.location.pathname).toBe('/tab2');
    expect(history.location.search).toBe(`?t=${encodeURIComponent(pt(120, 6.25).t.toISOString())}`);
  });

  it('renders nothing cleanly when forecast data is unavailable and not loading', () => {
    mockUseOperationalForecast.mockReturnValue({
      loading: false,
      processedData: null,
      challenger: null,
      selectedForecast: { method: 'tide', totalPoints: [], residualPoints: [], horizonEnd: null, reason: '' },
      isTimesFmPrimary: false,
      operationalForecastPoints: [],
      operationalSurgePoints: [],
      operationalUpper: [],
      operationalForecastDescription: '',
    });
    const history = createMemoryHistory({ initialEntries: ['/alerts'] });
    const { container } = render(
      <Router history={history}>
        <OutlookAndEventsSection />
      </Router>,
    );
    expect(container.firstChild).toBeNull();
  });
});
