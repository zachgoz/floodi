import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdSenseUnit } from 'src/components/common/AdSenseUnit';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

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
});
