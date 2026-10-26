import { useCallback, useState } from 'react';
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ChartViewer } from "src/components/Tab2/ChartViewer";
import { SurgeChart } from "src/components/dashboard/SurgeChart";
import { HydrographChart } from "src/components/dashboard/HydrographChart";
import { ForecastTimeControls } from "src/components/dashboard/ForecastTimeControls";
import { useChartInteraction } from 'src/components/Tab2/hooks/useChartInteraction';
import { NextFloodingEventsCard } from "src/components/dashboard/NextFloodingEventsCard";
const now = new Date("2026-10-10T10:00:00Z");
const p = (m: number, v: number) => ({ t: new Date(+now + m * 60_000), v });
const thresholds = { minor: 5, moderate: 7, major: 8, extreme: 9 };
describe("forecast chart behavior", () => {
  it('clips a native forecast at the live display handoff without changing its physical samples or adding flood shading', () => {
    const observed = [p(-30, 4.4), p(-15, 4.6), { ...p(0, 4.8), estimated: true }];
    const forecast = [p(-6, 6), p(6, 6), p(12, 4)];
    const snapshot = JSON.stringify(forecast);
    const { container } = render(<ChartViewer locationId="carolina-beach" observedPoints={observed}
      predictedPoints={[]} adjustedPoints={forecast} deltaPoints={[]} domainStart={p(-60, 0).t}
      domainEnd={p(60, 0).t} now={now} thresholds={thresholds} showDelta={false} timezone="local" />);
    const line = screen.getByLabelText('Forecast total water level');
    const nativeXs = line.getAttribute('points')!.split(' ').map(point => Number(point.split(',')[0]));
    const estimateEndX = Number(screen.getByLabelText('Estimated localized water level')
      .getAttribute('points')!.split(' ').at(-1)!.split(',')[0]);
    const clip = container.querySelector('[data-testid="water-forecast-clip"]')!;
    expect(Number(clip.getAttribute('x'))).toBe(estimateEndX);
    expect(nativeXs[0]).toBeLessThan(estimateEndX);
    expect(nativeXs).toHaveLength(forecast.length);
    expect(line).toHaveAttribute('clip-path', `url(#${clip.parentElement!.id})`);
    expect(container.querySelectorAll('[data-testid="forecast-flood-shading"]')).toHaveLength(0);
    expect(line).toHaveAttribute('fill', 'none');
    expect(line).toHaveAttribute('stroke', 'url(#adj-flood-gradient)');
    expect(JSON.stringify(forecast)).toBe(snapshot);
  });
  it('clips the residual forecast after the estimated bridge while retaining native residuals', () => {
    const measured = [p(-30, .2), p(-15, .4)];
    const estimates = [p(-15, .4), p(0, .6)];
    const forecast = [p(-6, .7), p(6, .8)];
    const { container } = render(<SurgeChart points={measured} estimatedPoints={estimates} forecast={forecast}
      now={now} viewport={{ start: p(-60, 0).t, end: p(60, 0).t }} />);
    const line = container.querySelector('[data-testid="residual-forecast"]')!;
    const clip = container.querySelector('[data-testid="surge-forecast-clip"]')!;
    const estimateEndX = Number(container.querySelector('[data-testid="estimated-residual"]')!
      .getAttribute('points')!.split(' ').at(-1)!.split(',')[0]);
    expect(Number(clip.getAttribute('x'))).toBe(estimateEndX);
    expect(line).toHaveAttribute('clip-path', `url(#${clip.parentElement!.id})`);
    const nativeXs = line.getAttribute('points')!.split(' ').map(point => Number(point.split(',')[0]));
    expect(nativeXs).toHaveLength(forecast.length);
    expect(nativeXs[0]).toBeLessThan(estimateEndX);
  });
  it.each([
    { points: [] },
    { points: [p(-12, 4), p(-6, 4)] },
    { points: [p(6, 4)] },
    { points: [{ t: new Date('invalid'), v: 4 }, p(6, Number.NaN)] },
  ])('does not report a safe forecast when future coverage is unavailable: $points', ({ points }) => {
    render(<NextFloodingEventsCard adjustedPoints={points} predictedPoints={[]}
      windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Forecast unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No flooding predicted' })).not.toBeInTheDocument();
  });
  it('reports no flooding only when a finite future forecast is available', () => {
    render(<NextFloodingEventsCard adjustedPoints={[]} predictedPoints={[p(0, 4), p(6, 4.1)]}
      windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No flooding predicted' })).toBeInTheDocument();
  });
  it('keeps the ending date in a flood window crossing local midnight', () => {
    const midnight = new Date('2026-10-11T03:54:00Z');
    const points = [4, 6, 4].map((v, i) => ({ t: new Date(+midnight + i * 6 * 60_000), v }));
    render(<NextFloodingEventsCard adjustedPoints={points} predictedPoints={[]}
      windPoints={[]} precipPoints={[]} thresholds={thresholds} now={midnight} onTimeChange={vi.fn()} />);
    const window = screen.getByText('11:57 PM – Sunday, Oct 11, 12:03 AM');
    expect(window.closest('ion-label')).toHaveClass('ion-text-wrap');
    expect(screen.getByText('Saturday, Oct 10')).toBeInTheDocument();
  });
  it('keeps possible flooding visible without shading below-stage central forecasts', () => {
    const central = [p(0, 4), p(60, 4.8), p(120, 4)];
    const { container } = render(<>
      <NextFloodingEventsCard adjustedPoints={central} predictedPoints={central} upperForecastPoints={[p(0,4.5),p(60,5.3),p(120,4.5)]} windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={vi.fn()} />
      <ChartViewer locationId="carolina-beach" observedPoints={[]} predictedPoints={central} adjustedPoints={central} deltaPoints={[]} domainStart={now} domainEnd={p(120,0).t} now={now} thresholds={thresholds} showDelta={false} timezone="local" />
    </>);
    expect(screen.getByRole('heading', {name:'Flooding possible'})).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="forecast-flood-shading"]')).toHaveLength(0);
  });
  it('identifies a localized NOAA proxy in the tooltip without calling it observed', () => {
    const {result} = renderHook(()=>useChartInteraction());
    const proxy={...p(0,6),source:'noaa' as const,estimated:true,observedTime:p(-60,6).t};
    const tooltip=result.current.calculateTooltipData(now,[proxy],[],[],[],now,5,false,'basic');
    expect(tooltip?.rows[0].label).toBe('Estimated (localized NOAA)');
    expect(tooltip?.rows[0].value).toBe('6.00 ft');
    expect(tooltip?.rows[0].point?.observedTime).toEqual(p(-60,6).t);
    const observed=result.current.calculateTooltipData(now,[{...p(0,6),source:'fiman'}],[],[],[],now,5,false,'basic');
    expect(observed?.rows[0].label).toBe('Observed (FIMAN)');
  });
  it("preserves a wheel-zoomed viewport on return to live and on data updates", async () => {
    const onViewportChange = vi.fn();
    const props = {
      locationId: "carolina-beach",
      observedPoints: [p(-120, 2), p(0, 3)],
      predictedPoints: [p(-120, 2), p(240, 3)],
      adjustedPoints: [],
      deltaPoints: [],
      domainStart: p(-120, 0).t,
      domainEnd: p(240, 0).t,
      now,
      thresholds,
      showDelta: false,
      timezone: "local" as const,
      onViewportChange,
    };
    const { container, rerender } = render(<ChartViewer {...props} />);
    const svg = container.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 900,
      height: 420,
      right: 900,
      bottom: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.wheel(svg, { ctrlKey: true, deltaY: -1, clientX: 400 });
    await waitFor(() => {
      const call = onViewportChange.mock.calls.at(-1)!;
      expect(call).toBeDefined();
      expect(+call[1] - +call[0]).toBeLessThan(6 * 3600_000);
    });
    const zoomed = onViewportChange.mock.calls.at(-1)!;
    const span = +zoomed[1] - +zoomed[0];
    expect(span).toBeLessThan(6 * 3600_000);
    rerender(
      <ChartViewer {...props} centerRequest={{ time: p(500, 0).t, id: 1 }} />,
    );
    await waitFor(() => {
      const latest = onViewportChange.mock.calls.at(-1)!;
      expect(+latest[2]).toBeCloseTo(+p(500, 0).t, 0);
      expect(+latest[1] - +latest[0]).toBe(span);
    });
    rerender(
      <ChartViewer
        {...props}
        observedPoints={[...props.observedPoints, p(6, 4)]}
        centerRequest={{ time: p(500, 0).t, id: 1 }}
      />,
    );
    expect(
      +onViewportChange.mock.calls.at(-1)![1] -
        +onViewportChange.mock.calls.at(-1)![0],
    ).toBe(span);
  });
  it("keeps flood thresholds and changing line colors without shading observed or forecast flooding", () => {
    const { container } = render(
      <ChartViewer
        locationId="carolina-beach"
        observedPoints={[p(-12, 4), p(-6, 6)]}
        predictedPoints={[]}
        adjustedPoints={[p(0, 4), p(6, 6), p(12, 4)]}
        deltaPoints={[]}
        domainStart={now}
        domainEnd={p(12, 0).t}
        now={now}
        thresholds={thresholds}
        showDelta={false}
        timezone="local"
        floodEvents={[
          {
            startTime: p(-60, 0).t.toISOString(),
            endTime: now.toISOString(),
            peakValue: 8,
          } as never,
        ]}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="forecast-flood-shading"]'),
    ).toHaveLength(0);
    expect(screen.getByLabelText('Observed water level')).toHaveAttribute('stroke', 'url(#obs-flood-gradient)');
    expect(screen.getByLabelText('Forecast total water level')).toHaveAttribute('stroke', 'url(#adj-flood-gradient)');
    const gradients = container.querySelectorAll('linearGradient');
    expect(gradients).toHaveLength(2);
    for (const gradient of gradients) {
      const colors = [...gradient.querySelectorAll('stop')].map(stop => stop.getAttribute('stop-color'));
      expect(colors).toContain('var(--line-observed, #2ecc71)');
      expect(colors).toContain('#fbc02d');
      expect(colors).toContain('#d32f2f');
    }
    expect(screen.getByText('Minor 5.0 ft')).toBeInTheDocument();
    expect(screen.getByText('Moderate 7.0 ft')).toBeInTheDocument();
    expect(screen.getByText('Major 8.0 ft')).toBeInTheDocument();
    expect(screen.getByText('Extreme 9.0 ft')).toBeInTheDocument();
  });
  it('distinguishes the localized estimate from actual observations and connects its handoff', () => {
    const observed = [p(-30,5),p(-24,5.1),{...p(-18,5.2),estimated:true,observedTime:p(-78,0).t}];
    const {container}=render(<HydrographChart locationId="carolina-beach" observedPoints={observed}
      predictedPoints={[]} adjustedPoints={[]} deltaPoints={[]} domainStart={p(-60,0).t} domainEnd={p(60,0).t}
      now={now} thresholds={thresholds} showDelta={false} timezone="local" />);
    const measured=screen.getByLabelText('Observed water level');
    const estimated=screen.getByLabelText('Estimated localized water level');
    expect(measured.getAttribute('points')!.split(' ')).toHaveLength(2);
    expect(estimated).toHaveAttribute('stroke-dasharray','3 3');
    expect(estimated.getAttribute('points')!.split(' ')[0]).toBe(measured.getAttribute('points')!.split(' ').at(-1));
    expect(container.querySelector('.estimated-line')).toBeInTheDocument();
  });
  it("offers anomaly history and returns to live without resetting zoom", () => {
    const { container } = render(
      <SurgeChart points={[p(-120, 0.2), p(-60, 0.4), p(0, 0.6)]} now={now} />,
    );
    expect(screen.getByText("+0.60")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Zoom in anomaly chart" }),
    );
    const before = container.querySelectorAll("svg text");
    const left = before[3]?.textContent;
    const right = before[5]?.textContent;
    fireEvent.click(screen.getByRole("button", { name: /Return to Live$/ }));
    expect(
      screen.queryByRole("button", { name: /Return to Live$/ }),
    ).not.toBeInTheDocument();
    expect(left).not.toBe(right);
  });
  it("renders an exact weekday flood window and street flooding estimate", () => {
    const { container } = render(
      <NextFloodingEventsCard
        adjustedPoints={[p(0, 4), p(6, 6), p(12, 4)]}
        predictedPoints={[]}
        windPoints={[]}
        precipPoints={[]}
        thresholds={thresholds}
        now={now}
        onTimeChange={() => {}}
      />,
    );
    expect(screen.getByText("Saturday, Oct 10")).toBeInTheDocument();
    expect(screen.getByText("6:03 AM – 6:09 AM")).toBeInTheDocument();
    expect(screen.getByText("Max Street Flooding")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated")).toBeInTheDocument();
    expect(container.querySelector(".chart-info")).not.toHaveAttribute("open");
    expect(screen.getByText("Peak Water Level")).toBeInTheDocument();
  });
  it('labels ongoing flooding without inventing an onset at the forecast handoff', () => {
    render(<NextFloodingEventsCard adjustedPoints={[p(0,6),p(6,4)]} predictedPoints={[]}
      windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={()=>{}} />);
    expect(screen.getByText('Flooding now · Until 6:03 AM')).toBeInTheDocument();
    expect(screen.queryByText('6:00 AM – 6:03 AM')).not.toBeInTheDocument();
  });
  it('retains a flooding event twenty days ahead on the complete continuous forecast', () => {
    const points = Array.from({length: 31 * 96 + 1}, (_, i) => p(i * 15, i === 20 * 96 + 1 ? 6 : 4));
    render(<NextFloodingEventsCard adjustedPoints={points} predictedPoints={points}
      windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={vi.fn()} />);
    expect(screen.getByText('Friday, Oct 30')).toBeInTheDocument();
    expect(screen.getByText('Peak Water Level')).toBeInTheDocument();
    expect(screen.getByText('6.00')).toBeInTheDocument();
  });
  it('does not shade incomplete flood forecasts or invent an event ending across a data gap', () => {
    const forecast = [p(0, 6), p(6, 6), p(120, 4)];
    const { container } = render(<>
      <ChartViewer locationId="carolina-beach" observedPoints={[]} predictedPoints={[]} adjustedPoints={forecast} deltaPoints={[]} domainStart={now} domainEnd={p(120,0).t} now={now} thresholds={thresholds} showDelta={false} timezone="local" />
      <NextFloodingEventsCard adjustedPoints={forecast} predictedPoints={[]} windPoints={[]} precipPoints={[]} thresholds={thresholds} now={now} onTimeChange={vi.fn()} />
    </>);
    expect(container.querySelectorAll('[data-testid="forecast-flood-shading"]')).toHaveLength(0);
    expect(screen.getByText('Flooding now · End unavailable')).toBeInTheDocument();
    expect(screen.getByText('6.00')).toBeInTheDocument();
  });

});

function LinkedCharts({ forecastEndAt }: { forecastEndAt?: Date } = {}) {
  const [domain, setDomain] = useState({ start: p(-120, 0).t, end: p(240, 0).t });
  const [request, setRequest] = useState<{ start: Date; end: Date; id: number }>();
  const [centerRequest, setCenterRequest] = useState<{ time: Date; id: number }>();
  const onTide = useCallback((start: Date, end: Date) => {
    setDomain(previous => +previous.start === +start && +previous.end === +end ? previous : { start, end });
  }, []);
  const onSurge = (start: Date, end: Date) => {
    onTide(start, end);
    setRequest(previous => ({ start, end, id: (previous?.id || 0) + 1 }));
  };
  const span = +domain.end - +domain.start;
  return <HydrographChart locationName="Water Level Forecast" locationId="carolina-beach" observedPoints={[]} predictedPoints={[]} adjustedPoints={[]} deltaPoints={[]}
      domainStart={p(-120, 0).t} domainEnd={p(240, 0).t} now={now} thresholds={thresholds} showDelta={false} timezone="local"
      onViewportChange={onTide} viewportRequest={request} centerRequest={centerRequest} timeRange={{ mode: 'relative', lookbackH: 2, lookaheadH: 4 }}
      controls={<ForecastTimeControls viewport={domain} now={now} focusRatio={1/3} forecastEndAt={forecastEndAt}
        isLive={Math.abs(+domain.start + span/3 - +now) < 60_000} onViewportChange={onSurge}
        onReturnToLive={() => setCenterRequest({ time: now, id: (centerRequest?.id || 0) + 1 })} />}>
    <SurgeChart embedded showControls={false} points={[p(-120, .2), p(-60, -.1), p(0, .6)]} now={now} viewport={domain} focusRatio={1 / 3} forecastEndAt={forecastEndAt}
      onViewportChange={onSurge} />
  </HydrographChart>;
}

function chartDomains(container: HTMLElement) {
  return [...container.querySelectorAll('svg[data-domain-start]')].map(svg => ({
    start: svg.getAttribute('data-domain-start'), end: svg.getAttribute('data-domain-end'),
  }));
}
function mockChartSize(svg: SVGSVGElement) {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 270, right: 800, bottom: 270, x: 0, y: 0, toJSON: () => ({}) });
}

