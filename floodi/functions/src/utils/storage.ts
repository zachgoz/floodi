import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import * as logger from 'firebase-functions/logger';
import { safeError } from './observability';
import { interpolate, type WaterPoint } from '../forecast/water';

/**
 * Downloads an image from a URL and uploads it to Firebase Storage.
 * @param url The external URL of the image.
 * @param destination The path in the storage bucket.
 * @returns The public URL or the storage path.
 */
export async function persistImage(url: string, destination: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Image source must use HTTPS');
  const bucket = admin.storage().bucket();
  const file = bucket.file(destination);

  // Check if file already exists to avoid redundant downloads
  const [exists] = await bounded(file.exists(), 10_000);
  if (exists) {
    return destination;
  }

  const response = await fetch(url, { timeout: 10_000, size: 8_000_000 });
  if (!response.ok) {
    throw new Error(`Image provider HTTP ${response.status}`);
  }

  const buffer = await response.buffer();
  await bounded(file.save(buffer, {
    metadata: {
      contentType: response.headers.get('content-type') || 'image/jpeg',
    },
  }), 15_000);

  return destination;
}

function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Image storage operation timed out')), timeoutMs); })]).finally(() => clearTimeout(timer));
}

export async function persistImageryBatch(locationId: string, imagery: Record<string, Record<string, string>>, levels: Record<string, number>, threshold: number, options: { budgetMs?: number; maxImages?: number } = {}) {
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const max = options.maxImages ?? 12;
  const patch: Record<string, Record<string, string>> = {};
  let attempted = 0, succeeded = 0, failed = 0;
  const waterPoints: WaterPoint[] = [...new Map(Object.entries(levels)
    .map(([t, v]) => ({ t: new Date(t), v }))
    .filter(point => Number.isFinite(+point.t) && Number.isFinite(point.v))
    .map(point => [+point.t, point] as const)).values()].sort((a, b) => +a.t - +b.t);
  // Newest images first. A small work budget prevents a camera backlog from
  // consuming the scheduled execution or delaying useful source writes.
  for (const [t, cameras] of Object.entries(imagery).sort(([a], [b]) => Date.parse(b) - Date.parse(a))) {
    const time = new Date(t);
    if (!Number.isFinite(+time)) continue;
    // Camera and gauge samples arrive on independent clocks. For archival
    // selection only, interpolate between measured samples at most 30 minutes
    // apart. Never extrapolate or change the forecast interpolation limits.
    const level = interpolate(waterPoints, time, 30 * 60_000);
    if (!(time.getUTCMinutes() < 10 || (level !== null && level >= threshold))) continue;
    for (const [camera, url] of Object.entries(cameras)) {
      if (typeof url !== 'string' || url.startsWith('storage://')) continue;
      if (Date.now() >= deadline || attempted >= max) return { patch, attempted, succeeded, failed, deferred: true };
      attempted++;
      try {
        const safeCamera = camera.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        const destination = `imagery/${locationId}/${safeCamera}/${t.replace(/[:.-]/g, '')}.jpg`;
        await persistImage(url, destination);
        (patch[t] ||= {})[camera] = `storage://${destination}`;
        succeeded++;
      } catch (error) {
        failed++;
        logger.warn('Camera archival failed; measurement and source URL retained', { event: 'camera_archive_failed', locationId, camera, timestamp: t, error: safeError(error) });
      }
    }
  }
  return { patch, attempted, succeeded, failed, deferred: false };
}
