import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CurrentConditions } from 'src/components/dashboard/CurrentConditions';
import { HydrographChart } from 'src/components/dashboard/HydrographChart';
import { SettingsModal } from 'src/components/Tab2/SettingsModal';
import type { AppConfiguration } from 'src/components/Tab2/types';

vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>();
  return {
    ...actual,
    IonModal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});

vi.mock('src/components/auth', () => ({
  UserMenu: () => null,
}));

const baseConfig: AppConfiguration = {
  locationId: 'carolina-beach',
  location: { id: 'carolina-beach', name: 'Carolina Beach', state: 'NC' },
  station: { id: '8658163', name: 'Carolina Beach' },
  thresholds: { minor: 5.6, moderate: 7, major: 7.7, extreme: 8.5 },
  offset: { mode: 'auto', value: '' },
  timeRange: { mode: 'relative', lookbackH: 36, lookaheadH: 48, absStart: '', absEnd: '' },
  display: { timezone: 'local', dataSource: 'fiman', showDelta: false, viewMode: 'basic' },
};

describe('Dashboard header, hydrograph reset, and settings consolidation', () => {
  it('renders single-line CurrentConditions with gauge, threshold status, and next tide (no city dropdown or accuracy pill)', () => {
    const onNextTideClick = vi.fn();
    const recent = new Date(Date.now() - 5 * 60_000);
    const { container, rerender } = render(
      <CurrentConditions
        points={[{ t: recent, v: 4.12 }]}
        thresholdFt={5.6}
        customView={false}
        onSettings={vi.fn()}
        nextTideInfo={{
          type: 'high',
          time: new Date(Date.now() + 135 * 60_000),
          minutesRemaining: 135,
          value: 5.32,
          heightDelta: 1.2,
        }}
        onNextTideClick={onNextTideClick}
      />,
    );

    // City dropdown and accuracy pill are no longer in CurrentConditions
    expect(container.querySelector('select.location-select')).toBeNull();
    expect(container.querySelector('.accuracy-pill-trigger')).toBeNull();

    // Gauge + Below threshold live together inside one compact status pill
    const statusPill = container.querySelector('.cc-gauge-status-pill.is-normal');
    expect(statusPill).not.toBeNull();
    expect(statusPill?.textContent).toContain('4.12 ft');
    expect(statusPill?.textContent).toContain('Below threshold');

    // Next tide countdown lives in CurrentConditions and invokes callback
    const tideBtn = screen.getByRole('button', { name: /Next high tide in 2 hours 15 minutes/i });
    expect(tideBtn).toHaveTextContent('High in 2h 15m');
    fireEvent.click(tideBtn);
    expect(onNextTideClick).toHaveBeenCalledTimes(1);

    // Above threshold switches tone to is-elevated and exact label
    rerender(
      <CurrentConditions
        points={[{ t: recent, v: 6.05 }]}
        thresholdFt={5.6}
        customView={false}
        onSettings={vi.fn()}
      />,
    );
    const elevatedPill = container.querySelector('.cc-gauge-status-pill.is-elevated');
    expect(elevatedPill).not.toBeNull();
    expect(elevatedPill?.textContent).toContain('6.05 ft');
    expect(elevatedPill?.textContent).toContain('Above threshold');
  });

  it('removes the redundant Hydrograph Date row and shows Reset to Live only when scrolled off live', () => {
    const onResetToLive = vi.fn();
    const now = new Date('2026-10-10T10:00:00Z');
    const domainStart = new Date(+now - 60 * 60_000);
    const domainEnd = new Date(+now + 60 * 60_000);

    const { container, rerender } = render(
      <HydrographChart
        locationName="Water Level Forecast"
        locationId="carolina-beach"
        observedPoints={[]}
        predictedPoints={[]}
        adjustedPoints={[]}
        deltaPoints={[]}
        domainStart={domainStart}
        domainEnd={domainEnd}
        now={now}
        thresholds={baseConfig.thresholds}
        showDelta={false}
        timezone="local"
        isLive={true}
        time={now}
        onResetToLive={onResetToLive}
        controls={<div>Bottom controls</div>}
      />,
    );

    // Redundant Hydrograph Date pill is absent; Reset to Live hidden while live
    expect(container.querySelector('.viewing-time-pill')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset hydrograph to live' })).toBeNull();

    // When scrolled away from live (even with bottom controls present), Reset to Live appears and resets
    rerender(
      <HydrographChart
        locationName="Water Level Forecast"
        locationId="carolina-beach"
        observedPoints={[]}
        predictedPoints={[]}
        adjustedPoints={[]}
        deltaPoints={[]}
        domainStart={domainStart}
        domainEnd={domainEnd}
        now={now}
        thresholds={baseConfig.thresholds}
        showDelta={false}
        timezone="local"
        isLive={false}
        time={new Date(+now + 3 * 3600_000)}
        onResetToLive={onResetToLive}
        controls={<div>Bottom controls</div>}
      />,
    );

    expect(container.querySelector('.viewing-time-pill')).toBeNull();
    const resetBtn = screen.getByRole('button', { name: 'Reset hydrograph to live' });
    expect(resetBtn).toHaveTextContent('Reset to Live');
    fireEvent.click(resetBtn);
    expect(onResetToLive).toHaveBeenCalledTimes(1);
  });

  it('hosts both Location selector and Forecast Accuracy trigger inside SettingsModal', () => {
    const onDismiss = vi.fn();
    const onAccuracyClick = vi.fn();
    render(
      <MemoryRouter>
        <SettingsModal
          isOpen={true}
          onDismiss={onDismiss}
          config={baseConfig}
          onLocationChange={vi.fn()}
          onThresholdsChange={vi.fn()}
          onOffsetConfigChange={vi.fn()}
          onDisplayChange={vi.fn()}
          onResetDefaults={vi.fn()}
          computedOffset={0.12}
          offsetDataPoints={24}
          onAccuracyClick={onAccuracyClick}
          maeInches={2.1}
        />
      </MemoryRouter>,
    );

    // Location settings present in modal
    expect(screen.getByText('Active Town')).toBeInTheDocument();

    // Forecast accuracy entry displays exact MAE and dismisses Settings before opening audit modal
    const accTrigger = screen.getByLabelText(/View forecast accuracy audit, verified average error plus or minus 2\.1 inches/i);
    expect(accTrigger).toHaveTextContent('±2.1"');
    fireEvent.click(accTrigger);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccuracyClick).toHaveBeenCalledTimes(1);
  });
});
