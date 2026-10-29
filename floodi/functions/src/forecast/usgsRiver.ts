import fetch from 'node-fetch';
import * as logger from 'firebase-functions/logger';
import { safeError } from '../utils/observability';

export interface UsgsRiverPoint {
  t: string;            // ISO 8601 UTC timestamp
  dischargeCfs?: number; // Parameter 00060 (ft^3/s)
  gageHeightFt?: number; // Parameter 00065 (ft)
}

export interface UsgsRiverTelemetry {
  siteId: string;
  siteName: string;
  retrievedAt: string;
  latestDischargeCfs: number | null;
  latestGageHeightFt: number | null;
  points: UsgsRiverPoint[];
}

export interface UsgsRiverGaugeConfig {
  siteId: string;
  siteName: string;
  baseflowCfs: number;
  travelLagHours: number;
}

export const CAPE_FEAR_LOCK1_CONFIG: UsgsRiverGaugeConfig = {
  siteId: '02105769',
  siteName: 'Cape Fear River at Lock #1 near Kelly, NC',
  baseflowCfs: 1500,
  travelLagHours: 18,
};

/**
 * Parses USGS Water Services JSON (nwis/iv) into sorted, finite UsgsRiverPoint observations.
 * Rejects negative sentinel values (e.g. -999999 ice/equipment flags) and non-finite timestamps.
 */
export function parseUsgsIvPayload(payload: unknown): {
  points: UsgsRiverPoint[];
  latestDischargeCfs: number | null;
  latestGageHeightFt: number | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { points: [], latestDischargeCfs: null, latestGageHeightFt: null };
  }
  const timeSeries = (payload as { value?: { timeSeries?: unknown[] } }).value?.timeSeries;
  if (!Array.isArray(timeSeries)) {
    return { points: [], latestDischargeCfs: null, latestGageHeightFt: null };
  }

  const byTimestamp = new Map<number, UsgsRiverPoint>();

  for (const ts of timeSeries) {
    if (!ts || typeof ts !== 'object') continue;
    const paramCode = (ts as { variable?: { variableCode?: Array<{ value?: string }> } })
      .variable?.variableCode?.[0]?.value;
    if (paramCode !== '00060' && paramCode !== '00065') continue;

    const rawValues = (ts as { values?: Array<{ value?: Array<{ value?: string; dateTime?: string }> }> })
      .values?.[0]?.value;
    if (!Array.isArray(rawValues)) continue;

    for (const item of rawValues) {
      if (!item || typeof item.dateTime !== 'string' || typeof item.value !== 'string') continue;
      const ms = Date.parse(item.dateTime);
      const val = parseFloat(item.value);
      if (!Number.isFinite(ms) || !Number.isFinite(val) || val < -50 || val <= -9999) continue;
      if (paramCode === '00060' && val < 0) continue; // Discharge cannot be negative here

      const iso = new Date(ms).toISOString();
      const existing = byTimestamp.get(ms) ?? { t: iso };
      if (paramCode === '00060') existing.dischargeCfs = val;
      if (paramCode === '00065') existing.gageHeightFt = val;
      byTimestamp.set(ms, existing);
    }
  }

  const points = [...byTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pt]) => pt);

  let latestDischargeCfs: number | null = null;
  let latestGageHeightFt: number | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (latestDischargeCfs === null && typeof points[i].dischargeCfs === 'number') {
      latestDischargeCfs = points[i].dischargeCfs!;
    }
    if (latestGageHeightFt === null && typeof points[i].gageHeightFt === 'number') {
      latestGageHeightFt = points[i].gageHeightFt!;
    }
    if (latestDischargeCfs !== null && latestGageHeightFt !== null) break;
  }

  return { points, latestDischargeCfs, latestGageHeightFt };
}

/**
 * Fetches recent upstream river discharge & stage from USGS Water Services (nwis/iv).
 */
export async function fetchUsgsRiverTelemetry(
  gaugeConfig: UsgsRiverGaugeConfig = CAPE_FEAR_LOCK1_CONFIG,
  periodDays = 3,
  timeoutMs = 10_000
): Promise<UsgsRiverTelemetry | null> {
  try {
    const safeDays = Math.max(1, Math.min(30, Math.round(periodDays)));
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(
      gaugeConfig.siteId
    )}&parameterCd=00060,00065&period=P${safeDays}D`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FloodCast-Engine/1.0 (+https://floodcastwebapp.web.app)',
        'Accept': 'application/json',
      },
      timeout: timeoutMs,
    });

    if (!res.ok) {
      logger.warn('USGS river telemetry HTTP request failed', {
        status: res.status,
        siteId: gaugeConfig.siteId,
      });
      return null;
    }

    const payload = await res.json();
    const parsed = parseUsgsIvPayload(payload);
    return {
      siteId: gaugeConfig.siteId,
      siteName: gaugeConfig.siteName,
      retrievedAt: new Date().toISOString(),
      ...parsed,
    };
  } catch (err) {
    logger.warn('USGS river telemetry unavailable; proceeding without upstream discharge term', {
      siteId: gaugeConfig.siteId,
      error: safeError(err),
    });
    return null;
  }
}