describe('linked forecast and residual charts', () => {
  it.each(['tide', 'surge'])('keeps both charts aligned and preserves zoom after keyboard panning the %s chart and returning live', async plot => {
    const { container } = render(<LinkedCharts />);
    fireEvent.click(screen.getByRole('button', { name: /12 hours$/ }));
    await waitFor(() => expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBe(12 * 3600_000));
    const before = chartDomains(container)[0];
    const target = plot === 'tide' ? container.querySelector('.chart-viewer')! : container.querySelector('.surge-svg')!;
    fireEvent.keyDown(target, { key: 'ArrowLeft' });
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].start!)).toBe(+new Date(before.start!) - 3 * 3600_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Return to Live$/ }));
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].end!) - +new Date(domains[0].start!)).toBe(12 * 3600_000);
      expect(+new Date(domains[0].start!) + 4 * 3600_000).toBe(+now);
    });
  });
  it('groups the two plots in one card with one shared toolbar', () => {
    render(<LinkedCharts />);
    const card = screen.getByRole('region', {name:'Water level and surge forecast'});
    expect(card.querySelectorAll('svg[data-domain-start]')).toHaveLength(2);
    expect(screen.getAllByRole('group',{name:'Shared chart time window'})).toHaveLength(1);
    expect(screen.getAllByRole('button',{name:/12 hours$/})).toHaveLength(1);
    expect(screen.getAllByRole('button',{name:/Return to Live$/})).toHaveLength(1);
  });
  it('offers three future days while retaining the configured position of live time', () => {
    const onViewportChange = vi.fn();
    render(<ForecastTimeControls viewport={{start:p(-36 * 60,0).t,end:p(48 * 60,0).t}}
      now={now} focusRatio={36 / 84} isLive onViewportChange={onViewportChange} onReturnToLive={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', {name:/Next 3 days$/}));
    const [start, end] = onViewportChange.mock.calls[0];
    expect(+end - +now).toBe(72 * 3600_000);
    expect(+now - +start).toBe(54 * 3600_000);
    expect(+start + (+end - +start) * (36 / 84)).toBe(+now);
  });
  it('defines the seven-day control as seven future days rather than total chart width', async () => {
    const {container} = render(<LinkedCharts />);
    fireEvent.click(screen.getByRole('button',{name:/Next 7 days$/}));
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].end!) - +now).toBe(7 * 24 * 3600_000);
    });
  });
  it.each([16, 31])('shows the entire actual %i-day NOAA endpoint without resetting the live ratio', async days => {
    const forecastEndAt = p(days * 24 * 60,0).t;
    const {container} = render(<LinkedCharts forecastEndAt={forecastEndAt} />);
    fireEvent.click(screen.getByRole('button',{name:/Full forecast$/}));
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(domains[0].end).toBe(forecastEndAt.toISOString());
      expect(+new Date(domains[0].start!) + (+new Date(domains[0].end!) - +new Date(domains[0].start!)) / 3).toBe(+now);
    });
    expect(screen.getByRole('button',{name:/Full forecast$/})).toHaveAttribute('aria-pressed','true');
  });
  it.each([undefined, p(-60,0).t, new Date('invalid')])('disables the full forecast preset when the future endpoint is unavailable: %s', forecastEndAt => {
    render(<LinkedCharts forecastEndAt={forecastEndAt} />);
    expect(screen.getByRole('button',{name:/Full forecast$/})).toBeDisabled();
  });
  it('keeps the full NOAA range during surge panning, wheel zoom and return to live', async () => {
    const forecastEndAt = p(31 * 24 * 60,0).t;
    const {container} = render(<LinkedCharts forecastEndAt={forecastEndAt} />);
    const [tide, surge] = [...container.querySelectorAll<SVGSVGElement>('svg[data-domain-start]')];
    mockChartSize(tide); mockChartSize(surge);
    fireEvent.click(screen.getByRole('button',{name:/Full forecast$/}));
    await waitFor(() => expect(chartDomains(container)[0].end).toBe(forecastEndAt.toISOString()));
    const original = chartDomains(container)[0];
    const span = +new Date(original.end!) - +new Date(original.start!);
    fireEvent.touchStart(surge, {touches:[{clientX:250,clientY:100}]});
    fireEvent.touchMove(surge, {touches:[{clientX:350,clientY:100}]});
    fireEvent.touchEnd(surge, {touches:[]});
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(domains[0].start).not.toBe(original.start);
      expect(+new Date(domains[0].end!) - +new Date(domains[0].start!)).toBe(span);
    });
    fireEvent.click(screen.getByRole('button',{name:/Return to Live$/}));
    await waitFor(() => expect(chartDomains(container)[0].end).toBe(forecastEndAt.toISOString()));
    fireEvent.wheel(surge, {ctrlKey:true,deltaY:-80,clientX:300});
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].end!) - +new Date(domains[0].start!)).toBeGreaterThan(7 * 24 * 3600_000);
      expect(+new Date(domains[0].end!) - +new Date(domains[0].start!)).toBeLessThan(span);
    });
    fireEvent.click(screen.getByRole('button',{name:/Full forecast$/}));
    await waitFor(() => expect(chartDomains(container)[0].end).toBe(forecastEndAt.toISOString()));
    fireEvent.click(screen.getByRole('button',{name:'Zoom in both charts'}));
    fireEvent.click(screen.getByRole('button',{name:'Zoom out both charts'}));
    await waitFor(() => expect(chartDomains(container)[0].end).toBe(forecastEndAt.toISOString()));
  });
  it('does not move the selected viewport when more buffered NOAA predictions arrive', async () => {
    const {container, rerender} = render(<LinkedCharts forecastEndAt={p(16 * 24 * 60,0).t} />);
    fireEvent.click(screen.getByRole('button',{name:/Full forecast$/}));
    await waitFor(() => expect(chartDomains(container)[0].end).toBe(p(16 * 24 * 60,0).t.toISOString()));
    const selected = chartDomains(container)[0];
    rerender(<LinkedCharts forecastEndAt={p(31 * 24 * 60,0).t} />);
    expect(chartDomains(container)[0]).toEqual(selected);
    expect(chartDomains(container)[1]).toEqual(selected);
  });
  it('shows the same three-day-ahead range on both plots and preserves it when returning to live', async () => {
    const {container} = render(<LinkedCharts />);
    const surge = container.querySelectorAll<SVGSVGElement>('svg[data-domain-start]')[1];
    mockChartSize(surge);
    fireEvent.click(screen.getByRole('button',{name:/Next 3 days$/}));
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].end!) - +now).toBe(72 * 3600_000);
    });
    expect(screen.getByRole('button',{name:/Next 3 days$/})).toHaveAttribute('aria-pressed','true');
    const original = chartDomains(container)[0];
    const span = +new Date(original.end!) - +new Date(original.start!);
    fireEvent.wheel(surge,{deltaX:-100});
    await waitFor(() => expect(chartDomains(container)[0].start).not.toBe(original.start));
    fireEvent.click(screen.getByRole('button',{name:/Return to Live$/}));
    await waitFor(() => {
      const domains = chartDomains(container);
      expect(domains[0]).toEqual(domains[1]);
      expect(+new Date(domains[0].end!) - +now).toBe(72 * 3600_000);
      expect(+new Date(domains[0].end!) - +new Date(domains[0].start!)).toBe(span);
    });
  });
  it('synchronizes an immediate return to live before the surge pan notification is emitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { container, unmount } = render(<LinkedCharts />);
    try {
      const surge = container.querySelectorAll<SVGSVGElement>('svg[data-domain-start]')[1];
      mockChartSize(surge);
      fireEvent.click(screen.getByRole('button', { name: /Next 3 days$/ }));
      act(() => vi.advanceTimersByTime(50));
      const live = chartDomains(container)[0];
      expect(chartDomains(container)[1]).toEqual(live);

      fireEvent.wheel(surge, { deltaX: -100 });
      expect(chartDomains(container)[0].start).not.toBe(live.start);
      // Return before the tide chart's 50 ms notification can acknowledge the
      // pan. Returning to its last emitted range must still update the parent.
      fireEvent.click(screen.getByRole('button', { name: /Return to Live$/ }));
      act(() => vi.advanceTimersByTime(50));
      expect(chartDomains(container)[0]).toEqual(live);
      expect(chartDomains(container)[1]).toEqual(live);
      act(() => vi.advanceTimersByTime(1000));
      expect(chartDomains(container)[0]).toEqual(live);
      expect(chartDomains(container)[1]).toEqual(live);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it('shares preset windows, wheel zoom and pan in both directions, and return-to-live preserves the shared duration', async () => {
    const { container } = render(<LinkedCharts />);
    const [tide, surge] = [...container.querySelectorAll<SVGSVGElement>('svg[data-domain-start]')];
    mockChartSize(tide); mockChartSize(surge);
    const assertLinked = async () => waitFor(() => expect(chartDomains(container)[0]).toEqual(chartDomains(container)[1]));
    fireEvent.click(screen.getByRole('button', { name: /12 hours$/ }));
    await assertLinked();
    expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBe(12 * 3600_000);
    fireEvent.click(screen.getByRole('button',{name:'Zoom in both charts'}));
    await assertLinked();
    expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBe(6 * 3600_000);
    fireEvent.click(screen.getByRole('button',{name:'Zoom out both charts'}));
    await assertLinked();
    expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBe(12 * 3600_000);
    fireEvent.wheel(tide, { ctrlKey: true, deltaY: -40, clientX: 300 });
    await waitFor(() => expect(+new Date(chartDomains(container)[1].end!) - +new Date(chartDomains(container)[1].start!)).toBeLessThan(12 * 3600_000));
    await assertLinked();
    const beforeSurge = chartDomains(container)[0];
    fireEvent.wheel(surge, { ctrlKey: true, deltaY: -80, clientX: 300 });
    await assertLinked();
    expect(chartDomains(container)[0]).not.toEqual(beforeSurge);
    const zoomSpan = +new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!);
    fireEvent.wheel(surge, { deltaX: -400 });
    await assertLinked();
    fireEvent.click(screen.getByRole('button', { name: /Return to Live$/ }));
    await assertLinked();
    await waitFor(() => expect(+new Date(chartDomains(container)[0].start!) + zoomSpan / 3).toBeCloseTo(+now, 0));
    expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBe(zoomSpan);
    fireEvent.touchStart(tide, { touches: [{ clientX: 250, clientY: 100 }] });
    fireEvent.touchMove(tide, { touches: [{ clientX: 350, clientY: 100 }] });
    fireEvent.touchEnd(tide, { touches: [] });
    await waitFor(() => expect(chartDomains(container)[1].start).not.toBe(new Date(+now - zoomSpan / 3).toISOString()));
    await assertLinked();
    const beforeTouch = chartDomains(container)[0];
    fireEvent.touchStart(surge, { touches: [{ clientX: 250, clientY: 100 }] });
    fireEvent.touchMove(surge, { touches: [{ clientX: 350, clientY: 100 }] });
    fireEvent.touchEnd(surge, { touches: [] });
    await assertLinked();
    expect(chartDomains(container)[0]).not.toEqual(beforeTouch);
    const beforePinch = +new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!);
    fireEvent.touchStart(surge, { touches: [{ clientX: 200, clientY: 100 }, { clientX: 300, clientY: 100 }] });
    fireEvent.touchMove(surge, { touches: [{ clientX: 150, clientY: 100 }, { clientX: 350, clientY: 100 }] });
    fireEvent.touchEnd(surge, { touches: [] });
    await assertLinked();
    expect(+new Date(chartDomains(container)[0].end!) - +new Date(chartDomains(container)[0].start!)).toBeCloseTo(Math.max(3600_000, beforePinch / 2), -1);
    const beforeScroll = chartDomains(container)[0];
    fireEvent.touchStart(surge, { touches: [{ clientX: 250, clientY: 100 }] });
    fireEvent.touchMove(surge, { touches: [{ clientX: 250, clientY: 200 }] });
    fireEvent.touchEnd(surge, { touches: [] });
    expect(chartDomains(container)[0]).toEqual(beforeScroll);
  });
  it('connects missing observation intervals without adding measurements and keeps forecast values dashed', () => {
    const { container } = render(<SurgeChart points={[p(-1500, -.3), p(-120, .2), p(-60, .4), p(0, .6)]}
      forecast={[p(0,.6), p(240,.6)]} now={now} viewport={{start:p(-1440,0).t,end:p(240,0).t}} />);
    expect(container.querySelectorAll('[data-testid="residual-segment"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="residual-segment"] line')).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-testid="residual-forecast"]')).toHaveAttribute('stroke-dasharray', '7 5');
    expect(container.querySelectorAll('.chart-info[open]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="forecast-flood-shading"]')).toHaveLength(0);
  });
});

