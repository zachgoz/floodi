const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CAROLINA_BEACH_THRESHOLDS,
  classifyFloodSeverity,
  evaluateOperationalAlertStep,
  extractOperationalAdvisories,
  normalizeCitizenPreferences,
  subscriberMatchesNotification,
} = require('../lib/citizenAlerts/operationalAlerts');
const { renderHydrographPng } = require('../lib/citizenAlerts/chartPng');
const { buildOperationalAlertEmail } = require('../lib/citizenAlerts/emailTemplate');
const { createResendProvider } = require('../lib/citizenAlerts/provider');
const { parseCitizenAction } = require('../lib/citizenAlerts/service');

function buildMockForecast(originMs, tidePeaks) {
  // Builds 48h (97 half-hour steps) of operational forecast points with Gaussian crests at specified tidePeaks
  const points = [];
  for (let step = 0; step <= 96; step++) {
    const tMs = originMs + step * 30 * 60_000;
    const h = step * 0.5;
    let totalFt = 3.2;
    for (const pk of tidePeaks) {
      const dist = h - pk.hourOffset;
      const bump = (pk.peakFt - 3.2) * Math.exp(-(dist * dist) / 3.5);
      if (3.2 + bump > totalFt) totalFt = 3.2 + bump;
    }
    totalFt = Math.round(totalFt * 1000) / 1000;
    const residualFt = 0.95;
    const tideFt = Math.round((totalFt - residualFt) * 1000) / 1000;
    points.push({
      t: new Date(tMs).toISOString(),
      totalFt,
      tideFt,
      residualFt,
      lowerFt: Math.round((totalFt - 0.25) * 1000) / 1000,
      upperFt: Math.round((totalFt + 0.25) * 1000) / 1000,
      windSpeedMph: 19,
      windDirectionDeg: 25,
      precipIn: 0.08,
      drivers: {
        oceanSurgeFt: 0.52,
        windSetupFt: 0.16,
        riverFlowFt: 0.14,
        rainfallRunoffFt: 0.05,
        estuarineHarmonicFt: 0.08,
      },
    });
  }
  return {
    challengerId: 'timesfm-3',
    locationId: 'carolina-beach',
    generatedAt: new Date(originMs).toISOString(),
    currentResidualFt: 0.95,
    expiresAt: new Date(originMs + 45 * 60_000).toISOString(),
    status: 'available',
    engine: 'noaa-etss-hybrid',
    horizonSteps: points.length,
    thresholdFt: 5.6,
    points,
    peak: {
      t: points[0].t,
      totalFt: Math.max(...points.map(p => p.totalFt)),
      tideFt: 4.5,
      residualFt: 0.95,
      exceedsThreshold: true,
    },
    covariatesUsed: ['astronomical_tide', 'noaa_etss_surge'],
    metadata: { historyPointsCount: 97, noaaSurgeAvailable: true, retrievedAt: new Date(originMs).toISOString() },
  };
}

test('canonical Carolina Beach thresholds (5.6 / 7.0 / 7.7 / 8.5) and 0.15 ft downward hysteresis', () => {
  assert.deepEqual(CAROLINA_BEACH_THRESHOLDS, { minor: 5.6, moderate: 7.0, major: 7.7, extreme: 8.5 });
  assert.equal(classifyFloodSeverity(5.59), null);
  assert.equal(classifyFloodSeverity(5.60), 'minor');
  assert.equal(classifyFloodSeverity(6.99), 'minor');
  assert.equal(classifyFloodSeverity(7.00), 'moderate');
  assert.equal(classifyFloodSeverity(7.70), 'major');
  assert.equal(classifyFloodSeverity(8.50), 'extreme');

  // Hysteresis hold: active 'minor' episode at 5.52 ft stays 'minor' (>= 5.45), drops only at 5.44 ft
  assert.equal(classifyFloodSeverity(5.52, CAROLINA_BEACH_THRESHOLDS, 'minor'), 'minor');
  assert.equal(classifyFloodSeverity(5.44, CAROLINA_BEACH_THRESHOLDS, 'minor'), null);
  // Active 'moderate' episode at 6.90 ft stays 'moderate' (>= 6.85), downgrades to 'minor' at 6.80 ft
  assert.equal(classifyFloodSeverity(6.90, CAROLINA_BEACH_THRESHOLDS, 'moderate'), 'moderate');
  assert.equal(classifyFloodSeverity(6.80, CAROLINA_BEACH_THRESHOLDS, 'moderate'), 'minor');
});

