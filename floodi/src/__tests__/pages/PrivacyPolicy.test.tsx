import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PrivacyPolicy } from 'src/pages/PrivacyPolicy';

describe('PrivacyPolicy Page Component', () => {
  it('renders privacy policy document with required AdSense disclosures', () => {
    render(<PrivacyPolicy />);

    expect(screen.getAllByText('Privacy Policy').length).toBeGreaterThan(0);
    expect(screen.getByText(/Google AdSense & Third-Party Cookies/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Google Ads Settings/i })).toBeInTheDocument();
    expect(screen.getByText(/Local Storage and Data Collection/i)).toBeInTheDocument();
    expect(screen.getByText(/Reliability Diagnostics/i)).toBeInTheDocument();
    expect(screen.getByText(/They exclude comment text/i)).toBeInTheDocument();
    expect(screen.getByText(/IP addresses/i)).toBeInTheDocument();
  });
});
