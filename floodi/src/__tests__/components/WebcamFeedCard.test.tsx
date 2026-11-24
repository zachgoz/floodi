import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WebcamFeedCard } from 'src/components/dashboard/WebcamFeedCard';
import { buildWebcamCandidates, shouldUseSecooraGuessFallback } from 'src/components/dashboard/webcamCandidates';
import { getImageUrl } from 'src/lib/dataService';

vi.mock('src/lib/dataService', () => ({
  getImageUrl: vi.fn(),
}));

vi.mock('src/lib/analytics', () => ({
  trackWebcamChange: vi.fn(),
  trackWebcamTimeShift: vi.fn(),
}));

describe('buildWebcamCandidates (boundary & prioritization)', () => {
  const now = new Date('2026-11-24T15:00:00Z');

  it('returns empty list for undefined, empty, malformed timestamps, or unsupported URLs', () => {
    expect(buildWebcamCandidates(undefined, new Date('2026-10-15T14:30:00Z'), { now })).toEqual([]);
    expect(buildWebcamCandidates({}, new Date('2026-10-15T14:30:00Z'), { now })).toEqual([]);
    expect(buildWebcamCandidates({
      'not-a-date': 'storage://imagery/a.jpg',
      '2026-10-15T14:00:00Z': '',
      '2026-10-15T14:10:00Z': 'storage://',
      '2026-10-15T14:20:00Z': 'javascript:alert(1)',
    }, new Date('2026-10-15T14:30:00Z'), { now })).toEqual([]);
    expect(buildWebcamCandidates({ '2026-10-15T14:00:00Z': 'storage://imagery/a.jpg' }, new Date('invalid'), { now })).toEqual([]);
  });

  it('tries only the closest external URL first, then jumps directly to archived storage:// frames', () => {
    const imagery: Record<string, string> = {
      '2026-10-15T13:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1300.jpg',
      '2026-10-15T14:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg',
      '2026-10-15T14:06:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1406.jpg',
      '2026-10-15T14:12:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1412.jpg',
      '2026-10-15T14:18:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1418.jpg',
      '2026-10-15T14:24:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg',
      '2026-10-15T15:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1500.jpg',
    };

    const candidates = buildWebcamCandidates(imagery, new Date('2026-10-15T14:30:00.000Z'), { now });
    expect(candidates.map(c => c.rawUrl)).toEqual([
      'https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg',
      'storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg',
      'storage://imagery/carolina-beach/SUNNYD_CB_03/1300.jpg',
    ]);
    expect(candidates.map(c => c.archived)).toEqual([false, true, true]);
  });

  it('uses nearest subsequent archived frame within allowAfterMs when no earlier archive exists', () => {
    const imagery: Record<string, string> = {
      '2026-10-10T14:24:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg',
      '2026-10-10T15:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1500.jpg',
    };

    const candidates = buildWebcamCandidates(imagery, new Date('2026-10-10T14:30:00.000Z'), {
      now,
      allowAfterMs: 60 * 60_000,
    });
    expect(candidates.map(c => c.rawUrl)).toEqual([
      'https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg',
      'storage://imagery/carolina-beach/SUNNYD_CB_03/1500.jpg',
    ]);
  });

  it('restricts SECOORA brute-force minute guessing to recent timestamps within 7 days', () => {
    expect(shouldUseSecooraGuessFallback(new Date('2026-11-24T12:00:00Z'), now)).toBe(true);
    expect(shouldUseSecooraGuessFallback(new Date('2026-11-18T15:00:00Z'), now)).toBe(true);
    expect(shouldUseSecooraGuessFallback(new Date('2026-11-01T12:00:00Z'), now)).toBe(false);
    expect(shouldUseSecooraGuessFallback(new Date('2026-10-15T12:00:00Z'), now)).toBe(false);
  });
});

