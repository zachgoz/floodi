import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTRO_STORAGE_KEY, IntroTourOverlay } from 'src/components/onboarding/IntroTourOverlay';

describe('optional guided tour accessibility', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('remains dismissible while a chart target is unavailable', () => {
    const onFinish = vi.fn();
    render(<IntroTourOverlay onFinish={onFinish} />);
    expect(screen.getByRole('dialog', { name: 'Start with the current flood signal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close intro' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onFinish).toHaveBeenCalledOnce();
    expect(localStorage.getItem(INTRO_STORAGE_KEY)).toBe('1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps Tab and Shift+Tab, contains programmatic focus, and restores focus on dismissal', () => {
    const previous = document.createElement('button');
    previous.textContent = 'Open optional tour';
    document.body.appendChild(previous);
    previous.focus();
    const { unmount } = render(<IntroTourOverlay onFinish={vi.fn()} />);
    const first = screen.getByRole('button', { name: 'Close intro' });
    const last = screen.getByRole('button', { name: 'Next' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    previous.focus();
    expect(first).toHaveFocus();
    unmount();
    expect(previous).toHaveFocus();
    previous.remove();
  });

  it('updates its accessible title during navigation and respects disabled first-step Back', () => {
    render(<IntroTourOverlay onFinish={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Use the chart as the time control' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Start with the current flood signal' })).toBeInTheDocument();
  });

  it('does not trap a hidden Ionic route and reopens a dismissed cached tour on replay', async () => {
    const page = document.createElement('ion-page');
    const outside = document.createElement('button');
    document.body.append(page, outside);
    const onFinish = vi.fn();
    const { unmount } = render(<IntroTourOverlay onFinish={onFinish} targetRoot={{ current: page }} />, { container: page });
    await act(async () => { page.classList.add('ion-page-hidden'); });
    outside.focus();
    expect(outside).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onFinish).not.toHaveBeenCalled();
    await act(async () => { page.classList.remove('ion-page-hidden'); });
    fireEvent.click(screen.getByRole('button', { name: 'Close intro' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { page.classList.add('ion-page-hidden'); });
    await act(async () => { page.classList.remove('ion-page-hidden'); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close intro' })).toHaveFocus();
    unmount(); page.remove(); outside.remove();
  });
});
