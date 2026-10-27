import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from 'src/lib/firebase';
import type { Point } from '../Tab2/types';

export interface ChallengerPoint {
  t: string;          // ISO 8601 UTC
  totalFt: number;    // Astronomical tide + predicted residual
  tideFt: number;     // Astronomical tide
  residualFt: number; // Foundation model predicted residual
  noaaSurgeFt?: number; // NOAA ETSS hydrodynamic surge guidance
  lowerFt?: number;   // 10th percentile bound
  upperFt?: number;   // 90th percentile bound
}

export interface ChallengerOutlookDocument {
  challengerId: string;
  locationId: string;
  generatedAt: string;
  expiresAt: string;
  status: 'available' | 'unavailable';
  engine: string;
  horizonSteps: number;
  thresholdFt: number;
  points: ChallengerPoint[];
  peak: {
    t: string;
    totalFt: number;
    tideFt: number;
    residualFt: number;
    exceedsThreshold: boolean;
  } | null;
  covariatesUsed: string[];
  metadata?: {
    historyPointsCount: number;
    noaaSurgeAvailable: boolean;
    retrievedAt: string;
  };
}

const POLL_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 15_000;

function isValidChallengerDoc(value: unknown, locationId: string): value is ChallengerOutlookDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<ChallengerOutlookDocument>;
  return (
    d.challengerId === 'timesfm-3' &&
    d.locationId === locationId &&
    d.status === 'available' &&
    Array.isArray(d.points) &&
    d.points.length > 0 &&
    typeof d.generatedAt === 'string'
  );
}

export function useChallengerOutlook(locationId: string) {
  const [challenger, setChallenger] = useState<ChallengerOutlookDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;

    const read = async (): Promise<void> => {
      if (!active) return;
      setLoading(true);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

      try {
        // 1. Try public cached HTTP endpoint first (with 1-minute cache bucket)
        const cacheBucket = Math.floor(Date.now() / 60_000);
        const res = await fetch(`/api/challenger?t=${cacheBucket}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (active && isValidChallengerDoc(json, locationId)) {
            setChallenger(json);
            setLoading(false);
            clearTimeout(timeout);
            return;
          }
        }
      } catch {
        // Fall back to Firestore read below
      } finally {
        clearTimeout(timeout);
      }

      if (!active) return;

      try {
        // 2. Direct Firestore fallback
        const snap = await getDoc(
          doc(db, `locations/${locationId}/forecast_challengers/timesfm-3/outlook/current`)
        );
        if (active && snap.exists()) {
          const data = snap.data();
          if (isValidChallengerDoc(data, locationId)) {
            setChallenger(data);
          }
        }
      } catch {
        // Maintain previous state if both fail
      } finally {
        if (active) setLoading(false);
      }
    };

    refreshRef.current = read;
    void read();

    const pollTimer = setInterval(() => {
      void read();
    }, POLL_MS);

    return () => {
      active = false;
      clearInterval(pollTimer);
    };
  }, [locationId]);

  const totalPoints = useMemo<Point[]>(() => {
    if (!challenger?.points) return [];
    return challenger.points.map(p => ({ t: new Date(p.t), v: p.totalFt }));
  }, [challenger]);

  const lowerPoints = useMemo<Point[]>(() => {
    if (!challenger?.points) return [];
    return challenger.points
      .filter(p => typeof p.lowerFt === 'number')
      .map(p => ({ t: new Date(p.t), v: p.lowerFt! }));
  }, [challenger]);

  const upperPoints = useMemo<Point[]>(() => {
    if (!challenger?.points) return [];
    return challenger.points
      .filter(p => typeof p.upperFt === 'number')
      .map(p => ({ t: new Date(p.t), v: p.upperFt! }));
  }, [challenger]);

  const residualPoints = useMemo<Point[]>(() => {
    if (!challenger?.points) return [];
    return challenger.points.map(p => ({ t: new Date(p.t), v: p.residualFt }));
  }, [challenger]);

  return {
    challenger,
    loading,
    refresh,
    totalPoints,
    lowerPoints,
    upperPoints,
    residualPoints,
  };
}
