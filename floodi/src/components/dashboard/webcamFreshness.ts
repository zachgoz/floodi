const MINUTE = 60_000;
// The image archival job runs every 30 minutes. Never imply a continuous live feed.
const IMAGE_REFRESH_INTERVAL = 30 * MINUTE;

export function webcamFrameStatus(capturedAt: Date, now: Date, isLive: boolean): { label: string; age: string; stale: boolean } {
  const elapsed = +now - +capturedAt;
  if (!Number.isFinite(elapsed) || elapsed < -MINUTE) return { label: 'Time unavailable', age: '', stale: true };
  const minutes = Math.max(0, Math.floor(elapsed / MINUTE));
  const age = minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago`
    : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
      : `${Math.floor(minutes / 1440)}d ago`;
  return { label: isLive ? elapsed > IMAGE_REFRESH_INTERVAL ? 'Older image' : 'Latest image' : 'Archived image', age, stale: isLive && elapsed > IMAGE_REFRESH_INTERVAL };
}

export function formatWebcamCaptureTime(capturedAt: Date): string {
  if (!Number.isFinite(+capturedAt)) return 'Capture time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(capturedAt);
}
