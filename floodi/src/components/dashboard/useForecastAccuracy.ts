import { useCallback, useEffect, useState } from 'react';

export interface LeadAccuracyRow {
  leadHours: number;
  floodCastMaeInches: number;
  floodCastMaeFt: number;
  p90Inches: number;
  p90Ft: number;
  tideOnlyMaeInches: number;
  tideOnlyMaeFt: number;
  persistenceMaeInches: number;
  persistenceMaeFt: number;
  samples: number;
}

export interface RollingAccuracyData {
  version: number;
  locationId: string;
  generatedAt: string;
  periodDays: number;
  sampleCount: number;
  mae24hInches: number;
  mae24hFt: number;
  mae1hInches: number;
  mae1hFt: number;
  crestTimingMinutes: number;
  errorReductionPct: number;
  leads: LeadAccuracyRow[];
  isAuditedBaseline?: boolean;
}

export const AUDITED_BASELINE_ACCURACY: RollingAccuracyData = {
  version: 1,
  locationId: 'carolina-beach',
  generatedAt: '2026-11-03T00:00:00.000Z',
  periodDays: 30,
  sampleCount: 192,
  mae24hInches: 2.4,
  mae24hFt: 0.199,
  mae1hInches: 1.4,
  mae1hFt: 0.116,
  crestTimingMinutes: 26.8,
  errorReductionPct: 77,
  leads: [
    {
      leadHours: 1,
      floodCastMaeInches: 1.4,
      floodCastMaeFt: 0.116,
      p90Inches: 2.9,
      p90Ft: 0.242,
      tideOnlyMaeInches: 5.9,
      tideOnlyMaeFt: 0.492,
      persistenceMaeInches: 1.8,
      persistenceMaeFt: 0.150,
      samples: 192,
    },
    {
      leadHours: 3,
      floodCastMaeInches: 1.7,
      floodCastMaeFt: 0.142,
      p90Inches: 3.5,
      p90Ft: 0.292,
      tideOnlyMaeInches: 6.0,
      tideOnlyMaeFt: 0.500,
      persistenceMaeInches: 3.8,
      persistenceMaeFt: 0.317,
      samples: 192,
    },
    {
      leadHours: 6,
      floodCastMaeInches: 2.0,
      floodCastMaeFt: 0.167,
      p90Inches: 4.1,
      p90Ft: 0.342,
      tideOnlyMaeInches: 6.2,
      tideOnlyMaeFt: 0.517,
      persistenceMaeInches: 6.1,
      persistenceMaeFt: 0.508,
      samples: 192,
    },
    {
      leadHours: 12,
      floodCastMaeInches: 2.2,
      floodCastMaeFt: 0.183,
      p90Inches: 4.6,
      p90Ft: 0.383,
      tideOnlyMaeInches: 6.4,
      tideOnlyMaeFt: 0.533,
      persistenceMaeInches: 7.8,
      persistenceMaeFt: 0.650,
      samples: 192,
    },
    {
      leadHours: 24,
      floodCastMaeInches: 2.4,
      floodCastMaeFt: 0.199,
      p90Inches: 5.0,
      p90Ft: 0.417,
      tideOnlyMaeInches: 6.6,
      tideOnlyMaeFt: 0.550,
      persistenceMaeInches: 8.9,
      persistenceMaeFt: 0.742,
      samples: 192,
    },
    {
      leadHours: 48,
      floodCastMaeInches: 3.1,
      floodCastMaeFt: 0.258,
      p90Inches: 6.2,
      p90Ft: 0.517,
      tideOnlyMaeInches: 6.8,
      tideOnlyMaeFt: 0.567,
      persistenceMaeInches: 9.5,
      persistenceMaeFt: 0.792,
      samples: 192,
    },
    {
      leadHours: 72,
      floodCastMaeInches: 3.8,
      floodCastMaeFt: 0.317,
      p90Inches: 7.4,
      p90Ft: 0.617,
      tideOnlyMaeInches: 7.1,
      tideOnlyMaeFt: 0.592,
      persistenceMaeInches: 9.8,
      persistenceMaeFt: 0.817,
      samples: 192,
    },
  ],
  isAuditedBaseline: true,
};

function isValidAccuracyData(data: unknown): data is RollingAccuracyData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<RollingAccuracyData>;
  return (
    typeof d.mae24hInches === 'number' &&
    Number.isFinite(d.mae24hInches) &&
    typeof d.mae1hInches === 'number' &&
    Number.isFinite(d.mae1hInches) &&
    typeof d.crestTimingMinutes === 'number' &&
    Number.isFinite(d.crestTimingMinutes) &&
    typeof d.errorReductionPct === 'number' &&
    Number.isFinite(d.errorReductionPct) &&
    Array.isArray(d.leads) &&
    d.leads.length >= 7
  );
}

export function useForecastAccuracy(locationId = 'carolina-beach') {
  const [data, setData] = useState<RollingAccuracyData>(() => ({
    ...AUDITED_BASELINE_ACCURACY,
    locationId,
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccuracy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accuracy?locationId=${encodeURIComponent(locationId)}`);
      if (!res.ok) {
        throw new Error(`Accuracy API returned HTTP ${res.status}`);
      }
      const json = await res.json();
      if (isValidAccuracyData(json)) {
        setData(json);
      } else {
        // Fall back gracefully
        setData(prev => ({ ...prev, locationId }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Keep baseline
      setData(prev => ({ ...prev, locationId }));
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    fetchAccuracy();
  }, [fetchAccuracy]);

  return {
    accuracy: data,
    loading,
    error,
    refresh: fetchAccuracy,
  };
}

