import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChartData } from 'src/components/Tab2/hooks/useChartData';
import type { AppConfiguration } from 'src/components/Tab2/types';

vi.mock('src/components/Tab2/hooks/useChartData', () => ({ useChartData: vi.fn() }));
vi.mock('src/components/Tab2/hooks/useSettingsStorage', () => ({ useSettingsStorage: () => ({ config, updateLocation: vi.fn(), updateThresholds: vi.fn(), updateOffset: vi.fn(), updateTimeRange: vi.fn(), updateDisplay: vi.fn(), resetToDefaults: vi.fn() }) }));
vi.mock('src/components/Tab2/hooks/useAtmosphericState', () => ({ useAtmosphericState: () => ({ activeAtmo: { wl: null, isLive: true, isSimulated: false, targetTime: null }, simulationLevel: 0, setSimulationLevel: vi.fn(), setIsUserSimulating: vi.fn() }) }));
vi.mock('src/components/Tab2/hooks/useChartComments', () => ({ useChartComments: () => ({ comments: [] }) }));
vi.mock('src/components/dashboard/useFloodOutlook', () => ({ useFloodOutlook: () => ({ outlook: null, refresh: vi.fn() }) }));
vi.mock('src/components/dashboard/useChallengerOutlook', () => ({ useChallengerOutlook: () => ({ challenger: null, loading: false, refresh: vi.fn(), totalPoints: [], lowerPoints: [], upperPoints: [], residualPoints: [] }) }));
vi.mock('src/components/dashboard/InundationMap', () => ({ default: () => <div data-testid="loaded-map">Flood map</div> }));
vi.mock('@vis.gl/react-google-maps', () => ({ APIProvider: ({ children }: React.PropsWithChildren) => <>{children}</> }));
vi.mock('src/components/dashboard/SurgeChart', () => ({ SurgeChart: () => null }));
vi.mock('src/components/dashboard/HydrographChart', () => ({ default: () => <div>Water level chart</div> }));
vi.mock('src/components/dashboard/AtmosphericOverlay', () => ({ default: () => null }));
vi.mock('src/components/dashboard/InundationSimulator', () => ({ default: () => null }));
vi.mock('src/components/dashboard/WebcamFeedCard', () => ({ default: () => null }));
vi.mock('src/components/dashboard/NextFloodingEventsCard', () => ({ default: () => null }));
vi.mock('src/components/dashboard/FloodOutlook', () => ({ FloodOutlook: () => null }));
vi.mock('src/components/Tab2/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('src/components/Tab2/TimeSettingsModal', () => ({ TimeSettingsModal: () => null }));
vi.mock('src/components/Tab2/ChartCommentModal', () => ({ ChartCommentModal: () => null }));
vi.mock('src/components/onboarding/IntroTourOverlay', () => ({ IntroTourOverlay: () => null }));
vi.mock('src/components/alerts/AlertInvitation', () => ({ AlertInvitation: () => null }));
vi.mock('src/components/common/AdSenseUnit', () => ({ AdSenseUnit: () => null }));
import Tab2 from 'src/pages/Tab2';

const config: AppConfiguration = {
  locationId: 'carolina-beach', location: { id: 'carolina-beach', name: 'Carolina Beach', state: 'NC' }, station: { id: '8658163', name: 'Carolina Beach' },
  thresholds: { minor: 5.6, moderate: 7, major: 7.7, extreme: 8.5 }, offset: { mode: 'auto', value: '' },
  timeRange: { mode: 'relative', lookbackH: 36, lookaheadH: 48, absStart: '', absEnd: '' },
  display: { timezone: 'local', dataSource: 'fiman', showDelta: false, viewMode: 'basic' },
};
const now = new Date('2026-10-16T12:00:00Z');
const domain = { start: new Date(+now - 36 * 3600_000), end: new Date(+now + 48 * 3600_000), now };
const state = {
  loading: false, error: null, refresh: vi.fn(), data: {},
  processedData: { observedPoints: [], predictedPoints: [], adjustedPoints: [], deltaPoints: [], windPoints: [], precipPoints: [], surgeForecastPoints: [], timeDomain: domain, loadedDomain: domain, observationStation: '30046', source: 'fiman', imagery: {}, floodEvents: [] },
} as unknown as ReturnType<typeof useChartData>;
let observerCallback: IntersectionObserverCallback;
const send = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useChartData).mockReturnValue(state);
  vi.stubGlobal('fetch', send);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('below-fold map startup', () => {
  it('renders the primary chart without downloading road data while the map is off screen', async () => {
    render(<MemoryRouter><Tab2 /></MemoryRouter>);
    expect(screen.getByText('Water level chart')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Flood map loading' })).toHaveStyle({ height: '420px' });
    expect(send).not.toHaveBeenCalled();
    act(() => observerCallback([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByTestId('loaded-map')).not.toBeInTheDocument();
  });

  it('loads the map on approach and reuses a stable road URL across mounts', async () => {
    const first = render(<MemoryRouter><Tab2 /></MemoryRouter>);
    act(() => observerCallback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(await screen.findByTestId('loaded-map')).toBeInTheDocument();
    expect(send).toHaveBeenCalledOnce();
    const firstUrl = send.mock.calls[0][0];
    expect(firstUrl).toMatch(/^\/data\/carolinaBeachRoads\.geojson\?v=/);
    first.unmount();
    render(<MemoryRouter><Tab2 /></MemoryRouter>);
    act(() => observerCallback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(await screen.findByTestId('loaded-map')).toBeInTheDocument();
    expect(send.mock.calls[1][0]).toBe(firstUrl);
  });
});
