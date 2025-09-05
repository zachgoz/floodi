import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonSpinner, IonTitle, IonToolbar, IonRefresher, IonRefresherContent, IonSelect, IonSelectOption, IonAccordionGroup, IonAccordion, IonSegment, IonSegmentButton, IonDatetime } from '@ionic/react';
import './Tab2.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAdjustedFuture, fetchObservedWaterLevels, fetchPredictions, findNextThresholdCrossing } from '../lib/noaa';

const STATION = '8658163';
const THRESHOLD_FT = 6.1; // MLLW feet
const DEFAULT_LOOKBACK_PAST_H = 36;
const DEFAULT_LOOKAHEAD_H = 48;
const H_LB_KEY = 'floodi.hist.lookbackH';
const H_LA_KEY = 'floodi.hist.lookaheadH';
const H_MODE_KEY = 'floodi.hist.rangeMode';
const TZ_KEY = 'floodi.tz';
const H_ABS_START_KEY = 'floodi.hist.absStart';
const H_ABS_END_KEY = 'floodi.hist.absEnd';

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const startPast = rangeMode === 'relative' ? new Date(now.getTime() - lookbackH * 3600_000) : new Date(absStart);
      const endFuture = rangeMode === 'relative' ? new Date(now.getTime() + lookaheadH * 3600_000) : new Date(absEnd);
      // Build adjusted future (also computes surge offset from last 6h internally)
      const { adjusted, offset, n } = await buildAdjustedFuture({
        station: STATION,
        now,
        lookbackHours: 6,
        lookaheadHours: lookaheadH,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      const obs = await fetchObservedWaterLevels({
        station: STATION,
        start: startPast,
        end: now,
        interval: 6,
        datum: 'MLLW',
        units: 'english',
      });
      const pred = await fetchPredictions({
        station: STATION,
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
  }, [rangeMode, lookbackH, lookaheadH, absStart, absEnd]);

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
  const adjPts = useMemo(() => seriesToPoints(adjusted).filter(p => p.t >= domainStart && p.t <= domainEnd), [adjusted]);
  const predPts = useMemo(() => seriesToPoints(predicted).filter(p => p.t >= domainStart && p.t <= domainEnd), [predicted]);

  const yMinMax = useMemo(() => {
    const vals = [...obsPts.map(p => p.v), ...adjPts.map(p => p.v), ...predPts.map(p => p.v), THRESHOLD_FT];
    if (vals.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 0.5; max += 0.5; }
    // Pad
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }, [obsPts, adjPts]);

  // SVG sizing
  const W = 900, H = 420; // viewBox
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
      const aAbove = a.v >= THRESHOLD_FT;
      const bAbove = b.v >= THRESHOLD_FT;
      if (!above && (aAbove || (!aAbove && bAbove))) {
        // entering segment - interpolate start
        let startT = a.t;
        if (!aAbove && bAbove && b.v !== a.v) {
          const frac = (THRESHOLD_FT - a.v) / (b.v - a.v);
          startT = new Date(a.t.getTime() + frac * (b.t.getTime() - a.t.getTime()));
        }
        segStart = startT; above = true;
      }
      if (above && (!bAbove)) {
        // leaving segment - interpolate end
        let endT = b.t;
        if (b.v !== a.v) {
          const frac = (THRESHOLD_FT - a.v) / (b.v - a.v);
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

  const crossing = useMemo(() => findNextThresholdCrossing(adjusted, THRESHOLD_FT, now), [adjusted]);

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
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">History & Forecast</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { try { await refresh(); } finally { (e as any).detail.complete(); } }}>
          <IonRefresherContent pullingText="Pull to refresh" refreshingSpinner="crescent" />
        </IonRefresher>
        <IonAccordionGroup>
          <IonAccordion value="settings">
            <IonItem slot="header">
              <IonLabel>Settings</IonLabel>
            </IonItem>
            <div slot="content">
              <div className="ion-padding">
                <IonSegment value={tz} onIonChange={(e) => setTz(e.detail.value as any)}>
                  <IonSegmentButton value="local">
                    <IonLabel>Local</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="gmt">
                    <IonLabel>GMT</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
              </div>
              <div className="ion-padding">
                <IonSegment value={rangeMode} onIonChange={(e) => setRangeMode(e.detail.value as any)}>
                  <IonSegmentButton value="relative">
                    <IonLabel>Relative</IonLabel>
                  </IonSegmentButton>
                  <IonSegmentButton value="absolute">
                    <IonLabel>Absolute</IonLabel>
                  </IonSegmentButton>
                </IonSegment>
              </div>
              {rangeMode === 'relative' ? (
                <IonList inset>
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
            </div>
          </IonAccordion>
        </IonAccordionGroup>
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
          <div style={{ padding: 8 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height="auto"
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
              <rect x={0} y={0} width={W} height={H} fill="#0b0e12" />
              {/* Plot area */}
              <rect x={M.l} y={M.t} width={innerW} height={innerH} fill="#0f1522" stroke="#233" />
              {/* Flood segments */}
              {floodRects.map((r, i) => (
                <rect key={i} x={r.x} y={M.t} width={r.w} height={innerH} fill="rgba(255,0,0,0.08)" />
              ))}
              {/* Threshold line */}
              <line x1={M.l} x2={M.l + innerW} y1={yOf(THRESHOLD_FT)} y2={yOf(THRESHOLD_FT)} stroke="#e74c3c" strokeDasharray="6 4" />
              <text x={M.l + 6} y={yOf(THRESHOLD_FT) - 6} fill="#e74c3c" fontSize="12">6.1 ft threshold</text>
              {/* Now marker */}
              <line x1={xOf(now)} x2={xOf(now)} y1={M.t} y2={M.t + innerH} stroke="#888" strokeDasharray="2 4" />
              <text x={xOf(now) + 4} y={M.t + 12} fill="#aaa" fontSize="12">now</text>
              {/* Observed polyline */}
              {obsPts.length > 1 && (
                <polyline fill="none" stroke="#2ecc71" strokeWidth="2" points={buildPolyline(obsPts, xOf, yOf)} />
              )}
              {/* Adjusted forecast polyline */}
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
                    <line x1={M.l} x2={M.l + innerW} y1={y} y2={y} stroke="#1d2838" />
                    <text x={4} y={y + 4} fill="#8ba1bd" fontSize="12">{v.toFixed(1)} ft</text>
                  </g>
                );
              })}
              {/* Legend */}
              <g transform={`translate(${M.l}, ${H - 10})`}>
                <circle r={4} fill="#2ecc71" />
                <text x={10} y={4} fill="#c8d5e3" fontSize="12">Observed</text>
                <line x1={90} x2={110} y1={0} y2={0} stroke="#2ecc71" strokeWidth={2} strokeDasharray="5 4" />
                <text x={120} y={4} fill="#c8d5e3" fontSize="12">Adjusted forecast</text>
                <line x1={230} x2={250} y1={0} y2={0} stroke="#95a5a6" strokeWidth={2} />
                <text x={260} y={4} fill="#c8d5e3" fontSize="12">Prediction</text>
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
                    if (nAdj) rows.push({ label: 'Adjusted', value: `${nAdj.p.v.toFixed(2)} ft`, color: '#2ecc71', cx: xOf(nAdj.p.t), cy: yOf(nAdj.p.v) });

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
                              <rect x={boxX} y={boxY} width={boxW} height={rowsH} rx={6} ry={6} fill="#1b2433" stroke="#2a3a55" />
                              <text x={boxX + 8} y={boxY + 16} fill="#c8d5e3" fontSize="12">{fmt(hoverT)} {tz === 'gmt' ? 'GMT' : ''}</text>
                              {rows.map((r, i) => (
                                <g key={`row-${i}`}>
                                  <circle cx={boxX + 10} cy={boxY + 30 + i * lineH - 4} r={4} fill={r.color} />
                                  <text x={boxX + 20} y={boxY + 30 + i * lineH} fill="#c8d5e3" fontSize="12">{r.label}: {r.value}</text>
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
            <IonItem>
              <IonLabel>
                <h2>Surge Offset</h2>
                <p>{offset !== null ? `${offset >= 0 ? '+' : ''}${offset.toFixed(2)} ft` : '—'}<IonNote style={{ marginLeft: 8 }} color="medium">{nPoints} pts</IonNote></p>
              </IonLabel>
            </IonItem>
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
