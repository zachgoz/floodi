import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { recordJobOutcome, safeError } from '../utils/observability';
import { FORECAST_TIDE_DAYS, points, SITE, weatherForecast } from './sources';
import { fetchFimanData } from '../etl/fiman';
import { fetchNoaaPredictions } from '../etl/noaa';
import { residuals, WaterPoint } from './water';
import { encodeJsonResponse } from '../utils/jsonResponse';
import { ChallengerOutlookDocument, runTimesFmChallenger } from './challenger';
import { runOperationalAlertsForForecast } from '../citizenAlerts/operationalAlerts';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export function isCurrentOperationalOutlook(
  value: unknown,
  now: Date
): value is ChallengerOutlookDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ChallengerOutlookDocument>;
  return (
    doc.status === 'available' &&
    doc.locationId === SITE.id &&
    typeof doc.generatedAt === 'string' &&
    typeof doc.expiresAt === 'string' &&
    Array.isArray(doc.points) &&
    doc.points.length >= 24 &&
    Date.parse(doc.generatedAt) <= +now &&
    Date.parse(doc.expiresAt) > +now
  );
}

/**
 * Retired daily ridge-regression training schedule.
 * Kept as a zero-cost telemetry stub so existing Cloud Scheduler bindings succeed
 * without running 90-day scraping or legacy 72-lead ridge fitting.
 */
export const refreshResidualHistory = onSchedule(
  {
    schedule: 'every 24 hours',
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const attemptedAt = new Date().toISOString();
    await recordJobOutcome(db, 'refreshResidualHistory', SITE.id, {
      attemptedAt,
      status: 'ok',
      retired: true,
      activeEngine: 'timesfm-3-basin-physics',
    });
  }
);

async function fetchOperationalInputs(now: Date, lookbackHours = 72) {
  const start = new Date(+now - lookbackHours * 3600_000);
  const end = new Date(+now + FORECAST_TIDE_DAYS * 24 * 3600_000);
  let weatherDegraded = false;

  const [sensor, rawTide, forecastWeather] = await Promise.all([
    fetchFimanData(SITE.retrievalPlatform, start, now, SITE.offsetFt),
    fetchNoaaPredictions(SITE.tideStation, new Date(+start - 2 * 3600_000), end),
    weatherForecast().catch(error => {
      weatherDegraded = true;
      logger.warn('Open-Meteo weather unavailable; Basin Physics continues with NOAA ETSS + Harmonics', {
        event: 'forecast_weather_failed',
        provider: 'open_meteo',
        error: safeError(error),
      });
      return [];
    }),
  ]);

  const tide: WaterPoint[] = points(rawTide).map(p => ({
    ...p,
    t: new Date(+p.t + SITE.phaseMinutes * 60_000),
  }));
  const reference = {
    station: SITE.sensor,
    datum: SITE.datum,
    units: SITE.units,
  };
  const recentResidual = residuals(points(sensor.waterLevels), tide, reference, reference);

  return {
    tide,
    recentResidual,
    forecastWeather,
    weatherDegraded,
  };
}

/**
 * Primary 10-minute standalone Operational Forecast & Alerts 2.0 job.
 * Completely decoupled from legacy `forecast_models`, `buildGaugeForecast`, and `gemini-3.8-flash`.
 */
export const generateFloodOutlook = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeoutSeconds: 300,
    memory: '512MiB',
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    const now = new Date();
    const currentRef = db.doc(`locations/${SITE.id}/forecast_challengers/timesfm-3/outlook/current`);
    const cachedSnap = await currentRef.get();
    const cachedDoc = cachedSnap.data();

    if (
      cachedSnap.exists &&
      isCurrentOperationalOutlook(cachedDoc, now) &&
      Date.parse(cachedDoc.generatedAt) > +now - 8 * 60_000
    ) {
      return;
    }

    let stage = 'sources';
    try {
      const { tide, recentResidual, forecastWeather, weatherDegraded } = await fetchOperationalInputs(now, 72);
      const issuedAt = new Date();

      stage = 'forecast';
      const operationalDoc = await runTimesFmChallenger({
        db,
        siteId: SITE.id,
        thresholdFt: SITE.thresholdFt,
        issuedAt,
        recentResidual,
        tide,
        forecastWeather,
        horizonSteps: 144,
        extendFullTideHorizon: true,
      });

      if (!operationalDoc || operationalDoc.status !== 'available') {
        throw new Error('Operational forecast engine could not produce an available forecast');
      }

      stage = 'alerts';
      let alertSummary = { activeCount: 0, notificationsEmitted: 0 };
      try {
        alertSummary = await runOperationalAlertsForForecast(db, operationalDoc, issuedAt);
      } catch (alertErr) {
        logger.error('Operational alert evaluation failed after forecast publication', {
          event: 'operational_alerts_failed',
          siteId: SITE.id,
          error: safeError(alertErr),
        });
      }

      await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, {
        attemptedAt: now.toISOString(),
        status: weatherDegraded ? 'partial' : 'ok',
        stage,
        engine: operationalDoc.engine,
        numericalGeneratedAt: operationalDoc.generatedAt,
        observationAt: operationalDoc.observationAt ?? null,
        pointsCount: operationalDoc.points.length,
        activeAdvisories: alertSummary.activeCount,
        notificationsEmitted: alertSummary.notificationsEmitted,
      });
    } catch (error) {
      logger.error('Operational forecast update failed', {
        event: 'forecast_generation_failed',
        stage,
        error: safeError(error),
      });

      if (cachedSnap.exists && isCurrentOperationalOutlook(cachedDoc, new Date())) {
        await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, {
          attemptedAt: now.toISOString(),
          status: 'failed',
          stage,
          retainedGeneratedAt: cachedDoc.generatedAt,
          error: safeError(error),
        });
        throw new Error('Operational update failed; existing forecast retained until its original expiry');
      }

      await recordJobOutcome(db, 'generateFloodOutlook', SITE.id, {
        attemptedAt: now.toISOString(),
        status: 'failed',
        stage,
        error: safeError(error),
      });
      throw new Error('No current operational outlook could be generated');
    }
  }
);