describe('WebcamFeedCard historical storage:// retrieval', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Hermeticity guard: fail loudly if any live network call is attempted in tests
    globalThis.fetch = vi.fn(() => {
      throw new Error('Unexpected live fetch during WebcamFeedCard unit test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('resolves a storage:// URI via getImageUrl and renders the HTTPS download URL', async () => {
    const resolved = 'https://firebasestorage.googleapis.com/v0/b/floodcastwebapp.firebasestorage.app/o/imagery%2F1400.jpg?alt=media';
    vi.mocked(getImageUrl).mockResolvedValue(resolved);

    const { container } = render(
      <WebcamFeedCard
        locationName="Carolina Beach"
        cameraId="SUNNYD_CB_03"
        targetTime={new Date('2026-10-15T14:00:00.000Z')}
        isLive={false}
        imagery={{
          '2026-10-15T14:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg',
        }}
      />,
    );

    await waitFor(() => {
      const img = container.querySelector('img.webcam-image');
      expect(img?.getAttribute('src')).toBe(resolved);
    });
    expect(getImageUrl).toHaveBeenCalledTimes(1);
    expect(getImageUrl).toHaveBeenCalledWith('storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg');
  });

  it('falls back immediately from a 404 historical SECOORA URL to the nearest archived storage:// frame', async () => {
    const resolvedArchive = 'https://firebasestorage.googleapis.com/v0/b/floodcastwebapp.firebasestorage.app/o/imagery%2F1400.jpg?alt=media';
    vi.mocked(getImageUrl).mockResolvedValue(resolvedArchive);

    const { container } = render(
      <WebcamFeedCard
        locationName="Carolina Beach"
        cameraId="SUNNYD_CB_03"
        targetTime={new Date('2026-10-15T14:30:00.000Z')}
        isLive={false}
        imagery={{
          '2026-10-15T14:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg',
          '2026-10-15T14:18:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1418.jpg',
          '2026-10-15T14:24:00.000Z': 'https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg',
        }}
      />,
    );

    // First renders the closest exact-time SECOORA URL
    let initialImg: Element | null = null;
    await waitFor(() => {
      initialImg = container.querySelector('img.webcam-image');
      expect(initialImg?.getAttribute('src')).toBe('https://wl.secoora.org/webcam/SUNNYD_CB_03.1424.jpg');
    });

    // Simulate SECOORA 404 error -> skips 14:18 external URL and jumps straight to 14:00 archive
    fireEvent.error(initialImg!);

    await waitFor(() => {
      const img = container.querySelector('img.webcam-image');
      expect(img?.getAttribute('src')).toBe(resolvedArchive);
    });
    expect(getImageUrl).toHaveBeenCalledTimes(1);
    expect(getImageUrl).toHaveBeenCalledWith('storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg');
  });

  it('cancels stale storage:// resolutions when scrubbing rapidly to a new timestamp', async () => {
    let resolveOld!: (url: string) => void;
    const oldPromise = new Promise<string>(r => { resolveOld = r; });
    const newUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/new.jpg?alt=media';

    vi.mocked(getImageUrl)
      .mockReturnValueOnce(oldPromise)
      .mockResolvedValueOnce(newUrl);

    const imagery = {
      '2026-10-15T13:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1300.jpg',
      '2026-10-15T14:00:00.000Z': 'storage://imagery/carolina-beach/SUNNYD_CB_03/1400.jpg',
    };

    const { container, rerender } = render(
      <WebcamFeedCard
        locationName="Carolina Beach"
        cameraId="SUNNYD_CB_03"
        targetTime={new Date('2026-10-15T13:00:00.000Z')}
        isLive={false}
        imagery={imagery}
      />,
    );

    // Scrub to 14:00 before 13:00 resolves
    rerender(
      <WebcamFeedCard
        locationName="Carolina Beach"
        cameraId="SUNNYD_CB_03"
        targetTime={new Date('2026-10-15T14:00:00.000Z')}
        isLive={false}
        imagery={imagery}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('img.webcam-image')?.getAttribute('src')).toBe(newUrl);
    });

    // Late resolution of old promise must NOT overwrite current image
    resolveOld('https://firebasestorage.googleapis.com/v0/b/bucket/o/stale.jpg?alt=media');
    await Promise.resolve();
    expect(container.querySelector('img.webcam-image')?.getAttribute('src')).toBe(newUrl);
  });

  it('shows Feed Offline immediately without SECOORA brute-force guesses when historical date has no imagery', async () => {
    const { container } = render(
      <WebcamFeedCard
        locationName="Carolina Beach"
        cameraId="SUNNYD_CB_03"
        targetTime={new Date('2026-10-01T12:00:00.000Z')}
        isLive={false}
        imagery={{}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Feed Offline')).toBeTruthy();
    });
    expect(container.querySelector('img.webcam-image')).toBeNull();
  });
});
