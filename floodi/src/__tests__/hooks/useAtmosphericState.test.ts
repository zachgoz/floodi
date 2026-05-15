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
});
