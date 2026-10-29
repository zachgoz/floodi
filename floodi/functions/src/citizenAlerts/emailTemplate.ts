import {
  CAROLINA_BEACH_THRESHOLDS,
  FloodSeverityTier,
  OperationalAlertCategory,
  OperationalNotificationEvent,
  PublicFloodAdvisory,
} from './operationalAlerts';

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fullDateTimeEt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const shortTimeEt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function formatDuration(minutes: number): string {
  const safe = Math.max(15, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function severityPalette(severity: FloodSeverityTier, isAllClear = false) {
  if (isAllClear) {
    return { bg: '#064e3b', border: '#10b981', pillBg: '#10b981', pillText: '#022c22', label: 'ALL-CLEAR' };
  }
  switch (severity) {
    case 'extreme':
      return { bg: '#450a0a', border: '#ef4444', pillBg: '#dc2626', pillText: '#ffffff', label: 'EXTREME FLOOD' };
    case 'major':
      return { bg: '#450a0a', border: '#f87171', pillBg: '#ef4444', pillText: '#ffffff', label: 'MAJOR FLOOD' };
    case 'moderate':
      return { bg: '#431407', border: '#fb923c', pillBg: '#f97316', pillText: '#ffffff', label: 'MODERATE FLOOD' };
    case 'minor':
    default:
      return { bg: '#451a03', border: '#fbbf24', pillBg: '#f59e0b', pillText: '#1e1b4b', label: 'MINOR FLOOD' };
  }
}

function categoryBadgeText(category: OperationalAlertCategory): string {
  switch (category) {
    case 'imminent_warning':
      return 'IMMINENT WARNING';
    case 'forecast_change':
      return 'FORECAST UPDATED';
    case 'all_clear':
      return 'BELOW FLOOD STAGE';
    case 'upcoming_watch':
    default:
      return 'UPCOMING FLOOD WATCH';
  }
}

function formatDriversLine(adv: PublicFloodAdvisory): string {
  const d = adv.drivers;
  if (!d) {
    return `Astronomical Tide ${adv.tideFt.toFixed(2)} ft + Total Surge ${adv.surgeFt >= 0 ? '+' : ''}${adv.surgeFt.toFixed(2)} ft`;
  }
  const parts: string[] = [`Tide ${adv.tideFt.toFixed(2)} ft`, `Ocean Surge ${d.oceanSurgeFt >= 0 ? '+' : ''}${d.oceanSurgeFt.toFixed(2)} ft`];
  if (Math.abs(d.windSetupFt) >= 0.03) {
    parts.push(`Wind Setup ${d.windSetupFt >= 0 ? '+' : ''}${d.windSetupFt.toFixed(2)} ft`);
  }
  if (Math.abs(d.riverFlowFt) >= 0.03) {
    parts.push(`Cape Fear River Head ${d.riverFlowFt >= 0 ? '+' : ''}${d.riverFlowFt.toFixed(2)} ft`);
  }
  if (Math.abs(d.rainfallRunoffFt) >= 0.03) {
    parts.push(`Rainfall Runoff +${d.rainfallRunoffFt.toFixed(2)} ft`);
  }
  if (Math.abs(d.estuarineHarmonicFt) >= 0.03) {
    parts.push(`Estuarine Harmonics ${d.estuarineHarmonicFt >= 0 ? '+' : ''}${d.estuarineHarmonicFt.toFixed(2)} ft`);
  }
  return parts.join(' · ');
}

export interface RenderedCitizenEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Builds rich multipart HTML + Plain-Text operational flood alert emails with
 * embedded 48-hour hydrograph PNG, street inundation estimate, wind/rain conditions,
 * physical surge drivers, and deep-link CTA into the live app.
 */
export function buildOperationalAlertEmail(
  event: OperationalNotificationEvent,
  publicBaseUrl: string
): RenderedCitizenEmail {
  const baseUrl = (publicBaseUrl || 'https://floodcastwebapp.web.app').replace(/\/+$/, '');
  const adv = event.primaryAdvisory;
  const isAllClear = event.category === 'all_clear';
  const palette = severityPalette(event.highestSeverity, isAllClear);
  const catText = categoryBadgeText(event.category);

  const peakLabel = fullDateTimeEt.format(new Date(adv.peakAt));
  const windowLabel = `${fullDateTimeEt.format(new Date(adv.startAt))} – ${shortTimeEt.format(new Date(adv.endAt))} (${formatDuration(
    adv.durationMinutes
  )})`;
  const windLabel =
    adv.windSpeedMph !== null
      ? `${adv.windSpeedMph} mph${adv.windCompass ? ` ${adv.windCompass}` : ''}`
      : 'Light / Variable';
  const rainLabel = adv.precipWindowIn > 0.01 ? `${adv.precipWindowIn.toFixed(2)} in forecast` : '0.00 in (Dry tidal)';
  const streetInundationLabel = isAllClear
    ? 'Below 5.6 ft curb reference'
    : `~${adv.estimatedStreetDepthIn.toFixed(1)} in on lowest Canal Dr / basin streets (+${adv.aboveFloodStageFt.toFixed(
        2
      )} ft above 5.6 ft stage)`;

  const chartUrl = `${baseUrl}/api/alerts?chart=1&peak=${encodeURIComponent(adv.peakAt)}&v=${encodeURIComponent(
    event.issuedAt.slice(0, 16)
  )}`;
  const forecastDeepLink = `${baseUrl}/tab2?t=${encodeURIComponent(adv.peakAt)}`;
  const prefsLink = `${baseUrl}/alerts`;
  const driversLine = formatDriversLine(adv);

  const subject = `FloodCast Carolina Beach: ${event.bulletin.headline}`;

  // 1. Accessible plain-text body
  const textLines: string[] = [
    `${palette.label} · ${catText} — Carolina Beach, NC`,
    event.bulletin.headline,
    ...(event.whatChanged ? [`What Changed: ${event.whatChanged}`] : []),
    '',
    `Predicted Peak: ${adv.peakFt.toFixed(2)} ft MLLW at ${peakLabel}`,
    ...(isAllClear
      ? []
      : [
          `Flood Window (≥ 5.6 ft): ${windowLabel}`,
          `Estimated Low-Street Water: ${streetInundationLabel}`,
          `Peak Wind & Rain: ${windLabel} · Rain: ${rainLabel}`,
          `Surge Drivers: ${driversLine}`,
        ]),
    ...(event.additionalAdvisories.length > 0
      ? [
          '',
          `Additional Upcoming High-Water Cycles (Next 48h):`,
          ...event.additionalAdvisories.map(
            extra =>
              `- ${fullDateTimeEt.format(new Date(extra.peakAt))}: Peak ${extra.peakFt.toFixed(
                2
              )} ft MLLW (~${extra.estimatedStreetDepthIn.toFixed(1)} in low-street water, ${formatDuration(
                extra.durationMinutes
              )})`
          ),
        ]
      : []),
    '',
    ` Carolina Beach Thresholds: ${CAROLINA_BEACH_THRESHOLDS.minor.toFixed(
      1
    )} ft Minor | ${CAROLINA_BEACH_THRESHOLDS.moderate.toFixed(
      1
    )} ft Moderate | ${CAROLINA_BEACH_THRESHOLDS.major.toFixed(
      1
    )} ft Major | ${CAROLINA_BEACH_THRESHOLDS.extreme.toFixed(1)} ft Extreme`,
    '',
    `View Live Hydrograph & Street Inundation Map: ${forecastDeepLink}`,
    `Customize Alert Categories: ${prefsLink}`,
  ];

  // 2. Rich responsive dark/light email-safe HTML body (table-based metrics for Gmail/Outlook/Apple Mail)
  const extraCyclesHtml =
    event.additionalAdvisories.length > 0
      ? `<div style="margin-top:16px;padding:14px;background:#0f172a;border:1px solid #1e293b;border-radius:10px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd;margin-bottom:8px;">
            Additional Flood Cycles in Next 48 Hours
          </div>
          ${event.additionalAdvisories
            .map(
              extra => `<div style="font-size:13px;color:#e2e8f0;padding:6px 0;border-top:1px solid #1e293b;">
                <strong>${escapeHtml(fullDateTimeEt.format(new Date(extra.peakAt)))}</strong> ·
                Crest <strong>${extra.peakFt.toFixed(2)} ft MLLW</strong>
                (~${extra.estimatedStreetDepthIn.toFixed(1)}&quot; low-street water · ${formatDuration(
                  extra.durationMinutes
                )})
              </div>`
            )
            .join('')}
        </div>`
      : '';

  const whatChangedHtml = event.whatChanged
    ? `<div style="margin:14px 0 0;padding:10px 14px;background:rgba(255,255,255,0.08);border-left:3px solid ${palette.pillBg};border-radius:6px;font-size:13px;color:#f8fafc;">
        <strong>What Changed:</strong> ${escapeHtml(event.whatChanged)}
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#060d1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <div style="max-width:640px;margin:0 auto;padding:20px 14px;">
    <div style="background:#0b1628;border:1px solid #1e3a5f;border-radius:16px;overflow:hidden;">
      <div style="padding:20px 22px;background:${palette.bg};border-bottom:2px solid ${palette.border};">
        <div style="margin-bottom:10px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${palette.pillBg};color:${palette.pillText};font-size:11px;font-weight:800;letter-spacing:0.08em;">
            ${escapeHtml(palette.label)}
          </span>
          <span style="display:inline-block;margin-left:6px;padding:4px 10px;border-radius:999px;background:rgba(15,23,42,0.65);color:#e2e8f0;font-size:11px;font-weight:700;letter-spacing:0.06em;">
            ${escapeHtml(catText)}
          </span>
        </div>
        <h1 style="margin:0;font-size:20px;line-height:1.3;color:#ffffff;">
          ${escapeHtml(event.bulletin.headline)}
        </h1>
        <p style="margin:6px 0 0;font-size:13px;color:#cbd5e1;">
          Carolina Beach, NC (Myrtle Grove Sound / Canal Dr Gauge) · Operational Basin Physics + NOAA ETSS Forecast
        </p>
        ${whatChangedHtml}
      </div>

      <div style="padding:20px 22px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td width="50%" valign="top" style="padding:10px 12px;background:#0f1f38;border:1px solid #1e3a5f;border-radius:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Predicted Crest</div>
              <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:4px;">${adv.peakFt.toFixed(2)} ft <span style="font-size:12px;font-weight:600;color:#93c5fd;">MLLW</span></div>
              <div style="font-size:12px;color:#cbd5e1;margin-top:3px;">${escapeHtml(peakLabel)}</div>
            </td>
            <td width="10"></td>
            <td width="50%" valign="top" style="padding:10px 12px;background:#0f1f38;border:1px solid #1e3a5f;border-radius:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Est. Low-Street Water</div>
              <div style="font-size:20px;font-weight:800;color:#fbbf24;margin-top:4px;">${
                isAllClear ? 'Below Curb' : `~${adv.estimatedStreetDepthIn.toFixed(1)} in`
              }</div>
              <div style="font-size:12px;color:#cbd5e1;margin-top:3px;">${
                isAllClear ? 'Below 5.6 ft MLLW stage' : `+${adv.aboveFloodStageFt.toFixed(2)} ft above 5.6 ft stage`
              }</div>
            </td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:10px;">
          <tr>
            <td width="50%" valign="top" style="padding:10px 12px;background:#0f1f38;border:1px solid #1e3a5f;border-radius:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Flood Window (≥ 5.6 ft)</div>
              <div style="font-size:13px;font-weight:700;color:#f8fafc;margin-top:4px;">${escapeHtml(windowLabel)}</div>
            </td>
            <td width="10"></td>
            <td width="50%" valign="top" style="padding:10px 12px;background:#0f1f38;border:1px solid #1e3a5f;border-radius:10px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Peak Wind &amp; Rain</div>
              <div style="font-size:13px;font-weight:700;color:#f8fafc;margin-top:4px;">Wind: ${escapeHtml(
                windLabel
              )}</div>
              <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">Rain: ${escapeHtml(rainLabel)}</div>
            </td>
          </tr>
        </table>

        <div style="margin-top:12px;padding:10px 14px;background:#0f172a;border:1px solid #1e293b;border-radius:10px;font-size:12px;color:#cbd5e1;">
          <strong style="color:#93c5fd;">Physical Surge Breakdown:</strong> ${escapeHtml(driversLine)}
        </div>

        <div style="margin-top:16px;">
          <img src="${escapeHtml(
            chartUrl
          )}" width="594" alt="48-hour Carolina Beach water-level forecast hydrograph peaking at ${adv.peakFt.toFixed(
    2
  )} ft MLLW" style="display:block;width:100%;max-width:594px;height:auto;border-radius:10px;border:1px solid #1e3a5f;" />
        </div>

        ${extraCyclesHtml}

        <div style="margin-top:20px;text-align:center;">
          <a href="${escapeHtml(
            forecastDeepLink
          )}" style="display:inline-block;padding:13px 24px;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">
            Open Live Hydrograph &amp; Street Inundation Map &rarr;
          </a>
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1e293b;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">
          Carolina Beach Flood Stages: <strong>5.6 ft</strong> Minor · <strong>7.0 ft</strong> Moderate · <strong>7.7 ft</strong> Major · <strong>8.5 ft</strong> Extreme (MLLW)<br/>
          <a href="${escapeHtml(prefsLink)}" style="color:#38bdf8;text-decoration:underline;">Customize notification tiers &amp; categories</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return {
    subject,
    text: textLines.join('\n'),
    html,
  };
}

/**
 * Builds a rich branded HTML + Plain-Text test email using live forecast telemetry when available.
 */
export function buildRichTestAlertEmail(
  publicBaseUrl: string,
  livePeakFt?: number | null,
  livePeakAt?: string | null,
  currentSurgeFt?: number | null
): RenderedCitizenEmail {
  const baseUrl = (publicBaseUrl || 'https://floodcastwebapp.web.app').replace(/\/+$/, '');
  const chartUrl = `${baseUrl}/api/alerts?chart=1&test=1&v=${Date.now()}`;
  const forecastLink = `${baseUrl}/tab2`;
  const prefsLink = `${baseUrl}/alerts`;

  const peakSummary =
    typeof livePeakFt === 'number' && livePeakAt
      ? `${livePeakFt.toFixed(2)} ft MLLW (${fullDateTimeEt.format(new Date(livePeakAt))})`
      : 'Live 48-hour operational forecast connected';
  const surgeSummary =
    typeof currentSurgeFt === 'number'
      ? `${currentSurgeFt >= 0 ? '+' : ''}${currentSurgeFt.toFixed(2)} ft`
      : 'Active';

  const subject = 'Your FloodCast Carolina Beach Rich Alert Preview (Test)';
  const text = [
    'Your email flood alerts are connected for Carolina Beach. This is a test, not a flooding forecast.',
    `Current Operational Forecast Crest (48h): ${peakSummary} · Current Surge: ${surgeSummary}`,
    'Coverage uses the Carolina Beach water-level gauge (5.6 Minor / 7.0 Moderate / 7.7 Major / 8.5 Extreme ft MLLW); street depth and road status are estimates.',
    `Open Live Forecast & Street Map: ${forecastLink}`,
    `Customize Notification Categories: ${prefsLink}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#060d1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <div style="max-width:640px;margin:0 auto;padding:20px 14px;">
    <div style="background:#0b1628;border:1px solid #1e3a5f;border-radius:16px;overflow:hidden;">
      <div style="padding:20px 22px;background:#0c4a6e;border-bottom:2px solid #38bdf8;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#38bdf8;color:#082f49;font-size:11px;font-weight:800;letter-spacing:0.08em;">CONNECTED · TEST PREVIEW</span>
        <h1 style="margin:10px 0 0;font-size:20px;color:#ffffff;">FloodCast Rich Email Alerts Connected</h1>
        <p style="margin:6px 0 0;font-size:13px;color:#bae6fd;">This is a test preview confirming your Carolina Beach alert delivery and live 48-hour hydrograph chart.</p>
      </div>
      <div style="padding:20px 22px;">
        <div style="padding:12px 14px;background:#0f1f38;border:1px solid #1e3a5f;border-radius:10px;font-size:13px;color:#e2e8f0;">
          <strong>Live 48h Forecast Crest:</strong> ${escapeHtml(peakSummary)}<br/>
          <strong>Current Observed Surge:</strong> ${escapeHtml(surgeSummary)}
        </div>
        <div style="margin-top:16px;">
          <img src="${escapeHtml(chartUrl)}" width="594" alt="Live 48-hour Carolina Beach forecast hydrograph" style="display:block;width:100%;max-width:594px;height:auto;border-radius:10px;border:1px solid #1e3a5f;" />
        </div>
        <div style="margin-top:20px;text-align:center;">
          <a href="${escapeHtml(forecastLink)}" style="display:inline-block;padding:13px 24px;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">
            Open Live Forecast &amp; Street Map &rarr;
          </a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

