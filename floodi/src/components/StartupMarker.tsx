import { useEffect } from 'react';

/** Readiness only; the installed reporter owns sampling and privacy limits. */
export function StartupMarker() {
  useEffect(() => { window.dispatchEvent(new Event('floodi:shell-ready')); }, []);
  return null;
}
