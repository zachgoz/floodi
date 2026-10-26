import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStorage } from 'src/components/Tab2/hooks/useSettingsStorage';
import { validThresholds } from 'src/components/Tab2/thresholdSettings';

describe('personal flood thresholds', () => {
  beforeEach(() => localStorage.clear());
  const thresholds = { minor: 5.6, moderate: 7, major: 7.7, extreme: 8.5 };
  it('rejects equal, reversed, missing or nonfinite levels', () => {
    expect(validThresholds(thresholds)).toBe(true);
    for (const changes of [{ moderate: 5.6 }, { minor: 8 }, { extreme: Number.NaN }, { major: Infinity }, { minor: 0 }]) {
      expect(validThresholds({ ...thresholds, ...changes })).toBe(false);
    }
  });
  it('restores valid defaults when persisted settings would invert severity', () => {
    localStorage.setItem('floodi.thresholds', JSON.stringify({ ...thresholds, moderate: 4 }));
    const { result } = renderHook(() => useSettingsStorage());
    expect(result.current.config.thresholds).toEqual(thresholds);
  });
  it('rejects an invalid update without changing saved settings and accepts a valid one', () => {
    const { result } = renderHook(() => useSettingsStorage());
    act(() => result.current.updateThresholds({ major: 6 }));
    expect(result.current.config.thresholds).toEqual(thresholds);
    act(() => result.current.updateThresholds({ minor: 5.8 }));
    expect(result.current.config.thresholds.minor).toBe(5.8);
    expect(JSON.parse(localStorage.getItem('floodi.thresholds')!).minor).toBe(5.8);
  });
});
