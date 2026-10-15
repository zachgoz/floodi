import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from 'src/components/AppErrorBoundary';
import { reportClientError } from 'src/lib/errorReporting';
vi.mock('src/lib/errorReporting', () => ({ reportClientError: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); });

describe('AppErrorBoundary', () => {
  it('keeps a compact reload recovery visible after a render failure and reports the safe category', () => {
    const failure = new TypeError('private exception text');
    function Broken(): React.ReactNode { throw failure; }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('FloodCast couldn’t load');
    expect(screen.getByRole('button', { name: 'Reload FloodCast' })).toBeVisible();
    expect(screen.queryByText('private exception text')).not.toBeInTheDocument();
    expect(reportClientError).toHaveBeenCalledWith('react_render_error', failure, { provider: 'app' });
  });
});