test('right-edge endClipped guard prevents fake escalation spam as rising tide enters 48h window', () => {
  const originMs = Date.parse('2026-10-29T12:00:00Z');
  // Peak is at +49.0h (outside 48h cutoff), so at +48h water is already >= 5.60 ft and still rising!
  const clippedForecast = buildMockForecast(originMs, [{ hourOffset: 49.0, peakFt: 6.45 }]);
  const extracted = extractOperationalAdvisories(clippedForecast.points, originMs);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].endClipped, true);

  const step1 = evaluateOperationalAlertStep(null, clippedForecast, new Date(originMs));
  assert.equal(step1.notifications.length, 0, 'Incomplete right-edge rising limb must not trigger premature spam');

  // 3 hours later, crest is well inside the 48h window (+46.5h) -> fires exactly 1 upcoming_watch
  const origin2 = originMs + 3 * 3600_000;
  const completeForecast = buildMockForecast(origin2, [{ hourOffset: 46.5, peakFt: 6.45 }]);
  const step2 = evaluateOperationalAlertStep(step1.nextState, completeForecast, new Date(origin2));
  assert.equal(step2.notifications.length, 1);
  assert.equal(step2.notifications[0].category, 'upcoming_watch');
  assert.equal(step2.notifications[0].highestSeverity, 'minor');
});

test('6-hour cooldown blocks 10-min jitter, tier escalation bypasses immediately, transient outage freezes cleanly, and hysteresis prevents 5.60 flip-flop', () => {
  const t0 = Date.parse('2026-10-29T12:00:00Z');

  // 1. Initial detection of a 6.10 ft Minor Flood at +18h -> 1 upcoming_watch
  const s1 = evaluateOperationalAlertStep(null, buildMockForecast(t0, [{ hourOffset: 18, peakFt: 6.10 }]), new Date(t0));
  assert.equal(s1.notifications.length, 1);
  assert.equal(s1.notifications[0].category, 'upcoming_watch');

  // 2. 10 minutes and 40 minutes later, forecast jitters 6.10 -> 6.38 ft (still Minor, inside 6h cooldown) -> 0 emails!
  const t1 = t0 + 20 * 60_000;
  const s2 = evaluateOperationalAlertStep(
    s1.nextState,
    buildMockForecast(t1, [{ hourOffset: 17.67, peakFt: 6.38 }]),
    new Date(t1)
  );
  assert.equal(s2.notifications.length, 0, 'Same-tier update inside 6h cooldown must be suppressed');

  // 3. Transient weather/provider outage 10 mins later (null forecast) + recovery 10 mins later -> 0 forecast_restored spam!
  const t2 = t1 + 10 * 60_000;
  const sOutage = evaluateOperationalAlertStep(s2.nextState, null, new Date(t2));
  assert.equal(sOutage.notifications.length, 0);
  assert.equal(sOutage.feed.activeAdvisories.length, 1, 'Active advisory must remain visible during transient outage');

  const t3 = t2 + 10 * 60_000;
  const sRecovered = evaluateOperationalAlertStep(
    sOutage.nextState,
    buildMockForecast(t3, [{ hourOffset: 17.33, peakFt: 6.38 }]),
    new Date(t3)
  );
  assert.equal(sRecovered.notifications.length, 0, 'Recovery from transient outage must not fire forecast_restored spam');

  // 4. Threshold hysteresis: forecast dips slightly below 5.60 to 5.52 ft -> stays held in hysteresis, 0 all-clear spam!
  const t4 = t3 + 20 * 60_000;
  const sHysteresis = evaluateOperationalAlertStep(
    sRecovered.nextState,
    buildMockForecast(t4, [{ hourOffset: 17.0, peakFt: 5.52 }]),
    new Date(t4)
  );
  assert.equal(sHysteresis.notifications.length, 0, '5.52 ft is inside 0.15 ft hysteresis band and must not trigger all_clear');

  // 5. Tier escalation to Moderate Flood (7.15 ft >= 7.0 ft) inside cooldown -> IMMEDIATELY bypasses cooldown!
  const t5 = t4 + 20 * 60_000;
  const sEscalated = evaluateOperationalAlertStep(
    sHysteresis.nextState,
    buildMockForecast(t5, [{ hourOffset: 16.67, peakFt: 7.15 }]),
    new Date(t5)
  );
  assert.equal(sEscalated.notifications.length, 1, 'Tier escalation Minor -> Moderate must bypass cooldown immediately');
  assert.equal(sEscalated.notifications[0].category, 'forecast_change');
  assert.equal(sEscalated.notifications[0].highestSeverity, 'moderate');
  assert.match(sEscalated.notifications[0].whatChanged, /Upgraded from Minor to Moderate Flood/);

  // 6. Entering <= 3.5h imminent window (+15h elapsed, flood onset ~2h away) -> fires 1 imminent_warning once!
  const tImminent = t0 + 15.5 * 3600_000;
  const sImminent = evaluateOperationalAlertStep(
    sEscalated.nextState,
    buildMockForecast(tImminent, [{ hourOffset: 2.5, peakFt: 7.18 }]),
    new Date(tImminent)
  );
  assert.equal(sImminent.notifications.length, 1);
  assert.equal(sImminent.notifications[0].category, 'imminent_warning');

  // 10 mins later inside imminent window -> does NOT re-send imminent_warning!
  const sImminentRepeat = evaluateOperationalAlertStep(
    sImminent.nextState,
    buildMockForecast(tImminent + 10 * 60_000, [{ hourOffset: 2.33, peakFt: 7.19 }]),
    new Date(tImminent + 10 * 60_000)
  );
  assert.equal(sImminentRepeat.notifications.length, 0);
});

