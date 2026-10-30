import fetch from 'node-fetch';
import * as logger from 'firebase-functions/logger';
import { safeError } from '../utils/observability';

export interface NoaaSurgePoint {
  t: string;       // ISO 8601 UTC timestamp
  surgeFt: number; // Meteorological storm surge in feet MLLW
  tideFt: number;  // Astronomical tide in feet MLLW
  totalFt: number; // Total forecasted water level in feet MLLW
  anomalyFt: number; // Sub-tidal anomaly in feet
}

export interface NoaaSurgeForecast {
  station: string;
  stationName: string;
  retrievedAt: string;
  points: NoaaSurgePoint[];
}

export interface NoaaEtssStationConfig {
  stationCode: string; // e.g. 'ncwrit', 'ncwilm', 'ncbeau', 'scmyrt', 'scchar', 'gafpul'
  noaaStationId: string; // e.g. '8658163', '8658120', '8656483', '8661070'
  stationName: string;
  region?: 'me' | 'gom' | 'wc' | 'ak';
}

export const WRIGHTSVILLE_ETSS_CONFIG: NoaaEtssStationConfig = {
  stationCode: 'ncwrit',
  noaaStationId: '8658163',
  stationName: 'Wrightsville Beach, NC (ncwrit)',
  region: 'me',
};

export const WILMINGTON_RIVER_ETSS_CONFIG: NoaaEtssStationConfig = {
  stationCode: 'ncwilm',
  noaaStationId: '8658120',
  stationName: 'Wilmington Cape Fear River, NC (ncwilm)',
  region: 'me',
};

export function buildEtssUrl(stationCode = 'ncwrit', region = 'me'): string {
  return `https://slosh.nws.noaa.gov/etsurge/index.php?page=stn&region=${encodeURIComponent(region)}&datum=mllw&list=&map=0-96&type=text&stn=${encodeURIComponent(stationCode)}`;
}

/**
 * Parses the raw NOAA ETSS text table into structured hourly predictions.
 * Row format: "MM/DD HHZ,   Surge,   Tide,    Obs,   Fcst,   Anom, Comment"
 */
export function parseNoaaSurgeTable(rawText: string, referenceYear = new Date().getUTCFullYear()): NoaaSurgePoint[] {
  const lines = rawText.split('\n');
  const points: NoaaSurgePoint[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;

    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 6) continue;

    const dateStr = parts[0]; // e.g. "10/25 12Z"
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2})Z$/i);
    if (!match) continue;

    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const hour = parseInt(match[3], 10);

    const surge = parseFloat(parts[1]);
    const tide = parseFloat(parts[2]);
    const fcst = parseFloat(parts[4]);
    const anom = parseFloat(parts[5]);

    if (isNaN(surge) || isNaN(tide)) continue;
    // Reject NOAA missing value sentinel (99.90 / -99.90) and unphysical values.
    // Surge along the US Atlantic coast is physically bounded within [-10, 25] ft.
    if (Math.abs(surge) >= 80 || Math.abs(tide) >= 80) continue;

    // Build ISO Date in UTC
    const date = new Date(Date.UTC(referenceYear, month - 1, day, hour, 0, 0, 0));
    
    // Handle potential year-end rollover
    const nowMonth = new Date().getUTCMonth() + 1;
    if (nowMonth === 12 && month === 1) {
      date.setUTCFullYear(referenceYear + 1);
    } else if (nowMonth === 1 && month === 12) {
      date.setUTCFullYear(referenceYear - 1);
    }

    points.push({
      t: date.toISOString(),
      surgeFt: surge,
      tideFt: tide,
      totalFt: !isNaN(fcst) && Math.abs(fcst) < 80 ? fcst : tide + surge,
      anomalyFt: isNaN(anom) || Math.abs(anom) >= 80 ? 0 : anom,
    });
  }

  // Sort chronologically and deduplicate
  points.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return points.filter((p, i) => i === 0 || p.t !== points[i - 1].t);
}

/**
 * Fetches NOAA's official 102-hour Extra-Tropical Storm Surge (ETSS) forecast for any configured station.
 * Defaults to Wrightsville Beach (ncwrit / 8658163) for backwards compatibility.
 */
export async function fetchNoaaSurgeForecast(
  timeoutMs = 10_000,
  stationConfig: NoaaEtssStationConfig = WRIGHTSVILLE_ETSS_CONFIG
): Promise<NoaaSurgeForecast | null> {
  try {
    const url = buildEtssUrl(stationConfig.stationCode, stationConfig.region ?? 'me');
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FloodCast-Engine/1.0 (+https://floodcastwebapp.web.app)',
        'Accept': 'text/html,text/plain',
      },
      timeout: timeoutMs,
    });

    if (!res.ok) {
      logger.warn('NOAA ETSurge HTTP request failed', { status: res.status, station: stationConfig.stationCode });
      return null;
    }

    const html = await res.text();
    const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    const textContent = preMatch ? preMatch[1] : html;

    const points = parseNoaaSurgeTable(textContent);
    if (!points.length) {
      logger.warn('NOAA ETSurge parsed zero valid points', { station: stationConfig.stationCode });
      return null;
    }

    return {
      station: stationConfig.noaaStationId,
      stationName: stationConfig.stationName,
      retrievedAt: new Date().toISOString(),
      points,
    };
  } catch (err) {
    logger.error('Failed to retrieve NOAA ETSurge forecast', { station: stationConfig.stationCode, error: safeError(err) });
    return null;
  }
}
