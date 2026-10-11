import type { ForecastDocument } from '../../functions/src/forecast/schema';
import { interpolate } from './waterForecast';
import type { Point } from 'src/components/Tab2/types';

/** Total forecasts refer to physical gauge levels at UTC timestamps. When the
 * chart localizes the same NOAA tide with a different phase, express that total
 * relative to the chart's tide rather than copying an incompatible residual.
 */
export function alignForecastComparison(outlook: ForecastDocument | null, tide: Point[], reference: {
  station: string; tideStation: string; datum: string; units: string; thresholdFt: number;
}) {
  const compatible = !!outlook && outlook.sensor === reference.station && outlook.tideStation === reference.tideStation && outlook.datum === reference.datum && outlook.units === reference.units;
  const points = compatible ? outlook!.points.map(p => ({ t: new Date(p.t), v: p.totalFt })) : [];
  const residual = compatible ? outlook!.points.flatMap(p => {
    const t = new Date(p.t);
    const localTide = interpolate(tide, t);
    return localTide === null ? [] : [{ t, v: p.totalFt - localTide }];
  }) : [];
  return { compatible, points, residual };
}
