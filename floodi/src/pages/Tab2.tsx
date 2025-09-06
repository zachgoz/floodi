import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonSpinner, IonTitle, IonToolbar, IonRefresher, IonRefresherContent, IonSelect, IonSelectOption, IonAccordionGroup, IonAccordion, IonSegment, IonSegmentButton, IonDatetime, IonButtons, IonButton, IonIcon, IonModal, IonInput, IonListHeader } from '@ionic/react';
import { settingsOutline, closeOutline, navigateOutline, warningOutline, speedometerOutline, calendarOutline, globeOutline } from 'ionicons/icons';
import './Tab2.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing } from '../lib/noaa';

const DEFAULT_STATION = '8658163';
const DEFAULT_THRESHOLD_FT = 6.1; // MLLW feet
const DEFAULT_LOOKBACK_PAST_H = 36;
const DEFAULT_LOOKAHEAD_H = 48;
const H_LB_KEY = 'floodi.hist.lookbackH';
const H_LA_KEY = 'floodi.hist.lookaheadH';
const H_MODE_KEY = 'floodi.hist.rangeMode';
const TZ_KEY = 'floodi.tz';
const H_ABS_START_KEY = 'floodi.hist.absStart';
const H_ABS_END_KEY = 'floodi.hist.absEnd';
const STATION_KEY = 'floodi.station';
const THRESH_KEY = 'floodi.threshold';
const OFFSET_VAL_KEY = 'floodi.offset.value';
const OFFSET_MODE_KEY = 'floodi.offset.mode';

type Point = { t: Date; v: number };

function seriesToPoints(series: Record<string, number>): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

function buildPolyline(points: Point[], xOf: (d: Date) => number, yOf: (v: number) => number): string {
  return points.map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ');
}

