import { describe, expect, it } from 'vitest';
import { webcamFrameStatus, formatWebcamCaptureTime } from 'src/components/dashboard/webcamFreshness';
import { nearestEventWeather } from 'src/components/dashboard/eventWeather';

describe('camera freshness follows the captured image', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it('identifies an old fallback frame even when the dashboard is in live mode', () => {
    expect(webcamFrameStatus(new Date('2026-10-17T00:00:00Z'), now, true)).toEqual({ label: 'Older image', age: '12h 0m ago', stale: true });
    expect(webcamFrameStatus(new Date('2026-10-17T11:55:00Z'), now, true)).toEqual({ label: 'Latest image', age: '5 min ago', stale: false });
  });
  it('distinguishes archived and unknown capture times', () => {
    expect(webcamFrameStatus(new Date('2026-10-16T12:00:00Z'), now, false).label).toBe('Archived image');
    expect(webcamFrameStatus(new Date('invalid'), now, true).label).toBe('Time unavailable');
    expect(webcamFrameStatus(new Date(+now + 120_000), now, true).label).toBe('Time unavailable');
  });
  it('formats camera captures in Eastern time including daylight saving transitions', () => {
    expect(formatWebcamCaptureTime(new Date('2026-10-17T12:00:00Z'))).toBe('Oct 17, 8:00 AM EDT');
    expect(formatWebcamCaptureTime(new Date('2026-11-01T06:00:00Z'))).toBe('Nov 1, 1:00 AM EST');
    expect(formatWebcamCaptureTime(new Date('invalid'))).toBe('Capture time unavailable');
  });
});

describe('event weather remains inside actual hourly coverage', () => {
  const point = (hour: number) => ({ t: new Date(`2026-10-17T${String(hour).padStart(2, '0')}:00:00Z`), speed: 0 });
  it('preserves an actual calm observation and handles unordered samples', () => {
    const points = [point(12), point(10), point(11)];
    expect(nearestEventWeather(points, new Date('2026-10-17T11:15:00Z'))).toEqual(point(11));
  });
  it('does not borrow expired forecast weather for a later flood event', () => {
    expect(nearestEventWeather([point(10), point(11)], new Date('2026-10-18T10:00:00Z'))).toBeNull();
    expect(nearestEventWeather([point(10), point(11)], new Date('2026-10-17T09:59:00Z'))).toBeNull();
    expect(nearestEventWeather([], point(10).t)).toBeNull();
  });
  it('rejects large missing intervals and invalid timestamps', () => {
    expect(nearestEventWeather([point(10), point(14)], point(12).t)).toBeNull();
    expect(nearestEventWeather([{ t: new Date('invalid') }], point(10).t)).toBeNull();
  });
});
