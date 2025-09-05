import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonSpinner, IonTitle, IonToolbar, IonRefresher, IonRefresherContent, IonSelect, IonSelectOption, IonAccordionGroup, IonAccordion, IonSegment, IonSegmentButton } from '@ionic/react';
import './Tab1.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildAdjustedFuture, findNextThresholdCrossing } from '../lib/noaa';

const STATION = '8658163';
const THRESHOLD_FT = 6.1; // MLLW feet
const DEFAULT_LOOKBACK_H = 6;
const DEFAULT_LOOKAHEAD_H = 48;

const LB_KEY = 'floodi.lookbackH';
const LA_KEY = 'floodi.lookaheadH';
const TZ_KEY = 'floodi.tz';

const Tab1: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [nPoints, setNPoints] = useState<number>(0);
  const [adjusted, setAdjusted] = useState<Record<string, number>>({});
  const [lookbackH, setLookbackH] = useState<number>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(LB_KEY) : null;
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKBACK_H;
    } catch { return DEFAULT_LOOKBACK_H; }
  });
  const [lookaheadH, setLookaheadH] = useState<number>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(LA_KEY) : null;
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKAHEAD_H;
    } catch { return DEFAULT_LOOKAHEAD_H; }
  });
  const [tz, setTz] = useState<'local' | 'gmt'>(() => {
    try { return ((typeof window !== 'undefined' && window.localStorage.getItem(TZ_KEY)) as any) || 'local'; } catch { return 'local'; }
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const { adjusted, offset, n } = await buildAdjustedFuture({
        station: STATION,
        now,
        lookbackHours: lookbackH,
        lookaheadHours: lookaheadH,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      setAdjusted(adjusted);
      setOffset(offset);
      setNPoints(n);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [lookbackH, lookaheadH]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Persist preferences
  useEffect(() => {
    try { window.localStorage.setItem(LB_KEY, String(lookbackH)); } catch {}
  }, [lookbackH]);
  useEffect(() => {
    try { window.localStorage.setItem(LA_KEY, String(lookaheadH)); } catch {}
  }, [lookaheadH]);
  useEffect(() => {
    try { window.localStorage.setItem(TZ_KEY, tz); } catch {}
  }, [tz]);

  const fmt = useCallback((d: Date) => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
    if (tz === 'gmt') (opts as any).timeZone = 'UTC';
    // Example: "Sep 5, 7:15 PM" -> "Sep 5, 7:15pm"
    let s = new Intl.DateTimeFormat(undefined, opts).format(d);
    s = s.replace(/\s?([AP]M)$/,(m)=>m.trim().toLowerCase());
    return s;
  }, [tz]);

  const crossing = useMemo(() => {
    if (!adjusted || Object.keys(adjusted).length === 0) return null;
    return findNextThresholdCrossing(adjusted, THRESHOLD_FT, new Date());
  }, [adjusted]);

  const status = useMemo(() => {
    if (!crossing) return 'No crossing in window';
    const lead = crossing.leadMinutes;
    if (lead >= 60) return 'ALERT';
    if (lead >= 0) return 'LATE ALERT';
    return 'ONGOING/PAST';
  }, [crossing]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Canal Dr Flood</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { try { await refresh(); } finally { (e as any).detail.complete(); } }}>
          <IonRefresherContent pullingText="Pull to refresh" refreshingSpinner="crescent" />
        </IonRefresher>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Canal Dr Flood</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonAccordionGroup>
          <IonAccordion value="settings">
            <IonItem slot="header">
              <IonLabel>Settings</IonLabel>
            </IonItem>
            <div slot="content">
              <IonList inset>
                <IonItem>
                  <IonLabel>Time zone</IonLabel>
                  <IonSegment value={tz} onIonChange={(e) => setTz(e.detail.value as any)}>
                    <IonSegmentButton value="local">
                      <IonLabel>Local</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="gmt">
                      <IonLabel>GMT</IonLabel>
                    </IonSegmentButton>
                  </IonSegment>
                </IonItem>
                <IonItem>
                  <IonLabel>Past window</IonLabel>
                  <IonSelect value={lookbackH} onIonChange={(e) => setLookbackH(e.detail.value)} interface="popover">
                    {[3, 6, 12, 24, 36].map(h => (
                      <IonSelectOption key={h} value={h}>{h} hours</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <IonItem>
                  <IonLabel>Future window</IonLabel>
                  <IonSelect value={lookaheadH} onIonChange={(e) => setLookaheadH(e.detail.value)} interface="popover">
                    {[24, 36, 48, 60, 72].map(h => (
                      <IonSelectOption key={h} value={h}>{h} hours</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
              </IonList>
            </div>
          </IonAccordion>
        </IonAccordionGroup>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16 }}>
            <IonSpinner name="crescent" />
            <span>Loading NOAA data…</span>
          </div>
        )}
        {error && (
          <IonItem color="danger">
            <IonLabel>
              <h2>Failed to load</h2>
              <p>{error}</p>
            </IonLabel>
          </IonItem>
        )}
        {!loading && !error && (
          <IonList inset>
            <IonItem>
              <IonLabel>
                <h2>Station</h2>
                <p>{STATION} (Wrightsville Beach, MLLW, feet)</p>
              </IonLabel>
            </IonItem>
            <IonItem>
              <IonLabel>
                <h2>Flood Threshold</h2>
                <p>{THRESHOLD_FT.toFixed(2)} ft</p>
              </IonLabel>
            </IonItem>
            <IonItem>
              <IonLabel>
                <h2>Status</h2>
                <p>{status}</p>
              </IonLabel>
            </IonItem>
            {offset !== null && (
              <IonItem>
                <IonLabel>
                  <h2>Surge Offset</h2>
                  <p>
                    {offset >= 0 ? '+' : ''}{offset.toFixed(2)} ft
                    <IonNote style={{ marginLeft: 8 }} color="medium">based on {nPoints} pts</IonNote>
                  </p>
                  <p>
                    The surge offset is the median difference between the recent observed preliminary water level and the tide prediction. It captures residual effects like wind, pressure, and setup. We add this offset to future predictions to get an adjusted forecast.
                  </p>
                </IonLabel>
              </IonItem>
            )}
            {crossing && (
              <IonItem>
                <IonLabel>
                  <h2>Next Crossing ({tz === 'gmt' ? 'GMT' : 'Local'})</h2>
                  <p>
                    {fmt(crossing.tCross)}
                    <IonNote style={{ marginLeft: 8 }} color="medium">lead {crossing.leadMinutes} min</IonNote>
                  </p>
                </IonLabel>
              </IonItem>
            )}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Tab1;
