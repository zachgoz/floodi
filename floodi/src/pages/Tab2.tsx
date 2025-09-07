import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonSpinner, IonTitle, IonToolbar, IonRefresher, IonRefresherContent, IonSelect, IonSelectOption, IonAccordionGroup, IonAccordion, IonSegment, IonSegmentButton, IonDatetime, IonButtons, IonButton, IonIcon, IonModal, IonInput, IonListHeader, IonToggle, IonToast } from '@ionic/react';
import { settingsOutline, closeOutline, navigateOutline, warningOutline, speedometerOutline, calendarOutline, globeOutline } from 'ionicons/icons';
import './Tab2.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing } from '../lib/noaa';
import { createPortal } from 'react-dom';

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
const STATIONS_CACHE_KEY = 'floodi.stations.cache.v1';
const THRESH_KEY = 'floodi.threshold';
const OFFSET_VAL_KEY = 'floodi.offset.value';
const OFFSET_MODE_KEY = 'floodi.offset.mode';
const DELTA_SHOW_KEY = 'floodi.delta.show';

type Point = { t: Date; v: number };

function seriesToPoints(series: Record<string, number>): Point[] {
  return Object.entries(series)
    .map(([k, v]) => ({ t: new Date(k), v }))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
}

function buildPolyline(points: Point[], xOf: (d: Date) => number, yOf: (v: number) => number): string {
  return points.map(p => `${xOf(p.t)},${yOf(p.v)}`).join(' ');
}

