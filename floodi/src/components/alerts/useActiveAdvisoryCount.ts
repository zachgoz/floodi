import { useState, useEffect } from 'react';
import { readPublicAlertFeed, type PublicFloodAdvisory } from 'src/lib/citizenAlerts';

export interface ActiveAdvisorySummary {
  count: number;
  highestSeverity: 'minor' | 'moderate' | 'major' | 'extreme' | null;
  loading: boolean;
}

const SEVERITY_ORDER: Record<'minor' | 'moderate' | 'major' | 'extreme', number> = {
  minor: 1,
  moderate: 2,
  major: 3,
  extreme: 4,
};

export function useActiveAdvisoryCount(): ActiveAdvisorySummary {
  const [summary, setSummary] = useState<ActiveAdvisorySummary>({
    count: 0,
    highestSeverity: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function fetchAdvisories() {
      try {
        const feed = await readPublicAlertFeed(controller.signal);
        if (!active || !feed) {
          if (active) setSummary(prev => ({ ...prev, loading: false }));
          return;
        }

        const advisories: PublicFloodAdvisory[] = Array.isArray(feed.activeAdvisories)
          ? feed.activeAdvisories
          : [];

        let highest: 'minor' | 'moderate' | 'major' | 'extreme' | null = null;
        for (const adv of advisories) {
          if (!highest || SEVERITY_ORDER[adv.severity] > SEVERITY_ORDER[highest]) {
            highest = adv.severity;
          }
        }

        if (active) {
          setSummary({
            count: advisories.length,
            highestSeverity: highest,
            loading: false,
          });
        }
      } catch {
        if (active) setSummary(prev => ({ ...prev, loading: false }));
      }
    }

    void fetchAdvisories();

    // Recheck on window focus or custom refresh events
    const handleFocus = () => { void fetchAdvisories(); };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('floodcast:alerts-updated', handleFocus);

    return () => {
      active = false;
      controller.abort();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('floodcast:alerts-updated', handleFocus);
    };
  }, []);

  return summary;
}

