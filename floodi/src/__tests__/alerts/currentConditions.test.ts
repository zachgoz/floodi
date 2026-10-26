import { describe, expect, it } from 'vitest';
import { currentGaugeStatus } from 'src/components/dashboard/currentGaugeStatus';
const now = new Date('2026-10-17T12:00:00Z');
describe('current gauge condition', () => {
  it('excludes proxy, future and nonfinite readings from current observed claims', () => {
    const result=currentGaugeStatus([{t:now,v:7,estimated:true},{t:new Date(+now+1),v:8},{t:now,v:NaN}],5.6,now);
    expect(result.label).toBe('Observation unavailable');
  });
  it('does not turn stale below-threshold readings into a current safe claim', () => {
    expect(currentGaugeStatus([{t:new Date(+now-61*60_000),v:3}],5.6,now).label).toBe('Observation out of date');
  });
  it('uses the configured threshold and actual latest sample', () => {
    const points=[{t:new Date(+now-30*60_000),v:5.7},{t:new Date(+now-60*60_000),v:5.2}];
    expect(currentGaugeStatus(points,5.6,now).above).toBe(true);
    expect(currentGaugeStatus(points,5.8,now).label).toBe('Below flood threshold');
    expect(points[0].v).toBe(5.7);
  });
});
