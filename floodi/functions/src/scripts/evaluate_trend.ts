/** Read-only chronological comparison on an existing, provenance-bearing residual archive. */
import { readFileSync, writeFileSync } from 'fs';
import { interpolate, projectSurgeTrend, surgeTrend, WaterPoint } from '../forecast/water';
const input = process.argv[2];
if (!input) throw new Error('Provide the historical residual JSON path');
const archive = JSON.parse(readFileSync(input, 'utf8'));
const points: WaterPoint[] = archive.history.map((p: {t: string; v: number}) => ({t:new Date(p.t),v:p.v})).filter((p: WaterPoint) => Number.isFinite(+p.t) && Number.isFinite(p.v)).sort((a: WaterPoint,b: WaterPoint) => +a.t-+b.t);
const cutoff = Math.floor(points.length * .7);
const totals = [1,3,6].map(hours => ({hours,n:0,trendError:0,persistenceError:0,linearError:0}));
let previousIssue=0;
for (let i=cutoff;i<points.length;i++) {
  const issue=points[i];
  if (+issue.t-previousIssue<3600_000) continue;
  previousIssue=+issue.t;
  let start=i;
  while(start>0 && +issue.t-+points[start-1].t<=3*3600_000) start--;
  const past=points.slice(start,i+1);
  const fit=surgeTrend(past,issue.t);
  if(fit.slopeFtPerHour===null) continue;
  for(const row of totals) {
    const target=new Date(+issue.t+row.hours*3600_000);
    const actual=interpolate(points,target);
    const forecast=projectSurgeTrend(past,[target],issue.t,{horizonHours:6}).at(-1);
    if(actual===null || !forecast || +forecast.t!==+target) continue;
    row.n++;
    row.trendError+=Math.abs(forecast.v-actual);
    row.persistenceError+=Math.abs(issue.v-actual);
    row.linearError+=Math.abs(issue.v+fit.slopeFtPerHour*row.hours-actual);
  }
}
const report={
  metadata:archive.metadata,
  evaluatedAt:new Date().toISOString(),
  testStart:points[cutoff]?.t.toISOString(),testEnd:points.at(-1)?.t.toISOString(),
  settings:{lookbackHours:3,dampingHours:2,maxChangeFt:.5,horizonHours:6},
  metrics:totals.map(r=>({horizonHours:r.hours,samples:r.n,trendMaeFt:r.n?r.trendError/r.n:null,persistenceMaeFt:r.n?r.persistenceError/r.n:null,linearMaeFt:r.n?r.linearError/r.n:null})),
  limitations:['Fixed uncalibrated parameters; no tuning on these test periods.','Hourly rolling issues overlap; errors are descriptive, not independent confidence estimates.','Archive station/phase/datum metadata apply only to this sensor. The dashboard regional-gauge reference differs.','No operational promotion or flood-event validation from this residual-only comparison.'],
};
writeFileSync('evaluation/trend-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
