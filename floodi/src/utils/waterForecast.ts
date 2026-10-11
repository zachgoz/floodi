export {
  interpolate,
  residuals,
  floodWindows,
  inundation,
  liveViewport,
  surgeTrend,
  projectSurgeTrend,
} from "../../functions/src/forecast/water";
export type {
  FloodWindow,
  StreetCalibration,
} from "../../functions/src/forecast/water";
export const LOCAL_ZONE = "America/New_York";
export function hasUpcomingFlooding(points: { t: Date; v: number }[], thresholdFt: number, now: Date): boolean {
  return calculateFloodWindows(points, thresholdFt).some(event => +(event.endTime || event.lastSampleTime) > +now);
}
export const eventDate = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: LOCAL_ZONE,
  }).format(date);
export const eventTime = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: LOCAL_ZONE,
  }).format(date);
export function eventWindow(start: Date, end: Date | null) {
  if (!end) return `${eventTime(start)} – End unavailable`;
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: LOCAL_ZONE,
    }).format(d);
  return `${eventTime(start)} – ${day(start) === day(end) ? "" : eventDate(end) + ", "}${eventTime(end)}`;
}
import { floodWindows as calculateFloodWindows } from '../../functions/src/forecast/water';
