import { describe, it, expect } from 'vitest';
import { getRedirectFromSearch } from 'src/utils/auth';

describe('getRedirectFromSearch', () => {
  it('returns fallback when missing or invalid', () => {
    expect(getRedirectFromSearch('', '/home')).toBe('/home');
    expect(getRedirectFromSearch('?redirect=', '/home')).toBe('/home');
    expect(getRedirectFromSearch('?redirect=not-a-path', '/home')).toBe('/home');
  });

  it('allows only single-slash internal paths', () => {
    expect(getRedirectFromSearch('?redirect=/profile', '/home')).toBe('/profile');
    expect(getRedirectFromSearch('?redirect=//evil.com', '/home')).toBe('/home');
    expect(getRedirectFromSearch('?redirect=http://evil.com', '/home')).toBe('/home');
    expect(getRedirectFromSearch('?redirect=https://evil.com', '/home')).toBe('/home');
  });

  it('preserves query and hash for valid internal paths', () => {
    const s = '?redirect=' + encodeURIComponent('/path/to?p=1#section');
    expect(getRedirectFromSearch(s, '/home')).toBe('/path/to?p=1#section');
  });
});