const Tab2: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [nPoints, setNPoints] = useState<number>(0);
  const [observed, setObserved] = useState<Record<string, number>>({});
  const [adjusted, setAdjusted] = useState<Record<string, number>>({});
  const [predicted, setPredicted] = useState<Record<string, number>>({});
  const [rangeMode, setRangeMode] = useState<'relative' | 'absolute'>(() => {
    try { return ((typeof window !== 'undefined' && window.localStorage.getItem(H_MODE_KEY)) as any) || 'relative'; } catch { return 'relative'; }
  });
  const [lookbackH, setLookbackH] = useState<number>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(H_LB_KEY) : null;
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKBACK_PAST_H;
    } catch { return DEFAULT_LOOKBACK_PAST_H; }
  });
  const [lookaheadH, setLookaheadH] = useState<number>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(H_LA_KEY) : null;
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKAHEAD_H;
    } catch { return DEFAULT_LOOKAHEAD_H; }
  });
  const [absStart, setAbsStart] = useState<string>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(H_ABS_START_KEY) : null;
      if (v) return v;
      return new Date(Date.now() - DEFAULT_LOOKBACK_PAST_H * 3600_000).toISOString();
    } catch { return new Date(Date.now() - DEFAULT_LOOKBACK_PAST_H * 3600_000).toISOString(); }
  });
  const [absEnd, setAbsEnd] = useState<string>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(H_ABS_END_KEY) : null;
      if (v) return v;
      return new Date(Date.now() + DEFAULT_LOOKAHEAD_H * 3600_000).toISOString();
    } catch { return new Date(Date.now() + DEFAULT_LOOKAHEAD_H * 3600_000).toISOString(); }
  });
  const [tz, setTz] = useState<'local' | 'gmt'>(() => {
    try { return ((typeof window !== 'undefined' && window.localStorage.getItem(TZ_KEY)) as any) || 'local'; } catch { return 'local'; }
  });

  const fmt = useCallback((d: Date) => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
    if (tz === 'gmt') (opts as any).timeZone = 'UTC';
    let s = new Intl.DateTimeFormat(undefined, opts).format(d);
    s = s.replace(/\s?([AP]M)$/,(m)=>m.trim().toLowerCase());
    return s;
  }, [tz]);
  const [hoverT, setHoverT] = useState<Date | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [station, setStation] = useState<string>(() => {
    try { return (typeof window !== 'undefined' && (window.localStorage.getItem(STATION_KEY) || DEFAULT_STATION)) as string; } catch { return DEFAULT_STATION; }
  });
  const [threshold, setThreshold] = useState<number>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(THRESH_KEY) : null;
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_FT;
    } catch { return DEFAULT_THRESHOLD_FT; }
  });
  const [validatingStation, setValidatingStation] = useState(false);
  const [stationInfo, setStationInfo] = useState<null | { id: string; name: string; state?: string; lat?: number; lon?: number }>(null);
  const [stationInfoErr, setStationInfoErr] = useState<string | null>(null);

  const validateStation = useCallback(async () => {
    setValidatingStation(true);
    setStationInfoErr(null);
    setStationInfo(null);
    try {
      const res = await fetch(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${encodeURIComponent(station)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const st = data?.stations?.[0];
      if (!st) throw new Error('Station not found');
      setStationInfo({ id: st.id, name: st.name, state: st.state, lat: st.lat, lon: st.lng ?? st.lon });
    } catch (e: any) {
      setStationInfoErr(e?.message || 'Failed to fetch station');
    } finally {
      setValidatingStation(false);
    }
  }, [station]);

  // Auto-validate station when settings open if not validated yet for this ID
  useEffect(() => {
    if (showSettings) {
      if (!validatingStation && (!stationInfo || stationInfo.id !== station)) {
        validateStation();
      }
    }
  }, [showSettings, station, stationInfo, validatingStation, validateStation]);
  const [manualOffsetStr, setManualOffsetStr] = useState<string>(() => {
    try { return (typeof window !== 'undefined' && (window.localStorage.getItem(OFFSET_VAL_KEY) || '')) as string; } catch { return ''; }
  });
  const [offsetMode, setOffsetMode] = useState<'auto' | 'manual'>(() => {
    try { return ((typeof window !== 'undefined' && window.localStorage.getItem(OFFSET_MODE_KEY)) as any) || 'auto'; } catch { return 'auto'; }
  });
  

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const startPast = rangeMode === 'relative' ? new Date(now.getTime() - lookbackH * 3600_000) : new Date(absStart);
      const endFuture = rangeMode === 'relative' ? new Date(now.getTime() + lookaheadH * 3600_000) : new Date(absEnd);
      // Build adjusted future (also computes surge offset from last 6h internally)
      const { adjusted, offset, n } = await buildAdjustedFuture({
        station: station,
        now,
        lookbackHours: 6,
        lookaheadHours: lookaheadH,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      const obs = await fetchObservedWaterLevels({
        station: station,
        start: startPast,
        end: now,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      const pred = await fetchPredictions({
        station: station,
        start: startPast,
        end: endFuture,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      setObserved(obs);
      setAdjusted(adjusted);
      setPredicted(pred);
      setOffset(offset);
      setNPoints(n);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [rangeMode, lookbackH, lookaheadH, absStart, absEnd, station]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Persist preferences
  useEffect(() => {
    try { window.localStorage.setItem(H_LB_KEY, String(lookbackH)); } catch {}
  }, [lookbackH]);
  useEffect(() => {
    try { window.localStorage.setItem(H_LA_KEY, String(lookaheadH)); } catch {}
  }, [lookaheadH]);
  useEffect(() => {
    try { window.localStorage.setItem(STATION_KEY, station); } catch {}
  }, [station]);
  useEffect(() => {
    try { window.localStorage.setItem(THRESH_KEY, String(threshold)); } catch {}
  }, [threshold]);
  useEffect(() => {
    try { window.localStorage.setItem(OFFSET_VAL_KEY, manualOffsetStr); } catch {}
  }, [manualOffsetStr]);
  useEffect(() => {
    try { window.localStorage.setItem(OFFSET_MODE_KEY, offsetMode); } catch {}
  }, [offsetMode]);
  useEffect(() => {
    try { window.localStorage.setItem(TZ_KEY, tz); } catch {}
  }, [tz]);
  useEffect(() => {
    try { window.localStorage.setItem(H_MODE_KEY, rangeMode); } catch {}
  }, [rangeMode]);
  useEffect(() => {
    try { window.localStorage.setItem(H_ABS_START_KEY, absStart); } catch {}
  }, [absStart]);
  useEffect(() => {
    try { window.localStorage.setItem(H_ABS_END_KEY, absEnd); } catch {}
  }, [absEnd]);

  const now = new Date();
  const domainStart = rangeMode === 'relative' ? new Date(now.getTime() - lookbackH * 3600_000) : new Date(absStart);
  const domainEnd = rangeMode === 'relative' ? new Date(now.getTime() + lookaheadH * 3600_000) : new Date(absEnd);

  const obsPts = useMemo(() => seriesToPoints(observed).filter(p => p.t >= domainStart && p.t <= domainEnd), [observed]);
  const effectiveOffset = useMemo(() => {
    if (offsetMode === 'manual') {
      const v = parseFloat(manualOffsetStr);
      return !Number.isNaN(v) ? v : 0;
    }
    return offset ?? 0;
  }, [manualOffsetStr, offsetMode, offset]);
  const adjustedSeries = useMemo(() => {
    const out: Record<string, number> = {};
    const nowMs = now.getTime();
    for (const [k, v] of Object.entries(predicted)) {
      const t = new Date(k).getTime();
      if (t >= nowMs) out[k] = v + effectiveOffset;
    }
    return out;
  }, [predicted, effectiveOffset]);
  const adjPts = useMemo(() => seriesToPoints(adjustedSeries).filter(p => p.t >= domainStart && p.t <= domainEnd), [adjustedSeries]);
  const predPts = useMemo(() => seriesToPoints(predicted).filter(p => p.t >= domainStart && p.t <= domainEnd), [predicted]);

  const yMinMax = useMemo(() => {
    const vals = [...obsPts.map(p => p.v), ...adjPts.map(p => p.v), ...predPts.map(p => p.v), threshold];
    if (vals.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 0.5; max += 0.5; }
    // Pad
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }, [obsPts, adjPts]);

  // SVG sizing
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 900, h: 420 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        const w = Math.max(320, Math.floor(cr.width));
        const h = Math.max(240, Math.floor(cr.height));
        setSize({ w, h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w, H = size.h; // match device pixels to keep text readable
  const M = { l: 50, r: 20, t: 10, b: 30 };
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const t0 = domainStart.getTime();
  const t1 = domainEnd.getTime();
  const xOf = (d: Date) => M.l + ((d.getTime() - t0) / (t1 - t0)) * innerW;
  const yOf = (v: number) => M.t + (1 - (v - yMinMax.min) / (yMinMax.max - yMinMax.min)) * innerH;

  // Pointer interaction
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, (px - M.l * (rect.width / W)) / ((innerW) * (rect.width / W))));
    const tMs = t0 + frac * (t1 - t0);
    setHoverT(new Date(tMs));
  };
  const onPointerLeave = () => setHoverT(null);

  // Flood segments from adjusted series
  const floodRects = useMemo(() => {
    const rects: { x: number; w: number }[] = [];
    if (adjPts.length < 2) return rects;
    let above = false;
    let segStart: Date | null = null;
    for (let i = 1; i < adjPts.length; i++) {
      const a = adjPts[i - 1];
      const b = adjPts[i];
      const aAbove = a.v >= threshold;
      const bAbove = b.v >= threshold;
      if (!above && (aAbove || (!aAbove && bAbove))) {
        // entering segment - interpolate start
        let startT = a.t;
        if (!aAbove && bAbove && b.v !== a.v) {
          const frac = (threshold - a.v) / (b.v - a.v);
          startT = new Date(a.t.getTime() + frac * (b.t.getTime() - a.t.getTime()));
        }
        segStart = startT; above = true;
      }
      if (above && (!bAbove)) {
        // leaving segment - interpolate end
        let endT = b.t;
        if (b.v !== a.v) {
          const frac = (threshold - a.v) / (b.v - a.v);
          endT = new Date(a.t.getTime() + frac * (b.t.getTime() - a.t.getTime()));
        }
        const x = xOf(segStart!);
        const w = Math.max(1, xOf(endT) - x);
        rects.push({ x, w });
        above = false; segStart = null;
      }
    }
    if (above && segStart) {
      const x = xOf(segStart);
      const w = Math.max(1, xOf(domainEnd) - x);
      rects.push({ x, w });
    }
    return rects;
  }, [adjPts]);

  const crossing = useMemo(() => findNextThresholdCrossing(adjustedSeries, threshold, now), [adjustedSeries, threshold]);

  function nearest(points: Point[], t: Date): { p: Point; dtMin: number } | null {
    if (points.length === 0) return null;
    let best = points[0];
    let bestDt = Math.abs(best.t.getTime() - t.getTime());
    for (let i = 1; i < points.length; i++) {
      const d = Math.abs(points[i].t.getTime() - t.getTime());
      if (d < bestDt) { best = points[i]; bestDt = d; }
    }
    return { p: best, dtMin: bestDt / 60000 };
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>History & Forecast</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Settings" onClick={() => setShowSettings(true)}>
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">History & Forecast</IonTitle>
            <IonButtons slot="end">
              <IonButton aria-label="Settings" onClick={() => setShowSettings(true)}>
                <IonIcon icon={settingsOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { try { await refresh(); } finally { (e as any).detail.complete(); } }}>
          <IonRefresherContent pullingText="Pull to refresh" refreshingSpinner="crescent" />
        </IonRefresher>
        <IonModal isOpen={showSettings} onDidDismiss={() => setShowSettings(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Settings</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowSettings(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="settingsContent">
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={navigateOutline} slot="start" />
                <IonLabel>Station</IonLabel>
              </IonListHeader>
              <IonItem lines="none">
                <IonNote color="medium">NOAA station ID to use for observations and predictions.</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Station ID</IonLabel>
                <IonInput value={station} inputmode="numeric" onIonChange={(e) => setStation((e.detail.value as string) || '')} placeholder={DEFAULT_STATION} />
              </IonItem>
              <IonItem lines="none">
                <IonButton onClick={validateStation} disabled={!station || validatingStation} color="primary">
                  {validatingStation ? 'Validating…' : 'Validate Station'}
                </IonButton>
                {stationInfoErr && (
                  <IonNote slot="end" color="danger">{stationInfoErr}</IonNote>
                )}
              </IonItem>
              {stationInfo && (
                <IonItem lines="none">
                  <IonLabel>
                    <p><strong>{stationInfo.name} ({stationInfo.id}){stationInfo.state ? `, ${stationInfo.state}` : ''}</strong></p>
                    {(stationInfo.lat !== undefined && stationInfo.lon !== undefined) && (
                      <p>{Number(stationInfo.lat).toFixed(4)}, {Number(stationInfo.lon).toFixed(4)}</p>
                    )}
                  </IonLabel>
                </IonItem>
              )}
            </IonList>
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={warningOutline} slot="start" />
                <IonLabel>Flood Threshold</IonLabel>
              </IonListHeader>
              <IonItem lines="none">
                <IonNote color="medium">Water level (ft MLLW) where flooding starts. The red line and alerts use this value.</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked">Flood Threshold (ft, MLLW)</IonLabel>
                <IonInput value={String(threshold)} inputmode="decimal" onIonChange={(e) => {
                  const raw = (e.detail.value as string) || '';
                  const v = parseFloat(raw);
                  if (!Number.isNaN(v)) setThreshold(v);
                }} />
              </IonItem>
            </IonList>
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={speedometerOutline} slot="start" />
                <IonLabel>Surge Offset</IonLabel>
              </IonListHeader>
              <IonItem lines="none">
                <IonNote color="medium">Offset accounts for wind/pressure setup by comparing recent observed levels to predictions. It is added to future predictions to form the adjusted prediction.</IonNote>
              </IonItem>
              <IonItem>
                <IonSegment value={offsetMode} onIonChange={(e) => setOffsetMode(e.detail.value as any)}>
                  <IonSegmentButton value="auto">
                    <IonLabel>Auto</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="manual">
                    <IonLabel>Manual</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
              </IonItem>
              {offsetMode === 'manual' ? (
                <IonItem>
                  <IonLabel position="stacked">Manual Offset (ft)</IonLabel>
                  <IonInput value={manualOffsetStr} inputmode="decimal" placeholder="Enter offset in feet" onIonChange={(e) => {
                    setManualOffsetStr(((e.detail.value as string) ?? ''));
                  }} />
                </IonItem>
              ) : (
                <IonItem>
                  <IonLabel>
                    <p><strong>Computed Surge Offset</strong></p>
                    <p>{offset !== null ? `${offset >= 0 ? '+' : ''}${offset.toFixed(2)} ft ${nPoints} pts` : '—'}</p>
                  </IonLabel>
                </IonItem>
              )}
            </IonList>
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={calendarOutline} slot="start" />
                <IonLabel>Time Range</IonLabel>
              </IonListHeader>
              <IonItem lines="none">
                <IonNote color="medium">Choose between a window around now (Relative) or a specific interval (Absolute).</IonNote>
              </IonItem>
              <IonItem>
                <IonSegment value={rangeMode} onIonChange={(e) => setRangeMode(e.detail.value as any)}>
                  <IonSegmentButton value="relative">
                    <IonLabel>Relative</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="absolute">
                    <IonLabel>Absolute</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
              </IonItem>
             </IonList>
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={globeOutline} slot="start" />
                <IonLabel>Time Zone</IonLabel>
              </IonListHeader>
              <IonItem lines="none">
                <IonNote color="medium">Controls how times are displayed and picked. NOAA data is in GMT; this setting only changes display.</IonNote>
              </IonItem>
              <IonItem>
                <IonSegment value={tz} onIonChange={(e) => setTz(e.detail.value as any)}>
                  <IonSegmentButton value="local">
                    <IonLabel>Local</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="gmt">
                    <IonLabel>GMT</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
              </IonItem>
            </IonList>
            {rangeMode === 'relative' ? (
              <IonList inset>
                <IonItem lines="none">
                  <IonNote color="medium">Relative windows are measured from the current time.</IonNote>
                </IonItem>
                <IonItem>
                  <IonLabel>Past window</IonLabel>
                  <IonSelect value={lookbackH} onIonChange={(e) => setLookbackH(e.detail.value)} interface="popover">
                    {[12, 24, 36, 48, 60].map(h => (
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
            ) : (
              <IonList inset>
                <IonItem lines="none">
                  <IonNote color="medium">Start and End respect the selected time zone above.</IonNote>
                </IonItem>
                <IonItem>
                  <IonLabel>Start ({tz === 'gmt' ? 'GMT' : 'Local'})</IonLabel>
                  <IonDatetime value={absStart} onIonChange={(e) => setAbsStart(e.detail.value as string)} presentation="date-time" minuteValues="0,6,12,18,24,30,36,42,48,54" />
                </IonItem>
                <IonItem>
                  <IonLabel>End ({tz === 'gmt' ? 'GMT' : 'Local'})</IonLabel>
                  <IonDatetime value={absEnd} onIonChange={(e) => setAbsEnd(e.detail.value as string)} presentation="date-time" minuteValues="0,6,12,18,24,30,36,42,48,54" />
                </IonItem>
              </IonList>
            )}
            
          </IonContent>
        </IonModal>
        {loading && (
          <div style={{ padding: 16 }}>
            <IonSpinner name="crescent" />
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
        {!error && (
          <div className="chartWrap" ref={wrapRef}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              role="img"
              aria-label="Water level chart"
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              style={{ touchAction: 'none', cursor: 'crosshair' }}
            >
              <defs>
                <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse" />
              </defs>
              {/* Background */}
              <rect x={0} y={0} width={W} height={H} fill="var(--chart-bg)" />
              {/* Plot area */}
              <rect x={M.l} y={M.t} width={innerW} height={innerH} fill="var(--chart-plot-bg)" stroke="var(--chart-plot-stroke)" />
              {/* Flood segments */}
              {floodRects.map((r, i) => (
                <rect key={i} x={r.x} y={M.t} width={r.w} height={innerH} fill="rgba(255,0,0,0.08)" />
              ))}
              {/* Threshold line */}
              <line x1={M.l} x2={M.l + innerW} y1={yOf(threshold)} y2={yOf(threshold)} stroke="#e74c3c" strokeDasharray="6 4" />
              <text x={M.l + 6} y={yOf(threshold) - 6} fill="#e74c3c" fontSize="12">{threshold.toFixed(1)} ft threshold</text>
              {/* Now marker */}
              <line x1={xOf(now)} x2={xOf(now)} y1={M.t} y2={M.t + innerH} stroke="#888" strokeDasharray="2 4" />
              <text x={xOf(now) + 4} y={M.t + 12} fill="var(--chart-axis-text)" fontSize="12">now</text>
              {/* Observed polyline */}
              {obsPts.length > 1 && (
                <polyline fill="none" stroke="#2ecc71" strokeWidth="2" points={buildPolyline(obsPts, xOf, yOf)} />
              )}
              {/* Adjusted prediction polyline */}
              {adjPts.length > 1 && (
                <polyline fill="none" stroke="#2ecc71" strokeWidth="2" strokeDasharray="5 4" points={buildPolyline(adjPts, xOf, yOf)} />
              )}
              {/* Unadjusted prediction polyline */}
              {predPts.length > 1 && (
                <polyline fill="none" stroke="#95a5a6" strokeWidth="2" opacity={0.9} points={buildPolyline(predPts, xOf, yOf)} />
              )}
              {/* Y axis ticks */}
              {Array.from({ length: 6 }).map((_, i) => {
                const v = yMinMax.min + (i / 5) * (yMinMax.max - yMinMax.min);
                const y = yOf(v);
                return (
                  <g key={i}>
                    <line x1={M.l} x2={M.l + innerW} y1={y} y2={y} stroke="var(--chart-grid)" />
                    <text x={4} y={y + 4} fill="var(--chart-axis-text)" fontSize="12">{v.toFixed(1)} ft</text>
                  </g>
                );
              })}
              {/* Legend (matches tooltip labels and order) */}
              <g transform={`translate(${M.l}, ${H - 10})`}>
                <circle r={4} fill="#2ecc71" />
                <text x={10} y={4} fill="var(--chart-label-text)" fontSize="12">Observed</text>
                <line x1={90} x2={110} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
                <text x={120} y={4} fill="var(--chart-label-text)" fontSize="12">Prediction</text>
                <line x1={210} x2={230} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
                <text x={240} y={4} fill="var(--chart-label-text)" fontSize="12">Adjusted prediction</text>
              </g>

              {/* Hover crosshair and tooltip */}
              {hoverT && (
                <g>
                  <line x1={xOf(hoverT)} x2={xOf(hoverT)} y1={M.t} y2={M.t + innerH} stroke="#bbb" strokeDasharray="3 3" />
                  {(() => {
                    const nObs = nearest(obsPts, hoverT);
                    const nAdj = nearest(adjPts, hoverT);
                    const nPred = nearest(predPts, hoverT);
                    const rows: { label: string; value: string; color: string; cx?: number; cy?: number }[] = [];
                    if (nObs && nObs.dtMin <= 9) {
                      rows.push({ label: 'Observed', value: `${nObs.p.v.toFixed(2)} ft`, color: '#2ecc71', cx: xOf(nObs.p.t), cy: yOf(nObs.p.v) });
                    } else {
                      rows.push({ label: 'Observed', value: '—', color: '#2ecc71' });
                    }
                    if (nPred) rows.push({ label: 'Prediction', value: `${nPred.p.v.toFixed(2)} ft`, color: '#95a5a6', cx: xOf(nPred.p.t), cy: yOf(nPred.p.v) });
                    if (nAdj) rows.push({ label: 'Adjusted prediction', value: `${nAdj.p.v.toFixed(2)} ft`, color: '#2ecc71', cx: xOf(nAdj.p.t), cy: yOf(nAdj.p.v) });

                    // Marker dots
                    return (
                      <g>
                        {rows.map((r, i) => (
                          r.cx !== undefined && r.cy !== undefined ? <circle key={`mk-${i}`} cx={r.cx} cy={r.cy} r={3.5} fill={r.color} stroke="#000" /> : null
                        ))}
                        {/* Tooltip box */}
                        {(() => {
                          const x = xOf(hoverT) + 8;
                          const y = M.t + 8;
                          const boxW = 170;
                          const lineH = 14;
                          const rowsH = (rows.length + 1) * lineH + 8;
                          const boxX = Math.min(x, M.l + innerW - boxW - 4);
                          const boxY = y;
                          return (
                            <g>
                              <rect x={boxX} y={boxY} width={boxW} height={rowsH} rx={6} ry={6} fill="var(--chart-tooltip-bg)" stroke="var(--chart-tooltip-stroke)" />
                              <text x={boxX + 8} y={boxY + 16} fill="var(--chart-label-text)" fontSize="12">{fmt(hoverT)} {tz === 'gmt' ? 'GMT' : ''}</text>
                              {rows.map((r, i) => (
                                <g key={`row-${i}`}>
                                  <circle cx={boxX + 10} cy={boxY + 30 + i * lineH - 4} r={4} fill={r.color} />
                                  <text x={boxX + 20} y={boxY + 30 + i * lineH} fill="var(--chart-label-text)" fontSize="12">{r.label}: {r.value}</text>
                                </g>
                              ))}
                            </g>
                          );
                        })()}
                      </g>
                    );
                  })()}
                </g>
              )}
            </svg>
          </div>
        )}
        {!loading && !error && (
          <IonList inset>
            {crossing && (
              <IonItem>
                <IonLabel>
                  <h2>Next Flood Crossing ({tz === 'gmt' ? 'GMT' : 'Local'})</h2>
                  <p>{fmt(crossing.tCross)}<IonNote style={{ marginLeft: 8 }} color="medium">lead {crossing.leadMinutes} min</IonNote></p>
                </IonLabel>
              </IonItem>
            )}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Tab2;
