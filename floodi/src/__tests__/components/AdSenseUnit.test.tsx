import React, { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdSenseUnit } from 'src/components/common/AdSenseUnit';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

afterEach(async () => {
  cleanup();
  for (const script of document.querySelectorAll('script[data-floodcast-adsense]')) { script.dispatchEvent(new Event('error')); script.remove(); }
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AdSenseUnit Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.adsbygoogle = [];
  });

  it('is hidden by default when enabled prop or env flag is not set', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    const { container } = render(<AdSenseUnit slot="test-slot-123" />);

    // Default should be hidden (null)
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Google AdSense Placeholder')).not.toBeInTheDocument();
  });

  it('renders ad placeholder in development when explicitly enabled and showPlaceholder is true', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    render(
      <AdSenseUnit 
        slot="test-slot-123" 
        enabled={true} 
        showPlaceholder={true} 
      />
    );

    expect(screen.getByText('Google AdSense Placeholder')).toBeInTheDocument();
    expect(screen.getByText(/test-slot-123/)).toBeInTheDocument();
  });

  it('returns null when enabled={true} but showPlaceholder={false} in dev mode', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    const { container } = render(
      <AdSenseUnit 
        slot="test-slot-123" 
        enabled={true} 
        showPlaceholder={false} 
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null and suppresses ads when running natively on iOS/Android even if enabled', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    const { container } = render(
      <AdSenseUnit 
        slot="test-slot-123" 
        enabled={true} 
        showPlaceholder={true} 
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows only the configured developer placeholder even for a valid slot and never loads vendor code', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    render(<AdSenseUnit enabled showPlaceholder slot="1234567890" />);
    expect(screen.getByText('Google AdSense Placeholder')).toBeInTheDocument();
    expect(document.querySelector('script[data-floodcast-adsense]')).toBeNull();
    expect(window.adsbygoogle).toHaveLength(0);
  });
});

describe('production AdSense deferred loading', () => {
  const observations: { callback: IntersectionObserverCallback; target?: Element; disconnected: boolean }[] = [];
  const scripts = () => document.querySelectorAll<HTMLScriptElement>('script[data-floodcast-adsense]');
  const near = async (target?: Element, isIntersecting = true) => {
    await act(async () => {
      for (const observation of observations.filter(value => !value.disconnected && (!target || value.target === target))) {
        observation.callback([{ target: observation.target!, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
  };
  const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('DEV', '');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    window.adsbygoogle = [];
    observations.length = 0;
    vi.stubGlobal('IntersectionObserver', class {
      record: typeof observations[number];
      constructor(callback: IntersectionObserverCallback) { this.record = { callback, disconnected: false }; observations.push(this.record); }
      observe(target: Element) { this.record.target = target; }
      disconnect() { this.record.disconnected = true; }
    });
  });

  it('does not load vendor code or render an unfilled ad until the enabled web unit approaches the viewport', async () => {
    const { container } = render(<AdSenseUnit enabled slot="12345" />);
    expect(scripts()).toHaveLength(0);
    expect(container.querySelector('ins')).toBeNull();
    await near(undefined, false);
    expect(scripts()).toHaveLength(0);
    await near();
    expect(scripts()).toHaveLength(1);
    expect(container.querySelector('ins')).toHaveAttribute('data-ad-slot', '12345');
    expect(window.adsbygoogle).toHaveLength(0);
    const script = scripts()[0];
    expect(script.async).toBe(true);
    expect(script.crossOrigin).toBe('anonymous');
    expect(script.src).toContain('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-');
    await act(async () => script.dispatchEvent(new Event('load')));
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('shares one loader and initializes each eligible unit once across StrictMode effect replays', async () => {
    const { container, rerender } = render(<StrictMode><AdSenseUnit enabled slot="11111" /><AdSenseUnit enabled slot="22222" /></StrictMode>);
    await near();
    expect(scripts()).toHaveLength(1);
    await act(async () => scripts()[0].dispatchEvent(new Event('load')));
    expect(window.adsbygoogle).toHaveLength(2);
    rerender(<StrictMode><AdSenseUnit enabled slot="11111" /><AdSenseUnit enabled slot="22222" /></StrictMode>);
    await near(); await settle();
    expect(window.adsbygoogle).toHaveLength(2);
    expect(container.querySelectorAll('ins')).toHaveLength(2);
    expect(scripts()).toHaveLength(1);
  });

  it('does not initialize a unit that unmounts while the shared script is loading', async () => {
    const { unmount } = render(<AdSenseUnit enabled slot="11111" />);
    await near();
    const script = scripts()[0];
    unmount();
    await act(async () => script.dispatchEvent(new Event('load')));
    expect(window.adsbygoogle).toHaveLength(0);
  });

  it('removes a failed request, retries once after a delay, and recovers without a page reload', async () => {
    render(<AdSenseUnit enabled slot="11111" />);
    await near();
    const first = scripts()[0];
    await act(async () => first.dispatchEvent(new Event('error')));
    expect(scripts()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(scripts()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(first);
    await act(async () => scripts()[0].dispatchEvent(new Event('load')));
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('bounds blocked-script timeouts/retries and cancels pending retries on unmount', async () => {
    const { unmount } = render(<AdSenseUnit enabled slot="11111" />);
    await near();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(scripts()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(scripts()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(scripts()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(scripts()).toHaveLength(0);
    expect(window.adsbygoogle).toHaveLength(0);
    unmount();
    const next = render(<AdSenseUnit enabled slot="22222" />);
    await near();
    await act(async () => scripts()[0].dispatchEvent(new Event('error')));
    next.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(scripts()).toHaveLength(0);
  });

  it('keeps disabled and native units free of third-party loading in production', async () => {
    const { rerender, container } = render(<AdSenseUnit enabled={false} slot="11111" />);
    expect(container.firstChild).toBeNull();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    rerender(<AdSenseUnit enabled slot="11111" />);
    await near();
    expect(container.firstChild).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it('suppresses unconfigured or non-numeric slots instead of fetching a vendor script for invalid units', async () => {
    const { container, rerender } = render(<AdSenseUnit enabled slot="" />);
    for (const slot of ['', 'dashboard-bottom', '12345x', '123 456', ' 123456']) {
      rerender(<AdSenseUnit enabled slot={slot} />);
      await near();
      expect(container.firstChild).toBeNull();
      expect(scripts()).toHaveLength(0);
    }
    rerender(<AdSenseUnit enabled slot="1234567890" />);
    await near();
    expect(scripts()).toHaveLength(1);
  });

  it('defers older browsers without IntersectionObserver until scrolling brings the unit near', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    let top = 5_000;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 100, height: 100, width: 300, left: 0, right: 300, x: 0, y: top, toJSON: () => ({}) }));
    const { unmount } = render(<AdSenseUnit enabled slot="1234567890" />);
    expect(scripts()).toHaveLength(0);
    top = 100;
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(scripts()).toHaveLength(1);
    await act(async () => scripts()[0].dispatchEvent(new Event('load')));
    expect(window.adsbygoogle).toHaveLength(1);
    unmount();
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(window.adsbygoogle).toHaveLength(1);
  });
});