/** Compatibility endpoint serving the authoritative Operational Forecast. */
export const floodOutlook = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.vary('Accept-Encoding');
    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const snap = await db.doc(`locations/${SITE.id}/forecast_challengers/timesfm-3/outlook/current`).get();
      const data = snap.data();
      if (!snap.exists || !isCurrentOperationalOutlook(data, new Date())) {
        res.status(503).json({ error: 'Current evaluated outlook unavailable' });
        return;
      }
      const encoded = await encodeJsonResponse(data, req.get('Accept-Encoding'));
      if (encoded.notAcceptable) {
        res.status(406).send();
        return;
      }
      const remaining = Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000);
      if (remaining > 0) {
        res.set('Cache-Control', `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(300, remaining)}`);
      }
      if (encoded.contentEncoding) res.set('Content-Encoding', encoded.contentEncoding);
      res.type('application/json').send(encoded.body);
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('Content-Encoding');
      logger.error('Cached operational outlook read failed', {
        event: 'forecast_read_failed',
        error: safeError(error),
      });
      res.status(503).json({ error: 'Outlook unavailable' });
    }
  }
);

/** Primary public HTTP endpoint (`/api/challenger`) for the Operational Forecast. */
export const floodChallenger = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.vary('Accept-Encoding');
    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    try {
      const force = req.query.force === 'true' || req.query.fresh === '1' || req.query.refresh === '1';
      const targetSiteId = typeof req.query.locationId === 'string' && /^[a-z0-9-]{1,50}$/.test(req.query.locationId)
        ? req.query.locationId
        : SITE.id;
      const snap = await db.doc(`locations/${targetSiteId}/forecast_challengers/timesfm-3/outlook/current`).get();
      let data = snap.data() as ChallengerOutlookDocument | undefined;

      if (
        (force ||
        !snap.exists ||
        !isCurrentOperationalOutlook(data, new Date()) ||
        data.points.length < 100) && targetSiteId === SITE.id
      ) {
        const now = new Date();
        const { tide, recentResidual, forecastWeather } = await fetchOperationalInputs(now, 48);
        const generated = await runTimesFmChallenger({
          db,
          siteId: SITE.id,
          thresholdFt: SITE.thresholdFt,
          issuedAt: now,
          recentResidual,
          tide,
          forecastWeather,
          horizonSteps: 144,
          extendFullTideHorizon: true,
        });
        if (generated && generated.status === 'available') {
          data = generated;
          await runOperationalAlertsForForecast(db, generated, now).catch(() => undefined);
        }
      }

      if (!data || data.status !== 'available') {
        res.status(503).json({ error: 'Current operational outlook unavailable' });
        return;
      }
      const encoded = await encodeJsonResponse(data, req.get('Accept-Encoding'));
      if (encoded.notAcceptable) {
        res.status(406).send();
        return;
      }
      const remaining = Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000);
      if (remaining > 0) {
        res.set('Cache-Control', `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(300, remaining)}`);
      }
      if (encoded.contentEncoding) res.set('Content-Encoding', encoded.contentEncoding);
      res.type('application/json').send(encoded.body);
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('Content-Encoding');
      logger.error('Operational forecast read failed', {
        event: 'challenger_read_failed',
        error: safeError(error),
      });
      res.status(503).json({ error: 'Operational outlook unavailable' });
    }
  }
);