test('multi-tide consolidation merges back-to-back flood tides into one digest notification', () => {
  const t0 = Date.parse('2026-10-29T12:00:00Z');
  const twoTides = buildMockForecast(t0, [
    { hourOffset: 12, peakFt: 6.08 },
    { hourOffset: 24.5, peakFt: 6.42 },
  ]);

  const res = evaluateOperationalAlertStep(null, twoTides, new Date(t0));
  assert.equal(res.feed.activeAdvisories.length, 2, 'In-app feed shows both individual flood windows');
  assert.equal(res.notifications.length, 1, 'Email engine consolidates simultaneous watches into 1 digest email');
  assert.equal(res.notifications[0].primaryAdvisory.peakFt, 6.42);
  assert.equal(res.notifications[0].additionalAdvisories.length, 1);
  assert.equal(res.notifications[0].additionalAdvisories[0].peakFt, 6.08);
});

test('configurable subscriber preferences, pure-TS PNG hydrograph renderer, and rich HTML/Text email template', async () => {
  // 1. Preference schema validation & matching
  const customPrefs = {
    severities: { minor: false, moderate: true, major: true, extreme: true },
    categories: { upcomingWatch: true, imminentWarning: true, forecastChange: false, allClear: true },
  };
  assert.deepEqual(normalizeCitizenPreferences(customPrefs), customPrefs);
  assert.equal(normalizeCitizenPreferences({ severities: { minor: 'yes' }, categories: {} }), null);
  assert.ok(parseCitizenAction({ action: 'update_preferences', preferences: customPrefs }));
  assert.equal(parseCitizenAction({ action: 'update_preferences' }), null);

  assert.equal(subscriberMatchesNotification(customPrefs, 'minor', 'upcoming_watch'), false);
  assert.equal(subscriberMatchesNotification(customPrefs, 'moderate', 'upcoming_watch'), true);
  assert.equal(subscriberMatchesNotification(customPrefs, 'moderate', 'forecast_change'), false);
  assert.equal(subscriberMatchesNotification(customPrefs, 'major', 'all_clear'), true);

  // 2. Pure-TS 48h Hydrograph PNG binary verification
  const t0 = Date.parse('2026-10-29T12:00:00Z');
  const fcst = buildMockForecast(t0, [{ hourOffset: 14, peakFt: 7.24 }]);
  const pngBuf = renderHydrographPng({ points: fcst.points, width: 680, height: 260 });
  assert.ok(Buffer.isBuffer(pngBuf));
  assert.ok(pngBuf.length > 2500, `Expected non-trivial PNG buffer, got ${pngBuf.length} bytes`);
  // PNG 8-byte signature: 137 80 78 71 13 10 26 10
  assert.deepEqual([...pngBuf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(pngBuf.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(pngBuf.readUInt32BE(16), 680);
  assert.equal(pngBuf.readUInt32BE(20), 260);
  assert.ok(pngBuf.includes(Buffer.from('IEND', 'ascii')));

  // 3. Rich Multipart HTML + Plain-Text Email + Resend provider verification
  const evalRes = evaluateOperationalAlertStep(null, fcst, new Date(t0));
  const event = evalRes.notifications[0];
  const email = buildOperationalAlertEmail(event, 'https://floodcastwebapp.web.app');

  assert.match(email.subject, /Moderate Flood Watch/i);
  assert.match(email.text, /7\.24 ft MLLW/);
  assert.match(email.text, /19 mph NNE/);
  assert.match(email.text, /~19\.7 in/);
  assert.match(email.html, /https:\/\/floodcastwebapp\.web\.app\/api\/alerts\?chart=1/);
  assert.match(email.html, /https:\/\/floodcastwebapp\.web\.app\/tab2\?t=/);
  assert.match(email.html, /Cape Fear River Head/);

  // Verify Resend provider sends BOTH html and text with fragment #token= unsubscribe link
  let resendPayload = null;
  const provider = createResendProvider(
    {
      enabled: true,
      provider: 'resend',
      fromEmail: 'alerts@floodcastwebapp.web.app',
      publicBaseUrl: 'https://floodcastwebapp.web.app',
      apiKey: 'synthetic-key',
    },
    async (_url, init) => {
      resendPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 });
    }
  );
  await provider.send({
    id: 'deliv-1',
    to: 'user@example.com',
    subject: email.subject,
    text: email.text,
    html: email.html,
    unsubscribeToken: 'f'.repeat(64),
  });
  assert.ok(resendPayload.html);
  assert.match(resendPayload.html, /\/alerts\/unsubscribe#token=f{64}/);
  assert.match(resendPayload.text, /\/alerts\/unsubscribe#token=f{64}/);
});
