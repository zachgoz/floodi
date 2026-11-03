import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { loadRollingVerificationSummary } from './summary';
import { loadModelDiagnostics } from './diagnostics';
import { safeError } from '../utils/observability';
import * as logger from 'firebase-functions/logger';

if (!admin.apps.length) admin.initializeApp();

/**
 * Public endpoint serving rolling 30-day verified empirical forecast accuracy.
 *
 * GET /api/accuracy?locationId=carolina-beach
 */
export const forecastAccuracy = onRequest(
  { cors: true, maxInstances: 10, memory: '256MiB', timeoutSeconds: 15 },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const rawLocationId = typeof req.query.locationId === 'string' ? req.query.locationId.trim() : '';
    const locationId = rawLocationId && /^[a-z0-9-]{1,64}$/.test(rawLocationId)
      ? rawLocationId
      : 'carolina-beach';

    try {
      const db = admin.firestore();
      const summary = await loadRollingVerificationSummary(db, locationId);

      // Cache for 1 hour at CDN level, 10 minutes in browser
      res.set('Cache-Control', 'public, s-maxage=3600, max-age=600');
      res.status(200).json(summary);
    } catch (err) {
      logger.error('Failed serving forecast accuracy endpoint', {
        locationId,
        error: safeError(err),
      });
      res.status(500).json({ error: 'Failed retrieving forecast accuracy' });
    }
  }
);

/**
 * Public endpoint serving model health diagnostics, error attribution, and autonomous improvement proposals.
 *
 * GET /api/diagnostics?locationId=carolina-beach
 */
export const forecastDiagnostics = onRequest(
  { cors: true, maxInstances: 10, memory: '256MiB', timeoutSeconds: 15 },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const rawLocationId = typeof req.query.locationId === 'string' ? req.query.locationId.trim() : '';
    const locationId = rawLocationId && /^[a-z0-9-]{1,64}$/.test(rawLocationId)
      ? rawLocationId
      : 'carolina-beach';

    try {
      const db = admin.firestore();
      const diagnostics = await loadModelDiagnostics(db, locationId);

      // Cache for 1 hour at CDN level, 10 minutes in browser
      res.set('Cache-Control', 'public, s-maxage=3600, max-age=600');
      res.status(200).json(diagnostics);
    } catch (err) {
      logger.error('Failed serving forecast diagnostics endpoint', {
        locationId,
        error: safeError(err),
      });
      res.status(500).json({ error: 'Failed retrieving forecast diagnostics' });
    }
  }
);


