import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAtmosphericState } from '../../components/Tab2/hooks/useAtmosphericState';

describe('useAtmosphericState', () => {
  const now = new Date('2024-01-01T12:00:00Z');
  const mockProcessedData = {
    timeDomain: { now },
    observedPoints: [
      { t: new Date(now.getTime() - 3600000), v: 1.5, source: 'fiman' },
      { t: now, v: 2.0, source: 'fiman' }
    ],
    predictedPoints: [
      { t: now, v: 1.8 },
      { t: new Date(now.getTime() + 3600000), v: 2.2 }
    ],
    adjustedPoints: [
      { t: new Date(now.getTime() + 3600000), v: 2.5 }
    ],
    windPoints: [
      { t: now, speed: 10, dir: 180 }
    ],
    precipPoints: [
      { t: now, value: 0.1 }
    ],
    source: 'fiman'
  };

  it('returns live conditions when no manual focus or viewport focus', () => {
    const { result } = renderHook(() => useAtmosphericState(mockProcessedData, null, null));
    
    expect(result.current.activeAtmo.wl).toBe(2.0);
    expect(result.current.activeAtmo.isLive).toBe(true);
    expect(result.current.activeAtmo.source).toContain('Water Level');
  });

  it('returns manual focus data when manualFocusTime is provided', () => {
    const focusTime = new Date(now.getTime() + 3600000);
    const { result } = renderHook(() => useAtmosphericState(mockProcessedData, focusTime, null));
    
    // At focusTime (now + 1h), we have adjustedPoints (2.5)
    expect(result.current.activeAtmo.wl).toBe(2.5);
    expect(result.current.activeAtmo.isLive).toBe(false);
    expect(result.current.activeAtmo.source).toBe('Predicted Water Level');
  });

  it('uses astronomical tide after the learned forecast horizon instead of extending the final predicted level', () => {
    const focusTime = new Date(+now + 90 * 60_000);
    const data = {
      ...mockProcessedData,
      predictedPoints: [{ t: focusTime, v: 2.1 }],
    };
    const { result } = renderHook(() => useAtmosphericState(data, focusTime, null));

    expect(result.current.activeAtmo.wl).toBe(2.1);
    expect(result.current.activeAtmo.source).toBe('NOAA Prediction');
    expect(result.current.activeAtmo.fullSource).toBe('NOAA Predicted Water Level');
    expect(result.current.simulationLevel).toBe(2.1);
  });

  it('does not borrow a future learned level before the first supported forecast timestamp', () => {
    const focusTime = new Date(+now + 30 * 60_000);
    const data = {
      ...mockProcessedData,
      predictedPoints: [{ t: focusTime, v: 1.9 }],
    };
    const { result } = renderHook(() => useAtmosphericState(data, focusTime, null));

    expect(result.current.activeAtmo.wl).toBe(1.9);
    expect(result.current.activeAtmo.source).toBe('NOAA Prediction');
  });

  it('returns no water level beyond the forecast horizon when astronomical tide is also unavailable', () => {
    const focusTime = new Date(+now + 90 * 60_000);
    const data = { ...mockProcessedData, predictedPoints: [] };
    const { result } = renderHook(() => useAtmosphericState(data, focusTime, null));

    expect(result.current.activeAtmo.wl).toBeNull();
    expect(result.current.activeAtmo.surge).toBeNull();
    expect(result.current.activeAtmo.source).toBe('No Data');
  });

  it('labels a localized alternate-station proxy as estimated while preserving its source', () => {
    const estimate = {
      ...mockProcessedData,
      observedPoints: [{ t: now, v: 6.1, source: 'noaa', estimated: true, observedTime: new Date(+now - 3600_000) }],
    };
    const { result } = renderHook(() => useAtmosphericState(estimate, null, null));
    expect(result.current.activeAtmo.wl).toBe(6.1);
    expect(result.current.activeAtmo.statusLabel).toBe('Estimated');
    expect(result.current.activeAtmo.fullSource).toBe('Estimated Water Level (phase-aligned NOAA proxy)');
  });

  it('handles simulation mode', () => {
    const { result } = renderHook(() => useAtmosphericState(mockProcessedData, null, null, 3.0));
    
    // It should have synced to 2.0 initially (from live WL) despite initialSimulationLevel 3.0
    expect(result.current.simulationLevel).toBe(2.0);

    act(() => {
      result.current.setIsUserSimulating(true);
    });
    
    expect(result.current.activeAtmo.wl).toBe(2.0);
    expect(result.current.activeAtmo.isSimulated).toBe(true);
    
    act(() => {
      result.current.setSimulationLevel(4.5);
    });
    
    expect(result.current.activeAtmo.wl).toBe(4.5);
  });

  it('syncs simulation level when not simulating', () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAtmosphericState(data, null, null),
      { initialProps: { data: mockProcessedData as any } }
    );
    
    expect(result.current.simulationLevel).toBe(2.0);
    
    const newData = {
      ...mockProcessedData,
      observedPoints: [
        { t: now, v: 3.5, source: 'fiman' }
      ]
    };
    
    rerender({ data: newData as any });
    
    expect(result.current.simulationLevel).toBe(3.5);
  });
  it('does not substitute zero water level or anomaly when all series are missing', () => {
    const empty = { ...mockProcessedData, observedPoints: [], adjustedPoints: [], predictedPoints: [] };
    const { result } = renderHook(() => useAtmosphericState(empty, null, null));
    expect(result.current.activeAtmo.wl).toBeNull();
    expect(result.current.activeAtmo.surge).toBeNull();
  });

});