function segmentByThreshold(points: Point[], threshold: number): { points: Point[]; above: boolean }[] {
  const segs: { points: Point[]; above: boolean }[] = [];
  if (!points || points.length < 2) return segs;
  let prev = points[0];
  let above = prev.v >= threshold;
  let cur: Point[] = [prev];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const bAbove = p.v >= threshold;
    if (bAbove === above) {
      cur.push(p);
    } else {
      // Crossed threshold between prev and p; interpolate cross point
      const dv = p.v - prev.v;
      const frac = dv !== 0 ? (threshold - prev.v) / dv : 0;
      const tMs = prev.t.getTime() + Math.max(0, Math.min(1, frac)) * (p.t.getTime() - prev.t.getTime());
      const cross: Point = { t: new Date(tMs), v: threshold };
      cur.push(cross);
      if (cur.length >= 2) segs.push({ points: cur, above });
      // start new segment at crossing
      cur = [cross, p];
      above = bAbove;
    }
    prev = p;
  }
  if (cur.length >= 2) segs.push({ points: cur, above });
  return segs;
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
  const [showDelta, setShowDelta] = useState<boolean>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(DELTA_SHOW_KEY) : null;
      if (v === null) return false; // default OFF
      return v === '1' || v === 'true';
    } catch { return false; }
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
  // Active station ID used by the chart
  const [station, setStation] = useState<string>(() => {
    try { return (typeof window !== 'undefined' && (window.localStorage.getItem(STATION_KEY) || DEFAULT_STATION)) as string; } catch { return DEFAULT_STATION; }
  });
  // Input field value (does not affect chart until validated)
  const [stationInput, setStationInput] = useState<string>(() => {
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
  const [allStations, setAllStations] = useState<Array<{ id: string; name: string; state?: string }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; state?: string }>>([]);
  const [lastSearchQ, setLastSearchQ] = useState<string>('');
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationMenuOpen, setStationMenuOpen] = useState(false);
  const [stationMenuIndex, setStationMenuIndex] = useState<number>(-1);
  const [menuPos, setMenuPos] = useState<null | { left: number; top: number; width: number }>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [stationInfo, setStationInfo] = useState<null | { id: string; name: string; state?: string; lat?: number; lon?: number }>(null);
  const [stationInfoErr, setStationInfoErr] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const validateStation = useCallback(async (_targetId?: string) => {
    // No-op: selection comes from curated list, no validation necessary
  }, []);

  // Station helpers available before effects that reference them
  function displayForStation(id: string): string {
    const s = allStations.find(x => x.id === id);
    return s ? `${s.name} (${s.id})${s.state ? `, ${s.state}` : ''}` : '';
  }

  // Load and cache full station list for searchable dropdown
  useEffect(() => {
    if (!showSettings) return;
    let mounted = true;
    (async () => {
      try {
        // Use cache if not stale (24h)
        const cached = (typeof window !== 'undefined') ? window.localStorage.getItem(STATIONS_CACHE_KEY) : null;
        if (cached) {
          try {
            const { ts, data } = JSON.parse(cached);
            if (Array.isArray(data) && Date.now() - (ts || 0) < 24 * 3600_000) {
              if (mounted) setAllStations(data);
            }
          } catch {}
        }
        if (mounted && allStations.length === 0) {
          setStationsLoading(true);
          const base = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels';
          const res = await fetch(base);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const arr = (data?.stations || []) as any[];
          const mapped = arr.map(s => ({ id: String(s.id), name: String(s.name || ''), state: s.state }));
          if (mounted) {
            setAllStations(mapped);
            try { window.localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: mapped })); } catch {}
          }
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setStationsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [showSettings]);

  // Remote search removed. Local quickFilter drives the UI once allStations is loaded.
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
    // Keep input display in sync when selection changes
    try {
      const disp = displayForStation(station);
      if (disp) setStationInput(disp);
      else setStationInput(station);
    } catch {}
  }, [station]);
  // When station names load, upgrade raw ID in input to display text
  useEffect(() => {
    try {
      const disp = displayForStation(station);
      if (disp && stationInput === station) {
        setStationInput(disp);
      }
    } catch {}
  }, [allStations, station]);
  // Avoid clobbering typed text when stations load; only update input on station change above
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
    try { window.localStorage.setItem(DELTA_SHOW_KEY, showDelta ? '1' : '0'); } catch {}
  }, [showDelta]);
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
  // Station helpers
  const updateMenuPos = useCallback(() => {
    const el = document.getElementById('station-input');
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ left: Math.round(r.left), top: Math.round(r.bottom + 4), width: Math.round(r.width) });
  }, []);
  const fetchAllStations = useCallback(async () => {
    if (stationsLoading || allStations.length > 0) return;
    setStationsLoading(true);
    try {
      const base = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels';
      const res = await fetch(base);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const arr = (data?.stations || []) as any[];
      const mapped = arr.map(s => ({ id: String(s.id), name: String(s.name || ''), state: s.state }));
      setAllStations(mapped);
      try { window.localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: mapped })); } catch {}
    } catch {
      // ignore
    } finally {
      setStationsLoading(false);
    }
  }, [stationsLoading, allStations.length]);
  function quickFilter(q: string) {
    const qq = (q || '').trim().toLowerCase();
    if (!qq) return allStations.slice(0, 25);
    return allStations
      .filter(s => s.id.includes(qq) || s.name.toLowerCase().includes(qq) || (s.state || '').toLowerCase().includes(qq))
      .slice(0, 25);
  }
  const visibleStations = useMemo(() => {
    if (allStations.length === 0) return [] as Array<{ id: string; name: string; state?: string }>;
    return quickFilter(stationInput);
  }, [allStations, stationInput]);

  const applyStationSelection = useCallback((id: string) => {
    // Validate against known list to prevent invalid IDs
    const exists = allStations.find(s => s.id === id);
    if (!exists) {
      setStationInfoErr('Please select a station from the list');
      return;
    }
    setStation(id);
    const disp = displayForStation(id) || id;
    setStationInput(disp);
    setStationMenuOpen(false);
    setStationMenuIndex(-1);
    setStationInfoErr(null);
    setToastMsg(`Station updated to ${disp}`);
  }, [allStations, displayForStation]);

  // Keep portal anchored and close on outside click
  useEffect(() => {
    if (!stationMenuOpen) return;
    const onScroll = () => updateMenuPos();
    const onResize = () => updateMenuPos();
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inputEl = document.getElementById('station-input');
      if (inputEl && inputEl.contains(target)) return; // click in input
      if (menuRef.current && menuRef.current.contains(target)) return; // click in menu
      setStationMenuOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDocClick);
    updateMenuPos();
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [stationMenuOpen, updateMenuPos]);

  // Difference series: Observed - Prediction at matching/nearest timestamps
  const deltaPts = useMemo(() => {
    if (obsPts.length === 0 || predPts.length === 0) return [] as Point[];
    const out: Point[] = [];
    for (const o of obsPts) {
      const n = nearest(predPts, o.t);
      if (n && n.dtMin <= 9) {
        out.push({ t: o.t, v: o.v - n.p.v });
      }
    }
    return out;
  }, [obsPts, predPts]);

  const yMinMax = useMemo(() => {
    const vals = [
      ...obsPts.map(p => p.v),
      ...adjPts.map(p => p.v),
      ...predPts.map(p => p.v),
      ...(showDelta ? deltaPts.map(p => p.v) : []),
      threshold
    ];
    if (vals.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 0.5; max += 0.5; }
    // Pad
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }, [obsPts, adjPts, predPts, deltaPts, threshold, showDelta]);

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
  // Increase bottom margin on smaller widths to give legend breathing room
  const mb = W <= 480 ? 48 : 30;
  const M = { l: 50, r: 20, t: 10, b: mb };
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const t0 = domainStart.getTime();
  const t1 = domainEnd.getTime();
  const xOf = (d: Date) => M.l + ((d.getTime() - t0) / (t1 - t0)) * innerW;
  const yOf = (v: number) => M.t + (1 - (v - yMinMax.min) / (yMinMax.max - yMinMax.min)) * innerH;

  // Delta now uses the main left Y scale (yOf)

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
          <IonTitle>FloodCast</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Settings" onClick={() => setShowSettings(true)}>
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
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
                <IonLabel position="stacked" className="subLabel">Station</IonLabel>
                <div className="stationFieldWrap"
                  onKeyDown={(e) => {
                    const n = visibleStations.length;
                    if (!n) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); setStationMenuOpen(true); setStationMenuIndex((i) => (i + 1) % n); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setStationMenuOpen(true); setStationMenuIndex((i) => (i - 1 + n) % n); }
                    else if (e.key === 'Enter') {
                      if (stationMenuOpen && stationMenuIndex >= 0 && stationMenuIndex < n) {
                        const sel = visibleStations[stationMenuIndex];
                        applyStationSelection(sel.id);
                        e.preventDefault();
                      } else {
                        const q = (stationInput || '').trim();
                        const exact = allStations.find(s => s.id === q);
                        if (exact) { applyStationSelection(exact.id); e.preventDefault(); }
                      }
                    } else if (e.key === 'Escape') { setStationMenuOpen(false); }
                  }}
                >
                  <input
                    role="combobox"
                    aria-expanded={stationMenuOpen}
                    aria-controls="station-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={stationMenuOpen && stationMenuIndex >= 0 ? `station-opt-${stationMenuIndex}` : undefined}
                    id="station-input"
                    className="textInput"
                    value={stationInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStationInput(v);
                      if (stationInfoErr) setStationInfoErr(null);
                      // keep remote results if full list isn't loaded yet
                      if (allStations.length === 0 && !stationsLoading) fetchAllStations();
                      setStationMenuOpen(true);
                      updateMenuPos();
                      setStationMenuIndex(0);
                    }}
                    onFocus={() => {
                      if (allStations.length === 0 && !stationsLoading) fetchAllStations();
                      if (stationInfoErr) setStationInfoErr(null);
                      // open menu; remote effect will populate when needed
                      setStationMenuOpen(true);
                      updateMenuPos();
                      setStationMenuIndex(0);
                    }}
                    placeholder={displayForStation(station) || `${DEFAULT_STATION}`}
                  />
                  <IonButtons>
                    <IonButton
                      onClick={() => { applyStationSelection(DEFAULT_STATION); }}
                      color="medium"
                      fill="clear"
                      disabled={station === DEFAULT_STATION}
                    >
                      Reset
                    </IonButton>
                  </IonButtons>
                  {stationMenuOpen && menuPos && createPortal(
                    <div
                      ref={menuRef}
                      role="listbox"
                      id="station-listbox"
                      className="autocompleteMenu portal"
                      style={{ position: 'fixed', left: menuPos.left, top: menuPos.top, width: menuPos.width }}
                    >
                      {stationsLoading && allStations.length === 0 ? (
                        <div className="noResults">Loading stations…</div>
                      ) : visibleStations.length === 0 ? (
                        <div className="noResults">No matching stations</div>
                      ) : visibleStations.map((s, i) => (
                        <button
                          id={`station-opt-${i}`}
                          role="option"
                          aria-selected={i === stationMenuIndex}
                          key={`sugg-${s.id}-${i}`}
                          className={`suggestItem${i === stationMenuIndex ? ' highlight' : ''}`}
                          onMouseEnter={() => setStationMenuIndex(i)}
                          onMouseDown={(e) => { e.preventDefault(); }}
                          onClick={() => { applyStationSelection(s.id); }}>
                          {s.name} ({s.id}){s.state ? `, ${s.state}` : ''}
                        </button>
                      ))}
                    </div>, document.body)
                  }
                  <IonToast
                    isOpen={!!toastMsg}
                    message={toastMsg || ''}
                    duration={1400}
                    position="bottom"
                    onDidDismiss={() => setToastMsg(null)}
                  />
                </div>
              </IonItem>
              {stationInfoErr && (
                <IonItem lines="none">
                  <IonNote color="danger">{stationInfoErr}</IonNote>
                </IonItem>
              )}
              {stationInfoErr && (
                <IonItem lines="none">
                  <IonNote color="danger">{stationInfoErr}</IonNote>
                </IonItem>
              )}
              {stationInfo && (
                <IonItem lines="none">
                  <IonLabel className="subLabel">
                    Station Name ({stationInfo.name} ({stationInfo.id}){stationInfo.state ? `, ${stationInfo.state}` : ''})
                  </IonLabel>
                  {(stationInfo.lat !== undefined && stationInfo.lon !== undefined) && (
                    <IonNote slot="end" color="medium">{Number(stationInfo.lat).toFixed(4)}, {Number(stationInfo.lon).toFixed(4)}</IonNote>
                  )}
                </IonItem>
              )}
            </IonList>
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={warningOutline} slot="start" />
                <IonLabel>Flood Settings</IonLabel>
              </IonListHeader>
              {/* Flood threshold */}
              <IonItem lines="none">
                <IonNote color="medium">Flood threshold defines when levels are considered flooding (red on chart).</IonNote>
              </IonItem>
              <IonItem>
                <IonLabel position="stacked" className="subLabel">Flood Threshold (ft, MLLW)</IonLabel>
                <IonInput value={String(threshold)} inputmode="decimal" onIonChange={(e) => {
                  const raw = (e.detail.value as string) || '';
                  const v = parseFloat(raw);
                  if (!Number.isNaN(v)) setThreshold(v);
                }} />
              </IonItem>
              {/* Surge offset */}
              <IonItem lines="none">
                <IonNote color="medium">Surge offset shifts predictions using recent observed vs predicted differences.</IonNote>
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
                  <IonLabel position="stacked" className="subLabel">Manual Offset (ft)</IonLabel>
                  <IonInput value={manualOffsetStr} inputmode="decimal" placeholder="Enter offset in feet" onIonChange={(e) => {
                    setManualOffsetStr(((e.detail.value as string) ?? ''));
                  }} />
                </IonItem>
              ) : (
                <IonItem>
                  <IonLabel position="stacked" className="subLabel">Computed Surge Offset</IonLabel>
                  <IonNote color="medium">{offset !== null ? `${offset >= 0 ? '+' : ''}${offset.toFixed(2)} ft (${nPoints} pts)` : '—'}</IonNote>
                </IonItem>
              )}
            </IonList>
            {/* Display options - chart-related controls */}
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={settingsOutline} slot="start" />
                <IonLabel>Display</IonLabel>
              </IonListHeader>
              <IonItem>
                <IonLabel>Show Δ obs - pred</IonLabel>
                <IonToggle checked={showDelta} onIonChange={(e) => setShowDelta(e.detail.checked)} />
              </IonItem>
            </IonList>
            {/* Time settings: consolidated container */}
            <IonList inset className="settings-section">
              <IonListHeader>
                <IonIcon icon={calendarOutline} slot="start" />
                <IonLabel>Time</IonLabel>
              </IonListHeader>
              {/* Time Zone first */}
              <IonItem lines="none">
                <IonNote color="medium">Controls how times are displayed; NOAA data is in GMT. This does not affect calculations.</IonNote>
              </IonItem>
              <IonItem lines="none">
                <IonLabel className="subLabel">Time Zone</IonLabel>
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
              {/* Time Range mode */}
              <IonItem lines="none">
                <IonNote color="medium">Choose a window around the current time (Relative) or a specific interval (Absolute).</IonNote>
              </IonItem>
              <IonItem lines="none">
                <IonLabel className="subLabel">Time Range</IonLabel>
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
              {rangeMode === 'relative' ? (
                <IonItem lines="none">
                  <div className="twoFieldRow">
                    <div className="field">
                      <IonLabel position="stacked" className="subLabel">Past window</IonLabel>
                      <IonSelect value={lookbackH} onIonChange={(e) => setLookbackH(e.detail.value)} interface="popover">
                        {[12, 24, 36, 48, 60].map(h => (
                          <IonSelectOption key={h} value={h}>{h} hours</IonSelectOption>
                        ))}
                      </IonSelect>
                    </div>
                    <div className="field">
                      <IonLabel position="stacked" className="subLabel">Future window</IonLabel>
                      <IonSelect value={lookaheadH} onIonChange={(e) => setLookaheadH(e.detail.value)} interface="popover">
                        {[24, 36, 48, 60, 72].map(h => (
                          <IonSelectOption key={h} value={h}>{h} hours</IonSelectOption>
                        ))}
                      </IonSelect>
                    </div>
                  </div>
                </IonItem>
              ) : (
                <>
                  <IonItem>
                    <IonLabel>Start ({tz === 'gmt' ? 'GMT' : 'Local'})</IonLabel>
                    <IonDatetime value={absStart} onIonChange={(e) => setAbsStart(e.detail.value as string)} presentation="date-time" minuteValues="0,6,12,18,24,30,36,42,48,54" />
                  </IonItem>
                  <IonItem>
                    <IonLabel>End ({tz === 'gmt' ? 'GMT' : 'Local'})</IonLabel>
                    <IonDatetime value={absEnd} onIonChange={(e) => setAbsEnd(e.detail.value as string)} presentation="date-time" minuteValues="0,6,12,18,24,30,36,42,48,54" />
                  </IonItem>
                </>
              )}
            </IonList>
            
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
              <text x={xOf(now) + 4} y={M.t + 12} fill="var(--chart-axis-text)" fontSize="12">{fmt(now)} {tz === 'gmt' ? 'GMT' : ''}</text>
              {/* Observed polyline, segmented by threshold (red above) */}
              {obsPts.length > 1 && segmentByThreshold(obsPts, threshold).map((seg, i) => (
                <polyline
                  key={`obs-${i}`}
                  fill="none"
                  stroke={seg.above ? '#e74c3c' : '#2ecc71'}
                  strokeWidth="2"
                  points={buildPolyline(seg.points, xOf, yOf)}
                />
              ))}
              {/* Adjusted prediction polyline, segmented by threshold (red above), dashed style retained */}
              {adjPts.length > 1 && segmentByThreshold(adjPts, threshold).map((seg, i) => (
                <polyline
                  key={`adj-${i}`}
                  fill="none"
                  stroke={seg.above ? '#e74c3c' : '#2ecc71'}
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  points={buildPolyline(seg.points, xOf, yOf)}
                />
              ))}
              {/* Unadjusted prediction polyline */}
              {predPts.length > 1 && (
                <polyline fill="none" stroke="#95a5a6" strokeWidth="2" opacity={0.9} points={buildPolyline(predPts, xOf, yOf)} />
              )}
              {/* Delta (Observed - Prediction) series on the same Y scale */}
              {showDelta && deltaPts.length > 1 && (
                <g>
                  {/* zero line for delta */}
                  <line x1={M.l} x2={M.l + innerW} y1={yOf(0)} y2={yOf(0)} stroke="#1976d2" strokeDasharray="4 4" opacity={0.5} />
                  <polyline fill="none" stroke="#1976d2" strokeWidth="2" points={buildPolyline(deltaPts, xOf, yOf)} />
                </g>
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
              {/* No separate right axis when sharing the left scale */}
              {/* Legend (responsive layout for small screens) */}
              {innerW > 420 ? (
                <g transform={`translate(${M.l}, ${H - 10})`}>
                  <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} />
                  <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Observed</text>
                  <line x1={90} x2={110} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
                  <text x={120} y={4} fill="var(--chart-label-text)" fontSize="12">Prediction</text>
                  <line x1={210} x2={230} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
                  <text x={240} y={4} fill="var(--chart-label-text)" fontSize="12">Adjusted prediction</text>
                  {showDelta && (
                    <>
                      <line x1={380} x2={400} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} />
                      <text x={410} y={4} fill="var(--chart-label-text)" fontSize="12">Δ obs - pred</text>
                    </>
                  )}
                </g>
              ) : (
                <g>
                  {/* Row 1 */}
                  <g transform={`translate(${M.l}, ${H - 24})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} />
                    <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Observed</text>
                    <line x1={120} x2={140} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
                    <text x={144} y={4} fill="var(--chart-label-text)" fontSize="12">Prediction</text>
                  </g>
                  {/* Row 2 */}
                  <g transform={`translate(${M.l}, ${H - 8})`}>
                    <line x1={0} x2={20} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
                    <text x={24} y={4} fill="var(--chart-label-text)" fontSize="12">Adjusted prediction</text>
                    {showDelta && (
                      <>
                        <line x1={180} x2={200} y1={0} y2={0} stroke="#1976d2" strokeWidth={2} />
                        <text x={204} y={4} fill="var(--chart-label-text)" fontSize="12">Δ obs - pred</text>
                      </>
                    )}
                  </g>
                </g>
              )}

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
                      const c = (nObs.p.v >= threshold) ? '#e74c3c' : '#2ecc71';
                      rows.push({ label: 'Observed', value: `${nObs.p.v.toFixed(2)} ft`, color: c, cx: xOf(nObs.p.t), cy: yOf(nObs.p.v) });
                    } else {
                      rows.push({ label: 'Observed', value: '—', color: '#2ecc71' });
                    }
                    if (nPred) rows.push({ label: 'Prediction', value: `${nPred.p.v.toFixed(2)} ft`, color: '#95a5a6', cx: xOf(nPred.p.t), cy: yOf(nPred.p.v) });
                    if (nAdj) {
                      const c = (nAdj.p.v >= threshold) ? '#e74c3c' : '#2ecc71';
                      rows.push({ label: 'Adjusted prediction', value: `${nAdj.p.v.toFixed(2)} ft`, color: c, cx: xOf(nAdj.p.t), cy: yOf(nAdj.p.v) });
                    }
                    if (showDelta && nObs && nPred && nObs.dtMin <= 9) {
                      const delta = nObs.p.v - nPred.p.v;
                      const cx = xOf(hoverT);
                      const cy = yOf(delta);
                      rows.push({ label: 'Δ obs - pred', value: `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} ft`, color: '#1976d2', cx, cy });
                    }

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
                                  <line
                                    x1={boxX + 6}
                                    x2={boxX + 16}
                                    y1={boxY + 30 + i * lineH - 4}
                                    y2={boxY + 30 + i * lineH - 4}
                                    stroke={r.color}
                                    strokeWidth={2}
                                    strokeDasharray={r.label === 'Adjusted prediction' ? '5 4' : undefined}
                                  />
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