it('lets residents toggle the trend comparison without changing the steady forecast', () => {
  function Preview() {
    const [enabled, setEnabled] = useState(true);
    return <SurgeChart points={[p(-120,.2),p(-60,.4),p(0,.6)]} now={now}
      forecast={[p(0,.6),p(60,.6)]} experimentalForecast={enabled?[p(0,.6),p(60,.7)]:[]}
      showTrendProjection={enabled} trendAvailable onToggleTrendProjection={()=>setEnabled(v=>!v)}
      viewport={{start:p(-180,0).t,end:p(120,0).t}} />;
  }
  const {container} = render(<Preview />);
  const primaryXs = () => container.querySelector('[data-testid="residual-forecast"]')!
    .getAttribute('points')!.split(' ').map(point=>point.split(',')[0]);
  const primary = primaryXs();
  expect(container.querySelector('[data-testid="experimental-residual-forecast"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show trend preview'}));
  expect(container.querySelector('[data-testid="experimental-residual-forecast"]')).not.toBeInTheDocument();
  // The y-axis rescales when the comparison disappears; the steady line must
  // retain its time range and constant level rather than its pixel position.
  expect(primaryXs()).toEqual(primary);
  const ys = container.querySelector('[data-testid="residual-forecast"]')!
    .getAttribute('points')!.split(' ').map(point=>point.split(',')[1]);
  expect(new Set(ys).size).toBe(1);
  fireEvent.click(screen.getByRole('checkbox',{name:'Show trend preview'}));
  expect(container.querySelector('[data-testid="experimental-residual-forecast"]')).toBeInTheDocument();
});
